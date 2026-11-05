// 워커 안에서 쓰는 이미지 디코드/인코드. 무거운 WASM은 필요한 형식일 때만 불러온다.
import { formatFromName, type Format } from '@fc/shared';
import { ConvertError, isConvertError, type FilePayload } from '../core/types.ts';
import { jpegOrientation, applyOrientation } from './exif.ts';
import { imageSize } from '../core/imgsize.ts';

export type ImageOut = 'jpg' | 'png' | 'webp' | 'avif';
export const IMAGE_OUTS: ImageOut[] = ['jpg', 'png', 'webp', 'avif'];
export const MIME: Record<ImageOut, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };

export function formatOf(p: FilePayload): Format {
  const byName = formatFromName(p.name);
  if (byName !== 'other') return byName;
  const t = p.type.split('/')[1] ?? '';
  return formatFromName('x.' + t.replace('jpeg', 'jpg').replace('svg+xml', 'svg'));
}

// 파일 앞 몇 바이트로 진짜 형식 확인(확장자만 바꾼 파일 대비)
export function sniff(buf: ArrayBuffer): Format | null {
  const b = new Uint8Array(buf, 0, Math.min(32, buf.byteLength));
  const s = (o: number, str: string) => [...str].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (s(0, '\x89PNG')) return 'png';
  if (s(0, 'RIFF') && s(8, 'WEBP')) return 'webp';
  if (s(0, 'GIF8')) return 'gif';
  if (s(0, 'BM')) return 'bmp';
  if (s(0, '8BPS')) return 'psd';
  if (s(0, '%PDF')) return 'pdf';
  if (s(4, 'ftyp')) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (/avi[fs]/.test(brand)) return 'avif';
    if (/hei[cx]|hev[cx]|mif1|msf1/.test(brand)) return 'heic';
  }
  const head = new TextDecoder().decode(b).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  return null;
}

// 워커 안 OffscreenCanvas: 사파리 16.4 미만·일부 WebKit에는 없다(이 PC의 WebKit 시험에서 발견) → 대체 경로
export const HAS_OFFSCREEN = typeof OffscreenCanvas !== 'undefined';

function canvas(w: number, h: number) {
  return new OffscreenCanvas(w, h);
}

// OffscreenCanvas 없이 WASM으로 열기. JPEG 회전(EXIF)은 직접 적용한다(내장 디코더는 자동으로 해 줌).
async function decodeWasm(buf: ArrayBuffer, fmt: string): Promise<ImageData> {
  switch (fmt) {
    case 'jpg': {
      const raw = await (await import('@jsquash/jpeg/decode.js')).default(buf);
      const r = applyOrientation(raw, jpegOrientation(buf));
      return r === raw ? raw : new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height);
    }
    case 'png': return (await import('@jsquash/png/decode.js')).default(buf);
    case 'webp': return (await import('@jsquash/webp/decode.js')).default(buf);
    case 'avif': return (await (await import('@jsquash/avif/decode.js')).default(buf))!;
  }
  throw new ConvertError('unsupported', `이 브라우저에선 ${fmt.toUpperCase()}를 열 수 없어요. 최신 브라우저로 시도해 주세요.`, 'no-offscreen');
}

// prescale: 펼치면서 줄일 크기(회전 반영된 최종 방향 기준). 5000만 화소를 다 펼치지 않게(devlog 12절)
async function decodeNative(buf: ArrayBuffer, type: string, prescale?: { w: number; h: number }): Promise<ImageData> {
  const blob = new Blob([buf], { type });
  const bmp = await createImageBitmap(blob, prescale ? { resizeWidth: prescale.w, resizeHeight: prescale.h, resizeQuality: 'high' } : {});
  const c = canvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

async function decodeHeic(buf: ArrayBuffer): Promise<ImageData> {
  const mod = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
  const libheif = (mod.default as () => any)();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(buf));
  if (!images?.length) throw new ConvertError('decode', 'HEIC 안에 이미지가 없어요');
  const img = images.find((i: any) => i.is_primary?.()) ?? images[0];
  const w = img.get_width(), h = img.get_height();
  const out = new ImageData(w, h);
  await new Promise<void>((resolve, reject) => {
    img.display(out, (d: unknown) => (d ? resolve() : reject(new ConvertError('decode', 'HEIC 해독 실패'))));
  });
  for (const i of images) i.free?.();
  return out;
}

async function decodePsd(buf: ArrayBuffer): Promise<{ img: ImageData; note?: string }> {
  const { readPsd, initializeCanvas } = await import('ag-psd');
  // ag-psd는 useImageData여도 내부에서 캔버스를 만든다. 워커엔 document가 없으니 OffscreenCanvas를 넘긴다(e2e로 발견)
  // OffscreenCanvas가 없으면 ImageData를 만드는 흉내만 낸다(합성은 아래 순수 계산)
  initializeCanvas(
    (w, h) => (HAS_OFFSCREEN ? new OffscreenCanvas(w, h) : { width: w, height: h, getContext: () => ({ createImageData: (a: number, b: number) => new ImageData(a, b) }) }) as unknown as HTMLCanvasElement,
    (w, h) => new ImageData(w, h),
  );
  const psd = readPsd(buf, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true, skipLayerImageData: false });
  const hasLayers = (psd.children ?? []).some(function visible(l): boolean { return !l.hidden && (!!l.imageData || (l.children ?? []).some(visible)); });
  if (psd.imageData && psd.imageData.width > 0 && !(hasLayers && isUniform(psd.imageData.data))) {
    const d = psd.imageData.data;
    return { img: new ImageData(new Uint8ClampedArray(d.buffer as ArrayBuffer, d.byteOffset, psd.width * psd.height * 4), psd.width, psd.height) };
  }
  // 합성 이미지가 없거나 한 가지 색으로만 채워져 있으면(호환성 최대화 꺼짐) 가짜로 보고 레이어를 겹친다(e2e로 발견)
  // 레이어 합성은 순수 계산(일반 혼합 + 불투명도) → 캔버스 없는 환경에서도 같은 결과
  const W = psd.width, H = psd.height;
  const acc = new Float32Array(W * H * 4); // 알파를 미리 곱한 누적
  const draw = (layers: typeof psd.children) => {
    for (const l of layers ?? []) {
      if (l.hidden) continue;
      if (l.children) { draw(l.children); continue; }
      if (!l.imageData) continue;
      const { width: lw, height: lh, data } = l.imageData;
      const op = l.opacity ?? 1, left = l.left ?? 0, top = l.top ?? 0;
      for (let y = Math.max(0, -top); y < lh && y + top < H; y++) {
        for (let x = Math.max(0, -left); x < lw && x + left < W; x++) {
          const s = (y * lw + x) * 4, d = ((y + top) * W + (x + left)) * 4;
          const a = (data[s + 3]! / 255) * op;
          if (!a) continue;
          for (let k = 0; k < 3; k++) acc[d + k] = data[s + k]! * a + acc[d + k]! * (1 - a);
          acc[d + 3] = a + acc[d + 3]! * (1 - a);
        }
      }
    }
  };
  draw(psd.children);
  const composite = new ImageData(W, H);
  for (let i = 0; i < acc.length; i += 4) {
    const a = acc[i + 3]!;
    composite.data[i + 3] = Math.round(a * 255);
    if (a) for (let k = 0; k < 3; k++) composite.data[i + k] = Math.round(acc[i + k]! / a);
  }
  return { img: composite, note: '합성 이미지가 없는 PSD라 레이어를 직접 겹쳤어요. 레이어 효과·조정 레이어는 빠질 수 있어요.' };
}

// 전체가 한 색인지(약 4천 점 표본)
function isUniform(d: ArrayLike<number>) {
  const px = d.length / 4;
  const step = Math.max(1, Math.floor(px / 4096));
  for (let i = step; i < px; i += step) {
    const a = i * 4;
    if (d[a] !== d[0] || d[a + 1] !== d[1] || d[a + 2] !== d[2] || d[a + 3] !== d[3]) return false;
  }
  return true;
}

// 글자 있는 SVG: resvg(WASM)는 브라우저 안에서 시스템 글꼴을 못 읽어 글자를 통째로 빼고 그렸다(e2e 화소 검사로 재현, 4엔진 모두 0)
// → 브라우저 자체 SVG 렌더러로(시스템 글꼴, 한글 포함). <img>로 연 SVG는 스크립트·외부 불러오기가 막혀 안전하다.
// 워커에선 SVG를 그림으로 열 수 없어 'svg-text-main'으로 알리고, client.ts가 화면 쪽에서 같은 작업을 다시 한다.
export const SVG_TEXT_MAIN = 'svg-text-main';
const hasSvgText = (buf: ArrayBuffer) => /<(text|tspan|textPath)\b/i.test(new TextDecoder().decode(buf));
async function decodeSvgNative(buf: ArrayBuffer, width?: number): Promise<ImageData> {
  const url = URL.createObjectURL(new Blob([buf], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || 1024, h0 = img.naturalHeight || Math.round((w0 * 3) / 4);
    const scale = width ? width / w0 : 2; // resvg 경로와 같게: 지정 폭 또는 2배
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, w, h);
    return g.getImageData(0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let resvgReady: Promise<typeof import('@resvg/resvg-wasm')> | null = null;
async function decodeSvg(buf: ArrayBuffer, width?: number): Promise<ImageData> {
  if (hasSvgText(buf)) {
    if (typeof document !== 'undefined') return decodeSvgNative(buf, width);
    throw new ConvertError('decode', '글자 있는 SVG는 화면 쪽에서 그린다', SVG_TEXT_MAIN);
  }
  resvgReady ??= (async () => {
    const m = await import('@resvg/resvg-wasm');
    const wasmUrl = (await import('@resvg/resvg-wasm/index_bg.wasm?url')).default;
    await m.initWasm(fetch(wasmUrl));
    return m;
  })();
  const { Resvg } = await resvgReady;
  const r = new Resvg(new Uint8Array(buf), width ? { fitTo: { mode: 'width', value: width } } : { fitTo: { mode: 'zoom', value: 2 } });
  const out = r.render();
  const img = new ImageData(new Uint8ClampedArray(out.pixels), out.width, out.height);
  out.free(); r.free();
  return img;
}

// 최종 크기가 원본의 절반보다 작으면, 목표의 2배까지만 펼쳐서 디코드(마지막 단계는 Lanczos로 정밀하게)
export function prescaleFor(buf: ArrayBuffer, maxW?: number, maxH?: number): { w: number; h: number } | undefined {
  if (!maxW && !maxH) return undefined;
  const head = new Uint8Array(buf, 0, Math.min(262144, buf.byteLength));
  const size = imageSize(head);
  if (!size) return undefined;
  let { w, h } = size;
  if (head[0] === 0xff && head[1] === 0xd8 && jpegOrientation(buf) >= 5) [w, h] = [h, w]; // 90° 회전 사진은 가로·세로가 바뀐다
  const t = fitSize(w, h, maxW, maxH);
  if (t.w * 2 >= w) return undefined;
  return { w: t.w * 2, h: Math.round((t.w * 2 * h) / w) };
}

export async function decodeImage(p: FilePayload, opts: { svgWidth?: number; maxWidth?: number; maxHeight?: number } = {}): Promise<{ img: ImageData; from: Format; note?: string }> {
  const from = sniff(p.buf) ?? formatOf(p);
  try {
    if (from === 'heic') return { img: await decodeHeic(p.buf), from };
    if (from === 'psd') return { ...(await decodePsd(p.buf)), from };
    if (from === 'svg') return { img: await decodeSvg(p.buf, opts.svgWidth), from };
    if (['jpg', 'png', 'webp', 'avif', 'gif', 'bmp'].includes(from)) {
      if (!HAS_OFFSCREEN) return { img: await decodeWasm(p.buf, from), from };
      try { return { img: await decodeNative(p.buf, p.type || 'image/' + from, prescaleFor(p.buf, opts.maxWidth, opts.maxHeight)), from }; }
      catch (e) {
        // 브라우저가 못 여는 형식(예: 일부 브라우저의 AVIF)은 WASM 디코더로
        if (from === 'avif') return { img: (await (await import('@jsquash/avif/decode.js')).default(p.buf))!, from };
        if (from === 'webp') return { img: await (await import('@jsquash/webp/decode.js')).default(p.buf), from };
        throw e;
      }
    }
  } catch (e) {
    if (isConvertError(e)) throw e;
    if (e instanceof RangeError) throw new ConvertError('out-of-memory', '이미지가 너무 커서 메모리가 부족해요', e);
    throw new ConvertError('decode', `파일을 열 수 없어요 (${from})`, e);
  }
  throw new ConvertError('unsupported', `지원하지 않는 형식이에요 (${from})`);
}

// 알파가 없는 형식(JPG)으로 갈 때 배경색에 합성
export function flatten(img: ImageData, bg = [255, 255, 255]): ImageData {
  const d = img.data;
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) { hasAlpha = true; break; }
  if (!hasAlpha) return img;
  const out = new ImageData(img.width, img.height);
  const o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    o[i] = d[i]! * a + bg[0]! * (1 - a);
    o[i + 1] = d[i + 1]! * a + bg[1]! * (1 - a);
    o[i + 2] = d[i + 2]! * a + bg[2]! * (1 - a);
    o[i + 3] = 255;
  }
  return out;
}

export function fitSize(w: number, h: number, maxW?: number, maxH?: number) {
  const s = Math.min(1, maxW ? maxW / w : 1, maxH ? maxH / h : 1);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scaled: s < 1 };
}

export async function resizeImage(img: ImageData, maxW?: number, maxH?: number): Promise<ImageData> {
  const t = fitSize(img.width, img.height, maxW, maxH);
  if (!t.scaled) return img;
  const resize = (await import('@jsquash/resize')).default;
  return resize(img, { width: t.w, height: t.h, method: 'lanczos3', fitMethod: 'stretch', premultiply: true, linearRGB: true });
}

export interface EncodeOpts {
  quality?: number; // 1~100
  engine?: 'wasm' | 'native'; // native: 브라우저 내장 인코더(빠르지만 용량이 큼)
  pngLevel?: number; // oxipng 최적화 수준(0이면 생략)
  chroma?: 'full'; // 색 정보를 줄이지 않음(4:4:4). 색 경계가 많은 그림용(devlog 23절). WebP 손실 압축은 지원 안 함
}

export async function encodeImage(img: ImageData, to: ImageOut, o: EncodeOpts = {}): Promise<ArrayBuffer> {
  const q = Math.round(o.quality ?? 80);
  if (to === 'jpg') img = flatten(img);
  if (o.engine === 'native' && to !== 'avif' && HAS_OFFSCREEN) {
    const c = canvas(img.width, img.height);
    c.getContext('2d')!.putImageData(img, 0, 0);
    return (await c.convertToBlob({ type: MIME[to], quality: q / 100 })).arrayBuffer();
  }
  try {
    switch (to) {
      case 'jpg': return (await import('@jsquash/jpeg/encode.js')).default(img, { quality: q, ...(o.chroma === 'full' ? { auto_subsample: false, chroma_subsample: 1 } : {}) });
      case 'webp': return (await import('@jsquash/webp/encode.js')).default(img, { quality: q });
      case 'avif': return (await import('@jsquash/avif/encode.js')).default(img, { quality: q, speed: 6, ...(o.chroma === 'full' ? { subsample: 3 } : {}) });
      case 'png': {
        const level = o.pngLevel ?? 2;
        if (level > 0) return (await import('@jsquash/oxipng/optimise.js')).default(img, { level });
        return (await import('@jsquash/png/encode.js')).default(img);
      }
    }
  } catch (e) {
    if (e instanceof RangeError) throw new ConvertError('out-of-memory', '메모리가 부족해요', e);
    throw new ConvertError('encode', `${to} 만들기 실패`, e);
  }
}

export async function decodeEncoded(buf: ArrayBuffer, fmt: ImageOut): Promise<ImageData> {
  switch (fmt) {
    case 'jpg': return (await import('@jsquash/jpeg/decode.js')).default(buf);
    case 'webp': return (await import('@jsquash/webp/decode.js')).default(buf);
    case 'avif': return (await (await import('@jsquash/avif/decode.js')).default(buf))!;
    case 'png': return (await import('@jsquash/png/decode.js')).default(buf);
  }
}

export function renameExt(name: string, ext: string) {
  const base = name.replace(/\.[^.]+$/, '') || 'file';
  return `${base}.${ext}`;
}
