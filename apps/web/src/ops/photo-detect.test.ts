import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFRawStream, PDFNumber } from 'pdf-lib';
import { isPhoto, photoFeatures } from './photo-detect.ts';
import { decodeFlateImage } from './flate.ts';
import { loadPng } from '../../test/load-png.ts';

const fx = (n: string) => fileURLToPath(new URL(`../../../../e2e/fixtures/${n}`, import.meta.url));
const png = (n: string) => { const p = loadPng(fx(n)); return { width: p.w, height: p.h, data: p.data }; };

// 판별 기준을 정하고 검증한 방법은 bench/flate-classify.ts·make-flate-calib.py·make-flate-holdout.py. 여기선 대표 사례만 고정한다.
describe('사진 판별', () => {
  it('flate-mixed.pdf: Kodak 사진은 사진, Edge 화면 캡처는 아님(PDF 안 Flate 그대로 풀어서)', async () => {
    const doc = await PDFDocument.load(readFileSync(fx('flate-mixed.pdf')));
    const got: Record<number, boolean> = {};
    for (const [, o] of doc.context.enumerateIndirectObjects()) {
      if (!(o instanceof PDFRawStream) || o.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
      const n = (k: string) => (o.dict.get(PDFName.of(k)) as PDFNumber).asNumber();
      const px = decodeFlateImage(o.contents, { width: n('Width'), height: n('Height'), colors: 3, bpc: 8, predictor: 1 })!;
      got[px.width] = isPhoto(px);
    }
    expect(got).toEqual({ 768: true, 1200: false });
  });
  it('도표·글자 PNG는 사진 아님', () => {
    expect(isPhoto(png('chroma-chart.png'))).toBe(false);
    expect(isPhoto(png('ocr-ko-en.png'))).toBe(false);
  });
  it('잡음 섞인 흰 바탕 문서: 이웃 같은 비율(eq)은 사진처럼 낮아도 밝기 쏠림(top)으로 걸러진다', () => {
    const w = 400, h = 300, d = new Uint8ClampedArray(w * h * 4);
    let s = 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const ink = y % 20 < 8 && x % 9 < 5 && x > 20 && x < 380; // 글자 줄 흉내
      const v = (ink ? 30 : 245) + ((s >>> 24) % 9) - 4;
      const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    const f = photoFeatures({ width: w, height: h, data: d });
    expect(f.eq).toBeLessThan(0.25);
    expect(isPhoto({ width: w, height: h, data: d })).toBe(false);
  });
  it('너무 작은 그림은 판단하지 않는다', () => {
    expect(isPhoto({ width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4) })).toBe(false);
  });
});
