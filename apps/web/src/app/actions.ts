// 파일 종류 → 할 수 있는 작업. 문구는 사전 키로만 가리킨다(언어별 사전이 채움).
import { formatFromName, type Op } from '@fc/shared';
import type { Options } from '../core/types.ts';
import type { ActionId, Dict } from '../i18n/types.ts';

export type Kind = 'image' | 'pdf' | 'data' | 'video' | 'other';
const IMAGE = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'heic', 'psd', 'svg'];
const DATA = ['csv', 'tsv', 'json', 'yaml', 'xlsx'];
const VIDEO = ['mp4', 'mov', 'webm', 'm4a']; // m4a: 소리만 든 MP4

export function kindOf(name: string): Kind {
  const f = formatFromName(name);
  if (IMAGE.includes(f)) return 'image';
  if (f === 'pdf') return 'pdf';
  if (DATA.includes(f)) return 'data';
  if (VIDEO.includes(f)) return 'video';
  return 'other';
}

export function imageOp(name: string): Op {
  const f = formatFromName(name);
  return f === 'heic' ? 'heic' : f === 'psd' ? 'psd' : f === 'svg' ? 'svg' : 'image';
}

type FieldKey = keyof Dict['fields'];
export type Field =
  | { key: string; label: FieldKey; type: 'chips'; choices: { value: string; label: FieldKey | { raw: string }; hint?: string }[] }
  | { key: string; label: FieldKey; type: 'text'; placeholder: FieldKey };

export interface ActionDef {
  id: ActionId;
  kinds: Kind[];
  combine: boolean; // true면 파일 여러 개 → 결과 하나
  min?: number;
  fields: Field[];
  defaults: Options;
  op: (fileName: string) => Op;
}

const raw = (s: string) => ({ raw: s });
const formatChips = (formats: string[]) => formats.map(f => ({ value: f, label: raw(f.toUpperCase()) }));
const sizeChips = [
  { value: '', label: 'original' as FieldKey },
  { value: '3840', label: raw('4K') },
  { value: '1920', label: raw('FHD') },
  { value: '1080', label: raw('SNS') },
  { value: '640', label: 'small' as FieldKey },
];

export const ACTIONS: ActionDef[] = [
  {
    id: 'convert', kinds: ['image'], combine: false,
    fields: [
      { key: 'to', label: 'to', type: 'chips', choices: formatChips(['jpg', 'png', 'webp', 'avif']) },
      { key: 'maxWidth', label: 'width', type: 'chips', choices: sizeChips },
      { key: 'quality', label: 'quality', type: 'chips', choices: [{ value: '92', label: 'high' }, { value: '80', label: 'normal' }, { value: '65', label: 'small' }] },
    ],
    defaults: { to: 'jpg', maxWidth: '', quality: '80' },
    op: imageOp,
  },
  {
    id: 'compress', kinds: ['image'], combine: false,
    fields: [
      // 목표 SSIM은 형식마다 품질과 대응이 달라 실측(devlog 3절)을 보고 정했다
      { key: 'target', label: 'target', type: 'chips', choices: [
        { value: '0.985', label: 'nearOriginal', hint: 'SSIM 0.985' },
        { value: '0.97', label: 'balanced', hint: 'SSIM 0.97' },
        { value: '0.95', label: 'smallest', hint: 'SSIM 0.95' },
      ] },
      { key: 'to', label: 'to', type: 'chips', choices: [{ value: 'auto', label: 'auto' }, ...formatChips(['jpg', 'webp', 'avif'])] },
      { key: 'maxWidth', label: 'width', type: 'chips', choices: sizeChips },
    ],
    defaults: { target: '0.97', to: 'auto', maxWidth: '' },
    op: () => 'compress',
  },
  {
    id: 'image-to-pdf', kinds: ['image'], combine: true,
    fields: [{ key: 'pageSize', label: 'pageSize', type: 'chips', choices: [{ value: 'fit', label: 'fitPhoto' }, { value: 'a4', label: raw('A4') }] }],
    defaults: { pageSize: 'fit' },
    op: () => 'image-to-pdf',
  },
  { id: 'pdf-merge', kinds: ['pdf', 'image'], combine: true, min: 2, fields: [], defaults: {}, op: () => 'pdf-merge' },
  {
    id: 'pdf-compress', kinds: ['pdf'], combine: false,
    fields: [{ key: 'quality', label: 'pdfQuality', type: 'chips', choices: [{ value: '80', label: 'light' }, { value: '65', label: 'normal' }, { value: '45', label: 'strong' }] }],
    defaults: { quality: '65' },
    op: () => 'pdf-compress',
  },
  {
    id: 'pdf-to-image', kinds: ['pdf'], combine: false,
    fields: [
      { key: 'to', label: 'to', type: 'chips', choices: formatChips(['png', 'jpg', 'webp']) },
      { key: 'dpi', label: 'dpi', type: 'chips', choices: [{ value: '96', label: 'screen' }, { value: '150', label: 'normal' }, { value: '300', label: 'print' }] },
      { key: 'ranges', label: 'pages', type: 'text', placeholder: 'allPagesHint' },
    ],
    defaults: { to: 'png', dpi: '150', ranges: '' },
    op: () => 'pdf-to-image',
  },
  {
    id: 'pdf-split', kinds: ['pdf'], combine: false,
    fields: [{ key: 'ranges', label: 'ranges', type: 'text', placeholder: 'splitHint' }],
    defaults: { ranges: '' },
    op: () => 'pdf-split',
  },
  {
    id: 'data', kinds: ['data'], combine: false,
    fields: [{ key: 'to', label: 'to', type: 'chips', choices: formatChips(['xlsx', 'csv', 'json', 'yaml', 'tsv']) }],
    defaults: { to: 'xlsx' },
    op: () => 'data',
  },
  // 사진 속 글자 → 텍스트(한국어+영어). 학습 데이터 4.5MB는 처음 쓸 때만 받는다
  { id: 'ocr', kinds: ['image'], combine: false, fields: [], defaults: {}, op: () => 'ocr' },
  // 영상 → MP4·WebM·GIF, 소리만 → M4A. 크기는 짧은 변 기준(세로 영상도 같은 뜻), 초당 프레임은 GIF에만 쓰인다
  {
    id: 'video', kinds: ['video'], combine: false,
    fields: [
      { key: 'to', label: 'to', type: 'chips', choices: [...formatChips(['mp4', 'webm', 'gif']), { value: 'm4a', label: 'audioOnly' }] },
      { key: 'res', label: 'videoSize', type: 'chips', choices: [{ value: '', label: 'original' }, ...['1080', '720', '480'].map(v => ({ value: v, label: raw(`${v}p`) }))] },
      { key: 'fps', label: 'gifFps', type: 'chips', choices: ['5', '10', '15'].map(v => ({ value: v, label: raw(v) })) },
    ],
    defaults: { to: 'mp4', res: '', fps: '10' },
    op: () => 'video',
  },
];

export const actionById = (id: string) => ACTIONS.find(a => a.id === id);

// 지금 파일들에 맞는 작업(맞는 파일 수가 많은 순). 첫 번째가 기본 선택.
export function actionsFor(kinds: Kind[]): ActionDef[] {
  const count = (a: ActionDef) => kinds.filter(k => a.kinds.includes(k)).length;
  const pdfs = kinds.filter(k => k === 'pdf').length;
  return ACTIONS
    .filter(a => count(a) > 0 && count(a) >= (a.min ?? 1))
    .filter(a => a.id !== 'pdf-merge' || pdfs >= 1) // 사진만 여러 장이면 'PDF로 묶기'가 맞다
    .sort((a, b) => {
      if (pdfs >= 2) { if (a.id === 'pdf-merge') return -1; if (b.id === 'pdf-merge') return 1; }
      return count(b) - count(a);
    });
}

// 데이터 파일의 기본 저장 형식: 엑셀이면 CSV, 아니면 엑셀. JPG만 있으면 WebP.
export function smartDefaults(action: ActionDef, names: string[]): Options {
  const d = { ...action.defaults };
  if (action.id === 'data' && names.length && names.every(n => formatFromName(n) === 'xlsx')) d.to = 'csv';
  if (action.id === 'convert' && names.length && names.every(n => formatFromName(n) === 'jpg')) d.to = 'webp';
  if (action.id === 'video' && names.length && names.every(n => formatFromName(n) === 'm4a')) d.to = 'webm'; // 소리만 든 파일 → Opus
  return d;
}

// 화면 옵션(문자열) → 변환기 옵션(숫자 등)
export function toRunOptions(action: ActionDef, o: Options, fileName: string, lang: string): Options {
  const out: Options = { lang };
  for (const [k, v] of Object.entries(o)) {
    if (v === '' || v === undefined) continue;
    out[k] = typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  if (action.id === 'compress' && out.to === 'auto') delete out.to;
  if (action.id === 'convert' && formatFromName(fileName) === 'svg' && !out.maxWidth) out.maxWidth = 2048;
  return out;
}
