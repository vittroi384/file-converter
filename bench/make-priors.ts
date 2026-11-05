// 정답표 → src/core/priors.ts (목표 SSIM별 시작 품질 중앙값, 찌르는 간격 = 사분위 폭의 절반, 기울기 = 이웃 목표 사이 품질 변화 / f(SSIM) 변화)
// 실행: node bench/make-priors.ts
import { readFileSync, writeFileSync } from 'node:fs';
const curves: Record<string, Record<string, number[][]>> = JSON.parse(readFileSync('bench/out/curves.json', 'utf8'));
const targets = [0.9, 0.93, 0.95, 0.96, 0.97, 0.98, 0.985, 0.99, 0.995];
const out: Record<string, [number, number, number][]> = {};
for (const fmt of ['jpg', 'webp', 'avif']) {
  const imgs = Object.keys(curves).filter(i => curves[i]![fmt]?.length === 100);
  if (!imgs.length) continue;
  out[fmt] = targets.map(t => {
    const qs = imgs.map(i => {
      const ok = curves[i]![fmt]!.filter(r => r[2]! >= t).sort((a, b) => a[1]! - b[1]!)[0];
      return ok ? ok[0]! : 100;
    }).sort((a, b) => a - b);
    const at = (p: number) => qs[Math.min(qs.length - 1, Math.floor(p * qs.length))]!;
    return [t, at(0.5), Math.max(1, Math.round((at(0.75) - at(0.25)) / 2))];
  });
  console.log(fmt, imgs.length + '장', JSON.stringify(out[fmt]));
}
writeFileSync('apps/web/src/core/priors.ts', `// 자동 생성: node bench/make-priors.ts (Kodak ${Object.keys(curves).length}장 정답표 기준). 손으로 고치지 말 것.
// [목표 SSIM, 시작 품질, 찌르는 간격]. 기울기는 이웃 행에서 계산(search.ts v4 뉴턴 점프용)
const TABLE: Record<string, [number, number, number][]> = ${JSON.stringify(out)};

const f = (s: number) => -Math.log(Math.max(1e-6, 1 - s));

export function priorFor(fmt: string, target: number): { guess?: number; step?: number; slope?: number } {
  const rows = TABLE[fmt];
  if (!rows || rows.length < 2) return {};
  let i = rows.findIndex(r => target <= r[0]);
  if (i <= 0) i = i === 0 ? 1 : rows.length - 1;
  const [t1, q1, s1] = rows[i]!, [t0, q0, s0] = rows[i - 1]!;
  const k = Math.min(1, Math.max(0, (target - t0) / (t1 - t0)));
  const slope = (q1 - q0) / (f(t1) - f(t0));
  return { guess: Math.round(q0 + k * (q1 - q0)), step: Math.max(1, Math.round(s0 + k * (s1 - s0))), slope: slope > 0 ? slope : undefined };
}
`);
