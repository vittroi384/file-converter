// 같은 사진(이미 작게 압축된 JPEG)을 12쪽에 따로따로 넣은 PDF: 다시 압축으론 안 줄고, 중복 제거로만 준다.
// 실행: node tools/make-dup-pdf.mjs → e2e/fixtures/dup-images.pdf
import { PDFDocument } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'node:fs';
const jpg = readFileSync('apps/web/public/demo/market-before.jpg'); // 400KB, 품질 92
const small = readFileSync('e2e/fixtures/photo.jpg');
const doc = await PDFDocument.create();
for (let i = 0; i < 12; i++) {
  const img = await doc.embedJpg(i % 2 ? small : jpg); // 같은 바이트를 매번 따로 넣는다(합치기·도구들이 흔히 이렇게 만든다)
  const page = doc.addPage([img.width / 2, img.height / 2]);
  page.drawImage(img, { x: 0, y: 0, width: img.width / 2, height: img.height / 2 });
}
const out = await doc.save();
writeFileSync('e2e/fixtures/dup-images.pdf', out);
console.log('dup-images.pdf', out.length, 'bytes (사진 2종 × 6번)');
