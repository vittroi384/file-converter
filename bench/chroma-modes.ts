// 색 보존 방식 비교: 기본(4:2:0) vs JPEG·AVIF 4:4:4, WebP sharp_yuv. 색 SSIM 회복과 용량 증가.
// 실행: node bench/chroma-modes.ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { initCodecs, encodeWith, decoders, type Fmt } from './codecs-node.ts';
import { loadPng } from '../apps/web/test/load-png.ts';
import { ssimPlanes } from '../apps/web/src/core/ssim.ts';

await initCodecs();
const MODES: Record<Fmt, Record<string, unknown>> = {
  jpg: { auto_subsample: false, chroma_subsample: 1 },
  webp: { use_sharp_yuv: 1 },
  avif: { subsample: 3 },
};
const load = (p: string) => { const x = loadPng(p); return new ImageData(new Uint8ClampedArray(x.data), x.w, x.h); };
for (const [set, dir] of [['색 시험', 'bench/data/chroma'], ['Kodak', 'bench/data/kodak']] as const) {
  const files = readdirSync(dir).filter(f => f.endsWith('.png')).sort();
  for (const fmt of ['jpg', 'webp', 'avif'] as Fmt[]) {
    let sumC0 = 0, sumC1 = 0, sumY0 = 0, sumY1 = 0, sumB0 = 0, sumB1 = 0, worst0 = 1, worst1 = 1, n = 0;
    for (const f of files) {
      const img = load(join(dir, f));
      const q = 75;
      const b0 = await encodeWith(fmt, img, q, {}), b1 = await encodeWith(fmt, img, q, MODES[fmt]);
      const p0 = ssimPlanes(img, await decoders[fmt](b0)), p1 = ssimPlanes(img, await decoders[fmt](b1));
      const c0 = Math.min(p0.cb, p0.cr), c1 = Math.min(p1.cb, p1.cr);
      sumC0 += c0; sumC1 += c1; sumY0 += p0.y; sumY1 += p1.y; sumB0 += b0.byteLength; sumB1 += b1.byteLength; worst0 = Math.min(worst0, c0); worst1 = Math.min(worst1, c1); n++;
    }
    console.log(`${set.padEnd(5)} ${fmt.padEnd(4)} q75  색SSIM 평균 ${(sumC0 / n).toFixed(4)} → ${(sumC1 / n).toFixed(4)}  최저 ${worst0.toFixed(4)} → ${worst1.toFixed(4)}  밝기 ${(sumY0 / n).toFixed(4)} → ${(sumY1 / n).toFixed(4)}  용량 ${((sumB1 / sumB0 - 1) * 100).toFixed(1)}%`);
  }
}
