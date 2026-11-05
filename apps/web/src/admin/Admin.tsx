import { useCallback, useEffect, useState } from 'react';
import './admin.css';
import { api, ApiError, type AlertsState, type GrafanaState, type LogItem, type PanelData, type Range, type RuleInfo, type Settings } from './api.ts';
import { BarList, Empty, LineChart, StatusBadge, deployTimes, fmtNum, toLines, type Status } from './charts.tsx';
import { Icon, type IconName } from '../app/icons.tsx';

type View = 'overview' | 'traffic' | 'perf' | 'server';
type Tab = View | 'logs' | 'alerts';
const TABS: [Tab, string][] = [['overview', '개요'], ['traffic', '유입'], ['perf', '성능'], ['server', '서버'], ['logs', '오류 로그'], ['alerts', '알림']];
const isView = (t: Tab): t is View => t === 'overview' || t === 'traffic' || t === 'perf' || t === 'server';
const OP_NAMES: Record<string, string> = {
  image: '형식 바꾸기', compress: '용량 줄이기', heic: 'HEIC', psd: 'PSD', svg: 'SVG', 'pdf-merge': 'PDF 합치기', 'pdf-split': 'PDF 나누기',
  'pdf-to-image': 'PDF→이미지', 'image-to-pdf': '사진→PDF', 'pdf-compress': 'PDF 줄이기', data: '데이터',
};
const opName = (o?: string) => (o ? OP_NAMES[o] ?? o : '?');
const ERR_NAMES: Record<string, string> = {
  unsupported: '지원 안 함', decode: '파일 열기 실패', encode: '저장 실패', 'too-large': '너무 큼', 'out-of-memory': '메모리 부족',
  'worker-crash': '작업자 멈춤', timeout: '시간 초과', cancelled: '취소', password: '암호 걸림', unknown: '알 수 없음',
};
// 유입 출처: 묶음(색)과 이름. 색은 묶음을 따른다(순위가 아니라) — 출처가 늘어도 색이 바뀌지 않게
type SourceGroup = 'ai' | 'search' | 'social' | 'direct' | 'other';
const SOURCES: Record<string, [SourceGroup, string]> = {
  chatgpt: ['ai', 'ChatGPT'], perplexity: ['ai', 'Perplexity'], claude: ['ai', 'Claude'], gemini: ['ai', 'Gemini'], copilot: ['ai', 'Copilot'],
  google: ['search', '구글'], bing: ['search', '빙'], naver: ['search', '네이버'], duckduckgo: ['search', 'DuckDuckGo'], yandex: ['search', '얀덱스'], baidu: ['search', '바이두'],
  social: ['social', 'SNS'], direct: ['direct', '직접 입력·북마크'], other: ['other', '다른 사이트'],
};
const GROUPS: Record<SourceGroup, [string, number]> = { ai: ['AI', 6], search: ['검색', 0], social: ['SNS', 4], direct: ['직접', 2], other: ['기타', 3] };
const LOCALE_NAMES: Record<string, string> = { en: '영어', ko: '한국어', es: '스페인어', pt: '포르투갈어', de: '독일어', fr: '프랑스어', ja: '일본어', hi: '힌디어', id: '인도네시아어', zh: '중국어' };
const BOT_NAMES: Record<string, string> = {
  gptbot: 'GPTBot · 학습', 'chatgpt-user': 'ChatGPT · 답변', 'oai-searchbot': 'ChatGPT · 검색',
  claudebot: 'ClaudeBot · 학습', 'claude-user': 'Claude · 답변', 'claude-searchbot': 'Claude · 검색',
  perplexitybot: 'Perplexity · 색인', 'perplexity-user': 'Perplexity · 답변', 'google-extended': 'Google-Extended',
  googlebot: 'Googlebot', bingbot: 'Bingbot', applebot: 'Applebot', bytespider: 'Bytespider', ccbot: 'CCBot', 'meta-externalagent': 'Meta', other: '기타 봇',
};
const KIND_NAMES: Record<string, string> = { page: '첫 화면', landing: '안내 페이지', llms: 'llms.txt', sitemap: '사이트맵', robots: 'robots.txt', other: '기타' };
const REJECT_NAMES: Record<string, string> = { bot: '봇', batch: '묶음 형식', event: '이벤트 형식' };
const PROBE_NAMES: Record<string, string> = { home: '첫 화면', headers: '보안 머리글', landing: '안내 페이지(구운 것)', ssr: 'SSR 페이지', api: 'API', llms: 'llms.txt' };
const BROWSER_NAMES: Record<string, string> = { chrome: '크롬', edge: '엣지', safari: '사파리', firefox: '파이어폭스', samsung: '삼성 인터넷', other: '기타' };

export default function Admin({ onTheme, themeIcon }: { onTheme(): void; themeIcon: IconName }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>(() => { const h = location.hash.slice(1); return TABS.some(([k]) => k === h) ? h as Tab : 'overview'; });
  useEffect(() => { void api.me().then(r => setAuthed(r.authed)).catch(() => setAuthed(false)); }, []);
  useEffect(() => { history.replaceState(null, '', `#${tab}`); }, [tab]);
  const onAuthError = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) setAuthed(false); }, []);

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return (
    <div className="admin">
      <header className="header">
        <a className="brand" href="/"><span className="brand-mark"><Icon name="refresh" size={17} /></span>관리자</a>
        <nav className="admin-tabs" role="tablist" aria-label="관리자 화면" onKeyDown={e => {
          // 탭 목록 키보드: 좌우 화살표·Home·End로 옮기고 바로 연다
          const i = TABS.findIndex(([k]) => k === tab);
          const j = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
          if (j < 0) return;
          e.preventDefault();
          setTab(TABS[j]![0]);
          document.getElementById(`tab-${TABS[j]![0]}`)?.focus();
        }}>
          {TABS.map(([k, l]) => (
            <button key={k} id={`tab-${k}`} role="tab" aria-selected={tab === k} aria-controls="admin-panel" tabIndex={tab === k ? 0 : -1} className="tab" onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
        <span className="header-spacer" />
        <button className="icon-btn" onClick={onTheme} aria-label="테마 바꾸기"><Icon name={themeIcon} /></button>
        <button className="ghost" onClick={() => api.logout().finally(() => setAuthed(false))}>나가기</button>
      </header>
      <main className="main admin-main">
        <div className="admin-panel" id="admin-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {/* 네 화면이 같은 자리·같은 컴포넌트라 탭을 바꿔도 받아 둔 자료를 그대로 쓴다(다시 불러오지 않음) */}
          {isView(tab) && <Dashboard view={tab} onError={onAuthError} />}
          {tab === 'logs' && <Logs onError={onAuthError} />}
          {tab === 'alerts' && <Alerts onError={onAuthError} />}
        </div>
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone(): void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="main login">
      <form className="panel login-box" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setErr('');
        try { await api.login(pw); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }}>
        <h1>관리자</h1>
        <label className="field-label" htmlFor="pw">비밀번호</label>
        <input id="pw" className="text-input" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
        {err && <div className="note err" role="alert">{err}</div>}
        <button className="primary" disabled={!pw || busy}>{busy ? '확인 중…' : '들어가기'}</button>
      </form>
    </main>
  );
}

// ── 대시보드 ────────────────────────────────────────────
const VITAL_LIMITS: Record<string, [number, number, string]> = { LCP: [2500, 4000, 'ms'], INP: [200, 500, 'ms'], FCP: [1800, 3000, 'ms'], TTFB: [800, 1800, 'ms'], CLS: [0.1, 0.25, ''] };
const vitalStatus = (name: string, v: number): Status => { const l = VITAL_LIMITS[name]; if (!l || !isFinite(v)) return 'none'; return v <= l[0] ? 'good' : v <= l[1] ? 'warn' : 'bad'; };
const VITAL_DESC: Record<string, string> = { LCP: '가장 큰 요소가 보이기까지', INP: '눌렀을 때 반응까지', CLS: '화면이 밀리는 정도', FCP: '첫 글자가 보이기까지', TTFB: '서버 첫 응답까지' };

function scalar(p?: PanelData): number { const v = p?.result?.[0]?.value?.[1]; return v === undefined ? NaN : Number(v); }
function rows(p: PanelData | undefined, label: (m: Record<string, string>) => string) {
  return (p?.result ?? []).map((s, i) => ({ label: label(s.metric), value: Number(s.value?.[1] ?? 0), colorIndex: i })).filter(r => isFinite(r.value) && r.value > 0);
}

function Dashboard({ view, onError }: { view: View; onError(e: unknown): void }) {
  const [range, setRange] = useState<Range>(() => { try { return (localStorage.getItem('fc:admin-range') as Range) || '24h'; } catch { return '24h'; } });
  const [data, setData] = useState<Record<string, PanelData> | null>(null);
  const [err, setErr] = useState('');
  const [updated, setUpdated] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try { const r = await api.panels(range); setData(r.panels); setErr(''); setUpdated(new Date()); }
    catch (e) { onError(e); setErr((e as Error).message); }
  }, [range, onError]);
  useEffect(() => { void load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { try { localStorage.setItem('fc:admin-range', range); } catch { /* 무시 */ } }, [range]);

  const p = data ?? {};
  const total = scalar(p.total), failed = scalar(p.failed);
  const success = total > 0 ? (total - failed) / total : NaN;
  const saved = scalar(p.savedRatio);
  const panelErrors = Object.entries(p).filter(([, v]) => v.error);
  const apiUp = scalar(p.apiUp);
  const vitals = (p.vitals?.result ?? []).map(s => ({ name: s.metric.name ?? '', v: Number(s.value?.[1]) }));
  const cls = scalar(p.cls);
  const goodShare = Object.fromEntries((p.vitalsGood?.result ?? []).map(s => [s.metric.name, Number(s.value?.[1])]));
  const refRows = (p.referrals?.result ?? []).map(s => {
    const [group, name] = SOURCES[s.metric.source ?? ''] ?? ['other', s.metric.source ?? '?'];
    const single = group === 'social' || group === 'direct' || group === 'other';
    return { label: single ? name : `${GROUPS[group][0]} · ${name}`, value: Number(s.value?.[1] ?? 0), colorIndex: GROUPS[group][1], group };
  }).filter(r => r.value > 0);
  const refTotal = refRows.reduce((a, r) => a + r.value, 0);
  const aiShare = refTotal > 0 ? refRows.filter(r => r.group === 'ai').reduce((a, r) => a + r.value, 0) / refTotal : NaN;
  const groupRows = (Object.keys(GROUPS) as SourceGroup[]).map(g => ({ label: GROUPS[g][0], value: refRows.filter(r => r.group === g).reduce((a, r) => a + r.value, 0), colorIndex: GROUPS[g][1] })).filter(r => r.value > 0);
  const landingShare = scalar(p.landingShare);
  const RANGE_MS: Record<Range, number> = { '1h': 3600e3, '24h': 86400e3, '7d': 604800e3, '30d': 2592000e3 };
  const deploys = deployTimes(p.deploys?.result, (updated?.getTime() ?? Date.now()) - RANGE_MS[range]);
  const probeSecs = Object.fromEntries((p.probeSecs?.result ?? []).map(s => [s.metric.check, Number(s.value?.[1])]));
  const probes = (p.probes?.result ?? []).map(s => ({ id: s.metric.check ?? '?', ok: Number(s.value?.[1]) === 1, secs: probeSecs[s.metric.check ?? ''] ?? NaN }))
    .sort((a, b) => Number(a.ok) - Number(b.ok) || a.id.localeCompare(b.id));
  const builds = (p.builds?.result ?? []).map(s => ({ component: s.metric.component ?? '?', version: s.metric.version ?? '?' }));
  const errRows = rows(p.errors, m => `${opName(m.op)} · ${ERR_NAMES[m.err ?? ''] ?? '알 수 없음'}`);
  const botRows = rows(p.crawlers, m => BOT_NAMES[m.bot ?? ''] ?? m.bot ?? '?');
  const kindRows = rows(p.crawlKinds, m => KIND_NAMES[m.kind ?? ''] ?? '?');
  const rejRows = rows(p.rejected, m => REJECT_NAMES[m.reason ?? ''] ?? m.reason ?? '?');

  return (
    <>
      <div className="dash-bar">
        <div className="chips" role="radiogroup" aria-label="기간">
          {(['1h', '24h', '7d', '30d'] as Range[]).map(r => (
            <button key={r} className="chip" role="radio" aria-checked={range === r} onClick={() => setRange(r)}>{{ '1h': '1시간', '24h': '24시간', '7d': '7일', '30d': '30일' }[r]}</button>
          ))}
        </div>
        <span className="header-spacer" />
        <span className="muted">{updated ? `${updated.toLocaleTimeString('ko-KR')} 기준 · 1분마다 새로고침` : '불러오는 중…'}</span>
        <button className="icon-btn" onClick={load} aria-label="새로고침"><Icon name="refresh" size={17} /></button>
      </div>
      {err && <div className="note err" role="alert">{err}</div>}
      {panelErrors.length > 0 && <div className="note">일부 패널을 못 불러왔어요: {panelErrors.map(([k]) => k).join(', ')}</div>}

      <section className="kpis">
        <Kpi label="방문" value={fmtNum(scalar(p.views))} />
        <Kpi label="AI 유입 비율" value={fmtNum(aiShare, '%')} />
        <Kpi label="변환" value={fmtNum(total)} />
        <Kpi label="성공률" value={fmtNum(success, '%')} tone={isFinite(success) ? (success >= 0.98 ? 'good' : success >= 0.9 ? 'warn' : 'bad') : undefined} />
        <Kpi label="API" value={apiUp === 1 ? '정상' : isFinite(apiUp) ? '응답 없음' : '–'} tone={apiUp === 1 ? 'good' : isFinite(apiUp) ? 'bad' : undefined} />
      </section>

      {view === 'overview' && (
        <section className="grid2">
          <Card title="분당 변환" sub="성공·실패">
            <LineChart lines={toLines(p.rate?.result, m => (m.result === 'ok' ? '성공' : '실패'), m => (m.result === 'ok' ? 0 : 1))} height={150} markers={deploys} />
          </Card>
          <Card title="많이 쓰는 작업" sub={isFinite(saved) ? `압축하면 중앙값 ${Math.round((1 - saved) * 100)}% 줄어듦` : undefined}>
            <BarList rows={rows(p.byOp, m => opName(m.op)).slice(0, 6)} />
          </Card>
          <Card title="변환 흐름" sub="무엇을 무엇으로">
            <BarList rows={rows(p.flows, m => `${(m.from ?? '').toUpperCase()} → ${(m.to ?? '').toUpperCase()}`).slice(0, 6)} />
          </Card>
          <Card title="실패 원인" sub={failed > 0 ? `${fmtNum(failed)}건` : undefined}>
            {errRows.length ? <BarList rows={errRows.slice(0, 6)} /> : <Empty text="실패 없음" />}
          </Card>
        </section>
      )}

      {view === 'traffic' && (
        <section className="grid2">
          <Card title="어디서 왔나" sub={refTotal > 0 ? `바깥에서 들어온 ${fmtNum(refTotal)}번 · 사이트 안 이동 제외` : undefined}>
            {groupRows.length > 0 && <>
              <div className="stack" role="img" aria-label={groupRows.map(r => `${r.label} ${Math.round(r.value / refTotal * 100)}%`).join(', ')}>
                {groupRows.map(r => <i key={r.label} style={{ flexGrow: r.value, background: `var(--s${r.colorIndex + 1})` }} />)}
              </div>
              <div className="legend">{groupRows.map(r => <span key={r.label}><i style={{ background: `var(--s${r.colorIndex + 1})` }} />{r.label} {Math.round(r.value / refTotal * 100)}%</span>)}</div>
            </>}
            <BarList rows={refRows.slice().sort((a, b) => b.value - a.value).slice(0, 7)} />
          </Card>
          <Card title="AI 추천 유입 추이" sub="시간당 · ChatGPT·Perplexity·Claude·Gemini·Copilot">
            <LineChart lines={toLines(p.aiReferrals?.result, m => SOURCES[m.source ?? '']?.[1] ?? m.source ?? '?', m => ['chatgpt', 'perplexity', 'claude', 'gemini', 'copilot'].indexOf(m.source ?? ''))} height={150} />
          </Card>
          <Card title="언어별 방문" sub={isFinite(landingShare) ? `바깥 유입의 ${Math.round(landingShare * 100)}%가 안내 페이지로 바로 들어옴` : undefined}>
            <BarList rows={rows(p.locales, m => LOCALE_NAMES[m.locale ?? ''] ?? m.locale ?? '?').slice(0, 7)} />
          </Card>
          <Card title="크롤러 방문" sub="AI·검색 봇이 이 사이트를 읽어 간 횟수">
            {botRows.length
              ? <div className="split">
                  <div><h4 className="sub-h">봇</h4><BarList rows={botRows.slice(0, 7)} /></div>
                  {kindRows.length > 0 && <div><h4 className="sub-h">AI 봇이 읽은 곳</h4><BarList rows={kindRows} /></div>}
                </div>
              : <Empty text="아직 기록 없음(nginx 연동 뒤 쌓여요)" />}
          </Card>
        </section>
      )}

      {view === 'perf' && (
        <section className="grid2">
          <Card title="체감 성능" sub="방문자 75%가 겪는 값(구글 기준)">
            <ul className="vitals">
              {[...vitals, { name: 'CLS', v: cls }].filter(x => x.name).map(x => (
                <li key={x.name}>
                  <span><b>{x.name}</b><small>{VITAL_DESC[x.name]}</small></span>
                  <span className="vital-v">{x.name === 'CLS' ? (isFinite(x.v) ? x.v.toFixed(2) : '–') : fmtNum(x.v, 'ms')}</span>
                  <StatusBadge s={vitalStatus(x.name, x.v)} />
                  {isFinite(goodShare[x.name] ?? NaN) && <small className="muted">좋음 {Math.round(goodShare[x.name]! * 100)}%</small>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="처리 시간 상위 5%" sub="p95 추이와 작업별 값">
            <LineChart lines={toLines(p.p95?.result, () => '전체 p95')} unit="s" height={110} />
            <BarList rows={rows(p.p95ByOp, m => opName(m.op)).slice(0, 5)} unit="s" />
          </Card>
          <Card title="기기·브라우저">
            <BarList rows={[...rows(p.devices, m => (m.device === 'mobile' ? '모바일' : 'PC')), ...rows(p.browsers, m => BROWSER_NAMES[m.browser ?? ''] ?? m.browser ?? '?').map(r => ({ ...r, colorIndex: r.colorIndex + 2 }))]} />
          </Card>
          <Card title="성공률 추이">
            <LineChart lines={toLines(p.success?.result, () => '성공률')} unit="%" yMax={1} height={150} markers={deploys} />
          </Card>
        </section>
      )}

      {view === 'server' && (
        <section className="grid2">
          <Card title="API 응답 시간" sub={<StatusBadge s={apiUp === 1 ? 'good' : isFinite(apiUp) ? 'bad' : 'none'}>{apiUp === 1 ? 'API 정상' : isFinite(apiUp) ? 'API 응답 없음' : '자료 없음'}</StatusBadge>}>
            <LineChart lines={toLines(p.apiP95?.result, () => 'API 응답 p95')} unit="s" height={150} markers={deploys} />
          </Card>
          <Card title="API 메모리">
            <LineChart lines={toLines(p.apiMem?.result, () => '상주 메모리')} unit="B" height={150} />
          </Card>
          <Card title="사이트 점검" sub={probes.length ? <StatusBadge s={probes.every(x => x.ok) ? 'good' : 'bad'}>{probes.every(x => x.ok) ? '모두 정상' : `${probes.filter(x => !x.ok).length}개 실패`}</StatusBadge> : '1분마다 직접 열어 봄'}>
            {probes.length ? (
              <ul className="vitals">
                {probes.map(x => <li key={x.id}><span><b>{PROBE_NAMES[x.id] ?? x.id}</b></span><span className="vital-v">{fmtNum(x.secs, 's')}</span><StatusBadge s={x.ok ? 'good' : 'bad'}>{x.ok ? '정상' : '실패'}</StatusBadge></li>)}
              </ul>
            ) : <Empty text="점검 기록 없음(PROBE_URL)" />}
          </Card>
          <Card title="배포" sub={deploys.length ? `이 기간 ${deploys.length}번 · 그래프의 점선` : '이 기간 배포 없음'}>
            {builds.length ? (
              <ul className="vitals">
                {builds.map(b => <li key={b.component}><span><b>{b.component === 'web' ? '화면(web·ssr)' : 'API'}</b><small>지금 실행 중</small></span><span className="vital-v num">{b.version}</span><span /></li>)}
                {deploys.slice(-3).reverse().map(d => <li key={d.t}><span className="deploy-when"><span className="deploy-key" aria-hidden="true" />{new Date(d.t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><span className="num">{d.label}</span><span /></li>)}
              </ul>
            ) : <Empty text="빌드 정보 없음" />}
          </Card>
          <Card title="거부된 통계" sub="봇·형식 오류(정상이면 적음)">
            {rejRows.length ? <BarList rows={rejRows} /> : <Empty text="거부 없음" />}
          </Card>
          <GrafanaCard onError={onError} />
        </section>
      )}
    </>
  );
}

// 그라파나 스위치: 켜면 서버의 grafana-ctl이 컨테이너를 띄우고, /grafana/는 관리자 세션으로 바로 열린다
type GfPhase = GrafanaState['state'];
const GF_PHASE: Record<GfPhase, [Status, string]> = { off: ['none', '꺼짐'], starting: ['warn', '켜는 중'], on: ['good', '켜짐'], stopping: ['warn', '끄는 중'] };
function GrafanaCard({ onError }: { onError(e: unknown): void }) {
  const [gf, setGf] = useState<GrafanaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setGf(await api.grafana()); setErr(''); } catch (e) { onError(e); setErr(e instanceof Error ? e.message : String(e)); }
  }, [onError]);
  // 원하는 상태(want)와 실제(state)가 다르면 바뀌는 중
  const phase: GfPhase | null = !gf ? null : gf.want === 'on' ? (gf.state === 'on' ? 'on' : 'starting') : (gf.state === 'off' ? 'off' : 'stopping');
  const moving = phase === 'starting' || phase === 'stopping';
  useEffect(() => { void load(); const t = setInterval(load, moving ? 3000 : 30_000); return () => clearInterval(t); }, [load, moving]);
  const toggle = async (on: boolean) => {
    setBusy(true);
    try { setGf(await api.setGrafana(on)); setErr(''); } catch (e) { onError(e); setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const offAt = gf?.idleOffAt ? new Date(gf.idleOffAt * 1000).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <Card title="그라파나" sub={phase && <span role="status"><StatusBadge s={GF_PHASE[phase][0]}>{GF_PHASE[phase][1]}</StatusBadge></span>}>
      <div className="gf-row">
        <label className="gf-toggle">
          <span className="switch"><input type="checkbox" role="switch" checked={gf?.want === 'on'} disabled={!gf || busy} onChange={e => void toggle(e.target.checked)} /><span aria-hidden="true" /></span>
          <b>켜 두기</b>
        </label>
        {phase === 'on' && <a className="btn gf-open" href="/grafana/" target="_blank" rel="noopener">그라파나 열기<span className="sr-only">(새 탭)</span></a>}
      </div>
      <p className="muted gf-note">1시간 안 보면 자동으로 꺼져요{offAt && gf?.want === 'on' ? ` · 지금대로면 ${offAt}에 꺼짐` : ''}</p>
      {gf && !gf.watcher && <div className="note">서버의 켜기·끄기 도우미(grafana-ctl)가 돌고 있지 않아요. 스위치를 바꿔도 반영되지 않아요.</div>}
      {err && <div className="note err" role="alert">{err}</div>}
    </Card>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: Status }) {
  return <div className={`kpi panel${tone ? ' ' + tone : ''}`}><span>{label}</span><b>{value}</b></div>;
}
function Card({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return <div className="panel card"><div className="card-head"><h3>{title}</h3>{sub && <span className="muted">{sub}</span>}</div>{children}</div>;
}

// ── 오류 로그 ───────────────────────────────────────────
// 같은 오류가 수백 줄 반복돼 화면이 끝없이 길었다 → 같은 (출처·위치·코드·메시지)는 한 줄로 묶고 ×횟수·처음·마지막 시각만.
// 위에 출처·수준 거르개, 요약 숫자. 긴 메시지는 한 줄로 자르고 눌러야 펼친다.
type LogGroup = { key: string; first: LogItem; last: LogItem; count: number; byHour: Map<string, number> };
export function groupLogs(items: LogItem[]): LogGroup[] {
  const map = new Map<string, LogGroup>();
  for (const it of items) { // items는 최신순
    const key = [it.source ?? '', it.where ?? '', it.code ?? '', it._msg].join('|');
    const g = map.get(key);
    // 시각 목록 대신 시간대별 횟수(예전엔 '12:52 · 12:52 · …'가 스무 번 늘어섰다)
    const hour = new Date(it._time).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric' });
    if (g) { g.count++; g.first = it; g.byHour.set(hour, (g.byHour.get(hour) ?? 0) + 1); }
    else map.set(key, { key, first: it, last: it, count: 1, byHour: new Map([[hour, 1]]) });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.last._time.localeCompare(a.last._time));
}
const SOURCE_NAMES: Record<string, string> = { client: '브라우저', api: 'API' };
const shortTime = (t: string) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Logs({ onError }: { onError(e: unknown): void }) {
  const [q, setQ] = useState('');
  const [hours, setHours] = useState(24);
  const [source, setSource] = useState<'all' | 'client' | 'api'>('all');
  const [grouped, setGrouped] = useState(true);
  const [items, setItems] = useState<LogItem[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await api.logs(q, hours); setItems(r.items); setErr(r.error ?? ''); } catch (e) { onError(e); setErr((e as Error).message); }
  }, [q, hours, onError]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  const shown = (items ?? []).filter(it => source === 'all' || it.source === source);
  const groups = groupLogs(shown);
  const bySource = (s: string) => (items ?? []).filter(it => it.source === s).length;
  return (
    <>
      <div className="dash-bar log-bar">
        <input className="text-input" placeholder="검색(글자 그대로)" value={q} onChange={e => setQ(e.target.value)} aria-label="로그 검색" />
        <div className="chips" role="radiogroup" aria-label="기간">
          {[1, 24, 168].map(h => <button key={h} className="chip" role="radio" aria-checked={hours === h} onClick={() => setHours(h)}>{h === 1 ? '1시간' : h === 24 ? '하루' : '7일'}</button>)}
        </div>
        <div className="chips" role="radiogroup" aria-label="출처">
          {(['all', 'client', 'api'] as const).map(s => <button key={s} className="chip" role="radio" aria-checked={source === s} onClick={() => setSource(s)}>{s === 'all' ? '전체' : SOURCE_NAMES[s]}</button>)}
        </div>
        <label className="toggle"><input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} /> 같은 오류 묶기</label>
      </div>
      {err && <div className="note err" role="alert">{err}</div>}
      {items && items.length > 0 && (
        <div className="log-summary">
          <span><b className="num">{items.length}</b>건</span>
          <span><b className="num">{groupLogs(items).length}</b>종류</span>
          <span>브라우저 <b className="num">{bySource('client')}</b></span>
          <span>API <b className="num">{bySource('api')}</b></span>
        </div>
      )}
      <div className="panel">
        {items === null ? <Empty text="불러오는 중…" /> : !shown.length ? <Empty text="기록된 오류가 없어요" /> : (
          <ul className="logs">
            {(grouped ? groups : shown.map(it => ({ key: it._time + it._msg, first: it, last: it, count: 1, byHour: new Map<string, number>() }))).map(g => (
              <li key={g.key} className={open === g.key ? 'open' : ''}>
                <button onClick={() => setOpen(open === g.key ? null : g.key)} aria-expanded={open === g.key}>
                  {g.count > 1 && <span className="log-count num">×{g.count}</span>}
                  <span className="log-main">
                    <span className="log-msg">{g.last._msg || g.last.code || '(메시지 없음)'}</span>
                    <span className="log-sub">
                      <span className="badge">{SOURCE_NAMES[g.last.source ?? ''] ?? g.last.source ?? '?'}</span>
                      {g.last.where && <span className="badge">{opName(g.last.where)}</span>}
                      {g.last.code && <span className="badge no">{ERR_NAMES[g.last.code] ?? g.last.code}</span>}
                      <time>{g.count > 1 ? `${shortTime(g.first._time)} ~ ${shortTime(g.last._time)}` : shortTime(g.last._time)}</time>
                    </span>
                  </span>
                </button>
                {open === g.key && (
                  <div className="log-detail">
                    {g.count > 1 && <p className="log-hours">{[...g.byHour].reverse().map(([h, n]) => <span key={h}>{h} <b className="num">{n}</b></span>)}</p>}
                    {/* VictoriaLogs 내부 필드(_stream 등)는 빼고 보여 준다 */}
                    <pre>{JSON.stringify(Object.fromEntries(Object.entries(g.last).filter(([k]) => !k.startsWith('_stream'))), null, 2)}</pre>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ── 알림 ────────────────────────────────────────────────
function Alerts({ onError }: { onError(e: unknown): void }) {
  const [state, setState] = useState<AlertsState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<RuleInfo[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadState = useCallback(async () => { try { setState(await api.alerts()); } catch (e) { onError(e); } }, [onError]);
  useEffect(() => {
    void loadState();
    void api.settings().then(r => { setSettings(r.settings); setRules(r.rules); }).catch(onError);
    const t = setInterval(loadState, 30_000);
    return () => clearInterval(t);
  }, [loadState, onError]);

  const edit = (fn: (s: Settings) => void) => setSettings(s => { if (!s) return s; const c = structuredClone(s); fn(c); setDirty(true); return c; });
  const save = async () => {
    if (!settings) return;
    setBusy(true); setMsg(null);
    try { const r = await api.saveSettings(settings); setSettings(r.settings); setDirty(false); setMsg({ ok: true, text: '저장하고 적용했어요' }); void loadState(); }
    catch (e) { onError(e); setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setMsg(null);
    try { const r = await api.testNotify(); setMsg({ ok: true, text: r.note }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const ruleState = (id: string) => state?.rules.find(r => r.id === id);
  const silencedUntil = (id: string) => state?.silences.find(s => s.alertname === id)?.endsAt;

  return (
    <>
      <section className="panel card">
        <div className="card-head"><h3>지금 울리는 알림</h3>
          {state && <span className="muted">{state.reachable.alertmanager ? '' : 'Alertmanager에 닿지 않음 · '}{state.reachable.vmalert ? '' : 'vmalert에 닿지 않음'}</span>}
        </div>
        {!state ? <Empty text="불러오는 중…" /> : !state.firing.length ? <div className="all-clear"><StatusBadge s="good">울리는 알림 없음</StatusBadge></div> : (
          <ul className="firing">
            {state.firing.map(a => (
              <li key={a.labels.alertname + a.startsAt}>
                <StatusBadge s={a.labels.severity === 'critical' ? 'bad' : 'warn'}>{a.labels.severity === 'critical' ? '긴급' : '경고'}</StatusBadge>
                <span><b>{a.annotations.title ?? a.labels.alertname}</b><small>{a.annotations.description}</small></span>
                <button className="secondary" onClick={async () => { await api.silence(a.labels.alertname!, 1).catch(onError); void loadState(); }}>1시간 조용히</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {settings && (
        <>
          <section className="panel card">
            <div className="card-head"><h3>알림 규칙</h3><span className="muted">기준값을 넘으면 알려요</span></div>
            <ul className="rules">
              {rules.map(r => {
                const v = settings.rules[r.id]!;
                const st = ruleState(r.id);
                const until = silencedUntil(r.id);
                return (
                  <li key={r.id} className={v.enabled ? '' : 'off'}>
                    <label className="switch"><input type="checkbox" checked={v.enabled} onChange={e => edit(s => { s.rules[r.id]!.enabled = e.target.checked; })} /><span aria-hidden="true" /><span className="sr-only">{r.title} 켜기</span></label>
                    <span className="rule-text">
                      <b>{r.title}</b> {r.severity === 'critical' && <span className="badge no">긴급</span>}
                      <small>{r.desc}</small>
                      {st?.lastError && <small className="err">규칙 오류: {st.lastError}</small>}
                      {until && <small className="muted">{new Date(until).toLocaleTimeString('ko-KR')}까지 조용히</small>}
                    </span>
                    <span className="rule-th">
                      <input className="text-input" type="number" step="any" min={r.min} max={r.max} value={v.threshold} aria-label={`${r.title} 기준값`}
                        onChange={e => edit(s => { s.rules[r.id]!.threshold = Number(e.target.value); })} />
                      <span>{r.unit}</span>
                    </span>
                    <StatusBadge s={!v.enabled ? 'none' : st?.state === 'firing' ? 'bad' : st?.state === 'pending' ? 'warn' : st ? 'good' : 'none'}>
                      {!v.enabled ? '꺼짐' : st?.state === 'firing' ? '울림' : st?.state === 'pending' ? '지켜보는 중' : st ? '정상' : '–'}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel card">
            <div className="card-head"><h3>받을 곳</h3><span className="muted">여러 곳을 동시에 켤 수 있어요</span></div>
            <div className="channels">
              <Channel title="텔레그램" on={settings.channels.telegram.enabled} onToggle={b => edit(s => { s.channels.telegram.enabled = b; })}
                help="텔레그램에서 @BotFather → /newbot 으로 봇을 만들면 토큰을 줘요. 만든 봇에게 아무 말이나 보낸 뒤 https://api.telegram.org/bot<토큰>/getUpdates 에서 chat.id를 찾으세요.">
                <Field label="봇 토큰" value={settings.channels.telegram.botToken} secret onChange={v => edit(s => { s.channels.telegram.botToken = v; })} placeholder="123456789:AA..." />
                <Field label="채팅 ID" value={settings.channels.telegram.chatId} onChange={v => edit(s => { s.channels.telegram.chatId = v; })} placeholder="예: 123456789" />
              </Channel>
              <Channel title="디스코드" on={settings.channels.discord.enabled} onToggle={b => edit(s => { s.channels.discord.enabled = b; })}
                help="채널 설정 → 연동 → 웹후크 → 새 웹후크 → 주소 복사">
                <Field label="웹후크 주소" value={settings.channels.discord.webhookUrl} secret onChange={v => edit(s => { s.channels.discord.webhookUrl = v; })} placeholder="https://discord.com/api/webhooks/..." />
              </Channel>
              <Channel title="이메일" on={settings.channels.email.enabled} onToggle={b => edit(s => { s.channels.email.enabled = b; })}
                help="Gmail은 smtp.gmail.com:587, 비밀번호 자리에 '앱 비밀번호'를 넣어요.">
                <Field label="SMTP 서버" value={settings.channels.email.smarthost} onChange={v => edit(s => { s.channels.email.smarthost = v; })} placeholder="smtp.gmail.com:587" />
                <Field label="보내는 주소" value={settings.channels.email.from} onChange={v => edit(s => { s.channels.email.from = v; s.channels.email.username = s.channels.email.username || v; })} />
                <Field label="받는 주소" value={settings.channels.email.to} onChange={v => edit(s => { s.channels.email.to = v; })} />
                <Field label="비밀번호" value={settings.channels.email.password} secret onChange={v => edit(s => { s.channels.email.password = v; })} />
              </Channel>
              <Channel title="웹훅" on={settings.channels.webhook.enabled} onToggle={b => edit(s => { s.channels.webhook.enabled = b; })} help="Alertmanager 형식 JSON을 POST로 보내요.">
                <Field label="주소" value={settings.channels.webhook.url} secret onChange={v => edit(s => { s.channels.webhook.url = v; })} placeholder="https://..." />
              </Channel>
              <Channel title="외부 생존 신호" on={settings.channels.deadman.enabled} onToggle={b => edit(s => { s.channels.deadman.enabled = b; })}
                help="서버가 통째로 꺼지면 여기 알림도 같이 멈춰요. healthchecks.io 같은 곳에서 받은 주소를 넣으면 1분마다 '살아 있음'을 보내고, 끊기면 그쪽이 알려 줘요(그쪽 기준 시간은 5분 이상 권장).">
                <Field label="주소" value={settings.channels.deadman.url} secret onChange={v => edit(s => { s.channels.deadman.url = v; })} placeholder="https://hc-ping.com/..." />
              </Channel>
            </div>
            <div className="quiet">
              <label className="switch"><input type="checkbox" checked={settings.quietHours.enabled} onChange={e => edit(s => { s.quietHours.enabled = e.target.checked; })} /><span aria-hidden="true" /><span className="sr-only">방해 금지 시간 켜기</span></label>
              <span><b>방해 금지 시간</b><small>이 시간엔 경고를 모아 뒀다가 보내요. 긴급은 바로 보내요.</small></span>
              <input className="text-input" type="time" value={settings.quietHours.start} onChange={e => edit(s => { s.quietHours.start = e.target.value; })} aria-label="시작" />
              <span>~</span>
              <input className="text-input" type="time" value={settings.quietHours.end} onChange={e => edit(s => { s.quietHours.end = e.target.value; })} aria-label="끝" />
            </div>
            <div className="quiet">
              <span><b>같은 알림 다시 보내기</b><small>해결 안 되면 이 간격마다 다시 알려요</small></span>
              <input className="text-input" type="number" min={1} max={72} value={settings.repeatHours} onChange={e => edit(s => { s.repeatHours = Number(e.target.value); })} aria-label="반복 간격(시간)" />
              <span>시간</span>
            </div>
          </section>

          <div className="save-bar">
            {msg && <span className={msg.ok ? 'saving' : 'err'} role="status">{msg.text}</span>}
            <span className="header-spacer" />
            <button className="secondary" onClick={test} disabled={dirty} title={dirty ? '먼저 저장하세요' : ''}>테스트 알림 보내기</button>
            <button className="primary save" onClick={save} disabled={!dirty || busy}>{busy ? '적용 중…' : '저장하고 적용'}</button>
          </div>
        </>
      )}
    </>
  );
}

function Channel({ title, on, onToggle, help, children }: { title: string; on: boolean; onToggle(b: boolean): void; help: string; children: React.ReactNode }) {
  return (
    <div className={`channel${on ? ' on' : ''}`}>
      <label className="channel-head"><span className="switch"><input type="checkbox" checked={on} onChange={e => onToggle(e.target.checked)} /><span aria-hidden="true" /></span><b>{title}</b></label>
      {on && <><div className="channel-fields">{children}</div><p className="hint">{help}</p></>}
    </div>
  );
}
function Field({ label, value, onChange, secret, placeholder }: { label: string; value: string; onChange(v: string): void; secret?: boolean; placeholder?: string }) {
  return (
    <label className="ch-field"><span>{label}</span>
      <input className="text-input" type={secret ? 'password' : 'text'} autoComplete="off" value={value} placeholder={placeholder}
        onFocus={e => { if (secret && value === '••••••') e.target.select(); }} onChange={e => onChange(e.target.value)} />
    </label>
  );
}
