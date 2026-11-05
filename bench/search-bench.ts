// 탐색 알고리즘 비교: 정답표(bench/out/curves.json)를 evaluate로 써서 인코딩 없이 빠르게 비교.
// 지표: 평균 인코딩 횟수, 손해(찾은 용량 / 최적 용량 - 1), 놓침(최적이 있는데 못 찾음)
// 실행: node bench/search-bench.ts
import { readFileSync } from 'node:fs';
import { strategies, type Probe } from '../apps/web/src/core/search.ts';

const curves: Record<string, Record<string, number[][]>> = JSON.parse(readFileSync('bench/out/curves.json', 'utf8'));
const targets = [0.95, 0.97, 0.98, 0.99];
const fmts = ['jpg', 'webp', 'avif'];

// 정답표 자체의 성질: SSIM이 q에 대해 얼마나 단조인지(이분 탐색의 가정)
for (const fmt of fmts) {
  let drops = 0, total = 0, sizeDrops = 0;
  for (const img of Object.keys(curves)) {
    const rows = curves[img]![fmt];
    if (!rows) continue;
    for (let i = 1; i < rows.length; i++) {
      total++;
      if (rows[i]![2]! < rows[i - 1]![2]!) drops++;
      if (rows[i]![1]! < rows[i - 1]![1]!) sizeDrops++;
    }
  }
  if (total) console.log(`[${fmt}] q가 1 오를 때 SSIM이 떨어지는 비율 ${(100 * drops / total).toFixed(1)}%, 용량이 줄어드는 비율 ${(100 * sizeDrops / total).toFixed(1)}%`);
}

// 사진 하나를 뺀 나머지에서 (포맷, 목표)별 최적 품질의 중앙값·사분위 폭을 배운다(leave-one-out)
function optimalQ(img: string, fmt: string, target: number) {
  const rows = curves[img]![fmt]!;
  const ok = rows.filter(r => r[2]! >= target).sort((a, b) => a[1]! - b[1]!)[0];
  return ok ? ok[0]! : 100;
}
function prior(exclude: string, fmt: string, target: number) {
  const qs = Object.keys(curves).filter(i => i !== exclude && curves[i]![fmt]?.length === 100).map(i => optimalQ(i, fmt, target)).sort((a, b) => a - b);
  const at = (p: number) => qs[Math.min(qs.length - 1, Math.floor(p * qs.length))]!;
  return { guess: at(0.5), step: Math.max(1, Math.round((at(0.75) - at(0.25)) / 2)) };
}
// v4용 기울기: 목표 ±0.01에서의 중앙 품질 차이 / f(SSIM) 차이 (역시 leave-one-out)
const fLog = (s: number) => -Math.log(Math.max(1e-6, 1 - s));
function slope(exclude: string, fmt: string, target: number) {
  const lo = Math.max(0.8, target - 0.01), hi = Math.min(0.999, target + 0.01);
  return (prior(exclude, fmt, hi).guess - prior(exclude, fmt, lo).guess) / (fLog(hi) - fLog(lo));
}
type Run = (ev: (q: number) => Promise<Probe>, img: string, fmt: string, target: number) => Promise<{ best: Probe | null; probes: Probe[] }>;
const runs: Record<string, Run> = {
  binary: (ev, _i, _f, target) => strategies.binary(ev, { target }),
  interpLog: (ev, _i, _f, target) => strategies.interpLog(ev, { target }),
};
runs['v4 newton'] = (ev, img, fmt, target) => strategies.interpLog(ev, { target, ...prior(img, fmt, target), slope: slope(img, fmt, target), strictStall: true });
runs['v5 newton+stall'] = (ev, img, fmt, target) => strategies.interpLog(ev, { target, ...prior(img, fmt, target), slope: slope(img, fmt, target) });
for (const tol of [1, 2, 3, 4]) runs[`guided tol${tol}`] = (ev, img, fmt, target) => strategies.interpLog(ev, { target, tol, ...prior(img, fmt, target) });

const header = ['전략', '포맷', '목표', '평균 인코딩', '평균 손해%', '최대 손해%', '놓침'];
const table: (string | number)[][] = [];
for (const [name, search] of Object.entries(runs)) {
  for (const fmt of fmts) {
    for (const target of targets) {
      let evals = 0, regretSum = 0, regretMax = 0, miss = 0, n = 0;
      for (const img of Object.keys(curves)) {
        const rows = curves[img]![fmt];
        if (rows?.length !== 100) continue;
        const table = new Map(rows.map(r => [r[0]!, { q: r[0]!, bytes: r[1]!, ssim: r[2]! } as Probe]));
        const optimal = [...table.values()].filter(p => p.ssim >= target).sort((a, b) => a.bytes - b.bytes)[0];
        const r = await search(async q => table.get(q)!, img, fmt, target);
        n++;
        evals += r.probes.length;
        if (optimal && !r.best) miss++;
        if (optimal && r.best) {
          const reg = r.best.bytes / optimal.bytes - 1;
          regretSum += reg;
          regretMax = Math.max(regretMax, reg);
        }
      }
      if (n) table.push([name, fmt, target, (evals / n).toFixed(1), (100 * regretSum / n).toFixed(2), (100 * regretMax).toFixed(1), miss]);
    }
  }
}
console.log(header.join('\t'));
for (const r of table) console.log(r.join('\t'));
