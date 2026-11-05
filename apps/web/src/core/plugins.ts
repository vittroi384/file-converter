// 변환기 플러그인 등록부(명세만). 실행부는 load()가 쓸 때만 불러온다.
import type { Format, Op } from '@fc/shared';
import { object, v, type ConverterPlugin, type InputInfo } from './plugin.ts';
import type { Options } from './types.ts';
import type { FlateParams } from '../ops/flate.ts';

const MB = 1024 * 1024;
const IMG_IN: Format[] = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'heic', 'psd', 'svg'];
const DATA: Format[] = ['csv', 'tsv', 'json', 'yaml', 'xlsx'];
const VIDEO: Format[] = ['mp4', 'mov', 'webm', 'm4a'];
const lang = v.str(/^[a-z]{2}$/, 'en');

// 메모리 예상: 크기를 알면 RGBA × 배수(실측 devlog 12절: 디코드 사본·캔버스·WASM 힙), 모르면 파일 크기 × 배수
// 크기 줄이기(maxWidth·maxHeight)를 골랐으면 디코드 때 목표의 2배로 미리 줄이므로(codecs.prescaleFor) 그만큼 덜 든다
function imageCost(mult: number) {
  return (ins: InputInfo[], o: Options = {}) => ins.reduce((s, i) => {
    if (!(i.width && i.height)) return s + i.bytes * 20 + 32 * MB;
    const mw = Number(o.maxWidth) || Infinity, mh = Number(o.maxHeight) || Infinity;
    const k = Math.min(1, (2 * mw) / i.width, (2 * mh) / i.height);
    return s + i.width * i.height * k * k * 4 * mult + 32 * MB;
  }, 0);
}
const pdfCost = (ins: InputInfo[]) => ins.reduce((s, i) => s + i.bytes * 5, 0) + 64 * MB; // pdf-lib는 문서 전체를 메모리에

const imageOpts = object({
  to: v.enumOf(['jpg', 'png', 'webp', 'avif'] as const, 'png'),
  quality: v.num(1, 100, 80),
  maxWidth: v.optNum(16, 20000), maxHeight: v.optNum(16, 20000),
  engine: v.enumOf(['wasm', 'native'] as const, 'wasm'),
  lang,
});
const imagePlugin = (id: Op, inputs: Format[]): ConverterPlugin => ({
  id, inputs, arity: 'one', outputs: o => [String(o.to ?? 'png') as Format], validate: imageOpts, cost: imageCost(6),
  load: () => import('../ops/image.ts').then(m => m.run),
});
const pdf = () => import('../ops/pdf.ts');

// 영상 시간 초과: 기본 5분 + MB당 6초, 최대 30분. 작업 전엔 머리만 읽어 길이를 모르므로 파일 크기로 잡는다
// (5분 고정이면 큰 영상 재인코딩이 끝나기 전에 끊긴다). 멈춘 작업을 끊는 안전장치라 넉넉하게.
export function videoTimeoutMs(ins: InputInfo[]) {
  const mb = ins.reduce((s, i) => s + i.bytes, 0) / MB;
  return Math.min(30 * 60_000, 5 * 60_000 + mb * 6_000);
}

export const PLUGINS: ConverterPlugin[] = [
  imagePlugin('image', ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp']),
  imagePlugin('heic', ['heic']),
  imagePlugin('psd', ['psd']),
  imagePlugin('svg', ['svg']),
  {
    id: 'compress', inputs: IMG_IN, arity: 'one',
    outputs: o => [String(o.to ?? 'jpg') as Format],
    // parallel: 화면이 파일 하나만 압축할 때 준다(ops/compress.ts가 하위 워커로 후보를 동시에 잰다)
    validate: object({ target: v.num(0.8, 0.999, 0.97), to: v.optEnum(['jpg', 'webp', 'avif'] as const), maxWidth: v.optNum(16, 20000), maxHeight: v.optNum(16, 20000), parallel: v.bool(false), lang }),
    cost: imageCost(8), load: () => import('../ops/compress.ts').then(m => m.run),
  },
  { id: 'pdf-merge', inputs: ['pdf', ...IMG_IN], arity: 'many', outputs: () => ['pdf'], validate: object({ lang }), cost: pdfCost, load: () => pdf().then(m => m.merge) },
  { id: 'pdf-split', inputs: ['pdf'], arity: 'one', outputs: () => ['pdf'], validate: object({ ranges: v.str(/^(each|[\d\s,-]*)$/), lang }), cost: pdfCost, load: () => pdf().then(m => m.split) },
  {
    id: 'pdf-to-image', inputs: ['pdf'], arity: 'one', outputs: o => [String(o.to ?? 'png') as Format],
    validate: object({ to: v.enumOf(['png', 'jpg', 'webp'] as const, 'png'), dpi: v.num(36, 300, 150), quality: v.num(1, 100, 90), ranges: v.str(/^[\d\s,-]*$/), lang }),
    cost: (ins, o) => pdfCost(ins) + (Number(o.dpi ?? 150) / 72) ** 2 * 612 * 792 * 4 * 3, load: () => pdf().then(m => m.toImages),
  },
  { id: 'image-to-pdf', inputs: IMG_IN, arity: 'many', outputs: () => ['pdf'], validate: object({ pageSize: v.enumOf(['fit', 'a4'] as const, 'fit'), lang }), cost: imageCost(3), load: () => pdf().then(m => m.imagesToPdf) },
  {
    id: 'pdf-compress', inputs: ['pdf'], arity: 'one', outputs: () => ['pdf'],
    validate: object({ quality: v.num(30, 95, 70), maxSide: v.num(600, 10000, 2000), lang }), cost: pdfCost, load: () => pdf().then(m => m.compress),
  },
  {
    id: 'data', inputs: DATA, arity: 'one', outputs: o => [String(o.to ?? 'json') as Format],
    validate: object({ to: v.enumOf(['csv', 'tsv', 'json', 'yaml', 'xlsx'] as const, 'json'), typed: v.bool(true), bom: v.bool(true), lang }),
    cost: ins => ins.reduce((s, i) => s + i.bytes * 8, 0) + 32 * MB, load: () => import('../ops/data.ts').then(m => m.run),
  },
  // 사진 속 글자 인식(한국어+영어) → .txt
  { id: 'ocr', inputs: IMG_IN, arity: 'one', mainThread: true, outputs: () => ['txt'], validate: object({ lang }), cost: imageCost(4), load: () => import('../ops/ocr.ts').then(m => m.run) },
  // 영상·음성(WebCodecs). 파일 전체를 메모리에 두고 디코드 프레임 몇 장 + 결과물이 더해진다
  {
    id: 'video', inputs: VIDEO, arity: 'one', outputs: o => [String(o.to ?? 'mp4') as Format],
    validate: object({ to: v.enumOf(['mp4', 'webm', 'gif', 'm4a'] as const, 'mp4'), res: v.optNum(144, 4320), fps: v.num(1, 30, 10), lang }),
    cost: ins => ins.reduce((s, i) => s + i.bytes * 3, 0) + 192 * MB, timeoutMs: videoTimeoutMs, load: () => import('../ops/video.ts').then(m => m.run),
  },
  // 내부: PDF 용량 줄이기가 하위 워커로 보내는 사진 한 장 다시 압축
  {
    id: 'jpeg-recompress', inputs: ['jpg'], arity: 'one', internal: true, outputs: () => ['jpg'],
    validate: object({ quality: v.num(30, 95, 70), maxSide: v.num(600, 10000, 2000) }), cost: imageCost(5),
    load: () => pdf().then(m => async (inputs, o) => {
      const r = await m.recompressJpeg(inputs[0]!.buf, Number(o.quality), Number(o.maxSide));
      return r ? { outputs: [{ name: 'x.jpg', type: 'image/jpeg', buf: r.buf }], meta: { width: r.width, height: r.height } } : { outputs: [] };
    }),
  },
  // 내부: PDF 용량 줄이기가 하위 워커로 보내는 Flate(무손실) 사진 한 장 → JPEG. 입력은 압축된 원본, 풀 매개변수는 옵션으로
  {
    id: 'flate-to-jpeg', inputs: [], arity: 'one', internal: true, outputs: () => ['jpg'],
    validate: object({
      quality: v.num(30, 95, 70), maxSide: v.num(600, 10000, 2000),
      width: v.num(1, 100000), height: v.num(1, 100000), colors: (x, p) => (x === 1 || x === 3 ? { ok: true, value: x } : { ok: false, error: `${p}: 1|3` }),
      bpc: v.num(1, 16), predictor: v.num(1, 15), dpColors: v.optNum(1, 4), dpBpc: v.optNum(1, 16), columns: v.optNum(1, 100000),
    }),
    cost: ins => ins.reduce((s, i) => s + i.bytes * 20, 0) + 32 * MB,
    load: () => import('../ops/flate.ts').then(m => async (inputs, o) => {
      const r = await m.recompressFlate(new Uint8Array(inputs[0]!.buf), o as unknown as FlateParams, Number(o.quality), Number(o.maxSide));
      return r ? { outputs: [{ name: 'x.jpg', type: 'image/jpeg', buf: r.buf }], meta: { width: r.width, height: r.height } } : { outputs: [] };
    }),
  },
  // 내부: 스마트 압축이 하위 워커로 보내는 후보 하나(RGBA → q로 인코딩 + SSIM)
  {
    id: 'compress-probe', inputs: [], arity: 'one', internal: true, outputs: o => [String(o.to) as Format],
    validate: object({ width: v.num(1, 20000), height: v.num(1, 20000), to: v.enumOf(['jpg', 'webp', 'avif'] as const), q: v.num(1, 100) }), cost: imageCost(6),
    load: () => import('../ops/compress.ts').then(m => m.probe),
  },
];

const BY_ID = new Map(PLUGINS.map(p => [p.id, p]));
export const pluginById = (id: string) => BY_ID.get(id);
