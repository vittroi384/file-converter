import { test, expect } from '@playwright/test';
import { stubTelemetry } from './helpers.ts';

// 오프라인 캐시는 없앴다(사용자 결정). 서비스 워커는 '공유하기' 받기만 한다.
test('오프라인 캐시 없음: 인터넷이 끊기면 다시 열리지 않는다', async ({ page, context }) => {
  await stubTelemetry(page);
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  expect(await page.evaluate(async () => (await caches.keys()).filter(k => k !== 'fc-shared'))).toEqual([]);
  await context.setOffline(true);
  const ok = await page.reload().then(() => page.getByRole('heading', { level: 1 }).isVisible()).catch(() => false);
  expect(ok).toBe(false);
  await context.setOffline(false);
});

test('예전 버전이 남긴 오프라인 캐시를 지운다', async ({ page }) => {
  // 실제 상황 재현: 옛 캐시가 남아 있는 브라우저가 새 버전에 처음 들어온다.
  // (처음엔 같은 페이지에서 등록 해제 → 재등록으로 시험했는데, 브라우저가 해제 대기 중인 등록을 되살려 정리 코드가 안 돌았다)
  await stubTelemetry(page);
  await page.goto('/icons/favicon-48.png'); // 같은 출처지만 서비스 워커를 등록하지 않는 주소
  await page.evaluate(async () => {
    await (await caches.open('fc-assets-v1')).put('/old', new Response('x'));
    await (await caches.open('workbox-precache-v2-http://localhost:4173/')).put('/old', new Response('x'));
  });
  await page.goto('/'); // 새 서비스 워커 설치 → 활성화 때 정리
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(k => k !== 'fc-shared'))).toEqual([]);
});

// Web Share Target은 크로미움 계열(안드로이드 크롬·삼성 인터넷·엣지)만 지원. 아이폰 사파리·파이어폭스는 지원하지 않는다.
test('공유하기로 들어온 파일이 목록에 들어감(크로미움 전용)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '사파리·파이어폭스는 Web Share Target 미지원');
  await stubTelemetry(page);
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  // 휴대폰 공유 시트가 하는 것과 같은 요청(multipart POST /share-target)
  const status = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append('files', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], '공유된 사진.png', { type: 'image/png' }));
    fd.append('files', new File(['a,b\n1,2'], 'data.csv', { type: 'text/csv' }));
    const r = await fetch('/share-target', { method: 'POST', body: fd, redirect: 'manual' });
    return r.type === 'opaqueredirect' ? 303 : r.status;
  });
  expect(status).toBe(303);
  await page.goto('/?shared=2');
  await expect(page.locator('.file')).toHaveCount(2);
  await expect(page.locator('.fname').first()).toHaveText('공유된 사진.png');
  expect(new URL(page.url()).search).toBe('');
});
