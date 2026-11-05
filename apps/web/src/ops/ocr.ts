// 사진 속 글자 인식(OCR, 한국어+영어). tesseract.js가 자기 작업자를 따로 띄우므로 화면 쪽에서 실행한다(플러그인 mainThread).
// 엔진·학습 데이터는 우리 사이트(/ocr/)에서만 받는다 — 사진은 기기 밖으로 나가지 않는다.
import type { OpRunner } from '../core/types.ts';
import { decodeImage } from './codecs.ts';

export const run: OpRunner = async (inputs, _o, ctx) => {
  const p = inputs[0]!;
  ctx.progress(0.05, 'open');
  // HEIC·PSD·SVG도 우리 디코더로 연 뒤 PNG로 넘긴다(tesseract는 브라우저가 여는 형식만 안다)
  const { img } = await decodeImage(p, {});
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  const png = await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('PNG 만들기 실패'))), 'image/png'));
  ctx.progress(0.15, 'ocr');
  const { createWorker, OEM } = await import('tesseract.js');
  const base = new URL('/ocr/', location.href).href;
  const worker = await createWorker(['kor', 'eng'], OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`, corePath: `${base}core`, langPath: `${base}lang`, gzip: true,
    workerBlobURL: false, // CSP: 같은 출처 파일로
    logger: m => { if (m.status === 'recognizing text') ctx.progress(0.3 + 0.65 * m.progress, 'ocr'); else if (m.progress) ctx.progress(0.15 + 0.15 * m.progress, m.status); },
  });
  try {
    const { data } = await worker.recognize(png);
    const text = data.text.replace(/[ \t]+\n/g, '\n').trim() + '\n';
    const name = p.name.replace(/\.[^.]+$/, '') + '.txt';
    return {
      outputs: [{ name, type: 'text/plain;charset=utf-8', buf: new TextEncoder().encode(text).buffer as ArrayBuffer }],
      meta: { chars: text.trim().length, confidence: Math.round(data.confidence) },
    };
  } finally {
    await worker.terminate();
  }
};
