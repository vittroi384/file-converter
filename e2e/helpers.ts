import type { Page } from '@playwright/test';

// 통계 요청 가로채기. WebKit은 sendBeacon을 page.route로 못 가로채서(502가 콘솔 오류로 찍혔다)
// 테스트에서만 sendBeacon을 fetch로 바꿔 끼운다. 앱 코드는 그대로.
export async function stubTelemetry(page: Page, sink?: string[]) {
  await page.addInitScript(() => {
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      // keepalive를 주면 WebKit은 이것도 못 가로챈다. 본문이 Blob이면 WebKit에선 내용을 못 읽어서 글자로 바꿔 보낸다
      void (async () => {
        const body = data instanceof Blob ? await data.text() : (data ?? null);
        await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
      })().catch(() => {});
      return true;
    };
  });
  await page.route('**/api/t', async r => { sink?.push(r.request().postData() ?? ''); await r.fulfill({ status: 204 }); });
}

// 밝은/어두운 화면 고르기. 사이트는 기기 설정을 따르지 않고(어두운 화면이 기본) 저장값 fc:theme만 본다.
// 앱이 뜨기 전에 <html data-theme>까지 미리 붙여 첫 그림부터 그 화면이 되게 한다.
export async function setScheme(page: Page, scheme: 'light' | 'dark') {
  await page.addInitScript(s => {
    try { localStorage.setItem('fc:theme', s); } catch { /* 저장소 막힘 */ }
    if (s !== 'light') return;
    const apply = () => { document.documentElement.dataset.theme = 'light'; };
    if (document.documentElement) apply();
    else new MutationObserver((_, o) => { if (document.documentElement) { apply(); o.disconnect(); } }).observe(document, { childList: true });
  }, scheme);
}
