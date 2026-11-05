// 스크롤 장면 검사: 지원 브라우저에선 무대가 고정되고 숫자가 실제 데모 값으로 줄어든다.
// 지원 안 함·움직임 줄이기에선 정적 그림(결과 값)이 그대로 보인다. 단계별 스크린샷은 test-results/scroll/.
import { test, expect, type Page } from '@playwright/test';
import demoJson from '../apps/web/src/app/demo.json' with { type: 'json' };
import type { DemoData } from '../apps/web/src/app/page-data.ts';
const demo = demoJson as DemoData;
import { stubTelemetry } from './helpers.ts';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => { await stubTelemetry(page); });

const kbFrom = Math.round(demo.before.bytes / 1024), kbTo = Math.round(demo.after.bytes / 1024);

async function scrollTo(page: Page, progress: number) {
  // contain 범위: 구역 위가 화면 위에 닿을 때 0, 구역 아래가 화면 아래에 닿을 때 1
  await page.evaluate(p => {
    const el = document.querySelector<HTMLElement>('.journey')!;
    const top = el.getBoundingClientRect().top + scrollY;
    scrollTo(0, top + (el.offsetHeight - innerHeight) * p);
  }, progress);
  await page.waitForTimeout(250);
}
const kbText = (page: Page) => page.locator('.j-kb').evaluate(el => {
  const live = el.querySelector('.j-kb-live')!;
  // ::after의 content는 그려진 숫자가 아니라 'counter(kb)' 식을 돌려준다(처음 검사가 이걸로 틀렸다) → 애니메이션 중인 --kb 값을 읽는다
  return getComputedStyle(live).display !== 'none' ? `${getComputedStyle(live).getPropertyValue('--kb').trim()} KB` : (el.querySelector('.j-kb-static') as HTMLElement).innerText;
});

test('스크롤 장면: 고정 무대 + 숫자 감소(지원 시) 또는 정적 그림', async ({ page }, info) => {
  await page.goto('/ko');
  const supported = await page.evaluate(() => CSS.supports('animation-timeline: view()'));
  const vw = page.viewportSize()!.width;
  const shots: string[] = [];
  for (const p of [0, 0.25, 0.5, 0.9]) {
    await scrollTo(page, p);
    const f = `test-results/scroll/${info.project.name}-${vw}-${Math.round(p * 100)}.png`;
    await page.screenshot({ path: f });
    shots.push(f);
  }
  if (supported) {
    await scrollTo(page, 0.05);
    expect(await kbText(page)).toContain(String(kbFrom));
    const top1 = await page.locator('.journey-stage').evaluate(el => el.getBoundingClientRect().top);
    await scrollTo(page, 0.6);
    expect(await kbText(page)).toContain(String(kbTo));
    const top2 = await page.locator('.journey-stage').evaluate(el => el.getBoundingClientRect().top);
    expect(Math.abs(top1 - top2), '무대가 고정되어야 함').toBeLessThan(2);
    // 세 번째 설명은 끝에서 밝아진다
    await scrollTo(page, 0.98);
    expect(Number(await page.locator('.journey-steps li').nth(2).evaluate(el => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);
  } else {
    expect(await kbText(page)).toMatch(/KB/);
  }
  // 어떤 경우든 무대 안 글자가 화면 밖으로 안 나간다
  const over = await page.locator('.journey-stage').evaluate(el => [...el.querySelectorAll<HTMLElement>('*')].filter(x => { const r = x.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(x => x.className));
  expect(over).toEqual([]);
  console.log(info.project.name, supported ? '스크롤 연동' : '정적', shots.length);
});

test('움직임 줄이기: 정적 그림, 구역도 늘어나지 않는다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ko');
  const h = await page.locator('.journey').evaluate(el => el.offsetHeight);
  expect(h).toBeLessThan(page.viewportSize()!.height * 1.5);
  expect(await kbText(page)).toMatch(/KB/);
  expect(await page.locator('.proof-item').first().evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});

// ── 첫 화면 장면들: 실제 데모 기록대로 움직이고, 콘솔 오류(하이드레이션 불일치 등)가 없어야 ──
test('탐색 장면·자주 쓰는 변환: 실제 값대로', async ({ page }) => {
  const errs: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('/ko');
  const supported = await page.evaluate(() => CSS.supports('animation-timeline: view()'));
  const at = async (sel: string, p: number) => {
    await page.evaluate(([s, x]) => { const el = document.querySelector(s as string)!; scrollTo(0, el.getBoundingClientRect().top + scrollY + ((el as HTMLElement).offsetHeight - innerHeight) * (x as number)); }, [sel, p]);
    await page.waitForTimeout(250);
  };
  const probes = demo.probes!;
  if (supported) {
    // WebKit은 등록된 정수 속성도 소수로 준다(187.1) → 화면은 calc()로 반올림해 그리므로 시험도 반올림해 비교
    const kb = () => page.locator('.kb-live').evaluate(el => String(Math.round(Number(getComputedStyle(el).getPropertyValue('--kb')))));
    await at('.search-scene', 0.98);
    expect(await kb()).toBe(String(Math.round(probes[probes.length - 1]!.bytes / 1024)));
    await at('.search-scene', 0.48); // 시도 2의 값이 고정된 구간 한가운데(42%는 숫자가 넘어가는 경계라 WebKit에서 사이 값 189가 나왔다)
    expect(probes.map(p => String(Math.round(p.bytes / 1024)))).toContain(await kb());
  } else {
    await expect(page.locator('.kb-static')).toContainText('KB');
  }
  // 자주 쓰는 변환 한 줄(옛 숫자 줄 자리): 언어에 맞는 랜딩 주소로 가는 진짜 링크
  const quick = page.getByRole('navigation', { name: '자주 쓰는 변환' }).locator('a');
  await expect(quick).toHaveCount(6);
  await expect(quick.first()).toHaveAttribute('href', '/ko/heic-to-jpg');
  expect(errs).toEqual([]);
});
