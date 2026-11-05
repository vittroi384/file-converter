/// <reference lib="webworker" />
// 서비스 워커: '공유하기'로 들어온 파일을 받아 앱에 넘기는 일만 한다.
// 오프라인 캐시는 두지 않는다(사용자 결정 2026-11-04: 쓸 때마다 사이트에 들어오게). 예전 버전이 남긴 캐시는 지운다.
// 이전 버전의 오프라인 캐시 구현과 거기서 겪은 문제는 devlog 7절에 남아 있다.

export {}; // import가 없으면 TS가 전역 스크립트로 봐서 self 선언이 충돌한다(빌드 결과는 iife라 영향 없음)
declare const self: ServiceWorkerGlobalScope;

const SHARE_CACHE = 'fc-shared';

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'POST' || url.pathname !== '/share-target') return; // 나머지 요청은 손대지 않고 네트워크로
  e.respondWith((async () => {
    const form = await e.request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    const cache = await caches.open(SHARE_CACHE);
    await Promise.all((await cache.keys()).map(k => cache.delete(k)));
    await Promise.all(files.map((f, i) => cache.put(`/shared/${i}`, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name) } }))));
    return Response.redirect('/?shared=' + files.length, 303);
  })());
});

self.addEventListener('install', () => { void self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 예전 오프라인 캐시(workbox 미리 저장, fc-assets-*) 정리. 공유 받기용 임시 캐시는 남긴다.
    for (const key of await caches.keys()) if (key !== SHARE_CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
