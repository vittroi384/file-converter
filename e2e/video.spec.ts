import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubTelemetry } from './helpers.ts';

// 영상 변환(WebCodecs). 시험 영상 clip.mp4(H.264+AAC)·clip.webm(VP9+Opus)은 640×360 3초, 초마다 배경색이 바뀌고
// 440Hz 소리가 든 자체 제작물이다(apps/web/test/video-run.mjs --save-fixtures로 다시 만든다).
// WebCodecs가 없는 엔진(Windows용 Playwright WebKit 등)은 '지원 안 함' 안내가 떠야 하고 멈추면 안 된다.
test.use({ serviceWorkers: 'block' });

const fx = (n: string) => `e2e/fixtures/${n}`;
const errors: string[] = [];

function signature(buf: Buffer): string {
  const s = (o: number, t: string) => buf.subarray(o, o + t.length).toString('latin1') === t;
  if (s(4, 'ftyp')) return 'mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (s(0, 'GIF89a')) return 'gif';
  return 'unknown';
}

async function open(page: Page, file: string) {
  await page.goto('/ko');
  await page.getByTestId('file-input').setInputFiles(fx(file));
  await expect(page.locator('.file')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: '영상 변환' })).toHaveAttribute('aria-selected', 'true'); // 영상 파일이면 첫 작업
}

async function runAndDownload(page: Page) {
  await page.locator('.run-bar .primary').click();
  const save = page.locator('.run-bar .primary', { hasText: '받기' });
  await expect(save).toBeVisible({ timeout: 90_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), save.click()]);
  return { name: dl.suggestedFilename(), buf: readFileSync((await dl.path())!) };
}

// 받은 파일을 브라우저 재생기로 열어 길이·크기를 잰다(우리 코드가 아니라 브라우저가 판정)
// 사이트 CSP엔 media-src가 없어(앱은 재생하지 않는다) blob 재생이 막힌다 → CSP 없는 빈 탭에서 연다
async function probe(page: Page, buf: Buffer, type: string) {
  const blank = await page.context().newPage();
  try { return await probeIn(blank, buf, type); } finally { await blank.close(); }
}
async function probeIn(page: Page, buf: Buffer, type: string) {
  return page.evaluate(async ([b64, type]) => {
    const blob = await (await fetch(`data:${type};base64,${b64}`)).blob();
    const v = document.createElement(type.startsWith('audio') ? 'audio' : 'video') as HTMLVideoElement;
    v.muted = true;
    v.src = URL.createObjectURL(blob);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error(`열기 실패 ${v.error?.code}`)); });
    return { duration: v.duration, width: v.videoWidth ?? 0, height: v.videoHeight ?? 0 };
  }, [buf.toString('base64'), type] as const);
}

// GIF 블록을 따라가며 그림(0x2C) 수를 센다
function gifFrames(b: Buffer) {
  const table = (flags: number) => (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);
  const skipSub = (p: number) => { while (b[p]) p += b[p]! + 1; return p + 1; };
  let p = 13 + table(b[10]!), n = 0;
  while (p < b.length && b[p] !== 0x3b) {
    if (b[p] === 0x21) p = skipSub(p + 2);
    else if (b[p] === 0x2c) { n++; p = skipSub(p + 10 + table(b[p + 9]!) + 1); }
    else throw new Error(`GIF 블록 오류 @${p}`);
  }
  return n;
}

const hasWebCodecs = (page: Page) => page.evaluate(() => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined');

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  await stubTelemetry(page);
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
});
test.afterEach(async () => {
  expect(errors, '콘솔 오류').toEqual([]);
});

test('MP4 → MP4 480p: 크기·길이', async ({ page }) => {
  await open(page, 'clip.mp4');
  if (!(await hasWebCodecs(page))) {
    await page.locator('.run-bar .primary').click();
    // 오류 줄 두 개: 분류(지원 안 함) + 구체적인 이유(WebCodecs 없음)
    await expect(page.locator('.fmeta .err').first()).toContainText('지원하지 않는', { timeout: 30_000 });
    await expect(page.locator('.fmeta .err').nth(1)).toContainText('WebCodecs');
    return;
  }
  await page.getByRole('radio', { name: '480p' }).click(); // 짧은 변 기준: 640×360은 이미 작아서 그대로
  const r = await runAndDownload(page);
  expect(r.name).toBe('clip.mp4');
  expect(signature(r.buf)).toBe('mp4');
  const m = await probe(page, r.buf, 'video/mp4');
  expect(Math.abs(m.duration - 3)).toBeLessThan(0.25);
  expect([m.width, m.height]).toEqual([640, 360]);
});

test('WebM(VP9) → MP4(H.264)', async ({ page }) => {
  await open(page, 'clip.webm');
  test.skip(!(await hasWebCodecs(page)), 'WebCodecs 없음');
  await page.getByRole('radio', { name: 'MP4' }).click();
  const r = await runAndDownload(page);
  expect(r.name).toBe('clip.mp4');
  expect(signature(r.buf)).toBe('mp4');
  const m = await probe(page, r.buf, 'video/mp4');
  expect(Math.abs(m.duration - 3)).toBeLessThan(0.25);
  expect([m.width, m.height]).toEqual([640, 360]);
});

test('MP4 → WebM', async ({ page }) => {
  await open(page, 'clip.mp4');
  test.skip(!(await hasWebCodecs(page)), 'WebCodecs 없음');
  await page.getByRole('radio', { name: 'WEBM' }).click();
  const r = await runAndDownload(page);
  expect(r.name).toBe('clip.webm');
  expect(signature(r.buf)).toBe('webm');
  const m = await probe(page, r.buf, 'video/webm');
  expect([m.width, m.height]).toEqual([640, 360]);
});

test('MP4 → GIF 5fps: 프레임 수', async ({ page }) => {
  await open(page, 'clip.mp4');
  test.skip(!(await hasWebCodecs(page)), 'WebCodecs 없음');
  await page.getByRole('radio', { name: 'GIF' }).click();
  await page.getByRole('radio', { name: '5', exact: true }).click();
  const r = await runAndDownload(page);
  expect(r.name).toBe('clip.gif');
  expect(signature(r.buf)).toBe('gif');
  // 원본 크기를 고르면 GIF는 360p 이하로 → 640×360 그대로. 3초 × 5fps = 15장(그림 제어 확장 블록 수로 센다)
  expect(r.buf.readUInt16LE(6)).toBe(640);
  expect(r.buf.readUInt16LE(8)).toBe(360);
  expect(gifFrames(r.buf)).toBe(15);
});

test('MP4 → 소리만(M4A)', async ({ page }) => {
  await open(page, 'clip.mp4');
  test.skip(!(await hasWebCodecs(page)), 'WebCodecs 없음');
  await page.getByRole('radio', { name: '소리만 (M4A)' }).click();
  const r = await runAndDownload(page);
  expect(r.name).toBe('clip.m4a'); // AAC는 다시 인코딩하지 않고 옮긴다(AAC 인코더 없는 브라우저도 됨)
  expect(signature(r.buf)).toBe('mp4');
  const m = await probe(page, r.buf, 'audio/mp4');
  expect(Math.abs(m.duration - 3)).toBeLessThan(0.3);
});
