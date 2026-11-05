// 큰 사진의 스마트 압축용 '대표 조각 모자이크'. 원본 해상도 그대로(축소하면 압축 손상이 다르게 보인다) 디테일 많은 조각을 모은다.
// 품질은 모자이크로 찾고 원본 전체는 한 번만 인코딩한다(devlog 12절).

export interface Rgba { width: number; height: number; data: Uint8ClampedArray }

// 칸마다 밝기 변화량(가로·세로 차이 합)을 디테일 점수로
function detail(img: Rgba, x0: number, y0: number, s: number): number {
  const { width: w, data: d } = img;
  let sum = 0;
  for (let y = y0; y < y0 + s - 1; y += 2) {
    for (let x = x0; x < x0 + s - 1; x += 2) {
      const i = (y * w + x) * 4;
      const l = d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
      const r = d[i + 4]! * 0.299 + d[i + 5]! * 0.587 + d[i + 6]! * 0.114;
      const b = d[i + w * 4]! * 0.299 + d[i + w * 4 + 1]! * 0.587 + d[i + w * 4 + 2]! * 0.114;
      sum += Math.abs(l - r) + Math.abs(l - b);
    }
  }
  return sum;
}

// v1: 칸마다 디테일 최고 조각 → WebP·AVIF는 원본 SSIM 미달, JPG는 과하게 높은 품질(devlog 12절).
//   SSIM은 밋밋한 곳의 작은 변화에 민감한데 디테일 조각만 보면 그걸 놓친다.
// v2: 전체를 격자로 나눠 디테일 점수 순으로 줄 세운 뒤, 밋밋한 곳부터 복잡한 곳까지 고르게(분위수) n개를 뽑는다.
export function buildMosaic(img: Rgba, opts: { tile?: number; count?: number; cols?: number } = {}): Rgba | null {
  const s = opts.tile ?? 384, n = opts.count ?? 12, cols = opts.cols ?? 4;
  const gx = Math.floor(img.width / s), gy = Math.floor(img.height / s);
  if (gx * gy < n * 2) return null; // 작은 사진은 전체로 하는 게 낫다
  const cells: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) cells.push({ x: x * s, y: y * s, d: detail(img, x * s, y * s, s) });
  cells.sort((a, b) => a.d - b.d);
  const picked = Array.from({ length: n }, (_, i) => cells[Math.floor(((i + 0.5) / n) * cells.length)]!);
  const rows = Math.ceil(n / cols), W = s * cols;
  const out = new Uint8ClampedArray(W * s * rows * 4);
  picked.forEach((c, i) => {
    const ox = (i % cols) * s, oy = Math.floor(i / cols) * s;
    for (let y = 0; y < s; y++) {
      const src = ((c.y + y) * img.width + c.x) * 4;
      out.set(img.data.subarray(src, src + s * 4), ((oy + y) * W + ox) * 4);
    }
  });
  return { width: W, height: s * rows, data: out };
}
