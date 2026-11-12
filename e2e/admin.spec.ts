import { test, expect, type Page } from '@playwright/test';
import { RULES } from '../apps/api/src/alerting.ts';
import { setScheme } from './helpers.ts';

// docker compose 스택(8080)에 붙어서 돈다. ADMIN_PW가 없으면 건너뜀.
const PW = process.env.ADMIN_PW;
test.skip(!PW, 'ADMIN_PW 없음(스택이 떠 있을 때만)');
test.use({ baseURL: 'http://localhost:8080' });

// 로그인은 1분에 5번까지라(서버 보안 설정) 세션 쿠키를 한 번만 받아서 같이 쓴다
let session: Promise<string> | null = null;
async function login(page: Page) {
  session ??= fetch('http://localhost:8080/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW }) })
    .then(r => { if (!r.ok) throw new Error(`로그인 ${r.status}`); return r.headers.get('set-cookie')!.split(';')[0]!.split('=')[1]!; });
  await page.context().addCookies([{ name: 'fc_admin', value: await session, domain: 'localhost', path: '/api/admin', httpOnly: true, sameSite: 'Strict' }]);
  await page.goto('/admin');
  await expect(page.getByRole('tab', { name: '개요' })).toBeVisible();
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) bad.push(`문서 폭 ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      let p = el.parentElement, clipped = false;
      while (p) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') { clipped = true; break; } p = p.parentElement; }
      if (!clipped && r.right > vw + 1) bad.push(`${el.tagName.toLowerCase()}.${el.className}`);
    }
    // 짧은 말이 두 줄로 쪼개지는지(변환 화면에서 잡은 '비우/기'가 관리자 탭에서 '대시/보드'로 재발했다)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (!t || t.length > 8) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      if (new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size > 1) bad.push(`쪼개짐: ${t}`);
    }
    return [...new Set(bad)].slice(0, 10);
  });
}

test('틀린 비밀번호는 안내, 로그인 후 대시보드 숫자가 채워짐', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('비밀번호').fill('wrong-password');
  await page.getByRole('button', { name: '들어가기' }).click();
  await expect(page.getByRole('alert')).toContainText('맞지 않아요');
  await page.getByLabel('비밀번호').fill(PW!); // 화면으로 로그인하는 흐름은 여기서 한 번 확인
  await page.getByRole('button', { name: '들어가기' }).click();
  await expect(page.getByRole('tab', { name: '개요' })).toBeVisible();
  await expect(page.locator('.kpi b').first()).not.toHaveText('–', { timeout: 15_000 });
  await expect(page.getByText('일부 패널을 못 불러왔어요')).toHaveCount(0);
  await expect(page.locator('.bars li').first()).toBeVisible();
  await expect(page.locator('.chart polyline, .chart .dot').first()).toBeVisible();
});

test('오류 로그: 목록과 검색', async ({ page }) => {
  await login(page);
  await page.getByRole('tab', { name: '오류 로그' }).click();
  await expect(page.locator('.logs li').first()).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('로그 검색').fill('spike test');
  await expect(page.locator('.logs li').first()).toContainText('spike test');
  await page.getByLabel('로그 검색').fill('절대없는검색어zzz');
  await expect(page.getByText('기록된 오류가 없어요')).toBeVisible();
});

test('알림: 규칙 끄고 저장 → 적용, 비밀값은 가려짐, 다시 켜기', async ({ page }) => {
  await login(page);
  await page.getByRole('tab', { name: '알림' }).click();
  await expect(page.locator('.rules li')).toHaveCount(RULES.length); // 규칙이 늘 때마다 숫자를 고치지 않게(8로 박혀 있다 11개가 되며 실패)
  const sw = page.getByRole('checkbox', { name: '브라우저 오류 급증 켜기' });
  await sw.uncheck({ force: true });
  await page.getByRole('button', { name: '저장하고 적용' }).click();
  await expect(page.getByRole('status')).toContainText('적용했어요');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: '브라우저 오류 급증 켜기' })).not.toBeChecked();
  await expect(page.locator('.channel.on input[type=password]').first()).toHaveValue('••••••'); // 앞선 시험에서 켠 웹훅 주소
  await page.getByRole('checkbox', { name: '브라우저 오류 급증 켜기' }).check({ force: true });
  await page.getByRole('button', { name: '저장하고 적용' }).click();
  await expect(page.getByRole('status')).toContainText('적용했어요');
});

for (const scheme of ['light', 'dark'] as const) {
  for (const w of [375, 1440]) {
    test(`관리자 화면 ${scheme} ${w}px`, async ({ page }) => {
      await setScheme(page, scheme);
      await page.setViewportSize({ width: w, height: 900 });
      await login(page);
      await expect(page.locator('.kpi b').first()).not.toHaveText('–', { timeout: 15_000 });
      await page.waitForTimeout(500);
      const problems = await overflow(page);
      // 탭마다: 넘침 검사 + 스크린샷. PC는 한 화면(900px)에 들어오는지도 본다(사용자: '스크롤을 계속 내려야 됨')
      for (const [tab, name] of [['개요', 'overview'], ['유입', 'traffic'], ['성능', 'perf'], ['서버', 'server']] as const) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await page.waitForTimeout(300);
        problems.push(...(await overflow(page)).map(x => `${tab}: ${x}`));
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        if (w > 800 && h > 1000) problems.push(`${tab}: PC에서 높이 ${h}px(한 화면 넘음)`);
        await page.screenshot({ path: `test-results/admin/${scheme}-${w}-${name}.png`, fullPage: true });
      }
      // 오류 로그: 묶인 줄을 하나 펼친 상태로도 넘치지 않아야(모바일에서 거르개 줄·JSON이 밀렸다)
      await page.getByRole('tab', { name: '오류 로그' }).click();
      await page.waitForTimeout(1200);
      const first = page.locator('.logs li button').first();
      if (await first.count()) await first.click();
      problems.push(...(await overflow(page)).map(x => `오류 로그: ${x}`));
      await page.screenshot({ path: `test-results/admin/${scheme}-${w}-logs.png`, fullPage: false });
      await page.getByRole('tab', { name: '알림' }).click();
      await expect(page.locator('.rules li').first()).toBeVisible();
      problems.push(...await overflow(page));
      await page.screenshot({ path: `test-results/admin/${scheme}-${w}-alerts.png`, fullPage: w > 800 });
      expect(problems).toEqual([]);
    });
  }
}
