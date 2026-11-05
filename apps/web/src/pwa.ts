// 서비스 워커 등록(공유하기 받기용) + 공유하기로 들어온 파일 꺼내기. 오프라인 캐시는 없다.
export async function registerPwa() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch { /* 지원 안 하는 환경: 공유하기 받기만 빠진다 */ }
  await takeSharedFiles();
}

async function takeSharedFiles() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  history.replaceState(null, '', location.pathname);
  const cache = await caches.open('fc-shared');
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (!res) continue;
    const name = decodeURIComponent(res.headers.get('x-name') ?? 'shared');
    files.push(new File([await res.blob()], name, { type: res.headers.get('content-type') ?? '' }));
    await cache.delete(req);
  }
  // 화면이 이벤트를 받을 준비가 된 뒤에 보낸다
  if (files.length) setTimeout(() => dispatchEvent(new CustomEvent('fc:shared-files', { detail: files })), 0);
}
