// 큰 파일 측정(BENCH=1일 때만). 처리 시간 + 브라우저 프로세스 메모리 최고점(운영체제에서 0.25초마다 측정).
// 실행: BENCH=1 npx playwright test e2e/bench-large.spec.ts --project=edge --retries=0
import { test, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readdirSync, appendFileSync, mkdirSync } from 'node:fs';
import { stubTelemetry } from './helpers.ts';

test.skip(!process.env.BENCH, 'BENCH=1일 때만');
test.use({ serviceWorkers: 'block' });
test.setTimeout(30 * 60_000);
const D = 'bench/data/large/';
const LABEL = process.env.BENCH_LABEL ?? 'now';

// Playwright가 띄운 Edge 프로세스(임시 프로필) 메모리 합계를 계속 잰다
function memorySampler() {
  const ps = spawn('powershell', ['-NoProfile', '-Command', `
    while ($true) {
      $s = (Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*playwright*' } | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).PrivateMemorySize64 } | Measure-Object -Sum).Sum
      Write-Output $s
      Start-Sleep -Milliseconds 250
    }`]);
  let peak = 0, base = 0;
  ps.stdout.on('data', d => { for (const l of String(d).split(/\s+/)) { const v = Number(l); if (v > 0) { if (!base) base = v; peak = Math.max(peak, v); } } });
  return { stop: () => { ps.kill(); return { peakMB: Math.round(peak / 1048576), baseMB: Math.round(base / 1048576) }; } };
}

async function measure(page: Page, name: string, files: string[], setup: () => Promise<void>) {
  await page.goto('/ko');
  await page.waitForTimeout(1500);
  const mem = memorySampler();
  await page.waitForTimeout(1000); // 기준값 잡기
  await page.getByTestId('file-input').setInputFiles(files);
  await setup();
  const t0 = Date.now();
  await page.locator('.run-bar .primary').click();
  const done = page.locator('.run-bar .primary', { hasText: '받기' });
  const err = page.locator('.fmeta .err, .note.err').first();
  await expect(done.or(err)).toBeVisible({ timeout: 25 * 60_000 });
  const ms = Date.now() - t0;
  const ok = await done.isVisible();
  const errText = ok ? '' : await err.innerText();
  let zipMs = 0;
  if (ok && files.length > 1) {
    const t1 = Date.now();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10 * 60_000 }), done.click()]);
    await dl.path();
    zipMs = Date.now() - t1;
  }
  await page.waitForTimeout(500);
  const m = mem.stop();
  const row = { label: LABEL, name, ok, seconds: +(ms / 1000).toFixed(1), zipSeconds: +(zipMs / 1000).toFixed(1), ...m, err: errText.slice(0, 120), at: new Date().toISOString() };
  console.log('BENCH', JSON.stringify(row));
  mkdirSync('bench/out', { recursive: true });
  appendFileSync('bench/out/large.jsonl', JSON.stringify(row) + '\n');
}

test.beforeEach(async ({ page }) => { await stubTelemetry(page); });

test('5000만 화소 JPG → WebP', async ({ page }) => {
  await measure(page, '50MP→WebP', [D + 'photo-50mp.jpg'], async () => { await page.getByRole('radio', { name: 'WEBP' }).click(); });
});
test('5000만 화소 JPG → 스마트 압축', async ({ page }) => {
  await measure(page, '50MP 스마트압축', [D + 'photo-50mp.jpg'], async () => { await page.getByRole('tab', { name: '용량 줄이기' }).click(); });
});
test('1200만 화소 100장 → WebP + ZIP', async ({ page }) => {
  const files = readdirSync(D).filter(f => f.startsWith('batch-')).map(f => D + f);
  await measure(page, '12MP×100→WebP+ZIP', files, async () => { await page.getByRole('radio', { name: 'WEBP' }).click(); });
});
test('369MB 200쪽 PDF → 용량 줄이기', async ({ page }) => {
  await measure(page, '200쪽PDF 용량줄이기', [D + 'scan-200p.pdf'], async () => { await page.getByRole('tab', { name: 'PDF 용량 줄이기' }).click(); });
});
test('369MB 200쪽 PDF → 처음 20쪽 이미지', async ({ page }) => {
  await measure(page, '200쪽PDF→이미지20쪽', [D + 'scan-200p.pdf'], async () => {
    await page.getByRole('tab', { name: 'PDF → 이미지' }).click();
    await page.getByRole('radio', { name: 'JPG' }).click();
    await page.locator('input[placeholder^="전체"]').fill('1-20');
  });
});
