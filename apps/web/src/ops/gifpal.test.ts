import { describe, it, expect } from 'vitest';
import { palettize } from './gifpal.ts';

function img(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y), i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  return d;
}

describe('palettize (중앙값 분할)', () => {
  it('두 색 그림은 두 색 그대로', () => {
    const d = img(20, 10, x => (x < 10 ? [200, 40, 40] : [40, 70, 200]));
    const { palette, index } = palettize(d);
    expect(palette.length).toBe(2);
    for (const i of [0, 199]) { const c = palette[index[i]!]!; expect(Math.abs(c[0]! - d[i * 4]!)).toBeLessThanOrEqual(4); expect(Math.abs(c[2]! - d[i * 4 + 2]!)).toBeLessThanOrEqual(4); }
  });
  it('색 많은 그림: 256색 이하, 평균 오차 작음', () => {
    const d = img(256, 128, (x, y) => [x, y * 2, (x + y) & 255]);
    const { palette, index } = palettize(d);
    expect(palette.length).toBeLessThanOrEqual(256);
    expect(palette.length).toBeGreaterThan(200);
    let err = 0;
    for (let p = 0; p < index.length; p++) { const c = palette[index[p]!]!; for (let k = 0; k < 3; k++) err += Math.abs(c[k]! - d[p * 4 + k]!); }
    expect(err / index.length / 3).toBeLessThan(10);
  });
});
