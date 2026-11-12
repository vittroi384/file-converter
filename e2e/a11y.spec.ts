import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { stubTelemetry, setScheme } from './helpers.ts';

// 접근성(WCAG 2.2 AA) 자동 검사: axe가 찾은 위반 중 serious·critical이 하나라도 있으면 실패.
// 색 대비는 엔진마다 같으니 Edge에서만 돈다. 스크롤 연출은 중간 상태(흐려지는 중)를 잡으면 매번 결과가 달라서
// '동작 줄이기'로 멈춘 상태를 검사한다(연출 중 흐린 글자는 따로 눈으로 본다).
test.skip(({ browserName }) => browserName !== 'chromium', '대비·구조 검사는 Edge 한 곳에서');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const fx = (n: string) => `e2e/fixtures/${n}`;

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  // 실패하면 어느 규칙·어느 요소인지 바로 보이게
  const report = bad.map(v => `${v.id}(${v.impact}): ${v.nodes.slice(0, 5).map(n => `${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`).join(' | ')}`);
  expect(report, `${label} 접근성 위반`).toEqual([]);
}

async function open(page: Page) {
  await page.goto('/ko');
  await page.getByTestId('file-input').setInputFiles(fx('photo.jpg'));
  await expect(page.locator('.file')).toHaveCount(1);
}

async function convert(page: Page) {
  await page.locator('.run-bar .primary').click();
  await expect(page.locator('.run-bar .primary', { hasText: '받기' })).toBeVisible({ timeout: 90_000 });
}

test.beforeEach(async ({ page }) => { await stubTelemetry(page); });

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} 화면`, () => {
    test.beforeEach(async ({ page }) => { await setScheme(page, scheme); });

    for (const path of ['/ko', '/', '/ko/heic-to-jpg', '/ja/avif-to-png']) {
      test(`페이지 ${path}`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await axe(page, path);
      });
    }

    test('파일 넣음 → 변환 끝 → 비교 창 → 기록 → 명령 팔레트', async ({ page }) => {
      await open(page);
      await axe(page, '파일 넣음');
      await convert(page);
      await axe(page, '변환 끝');

      await page.getByRole('button', { name: '전후 비교' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await axe(page, '비교 창');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      const history = page.locator('.history summary');
      if (await history.count()) { await history.click(); await axe(page, '기록 펼침'); }

      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog', { name: '명령' })).toBeVisible();
      await axe(page, '명령 팔레트');
    });
  });
}

// axe가 못 보는 키보드 흐름: 대화상자에 초점이 들어가고, Tab이 밖으로 새지 않고, Esc로 닫으면 연 버튼으로 돌아온다
test('키보드: 비교 창 초점 가두기·되돌리기', async ({ page }) => {
  await open(page);
  await convert(page);
  const opener = page.getByRole('button', { name: '전후 비교' }).first();
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i++) {
    expect(await dialog.evaluate(d => d.contains(document.activeElement)), `Tab ${i}번째에 초점이 창 밖으로 나감`).toBe(true);
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('키보드: 명령 팔레트 Esc로 닫으면 초점 복귀, 결과 없음 안내', async ({ page }) => {
  await page.goto('/ko');
  const cmd = page.locator('.icon-btn.cmd');
  await cmd.focus();
  await page.keyboard.press('Enter');
  const input = page.getByRole('combobox');
  await expect(input).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused(); // 팔레트 안에 머문다
  await input.fill('zzzz없는명령');
  await expect(page.getByRole('dialog').getByRole('status')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(cmd).toBeFocused();
});

// 관리자 화면: docker compose 스택(8080)에 붙어서 돈다(admin.spec과 같은 방식). ADMIN_PW가 없으면 건너뜀.
// ADMIN_BASE로 바꿀 수 있다(예: /api를 8080으로 넘기는 개발 서버에서 고친 화면을 확인할 때)
test.describe('관리자', () => {
  const PW = process.env.ADMIN_PW;
  const BASE = process.env.ADMIN_BASE ?? 'http://localhost:8080';
  test.skip(!PW, 'ADMIN_PW 없음(스택이 떠 있을 때만)');
  test.use({ baseURL: BASE });
  let session: Promise<string> | null = null; // 로그인은 1분에 5번까지라 한 번만

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme} 모든 탭`, async ({ page }) => {
      await setScheme(page, scheme);
      await page.goto('/admin');
      await expect(page.getByLabel('비밀번호')).toBeVisible();
      await axe(page, '로그인');
      session ??= fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW }) })
        .then(r => { if (!r.ok) throw new Error(`로그인 ${r.status}`); return r.headers.get('set-cookie')!.split(';')[0]!.split('=')[1]!; });
      await page.context().addCookies([{ name: 'fc_admin', value: await session, domain: 'localhost', path: '/api/admin', httpOnly: true, sameSite: 'Strict' }]);
      await page.goto('/admin');
      for (const tab of ['개요', '유입', '성능', '서버', '오류 로그', '알림']) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(page.getByRole('tabpanel')).toBeVisible();
        await page.waitForLoadState('networkidle');
        await axe(page, `관리자 ${tab}`);
      }
      // 탭 목록은 화살표로 옮겨 다닌다
      await page.getByRole('tab', { name: '개요' }).click();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: '유입' })).toBeFocused();
      await expect(page.getByRole('tab', { name: '유입' })).toHaveAttribute('aria-selected', 'true');
    });
  }
});
