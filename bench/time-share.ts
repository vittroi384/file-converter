// 스마트 압축 1회 시도의 시간 나눔: 인코딩 / 디코딩 / SSIM. P1(SSIM SIMD)이 해볼 만한지.
import { initCodecs, encoders, decoders, type Fmt } from './codecs-node.ts';
import { loadPng } from '../apps/web/test/load-png.ts';
import { ssimRgba } from '../apps/web/src/core/ssim.ts';
await initCodecs();
const p = loadPng('bench/data/kodak/kodim22.png');
const img = new ImageData(new Uint8ClampedArray(p.data), p.w, p.h);
for (const fmt of ['jpg', 'webp', 'avif'] as Fmt[]) {
  let e = 0, d = 0, s = 0; const N = 3;
  for (let i = 0; i < N; i++) {
    let t = performance.now(); const b = await encoders[fmt](img, 80); e += performance.now() - t;
    t = performance.now(); const o = await decoders[fmt](b); d += performance.now() - t;
    t = performance.now(); ssimRgba(img, o); s += performance.now() - t;
  }
  const tot = e + d + s;
  console.log(`${fmt}: 인코딩 ${(e / N).toFixed(0)}ms(${(e / tot * 100).toFixed(0)}%) 디코딩 ${(d / N).toFixed(0)}ms(${(d / tot * 100).toFixed(0)}%) SSIM ${(s / N).toFixed(0)}ms(${(s / tot * 100).toFixed(0)}%)  [${p.w}×${p.h}]`);
}
