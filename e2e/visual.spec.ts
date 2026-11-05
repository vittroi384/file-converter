// 시각 회귀(E2): 주요 화면을 기준 스크린샷과 픽셀 비교. 디자인이 의도치 않게 바뀌면 잡힌다.
// 움직임은 끈 상태(움직임 줄이기 = 정적 그림)로, 시간·숫자처럼 매번 바뀌는 곳은 가린다.
// 기준 갱신(의도한 변경일 때): npx playwright test e2e/visual.spec.ts --project=edge --update-snapshots
import { test, expect } from '@playwright/test';
import { stubTelemetry } from './helpers.ts';

test.skip(({ browserName }) => browserName !== 'chromium', '기준 스크린샷은 Edge 하나로(엔진마다 글꼴 렌더가 달라 기준이 갈린다)');
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => { await stubTelemetry(page); await page.emulateMedia({ reducedMotion: 'reduce' }); });

const PAGES = [['home-ko', '/ko'], ['home-en', '/'], ['landing-heic', '/ko/heic-to-jpg'], ['landing-ssr', '/ja/avif-to-png'], ['notfound', '/ko/zzz']] as const;
for (const scheme of ['light', 'dark'] as const) {
  for (const w of [390, 1280]) {
    for (const [name, path] of PAGES) {
      test(`${name} ${scheme} ${w}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${name}-${scheme}-${w}.png`, {
          fullPage: true,
          animations: 'disabled',
          // 처음엔 비율(0.2%)로 잡아 긴 전체 페이지에선 강조색이 파랑으로 바뀌어도 20개 중 4개만 잡혔다 → 화소 수로
          maxDiffPixels: 200,
        });
      });
    }
  }
}
