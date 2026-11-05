import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRanges, merge, split, imagesToPdf } from './pdf.ts';

const ctx = { progress() {} };
async function makePdf(pages: number, w = 200) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([w + i, 300]);
  const b = await d.save();
  return { name: `doc${pages}.pdf`, type: 'application/pdf', buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
}
const pageWidths = async (buf: ArrayBuffer) => (await PDFDocument.load(buf)).getPages().map(p => Math.round(p.getWidth()));

describe('parseRanges', () => {
  it('여러 형태', () => {
    expect(parseRanges('1-3,5', 10)).toEqual([[0, 1, 2], [4]]);
    expect(parseRanges('8-', 10)).toEqual([[7, 8, 9]]);
    expect(parseRanges('-2', 10)).toEqual([[0, 1]]);
    expect(parseRanges(' 2 - 4 ', 3)).toEqual([[1, 2]]); // 범위 넘으면 잘라냄
  });
  it('잘못된 입력', () => {
    expect(() => parseRanges('abc', 5)).toThrow();
    expect(() => parseRanges('9-12', 5)).toThrow(); // 남는 페이지 없음
  });
});

describe('PDF 작업', () => {
  it('합치기: 순서 유지', async () => {
    const r = await merge([await makePdf(2, 100), await makePdf(3, 400)], {}, ctx);
    expect(await pageWidths(r.outputs[0]!.buf)).toEqual([100, 101, 400, 401, 402]);
  });
  it('나누기: 범위별', async () => {
    const r = await split([await makePdf(5)], { ranges: '1-2,5' }, ctx);
    expect(r.outputs.map(o => o.name)).toEqual(['doc5_p1-2.pdf', 'doc5_p5.pdf']);
    expect(await pageWidths(r.outputs[1]!.buf)).toEqual([204]);
  });
  it('나누기: 기본은 한 쪽씩', async () => {
    const r = await split([await makePdf(3)], {}, ctx);
    expect(r.outputs).toHaveLength(3);
  });
  it('PNG → PDF: 원본 크기 페이지, A4 옵션', async () => {
    const png = readFileSync(fileURLToPath(new URL('../../test/fixtures/ssim/ref.png', import.meta.url)));
    const input = { name: 'a.png', type: 'image/png', buf: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer };
    const fit = await imagesToPdf([input], {}, ctx);
    expect(await pageWidths(fit.outputs[0]!.buf)).toEqual([256]);
    const a4 = await imagesToPdf([{ ...input, buf: input.buf.slice(0) }], { pageSize: 'a4' }, ctx);
    expect(await pageWidths(a4.outputs[0]!.buf)).toEqual([595]);
  });
  it('망가진 PDF는 decode 오류', async () => {
    await expect(split([{ name: 'x.pdf', type: 'application/pdf', buf: new TextEncoder().encode('%PDF-1.4 garbage').buffer as ArrayBuffer }], {}, ctx)).rejects.toMatchObject({ code: 'decode' });
  });
});
