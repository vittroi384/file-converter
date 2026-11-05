// PDF 용량 줄이기 Flate → JPEG 시험: Flate 사진·화면 캡처가 섞인 PDF를 만들어 compress 전후 크기와 바뀐 사진을 보인다.
// 실행: node bench/flate-pdf-demo.ts            → 시험 PDF 3개 결과 표
//       node bench/flate-pdf-demo.ts --fixture  → e2e/fixtures/flate-mixed.pdf 도 만든다(사진 1쪽 + 화면 캡처 1쪽)
// 사진 넣는 방식 두 가지: pdf-lib embedPng(예측 없는 Flate) / PNG의 IDAT를 그대로(Predictor 15, 많은 PDF 도구가 이렇게 넣는다).
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFRawStream, PDFNumber } from 'pdf-lib';
import { PNG } from 'pngjs';
import { initCodecs } from './codecs-node.ts';
import { compress } from '../apps/web/src/ops/pdf.ts';

await initCodecs();
const ctx = { progress() {} };
const H = 'bench/data/pdf-flate/holdout/graphic/';

// PNG 파일 → IDAT를 이은 zlib 스트림(필터 바이트 포함) = Flate + Predictor 15. 회색은 pngjs로 다시 만들어서.
// icc: 색 공간을 [/ICCBased 프로필]로(bench/data/pdf-flate/srgb.icc, Pillow로 만든 sRGB 프로필)
function idatImage(doc: PDFDocument, path: string, gray = false, icc = false) {
  let png = readFileSync(path);
  if (gray) {
    const p = PNG.sync.read(png);
    const g = new PNG({ width: p.width, height: p.height, colorType: 0, inputColorType: 6, inputHasAlpha: true });
    p.data.copy(g.data);
    for (let i = 0; i < p.data.length; i += 4) { const v = Math.round(0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]!); g.data[i] = g.data[i + 1] = g.data[i + 2] = v; }
    png = PNG.sync.write(g, { colorType: 0, inputColorType: 6 });
  }
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20), ct = png[25]!;
  if (png[24] !== 8 || (ct !== 0 && ct !== 2) || png[28] !== 0) throw new Error(`${path}: 8비트 회색/RGB, 비월간 PNG만`);
  const parts: Buffer[] = [];
  for (let o = 8; o < png.length;) { const len = png.readUInt32BE(o), type = png.toString('latin1', o + 4, o + 8); if (type === 'IDAT') parts.push(png.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const colors = ct === 0 ? 1 : 3;
  const stream = PDFRawStream.of(doc.context.obj({
    Type: 'XObject', Subtype: 'Image', Width: w, Height: h, BitsPerComponent: 8,
    ColorSpace: icc ? [PDFName.of('ICCBased'), doc.context.register(doc.context.flateStream(readFileSync('bench/data/pdf-flate/srgb.icc'), { N: colors }))] : colors === 1 ? 'DeviceGray' : 'DeviceRGB',
    Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: colors, BitsPerComponent: 8, Columns: w },
  }), new Uint8Array(Buffer.concat(parts)));
  return { ref: doc.context.register(stream), width: w, height: h };
}

type How = 'embed' | 'idat' | 'idat-gray' | 'idat-icc';
async function build(pages: { path: string; how: How }[]) {
  const doc = await PDFDocument.create();
  for (const pg of pages) {
    const page = doc.addPage();
    if (pg.how === 'embed') {
      const img = await doc.embedPng(readFileSync(pg.path));
      page.setSize(img.width, img.height); page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      const { ref, width, height } = idatImage(doc, pg.path, pg.how === 'idat-gray', pg.how === 'idat-icc');
      page.setSize(width, height);
      const name = page.node.newXObject('Im', ref);
      const content = doc.context.flateStream(`q ${width} 0 0 ${height} 0 0 cm /${name.asString().slice(1)} Do Q`);
      page.node.set(PDFName.of('Contents'), doc.context.register(content));
    }
  }
  return doc.save();
}

type Img = { filter: string; w: number; h: number; bytes: number };
// 사진 개체 번호 → 정보(compress는 같은 번호에 바꿔 넣는다)
async function images(buf: Uint8Array): Promise<Map<string, Img>> {
  const d = await PDFDocument.load(buf);
  const out = new Map<string, Img>();
  for (const [ref, o] of d.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFRawStream) || o.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const n = (k: string) => (o.dict.get(PDFName.of(k)) as PDFNumber).asNumber();
    out.set(ref.toString(), { filter: String(o.dict.get(PDFName.of('Filter'))), w: n('Width'), h: n('Height'), bytes: o.contents.length });
  }
  return out;
}

const SAMPLES: Record<string, { path: string; how: How }[]> = {
  'mixed (embedPng)': [
    { path: 'bench/data/kodak/kodim05.png', how: 'embed' }, { path: H + 'article@1x.png', how: 'embed' },
    { path: 'bench/data/kodak/kodim13.png', how: 'embed' }, { path: H + 'dashboard@1x.png', how: 'embed' }, { path: H + 'slide@1x.png', how: 'embed' },
  ],
  'predictor 15 (IDAT)': [
    { path: 'bench/data/kodak/kodim21.png', how: 'idat' }, { path: 'bench/data/kodak/kodim14.png', how: 'idat-gray' },
    { path: H + 'code@1x.png', how: 'idat' }, { path: H + 'invoice@2x.png', how: 'idat' },
  ],
  // ICCBased 사진은 JPEG로(프로필 유지), 투명도(SMask) 있는 사진과 그 마스크는 그대로
  'icc+alpha': [{ path: 'bench/data/kodak/kodim17.png', how: 'idat-icc' }, { path: 'bench/data/pdf-flate/kodim07-alpha.png', how: 'embed' }],
  'phone-scan style (big photos)': [
    { path: 'bench/data/pdf-flate/holdout/photo/picsum-34.png', how: 'embed' }, { path: 'bench/data/pdf-flate/holdout/photo/picsum-50.png', how: 'idat' },
    { path: 'bench/data/pdf-flate/holdout/photo/picsum-44.png', how: 'embed' },
  ],
};

for (const [name, pages] of Object.entries(SAMPLES)) {
  const before = await build(pages);
  const t = performance.now();
  const r = await compress([{ name: 'x.pdf', type: 'application/pdf', buf: before.buffer.slice(before.byteOffset, before.byteOffset + before.byteLength) as ArrayBuffer }], {}, ctx);
  const ms = performance.now() - t;
  const after = new Uint8Array(r.outputs[0]!.buf);
  console.log(`\n## ${name}: ${(before.length / 1024).toFixed(0)}KB → ${(after.length / 1024).toFixed(0)}KB (${Math.round(after.length / before.length * 100)}%), ${ms.toFixed(0)}ms`, JSON.stringify(r.meta));
  const a = await images(before), b = await images(after);
  for (const [ref, x] of a) { const y = b.get(ref)!; console.log(`  ${ref.padEnd(7)} ${x.w}x${x.h}  ${x.filter} ${(x.bytes / 1024).toFixed(0)}KB → ${y.filter} ${(y.bytes / 1024).toFixed(0)}KB`); }
  console.log('  pages', (await PDFDocument.load(after)).getPageCount(), '/', pages.length);
  const slug = name.split(' ')[0];
  writeFileSync(`bench/out/flate-${slug}-before.pdf`, before); writeFileSync(`bench/out/flate-${slug}-after.pdf`, after); // 렌더 비교용(PyMuPDF)
}

if (process.argv.includes('--fixture')) {
  const pdf = await build([{ path: 'bench/data/kodak/kodim05.png', how: 'embed' }, { path: H + 'article@1x.png', how: 'embed' }]);
  writeFileSync('e2e/fixtures/flate-mixed.pdf', pdf);
  console.log('\ne2e/fixtures/flate-mixed.pdf', pdf.length, 'bytes (사진 768x512 + 화면 캡처 1200x800, 둘 다 Flate)');
}
