import { describe, it, expect } from 'vitest';
import { zlibSync } from 'fflate';
import { PNG } from 'pngjs';
import { decodeFlateImage, unpredictPng, type FlateParams } from './flate.ts';
import { pluginById } from '../core/plugins.ts';

// 결정적인 가짜 화소(잡음 + 경사): 예측 필터 5종이 모두 의미 있게 일한다
function pixels(w: number, h: number, colors: number) {
  const a = new Uint8Array(w * h * colors);
  let s = 7;
  for (let i = 0; i < a.length; i++) { s = (s * 1103515245 + 12345) >>> 0; a[i] = ((i % (w * colors)) + (s >>> 24) % 9) & 255; }
  return a;
}
const rgba = (raw: Uint8Array, colors: number) => {
  const n = raw.length / colors, out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) out[i * 4 + c] = raw[i * colors + (colors === 3 ? c : 0)]!; out[i * 4 + 3] = 255; }
  return out;
};

// PNG 예측 필터(정답 쪽 구현은 명세대로 따로): 줄마다 필터 종류를 돌려 가며
function predict(raw: Uint8Array, rowBytes: number, bpp: number, rows: number) {
  const out = new Uint8Array((rowBytes + 1) * rows);
  for (let y = 0; y < rows; y++) {
    const f = y % 5;
    out[y * (rowBytes + 1)] = f;
    for (let x = 0; x < rowBytes; x++) {
      const cur = raw[y * rowBytes + x]!;
      const a = x >= bpp ? raw[y * rowBytes + x - bpp]! : 0, b = y ? raw[(y - 1) * rowBytes + x]! : 0, c = y && x >= bpp ? raw[(y - 1) * rowBytes + x - bpp]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      out[y * (rowBytes + 1) + 1 + x] = (cur - pred) & 255;
    }
  }
  return out;
}

const base = (w: number, h: number, colors: 1 | 3): FlateParams => ({ width: w, height: h, colors, bpc: 8, predictor: 1 });

describe('Flate 사진 풀기', () => {
  it('예측 없음: RGB·회색', () => {
    for (const colors of [3, 1] as const) {
      const raw = pixels(37, 11, colors);
      const px = decodeFlateImage(zlibSync(raw), base(37, 11, colors))!;
      expect(px.width).toBe(37);
      expect(Array.from(px.data)).toEqual(Array.from(rgba(raw, colors)));
    }
  });
  it('PNG 예측(필터 0~4 전부): RGB·회색', () => {
    for (const colors of [3, 1] as const) {
      const w = 23, h = 15, raw = pixels(w, h, colors);
      const p = { ...base(w, h, colors), predictor: 15, dpColors: colors, columns: w };
      const px = decodeFlateImage(zlibSync(predict(raw, w * colors, colors, h)), p)!;
      expect(Array.from(px.data)).toEqual(Array.from(rgba(raw, colors)));
    }
  });
  it('진짜 PNG의 IDAT(pngjs가 고른 필터) = PDF의 Predictor 15', () => {
    const w = 64, h = 40;
    const png = new PNG({ width: w, height: h });
    const raw = pixels(w, h, 3);
    for (let i = 0; i < w * h; i++) { png.data[i * 4] = raw[i * 3]!; png.data[i * 4 + 1] = raw[i * 3 + 1]!; png.data[i * 4 + 2] = raw[i * 3 + 2]!; png.data[i * 4 + 3] = 255; }
    const file = PNG.sync.write(png, { colorType: 2 });
    const idat: Buffer[] = [];
    for (let o = 8; o < file.length;) { const len = file.readUInt32BE(o); if (file.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(file.subarray(o + 8, o + 8 + len)); o += 12 + len; }
    const px = decodeFlateImage(new Uint8Array(Buffer.concat(idat)), { ...base(w, h, 3), predictor: 15, dpColors: 3, columns: w })!;
    expect(Array.from(px.data)).toEqual(Array.from(rgba(raw, 3)));
  });
  it('모르는 경우는 null(손대지 않음)', () => {
    const raw = pixels(8, 8, 3), z = zlibSync(raw);
    expect(decodeFlateImage(z, { ...base(8, 8, 3), bpc: 16 })).toBeNull();
    expect(decodeFlateImage(z, { ...base(8, 8, 3), predictor: 2 })).toBeNull(); // TIFF 예측
    expect(decodeFlateImage(zlibSync(predict(raw, 24, 3, 8)), { ...base(8, 8, 3), predictor: 15, dpColors: 3, columns: 7 })).toBeNull(); // 매개변수 어긋남
    expect(decodeFlateImage(z, base(9, 8, 3))).toBeNull(); // 데이터가 모자람
    expect(decodeFlateImage(new Uint8Array([1, 2, 3, 4, 5]), base(8, 8, 3))).toBeNull(); // 깨진 압축
    expect(unpredictPng(new Uint8Array([7, 0, 0, 0]), 3, 3, 1)).toBeNull(); // 없는 필터 번호
  });
  it('하위 워커 작업 flate-to-jpeg: 풀 매개변수가 옵션 검사를 그대로 통과한다(묶음 표식 없이)', () => {
    const plugin = pluginById('flate-to-jpeg')!;
    expect(plugin.internal).toBe(true);
    const p: FlateParams = { ...base(23, 15, 3), predictor: 15, dpColors: 3, columns: 23 };
    expect(plugin.validate({ quality: 70, maxSide: 2000, ...p, evil: 'x' })).toEqual({ ok: true, value: { quality: 70, maxSide: 2000, ...p } });
    expect(plugin.validate({ ...base(8, 8, 1) })).toMatchObject({ ok: true, value: { colors: 1, quality: 70, maxSide: 2000 } });
    expect(plugin.validate({ ...base(8, 8, 3), colors: 4 }).ok).toBe(false);
    expect(plugin.validate({ colors: 3, bpc: 8, predictor: 1 }).ok).toBe(false); // 크기 없음
  });
});
