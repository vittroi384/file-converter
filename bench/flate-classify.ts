// Flate 사진 판별: 폴더별 특징값과 판정. 실행: node bench/flate-classify.ts <폴더>/{photo,graphic,...} 상위 폴더 [--full]
// 예) node bench/flate-classify.ts bench/data/pdf-flate/calib
// --full: 판별 뒤 실제 변환 경로(recompressFlate: JPEG 품질 70부터, SSIM ≥ 0.97, 10% 이상 감소)까지 돌려 '바뀜' 여부와 크기를 본다.
//         Flate 크기는 RGB 화소를 zlib(기본 수준)으로 눌러서(pdf-lib embedPng와 같은 방식).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { zlibSync } from 'fflate';
import { loadPng } from '../apps/web/test/load-png.ts';
import { photoFeatures, isPhoto } from '../apps/web/src/ops/photo-detect.ts';

const root = process.argv[2] ?? 'bench/data/pdf-flate/calib';
const full = process.argv.includes('--full');
const { recompressFlate } = full ? await import('../apps/web/src/ops/flate.ts') : ({} as typeof import('../apps/web/src/ops/flate.ts'));
if (full) await (await import('./codecs-node.ts')).initCodecs();
const cm: Record<string, { photo: number; skip: number; converted: number; flateKB: number; afterKB: number }> = {};
for (const label of readdirSync(root).filter(d => statSync(join(root, d)).isDirectory()).sort()) {
  const c = cm[label] = { photo: 0, skip: 0, converted: 0, flateKB: 0, afterKB: 0 };
  for (const f of readdirSync(join(root, label)).filter(f => f.endsWith('.png')).sort()) {
    const x = loadPng(join(root, label, f));
    const img = { width: x.w, height: x.h, data: x.data };
    const t = performance.now();
    const ft = photoFeatures(img);
    const ms = performance.now() - t;
    const yes = isPhoto(img);
    c[yes ? 'photo' : 'skip']++;
    const cols = [label.padEnd(8), f.padEnd(34), `eq ${ft.eq.toFixed(3)}`, `hard ${ft.hard.toFixed(4)}`, `top ${ft.top.toFixed(3)}`, yes ? 'PHOTO' : 'skip ', `${ms.toFixed(1)}ms`];
    if (full) {
      const rgb = new Uint8Array(x.w * x.h * 3);
      for (let i = 0; i < x.w * x.h; i++) { rgb[i * 3] = x.data[i * 4]!; rgb[i * 3 + 1] = x.data[i * 4 + 1]!; rgb[i * 3 + 2] = x.data[i * 4 + 2]!; }
      const z = zlibSync(rgb);
      const r = yes ? await recompressFlate(z, { width: x.w, height: x.h, colors: 3, bpc: 8, predictor: 1 }, 70, 10000) : null;
      c.flateKB += z.length / 1024; c.afterKB += (r ? r.buf.byteLength : z.length) / 1024;
      if (r) c.converted++;
      cols.push(`flate ${(z.length / 1024).toFixed(0)}KB`, r ? `→ JPEG q${r.quality} ${(r.buf.byteLength / 1024).toFixed(0)}KB ssim ${r.ssim.toFixed(3)}` : yes ? '→ 그대로(SSIM·크기 관문)' : '');
    }
    console.log(cols.join('  '));
  }
}
for (const c of Object.values(cm)) { c.flateKB = Math.round(c.flateKB); c.afterKB = Math.round(c.afterKB); }
console.log('\n판정 결과', cm);
