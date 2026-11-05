import { test, expect, type Page } from '@playwright/test';
import { stubTelemetry } from './helpers.ts';

// 서비스 워커를 거친 요청은 WebKit에서 가로챌 수 없다 → 오프라인 시험(pwa.spec) 말고는 막고 돌린다
test.use({ serviceWorkers: 'block' });

// 화면 폭 6종에서 가로 넘침 자동 검사 + 스크린샷(test-results/layout/)
const WIDTHS = [320, 375, 414, 768, 1024, 1440];

async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) bad.push(`문서 폭 ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).position === 'fixed') continue;
      // 가로 스크롤 상자 안의 요소는 제외
      let p = el.parentElement, scrolls = false;
      while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { scrolls = true; break; } p = p.parentElement; }
      // '본문 바로가기' 링크는 키보드 사용자를 위해 일부러 화면 밖에 숨겨 둔다(접근성) → 검사 제외
      if (el.matches('.skip, .sr-only')) continue;
      if (!scrolls && (r.right > vw + 1 || r.left < -1)) bad.push(`${el.tagName.toLowerCase()}.${el.className} [${Math.round(r.left)}~${Math.round(r.right)}]`);
    }
    // 버튼 글자가 잘리는지(넘침 숨김 + 실제 폭보다 내용이 큼)
    for (const el of document.querySelectorAll<HTMLElement>('button, .chip, .tab')) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') bad.push(`잘림: ${el.textContent?.trim().slice(0, 20)}`);
    }
    return [...new Set(bad)].slice(0, 15);
  });
}

async function tapTargets(page: Page) {
  // 모바일에서 누르기 어려운(32px 미만) 버튼
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button')].filter(b => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && (r.width < 32 || r.height < 32);
  }).map(b => `${b.getAttribute('aria-label') ?? b.textContent?.trim().slice(0, 15)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`));
}

for (const scheme of ['light', 'dark'] as const) {
  for (const w of WIDTHS) {
    test(`${scheme} ${w}px`, async ({ page }) => {
      await stubTelemetry(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: w, height: w < 800 ? 800 : 900 });
      // 전체 페이지 이어 붙이기는 고정 헤더가 중간에 끼어 보여서, 화면 크기 그대로 찍고 애니메이션이 끝나길 기다린다
      const shot = async (n: string) => { await page.waitForTimeout(400); await page.screenshot({ path: `test-results/layout/${scheme}-${w}-${n}.png` }); };
      const problems: string[] = [];
      await page.goto('/ko');
      problems.push(...(await overflow(page)).map(p => '처음: ' + p));
      await shot('1-home');
      await page.getByTestId('file-input').setInputFiles(['e2e/fixtures/photo.jpg', 'e2e/fixtures/transparent.png', 'e2e/fixtures/iphone.heic']);
      await expect(page.locator('.file')).toHaveCount(3);
      problems.push(...(await overflow(page)).map(p => '파일: ' + p));
      await shot('2-files');
      await page.locator('.run-bar .primary').click();
      await expect(page.locator('.run-bar .primary', { hasText: '받기' })).toBeVisible({ timeout: 60_000 });
      problems.push(...(await overflow(page)).map(p => '결과: ' + p));
      await shot('3-done');
      if (w < 800) problems.push(...(await tapTargets(page)).map(p => '작은 버튼: ' + p));
      // 파일 이름 칸이 너무 좁으면(글자 8자 미만 폭) 실패: 320px에서 'photo.j…'까지만 보이던 문제(스크린샷으로 발견)
      const nameW = await page.locator('.fname').first().evaluate(e => e.getBoundingClientRect().width);
      if (nameW < 8 * 8.5) problems.push(`파일 이름 칸 ${Math.round(nameW)}px`);
      // 글자가 한 글자씩 세로로 쪼개지는 줄바꿈(예: '비우/기')
      // (처음엔 요소 높이로 판단해서 원래 키 큰 칩·탭이 전부 걸렸다 → 글자가 실제로 몇 줄에 그려졌는지 센다)
      const broken = await page.evaluate(() => {
        const out: string[] = [];
        const walker = document.createTreeWalker(document.querySelector('.work') ?? document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const t = (n.textContent ?? '').trim();
          if (!t || t.length > 8) continue; // 짧은 말이 줄바꿈되는 경우만(긴 문장은 줄바꿈이 정상)
          const r = document.createRange();
          r.selectNodeContents(n);
          const lines = new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)));
          if (lines.size > 1) out.push(t);
        }
        return out;
      });
      problems.push(...broken.map(t => '쪼개진 글자: ' + t));
      await page.keyboard.press('Control+K');
      await expect(page.getByRole('dialog', { name: '명령' })).toBeVisible();
      problems.push(...(await overflow(page)).map(p => '팔레트: ' + p));
      await shot('4-palette');
      expect(problems).toEqual([]);
    });
  }
}
