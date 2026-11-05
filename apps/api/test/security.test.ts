// 보안 점검: 실제로 공격을 흉내 내 본다(통계 퍼징·라벨 폭증·머리글 위조·인증 우회·CSRF·설정 주입·LogsQL 주입·nginx).
// nginx 항목은 로컬 docker 스택(http://localhost:8080)이 떠 있을 때만 돈다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { buildServer } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import { hashPassword, issueSession } from '../src/auth.ts';

const PW = 'correct-horse-battery';
const HASH = hashPassword(PW);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function fakeFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  let handler: Handler = () => new Response('{}', { status: 200 });
  const f = (async (input: string | URL | Request, init?: RequestInit) => { const url = String(input); calls.push({ url, init }); return handler(url, init); }) as typeof fetch;
  return { f, calls, on(h: Handler) { handler = h; } };
}
async function setup(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-sec-'));
  const cfg = loadConfig({ adminPasswordHash: HASH, sessionSecret: 'test-secret', secureCookie: false, dataDir: dir, rulesFile: join(dir, 'rules/fc.rules.yml'), alertmanagerFile: join(dir, 'am/alertmanager.yml'), ...over });
  const ff = fakeFetch();
  const { app, metrics, logs } = await buildServer(cfg, { fetch: ff.f });
  logs.stop();
  return { app, metrics, logs, cfg, ff, dir };
}
type App = Awaited<ReturnType<typeof setup>>['app'];
const post = (app: App, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/t', headers: { 'content-type': 'application/json', 'user-agent': CHROME, ...headers }, payload: typeof payload === 'string' ? payload : JSON.stringify(payload) });
// 통계로 생기는 시계열만 센다(fc_api_*는 Node 런타임 기본 지표라 GC 종류 등이 저절로 늘어난다)
const seriesCount = (txt: string) => txt.split('\n').filter(l => l && !l.startsWith('#') && !l.startsWith('fc_api_')).length;
async function adminHeaders(app: App) {
  const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: PW } });
  return { cookie: `fc_admin=${r.cookies.find(c => c.name === 'fc_admin')!.value}`, 'x-requested-with': 'fc-admin' };
}

describe('통계 수신 퍼징', () => {
  it('프로토타입 오염 시도: application/json은 400, text/plain도 Object.prototype을 건드리지 못한다', async () => {
    const { app } = await setup();
    const evil = '{"v":1,"events":[{"t":"pv","path":"/","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}}}],"__proto__":{"polluted3":"yes"}}';
    expect((await post(app, evil)).statusCode).toBe(400);
    const r = await post(app, evil, { 'content-type': 'text/plain' });
    expect([204, 400]).toContain(r.statusCode);
    const o = {} as Record<string, unknown>;
    expect(o.polluted).toBeUndefined();
    expect(o.polluted2).toBeUndefined();
    expect(o.polluted3).toBeUndefined();
  });

  it('깊게 중첩된 JSON·이상한 몸통은 400(서버는 계속 산다)', async () => {
    const { app } = await setup();
    // 이벤트 하나가 3만 겹 배열: 파싱은 되고(재귀 폭발 없음) 그 이벤트만 거부, 배치 자체가 배열 덩어리면 400
    const deep = '['.repeat(30_000) + ']'.repeat(30_000);
    expect((await post(app, `{"v":1,"events":[${deep}]}`)).statusCode).toBe(204);
    expect((await post(app, deep)).statusCode).toBe(400);
    for (const body of ['', 'null', '[]', '"x"', '{"v":1}', '{"v":1,"events":"x"}', '{"v":"1","events":[{}]}', '\u0000', '{"v":1,"events":[' + '{},'.repeat(50) + '{}]}'])
      expect((await post(app, body)).statusCode, body.slice(0, 30)).toBe(400);
    expect((await app.inject({ url: '/api/health' })).json()).toEqual({ ok: true });
  });

  it('라벨 폭증 시도: 허용 목록 밖 값·라벨 덮어쓰기·이상한 숫자는 새 시계열을 만들지 못한다', async () => {
    const { app, metrics } = await setup();
    await post(app, { v: 1, events: [{ t: 'pv', path: '/' }, { t: 'conv', op: 'compress', from: 'jpg', to: 'webp', ok: true, ms: 1, inBytes: 1 }] });
    const before = seriesCount(await metrics.registry.metrics());
    const junk = Array.from({ length: 50 }, (_, i) => [
      { t: 'pv', path: `/x${i}` },
      { t: 'pv', path: '/', locale: `x${i}` },
      { t: 'pv', path: '/', browser: `b${i}`, device: `d${i}` }, // 서버가 정하는 라벨을 덮어쓰기
      { t: 'conv', op: 'compress', from: 'jpg', to: 'webp', ok: true, ms: 1, inBytes: 1, err: `e${i}` },
      { t: 'conv', op: 'compress', from: 'jpg", x="1', to: 'webp', ok: true, ms: 1, inBytes: 1 },
      { t: 'conv', op: 'compress', from: 'jpg', to: 'webp', ok: true, ms: 1e308, inBytes: 1 },
      { t: 'conv', op: 'compress', from: 'jpg', to: 'webp', ok: true, ms: 1, inBytes: 1.5 },
      { t: 'vital', name: 'LCP', value: -1, rating: 'good' },
      { t: 'err', where: `w${i}`, code: 'unknown' },
      { t: `x${i}` },
    ][i % 10]);
    for (let i = 0; i < 5; i++) await post(app, { v: 1, events: junk });
    // 같은 사람이 UA만 수백 가지로 바꿔도 브라우저·기기 라벨은 정해진 종류만
    for (let i = 0; i < 40; i++) await post(app, { v: 1, events: [{ t: 'pv', path: '/' }] }, { 'user-agent': `Mozilla/5.0 Weird${i}/1.0` });
    const txt = await metrics.registry.metrics();
    // pv 라벨(browser="other")이 하나 더 생기는 것 말고는 그대로
    expect(seriesCount(txt) - before).toBeLessThanOrEqual(1);
    expect(txt).not.toMatch(/x\d+"|Weird|b\d+"|e\d+"|w\d+"/);
    // 10종 중 '라벨 덮어쓰기'만 정상 이벤트(모르는 키는 버려짐) → 9/10 거부
    expect(txt).toContain('fc_telemetry_events_total{result="rejected",reason="event"} 225');
  });

  it('오류 메시지는 300자 넘으면 이벤트째 거부, 로그 필드에 다른 키를 끼워 넣지 못한다', async () => {
    const { app, logs, ff, cfg } = await setup();
    ff.on(() => new Response('', { status: 200 }));
    await post(app, { v: 1, events: [
      { t: 'err', where: 'ui', code: 'unknown', msg: 'x'.repeat(301) },
      { t: 'err', where: 'ui', code: 'unknown', msg: 'hi\n{"_msg":"fake","level":"info"}', level: 'info', source: 'api', _time: '2000-01-01T00:00:00Z' },
    ] });
    await logs.flush();
    const body = String(ff.calls.find(c => c.url.startsWith(cfg.victoriaLogsUrl))!.init!.body);
    const lines = body.split('\n');
    expect(lines).toHaveLength(1); // 줄바꿈이 JSON 안에서 이스케이프되어 줄(=로그 한 건)을 늘리지 못한다
    const e = JSON.parse(lines[0]!);
    expect(e).toMatchObject({ level: 'error', source: 'client', where: 'ui' });
    expect(e._time).not.toBe('2000-01-01T00:00:00Z');
  });
});

describe('속도 제한과 X-Forwarded-For 위조', () => {
  const saved = process.env.TRUST_PROXY;
  afterEach(() => { if (saved === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = saved; });
  const login = (app: App, xff: string) => app.inject({ method: 'POST', url: '/api/admin/login', headers: { 'x-forwarded-for': xff }, payload: { password: 'wrong' } });

  it('TRUST_PROXY는 몇 겹(숫자)으로 줄 수 있다', () => {
    process.env.TRUST_PROXY = '2';
    expect(loadConfig().trustProxy).toBe(2);
    process.env.TRUST_PROXY = 'true';
    expect(loadConfig().trustProxy).toBe(true);
    delete process.env.TRUST_PROXY;
    expect(loadConfig().trustProxy).toBe(false);
  });

  it('compose는 앞단 겹수만 믿는다(true면 맨 왼쪽 위조 값을 믿어 속도 제한이 풀린다)', () => {
    const compose = parse(readFileSync(join(import.meta.dirname, '../../../infra/docker-compose.yml'), 'utf8'));
    expect(String(compose.services.api.environment.TRUST_PROXY)).toMatch(/^(\d+|\$\{TRUST_PROXY_HOPS:-\d+\})$/);
  });

  it('앞단(Cloudflare/Caddy) + nginx 두 겹: 맨 왼쪽 XFF를 바꿔도 같은 사람으로 센다', async () => {
    // Cloudflare는 손님이 보낸 XFF 뒤에 진짜 IP를 붙이고, nginx는 그 뒤에 Cloudflare IP를 붙인다
    const { app } = await setup({ trustProxy: 2 });
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await login(app, `10.0.0.${i}, 203.0.113.7, 198.51.100.1`)).statusCode);
    expect(codes.at(-1)).toBe(429);
    // 다른 진짜 손님은 따로 센다
    expect((await login(app, '10.0.0.1, 203.0.113.8, 198.51.100.1')).statusCode).toBe(401);
  });
});

describe('관리자 인증 우회 시도', () => {
  it('위조·변형 토큰은 전부 401', async () => {
    const { app } = await setup();
    const good = issueSession('test-secret');
    const [exp, sig] = good.split('.');
    const other = issueSession('other-secret');
    const tokens = [
      '', '.', `${exp}.`, `.${sig}`, `${exp}`, other, `${Number(exp) + 1}.${sig}`, `0${exp}.${sig}`, ` ${exp}.${sig}`,
      `${exp}.${sig}`.toUpperCase(), `${exp}.${sig!.slice(0, -1)}`, `-1.${sig}`, `1e20.${sig}`, `${exp}.${sig}=`,
    ];
    for (const t of tokens) expect((await app.inject({ url: '/api/admin/settings', headers: { cookie: `fc_admin=${encodeURIComponent(t)}` } })).statusCode, t).toBe(401);
    expect((await app.inject({ url: '/api/admin/settings', headers: { cookie: `fc_admin=${good}` } })).statusCode).toBe(200);
  });

  it('HEAD·경로 변형·다른 경로의 쿠키로 우회하지 못한다', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'HEAD', url: '/api/admin/settings' })).statusCode).toBe(401);
    for (const url of ['/api/admin/settings/', '/API/admin/settings', '/api/admin//settings', '/api/admin/settings%2f', '/api/admin/./settings'])
      expect((await app.inject({ url })).statusCode, url).not.toBe(200);
    expect((await app.inject({ url: '/api/admin/settings', headers: { 'x-http-method-override': 'GET', authorization: 'Bearer x' } })).statusCode).toBe(401);
  });

  it('로그인: 문자열이 아닌 비밀번호·너무 긴 비밀번호는 401(해시 계산 전에 거름)', async () => {
    // 1분 5번 제한에 걸리지 않게 시도마다 새 서버
    for (const password of [null, 1, true, [PW], { toString: PW }, 'x'.repeat(201)])
      expect((await (await setup()).app.inject({ method: 'POST', url: '/api/admin/login', payload: { password } })).statusCode).toBe(401);
  });
});

describe('CSRF', () => {
  it('쿠키가 있어도 X-Requested-With 없이 오는 바꾸기 요청은 403(폼·sendBeacon 흉내 text/plain 포함)', async () => {
    const { app } = await setup();
    const { cookie } = await adminHeaders(app);
    const cases = [
      { method: 'PUT' as const, url: '/api/admin/settings', headers: { cookie, 'content-type': 'application/json' }, payload: '{}' },
      { method: 'POST' as const, url: '/api/admin/silence', headers: { cookie, 'content-type': 'text/plain' }, payload: '{"alertname":"ApiDown"}' },
      { method: 'POST' as const, url: '/api/admin/notify/test', headers: { cookie, 'x-requested-with': 'XMLHttpRequest' } },
      { method: 'POST' as const, url: '/api/admin/silence', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'alertname=ApiDown' },
    ];
    for (const c of cases) expect([403, 415]).toContain((await app.inject(c)).statusCode);
  });
});

describe('알림 설정 주입', () => {
  let app: App; let ctx: Awaited<ReturnType<typeof setup>>; let headers: Record<string, string>;
  beforeEach(async () => { ctx = await setup(); app = ctx.app; ctx.ff.on(() => new Response('ok')); headers = await adminHeaders(app); });
  const current = async () => (await app.inject({ url: '/api/admin/settings', headers })).json().settings;

  it('줄바꿈·YAML·Go 템플릿 문법을 넣어도 YAML 구조는 그대로, 값은 글자 그대로', async () => {
    const s = await current();
    const inj = 'a@b.c\nroute:\n  receiver: evil\nreceivers: [{name: evil}]';
    s.channels.email = { enabled: true, smarthost: 'smtp.example.com:587', from: 'x@y.z" }}{{ define "x" }}', to: inj, username: '{{ .ExternalURL }}', password: "'; &anchor !!python/object x" };
    s.channels.webhook = { enabled: true, url: 'https://ok.example/h\n  send_resolved: false\n- url: http://evil' };
    s.channels.telegram = { enabled: true, botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', chatId: '-1001' };
    const r = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: s });
    expect(r.statusCode).toBe(200);
    const am = parse(readFileSync(ctx.cfg.alertmanagerFile, 'utf8'));
    expect(am.route.receiver).toBe('main');
    expect(am.receivers.map((x: { name: string }) => x.name)).toEqual(['main']);
    expect(am.receivers[0].email_configs[0].to).toBe(inj);
    expect(am.receivers[0].email_configs[0].auth_password).toBe("'; &anchor !!python/object x");
    expect(am.receivers[0].webhook_configs).toHaveLength(1);
    expect(am.receivers[0].webhook_configs[0].url).toBe(s.channels.webhook.url);
    expect(am.receivers[0].telegram_configs[0].chat_id).toBe(-1001);
    const rules = parse(readFileSync(ctx.cfg.rulesFile, 'utf8'));
    expect(rules.groups).toHaveLength(1);
  });

  it('규칙 값(for·기준값·방해 금지 시간)으로는 수식·YAML에 글자를 끼울 수 없다', async () => {
    const bad = [
      (s: any) => { s.rules.ConversionSlow.for = '5m\n    labels: {severity: none}'; },
      (s: any) => { s.rules.ConversionSlow.for = '5m or vector(1)'; },
      (s: any) => { s.rules.ConversionSlow.threshold = '1 or vector(1)'; },
      (s: any) => { s.rules.ConversionSlow.threshold = 1e999; },
      (s: any) => { s.quietHours.start = '00:00\n'; },
      (s: any) => { s.quietHours.end = '08:00", location: "x'; },
      (s: any) => { s.repeatHours = '4h\nx'; },
      (s: any) => { s.rules = JSON.parse('{"__proto__":{"enabled":true,"threshold":1,"for":"1m"}}'); },
    ];
    for (const f of bad) {
      const s = await current();
      f(s);
      const r = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(s) });
      expect(r.statusCode, JSON.stringify(s).slice(0, 80)).toBe(400);
    }
  });

  it('비밀값 가림 표시(MASK)를 다른 칸에 넣어도 다른 비밀을 꺼내 오지 못한다', async () => {
    const s = await current();
    s.channels.telegram = { enabled: true, botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', chatId: '-1001' };
    await app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: s });
    const m = await current();
    m.channels.email = { enabled: false, smarthost: '', from: '', to: m.channels.telegram.botToken, username: m.channels.telegram.botToken, password: '' };
    await app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: m });
    const back = await current();
    expect(back.channels.email.to).not.toContain('ABCDEF');
    expect(back.channels.email.username).not.toContain('ABCDEF');
  });
});

describe('관리자 질의 주입', () => {
  let ctx: Awaited<ReturnType<typeof setup>>; let headers: Record<string, string>;
  beforeEach(async () => { ctx = await setup(); headers = await adminHeaders(ctx.app); ctx.ff.on(() => new Response('')); });
  const lastQuery = () => {
    const u = new URL(ctx.ff.calls.at(-1)!.url);
    return { query: u.searchParams.get('query')!, limit: u.searchParams.get('limit'), keys: [...u.searchParams.keys()] };
  };

  it('LogsQL: 따옴표·역슬래시·줄바꿈·파이프·필터 문법은 전부 한 덩어리 글자로', async () => {
    for (const q of ['x" | delete', 'a\\" or _stream:{x="y"}', 'line1\nline2 | stats count()', '*', '_time:1000d', 'x\\', '"', '  | limit 1', 'a&limit=999999&query=*']) {
      await ctx.app.inject({ url: '/api/admin/logs?q=' + encodeURIComponent(q), headers });
      const { query, keys } = lastQuery();
      expect(keys.sort()).toEqual(['limit', 'query']);
      const m = /^_time:24h ("(?:[^"\\]|\\.)*") \| sort by \(_time desc\)$/.exec(query);
      expect(m, query).not.toBeNull();
      expect(JSON.parse(m![1]!)).toBe(q.trim());
    }
  });

  it('LogsQL: 숫자 칸(hours·limit)에 식을 넣어도 숫자로만, limit는 1~500', async () => {
    await ctx.app.inject({ url: '/api/admin/logs?hours=' + encodeURIComponent('1h | delete') + '&limit=' + encodeURIComponent('5 | x'), headers });
    expect(lastQuery().query).toBe('_time:24h | sort by (_time desc)');
    expect(lastQuery().limit).toBe('100');
    await ctx.app.inject({ url: '/api/admin/logs?limit=-1', headers });
    expect(Number(lastQuery().limit)).toBeGreaterThanOrEqual(1);
    await ctx.app.inject({ url: '/api/admin/logs?limit=1e9', headers });
    expect(lastQuery().limit).toBe('500');
  });

  it('검색어를 여러 번 보내도(q=a&q=b) 500이 아니다', async () => {
    const r = await ctx.app.inject({ url: '/api/admin/logs?q=a&q=b', headers });
    expect(r.statusCode).toBe(200);
  });

  it('패널 범위는 정해진 4개만(Object 기본 속성 이름 포함 거부)', async () => {
    for (const range of ['constructor', 'toString', '__proto__', 'hasOwnProperty', '1h]) or vector(1', '24h ']) {
      const before = ctx.ff.calls.length;
      expect((await ctx.app.inject({ url: '/api/admin/panels?range=' + encodeURIComponent(range), headers })).statusCode, range).toBe(400);
      expect(ctx.ff.calls.length).toBe(before);
    }
  });
});

// ── nginx(로컬 docker 스택) ───────────────────────────────
const BASE = process.env.FC_STACK_URL ?? 'http://localhost:8080';
const stackUp = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false);
const raw = async (path: string, headers: Record<string, string> = {}) => {
  // fetch는 경로를 정규화하므로(.. · 역슬래시) 소켓으로 그대로 보낸다
  const net = await import('node:net');
  const u = new URL(BASE);
  return new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
    const c = net.connect(Number(u.port || 80), u.hostname);
    let out = '';
    c.on('data', d => { out += d; });
    c.on('end', () => {
      const [head, ...rest] = out.split('\r\n\r\n');
      const [status, ...hs] = head!.split('\r\n');
      resolve({ status: Number(status!.split(' ')[1]), headers: Object.fromEntries(hs.map(h => [h.slice(0, h.indexOf(':')).toLowerCase(), h.slice(h.indexOf(':') + 1).trim()])), body: rest.join('\r\n\r\n') });
    });
    c.on('error', reject);
    c.write(`GET ${path} HTTP/1.1\r\nHost: ${headers.host ?? u.host}\r\nUser-Agent: ${CHROME}\r\nConnection: close\r\n${Object.entries(headers).filter(([k]) => k !== 'host').map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`);
  });
};

describe.skipIf(!stackUp)('nginx(로컬 스택)', () => {
  it('SSR 캐시 오염: 인코딩만 다른 주소의 404가 진짜 페이지 자리에 캐시되지 않는다', async () => {
    // 캐시는 하루 남으므로 이 페이지가 아직 캐시에 없을 때만 진짜 재현이 된다(이미 200으로 캐시돼 있으면 그냥 통과)
    const page = `/hi/avif-to-png`;
    const variant = `/hi/avif%2Dto-png?bust=${Date.now()}`;
    await raw(variant);
    await raw(variant);
    const r = await raw(page);
    expect(r.status).toBe(200);
  });

  it('쿼리만 바꿔 SSR을 매번 새로 그리게 하지 못한다(캐시 키에 쿼리 없음)', async () => {
    await raw('/it/avif-to-png');
    const r = await raw(`/it/avif-to-png?x=${Date.now()}`);
    expect(r.headers['x-cache']).toMatch(/HIT|STALE|UPDATING/);
  });

  it('역슬래시 경로로 내부 주소(/__ssr/metrics·/__lang)에 닿지 못한다', async () => {
    for (const p of ['/a/..\\__ssr/metrics', '/a/..%5C__ssr/metrics', '/a/..\\__lang', '/x\\..\\__ssr/metrics']) {
      const r = await raw(p);
      expect(r.body, p).not.toContain('fc_ssr_requests_total');
      expect(r.status, p).toBe(404);
    }
  });

  it('이동(301·302) 주소는 상대 경로: Host·포트·http가 박히지 않고, 다른 사이트로 가지 않는다', async () => {
    const cases: [string, string][] = [['/en/heic-to-jpg', '/heic-to-jpg'], ['/ko/', '/ko'], ['/en', '/']];
    for (const [p, want] of cases) {
      const r = await raw(p, { host: 'evil.example' });
      expect(r.status, p).toBe(301);
      expect(r.headers.location, p).toBe(want);
    }
    for (const p of ['/en//evil.com', '/en/%2Fevil.com', '/en/%5Cevil.com', '/en/\\evil.com', '//evil.com/', '/%5Cevil.com/', '/%2F%2Fevil.com/', '/\\/evil.com/']) {
      const r = await raw(p);
      const loc = r.headers.location;
      if (loc !== undefined) expect(new URL(loc, 'https://site.example').host, `${p} → ${loc}`).toBe('site.example');
    }
  });

  it('API 응답에도 nosniff 등 보안 머리글', async () => {
    const r = await raw('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});
