// P2: 스마트 압축 병렬 후보(v6, 한 차례 2개 동시) vs 현재 v5(차례로 1개).
// 정답표(bench/out/curves.json = Kodak 22장 × 품질 1~100을 bench/codecs-node.ts로 전부 인코딩한 결과)를 evaluate로 쓴다.
// 인코더가 결정적이라 같은 q면 같은 바이트·SSIM → 실제 인코딩과 탐색 경로가 같다(시간만 안 잰다).
// 지표: 차례 수(벽시계 대리값: 한 차례 = 그 차례 시도 중 가장 느린 것), 인코딩 수(CPU 비용), 손해(최적 대비 용량), 놓침, v5와 결과가 다른 사진 수.
// 예측값은 search-bench.ts와 같이 leave-one-out(시험 사진은 빼고 배운다).
// 실행: node bench/parallel-search.ts            (정답표, 빠름)
//       node bench/parallel-search.ts --real [jpg,webp,avif]    (실제 인코딩 벽시계: 워커 스레드 2개, v5는 하나만 씀. 22장 × 3포맷 × 목표 3개, 사진마다 먼저 도는 쪽을 바꿔 치우침을 줄인다)
import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { searchInterp, searchInterpParallel, type Probe } from '../apps/web/src/core/search.ts';

if (!isMainThread) {
  // 워커: 사진 하나를 기억해 두고 (포맷, q) → 인코딩 + 디코딩 + SSIM(브라우저와 같은 ssimRgba)
  const { initCodecs, encoders, decoders } = await import('./codecs-node.ts');
  const { loadPng } = await import('../apps/web/test/load-png.ts');
  const { ssimRgba } = await import('../apps/web/src/core/ssim.ts');
  await initCodecs();
  let path = '', img: ImageData | null = null;
  parentPort!.on('message', async (m: { path: string; fmt: 'jpg' | 'webp' | 'avif'; q: number }) => {
    if (m.path !== path) { const p = loadPng(m.path); img = new ImageData(p.data, p.w, p.h); path = m.path; }
    const buf = await encoders[m.fmt](img!, m.q);
    parentPort!.postMessage({ q: m.q, bytes: buf.byteLength, ssim: ssimRgba(img!, await decoders[m.fmt](buf)) });
  });
} else if (process.argv.includes('--real')) await real();
else await table();

async function real() {
  const { priorFor } = await import('../apps/web/src/core/priors.ts');
  const ws = [0, 1].map(() => new Worker(new URL(import.meta.url)));
  const call = (w: Worker, msg: object) => new Promise<Probe>(res => { w.once('message', res); w.postMessage(msg); });
  const { readdirSync } = await import('node:fs');
  const imgs = readdirSync('bench/data/kodak').filter(f => f.endsWith('.png')).sort();
  // 첫 호출은 WASM 준비가 섞이므로 버린다
  for (const w of ws) for (const fmt of ['jpg', 'webp', 'avif']) await call(w, { path: 'bench/data/kodak/kodim03.png', fmt, q: 50 });
  console.log(['포맷', '목표', 'v5 ms', 'v6 ms', '변화', 'v5 시도', 'v6 차례/시도', '같은 품질', 'v6가 더 큰 사진', 'v6 용량 합 차이', 'v6만 못 찾음'].join('	'));
  const only = process.argv[process.argv.indexOf('--real') + 1]?.split(',') ?? ['jpg', 'webp', 'avif'];
  for (const fmt of (['jpg', 'webp', 'avif'] as const).filter(f => only.includes(f))) for (const target of [0.95, 0.97, 0.985]) {
    let ta = 0, tb = 0, na = 0, rb = 0, nb = 0, same = 0, k = 0, ba = 0, bb = 0, worse = 0, miss = 0;
    for (const name of imgs) {
      const path = `bench/data/kodak/${name}`;
      const o = { target, space: 'log' as const, ...priorFor(fmt, target) };
      const v5 = async () => { const t = performance.now(); const r = await searchInterp(q => call(ws[0]!, { path, fmt, q }), o); ta += performance.now() - t; return r; };
      // v6: 한 차례의 두 후보를 두 워커에 나눠 준다
      const v6 = async () => { let turn = 0; const t = performance.now(); const r = await searchInterpParallel(q => call(ws[turn++ % 2]!, { path, fmt, q }), o); tb += performance.now() - t; return r; };
      const [a, b] = k++ % 2 ? await v6().then(async b => [await v5(), b] as const) : await v5().then(async a => [a, await v6()] as const);
      na += a.probes.length; rb += b.rounds; nb += b.probes.length;
      if (a.best?.q === b.best?.q) same++;
      if (a.best && !b.best) miss++;
      if (a.best && b.best) { ba += a.best.bytes; bb += b.best.bytes; if (b.best.bytes > a.best.bytes) worse++; }
    }
    console.log([fmt, target, ta.toFixed(0), tb.toFixed(0), `${(100 * (tb / ta - 1)).toFixed(0)}%`, (na / imgs.length).toFixed(1), `${(rb / imgs.length).toFixed(1)}/${(nb / imgs.length).toFixed(1)}`, `${same}/${imgs.length}`, `${worse}`, `${(100 * (bb / ba - 1)).toFixed(2)}%`, `${miss}`].join('	'));
  }
  for (const w of ws) await w.terminate();
}

async function table() {

const curves: Record<string, Record<string, number[][]>> = JSON.parse(readFileSync('bench/out/curves.json', 'utf8'));
const targets = [0.95, 0.97, 0.985];
const fmts = ['jpg', 'webp', 'avif'];
const fLog = (s: number) => -Math.log(Math.max(1e-6, 1 - s));
function optimalQ(img: string, fmt: string, target: number) {
  const ok = curves[img]![fmt]!.filter(r => r[2]! >= target).sort((a, b) => a[1]! - b[1]!)[0];
  return ok ? ok[0]! : 100;
}
function prior(exclude: string, fmt: string, target: number) {
  const qs = Object.keys(curves).filter(i => i !== exclude && curves[i]![fmt]?.length === 100).map(i => optimalQ(i, fmt, target)).sort((a, b) => a - b);
  const at = (p: number) => qs[Math.min(qs.length - 1, Math.floor(p * qs.length))]!;
  return { guess: at(0.5), step: Math.max(1, Math.round((at(0.75) - at(0.25)) / 2)) };
}
function slope(exclude: string, fmt: string, target: number) {
  const lo = Math.max(0.8, target - 0.01), hi = Math.min(0.999, target + 0.01);
  return (prior(exclude, fmt, hi).guess - prior(exclude, fmt, lo).guess) / (fLog(hi) - fLog(lo));
}

const rows: string[][] = [];
let sum = { v5: 0, pr: 0, pe: 0 }, cells = 0;
for (const fmt of fmts) {
  for (const target of targets) {
    let v5n = 0, prR = 0, prE = 0, v5Reg = 0, prReg = 0, v5Max = 0, prMax = 0, miss = 0, worse = 0, better = 0, n = 0;
    for (const img of Object.keys(curves)) {
      const curve = curves[img]![fmt];
      if (curve?.length !== 100) continue;
      const table = new Map(curve.map(r => [r[0]!, { q: r[0]!, bytes: r[1]!, ssim: r[2]! } as Probe]));
      const optimal = [...table.values()].filter(p => p.ssim >= target).sort((a, b) => a.bytes - b.bytes)[0];
      const o = { target, space: 'log' as const, ...prior(img, fmt, target), slope: slope(img, fmt, target) };
      const a = await searchInterp(async q => table.get(q)!, o);
      const b = await searchInterpParallel(async q => table.get(q)!, o);
      n++;
      v5n += a.probes.length; prR += b.rounds; prE += b.probes.length;
      if (optimal) {
        if (!b.best) miss++;
        const ra = a.best ? a.best.bytes / optimal.bytes - 1 : 0, rb = b.best ? b.best.bytes / optimal.bytes - 1 : 0;
        v5Reg += ra; prReg += rb; v5Max = Math.max(v5Max, ra); prMax = Math.max(prMax, rb);
      }
      if (a.best && b.best && b.best.bytes > a.best.bytes) worse++;
      if (a.best && b.best && b.best.bytes < a.best.bytes) better++;
    }
    const pct = (x: number) => (100 * x / n).toFixed(2);
    rows.push([fmt, String(target), (v5n / n).toFixed(2), (prR / n).toFixed(2), `${(100 * (prR / v5n - 1)).toFixed(0)}%`, (prE / n).toFixed(2), `+${(100 * (prE / v5n - 1)).toFixed(0)}%`,
      `${pct(v5Reg)} / ${(100 * v5Max).toFixed(1)}`, `${pct(prReg)} / ${(100 * prMax).toFixed(1)}`, String(miss), `${worse}/${better}`]);
    sum.v5 += v5n / n; sum.pr += prR / n; sum.pe += prE / n; cells++;
  }
}
console.log(['포맷', '목표', 'v5 차례(=인코딩)', 'v6 차례', '차례 변화', 'v6 인코딩', '인코딩 변화', 'v5 손해 평균%/최대%', 'v6 손해 평균%/최대%', 'v6 놓침', 'v6 나빠짐/좋아짐(장)'].join('\t'));
for (const r of rows) console.log(r.join('\t'));
console.log(`전체 평균: v5 ${(sum.v5 / cells).toFixed(2)}차례 → v6 ${(sum.pr / cells).toFixed(2)}차례(${(100 * (sum.pr / sum.v5 - 1)).toFixed(0)}%), 인코딩 ${(sum.v5 / cells).toFixed(2)} → ${(sum.pe / cells).toFixed(2)}(+${(100 * (sum.pe / sum.v5 - 1)).toFixed(0)}%)`);
}
