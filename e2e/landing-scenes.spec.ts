// 랜딩 장면(LandingScenes.tsx): 27개 랜딩 모두 장면이 있고, 콘솔 오류(하이드레이션 불일치 포함)·가로 넘침이 없어야.
// 지원 브라우저에선 스크롤에 맞춰 움직이고, 움직임 줄이기에선 끝난 상태의 정지 그림. 스크린샷은 test-results/landing-scenes/.
import { test, expect, type Page } from '@playwright/test';
import { LANDINGS } from '../apps/web/src/i18n/landings.ts';
import demoJson from '../apps/web/src/app/demo.json' with { type: 'json' };
import { stubTelemetry } from './helpers.ts';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => { await stubTelemetry(page); });

const kb = (b: number) => Math.round(b / 1024);

// 장면 진행 p(0~1)로: 구역 위가 화면 위에 닿을 때 0, 구역 아래가 화면 아래에 닿을 때 1
async function scrollScene(page: Page, p: number) {
  await page.evaluate(x => {
    const el = document.querySelector<HTMLElement>('.ls')!;
    scrollTo(0, el.getBoundingClientRect().top + scrollY + Math.max(0, el.offsetHeight - innerHeight) * x);
  }, p);
  await page.waitForTimeout(200);
}

// 장면 안 요소가 화면 밖으로 나가는지 + 문서 전체 가로 넘침
const overflow = (page: Page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth, bad: string[] = [];
  if (document.documentElement.scrollWidth > vw + 1) bad.push(`문서 폭 ${document.documentElement.scrollWidth} > ${vw}`);
  for (const el of document.querySelectorAll<HTMLElement>('.ls *')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > vw + 1 || r.left < -1) && !el.closest('.ls-code')) bad.push(`${el.tagName.toLowerCase()}.${el.className} [${Math.round(r.left)}~${Math.round(r.right)}]`);
  }
  return bad.slice(0, 8);
});

for (const w of [375, 1280]) {
  test(`27개 랜딩: 장면 있음·콘솔 오류 없음·가로 넘침 없음 (${w}px)`, async ({ page }, info) => {
    test.skip(info.project.name !== 'edge' && w === 375, '좁은 폭은 Edge에서만(엔진별은 아래 시험)');
    await page.setViewportSize({ width: w, height: 800 });
    const errs: string[] = [];
    // WebKit만: 페이지를 연달아 옮기면 시험용 통계 가로채기(helpers.ts가 Blob 본문을 글자로 읽음)가 떠나는 페이지의 Blob을 못 읽어
    // 'Cannot load blob … access control checks'를 찍는다. sendBeacon을 아무것도 안 하게 바꾸면 사라지는 것으로 확인 → 앱 오류가 아니라 뺀다
    const add = (s: string) => { if (!/Cannot load blob.*access control checks/s.test(s)) errs.push(`${page.url()} ${s}`); };
    page.on('console', m => { if (m.type() === 'error') add(m.text()); });
    page.on('pageerror', e => add(String(e)));
    const problems: string[] = [];
    for (const [i, l] of LANDINGS.entries()) {
      const path = `${i % 2 ? '/ko' : ''}/${l.slug}`; // 언어 둘을 번갈아
      await page.goto(path);
      await expect(page.locator('.ls .ls-fig'), path).toBeVisible();
      for (const p of [0, 0.5, 1]) {
        await scrollScene(page, p);
        problems.push(...(await overflow(page)).map(x => `${path} @${p}: ${x}`));
      }
    }
    expect(problems).toEqual([]);
    expect(errs).toEqual([]);
  });
}

test('움직임 줄이기: 정지 그림(결과 값), 구역도 늘어나지 않는다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ko/compress-image');
  const ls = page.locator('.ls');
  expect(await ls.evaluate(el => el.offsetHeight)).toBeLessThan(page.viewportSize()!.height * 1.5);
  await expect(ls.locator('.ls-kb .ls-st')).toHaveText(String(kb(demoJson.after.bytes)));
  for (const el of await ls.locator('.ls-a').all()) expect(await el.evaluate(e => getComputedStyle(e).opacity)).toBe('1');
  await page.goto('/ko/resize-image');
  await expect(page.locator('.ls .ls-n .ls-st').first()).toHaveText('1920');
});

test('스크롤 연동(지원 시): 숫자가 실제 데모 값을 따라가고, 차례로 나타난다', async ({ page }) => {
  await page.goto('/compress-image');
  const supported = await page.evaluate(() => CSS.supports('animation-timeline: view()'));
  const n = () => page.locator('.ls-kb .ls-lv').evaluate(el => getComputedStyle(el).getPropertyValue('--ls-n').trim());
  if (!supported) {
    await expect(page.locator('.ls-kb .ls-st')).toBeVisible(); // 정지 그림
    return;
  }
  await scrollScene(page, 0);
  expect(await n()).toBe(String(kb(demoJson.before.bytes)));
  expect(Number(await page.locator('.ls-dot').last().evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(0.1);
  const top1 = await page.locator('.ls .scene-stage').evaluate(el => el.getBoundingClientRect().top);
  await scrollScene(page, 1);
  expect(await n()).toBe(String(kb(demoJson.after.bytes)));
  expect(Number(await page.locator('.ls-dot').last().evaluate(el => getComputedStyle(el).opacity))).toBe(1);
  const top2 = await page.locator('.ls .scene-stage').evaluate(el => el.getBoundingClientRect().top);
  expect(Math.abs(top1 - top2), '무대가 고정되어야 함').toBeLessThan(2);
});

// 눈으로 보는 용: 대표 랜딩 × 언어 2 × 폭 2 × 진행 3 (Edge만)
const SHOT = ['heic-to-jpg', 'compress-image', 'merge-pdf', 'csv-to-json'];
test('스크린샷', async ({ page }, info) => {
  test.skip(info.project.name !== 'edge');
  for (const w of [390, 1280]) {
    await page.setViewportSize({ width: w, height: w < 800 ? 844 : 900 });
    for (const loc of ['', '/ko']) for (const s of (process.env.LS_SHOT?.split(',') ?? SHOT)) {
      await page.goto(`${loc}/${s}`);
      for (const p of [0.15, 0.5, 1]) {
        await scrollScene(page, p);
        await page.screenshot({ path: `test-results/landing-scenes/${s}-${loc ? 'ko' : 'en'}-${w}-${Math.round(p * 100)}.png` });
      }
    }
  }
});
