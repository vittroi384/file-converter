// 정답표: 사진마다 품질 1~100 전부 인코딩 → [품질, 바이트, SSIM]
// 실행: node bench/curves.ts [포맷들, 기본 jpg,webp,avif]
import { readdirSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { initCodecs, encoders, decoders, type Fmt } from './codecs-node.ts';
import { loadPng } from '../apps/web/test/load-png.ts';
import { toGray, ssimFast } from '../apps/web/src/core/ssim.ts';

const fmts = (process.argv[2] ?? 'jpg,webp,avif').split(',') as Fmt[];
const dir = 'bench/data/kodak/';
mkdirSync('bench/out', { recursive: true });
const outPath = 'bench/out/curves.json';
const curves: Record<string, Record<string, number[][]>> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
await initCodecs();
const files = readdirSync(dir).filter(f => f.endsWith('.png')).sort();
const t0 = performance.now();
for (const fmt of fmts) {
  let encMs = 0, ssimMs = 0, n = 0;
  for (const f of files) {
    if (curves[f]?.[fmt]?.length === 100) continue;
    const p = loadPng(dir + f);
    const img = new ImageData(p.data, p.w, p.h);
    const g0 = toGray(p.data, p.w, p.h);
    const rows: number[][] = [];
    for (let q = 1; q <= 100; q++) {
      const a = performance.now();
      const buf = await encoders[fmt](img, q);
      const b = performance.now();
      const d = await decoders[fmt](buf);
      const s = ssimFast(g0, toGray(d.data, d.width, d.height));
      ssimMs += performance.now() - b; encMs += b - a; n++;
      rows.push([q, buf.byteLength, +s.toFixed(6)]);
    }
    (curves[f] ??= {})[fmt] = rows;
    writeFileSync(outPath, JSON.stringify(curves));
    console.log(fmt, f, `${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
  if (n) console.log(`${fmt}: 인코딩 평균 ${(encMs / n).toFixed(1)}ms, 디코딩+SSIM 평균 ${(ssimMs / n).toFixed(1)}ms (${n}회)`);
}
