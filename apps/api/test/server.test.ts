import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { buildServer, buildMetricsServer } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import { hashPassword, issueSession } from '../src/auth.ts';
import { MASK } from '../src/alerting.ts';

const PW = 'correct-horse-battery';
const HASH = hashPassword(PW);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// 외부 서비스(VictoriaMetrics 등) 가짜. 호출 기록을 남기고, 응답은 테스트마다 바꿀 수 있다.
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function fakeFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  let handler: Handler = () => new Response('{}', { status: 200 });
  const f = (async (input: string | URL | Request, init?: RequestInit) => { const url = String(input); calls.push({ url, init }); return handler(url, init); }) as typeof fetch;
  return { f, calls, on(h: Handler) { handler = h; } };
}

async function setup(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-api-'));
  const cfg = loadConfig({ adminPasswordHash: HASH, sessionSecret: 'test-secret', secureCookie: false, dataDir: dir, rulesFile: join(dir, 'rules/fc.rules.yml'), alertmanagerFile: join(dir, 'am/alertmanager.yml'), ...over });
  const ff = fakeFetch();
  const { app, metrics, logs } = await buildServer(cfg, { fetch: ff.f });
  logs.stop();
  return { app, metrics, logs, cfg, ff, dir };
}
const send = (app: Awaited<ReturnType<typeof setup>>['app'], events: unknown[], ua = CHROME) =>
  app.inject({ method: 'POST', url: '/api/t', headers: { 'content-type': 'application/json', 'user-agent': ua }, payload: { v: 1, events } });
const metricText = async (m: Awaited<ReturnType<typeof setup>>['metrics']) => m.registry.metrics();

describe('통계 수신', () => {
  it('정상 이벤트는 지표가 된다(라벨에 브라우저·기기)', async () => {
    const { app, metrics } = await setup();
    const r = await send(app, [
      { t: 'conv', op: 'compress', from: 'jpg', to: 'webp', ok: true, ms: 1200, inBytes: 100_000, outBytes: 40_000 },
      { t: 'vital', name: 'LCP', value: 1800, rating: 'good' },
      { t: 'vital', name: 'CLS', value: 0.02, rating: 'good' },
      { t: 'pv', path: '/' },
    ]);
    expect(r.statusCode).toBe(204);
    const txt = await metricText(metrics);
    expect(txt).toContain('fc_conversions_total{op="compress",from="jpg",to="webp",result="ok",err="",browser="chrome",device="desktop"} 1');
    expect(txt).toMatch(/fc_conversion_size_ratio_bucket\{le="0\.4",op="compress"\} 1/);
    expect(txt).toMatch(/fc_web_vital_cls_bucket\{le="0\.05",device="desktop"\} 1/);
    expect(txt).toContain('fc_telemetry_events_total{result="accepted",reason=""} 4');
    expect(txt).toContain('fc_alert_conversions_total{result="ok"} 1');
  });

  it('허용 목록 밖 값·말이 안 되는 숫자는 그 이벤트만 거부(라벨 폭증 방지)', async () => {
    const { app, metrics } = await setup();
    await send(app, [
      { t: 'conv', op: 'image', from: '내사진.png', to: 'webp', ok: true, ms: 1, inBytes: 1 },
      { t: 'conv', op: 'image', from: 'png', to: 'webp', ok: true, ms: -5, inBytes: 1 },
      { t: 'pv', path: '/' },
    ]);
    const txt = await metricText(metrics);
    expect(txt).not.toContain('내사진');
    expect(txt).toContain('fc_telemetry_events_total{result="rejected",reason="event"} 2');
    expect(txt).toContain('fc_telemetry_events_total{result="accepted",reason=""} 1');
  });

  it('배치 형식이 틀리면 400, 봇은 조용히 버림', async () => {
    const { app, metrics } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/t', headers: { 'content-type': 'application/json' }, payload: { v: 2, events: [] } })).statusCode).toBe(400);
    expect((await send(app, [{ t: 'pv', path: '/' }], 'Googlebot/2.1')).statusCode).toBe(204);
    const txt = await metricText(metrics);
    expect(txt).toContain('reason="bot"} 1');
    expect(txt).not.toContain('fc_page_views_total{');
  });

  it('sendBeacon의 text/plain도 받는다', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/t', headers: { 'content-type': 'text/plain' }, payload: JSON.stringify({ v: 1, events: [{ t: 'pv', path: '/' }] }) });
    expect(r.statusCode).toBe(204);
  });

  it('64KB 넘는 요청은 413', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/t', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ v: 1, events: [{ t: 'err', where: 'ui', code: 'unknown', msg: 'x'.repeat(70_000) }] }) });
    expect(r.statusCode).toBe(413);
  });

  it('1분에 120번 넘으면 429', async () => {
    const { app } = await setup();
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await send(app, [{ t: 'pv', path: '/' }])).statusCode;
    expect(last).toBe(429);
  });

  it('오류 이벤트는 로그로 가고, 개인정보는 서버에서 한 번 더 지운다', async () => {
    const { app, logs, ff, cfg } = await setup();
    ff.on(() => new Response('', { status: 200 }));
    // 브라우저 정화를 우회한 악성·고장 클라이언트를 흉내
    await send(app, [{ t: 'err', where: 'compress', code: 'decode', msg: 'failed C:\\Users\\kim\\여권.jpg kim@ex.com' }]);
    await logs.flush();
    const call = ff.calls.find(c => c.url.startsWith(cfg.victoriaLogsUrl))!;
    const body = String(call.init!.body);
    expect(body).toContain('"where":"compress"');
    expect(body).not.toMatch(/kim|여권|ex\.com/);
  });

  it('로그 서버가 죽어도 버리지 않고 다시 보낸다(+실패 지표)', async () => {
    const { app, logs, ff, metrics } = await setup();
    ff.on(() => { throw new Error('ECONNREFUSED'); });
    await send(app, [{ t: 'err', where: 'ui', code: 'unknown', msg: 'boom' }]);
    await logs.flush();
    expect(logs.pending).toBe(1);
    expect(await metricText(metrics)).toContain('fc_log_push_errors_total 1');
    ff.on(() => new Response('', { status: 200 }));
    await logs.flush();
    expect(logs.pending).toBe(0);
  });
});

describe('관리자 인증', () => {
  const login = (app: Awaited<ReturnType<typeof setup>>['app'], password: string) =>
    app.inject({ method: 'POST', url: '/api/admin/login', payload: { password } });
  const cookieOf = (r: { cookies: { name: string; value: string }[] }) => `fc_admin=${r.cookies.find(c => c.name === 'fc_admin')!.value}`;

  it('비밀번호가 틀리면 401, 맞으면 httpOnly·SameSite=Strict 쿠키', async () => {
    const { app } = await setup();
    expect((await login(app, 'wrong')).statusCode).toBe(401);
    const ok = await login(app, PW);
    expect(ok.statusCode).toBe(200);
    const c = ok.cookies.find(x => x.name === 'fc_admin')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
  });

  it('로그인 시도는 1분에 5번까지', async () => {
    const { app } = await setup();
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await login(app, 'wrong' + i)).statusCode);
    expect(codes.at(-1)).toBe(429);
  });

  it('쿠키 없음·위조·만료는 401, 다른 사이트발 POST는 403', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/api/admin/settings' })).statusCode).toBe(401);
    const forged = `fc_admin=${String(Date.now() + 3600_000)}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect((await app.inject({ url: '/api/admin/settings', headers: { cookie: forged } })).statusCode).toBe(401);
    const expired = `fc_admin=${issueSession('test-secret', -1000)}`;
    expect((await app.inject({ url: '/api/admin/settings', headers: { cookie: expired } })).statusCode).toBe(401);
    const cookie = cookieOf(await login(app, PW));
    expect((await app.inject({ url: '/api/admin/settings', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/admin/notify/test', headers: { cookie } })).statusCode).toBe(403);
  });

  it('비밀번호 설정이 없으면 로그인 자체를 막는다', async () => {
    const { app } = await setup({ adminPasswordHash: '' });
    expect((await login(app, PW)).statusCode).toBe(503);
  });
});

describe('관리자 기능', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let headers: Record<string, string>;
  beforeEach(async () => {
    ctx = await setup();
    const r = await ctx.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: PW } });
    headers = { cookie: `fc_admin=${r.cookies.find(c => c.name === 'fc_admin')!.value}`, 'x-requested-with': 'fc-admin' };
  });

  it('대시보드: 정의된 패널만 VictoriaMetrics에 질의, 한 패널이 실패해도 나머지는 온다', async () => {
    ctx.ff.on(url => url.includes('up%7Bjob') ? new Response(JSON.stringify({ status: 'error', error: 'bad' })) : new Response(JSON.stringify({ status: 'success', data: { result: [{ metric: {}, value: [0, '42'] }] } })));
    const r = await ctx.app.inject({ url: '/api/admin/panels?range=7d', headers });
    const j = r.json();
    expect(j.panels.total.result[0].value[1]).toBe('42');
    expect(j.panels.apiUp.error).toBe('bad');
    expect(ctx.ff.calls.every(c => c.url.startsWith(ctx.cfg.victoriaMetricsUrl))).toBe(true);
    expect((await ctx.app.inject({ url: '/api/admin/panels?range=999d', headers })).statusCode).toBe(400);
  });

  it('로그 검색어는 글자 그대로(LogsQL 명령 주입 차단)', async () => {
    ctx.ff.on(() => new Response('{"_msg":"a"}\n'));
    await ctx.app.inject({ url: '/api/admin/logs?q=' + encodeURIComponent('x" | delete'), headers });
    const q = decodeURIComponent(ctx.ff.calls[0]!.url.split('query=')[1]!.split('&')[0]!);
    expect(q).toBe('_time:24h "x\\" | delete" | sort by (_time desc)');
  });

  it('설정: 비밀값은 가려서 주고, 가려진 값이 돌아오면 기존 값 유지', async () => {
    ctx.ff.on(() => new Response('ok'));
    const s = (await ctx.app.inject({ url: '/api/admin/settings', headers })).json().settings;
    s.channels.telegram = { enabled: true, botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', chatId: '-1001' };
    expect((await ctx.app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: s })).statusCode).toBe(200);
    const masked = (await ctx.app.inject({ url: '/api/admin/settings', headers })).json().settings;
    expect(masked.channels.telegram.botToken).toBe(MASK);
    masked.rules.ConversionSlow.threshold = 30;
    await ctx.app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: masked });
    const am = parse(readFileSync(ctx.cfg.alertmanagerFile, 'utf8'));
    expect(am.receivers[0].telegram_configs[0].bot_token).toBe('123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    const rules = parse(readFileSync(ctx.cfg.rulesFile, 'utf8'));
    expect(rules.groups[0].rules.find((r: { alert: string }) => r.alert === 'ConversionSlow').expr).toContain('> 30');
  });

  it('설정: 범위 밖 기준값·이상한 채널 값은 400', async () => {
    const s = (await ctx.app.inject({ url: '/api/admin/settings', headers })).json().settings;
    s.rules.ConversionSuccessLow.threshold = 5;
    let r = await ctx.app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: s });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('50~99.9');
    s.rules.ConversionSuccessLow.threshold = 90;
    s.channels.discord = { enabled: true, webhookUrl: 'https://evil.example/hook' };
    r = await ctx.app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: s });
    expect(r.json().error).toContain('디스코드');
  });

  it('적용 실패(Alertmanager가 거부)하면 이전 설정 파일로 되돌린다', async () => {
    mkdirSync(join(ctx.dir, 'am'), { recursive: true });
    writeFileSync(ctx.cfg.alertmanagerFile, 'PREVIOUS');
    ctx.ff.on((url) => url.includes('9093/-/reload') && !readFileSync(ctx.cfg.alertmanagerFile, 'utf8').startsWith('PREVIOUS') ? new Response('bad config', { status: 500 }) : new Response('ok'));
    const s = (await ctx.app.inject({ url: '/api/admin/settings', headers })).json().settings;
    const r = await ctx.app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: s });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toContain('되돌렸어요');
    expect(readFileSync(ctx.cfg.alertmanagerFile, 'utf8')).toBe('PREVIOUS');
  });

  it('조용히: 모르는 알림 이름은 거부', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/api/admin/silence', headers, payload: { alertname: 'Whatever' } })).statusCode).toBe(400);
  });
});

describe('알림 전용 카운터', () => {
  it('서버가 켜지자마자 0으로 존재한다(첫 폭주도 increase()로 잡히게)', async () => {
    const { metrics } = await setup();
    const txt = await metricText(metrics);
    expect(txt).toContain('fc_alert_client_errors_total 0');
    expect(txt).toContain('fc_alert_conversions_total{result="error"} 0');
    expect(txt).toContain('fc_telemetry_events_total{result="rejected",reason="event"} 0');
  });
});

describe('/metrics는 별도 포트', () => {
  it('공개 API에는 /metrics가 없다', async () => {
    const { app, metrics } = await setup();
    expect((await app.inject({ url: '/metrics' })).statusCode).toBe(404);
    const m = await buildMetricsServer(metrics);
    const r = await m.inject({ url: '/metrics' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('fc_api_process_resident_memory_bytes');
  });
});

describe('유입 출처·언어', () => {
  it('바깥 유입은 출처별로, 사이트 안 이동은 세지 않는다', async () => {
    const { app, metrics } = await setup();
    await send(app, [
      { t: 'pv', path: 'landing', locale: 'ja', ref: 'chatgpt' },
      { t: 'pv', path: '/', locale: 'ko', ref: 'google' },
      { t: 'pv', path: 'landing', locale: 'ko', ref: 'internal' },
    ]);
    const txt = await metricText(metrics);
    expect(txt).toContain('fc_referrals_total{source="chatgpt",path="landing",locale="ja"} 1');
    expect(txt).toContain('fc_referrals_total{source="google",path="/",locale="ko"} 1');
    expect(txt).not.toContain('source="internal"');
    // 열람 수에는 사이트 안 이동도 들어간다(언어 라벨 포함)
    expect(txt).toContain('fc_page_views_total{path="landing",device="desktop",browser="chrome",locale="ko"} 1');
  });
  it('모르는 출처·언어는 그 이벤트만 거부', async () => {
    const { app, metrics } = await setup();
    await send(app, [{ t: 'pv', path: '/', locale: 'xx', ref: 'chatgpt' }, { t: 'pv', path: '/', ref: 'evil.com' }]);
    expect(await metricText(metrics)).toContain('fc_telemetry_events_total{result="rejected",reason="event"} 2');
  });
});

describe('크롤러 방문(내부 포트)', () => {
  const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)';
  it('nginx가 넘긴 UA·경로로 봇과 종류를 센다', async () => {
    const { metrics } = await setup();
    const m = await buildMetricsServer(metrics);
    const hit = (ua: string, path: string) => m.inject({ method: 'POST', url: '/internal/crawl', headers: { 'x-crawl-ua': ua, 'x-crawl-path': path } });
    expect((await hit(GPTBOT, '/llms.txt')).statusCode).toBe(204);
    await hit(GPTBOT, '/ko/heic-to-jpg');
    await hit(CHROME, '/'); // 사람은 무시
    const txt = await metricText(metrics);
    expect(txt).toContain('fc_crawler_hits_total{bot="gptbot",kind="llms"} 1');
    expect(txt).toContain('fc_crawler_hits_total{bot="gptbot",kind="landing"} 1');
    expect(txt).toContain('fc_crawler_hits_total{bot="claudebot",kind="page"} 0'); // 처음부터 0으로 존재
  });
  it('공개 API 포트에는 없다', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/internal/crawl' })).statusCode).toBe(404);
  });
  it('봇이 보낸 통계(/api/t)는 여전히 버린다', async () => {
    const { app, metrics } = await setup();
    await send(app, [{ t: 'pv', path: '/' }], GPTBOT);
    expect(await metricText(metrics)).toContain('fc_telemetry_events_total{result="rejected",reason="bot"} 1');
  });
});

describe('배포 표시', () => {
  it('실행 중인 빌드 번호를 지표로 낸다', async () => {
    const { metrics } = await setup();
    expect(await metricText(metrics)).toMatch(/fc_build_info\{component="api",version="[^"]+"\} 1/);
  });
});

describe('외부 생존 신호', () => {
  it('켜면 늘 울리는 Watchdog 규칙 + 그 알림만 받는 경로가 생기고, 끄면 없다', async () => {
    const { renderRules, renderAlertmanager, defaultSettings } = await import('../src/alerting.ts');
    const s = defaultSettings();
    expect(renderRules(s)).not.toContain('Watchdog');
    s.channels.deadman = { enabled: true, url: 'https://hc-ping.example/abc' };
    const rules = parse(renderRules(s));
    const wd = rules.groups[0].rules.find((r: { alert: string }) => r.alert === 'Watchdog');
    expect(wd).toMatchObject({ expr: 'vector(1)' });
    const am = parse(renderAlertmanager(s, 'http://x'));
    expect(am.route.routes[0]).toMatchObject({ receiver: 'deadman', matchers: ['alertname="Watchdog"'], group_interval: '1m', repeat_interval: '30s' });
    expect(am.receivers.find((r: { name: string }) => r.name === 'deadman').webhook_configs[0].url).toBe('https://hc-ping.example/abc');
    // 생존 신호가 사람에게 가면 안 된다: 첫 경로가 잡고, 방해 금지(mute)도 안 붙는다
    expect(am.route.routes[0].mute_time_intervals).toBeUndefined();
  });
  it('주소는 가려서 보이고, 잘못된 주소는 거부', async () => {
    const ctx = await setup();
    const { maskSecrets, validateSettings, defaultSettings } = await import('../src/alerting.ts');
    const s = defaultSettings();
    s.channels.deadman = { enabled: true, url: 'ftp://nope' };
    expect(validateSettings(s).join()).toContain('생존 신호');
    s.channels.deadman.url = 'https://hc-ping.example/secret';
    expect(maskSecrets(s).channels.deadman.url).toBe(MASK);
    void ctx;
  });
});

describe('SLO 오류 예산 소진 알림', () => {
  it('목표 99%: 빠른 소진 기준 14.4×1% = 0.144, 느린 소진 6×1% = 0.06, 긴 창·짧은 창 둘 다', async () => {
    const { RULES } = await import('../src/alerting.ts');
    const fast = RULES.find(r => r.id === 'SloBurnFast')!.expr(99);
    expect(fast).toContain('[1h]');
    expect(fast).toContain('[5m]');
    expect(fast.match(/> 0\.14400/g)).toHaveLength(2);
    const slow = RULES.find(r => r.id === 'SloBurnSlow')!.expr(99.9);
    expect(slow.match(/> 0\.00600/g)).toHaveLength(2);
    expect(slow).toContain('[6h]');
  });
});

describe('합성 감시', () => {
  it('정상 응답이면 1, 머리글 빠짐·상태 오류·연결 실패는 0과 이유', async () => {
    const { createProber } = await import('../src/prober.ts');
    const { Registry } = await import('prom-client');
    const good = { 'content-security-policy': "default-src 'self'; connect-src 'self'", 'cross-origin-embedder-policy': 'require-corp' };
    const body: Record<string, string> = { '/': '<title>x</title>', '/ko/heic-to-jpg': 'HEIC', '/ja/avif-to-png': 'AVIF', '/api/health': '{"ok":true}', '/llms.txt': 'x'.repeat(300) };
    let broken = '';
    const f = (async (url: string) => {
      const path = new URL(url).pathname;
      if (path === broken) throw new Error('ECONNREFUSED');
      return new Response(body[path] ?? '', { status: body[path] ? 200 : 404, headers: path === '/' && broken === 'csp' ? {} : good });
    }) as typeof fetch;
    const reg = new Registry();
    const p = createProber(reg, 'http://web', f);
    expect(Object.values(await p.runOnce()).every(v => v === null)).toBe(true);
    expect(await reg.metrics()).toContain('fc_probe_success{check="ssr"} 1');
    broken = 'csp';
    expect((await p.runOnce()).headers).toContain('CSP');
    broken = '/ja/avif-to-png';
    const r = await p.runOnce();
    expect(r.ssr).toContain('연결 실패');
    expect(r.headers).toBeNull();
    expect(await reg.metrics()).toContain('fc_probe_success{check="ssr"} 0');
  });
});

describe('그라파나 켜기·끄기', () => {
  async function gf() {
    const ctlDir = mkdtempSync(join(tmpdir(), 'fc-gf-'));
    const ctx = await setup({ grafanaCtlDir: ctlDir });
    const r = await ctx.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: PW } });
    const token = r.cookies.find(c => c.name === 'fc_admin')!.value;
    return { ...ctx, ctlDir, token, headers: { cookie: `fc_admin=${token}`, 'x-requested-with': 'fc-admin' } };
  }
  const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8');

  it('로그인 없으면 401, 다른 사이트발 POST는 403(파일도 안 씀)', async () => {
    const { app, ctlDir, token } = await gf();
    expect((await app.inject({ url: '/api/admin/grafana' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/admin/grafana', payload: { on: true } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/admin/grafana', headers: { cookie: `fc_admin=${token}` }, payload: { on: true } })).statusCode).toBe(403);
    expect(() => read(ctlDir, 'want')).toThrow();
  });

  it('켜기·끄기는 want를 쓰고, 켤 때 seen을 지금으로', async () => {
    const { app, ctlDir, headers } = await gf();
    expect((await app.inject({ method: 'POST', url: '/api/admin/grafana', headers, payload: { on: 'yes' } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/api/admin/grafana', headers, payload: { on: true } });
    expect(r.statusCode).toBe(200);
    expect(read(ctlDir, 'want')).toBe('on');
    const seen = Number(read(ctlDir, 'seen'));
    expect(Math.abs(seen - Date.now() / 1000)).toBeLessThan(5);
    expect(r.json()).toMatchObject({ want: 'on', state: 'off', seen, idleOffAt: seen + 3600, watcher: false });
    await app.inject({ method: 'POST', url: '/api/admin/grafana', headers, payload: { on: false } });
    expect(read(ctlDir, 'want')).toBe('off');
  });

  it('상태는 감시 스크립트가 쓴 state를 읽고, 모르는 값은 off. /grafana용 쿠키를 준다', async () => {
    const { app, ctlDir, headers } = await gf();
    writeFileSync(join(ctlDir, 'state'), 'starting\n');
    let r = await app.inject({ url: '/api/admin/grafana', headers });
    expect(r.json()).toMatchObject({ want: 'off', state: 'starting', idleOffAt: null, watcher: true });
    const c = r.cookies.find(x => x.name === 'fc_gf')!;
    expect(c).toMatchObject({ path: '/grafana', httpOnly: true, sameSite: 'Strict' });
    writeFileSync(join(ctlDir, 'state'), '<script>');
    r = await app.inject({ url: '/api/admin/grafana', headers });
    expect(r.json().state).toBe('off');
  });

  it('nginx 확인용: fc_gf 세션이 맞을 때만 204 + seen 갱신, 관리자 쿠키·위조는 401', async () => {
    const { app, ctlDir, token } = await gf();
    expect((await app.inject({ url: '/internal/grafana-auth' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/internal/grafana-auth', headers: { cookie: `fc_admin=${token}` } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/internal/grafana-auth', headers: { cookie: `fc_gf=${issueSession('other-secret')}` } })).statusCode).toBe(401);
    expect(() => read(ctlDir, 'seen')).toThrow();
    expect((await app.inject({ url: '/internal/grafana-auth', headers: { cookie: `fc_gf=${token}` } })).statusCode).toBe(204);
    expect(Math.abs(Number(read(ctlDir, 'seen')) - Date.now() / 1000)).toBeLessThan(5);
  });

  it('나가기는 /grafana 쿠키도 지운다', async () => {
    const { app } = await gf();
    const r = await app.inject({ method: 'POST', url: '/api/admin/logout' });
    const c = r.cookies.find(x => x.name === 'fc_gf')!;
    expect(c.path).toBe('/grafana');
    expect(c.value).toBe('');
  });
});
