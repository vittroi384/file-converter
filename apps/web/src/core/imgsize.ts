// 파일 머리만 읽어 가로·세로 크기 알아내기(픽셀을 펼치지 않음). 워커 풀 메모리 예산 계산용.
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16be = (o: number) => (b[o]! << 8) | b[o + 1]!;
  const u32be = (o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
  const u16le = (o: number) => b[o]! | (b[o + 1]! << 8);
  const u24le = (o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
  const str = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length < 26) return null;
  // PNG: IHDR
  if (b[0] === 0x89 && str(1, 3) === 'PNG') return { w: u32be(16), h: u32be(20) };
  // GIF
  if (str(0, 3) === 'GIF') return { w: u16le(6), h: u16le(8) };
  // BMP
  if (str(0, 2) === 'BM') return { w: Math.abs(b[18]! | (b[19]! << 8) | (b[20]! << 16) | (b[21]! << 24)), h: Math.abs(b[22]! | (b[23]! << 8) | (b[24]! << 16) | (b[25]! << 24)) };
  // WebP
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') {
    const kind = str(12, 4);
    if (kind === 'VP8X') return { w: u24le(24) + 1, h: u24le(27) + 1 };
    if (kind === 'VP8 ') return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    if (kind === 'VP8L') { const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  // JPEG: SOF 표지 찾기
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1]!;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
      const len = u16be(o + 2);
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { w: u16be(o + 7), h: u16be(o + 5) };
      o += 2 + len;
    }
    return null;
  }
  // HEIC·AVIF(ISO BMFF): 'ispe' 상자(첫 번째 = 보통 기본 이미지 또는 그 타일 격자 전체)
  if (str(4, 4) === 'ftyp') {
    for (let o = 8; o + 20 < b.length; o++) {
      if (b[o] === 0x69 && str(o, 4) === 'ispe') return { w: u32be(o + 8), h: u32be(o + 12) };
    }
  }
  return null;
}

const MB = 1024 * 1024;

// 기기 메모리에 맞춘 예산. deviceMemory는 크로미움만 준다(GB, 8에서 잘림). 사파리는 없음 → 모바일이면 보수적으로.
export function memoryBudget(nav: { deviceMemory?: number; userAgent?: string } = typeof navigator !== 'undefined' ? navigator as never : {}): number {
  const mobile = /Mobi|Android|iPhone|iPad/i.test(nav.userAgent ?? '');
  if (nav.deviceMemory) return Math.min(2048, Math.max(384, nav.deviceMemory * 1024 * (mobile ? 0.15 : 0.25))) * MB;
  return (mobile ? 512 : 1536) * MB;
}

// 작업 하나가 넘으면 시작 전에 거절하는 한도. 예산은 기기 메모리의 25%(PC)·15%(폰)라 3배면 대략 75%·45%:
// 이보다 크면 탭이 강제로 꺼질 가능성이 높다(브라우저가 알려 주지 않고 죽는다).
export const HARD_FACTOR = 3;
export function hardLimit(nav?: { deviceMemory?: number; userAgent?: string }): number {
  return memoryBudget(nav) * HARD_FACTOR;
}
