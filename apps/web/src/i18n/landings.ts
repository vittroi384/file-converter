// 기능별 랜딩 페이지 정의(주소 → 작업·미리 고른 옵션). 문구는 언어별 틀(landing.<언어>.ts)이 만든다.
import type { ActionId, LandingCopy } from './types.ts';

export type Fmt = 'heic' | 'jpg' | 'png' | 'webp' | 'avif' | 'psd' | 'svg' | 'pdf' | 'xlsx' | 'csv' | 'json' | 'yaml';
export type LandingKind =
  | { kind: 'convert'; from: Fmt; to: Fmt }
  | { kind: 'compress'; fmt?: Fmt }
  | { kind: 'resize' }
  | { kind: 'merge-pdf' } | { kind: 'split-pdf' } | { kind: 'compress-pdf' }
  | { kind: 'pdf-to-image'; to: Fmt }
  | { kind: 'images-to-pdf'; from: Fmt }
  | { kind: 'data'; from: Fmt; to: Fmt };

export interface LandingDef {
  slug: string;
  def: LandingKind;
  action: ActionId;
  preset: Record<string, string>; // 이 페이지로 들어오면 미리 골라 둘 옵션
  accept: string; // 파일 고르기 창의 형식 필터
  related: string[];
}

const IMG = 'image/*,.heic,.heif,.psd,.svg';
const conv = (from: Fmt, to: Fmt, related: string[]): LandingDef => ({
  slug: `${from}-to-${to}`, def: { kind: 'convert', from, to }, action: 'convert', preset: { to }, accept: IMG, related,
});
const data = (from: Fmt, to: Fmt, related: string[]): LandingDef => ({
  slug: `${from === 'xlsx' ? 'excel' : from}-to-${to === 'xlsx' ? 'excel' : to}`, def: { kind: 'data', from, to }, action: 'data', preset: { to }, accept: '.xlsx,.csv,.tsv,.json,.yaml,.yml', related,
});

export const LANDINGS: LandingDef[] = [
  conv('heic', 'jpg', ['heic-to-png', 'compress-image', 'jpg-to-pdf']),
  conv('heic', 'png', ['heic-to-jpg', 'png-to-jpg', 'compress-png']),
  conv('png', 'jpg', ['jpg-to-png', 'compress-jpg', 'png-to-webp']),
  conv('jpg', 'png', ['png-to-jpg', 'jpg-to-webp', 'compress-png']),
  conv('webp', 'jpg', ['jpg-to-webp', 'avif-to-jpg', 'png-to-jpg']),
  conv('jpg', 'webp', ['webp-to-jpg', 'jpg-to-avif', 'compress-image']),
  conv('png', 'webp', ['jpg-to-webp', 'compress-png', 'png-to-jpg']),
  conv('avif', 'jpg', ['jpg-to-avif', 'webp-to-jpg', 'heic-to-jpg']),
  conv('jpg', 'avif', ['avif-to-jpg', 'jpg-to-webp', 'compress-image']),
  conv('psd', 'png', ['png-to-jpg', 'svg-to-png', 'compress-png']),
  conv('svg', 'png', ['psd-to-png', 'png-to-jpg', 'png-to-webp']),
  { slug: 'compress-image', def: { kind: 'compress' }, action: 'compress', preset: { target: '0.97', to: 'auto' }, accept: IMG, related: ['compress-jpg', 'compress-png', 'resize-image'] },
  { slug: 'compress-jpg', def: { kind: 'compress', fmt: 'jpg' }, action: 'compress', preset: { target: '0.97', to: 'jpg' }, accept: 'image/jpeg,.jpg,.jpeg', related: ['compress-image', 'jpg-to-webp', 'resize-image'] },
  { slug: 'compress-png', def: { kind: 'compress', fmt: 'png' }, action: 'compress', preset: { target: '0.97', to: 'webp' }, accept: 'image/png,.png', related: ['png-to-webp', 'png-to-jpg', 'compress-image'] },
  { slug: 'resize-image', def: { kind: 'resize' }, action: 'convert', preset: { maxWidth: '1920' }, accept: IMG, related: ['compress-image', 'jpg-to-webp', 'heic-to-jpg'] },
  { slug: 'merge-pdf', def: { kind: 'merge-pdf' }, action: 'pdf-merge', preset: {}, accept: '.pdf,application/pdf,image/*', related: ['split-pdf', 'compress-pdf', 'jpg-to-pdf'] },
  { slug: 'split-pdf', def: { kind: 'split-pdf' }, action: 'pdf-split', preset: {}, accept: '.pdf,application/pdf', related: ['merge-pdf', 'pdf-to-jpg', 'compress-pdf'] },
  { slug: 'compress-pdf', def: { kind: 'compress-pdf' }, action: 'pdf-compress', preset: { quality: '65' }, accept: '.pdf,application/pdf', related: ['merge-pdf', 'pdf-to-jpg', 'compress-image'] },
  { slug: 'pdf-to-jpg', def: { kind: 'pdf-to-image', to: 'jpg' }, action: 'pdf-to-image', preset: { to: 'jpg', dpi: '150' }, accept: '.pdf,application/pdf', related: ['pdf-to-png', 'split-pdf', 'jpg-to-pdf'] },
  { slug: 'pdf-to-png', def: { kind: 'pdf-to-image', to: 'png' }, action: 'pdf-to-image', preset: { to: 'png', dpi: '150' }, accept: '.pdf,application/pdf', related: ['pdf-to-jpg', 'split-pdf', 'merge-pdf'] },
  { slug: 'jpg-to-pdf', def: { kind: 'images-to-pdf', from: 'jpg' }, action: 'image-to-pdf', preset: { pageSize: 'fit' }, accept: IMG, related: ['merge-pdf', 'heic-to-jpg', 'compress-pdf'] },
  data('xlsx', 'csv', ['csv-to-excel', 'excel-to-json', 'csv-to-json']),
  data('csv', 'xlsx', ['excel-to-csv', 'csv-to-json', 'json-to-csv']),
  data('csv', 'json', ['json-to-csv', 'csv-to-excel', 'excel-to-json']),
  data('json', 'csv', ['csv-to-json', 'json-to-yaml', 'csv-to-excel']),
  data('xlsx', 'json', ['excel-to-csv', 'json-to-csv', 'csv-to-json']),
  data('json', 'yaml', ['json-to-csv', 'csv-to-json', 'excel-to-json']),
];

export const landingBySlug = (slug: string) => LANDINGS.find(l => l.slug === slug);

// 언어별 문장 틀. 형식별 사실(facts)을 끼워 구체적인 글이 되게 한다(AI 답변·검색 인용용).
export interface LandingTemplates {
  name: Record<Fmt, string>;
  facts: Record<Fmt, string>;
  build(d: LandingKind): LandingCopy;
}
