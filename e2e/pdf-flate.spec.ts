import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFRawStream, PDFNumber } from 'pdf-lib';
import { stubTelemetry } from './helpers.ts';

// PDF 용량 줄이기: Flate(무손실) 사진은 JPEG로, Flate 화면 캡처는 그대로.
// 시험 파일 flate-mixed.pdf = 1쪽 Kodak 사진 768x512 + 2쪽 Edge 화면 캡처 1200x800, 둘 다 pdf-lib embedPng(Flate).
// 다시 만들기: node bench/flate-pdf-demo.ts --fixture
test.use({ serviceWorkers: 'block' });

const fx = (n: string) => `e2e/fixtures/${n}`;
const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  await stubTelemetry(page, []);
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
});
test.afterEach(() => { expect(errors, '콘솔 오류').toEqual([]); });

async function runAndDownload(page: Page) {
  await page.locator('.run-bar .primary').click();
  const save = page.locator('.run-bar .primary', { hasText: '받기' });
  await expect(save).toBeVisible({ timeout: 90_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), save.click()]);
  return readFileSync((await dl.path())!);
}

// 사진 개체: 가로 크기 → 필터
async function imageFilters(buf: Uint8Array) {
  const doc = await PDFDocument.load(buf);
  const out: Record<number, string> = {};
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFRawStream) || o.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    out[(o.dict.get(PDFName.of('Width')) as PDFNumber).asNumber()] = String(o.dict.get(PDFName.of('Filter')));
  }
  return { pages: doc.getPageCount(), out };
}

test('PDF 용량 줄이기: Flate 사진은 JPEG로, 화면 캡처는 Flate 그대로', async ({ page }) => {
  await page.goto('/ko');
  await page.getByTestId('file-input').setInputFiles([fx('flate-mixed.pdf')]);
  await expect(page.locator('.file')).toHaveCount(1);
  await page.getByRole('tab', { name: 'PDF 용량 줄이기' }).click();
  const r = await runAndDownload(page);
  const before = readFileSync(fx('flate-mixed.pdf'));
  console.log('Flate PDF', before.length, '→', r.length, `(${Math.round(r.length / before.length * 100)}%)`);
  expect(r.subarray(0, 4).toString('latin1')).toBe('%PDF');
  expect(await imageFilters(before)).toEqual({ pages: 2, out: { 768: '/FlateDecode', 1200: '/FlateDecode' } });
  const after = await imageFilters(r);
  expect(after.pages).toBe(2);
  expect(after.out[768], '사진은 JPEG로').toBe('/DCTDecode');
  expect(after.out[1200], '화면 캡처는 그대로').toBe('/FlateDecode');
  expect(r.length).toBeLessThan(before.length * 0.5); // Node 측정 983KB → 약 255KB
});
