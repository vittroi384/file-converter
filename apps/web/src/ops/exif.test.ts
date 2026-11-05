import { describe, it, expect } from 'vitest';
import { jpegOrientation, applyOrientation } from './exif.ts';

// 최소 JPEG 머리: SOI + APP1(Exif, IFD 항목 1개: Orientation) + SOS
function fakeJpeg(orientation: number, little = true) {
  const b: number[] = [0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const w16 = (v: number) => (little ? b.push(v & 0xff, v >> 8) : b.push(v >> 8, v & 0xff));
  const w32 = (v: number) => (little ? b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24) : b.push(v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff));
  b.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d])); w16(42); w32(8);
  w16(1); w16(0x0112); w16(3); w32(1); w16(orientation); w16(0); w32(0);
  b.push(0xff, 0xda, 0x00, 0x02);
  return new Uint8Array(b).buffer;
}

// 2x3 이미지: 픽셀마다 고유 값(빨강 채널 = 번호)
const img = () => { const d = new Uint8ClampedArray(2 * 3 * 4); for (let i = 0; i < 6; i++) { d[i * 4] = i + 1; d[i * 4 + 3] = 255; } return { width: 2, height: 3, data: d }; };
const grid = (r: { width: number; height: number; data: Uint8ClampedArray }) => Array.from({ length: r.height }, (_, y) => Array.from({ length: r.width }, (_, x) => r.data[(y * r.width + x) * 4]));

describe('EXIF 방향', () => {
  it('리틀·빅 엔디언 모두 읽는다', () => {
    for (let o = 1; o <= 8; o++) { expect(jpegOrientation(fakeJpeg(o))).toBe(o); expect(jpegOrientation(fakeJpeg(o, false))).toBe(o); }
  });
  it('EXIF 없거나 JPEG 아니면 1', () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer)).toBe(1);
    expect(jpegOrientation(new Uint8Array([0x89, 0x50]).buffer)).toBe(1);
    expect(jpegOrientation(new ArrayBuffer(0))).toBe(1);
  });
  it('회전 결과', () => {
    // 원본 [[1,2],[3,4],[5,6]]
    expect(grid(applyOrientation(img(), 1))).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(grid(applyOrientation(img(), 3))).toEqual([[6, 5], [4, 3], [2, 1]]);
    expect(grid(applyOrientation(img(), 6))).toEqual([[5, 3, 1], [6, 4, 2]]); // 시계 방향 90°
    expect(grid(applyOrientation(img(), 8))).toEqual([[2, 4, 6], [1, 3, 5]]); // 반시계 90°
    expect(grid(applyOrientation(img(), 2))).toEqual([[2, 1], [4, 3], [6, 5]]);
  });
});
