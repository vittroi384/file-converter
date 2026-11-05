// PDF 안 FlateDecode(무손실) 사진 풀기. 흔한 경우만: 8비트, 회색(1채널)·RGB(3채널), PNG 예측(Predictor ≥ 10) 있음/없음.
// 그 밖(색인 색·CMYK·16비트·TIFF 예측 등)은 null → 손대지 않는다.
// 사진으로 판별된 것만 JPEG로 바꾼다(recompressFlate). 화면 캡처 속 글자가 뭉개지지 않게(devlog 26절에서 보류했던 것).
import { unzlibSync, inflateSync } from 'fflate';
import { encodeImage, decodeEncoded, resizeImage } from './codecs.ts';
import { ssimRgba } from '../core/ssim.ts';
import { isPhoto } from './photo-detect.ts';

export interface FlateParams {
  width: number;
  height: number;
  colors: 1 | 3; // 채널 수(DeviceGray·ICCBased N=1 → 1, DeviceRGB·ICCBased N=3 → 3)
  bpc: number; // BitsPerComponent
  predictor: number; // DecodeParms /Predictor (없으면 1)
  dpColors?: number; // DecodeParms /Colors (없으면 1)
  dpBpc?: number; // DecodeParms /BitsPerComponent (없으면 8)
  columns?: number; // DecodeParms /Columns (없으면 1)
}

export interface Pixels { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } // RGBA

function inflate(bytes: Uint8Array): Uint8Array | null {
  try { return unzlibSync(bytes); } catch { /* 머리·검사합이 틀린 파일이 있다 → 머리 빼고 다시 */ }
  try { return inflateSync(bytes.subarray(2)); } catch { return null; }
}

// PNG 예측 되돌리기(줄마다 앞 1바이트가 필터 종류). out에 줄 바이트만 이어 붙인다.
export function unpredictPng(src: Uint8Array, rowBytes: number, bpp: number, rows: number): Uint8Array | null {
  if (src.length < (rowBytes + 1) * rows) return null;
  const out = new Uint8Array(rowBytes * rows);
  for (let y = 0; y < rows; y++) {
    const f = src[y * (rowBytes + 1)]!;
    const s = y * (rowBytes + 1) + 1, o = y * rowBytes, p = o - rowBytes; // p: 윗줄(첫 줄이면 음수 → 0으로 본다)
    for (let x = 0; x < rowBytes; x++) {
      const raw = src[s + x]!;
      const a = x >= bpp ? out[o + x - bpp]! : 0;
      const b = y > 0 ? out[p + x]! : 0;
      const c = y > 0 && x >= bpp ? out[p + x - bpp]! : 0;
      let v: number;
      switch (f) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: return null;
      }
      out[o + x] = v & 255;
    }
  }
  return out;
}

export function decodeFlateImage(bytes: Uint8Array, p: FlateParams): Pixels | null {
  const { width: w, height: h, colors } = p;
  if (p.bpc !== 8 || !(w > 0 && h > 0) || (colors !== 1 && colors !== 3)) return null;
  const rowBytes = w * colors;
  let raw = inflate(bytes);
  if (!raw) return null;
  if (p.predictor >= 10) {
    // 예측 매개변수가 사진 사전과 어긋나면(드묾) 해석이 틀어질 수 있어 건너뛴다
    if ((p.dpColors ?? 1) !== colors || (p.dpBpc ?? 8) !== 8 || (p.columns ?? 1) !== w) return null;
    raw = unpredictPng(raw, rowBytes, colors, h);
    if (!raw) return null;
  } else if (p.predictor !== 1) return null; // TIFF 예측(2) 등
  if (raw.length < rowBytes * h) return null;
  const data = new Uint8ClampedArray(w * h * 4);
  if (colors === 3) for (let i = 0, j = 0; i < w * h; i++, j += 3) { data[i * 4] = raw[j]!; data[i * 4 + 1] = raw[j + 1]!; data[i * 4 + 2] = raw[j + 2]!; data[i * 4 + 3] = 255; }
  else for (let i = 0; i < w * h; i++) { const v = raw[i]!; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}

export const FLATE_MIN_SSIM = 0.97;
export type FlateResult = { buf: ArrayBuffer; width: number; height: number; quality: number; ssim: number };

// Flate 사진 한 장 → JPEG. 사진이 아니거나, 원본보다 10% 이상 안 줄거나, 원본(크기를 줄였으면 줄인 원본)과 SSIM < 0.97이면 null.
// 품질은 요청값부터, 화질이 모자라면 +10, +20, 마지막 95(결 많은 Kodak 사진은 95에서야 0.97: 그래도 Flate보다 약 70% 작다).
// 회색 사진은 회색 JPEG(색 공간을 그대로 둘 수 있게).
export async function recompressFlate(bytes: Uint8Array, p: FlateParams, quality: number, maxSide: number): Promise<FlateResult | null> {
  const px = decodeFlateImage(bytes, p);
  if (!px || !isPhoto(px)) return null;
  const ref = await resizeImage(new ImageData(px.data, px.width, px.height), maxSide, maxSide);
  for (const q of [...new Set([quality, quality + 10, quality + 20, 95].map(v => Math.min(95, v)))]) {
    const buf = p.colors === 1
      ? await (await import('@jsquash/jpeg/encode.js')).default(ref, { quality: q, color_space: 1 /* GRAYSCALE */ })
      : await encodeImage(ref, 'jpg', { quality: q });
    if (buf.byteLength >= bytes.byteLength * 0.9) return null; // 품질을 더 올리면 더 커질 뿐
    const ssim = ssimRgba(ref, await decodeEncoded(buf, 'jpg'));
    if (ssim >= FLATE_MIN_SSIM) return { buf, width: ref.width, height: ref.height, quality: q, ssim };
  }
  return null;
}
