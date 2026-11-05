// 색 번짐 측정: 밝기 SSIM만 보는 지금 방식이 '목표 통과'라고 한 품질에서 색 채널 SSIM은 얼마인가.
// - 색 시험 그림 3장(bench/data/chroma) + Kodak 22장
// - 형식 3종 × 품질 여러 개에서 Y·Cb·Cr SSIM
// 실행: node bench/chroma-eval.ts
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { initCodecs, encoders, decoders, type Fmt } from './codecs-node.ts';
import { loadPng } from '../apps/web/test/load-png.ts';
import { ssimPlanes } from '../apps/web/src/core/ssim.ts';

await initCodecs();
const sets = [
  { name: 'chroma', dir: 'bench/data/chroma' },
  { name: 'kodak', dir: 'bench/data/kodak' },
];
const QS = [40, 60, 75, 85, 92];
const rows: { set: string; file: string; fmt: Fmt; q: number; bytes: number; y: number; cb: number; cr: number }[] = [];
for (const s of sets) {
  for (const f of readdirSync(s.dir).filter(f => f.endsWith('.png')).sort()) {
    // loadPng는 {w, h, data}를 준다(처음엔 width로 알고 넘겨 인코더가 빈 JPEG를 냈다)
    const p0 = loadPng(join(s.dir, f));
    const img = new ImageData(new Uint8ClampedArray(p0.data), p0.w, p0.h);
    for (const fmt of ['jpg', 'webp', 'avif'] as Fmt[]) {
      for (const q of QS) {
        const buf = await encoders[fmt](img, q);
        const p = ssimPlanes(img, await decoders[fmt](buf));
        rows.push({ set: s.name, file: f, fmt, q, bytes: buf.byteLength, ...p });
      }
    }
  }
}
mkdirSync('bench/out', { recursive: true });
writeFileSync('bench/out/chroma.json', JSON.stringify(rows));

// 요약 1: 사진(Kodak)에서 색 SSIM이 밝기보다 낮은 경우가 얼마나 되나(낮으면 min을 쓰면 사진 압축이 보수적으로 바뀐다)
const k = rows.filter(r => r.set === 'kodak');
const chromaMin = (r: typeof rows[number]) => Math.min(r.cb, r.cr);
console.log(`Kodak ${k.length}개 중 색 SSIM < 밝기 SSIM: ${k.filter(r => chromaMin(r) < r.y).length}개`);
for (const fmt of ['jpg', 'webp', 'avif'] as Fmt[]) {
  const d = k.filter(r => r.fmt === fmt).map(r => chromaMin(r) - r.y);
  console.log(`  ${fmt}: 색−밝기 최소 ${Math.min(...d).toFixed(4)} 중앙 ${d.sort((a, b) => a - b)[d.length >> 1]!.toFixed(4)}`);
}
// 요약 2: 색 시험 그림에서 밝기 SSIM ≥ 0.97(지금 '균형' 목표 통과)인데 색 SSIM이 낮은 경우
console.log('\n색 시험 그림: 밝기 ≥ 0.97 통과한 칸의 색 SSIM');
for (const r of rows.filter(r => r.set === 'chroma' && r.y >= 0.97)) {
  console.log(`  ${r.file.padEnd(24)} ${r.fmt.padEnd(4)} q${String(r.q).padEnd(3)} Y ${r.y.toFixed(4)}  Cb ${r.cb.toFixed(4)}  Cr ${r.cr.toFixed(4)}${chromaMin(r) < 0.95 ? '  ← 색 번짐' : ''}`);
}
