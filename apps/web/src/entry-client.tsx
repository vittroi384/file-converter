// 브라우저 진입점: 서버가 넘긴 페이지 데이터 + 그 언어 사전 하나만 받아 화면을 이어받는다.
import { hydrateRoot, createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './app/App.tsx';
import { loadDict } from './i18n/context.ts';
import { DATA_ID, type PageData } from './app/page-data.ts';
import { registerPwa } from './pwa.ts';

async function boot() {
  const el = document.getElementById(DATA_ID);
  let data: PageData;
  if (el?.textContent) data = JSON.parse(el.textContent) as PageData;
  else if (import.meta.env.DEV) data = (await import('./app/page-data.server.ts')).pageData(location.pathname); // 개발 서버엔 SSR이 없다
  else data = { locale: 'en', kind: location.pathname.includes('/admin') ? 'admin' : 'notfound', path: location.pathname, tools: [] };
  const t = await loadDict(data.locale);
  const root = document.getElementById('root')!;
  const tree = <App data={data} t={t} />;
  if (root.hasChildNodes()) hydrateRoot(root, tree);
  else createRoot(root).render(tree);

  void registerPwa();
  // 통계·성능 지표는 화면이 뜬 뒤에(첫 화면 묶음을 가볍게)
  const tel = await import('./telemetry.ts');
  tel.track({ t: 'pv', path: data.kind === 'admin' ? '/admin' : data.kind === 'home' ? '/' : data.kind === 'landing' ? 'landing' : 'other', locale: data.locale, ref: tel.referrerSource() });
  if (data.kind !== 'admin') void tel.startVitals();
}
void boot();
