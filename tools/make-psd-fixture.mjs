// e2e용 PSD(합성 이미지 포함 / 미포함 두 종) 생성. 실행: node tools/make-psd-fixture.mjs <출력 폴더>
import { writeFileSync } from 'node:fs';
import { writePsdBuffer } from 'ag-psd';
const out = process.argv[2];
const px = (w, h, rgba) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) d.set(rgba, i); return { width: w, height: h, data: d }; };
const layers = [
  { name: '배경', imageData: px(200, 150, [240, 240, 240, 255]), left: 0, top: 0 },
  { name: '파랑', imageData: px(100, 80, [59, 91, 253, 255]), left: 30, top: 30 },
];
// 합성본은 실제 PSD처럼 한 색이 아니게(가로 그라데이션: 빨강 = x, 초록 = y, 파랑 = 255)
const grad = { width: 200, height: 150, data: new Uint8ClampedArray(200 * 150 * 4) };
for (let y = 0; y < 150; y++) for (let x = 0; x < 200; x++) grad.data.set([x, y, 255, 255], (y * 200 + x) * 4);
writeFileSync(`${out}/layered.psd`, writePsdBuffer({ width: 200, height: 150, children: layers, imageData: grad }, { generateThumbnail: false }));
writeFileSync(`${out}/no-composite.psd`, writePsdBuffer({ width: 200, height: 150, children: layers }, { generateThumbnail: false, noBackground: true }));
console.log('ok');
