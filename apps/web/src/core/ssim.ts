// SSIM(구조적 유사도). 1에 가까울수록 원본과 같다.
// ssimReference: Wang et al. 2004 그대로(11x11 가우시안, σ=1.5). 느리지만 기준값.

export interface Gray {
  w: number;
  h: number;
  data: Float32Array;
}

// RGBA → 밝기(BT.601). 알파는 흰 배경에 합성한 것으로 본다.
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const n = w * h;
  const data = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = rgba[j + 3]! / 255;
    const bg = 255 * (1 - a);
    data[i] = 0.299 * (rgba[j]! * a + bg) + 0.587 * (rgba[j + 1]! * a + bg) + 0.114 * (rgba[j + 2]! * a + bg);
  }
  return { w, h, data };
}

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

function gaussianKernel(size: number, sigma: number) {
  const k = new Float32Array(size);
  const r = (size - 1) / 2;
  let sum = 0;
  for (let i = 0; i < size; i++) { k[i] = Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)); sum += k[i]!; }
  for (let i = 0; i < size; i++) k[i]! /= sum;
  return k;
}

// 분리 가능한 가우시안 블러(가장자리는 끝 값 반복)
function blur(src: Float32Array, w: number, h: number, k: Float32Array, tmp: Float32Array, out: Float32Array) {
  const r = (k.length - 1) / 2;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        s += src[row + xx]! * k[i + r]!;
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        s += tmp[yy * w + x]! * k[i + r]!;
      }
      out[y * w + x] = s;
    }
  }
}

// v2: 계산식은 ssimReference와 같고, 순서만 바꿔 메모리 왕복을 줄였다.
// - 테두리는 어차피 평균에서 빠지므로 안쪽만 계산 → 경계 검사 없음
// - x², y², xy 배열을 따로 만들지 않고 가로 블러하면서 곱한다
// - 세로 블러는 한 줄 누적 버퍼에 더한 뒤 그 줄의 SSIM을 바로 합산(결과 배열 저장 안 함)
export function ssimFast(a: Gray, b: Gray): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error('크기가 다름');
  if (a.w <= 20 || a.h <= 20) return ssimReference(a, b);
  return ssimRows(a.w, a.h, (y, out) => out.set(a.data.subarray(y * a.w, (y + 1) * a.w)), (y, out) => out.set(b.data.subarray(y * b.w, (y + 1) * b.w)));
}

// 밝기 배열을 따로 만들지 않고 RGBA에서 줄마다 바로 계산(5000만 화소면 밝기 배열 2장 = 400MB를 아낀다, devlog 12절)
export function ssimRgba(a: { width: number; height: number; data: ArrayLike<number> }, b: { width: number; height: number; data: ArrayLike<number> }): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('크기가 다름');
  const { width: w, height: h } = a;
  if (w <= 20 || h <= 20) return ssimReference(toGray(a.data as Uint8ClampedArray, w, h), toGray(b.data as Uint8ClampedArray, w, h));
  const luma = (d: ArrayLike<number>) => (y: number, out: Float32Array) => {
    for (let x = 0, j = y * w * 4; x < w; x++, j += 4) {
      const al = d[j + 3]! / 255, bg = 255 * (1 - al);
      out[x] = 0.299 * (d[j]! * al + bg) + 0.587 * (d[j + 1]! * al + bg) + 0.114 * (d[j + 2]! * al + bg);
    }
  };
  return ssimRows(w, h, luma(a.data), luma(b.data));
}

// 채널별 SSIM(BT.601 YCbCr, 투명은 흰 바탕 합성). 밝기만 보면 4:2:0 색 번짐(빨간 글씨 주변 등)을 놓친다(devlog 23절).
// 히스토그램에서 하위 p 백분위 값
function percentile(hist: Uint32Array, p: number): number {
  let n = 0; for (const c of hist) n += c;
  let acc = 0; const want = n * p;
  for (let i = 0; i < hist.length; i++) { acc += hist[i]!; if (acc >= want) return i / 500 - 1; }
  return 1;
}

// 색 번짐은 글자 가장자리처럼 좁은 곳에만 생겨 평균에 묻힌다 → 색은 '가장 나쁜 5% 구역'(하위 5% 백분위)도 함께 낸다(devlog 23절)
export function ssimPlanes(a: { width: number; height: number; data: ArrayLike<number> }, b: { width: number; height: number; data: ArrayLike<number> }): { y: number; cb: number; cr: number; cb5: number; cr5: number } {
  if (a.width !== b.width || a.height !== b.height) throw new Error('크기가 다름');
  const { width: w, height: h } = a;
  const plane = (d: ArrayLike<number>, c: 0 | 1 | 2) => (row: number, out: Float32Array) => {
    for (let x = 0, j = row * w * 4; x < w; x++, j += 4) {
      const al = d[j + 3]! / 255, bg = 255 * (1 - al);
      const r = d[j]! * al + bg, g = d[j + 1]! * al + bg, bl = d[j + 2]! * al + bg;
      out[x] = c === 0 ? 0.299 * r + 0.587 * g + 0.114 * bl
        : c === 1 ? 128 - 0.168736 * r - 0.331264 * g + 0.5 * bl
        : 128 + 0.5 * r - 0.418688 * g - 0.081312 * bl;
    }
  };
  if (w <= 20 || h <= 20) {
    const gray = (d: ArrayLike<number>, c: 0 | 1 | 2) => { const out = new Float32Array(w * h), row = new Float32Array(w); for (let y = 0; y < h; y++) { plane(d, c)(y, row); out.set(row, y * w); } return { w, h, data: out }; };
    const cb = ssimReference(gray(a.data, 1), gray(b.data, 1)), cr = ssimReference(gray(a.data, 2), gray(b.data, 2));
    return { y: ssimReference(gray(a.data, 0), gray(b.data, 0)), cb, cr, cb5: cb, cr5: cr }; // 아주 작은 그림은 평균으로 대신
  }
  const hb = new Uint32Array(1000), hr = new Uint32Array(1000);
  const cb = ssimRows(w, h, plane(a.data, 1), plane(b.data, 1), hb), cr = ssimRows(w, h, plane(a.data, 2), plane(b.data, 2), hr);
  return { y: ssimRows(w, h, plane(a.data, 0), plane(b.data, 0)), cb, cr, cb5: percentile(hb, 0.05), cr5: percentile(hr, 0.05) };
}

// 공통 계산부: 한 줄의 밝기를 어디서 가져오는지만 바꿔 끼운다(계산식을 두 벌 두지 않으려고)
// hist: 주면 창마다 값을 1000칸 히스토그램([-1, 1])에 더한다(백분위용, 값 배열을 통째로 들지 않으려고)
function ssimRows(w: number, h: number, rowA: (y: number, out: Float32Array) => void, rowB: (y: number, out: Float32Array) => void, hist?: Uint32Array): number {
  const R = 5, K = gaussianKernel(11, 1.5);
  const iw = w - 2 * R; // 안쪽 열 수
  const X = new Float32Array(w), Y = new Float32Array(w);
  // v3: 가로 블러 결과를 이미지 전체(1200만 화소면 240MB) 대신 11줄 고리 버퍼(약 1MB)에만 둔다
  const RING = 11;
  const hx = new Float32Array(RING * iw), hy = new Float32Array(RING * iw);
  const hxx = new Float32Array(RING * iw), hyy = new Float32Array(RING * iw), hxy = new Float32Array(RING * iw);
  const hrow = (y: number) => {
    rowA(y, X); rowB(y, Y);
    const dst = (y % RING) * iw;
    for (let x = 0; x < iw; x++) {
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      const base = x;
      for (let i = 0; i < 11; i++) {
        const k = K[i]!, p = X[base + i]!, q = Y[base + i]!;
        sx += k * p; sy += k * q; sxx += k * p * p; syy += k * q * q; sxy += k * p * q;
      }
      const o = dst + x;
      hx[o] = sx; hy[o] = sy; hxx[o] = sxx; hyy[o] = syy; hxy[o] = sxy;
    }
  };
  const ax = new Float32Array(iw), ay = new Float32Array(iw), axx = new Float32Array(iw), ayy = new Float32Array(iw), axy = new Float32Array(iw);
  let total = 0;
  for (let y = 0; y < 2 * R; y++) hrow(y);
  for (let y = R; y < h - R; y++) {
    hrow(y + R);
    ax.fill(0); ay.fill(0); axx.fill(0); ayy.fill(0); axy.fill(0);
    for (let i = 0; i < 11; i++) {
      const k = K[i]!, row = ((y - R + i) % RING) * iw;
      for (let x = 0; x < iw; x++) {
        const o = row + x;
        ax[x]! += k * hx[o]!; ay[x]! += k * hy[o]!; axx[x]! += k * hxx[o]!; ayy[x]! += k * hyy[o]!; axy[x]! += k * hxy[o]!;
      }
    }
    for (let x = 0; x < iw; x++) {
      const ux = ax[x]!, uy = ay[x]!;
      const vx = axx[x]! - ux * ux, vy = ayy[x]! - uy * uy, cxy = axy[x]! - ux * uy;
      const v = ((2 * ux * uy + C1) * (2 * cxy + C2)) / ((ux * ux + uy * uy + C1) * (vx + vy + C2));
      total += v;
      if (hist) hist[Math.min(999, Math.max(0, Math.floor((v + 1) * 500)))]!++;
    }
  }
  return total / (iw * (h - 2 * R));
}

export function ssimReference(a: Gray, b: Gray): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error('크기가 다름');
  const { w, h } = a;
  const n = w * h;
  const k = gaussianKernel(11, 1.5);
  const tmp = new Float32Array(n);
  const xx = new Float32Array(n), yy = new Float32Array(n), xy = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = a.data[i]!, y = b.data[i]!; xx[i] = x * x; yy[i] = y * y; xy[i] = x * y; }
  const mx = new Float32Array(n), my = new Float32Array(n), sxx = new Float32Array(n), syy = new Float32Array(n), sxy = new Float32Array(n);
  blur(a.data, w, h, k, tmp, mx);
  blur(b.data, w, h, k, tmp, my);
  blur(xx, w, h, k, tmp, sxx);
  blur(yy, w, h, k, tmp, syy);
  blur(xy, w, h, k, tmp, sxy);
  // 창이 이미지 밖으로 나가는 테두리(반지름 5)는 평균에서 뺀다(scikit-image와 같은 방식)
  const pad = w > 20 && h > 20 ? 5 : 0;
  let total = 0, count = 0;
  for (let y = pad; y < h - pad; y++) {
    for (let x = pad; x < w - pad; x++) {
      const i = y * w + x;
      const ux = mx[i]!, uy = my[i]!;
      const vx = sxx[i]! - ux * ux, vy = syy[i]! - uy * uy, cxy = sxy[i]! - ux * uy;
      total += ((2 * ux * uy + C1) * (2 * cxy + C2)) / ((ux * ux + uy * uy + C1) * (vx + vy + C2));
      count++;
    }
  }
  return total / count;
}
