// JPEG EXIF 방향(Orientation, 태그 0x0112) 읽기 + 픽셀 회전.
// 브라우저 내장 디코더는 알아서 돌려 주지만, WASM 디코더(OffscreenCanvas 없는 환경의 대체 경로)는 안 돌려 준다.

export function jpegOrientation(buf: ArrayBuffer): number {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) return 1;
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 /* Exif */) {
      const tiff = off + 10;
      const little = v.getUint16(tiff) === 0x4949;
      const u16 = (o: number) => v.getUint16(o, little);
      const u32 = (o: number) => v.getUint32(o, little);
      if (u16(tiff + 2) !== 42) return 1;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > v.byteLength) return 1;
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > v.byteLength) return 1;
        if (u16(e) === 0x0112) { const o = u16(e + 8); return o >= 1 && o <= 8 ? o : 1; }
      }
      return 1;
    }
    if (marker === 0xffda) return 1; // 이미지 데이터 시작: 더 볼 것 없음
    off += 2 + len;
  }
  return 1;
}

// 방향 값(1~8)대로 픽셀을 돌려 똑바로 세운다
export function applyOrientation(img: { width: number; height: number; data: Uint8ClampedArray }, o: number) {
  if (o <= 1 || o > 8) return img;
  const { width: w, height: h, data: src } = img;
  const swap = o >= 5;
  const W = swap ? h : w, H = swap ? w : h;
  const out = new Uint8ClampedArray(W * H * 4);
  const s32 = new Uint32Array(src.buffer, src.byteOffset, w * h);
  const d32 = new Uint32Array(out.buffer);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let X: number, Y: number;
      switch (o) {
        case 2: X = w - 1 - x; Y = y; break;
        case 3: X = w - 1 - x; Y = h - 1 - y; break;
        case 4: X = x; Y = h - 1 - y; break;
        case 5: X = y; Y = x; break;
        case 6: X = h - 1 - y; Y = x; break;
        case 7: X = h - 1 - y; Y = w - 1 - x; break;
        default: X = y; Y = w - 1 - x; break; // 8
      }
      d32[Y * W + X] = s32[y * w + x]!;
    }
  }
  return { width: W, height: H, data: out };
}
