// 큰 사진 스마트 압축: 모자이크로 품질을 찾고 → 원본 전체를 한 번 인코딩 → 원본 SSIM으로 확인 → 미달이면 올려서 다시(최대 2번).
// 화질 약속(목표 SSIM)을 먼저 지키고, 용량 손해는 그다음.
import { searchInterp, type Probe } from './search.ts';
import { buildMosaic, type Rgba } from './mosaic.ts';
import { ssimRgba } from './ssim.ts';

export interface LargeDeps {
  encode(img: Rgba, q: number): Promise<ArrayBuffer>;
  decode(buf: ArrayBuffer): Promise<Rgba>;
}
const f = (s: number) => -Math.log(Math.max(1e-6, 1 - s));

export async function searchLarge(img: Rgba, target: number, prior: { guess?: number; step?: number; slope?: number }, deps: LargeDeps) {
  const mosaic = buildMosaic(img);
  if (!mosaic) return null; // 작으면 원래 방식(전체 탐색)
  const m = await searchInterp(async q => {
    const buf = await deps.encode(mosaic, q);
    return { q, bytes: buf.byteLength, ssim: ssimRgba(mosaic, await deps.decode(buf)) };
  }, { target, space: 'log', ...prior });
  let q = m.best?.q ?? 90;
  const checks: Probe[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const buf = await deps.encode(img, q);
    const ssim = ssimRgba(img, await deps.decode(buf));
    checks.push({ q, bytes: buf.byteLength, ssim });
    if (ssim >= target || q >= 100) return { q, buf, ssim, mosaicTries: m.probes.length, fullEncodes: attempt + 1, checks };
    // 미달: 기울기로 필요한 만큼 올린다(최소 2)
    q = Math.min(100, q + Math.max(2, Math.round((prior.slope ?? 8) * (f(target) - f(ssim))) + 1));
  }
  const last = checks[checks.length - 1]!;
  return { q: last.q, buf: await deps.encode(img, last.q), ssim: last.ssim, mosaicTries: m.probes.length, fullEncodes: checks.length + 1, checks };
}
