// 관문 기준 정하기: 밝기만으로 고른 품질(목표 0.95·0.97·0.985를 처음 넘는 q)에서 색 SSIM이 '목표 − 여유' 아래로 가는 비율.
// 사진(Kodak)에선 거의 안 걸리고, 색 시험 그림은 걸려야 한다.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { initCodecs, encoders, decoders, type Fmt } from './codecs-node.ts';
import { loadPng } from '../apps/web/test/load-png.ts';
import { ssimPlanes } from '../apps/web/src/core/ssim.ts';

await initCodecs();
const load = (p: string) => { const x = loadPng(p); return new ImageData(new Uint8ClampedArray(x.data), x.w, x.h); };
const TARGETS = [0.95, 0.97, 0.985], SLACKS = [0.02, 0.03, 0.05];
const QS = Array.from({ length: 19 }, (_, i) => 5 + i * 5);
const SETS = process.argv.includes('--kodak') ? [['Kodak', 'bench/data/kodak']] as const : process.argv.includes('--holdout2') ? [['두 번째 검증', 'bench/data/chroma-holdout2']] as const : process.argv.includes('--holdout') ? [['처음 보는 그림', 'bench/data/chroma-holdout']] as const : [['Kodak', 'bench/data/kodak'], ['색 시험', 'bench/data/chroma']] as const;
for (const [set, dir] of SETS) {
  const hits: Record<string, number> = {}; let n = 0;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.png')).sort()) {
    const img = load(join(dir, f));
    for (const fmt of ['jpg', 'webp', 'avif'] as Fmt[]) {
      const cache = new Map<number, { y: number; c: number; c5: number }>();
      const at = async (q: number) => { if (!cache.has(q)) { const p = ssimPlanes(img, await decoders[fmt](await encoders[fmt](img, q))); cache.set(q, { y: p.y, c: Math.min(p.cb, p.cr), c5: Math.min(p.cb5, p.cr5) }); } return cache.get(q)!; };
      for (const t of TARGETS) {
        let chosen: { y: number; c: number; c5: number } | null = null;
        for (const q of QS) { const r = await at(q); if (r.y >= t) { chosen = r; break; } }
        if (!chosen) continue;
        n++;
        for (const s of SLACKS) if (chosen.c < t - s) hits[`${t}/${s}`] = (hits[`${t}/${s}`] ?? 0) + 1;
        // v2(사진 데이터로만 정함): 색 < 0.92 또는 밝기−색 > 0.043. Kodak 바닥 0.938·최대 차이 0.032에 여유
        if (chosen.c < 0.92 || chosen.y - chosen.c > 0.043) hits.v2 = (hits.v2 ?? 0) + 1;
        // v3(사진 데이터로만): v2 또는 색 하위 5% < 0.74(Kodak 바닥 0.764에 여유)
        if (chosen.c5 < 0.74) hits.p5 = (hits.p5 ?? 0) + 1;
        if (chosen.c < 0.92 || chosen.y - chosen.c > 0.043 || chosen.c5 < 0.74) hits.v3 = (hits.v3 ?? 0) + 1;
        if (process.argv.includes('--detail')) console.log(`    ${f.padEnd(20)} ${fmt.padEnd(4)} 목표 ${t}  밝기 ${chosen.y.toFixed(4)}  색 ${chosen.c.toFixed(4)}  색 하위5% ${chosen.c5.toFixed(4)}`);
      }
    }
  }
  console.log(`${set}: ${n}개(그림×형식×목표)`);
  for (const s of SLACKS) console.log(`  여유 ${s}: 걸림 ${TARGETS.map(t => hits[`${t}/${s}`] ?? 0).reduce((a, b) => a + b, 0)}개`);
  console.log(`  v2(절대 0.92 + 차이 0.043): 걸림 ${hits.v2 ?? 0}개`);
  console.log(`  하위5% < 0.74 만: 걸림 ${hits.p5 ?? 0}개`);
  console.log(`  v3(v2 또는 하위5%): 걸림 ${hits.v3 ?? 0}개`);
}
