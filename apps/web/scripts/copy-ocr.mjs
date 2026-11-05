// 글자 인식(OCR) 엔진·학습 데이터를 public/ocr로 복사(빌드 전에). CSP가 외부 연결을 막으므로 CDN 대신 우리 사이트에서 내려준다.
// 학습 데이터는 tessdata best_int(정확도·크기 균형): 한국어 1.5MB·영어 2.9MB(gzip). 라이선스: Apache-2.0(tesseract.js·tessdata).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(root, 'package.json'));
const pkg = (name) => dirname(req.resolve(`${name}/package.json`));
const out = join(root, 'public', 'ocr');
const files = [
  [join(pkg('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  // corePath가 폴더면 tesseract.js가 SIMD 지원 여부로 셋 중 하나를 고른다
  [join(pkg('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'), 'core/tesseract-core-simd-lstm.wasm.js'],
  [join(pkg('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'), 'core/tesseract-core-lstm.wasm.js'],
  // 7판부터 relaxed-SIMD를 지원하는 브라우저(최신 크롬·엣지)는 이 판을 고른다 — 처음엔 빠뜨려 importScripts 실패
  [join(pkg('tesseract.js-core'), 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  [join(pkg('@tesseract.js-data/kor'), '4.0.0_best_int', 'kor.traineddata.gz'), 'lang/kor.traineddata.gz'],
  [join(pkg('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'lang/eng.traineddata.gz'],
];
for (const [src, rel] of files) {
  if (!existsSync(src)) throw new Error(`OCR 파일 없음: ${src}`);
  mkdirSync(dirname(join(out, rel)), { recursive: true });
  copyFileSync(src, join(out, rel));
}
console.log(`OCR 파일 ${files.length}개 → public/ocr`);
