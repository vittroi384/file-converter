// PDF 작업. 합치기·나누기·이미지→PDF는 pdf-lib(재인코딩 없음), PDF→이미지는 pdf.js, 용량 줄이기는 내장 JPEG 재압축.
import type { FilePayload, OpRunner } from '../core/types.ts';
import { ConvertError } from '../core/types.ts';
import { decodeImage, encodeImage, renameExt, sniff, resizeImage, MIME, type ImageOut } from './codecs.ts';
import { stripJpeg, stripPng } from './strip.ts';
import { jpegOrientation } from './exif.ts';
import { recompressFlate, type FlateParams } from './flate.ts';

async function lib() {
  return import('pdf-lib');
}

async function load(p: FilePayload) {
  const { PDFDocument } = await lib();
  try {
    const doc = await PDFDocument.load(p.buf, { updateMetadata: false });
    // pdf-lib는 깨진 파일도 일단 열어 주고 나중에 TypeError를 낸다 → 여기서 페이지까지 확인(테스트로 발견)
    if (doc.getPageCount() < 1) throw new Error('no pages');
    return doc;
  } catch (e) {
    if (String(e).toLowerCase().includes('encrypt')) throw new ConvertError('password', '암호가 걸린 PDF예요');
    throw new ConvertError('decode', 'PDF를 열 수 없어요');
  }
}

async function save(doc: Awaited<ReturnType<typeof load>>): Promise<ArrayBuffer> {
  const bytes = await doc.save({ useObjectStreams: true });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// "1-3,5,8-" 같은 범위 → 0부터 시작하는 페이지 번호 묶음
export function parseRanges(spec: string, pageCount: number): number[][] {
  const groups: number[][] = [];
  for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    let a: number, b: number;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : pageCount; }
    else if (/^\d+$/.test(part)) { a = b = +part; }
    else throw new ConvertError('unsupported', `범위를 읽을 수 없어요: ${part}`);
    a = Math.max(1, a); b = Math.min(pageCount, b);
    if (a > b) continue;
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  if (!groups.length) throw new ConvertError('unsupported', '선택된 페이지가 없어요');
  return groups;
}

export const merge: OpRunner = async (inputs, _o, ctx) => {
  const { PDFDocument } = await lib();
  const out = await PDFDocument.create();
  for (let i = 0; i < inputs.length; i++) {
    const p = inputs[i]!;
    if (sniff(p.buf) === 'pdf') {
      const src = await load(p);
      for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
    } else {
      await addImagePage(out, p, 'fit');
    }
    ctx.progress((i + 1) / inputs.length * 0.9, `${i + 1}/${inputs.length}`);
  }
  return { outputs: [{ name: 'merged.pdf', type: 'application/pdf', buf: await save(out) }], meta: { pages: out.getPageCount() } };
};

export const split: OpRunner = async (inputs, o) => {
  const p = inputs[0]!;
  const { PDFDocument } = await lib();
  const src = await load(p);
  const n = src.getPageCount();
  const spec = String(o.ranges ?? '').trim();
  const groups = !spec || spec === 'each' ? Array.from({ length: n }, (_, i) => [i]) : parseRanges(spec, n);
  const outputs: FilePayload[] = [];
  for (const g of groups) {
    const doc = await PDFDocument.create();
    for (const page of await doc.copyPages(src, g)) doc.addPage(page);
    const label = g.length === 1 ? `${g[0]! + 1}` : `${g[0]! + 1}-${g[g.length - 1]! + 1}`;
    outputs.push({ name: renameExt(p.name, '').replace(/\.$/, '') + `_p${label}.pdf`, type: 'application/pdf', buf: await save(doc) });
  }
  return { outputs, meta: { pages: n, files: outputs.length } };
};

const A4 = [595.28, 841.89] as const;
async function addImagePage(doc: Awaited<ReturnType<typeof load>>, p: FilePayload, size: string) {
  const { degrees } = await lib();
  const kind = sniff(p.buf);
  // JPG·PNG는 원본 영상 데이터를 그대로 넣는다(재압축 없음 → 화질 손실 0). 단 GPS·카메라 정보는 지운다
  // (예전엔 원본 바이트 그대로라 위치 정보가 PDF 안에 남았다 — e2e로 재현).
  // PDF 뷰어는 EXIF 방향을 무시한다 → 세로로 찍은 사진이 누워 나왔다. 90°·180° 회전은 그리기 회전으로(무손실),
  // 좌우 반전이 섞인 방향(2·4·5·7, 드묾)만 바로 세워 다시 인코딩한다.
  const o = kind === 'jpg' ? jpegOrientation(p.buf) : 1;
  const lossless = kind === 'png' || (kind === 'jpg' && (o === 1 || o === 3 || o === 6 || o === 8));
  const img = !lossless ? await doc.embedJpg(await encodeImage((await decodeImage(p)).img, 'jpg', { quality: 92 }))
    : kind === 'jpg' ? await doc.embedJpg(stripJpeg(p.buf))
    : await doc.embedPng(stripPng(p.buf));
  const rot = lossless ? o : 1;
  const sideways = rot === 6 || rot === 8;
  const iw = sideways ? img.height : img.width, ih = sideways ? img.width : img.height; // 보이는 크기
  const [pw, ph, s] = size === 'a4'
    ? [A4[0], A4[1], Math.min((A4[0] - 48) / iw, (A4[1] - 48) / ih, 1)]
    : [iw, ih, 1];
  const page = doc.addPage([pw, ph]);
  const w = iw * s, h = ih * s, x = (pw - w) / 2, y = (ph - h) / 2;
  // drawImage의 회전은 (x, y) 모서리를 축으로 반시계 방향 → 회전 뒤 상자가 제자리에 오게 기준점을 옮긴다
  if (rot === 6) page.drawImage(img, { x, y: y + h, width: h, height: w, rotate: degrees(-90) });
  else if (rot === 8) page.drawImage(img, { x: x + w, y, width: h, height: w, rotate: degrees(90) });
  else if (rot === 3) page.drawImage(img, { x: x + w, y: y + h, width: w, height: h, rotate: degrees(180) });
  else page.drawImage(img, { x, y, width: w, height: h });
}

export const imagesToPdf: OpRunner = async (inputs, o, ctx) => {
  const { PDFDocument } = await lib();
  const doc = await PDFDocument.create();
  for (let i = 0; i < inputs.length; i++) {
    await addImagePage(doc, inputs[i]!, String(o.pageSize ?? 'fit'));
    ctx.progress((i + 1) / inputs.length * 0.9, `${i + 1}/${inputs.length}`);
  }
  const name = inputs.length === 1 ? renameExt(inputs[0]!.name, 'pdf') : 'images.pdf';
  return { outputs: [{ name, type: 'application/pdf', buf: await save(doc) }], meta: { pages: inputs.length } };
};

// pdf.js를 워커 안에서 쓰기: 캔버스는 OffscreenCanvas로 만든다.
// 메서드 구성은 pdf.js 6 BaseCanvasFactory와 같다(getNoAlphaContext가 6.x에서 필수가 됨, e2e로 발견)
type CC = { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null };
class OffscreenFactory {
  constructor(_opts?: unknown) {}
  create(width: number, height: number): CC {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(cc: CC, width: number, height: number) { cc.canvas!.width = width; cc.canvas!.height = height; }
  destroy(cc: CC) { if (cc.canvas) cc.canvas.width = cc.canvas.height = 0; cc.canvas = null; cc.context = null; }
  getNoAlphaContext(canvas: OffscreenCanvas) { return canvas.getContext('2d', { alpha: false, willReadFrequently: true }); }
  _createCanvas(width: number, height: number) { return new OffscreenCanvas(width, height); }
}

// 워커면 OffscreenCanvas, 화면 쪽(옛 사파리 대체 경로)이면 DOM 캔버스
const inWorker = typeof document === 'undefined';
function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}

export const toImages: OpRunner = async (inputs, o, ctx) => {
  const p = inputs[0]!;
  // 워커에 캔버스가 없으면 화면 쪽에서 다시 하라고 알린다(client.ts가 받아서 재시도)
  if (inWorker && typeof OffscreenCanvas === 'undefined') throw new ConvertError('unsupported', '이 브라우저는 작업자 안에서 그림을 그릴 수 없어요', 'no-offscreen');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const to = (o.to === 'jpg' || o.to === 'webp' ? o.to : 'png') as ImageOut;
  const dpi = Math.min(300, Math.max(36, Number(o.dpi ?? 150)));
  const task = pdfjs.getDocument((inWorker
    ? { data: new Uint8Array(p.buf), CanvasFactory: OffscreenFactory, isOffscreenCanvasSupported: true }
    : { data: new Uint8Array(p.buf) }) as Parameters<typeof pdfjs.getDocument>[0]);
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if ((e as { name?: string }).name === 'PasswordException') throw new ConvertError('password', '암호가 걸린 PDF예요');
    throw new ConvertError('decode', 'PDF를 열 수 없어요');
  }
  const pages = o.ranges ? parseRanges(String(o.ranges), doc.numPages).flat() : Array.from({ length: doc.numPages }, (_, i) => i);
  const outputs: FilePayload[] = [];
  for (let k = 0; k < pages.length; k++) {
    const page = await doc.getPage(pages[k]! + 1);
    const vp = page.getViewport({ scale: dpi / 72 });
    const canvas = makeCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const c2d = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: c2d as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
    const img = c2d.getImageData(0, 0, canvas.width, canvas.height);
    const buf = await encodeImage(img, to, { quality: Number(o.quality ?? 90) });
    outputs.push({ name: renameExt(p.name, '').replace(/\.$/, '') + `_p${pages[k]! + 1}.${to}`, type: MIME[to], buf });
    page.cleanup();
    ctx.progress((k + 1) / pages.length * 0.95, `${k + 1}/${pages.length}쪽`);
  }
  await task.destroy();
  return { outputs, meta: { pages: outputs.length, dpi } };
};

// 같은 사진 개체 합치기: 내용(바이트) + 사전(크기·필터·색 공간 등)이 같으면 하나만 남기고 참조를 모두 그쪽으로.
// 투명도 마스크(SMask)도 사진이라, 마스크가 먼저 합쳐진 뒤 본 사진의 사전이 같아지도록 두 번 돈다.
async function dedupeImages(doc: Awaited<ReturnType<typeof load>>): Promise<number> {
  const { PDFName, PDFRawStream, PDFDict, PDFArray, PDFRef } = await lib();
  let removed = 0;
  for (let pass = 0; pass < 2; pass++) {
    const firstByKey = new Map<string, import('pdf-lib').PDFRef>();
    const dup = new Map<string, import('pdf-lib').PDFRef>(); // 지울 참조 문자열 → 남길 참조
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', obj.contents.slice().buffer as ArrayBuffer));
      const key = `${obj.dict.toString()}|${Array.from(hash, b => b.toString(16).padStart(2, '0')).join('')}`;
      const keep = firstByKey.get(key);
      if (keep) dup.set(ref.toString(), keep); else firstByKey.set(key, ref);
    }
    if (!dup.size) break;
    // 모든 개체 안의 참조를 바꾼다(쪽의 Resources/XObject, 사진의 SMask 등)
    const swap = (v: unknown): unknown => (v instanceof PDFRef ? dup.get(v.toString()) ?? v : v);
    const walk = (v: unknown, seen: Set<unknown>) => {
      if (!v || seen.has(v)) return;
      seen.add(v);
      const dict = v instanceof PDFDict ? v : v instanceof PDFRawStream ? v.dict : null;
      if (dict) for (const [k, x] of dict.entries()) { const y = swap(x); if (y !== x) dict.set(k, y as never); walk(x, seen); }
      else if (v instanceof PDFArray) for (let i = 0; i < v.size(); i++) { const x = v.get(i); const y = swap(x); if (y !== x) v.set(i, y as never); walk(x, seen); }
    };
    const seen = new Set<unknown>();
    for (const [, obj] of doc.context.enumerateIndirectObjects()) walk(obj, seen);
    walk(doc.context.trailerInfo.Root, seen);
    for (const [ref] of doc.context.enumerateIndirectObjects()) if (dup.has(ref.toString())) { doc.context.delete(ref); removed++; }
  }
  return removed;
}

// 용량 줄이기: 내장 JPEG(DCTDecode) 이미지를 다시 압축·축소한다. 다른 이미지와 글자는 그대로.
// 사진 한 장 다시 압축(하위 워커에서도, 대체 경로에서도 같은 함수). 10% 이상 안 줄면 null.
// Flate 사진은 따로: 하위 워커 작업 'flate-to-jpeg' → flate.ts recompressFlate.
export async function recompressJpeg(jpgBuf: ArrayBuffer, quality: number, maxSide: number): Promise<{ buf: ArrayBuffer; width: number; height: number } | null> {
  const before = jpgBuf.byteLength;
  const { img } = await decodeImage({ name: 'x.jpg', type: 'image/jpeg', buf: jpgBuf });
  const sized = await resizeImage(img, maxSide, maxSide);
  const buf = await encodeImage(sized, 'jpg', { quality });
  return buf.byteLength < before * 0.9 ? { buf, width: sized.width, height: sized.height } : null;
}

// 하위 워커 풀: 200쪽 스캔 PDF에서 사진 200장을 한 워커가 차례로 처리하느라 140초 걸렸다(devlog 12절)
async function subPool() {
  if (typeof Worker === 'undefined') return null; // 하위 워커를 못 만드는 환경: 차례로
  const { WorkerPool } = await import('../core/pool.ts');
  const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  // 하위 워커 하나당 최고 메모리 약 +0.5GB(실측: 1개 2.2GB·140초, 2개 3.2GB·75초, 3개 3.7GB·52초, 4개 4.1GB·41초)
  // → 기기 메모리 예산이 넉넉할 때만 늘린다. 휴대폰(예산 512MB)은 하위 워커 없이 차례로.
  const { memoryBudget } = await import('../core/imgsize.ts');
  const budgetMB = memoryBudget() / 1048576;
  const byMemory = budgetMB >= 1536 ? 4 : budgetMB >= 1024 ? 2 : 0;
  const size = Math.min(byMemory, hw - 2);
  if (size < 2) return null;
  return new WorkerPool({ size, create: () => new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' }) as never });
}

// Flate(무손실) 사진 중 풀 줄 아는 것만 매개변수로. 투명도·마스크·Decode 배열이 걸린 것, 다른 사진의 마스크인 것은 건너뜀.
async function flateParams(doc: Awaited<ReturnType<typeof load>>, dict: import('pdf-lib').PDFDict, masks: Set<string>, ref: import('pdf-lib').PDFRef): Promise<FlateParams | null> {
  const { PDFName, PDFNumber, PDFArray, PDFDict, PDFRawStream, PDFBool } = await lib();
  const get = (k: string) => { const v = dict.get(PDFName.of(k)); return v ? doc.context.lookup(v) : undefined; };
  const num = (v: unknown) => (v instanceof PDFNumber ? v.asNumber() : undefined);
  const one = (v: unknown) => (v instanceof PDFArray && v.size() === 1 ? doc.context.lookup(v.get(0)) : v); // [/FlateDecode] 같은 한 칸 배열
  if (one(get('Filter')) !== PDFName.of('FlateDecode')) return null;
  if (masks.has(ref.toString()) || get('SMask') || get('Mask') || get('Decode') || get('ImageMask') === PDFBool.True) return null;
  const width = num(get('Width')), height = num(get('Height')), bpc = num(get('BitsPerComponent'));
  if (!width || !height || bpc !== 8) return null;
  const cs = get('ColorSpace');
  let colors: 1 | 3 | undefined;
  if (cs === PDFName.of('DeviceRGB')) colors = 3;
  else if (cs === PDFName.of('DeviceGray')) colors = 1;
  else if (cs instanceof PDFArray && cs.size() === 2 && cs.get(0) === PDFName.of('ICCBased')) {
    const icc = doc.context.lookup(cs.get(1));
    const n = icc instanceof PDFRawStream ? num(doc.context.lookup(icc.dict.get(PDFName.of('N')))) : undefined;
    colors = n === 3 ? 3 : n === 1 ? 1 : undefined;
  }
  if (!colors) return null; // CMYK·색인 색 등
  const dp = one(get('DecodeParms'));
  const dget = (k: string) => (dp instanceof PDFDict ? num(doc.context.lookup(dp.get(PDFName.of(k)))) : undefined);
  return { width, height, colors, bpc, predictor: dget('Predictor') ?? 1, dpColors: dget('Colors'), dpBpc: dget('BitsPerComponent'), columns: dget('Columns') };
}

// 용량 줄이기: 내장 JPEG(DCTDecode) 이미지를 다시 압축·축소한다. 사진으로 판별된 Flate(무손실) 이미지는 JPEG로 바꾼다.
// 화면 캡처·글자·도표 같은 Flate 이미지와 글자는 그대로.
export const compress: OpRunner = async (inputs, o, ctx) => {
  const p = inputs[0]!;
  const { PDFName, PDFRawStream, PDFNumber, PDFRef } = await lib();
  const doc = await load(p);
  const quality = Math.min(95, Math.max(30, Number(o.quality ?? 70)));
  const maxSide = Math.max(600, Number(o.maxSide ?? 2000));
  // 0) 같은 사진 하나로(무손실). 합치기·여러 도구가 같은 사진을 쪽마다 따로 넣는다(시험 PDF: 12개 → 2개).
  //    다시 압축할 사진 수도 줄어 빨라진다.
  const deduped = await dedupeImages(doc);
  // 1) 다시 압축할 사진 고르기
  type Cand = { ref: Parameters<typeof doc.context.assign>[0]; dict: import('pdf-lib').PDFRawStream['dict']; bytes: Uint8Array; flate?: FlateParams };
  const cands: Cand[] = [];
  // 다른 사진의 투명도·마스크로 쓰이는 사진(회색 Flate라 사진처럼 보일 수 있다)은 건드리지 않는다
  const masks = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    for (const k of ['SMask', 'Mask']) { const m = obj.dict.get(PDFName.of(k)); if (m instanceof PDFRef) masks.add(m.toString()); }
  }
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    if (dict.get(PDFName.of('Filter')) !== PDFName.of('DCTDecode')) {
      const flate = await flateParams(doc, dict, masks, ref);
      if (flate) cands.push({ ref, dict, bytes: obj.contents, flate });
      continue; // 여러 필터가 겹친 것·다른 압축은 건너뜀
    }
    const cs = dict.get(PDFName.of('ColorSpace'));
    if (cs !== PDFName.of('DeviceRGB') && cs !== PDFName.of('DeviceGray')) continue; // CMYK 등은 색이 틀어질 수 있어 건너뜀
    cands.push({ ref, dict, bytes: obj.contents });
  }
  // 2) 여러 하위 워커로 나눠 다시 압축
  const pool = await subPool();
  let done = 0, replaced = 0, flateReplaced = 0, saved = 0;
  const one = async (c: Cand) => {
    // 차례가 왔을 때만 사본을 만든다. Flate는 매개변수를 옵션으로 실어 내부 작업 'flate-to-jpeg'로
    let r: { buf: ArrayBuffer; width: number; height: number } | null = null;
    try {
      if (pool) {
        const res = await pool.run(c.flate
          ? { op: 'flate-to-jpeg' as never, inputs: [{ name: 'x.bin', type: 'application/octet-stream', buf: c.bytes.slice().buffer as ArrayBuffer }], options: { quality, maxSide, ...c.flate } }
          : { op: 'jpeg-recompress' as never, inputs: [{ name: 'x.jpg', type: 'image/jpeg', buf: c.bytes.slice().buffer as ArrayBuffer }], options: { quality, maxSide } }).promise;
        if (res.outputs[0]) r = { buf: res.outputs[0].buf, width: Number(res.meta?.width), height: Number(res.meta?.height) };
      } else r = c.flate ? await recompressFlate(c.bytes, c.flate, quality, maxSide) : await recompressJpeg(c.bytes.slice().buffer as ArrayBuffer, quality, maxSide);
    } catch { /* 못 여는 사진은 그대로 둔다 */ }
    if (r) {
      const enc = new Uint8Array(r.buf);
      const newDict = c.dict.clone(doc.context);
      newDict.set(PDFName.of('Width'), PDFNumber.of(r.width));
      newDict.set(PDFName.of('Height'), PDFNumber.of(r.height));
      // Flate: 색 공간은 그대로(회색은 회색 JPEG, ICCBased는 프로필 유지). DCT는 예전처럼 RGB로 다시 만든다
      if (!c.flate) newDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      else { newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode')); flateReplaced++; }
      newDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      newDict.delete(PDFName.of('DecodeParms'));
      newDict.set(PDFName.of('Length'), PDFNumber.of(enc.byteLength));
      doc.context.assign(c.ref, PDFRawStream.of(newDict, enc));
      saved += c.bytes.byteLength - enc.byteLength;
      replaced++;
    }
    done++;
    ctx.progress(Math.min(0.9, done / Math.max(1, cands.length) * 0.9), `${done}/${cands.length}`);
  };
  try {
    // 줄 서기: 일꾼 수만큼만 동시에. 예전엔 Promise.all(cands.map(one))이라 사본 200개를 한꺼번에 만들었고(+369MB),
    // 풀이 없을 땐 주석과 달리 200장을 한 스레드에서 동시에 풀었다.
    let next = 0;
    const lane = async () => { while (next < cands.length) await one(cands[next++]!); };
    await Promise.all(Array.from({ length: pool ? pool.size : 1 }, lane));
  } finally {
    pool?.destroy();
  }
  const buf = await save(doc);
  const keep = buf.byteLength >= p.buf.byteLength;
  return {
    outputs: [keep ? p : { name: renameExt(p.name, 'pdf'), type: 'application/pdf', buf }],
    meta: { images: replaced, flateToJpeg: flateReplaced, deduped, savedBytes: saved, keptOriginal: keep, parallel: pool ? pool.size : 1 },
  };
};
