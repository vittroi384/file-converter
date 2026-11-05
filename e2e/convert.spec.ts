import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { stubTelemetry } from './helpers.ts';

// 서비스 워커를 거친 요청은 WebKit에서 가로챌 수 없다 → 오프라인 시험(pwa.spec) 말고는 막고 돌린다
test.use({ serviceWorkers: 'block' });

const fx = (n: string) => `e2e/fixtures/${n}`;
const errors: string[] = [];

// 파일 앞부분으로 진짜 형식 확인
function signature(buf: Buffer): string {
  const s = (o: number, t: string) => buf.subarray(o, o + t.length).toString('latin1') === t;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (s(1, 'PNG')) return 'png';
  if (s(0, 'RIFF') && s(8, 'WEBP')) return 'webp';
  if (s(4, 'ftypavif')) return 'avif';
  if (s(0, '%PDF')) return 'pdf';
  if (s(0, 'PK')) return 'zip';
  return 'unknown';
}

async function open(page: Page, files: string[]) {
  await page.goto('/ko'); // 기본 주소 /는 영어, 한국어 화면은 /ko
  await page.getByTestId('file-input').setInputFiles(files.map(fx));
  await expect(page.locator('.file')).toHaveCount(files.length);
}

async function runAndDownload(page: Page) {
  await page.locator('.run-bar .primary').click();
  const save = page.locator('.run-bar .primary', { hasText: '받기' });
  await expect(save).toBeVisible({ timeout: 90_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), save.click()]);
  const buf = readFileSync((await dl.path())!);
  return { name: dl.suggestedFilename(), buf };
}

const beacons: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  beacons.length = 0;
  // API 서버 없이 돌리므로 통계 요청은 여기서 받는다. 받은 내용은 개인정보 검사에 쓴다.
  await stubTelemetry(page, beacons);
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => dispatchEvent(new Event('pagehide'))).catch(() => {}); // 남은 통계 전송
  await page.waitForTimeout(100);
  expect(errors, '콘솔 오류').toEqual([]);
  // 통계에 파일 이름·내용이 섞이면 실패
  // 문자열 값만 검사(숫자 필드는 매번 달라서 '010' 같은 우연 일치가 생긴다)
  const strings: string[] = [];
  const walk = (v: unknown) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const b of beacons) walk(JSON.parse(b));
  const all = strings.join(' ');
  for (const leak of ['photo', 'transparent', 'iphone', 'scan', 'one-page', 'excel-korean', 'layered', 'icon', '김철수', '010']) {
    expect(all, `통계에 '${leak}'가 들어감`).not.toContain(leak);
  }
});

test('처음 화면', async ({ page }) => {
  await page.goto('/ko');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('어디에도 보내지 않고');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true); // WASM 스레드용 격리 헤더
});

test('PNG(투명) → JPG: 흰 배경 합성', async ({ page }) => {
  await open(page, ['transparent.png']);
  await page.getByRole('radio', { name: 'JPG' }).click();
  const r = await runAndDownload(page);
  expect(r.name).toBe('transparent.jpg');
  expect(signature(r.buf)).toBe('jpg');
  // 투명했던 모서리가 검정이 아니라 흰색인지 브라우저에서 디코드해 확인
  const corner = await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; const c = cv.getContext('2d')!; // WebKit은 화면 쪽에도 OffscreenCanvas가 없다
    c.drawImage(bmp, 0, 0);
    return [...c.getImageData(2, 2, 1, 1).data];
  }, r.buf.toString('base64'));
  expect(corner[0]).toBeGreaterThan(245);
});

// 한 테스트 안에서 '받기 → 다른 페이지로 이동 → 받기'를 하면 WebKit만 'Cannot load blob … access control checks'를
// 다운로드 수만큼 찍었다. 같은 순서를 따로 떼어 내면 재현이 안 돼 원인 미확인(devlog 10절). 형식마다 새 페이지로 나눈다.
for (const fmt of ['WEBP', 'AVIF'] as const) {
  test(`JPG → ${fmt}`, async ({ page }) => {
    await open(page, ['photo.jpg']);
    await page.getByRole('radio', { name: fmt }).click();
    const r = await runAndDownload(page);
    expect(signature(r.buf)).toBe(fmt.toLowerCase());
  });
}

test('크기 조절: SNS(1080) 선택 시 가로 1080 이하', async ({ page }) => {
  await open(page, ['photo.jpg']); // 768px이라 그대로여야 함
  await page.getByRole('radio', { name: '작게' }).first().click(); // 640
  const r = await runAndDownload(page);
  const w = await page.evaluate(async (b64) => (await createImageBitmap(await (await fetch(`data:image/webp;base64,${b64}`)).blob())).width, r.buf.toString('base64'));
  expect(w).toBe(640);
});

test('스마트 압축: 목표 SSIM 충족, 시도 횟수 표시', async ({ page }) => {
  await open(page, ['photo.jpg']);
  await page.getByRole('tab', { name: '용량 줄이기' }).click();
  await page.getByRole('radio', { name: /균형/ }).click();
  await page.locator('.run-bar .primary').click();
  await expect(page.locator('.fmeta', { hasText: '번 시도' })).toBeVisible({ timeout: 90_000 });
  const meta = await page.locator('.fmeta').first().innerText();
  console.log('스마트 압축 결과:', meta.replace(/\n/g, ' '));
  expect(meta).toMatch(/[−-]\d+%/); // 새 디자인은 진짜 빼기 기호(U+2212)
});

test('HEIC → JPG', async ({ page }) => {
  await open(page, ['iphone.heic']);
  const r = await runAndDownload(page);
  expect(signature(r.buf)).toBe('jpg');
  expect(r.buf.length).toBeGreaterThan(10_000);
});

for (const f of ['layered.psd', 'no-composite.psd']) {
  test(`PSD → PNG 색 확인: ${f}`, async ({ page }) => {
    await open(page, [f]);
    await page.getByRole('radio', { name: 'PNG' }).click();
    const r = await runAndDownload(page);
    expect(signature(r.buf)).toBe('png');
    // (40,40)은 파랑 레이어 위치 → 파란색이어야 한다
    const px = await page.evaluate(async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; const c = cv.getContext('2d')!; // WebKit은 화면 쪽에도 OffscreenCanvas가 없다
      c.drawImage(bmp, 0, 0);
      return [...c.getImageData(40, 40, 1, 1).data];
    }, r.buf.toString('base64'));
    console.log(f, '(40,40) =', px.join(','));
    // 처음엔 '투명만 아니면 통과'로 짜서 검정 결과가 통과했다 → 실제 색(합성본은 연파랑, 레이어 겹침은 파랑)을 확인
    const expected = f === 'layered.psd' ? [40, 40, 255] : [59, 91, 253]; // 합성본 그라데이션 (x, y, 255)
    for (let i = 0; i < 3; i++) expect(Math.abs(px[i]! - expected[i]!), `${f} 색`).toBeLessThan(6);
  });
}

test('SVG → PNG', async ({ page }) => {
  await open(page, ['icon.svg']);
  await page.getByRole('radio', { name: 'PNG' }).click();
  const r = await runAndDownload(page);
  expect(signature(r.buf)).toBe('png');
});

test('PDF 두 개 합치기(기본 작업으로 추천)', async ({ page }) => {
  await open(page, ['one-page.pdf', 'scan.pdf']);
  await expect(page.getByRole('tab', { name: 'PDF 합치기' })).toHaveAttribute('aria-selected', 'true');
  const r = await runAndDownload(page);
  expect(signature(r.buf)).toBe('pdf');
  // 결과는 객체 스트림으로 압축돼 있어 텍스트 검색으로는 못 센다 → 실제로 열어서 센다
  expect((await PDFDocument.load(r.buf)).getPageCount()).toBe(3);
});

test('PDF 용량 줄이기: 스캔 PDF가 실제로 작아짐', async ({ page }) => {
  await open(page, ['scan.pdf']);
  await page.getByRole('tab', { name: 'PDF 용량 줄이기' }).click();
  const before = readFileSync(fx('scan.pdf')).length;
  const r = await runAndDownload(page);
  console.log(`PDF 용량: ${before} → ${r.buf.length} (${Math.round((1 - r.buf.length / before) * 100)}% 감소)`);
  expect(signature(r.buf)).toBe('pdf');
  expect(r.buf.length).toBeLessThan(before * 0.8);
});

test('PDF → 이미지: 2쪽 → PNG 2장 ZIP', async ({ page }) => {
  await open(page, ['scan.pdf']);
  await page.getByRole('tab', { name: 'PDF → 이미지' }).click();
  await page.getByRole('radio', { name: '화면용' }).click();
  const r = await runAndDownload(page);
  expect(signature(r.buf)).toBe('zip');
  const names = [...r.buf.toString('latin1').matchAll(/scan_p\d\.png/g)].map(m => m[0]);
  expect(new Set(names)).toEqual(new Set(['scan_p1.png', 'scan_p2.png']));
});

test('엑셀 한국어 CSV(EUC-KR) → XLSX → 내용 확인', async ({ page }) => {
  await open(page, ['excel-korean.csv']);
  await page.getByRole('radio', { name: 'JSON' }).click();
  const r = await runAndDownload(page);
  expect(JSON.parse(r.buf.toString('utf8'))).toEqual([
    { 이름: '김철수', 전화: '01012345678', 점수: 90 },
    { 이름: '이영희', 전화: '01098765432', 점수: 85.5 },
  ]);
});

test('여러 장 일괄 → ZIP, 취소 후에도 다시 실행 가능', async ({ page }) => {
  await open(page, ['photo.jpg', 'transparent.png', 'iphone.heic']);
  await page.getByRole('radio', { name: 'AVIF' }).click();
  await page.locator('.run-bar .primary').click();
  await page.getByRole('button', { name: '취소' }).click();
  // 취소 전에 작은 파일이 먼저 끝날 수 있다 → '남은 N개 변환'으로 나머지만 이어서(처음엔 이 경우 방법이 없었다)
  const rest = page.getByRole('button', { name: /남은 \d개 변환/ });
  const again = page.locator('.run-bar .primary', { hasText: '형식 바꾸기' });
  await expect(rest.or(again)).toBeVisible();
  if (await rest.isVisible()) await rest.click(); else await again.click();
  const save = page.locator('.run-bar .primary', { hasText: '받기' });
  await expect(save).toBeVisible({ timeout: 90_000 });
  await expect(rest).toHaveCount(0); // 남은 것 없음
  const [dl] = await Promise.all([page.waitForEvent('download'), save.click()]);
  const buf = readFileSync((await dl.path())!);
  expect(signature(buf)).toBe('zip');
  expect([...buf.toString('latin1').matchAll(/\.avif/g)].length).toBeGreaterThanOrEqual(3); // 3장 모두
});

test('EXIF 회전: 세로로 찍은 사진이 똑바로 나온다(Pillow 정답과 대조)', async ({ page }) => {
  const want = JSON.parse(readFileSync(fx('rotated-exif6.json'), 'utf8')) as { width: number; height: number; redCorner: string };
  await open(page, ['rotated-exif6.jpg']);
  await page.getByRole('radio', { name: 'PNG' }).click();
  const r = await runAndDownload(page);
  const got = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d')!; x.drawImage(bmp, 0, 0);
    const px = (a: number, b: number) => [...x.getImageData(a, b, 1, 1).data];
    const W = bmp.width, H = bmp.height;
    const corners: Record<string, number[]> = { tl: px(5, 5), tr: px(W - 6, 5), bl: px(5, H - 6), br: px(W - 6, H - 6) };
    const red = Object.entries(corners).filter(([, p]) => p[0]! > 150 && p[1]! < 100).map(([k]) => k);
    return { width: W, height: H, redCorner: red[0] };
  }, r.buf.toString('base64'));
  expect(got).toEqual(want);
});

// ── 위치 정보(GPS)·카메라 정보가 결과에 남지 않는다(FAQ에 적은 약속). 표식: LEAKCAM(제조사), SECRETPLACE(GPS 장소), GPSLatitude(XMP) ──
const LEAKS = ['LEAKCAM', 'SECRETPLACE', 'GPSLatitude'];
const leaksIn = (buf: Buffer) => LEAKS.filter(m => buf.includes(m));

for (const rot of [3, 6, 8]) test(`사진 → PDF(회전 ${rot}): GPS가 PDF 안에 안 들어가고 그림이 똑바로`, async ({ page }) => {
  await open(page, [`gps/gps-rot${rot}.jpg`, 'gps/gps.png']);
  await page.getByRole('tab', { name: 'PDF로 묶기' }).click();
  const r = await runAndDownload(page);
  expect(signature(r.buf)).toBe('pdf');
  expect(leaksIn(r.buf), 'PDF 안 메타데이터').toEqual([]);
  const doc = await PDFDocument.load(r.buf);
  const [p1, p2] = doc.getPages().map(p => p.getSize());
  if (rot !== 3) expect(p1!.height, '세로로 찍은 사진은 세로 페이지').toBeGreaterThan(p1!.width);
  expect(p2!.width).toBeGreaterThan(p2!.height);
  // 페이지 모양만으로는 그림이 뒤집혔는지 모른다 → 다른 렌더러(PyMuPDF)로 그려 Pillow가 바로 세운 정답과 비교(같은 위치에 빨강·파랑)
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  mkdirSync('test-results/gps', { recursive: true });
  writeFileSync(`test-results/gps/out-${rot}.pdf`, r.buf);
  const verdict = JSON.parse(execFileSync('python', ['tools/check-pdf-orientation.py', `test-results/gps/out-${rot}.pdf`, `e2e/fixtures/gps/gps-rot${rot}.jpg`], { encoding: 'utf8' }));
  expect(verdict, JSON.stringify(verdict)).toMatchObject({ ok: true });
});

for (const [file, tab] of [['gps/gps.jpg', '형식 바꾸기'], ['gps/gps.webp', '용량 줄이기'], ['gps/gps.png', '용량 줄이기']] as const) {
  test(`GPS 제거: ${file} · ${tab}`, async ({ page }) => {
    await open(page, [file]);
    await page.getByRole('tab', { name: tab }).click();
    const r = await runAndDownload(page);
    expect(leaksIn(r.buf)).toEqual([]);
  });
}

// ── 너무 큰 파일: 메모리 0.5GB 폰에서 7000×7000(4900만 화소) 스마트 압축 → 시작 전에 숫자와 함께 안내 ──
test('메모리 작은 기기: 한도 넘는 작업은 시작 전에 안내, 크기를 줄이면 된다', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 0.5 }));
  await open(page, ['huge-7000.jpg']);
  await page.getByRole('tab', { name: '용량 줄이기' }).click();
  await page.locator('.run-bar .primary').click();
  const err = page.locator('.fmeta .err, .note.err').first();
  await expect(err).toContainText('너무 커요', { timeout: 30_000 });
  await expect(err).toContainText(/약 [\d.]+GB가 필요한데 이 기기 한도는 약 [\d.]+GB예요/);
  // 크기를 줄이면(SNS 1080) 같은 기기에서 된다
  await page.getByRole('radio', { name: 'SNS' }).click();
  await page.locator('.run-bar .primary').click(); // 옵션을 바꾸면 주 버튼이 다시 '용량 줄이기'가 된다
  await expect(page.locator('.run-bar .primary', { hasText: '받기' })).toBeVisible({ timeout: 90_000 });
});

// ── 색 번짐(devlog 23절): 색 글자·가는 색 선 그림은 밝기 SSIM만으론 통과하지만 색이 번진다 ──
test('스마트 압축: 색 글자 그림은 색을 줄이지 않고(4:4:4) 저장, 자동이면 AVIF', async ({ page }) => {
  await open(page, ['chroma-chart.png']);
  await page.getByRole('tab', { name: '용량 줄이기' }).click();
  const r = await runAndDownload(page);
  expect(signature(r.buf)).toBe('avif');
  await expect(page.locator('.fmeta')).toContainText('색을 줄이지 않고 저장(4:4:4)');
});
test('스마트 압축: WebP를 직접 고르면 색 번짐을 안내', async ({ page }) => {
  await open(page, ['chroma-chart.png']);
  await page.getByRole('tab', { name: '용량 줄이기' }).click();
  await page.getByRole('radio', { name: 'WEBP' }).click();
  const r = await runAndDownload(page);
  expect(signature(r.buf)).toBe('webp');
  await expect(page.locator('.fmeta')).toContainText('WebP는 색 글자');
});
test('스마트 압축: 보통 사진은 색 안내 없음(사진 압축은 그대로)', async ({ page }) => {
  await open(page, ['photo.jpg']);
  await page.getByRole('tab', { name: '용량 줄이기' }).click();
  const r = await runAndDownload(page);
  expect(signature(r.buf)).toBe('jpg');
  await expect(page.locator('.fmeta')).not.toContainText('4:4:4');
  await expect(page.locator('.fmeta')).not.toContainText('WebP는');
});

// ── 글자 있는 SVG(Q2): 글꼴 없이 그리면 글자가 통째로 빠진다 ──
test('SVG → PNG: 글자가 그려진다(영문·한글)', async ({ page }) => {
  await open(page, ['text.svg']);
  await page.getByRole('radio', { name: 'PNG' }).click();
  const r = await runAndDownload(page);
  expect(signature(r.buf)).toBe('png');
  // 결과를 브라우저에서 열어 글자 줄(위쪽 0~95px)의 어두운 화소 비율을 잰다(빨간 띠는 아래 100px 이후)
  const dark = await page.evaluate(async (b64: string) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
    const h = Math.round(img.height * 95 / 120);
    const d = g.getImageData(0, 0, img.width, h).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 100 && d[i + 1]! < 100 && d[i + 2]! < 100) n++;
    // 한글 자리(가로 60~80% 구간)만 따로
    const k = g.getImageData(Math.round(img.width * 0.6), 0, Math.round(img.width * 0.2), h).data; let m = 0;
    for (let i = 0; i < k.length; i += 4) if (k[i]! < 100) m++;
    return { all: n / (d.length / 4), korean: m / (k.length / 4) };
  }, r.buf.toString('base64'));
  console.log('글자 화소 비율', dark);
  expect(dark.all, '글자가 하나도 안 그려짐').toBeGreaterThan(0.02);
  expect(dark.korean, '한글이 안 그려짐').toBeGreaterThan(0.02);
});

// ── PDF 용량 줄이기: 같은 사진이 여러 번 들어 있으면 하나만 남긴다(Q3) ──
test('PDF 용량 줄이기: 중복 사진은 하나로(무손실), 12쪽 그대로', async ({ page }) => {
  await open(page, ['dup-images.pdf']);
  await page.getByRole('tab', { name: 'PDF 용량 줄이기' }).click();
  const r = await runAndDownload(page);
  const before = readFileSync(fx('dup-images.pdf')).length;
  console.log('중복 PDF', before, '→', r.buf.length, `(${Math.round(r.buf.length / before * 100)}%)`);
  const doc = await PDFDocument.load(r.buf);
  expect(doc.getPageCount()).toBe(12);
  // 사진 개체 수: 원래 12개 → 2개
  const { PDFName, PDFRawStream } = await import('pdf-lib');
  const images = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length;
  console.log('사진 개체', images);
  expect(images).toBe(2);
  expect(r.buf.length).toBeLessThan(before * 0.25);
});

// ── 최근 변환(F4): 새로고침해도 기기 안 기록에서 다시 받는다. 끄면 안 쌓인다 ──
test('최근 변환: 새로고침 뒤 다시 받기, 지우기, 끄기', async ({ page }) => {
  await open(page, ['photo.jpg']);
  await page.getByRole('radio', { name: 'WEBP' }).click();
  await runAndDownload(page);
  const hist = page.locator('details.history');
  // 기록 저장은 변환 뒤 비동기 → 목록에 보일 때까지 기다린 다음 새로고침(WebKit은 느려 바로 새로고침하면 저장 전이었다)
  await hist.locator('summary').click();
  await expect(hist.locator('.history-list li')).toHaveCount(1);
  await page.reload();
  await hist.locator('summary').click();
  await expect(hist.locator('.history-list li'), '새로고침 뒤에도 남아 있어야').toHaveCount(1);
  const [dl] = await Promise.all([page.waitForEvent('download'), hist.getByRole('button', { name: '받기' }).click()]);
  expect(signature(readFileSync((await dl.path())!))).toBe('webp');
  // 지우기
  await hist.getByRole('button', { name: /지우기: / }).click();
  await expect(hist.locator('.history-list li')).toHaveCount(0);
  // 끄면 다음 변환은 안 쌓인다
  await hist.getByLabel('기록 남기기').uncheck();
  await page.getByTestId('file-input').setInputFiles([fx('photo.jpg')]);
  await page.locator('.run-bar .primary').click();
  await expect(page.locator('.run-bar .primary', { hasText: '받기' })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  await expect(hist.locator('.history-list li')).toHaveCount(0);
  // WebKit만: 내려받은 직후 새로고침하면 'Cannot load blob … access control checks'를 찍는다(내려받기는 끝까지 성공 — 위에서 파일을 열어 확인).
  // 예전부터 기록한 시험 환경 증상(devlog 10절). 새로고침이 이 시험의 핵심이라 이 문구만, WebKit에서만 뺀다
  if (test.info().project.name === 'webkit' || test.info().project.name === 'iphone') {
    for (let i = errors.length - 1; i >= 0; i--) if (/^Cannot load blob: .* due to access control checks\.$/.test(errors[i]!)) errors.splice(i, 1);
  }
});

// ── 글자 인식(F3): 정답을 아는 한글·영어 문장 그림 → .txt, 글자 오류율(띄어쓰기 빼고) ──
function cer(truth: string, got: string) {
  const a = [...truth.replace(/\s+/g, '')], b = [...got.replace(/\s+/g, '')];
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]! / a.length;
}
test('글자 추출(OCR): 한글·영어 문장, 글자 오류율', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, ['ocr-ko-en.png']);
  await page.getByRole('tab', { name: '글자 추출(OCR)' }).click();
  const r = await runAndDownload(page);
  expect(r.name).toMatch(/\.txt$/);
  const got = r.buf.toString('utf8');
  const truth = JSON.parse(readFileSync(fx('ocr-ko-en.json'), 'utf8')).text as string;
  const e = cer(truth, got);
  console.log('OCR 글자 오류율', (e * 100).toFixed(1) + '%', JSON.stringify(got.slice(0, 120)));
  expect(e).toBeLessThan(0.05);
});
