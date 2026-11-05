// 공통 랜딩 조립기: 언어별로 문장 묶음(Pack)만 채우면 된다(8개 언어가 같은 구조를 공유해 내용이 어긋나지 않게).
import type { LandingTemplates, Fmt, LandingKind } from './landings.ts';
import type { LandingCopy } from './types.ts';

type QA = { q: string; a: string };
export interface Pack {
  name: Record<Fmt, string>;
  facts: Record<Fmt, string>;
  privacy: QA; cost: QA; mobile: QA;
  convert: { title(f: string, t: string): string; meta(f: string, t: string): string; tail(f: string, t: string): string; steps(f: string, t: string): [string, string, string]; lossless: QA; lossy(t: string): QA; orientation: QA };
  compress: { title(f: string | null): string; meta(f: string | null): string; intro: string; pngNote: string; steps: [string, string, string]; howMuch: QA; batch: QA };
  resize: { title: string; meta: string; intro: string; steps: [string, string, string]; ratio: QA };
  merge: { title: string; meta: string; intro: string; steps: [string, string, string]; encrypted: QA };
  split: { title: string; meta: string; intro: string; steps: [string, string, string]; quality: QA };
  compressPdf: { title: string; meta: string; intro: string; steps: [string, string, string]; blurry: QA; which: QA };
  pdfToImage: { title(t: string): string; meta(t: string): string; intro(t: string): string; steps(t: string): [string, string, string]; dpi: QA };
  imagesToPdf: { title: string; meta: string; intro: string; steps: [string, string, string]; blurry: QA };
  data: { title(f: string, t: string): string; meta(f: string, t: string): string; tail: string; steps(f: string, t: string): [string, string, string]; excel: QA; nested: QA };
}

export function fromPack(p: Pack): LandingTemplates {
  const n = p.name;
  const build = (d: LandingKind): LandingCopy => {
    switch (d.kind) {
      case 'convert': {
        const f = n[d.from], t = n[d.to];
        return {
          title: p.convert.title(f, t), metaDescription: p.convert.meta(f, t),
          intro: `${p.facts[d.from]} ${p.facts[d.to]} ${p.convert.tail(f, t)}`,
          steps: p.convert.steps(f, t),
          faq: [p.privacy, d.to === 'png' ? p.convert.lossless : p.convert.lossy(t), ...(d.from === 'heic' ? [p.convert.orientation] : []), p.mobile, p.cost],
        };
      }
      case 'compress': {
        const f = d.fmt ? n[d.fmt] : null;
        return { title: p.compress.title(f), metaDescription: p.compress.meta(f), intro: p.compress.intro + (d.fmt === 'png' ? ` ${p.compress.pngNote}` : ''), steps: p.compress.steps, faq: [p.privacy, p.compress.howMuch, p.compress.batch, p.mobile] };
      }
      case 'resize': return { title: p.resize.title, metaDescription: p.resize.meta, intro: p.resize.intro, steps: p.resize.steps, faq: [p.privacy, p.resize.ratio, p.mobile, p.cost] };
      case 'merge-pdf': return { title: p.merge.title, metaDescription: p.merge.meta, intro: p.merge.intro, steps: p.merge.steps, faq: [p.privacy, p.merge.encrypted, p.cost] };
      case 'split-pdf': return { title: p.split.title, metaDescription: p.split.meta, intro: p.split.intro, steps: p.split.steps, faq: [p.privacy, p.split.quality, p.cost] };
      case 'compress-pdf': return { title: p.compressPdf.title, metaDescription: p.compressPdf.meta, intro: p.compressPdf.intro, steps: p.compressPdf.steps, faq: [p.privacy, p.compressPdf.blurry, p.compressPdf.which, p.cost] };
      case 'pdf-to-image': {
        const t = n[d.to];
        return { title: p.pdfToImage.title(t), metaDescription: p.pdfToImage.meta(t), intro: `${p.pdfToImage.intro(t)} ${p.facts[d.to]}`, steps: p.pdfToImage.steps(t), faq: [p.privacy, p.pdfToImage.dpi, p.cost] };
      }
      case 'images-to-pdf': return { title: p.imagesToPdf.title, metaDescription: p.imagesToPdf.meta, intro: p.imagesToPdf.intro, steps: p.imagesToPdf.steps, faq: [p.privacy, p.imagesToPdf.blurry, p.mobile] };
      case 'data': {
        const f = n[d.from], t = n[d.to];
        return { title: p.data.title(f, t), metaDescription: p.data.meta(f, t), intro: `${p.facts[d.from]} ${p.facts[d.to]} ${p.data.tail}`, steps: p.data.steps(f, t), faq: [p.privacy, p.data.excel, p.data.nested] };
      }
    }
  };
  return { name: p.name, facts: p.facts, build };
}
