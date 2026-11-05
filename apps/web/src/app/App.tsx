// 앱 뼈대: 머리말·본문·꼬리말. 서버(SSG·SSR)와 브라우저가 같은 트리를 그린다.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { I18n } from '../i18n/context.ts';
import { LOCALES, LOCALE_NAMES, localePath, LANG_COOKIE, type Locale } from '../i18n/locales.ts';
import type { Dict } from '../i18n/types.ts';
import type { PageData } from './page-data.ts';
import { Icon, type IconName } from './icons.tsx';
import { Home } from './Home.tsx';
import { Landing } from './Landing.tsx';
import { CompareModal } from './CompareModal.tsx';
import type { Command } from './CommandPalette.tsx';
// 명령 팔레트는 Ctrl+K로 열 때만 필요하고 구운 HTML에도 없다 → 따로 묶음(첫 화면 JS 예산)
const CommandPalette = lazy(() => import('./CommandPalette.tsx').then(m => ({ default: m.CommandPalette })));

const Admin = lazy(() => import('../admin/Admin.tsx'));

type Theme = 'system' | 'light' | 'dark';
const THEME_ICON: Record<Theme, IconName> = { system: 'auto', light: 'sun', dark: 'moon' };

export function App({ data, t }: { data: PageData; t: Dict }) {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => { try { setTheme((localStorage.getItem('fc:theme') as Theme) || 'system'); } catch { /* 저장소 막힘 */ } }, []);
  const cycleTheme = () => setTheme(cur => {
    const next: Theme = cur === 'system' ? 'light' : cur === 'light' ? 'dark' : 'system';
    if (next === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    try { localStorage.setItem('fc:theme', next); } catch { /* 무시 */ }
    return next;
  });

  const [toast, setToast] = useState<string | null>(null);
  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(x => (x === m ? null : x)), 2600); }, []);
  const [compare, setCompare] = useState<{ before: string; after: string; name: string; label: string } | null>(null);
  const [palette, setPalette] = useState(false);
  const toolCommands = useRef<Command[]>([]);
  const registerCommands = useCallback((c: Command[]) => { toolCommands.current = c; }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const slug = data.landing?.slug ?? '';
  const goLang = (l: Locale) => { document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`; };
  const commands: Command[] = [
    ...toolCommands.current,
    ...data.tools.map(x => ({ id: 'go-' + x.slug, label: x.title, run: () => { location.href = localePath(data.locale, x.slug); } })),
    { id: 'theme', label: t.ui.themeCycle, run: cycleTheme },
  ];

  // 관리자 화면은 브라우저 전용(검색 제외, 서버 렌더 때 location 등을 만지면 터진다)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const page = data.kind === 'admin'
    ? (mounted ? <Suspense fallback={null}><Admin onTheme={cycleTheme} themeIcon={THEME_ICON[theme]} /></Suspense> : null)
    : data.kind === 'landing' && data.landing
      ? <Landing data={data.landing} locale={data.locale} say={say} onCompare={setCompare} registerCommands={registerCommands} />
      : data.kind === 'notfound'
        ? <main className="main narrow"><h1 className="display">404</h1><p><a href={localePath(data.locale)}>{t.site.name}</a></p></main>
        : <Home data={data} say={say} onCompare={setCompare} registerCommands={registerCommands} />;

  if (data.kind === 'admin') return <I18n.Provider value={{ locale: data.locale, t }}>{page}</I18n.Provider>;
  return (
    <I18n.Provider value={{ locale: data.locale, t }}>
      <a className="skip" href="#main">{t.nav.skip}</a>
      <header className="masthead">
        <a className="wordmark" href={localePath(data.locale)} aria-label={t.site.name}>
          <span className="mark" aria-hidden="true"><span /><span /></span>
          <span>Local<b>Convert</b></span>
        </a>
        <nav className="topnav" aria-label="main">
          <a href={`${localePath(data.locale)}#tools`}>{t.nav.tools}</a>
          <a href={`${localePath(data.locale)}#privacy`}>{t.nav.privacy}</a>
        </nav>
        <span className="spacer" />
        <details className="lang">
          <summary aria-label={`${t.nav.language} ${LOCALE_NAMES[data.locale].short}`}><Icon name="globe" size={17} /><span>{LOCALE_NAMES[data.locale].short}</span></summary>
          <ul>
            {LOCALES.map(l => (
              <li key={l}><a href={localePath(l, slug)} hrefLang={LOCALE_NAMES[l].htmlLang} lang={LOCALE_NAMES[l].htmlLang} aria-current={l === data.locale ? 'true' : undefined} onClick={() => goLang(l)}>{LOCALE_NAMES[l].full}</a></li>
            ))}
          </ul>
        </details>
        <button className="icon-btn cmd" onClick={() => setPalette(true)} aria-label={`${t.nav.command} Ctrl K`} aria-keyshortcuts="Control+K"><Icon name="search" size={17} /><kbd>Ctrl K</kbd></button>
        <button className="icon-btn" onClick={cycleTheme} aria-label={t.nav.theme}><Icon name={THEME_ICON[theme]} size={17} /></button>
      </header>
      <div id="main">{page}</div>
      <Footer t={t} data={data} slug={slug} goLang={goLang} />
      <div className="drag-veil" aria-hidden="true">{t.hero.dropOver}</div>
      {compare && <CompareModal {...compare} t={{ ...t.hero, ...t.ui }} onClose={() => { URL.revokeObjectURL(compare.after); setCompare(null); }} />}
      {palette && <Suspense fallback={null}><CommandPalette commands={commands} hint={t.ui.paletteHint} empty={t.ui.paletteEmpty} title={t.nav.command} onClose={() => setPalette(false)} /></Suspense>}
      {/* 알림 영역은 늘 붙여 둔다(내용과 함께 새로 생기면 화면 낭독기가 못 읽는 경우가 있다) */}
      <div role="status">{toast && <div className="toast">{toast}</div>}</div>
    </I18n.Provider>
  );
}

function Footer({ t, data, slug, goLang }: { t: Dict; data: PageData; slug: string; goLang(l: Locale): void }) {
  const [on, setOn] = useState(true);
  useEffect(() => { void import('../telemetry.ts').then(m => setOn(m.telemetryEnabled())); }, []);
  const toggle = async () => { const m = await import('../telemetry.ts'); m.setTelemetry(!on); setOn(!on); };
  return (
    <footer className="colophon">
      <div className="colophon-row">
        <span className="wordmark small">Local<b>Convert</b></span>
        <span className="dim">{t.ui.footer} <button className="link-btn inline" onClick={toggle}>{on ? t.ui.footerToggleOff : t.ui.footerToggleOn}</button></span>
      </div>
      <nav className="colophon-langs" aria-label={t.nav.language}>
        {LOCALES.map(l => <a key={l} href={localePath(l, slug)} hrefLang={LOCALE_NAMES[l].htmlLang} onClick={() => goLang(l)} aria-current={l === data.locale ? 'true' : undefined}>{LOCALE_NAMES[l].full}</a>)}
        <a href="/licenses.txt">{t.ui.licenses}</a>
      </nav>
    </footer>
  );
}
