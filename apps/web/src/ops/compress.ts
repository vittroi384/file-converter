// 스마트 압축: 목표 SSIM 이상 중 가장 작은 파일.
// - 보통 크기: core/search.ts v5(예측 시작점 + 뉴턴 점프 + 보간)로 전체 탐색
//   파일 하나만 압축할 때(화면이 parallel을 준다)는 하위 워커 하나와 이 워커가 후보 2개씩 동시에 재는 v6(searchInterpParallel)
// - 큰 사진(약 350만 화소 이상): core/search-large.ts(골고루 뽑은 원본 해상도 조각 모자이크로 품질 찾기 → 전체 1회 인코딩 → 원본 SSIM 확인)
import type { OpRunner } from '../core/types.ts';
import { searchInterp, searchInterpParallel, type Probe } from '../core/search.ts';
import { searchLarge } from '../core/search-large.ts';
import { priorFor } from '../core/priors.ts';
import { ssimRgba, ssimPlanes } from '../core/ssim.ts';
import { decodeImage, encodeImage, decodeEncoded, resizeImage, renameExt, flatten, MIME, type ImageOut } from './codecs.ts';
import { ConvertError } from '../core/types.ts';
import { stripMetadata } from './strip.ts';

export const run: OpRunner = async (inputs, options, ctx) => {
  const input = inputs[0]!;
  const target = Math.min(0.999, Math.max(0.8, Number(options.target ?? 0.98)));
  ctx.progress(0.05, 'open');
  const maxWidth = options.maxWidth as number | undefined, maxHeight = options.maxHeight as number | undefined;
  const { img: raw, from } = await decodeImage(input, { maxWidth, maxHeight });
  const userFormat = ['jpg', 'webp', 'avif'].includes(options.to as string);
  let to = (userFormat ? options.to
    : from === 'png' || from === 'webp' ? 'webp' : 'jpg') as Exclude<ImageOut, 'png'>;
  let img = await resizeImage(raw, maxWidth, maxHeight);
  if (to === 'jpg') img = flatten(img);
  const prior = priorFor(to, target);
  const t0 = performance.now();
  let n = 0;
  const encode = async (im: { width: number; height: number; data: Uint8ClampedArray }, q: number) => {
    n++;
    ctx.progress(Math.min(0.95, 0.1 + n * 0.12), `q${q}`);
    return encodeImage(im as ImageData, to, { quality: q });
  };

  let best: { q: number; buf: ArrayBuffer; ssim: number } | null = null;
  let tries = 0, rounds = 0, path = 'full';
  const large = await searchLarge(img, target, prior, { encode, decode: b => decodeEncoded(b, to) });
  if (large) {
    best = { q: large.q, buf: large.buf, ssim: large.ssim };
    tries = large.mosaicTries + large.fullEncodes;
    path = 'mosaic';
  } else {
    // 시도 결과를 전부 쌓아 두지 않고, 목표를 넘은 것 중 가장 작은 하나만 남긴다(큰 사진에서 수십 MB씩 쌓였다)
    const keep = (q: number, buf: ArrayBuffer, ssim: number): Probe => {
      if (ssim >= target && (!best || buf.byteLength < best.buf.byteLength)) best = { q, buf, ssim };
      return { q, bytes: buf.byteLength, ssim };
    };
    const evaluate = async (q: number): Promise<Probe> => {
      const buf = await encode(img, q);
      return keep(q, buf, ssimRgba(img, await decodeEncoded(buf, to)));
    };
    const sub = await probeWorker(img.width * img.height, options.parallel);
    if (sub) {
      // 한 차례의 두 후보 중 먼저 온 것은 하위 워커로(보내 놓고 바로 돌아온다), 다음 것은 이 워커에서
      let remoteBusy = false;
      const remote = async (q: number): Promise<Probe> => {
        remoteBusy = true;
        ctx.progress(Math.min(0.95, 0.1 + ++n * 0.12), `q${q}`);
        try {
          const r = await sub.run({ op: 'compress-probe' as never, inputs: [{ name: 'x', type: 'application/octet-stream', buf: img.data.slice().buffer }], options: { width: img.width, height: img.height, to, q } }).promise;
          return keep(q, r.outputs[0]!.buf, Number(r.meta?.ssim));
        } catch {
          return evaluate(q); // 하위 워커가 죽으면(메모리 등) 이 워커에서
        } finally { remoteBusy = false; }
      };
      try {
        const r = await searchInterpParallel(q => (remoteBusy ? evaluate(q) : remote(q)), { target, space: 'log', ...prior });
        tries = r.probes.length; rounds = r.rounds;
      } finally { sub.destroy(); }
    } else {
      const r = await searchInterp(evaluate, { target, space: 'log', ...prior });
      tries = rounds = r.probes.length;
    }
  }
  if (!best) throw new ConvertError('encode', '목표 화질에 도달하지 못했어요');

  // ── 색 검사(devlog 23절) ──
  // 탐색은 밝기 SSIM만 본다(빠름). 고른 결과를 한 번 색(Cb·Cr)까지 본다. 기준은 Kodak 사진 데이터로만 정했다:
  //   색 평균 < 0.92, 또는 밝기−색 > 0.043, 또는 색 하위 5% 구역 < 0.74 → 4:2:0 색 번짐
  //   (사진 181조합 잘못 걸림 0, 처음 보는 색 그림 두 세트 각 36개 중 29개 잡음)
  // 걸리면 색을 줄이지 않는 4:4:4로 다시 찾는다. '자동'이면 AVIF(실측 +17%로 가장 효율적), 고른 JPG·AVIF면 그대로, WebP는 방법이 없어 안내.
  let color: 'ok' | '444' | 'warn' = 'ok';
  const colorLoss = async (buf: ArrayBuffer, fmt: ImageOut) => {
    const p = ssimPlanes(img, await decodeEncoded(buf, fmt));
    const c = Math.min(p.cb, p.cr), c5 = Math.min(p.cb5, p.cr5);
    return { loss: c < 0.92 || p.y - c > 0.043 || c5 < 0.74, y: p.y, c, c5 };
  };
  const firstColor = await colorLoss((best as { buf: ArrayBuffer }).buf, to);
  if (firstColor.loss) {
    const fmt2 = (userFormat ? to : 'avif') as Exclude<ImageOut, 'png'>;
    if (fmt2 === 'webp') color = 'warn';
    else {
      // 4:4:4면 색은 품질과 거의 상관없이 돌아온다(AVIF 0.41→0.999) → 밝기로 찾고, 결과를 색 기준으로 확인(모자라면 품질 올려 최대 2번)
      let best2: { q: number; buf: ArrayBuffer; ssim: number } | null = null;
      const evaluate2 = async (q: number): Promise<Probe> => {
        n++;
        ctx.progress(Math.min(0.97, 0.5 + n * 0.05), `444 q${q}`);
        const buf = await encodeImage(img as ImageData, fmt2, { quality: q, chroma: 'full' });
        const ssim = ssimRgba(img, await decodeEncoded(buf, fmt2));
        if (ssim >= target && (!best2 || buf.byteLength < best2.buf.byteLength)) best2 = { q, buf, ssim };
        return { q, bytes: buf.byteLength, ssim };
      };
      const r2 = await searchInterp(evaluate2, { target, space: 'log', ...priorFor(fmt2, target) });
      tries += r2.probes.length;
      let cand = best2 as { q: number; buf: ArrayBuffer; ssim: number } | null;
      for (let bump = 0; cand && bump < 3; bump++) {
        if (!(await colorLoss(cand.buf, fmt2)).loss) break;
        if (bump === 2 || cand.q >= 98) { cand = null; break; }
        const q = Math.min(98, cand.q + 8);
        cand = { q, buf: await encodeImage(img as ImageData, fmt2, { quality: q, chroma: 'full' }), ssim: cand.ssim };
        tries++;
      }
      if (cand) { best = cand; to = fmt2; color = '444'; } else color = 'warn';
    }
  }
  const b = best as { q: number; buf: ArrayBuffer; ssim: number };
  // 원본보다 커지면 원본을 둔다(이미 잘 압축된 파일). 단,
  // - 크기를 줄여 달라고 했으면 원본을 주면 안 된다(예전엔 SNS 크기를 골라도 원본 크기가 나갈 수 있었다)
  // - 원본에서 GPS·카메라 정보를 지운 것을 준다(예전엔 원본 바이트 그대로 → 위치 정보가 샜다). 방향 태그만 남김
  // - 지울 줄 모르는 형식이면 다시 인코딩한 결과를 준다
  const resized = img.width !== raw.width || img.height !== raw.height;
  const clean = from === to && !resized ? stripMetadata(input.buf, from, { keepOrientation: true }) : null;
  const keepOriginal = clean !== null && b.buf.byteLength >= clean.byteLength;
  return {
    outputs: [keepOriginal
      ? { name: input.name, type: input.type, buf: clean }
      : { name: renameExt(input.name, to), type: MIME[to], buf: b.buf }],
    meta: { from, to, q: b.q, ssim: +b.ssim.toFixed(4), tries, rounds, path, searchMs: Math.round(performance.now() - t0), keptOriginal: keepOriginal, color, chroma: +firstColor.c.toFixed(4), chroma5: +firstColor.c5.toFixed(4) },
  };
};

// P2(bench/parallel-search.ts): 병렬 후보는 한가할 때만. 일괄 처리 중엔 코어가 이미 다 바빠서(화면이 parallel을 안 준다) v5 그대로.
// 작은 사진은 하위 워커를 띄우고 코덱을 준비하는 비용이 아낄 시간보다 커서 제외. 메모리는 RGBA 사본·WASM 힙이 하나 더 든다.
const PARALLEL_MIN_PIXELS = 1_000_000;
async function probeWorker(pixels: number, parallel: unknown) {
  if (parallel !== true || typeof Worker === 'undefined' || pixels < PARALLEL_MIN_PIXELS) return null;
  const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const { memoryBudget } = await import('../core/imgsize.ts');
  if (hw < 4 || memoryBudget() < 1024 * 1048576) return null;
  const { WorkerPool } = await import('../core/pool.ts');
  return new WorkerPool({ size: 1, create: () => new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' }) as never });
}

// 하위 워커 쪽(내부 작업 compress-probe): RGBA 한 장을 q로 인코딩 → 결과와 SSIM
export const probe: OpRunner = async (inputs, o) => {
  const img = new ImageData(new Uint8ClampedArray(inputs[0]!.buf), Number(o.width), Number(o.height));
  const to = o.to as Exclude<ImageOut, 'png'>;
  const buf = await encodeImage(img, to, { quality: Number(o.q) });
  return { outputs: [{ name: 'x', type: MIME[to], buf }], meta: { ssim: ssimRgba(img, await decodeEncoded(buf, to)) } };
};
