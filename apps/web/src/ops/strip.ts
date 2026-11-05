// 메타데이터 지우기(픽셀은 그대로, 무손실). 원본 바이트를 그대로 내보내는 경로
// (압축 결과가 더 커서 원본 유지, 사진 → PDF에 JPEG 그대로 넣기)에서 GPS·카메라 정보가 새지 않게.
// 남기는 것: 색 프로필(ICC), JFIF, Adobe(CMYK 해석에 필요), PNG 색 정보 청크.
import { jpegOrientation } from './exif.ts';

export type StripFormat = 'jpg' | 'png' | 'webp';

// ── JPEG: APP1(EXIF·XMP)·APP3~APP13·APP15·COM 제거. APP0(JFIF)·APP2(ICC)·APP14(Adobe)는 유지 ──
export function stripJpeg(buf: ArrayBuffer, { keepOrientation = false } = {}): ArrayBuffer {
  const b = new Uint8Array(buf);
  if (b[0] !== 0xff || b[1] !== 0xd8) return buf;
  const orientation = keepOrientation ? jpegOrientation(buf) : 1;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  if (orientation !== 1) parts.push(orientationApp1(orientation));
  let off = 2, sawScan = false;
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) return buf; // 구조가 이상하면 손대지 않는다(호출한 쪽이 다시 인코딩)
    const m = b[off + 1]!;
    if (m === 0xda) { parts.push(b.subarray(off)); sawScan = true; break; } // 영상 데이터 시작: 나머지는 통째로
    const len = (b[off + 2]! << 8) | b[off + 3]!;
    const drop = m === 0xe1 || (m >= 0xe3 && m <= 0xed) || m === 0xef || m === 0xfe;
    if (!drop) parts.push(b.subarray(off, off + 2 + len));
    off += 2 + len;
  }
  // 영상 데이터까지 못 갔으면 원본 그대로(처음엔 앞 2바이트만 남은 잘린 파일을 돌려줬다 — 단위 시험이 잡음)
  return sawScan ? concat(parts) : buf;
}

// 방향 태그 하나만 든 최소 EXIF(빅엔디언): "Exif\0\0" + TIFF 머리 + IFD0(항목 1개)
function orientationApp1(o: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, ...body]);
}

// ── PNG: eXIf·tEXt·zTXt·iTXt·tIME 청크 제거(색 정보 iCCP·sRGB·gAMA·cHRM·pHYs는 유지) ──
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
export function stripPng(buf: ArrayBuffer): ArrayBuffer {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  if (b.length < 8 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return buf;
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let off = 8, sawEnd = false;
  while (off + 12 <= b.length) {
    const len = v.getUint32(off);
    const type = String.fromCharCode(b[off + 4]!, b[off + 5]!, b[off + 6]!, b[off + 7]!);
    const end = off + 12 + len;
    if (end > b.length) return buf;
    if (!PNG_DROP.has(type)) parts.push(b.subarray(off, end));
    off = end;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  return sawEnd ? concat(parts) : buf;
}

// ── WebP(확장형 VP8X): EXIF·XMP 청크 제거 + VP8X 플래그 끄기 + RIFF 크기 다시 쓰기 ──
export function stripWebp(buf: ArrayBuffer): ArrayBuffer {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  if (b.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || tag(12) !== 'VP8X') return buf; // 단순형엔 메타데이터 자리가 없다
  const parts: Uint8Array[] = [];
  let off = 12;
  while (off + 8 <= b.length) {
    const id = tag(off);
    const len = v.getUint32(off + 4, true);
    const end = off + 8 + len + (len & 1);
    if (end > b.length) return buf;
    if (id === 'VP8X') {
      const c = b.slice(off, end);
      c[8] = c[8]! & ~0x0c; // XMP(0x04)·EXIF(0x08) 있음 표시 끄기
      parts.push(c);
    } else if (id !== 'EXIF' && id !== 'XMP ') parts.push(b.subarray(off, end));
    off = end;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.byteLength);
  out.set(b.subarray(0, 12));
  out.set(new Uint8Array(body), 12);
  new DataView(out.buffer).setUint32(4, 4 + body.byteLength, true);
  return out.buffer;
}

// 원본을 그대로 내보내도 되는 형식인가(지울 줄 아는 형식만). AVIF·HEIC 등은 다시 인코딩한 결과를 쓴다.
export function stripMetadata(buf: ArrayBuffer, fmt: string, opts?: { keepOrientation?: boolean }): ArrayBuffer | null {
  if (fmt === 'jpg') return stripJpeg(buf, opts);
  if (fmt === 'png') return stripPng(buf);
  if (fmt === 'webp') return stripWebp(buf);
  return null;
}

function concat(parts: Uint8Array[]): ArrayBuffer {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out.buffer;
}
