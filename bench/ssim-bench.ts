// SSIM 속도 측정: node --experimental-strip-types 없이 Node 24 기본 타입 제거로 실행
// 실행: node bench/ssim-bench.ts [폭] [높이]
import * as S from '../apps/web/src/core/ssim.ts';

const w = Number(process.argv[2] ?? 4000), h = Number(process.argv[3] ?? 3000);
function img(seed: number) {
  const d = new Float32Array(w * h);
  let s = seed;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[y * w + x] = 128 + 60 * Math.sin(x / 37) * Math.cos(y / 29) + (s % 40) - 20;
  }
  return { w, h, data: d };
}
const a = img(1), b = img(2);
const fns = Object.entries(S).filter(([k, f]) => k.startsWith('ssim') && typeof f === 'function') as [string, (a: S.Gray, b: S.Gray) => number][];
for (const [name, f] of fns) {
  f(a, b); // 예열
  const runs = 3, t0 = performance.now();
  let v = 0;
  for (let i = 0; i < runs; i++) v = f(a, b);
  console.log(`${name}: ${((performance.now() - t0) / runs).toFixed(0)} ms, ssim=${v.toFixed(6)} (${w}x${h})`);
}
