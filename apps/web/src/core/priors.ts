// 자동 생성: node bench/make-priors.ts (Kodak 22장 정답표 기준). 손으로 고치지 말 것.
// [목표 SSIM, 시작 품질, 찌르는 간격]. 기울기는 이웃 행에서 계산(search.ts v4 뉴턴 점프용)
const TABLE: Record<string, [number, number, number][]> = {"jpg":[[0.9,58,10],[0.93,76,5],[0.95,85,2],[0.96,89,2],[0.97,92,2],[0.98,96,1],[0.985,97,1],[0.99,98,1],[0.995,99,1]],"webp":[[0.9,35,9],[0.93,62,9],[0.95,78,6],[0.96,82,4],[0.97,86,4],[0.98,91,3],[0.985,93,2],[0.99,96,2],[0.995,100,1]],"avif":[[0.9,41,5],[0.93,51,3],[0.95,58,5],[0.96,65,6],[0.97,74,7],[0.98,81,5],[0.985,87,4],[0.99,90,4],[0.995,95,2]]};

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
