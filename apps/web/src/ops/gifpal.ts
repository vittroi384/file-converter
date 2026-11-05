// GIF용 256색 만들기(중앙값 분할, median cut). 직접 쓴 이유: gifenc의 quantize는 PnnQuant.js 포팅인데
// 원 코드 머리말이 mtPaint(GPL-3) 저작자를 적고 있고 이식 당시 원본 저장소에 라이선스 파일이 없어 출처가 불분명하다.
// 색은 15비트(채널당 5비트)로 묶어 센 뒤 나눈다 — 영상 한 장에 충분하고 빠르다.

const key = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const ch = (k: number, c: number) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);

export function palettize(rgba: Uint8Array | Uint8ClampedArray, maxColors = 256): { palette: number[][]; index: Uint8Array } {
  const hist = new Uint32Array(32768);
  for (let i = 0; i < rgba.length; i += 4) hist[key(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)]!++;
  const keys: number[] = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) keys.push(k);

  // 상자 = keys의 [lo, hi) 구간. 화소 수 × 가장 긴 변이 큰 상자부터 가장 긴 축의 가중 중앙값에서 자른다
  interface Box { lo: number; hi: number; n: number; axis: number; span: number }
  const measure = (lo: number, hi: number): Box => {
    const mn = [31, 31, 31], mx = [0, 0, 0];
    let n = 0;
    for (let i = lo; i < hi; i++) {
      const k = keys[i]!;
      n += hist[k]!;
      for (let c = 0; c < 3; c++) { const v = ch(k, c); if (v < mn[c]!) mn[c] = v; if (v > mx[c]!) mx[c] = v; }
    }
    const spans = [0, 1, 2].map(c => mx[c]! - mn[c]!);
    const axis = spans.indexOf(Math.max(...spans));
    return { lo, hi, n, axis, span: spans[axis]! };
  };
  const boxes: Box[] = [measure(0, keys.length)];
  while (boxes.length < maxColors) {
    let best = -1, score = 0;
    boxes.forEach((b, i) => { const s = b.span > 0 && b.hi - b.lo > 1 ? b.n * b.span : 0; if (s > score) { score = s; best = i; } });
    if (best < 0) break;
    const b = boxes[best]!;
    const part = keys.slice(b.lo, b.hi).sort((x, y) => ch(x, b.axis) - ch(y, b.axis));
    for (let i = 0; i < part.length; i++) keys[b.lo + i] = part[i]!;
    let acc = 0, cut = b.lo + 1;
    for (let i = b.lo; i < b.hi - 1; i++) { acc += hist[keys[i]!]!; if (acc * 2 >= b.n) { cut = i + 1; break; } }
    boxes.splice(best, 1, measure(b.lo, cut), measure(cut, b.hi));
  }
  const palette = boxes.map(b => {
    const s = [0, 0, 0];
    for (let i = b.lo; i < b.hi; i++) { const k = keys[i]!, w = hist[k]!; for (let c = 0; c < 3; c++) s[c]! += ((ch(k, c) << 3) | 4) * w; }
    return s.map(v => Math.round(v / b.n));
  });

  // 화소 → 가장 가까운 팔레트 색(15비트 값마다 한 번만 계산)
  const lut = new Int16Array(32768).fill(-1);
  const index = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const k = key(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    let j = lut[k]!;
    if (j < 0) {
      const r = (ch(k, 0) << 3) | 4, g = (ch(k, 1) << 3) | 4, bl = (ch(k, 2) << 3) | 4;
      let d = Infinity;
      for (let q = 0; q < palette.length; q++) {
        const c = palette[q]!, e = (c[0]! - r) ** 2 * 3 + (c[1]! - g) ** 2 * 4 + (c[2]! - bl) ** 2 * 2;
        if (e < d) { d = e; j = q; }
      }
      lut[k] = j;
    }
    index[p] = j;
  }
  return { palette, index };
}
