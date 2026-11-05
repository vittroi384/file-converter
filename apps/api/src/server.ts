import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { TelemetryBatch, TelemetryEvent } from '@fc/shared/schema';
import { classifyCrawler, crawlKind } from '@fc/shared';
import type { Config } from './config.ts';
import { createMetrics, type Metrics } from './metrics.ts';
import { classify, isBot } from './ua.ts';
import { createLogShipper, type LogShipper } from './logs.ts';
import { verifyPassword, issueSession, checkSession } from './auth.ts';
import { PANELS, RANGES, panelQuery, type Range } from './panels.ts';
import {
  RULES, Settings, loadSettings, maskSecrets, mergeSecrets, validateSettings, renderRules, renderAlertmanager, writeAtomic, readOr,
} from './alerting.ts';

const SESSION = 'fc_admin';
const GF_SESSION = 'fc_gf'; // 세션 쿠키는 /api/admin에만 가서 /grafana용으로 같은 토큰을 한 장 더 둔다
const GF_IDLE = 3600; // 이만큼(초) /grafana를 안 열면 꺼진다
const GF_STATES = ['off', 'starting', 'on', 'stopping'];

export interface Deps { fetch: typeof fetch; logs?: LogShipper; metrics?: Metrics }

export async function buildServer(cfg: Config, deps: Deps = { fetch }) {
  // 겹수(숫자): 오른쪽에서 n겹까지만 프록시로 믿는다. true는 손님이 보낸 맨 왼쪽 XFF를 믿어 속도 제한이 풀렸다.
  // Fastify는 숫자를 막아 두므로(직접 접속하면 위조 가능) 함수로 준다 — API 포트는 내부망에만 있어 첫 겹은 늘 nginx다.
  const hops = cfg.trustProxy;
  const trustProxy = typeof hops === 'number' ? (_addr: string, hop: number) => hop < hops : hops;
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, trustProxy });
  const metrics = deps.metrics ?? createMetrics();
  const logs = deps.logs ?? createLogShipper(cfg.victoriaLogsUrl, () => metrics.logPushErrors.inc(), { fetchImpl: deps.fetch });
  const settingsFile = join(cfg.dataDir, 'alert-settings.json');
  const up = (url: string, init?: RequestInit) => deps.fetch(url, { ...init, signal: AbortSignal.timeout(8000) });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // API 응답 시간(라우트 패턴 기준이라 라벨이 폭증하지 않는다)
  app.addHook('onResponse', async (req, reply) => {
    metrics.httpDuration.observe({ route: req.routeOptions.url ?? 'unknown', method: req.method, status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });

  // sendBeacon은 text/plain으로 올 수 있다
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, JSON.parse(body as string)); } catch { done(Object.assign(new Error('bad json'), { statusCode: 400 }), undefined); }
  });

  app.get('/api/health', async () => ({ ok: true }));

  // ── 익명 통계 수신 ─────────────────────────────────────
  app.post('/api/t', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ua = req.headers['user-agent'] ?? '';
    if (isBot(ua)) { metrics.telemetry.inc({ result: 'rejected', reason: 'bot' }); return reply.code(204).send(); }
    const batch = TelemetryBatch.safeParse(req.body);
    if (!batch.success) { metrics.telemetry.inc({ result: 'rejected', reason: 'batch' }); return reply.code(400).send({ error: 'bad batch' }); }
    const who = classify(ua);
    let ok = 0, bad = 0;
    for (const raw of batch.data.events) {
      const e = TelemetryEvent.safeParse(raw);
      if (!e.success) { bad++; continue; }
      ok++;
      metrics.record(e.data, who);
      if (e.data.t === 'err') logs.push({ _msg: e.data.msg || e.data.code, level: 'error', source: 'client', where: e.data.where, code: e.data.code, browser: who.browser, device: who.device });
    }
    if (ok) metrics.telemetry.inc({ result: 'accepted', reason: '' }, ok);
    if (bad) metrics.telemetry.inc({ result: 'rejected', reason: 'event' }, bad);
    return reply.code(204).send();
  });

  // ── 관리자 ─────────────────────────────────────────────
  const authed = (req: FastifyRequest) => checkSession(cfg.sessionSecret, req.cookies[SESSION]);
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authed(req)) return reply.code(401).send({ error: '로그인이 필요해요' });
    // 다른 사이트에서 보낸 요청 차단(SameSite 쿠키에 더해 한 겹 더)
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fc-admin') return reply.code(403).send({ error: '잘못된 요청' });
  };

  app.post('/api/admin/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const pw = (req.body as { password?: unknown } | undefined)?.password;
    if (!cfg.adminPasswordHash) return reply.code(503).send({ error: '관리자 비밀번호가 설정되지 않았어요(ADMIN_PASSWORD_HASH)' });
    if (typeof pw !== 'string' || pw.length > 200 || !verifyPassword(pw, cfg.adminPasswordHash)) {
      logs.push({ _msg: '관리자 로그인 실패', level: 'warn', source: 'api', where: 'admin' });
      return reply.code(401).send({ error: '비밀번호가 맞지 않아요' });
    }
    reply.setCookie(SESSION, issueSession(cfg.sessionSecret), { httpOnly: true, sameSite: 'strict', secure: cfg.secureCookie, path: '/api/admin', maxAge: 12 * 3600 });
    return { ok: true };
  });
  app.post('/api/admin/logout', async (_req, reply) => { reply.clearCookie(SESSION, { path: '/api/admin' }).clearCookie(GF_SESSION, { path: '/grafana' }); return { ok: true }; });
  app.get('/api/admin/me', async req => ({ authed: authed(req) }));

  // 대시보드: 패널 전부를 한 번에(서버가 VictoriaMetrics에 병렬 질의)
  app.get('/api/admin/panels', { preHandler: guard }, async (req, reply) => {
    const range = ((req.query as { range?: string }).range ?? '24h') as Range;
    if (!Object.hasOwn(RANGES, range)) return reply.code(400).send({ error: 'range' }); // 'constructor' 같은 기본 속성 이름도 통과했었다
    const r = RANGES[range];
    const end = Math.floor(Date.now() / 1000);
    const results = await Promise.all(PANELS.map(async p => {
      const q = panelQuery(p, range);
      const url = p.kind === 'range'
        ? `${cfg.victoriaMetricsUrl}/api/v1/query_range?query=${encodeURIComponent(q)}&start=${end - r.seconds}&end=${end}&step=${r.step}`
        : `${cfg.victoriaMetricsUrl}/api/v1/query?query=${encodeURIComponent(q)}&time=${end}`;
      try {
        const res = await up(url);
        const j = await res.json() as { status: string; data?: { result: unknown[] }; error?: string };
        return [p.id, j.status === 'success' ? { kind: p.kind, result: j.data!.result } : { kind: p.kind, error: j.error ?? 'error' }];
      } catch (e) {
        return [p.id, { kind: p.kind, error: `지표 서버에 닿지 않음: ${(e as Error).message}` }];
      }
    }));
    return { range, panels: Object.fromEntries(results) };
  });

  // 오류 로그(VictoriaLogs). 검색어는 LogsQL '구문'이 아니라 글자 그대로 찾는다(주입 방지)
  app.get('/api/admin/logs', { preHandler: guard }, async req => {
    const { q = '', limit = '100', hours = '24' } = req.query as Record<string, string>;
    const words = String(q).trim().slice(0, 100); // q=a&q=b면 배열이 와서 500이었다
    const query = `_time:${Math.min(720, Math.max(1, Number(hours) || 24))}h${words ? ` ${JSON.stringify(words)}` : ''} | sort by (_time desc)`;
    try {
      const res = await up(`${cfg.victoriaLogsUrl}/select/logsql/query?query=${encodeURIComponent(query)}&limit=${Math.min(500, Math.max(1, Math.floor(Number(limit)) || 100))}`);
      const text = await res.text();
      return { items: text.split('\n').filter(Boolean).map(l => JSON.parse(l)) };
    } catch (e) {
      return { items: [], error: `로그 서버에 닿지 않음: ${(e as Error).message}` };
    }
  });

  // 지금 울리는 알림 + 규칙 상태
  app.get('/api/admin/alerts', { preHandler: guard }, async () => {
    const [alerts, rules, silences] = await Promise.all([
      up(`${cfg.alertmanagerUrl}/api/v2/alerts?active=true&silenced=false&inhibited=false`).then(r => r.json()).catch(() => null),
      up(`${cfg.vmalertUrl}/api/v1/rules`).then(r => r.json()).catch(() => null),
      up(`${cfg.alertmanagerUrl}/api/v2/silences`).then(r => r.json()).catch(() => null),
    ]);
    type VmRule = { name: string; state: string; lastError?: string; health?: string; lastEvaluation?: string };
    const ruleStates = ((rules as { data?: { groups?: { rules: VmRule[] }[] } } | null)?.data?.groups ?? []).flatMap(g => g.rules)
      .map(r => ({ id: r.name, state: r.state, health: r.health, lastError: r.lastError || undefined }));
    const activeSilences = ((silences as { status: { state: string }; matchers: { name: string; value: string }[]; endsAt: string; id: string }[] | null) ?? [])
      .filter(s => s.status.state === 'active').map(s => ({ id: s.id, alertname: s.matchers.find(m => m.name === 'alertname')?.value, endsAt: s.endsAt }));
    return { firing: alerts ?? [], rules: ruleStates, silences: activeSilences, reachable: { alertmanager: alerts !== null, vmalert: rules !== null } };
  });

  // "1시간 조용히": Alertmanager 침묵(silence)
  app.post('/api/admin/silence', { preHandler: guard }, async (req, reply) => {
    const { alertname, hours } = req.body as { alertname?: string; hours?: number };
    if (!alertname || (!RULES.some(r => r.id === alertname) && alertname !== 'TestAlert')) return reply.code(400).send({ error: '알 수 없는 알림' });
    const h = Math.min(72, Math.max(0.25, Number(hours) || 1));
    const res = await up(`${cfg.alertmanagerUrl}/api/v2/silences`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matchers: [{ name: 'alertname', value: alertname, isRegex: false, isEqual: true }], startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + h * 3600_000).toISOString(), createdBy: 'admin', comment: `관리자 화면에서 ${h}시간 조용히` }),
    });
    if (!res.ok) return reply.code(502).send({ error: `Alertmanager 거부: ${await res.text()}` });
    return { ok: true };
  });

  // 설정: 규칙 기준값·채널(비밀값은 가려서)
  app.get('/api/admin/settings', { preHandler: guard }, async () => ({
    settings: maskSecrets(await loadSettings(settingsFile)),
    rules: RULES.map(r => ({ id: r.id, title: r.title, desc: r.desc, severity: r.severity, unit: r.unit, min: r.min, max: r.max })),
  }));

  app.put('/api/admin/settings', { preHandler: guard }, async (req, reply) => {
    const parsed = Settings.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '설정 형식이 이상해요', detail: parsed.error.issues.slice(0, 3) });
    const current = await loadSettings(settingsFile);
    const next = mergeSecrets(parsed.data, current);
    const errs = validateSettings(next);
    if (errs.length) return reply.code(400).send({ error: errs.join(' / ') });
    // 이전 파일을 들고 있다가 다시 읽기에 실패하면 되돌린다
    const prev = { rules: await readOr(cfg.rulesFile), am: await readOr(cfg.alertmanagerFile) };
    await writeAtomic(cfg.rulesFile, renderRules(next));
    await writeAtomic(cfg.alertmanagerFile, renderAlertmanager(next, cfg.publicUrl));
    const reload = async () => {
      const [a, b] = await Promise.all([
        up(`${cfg.alertmanagerUrl}/-/reload`, { method: 'POST' }).then(async r => (r.ok ? '' : `Alertmanager: ${(await r.text()).slice(0, 300)}`)).catch(e => `Alertmanager: ${(e as Error).message}`),
        up(`${cfg.vmalertUrl}/-/reload`, { method: 'POST' }).then(async r => (r.ok ? '' : `vmalert: ${(await r.text()).slice(0, 300)}`)).catch(e => `vmalert: ${(e as Error).message}`),
      ]);
      return [a, b].filter(Boolean);
    };
    const failed = await reload();
    if (failed.length) {
      if (prev.rules) await writeAtomic(cfg.rulesFile, prev.rules);
      if (prev.am) await writeAtomic(cfg.alertmanagerFile, prev.am);
      await reload();
      return reply.code(502).send({ error: `적용 실패로 이전 설정으로 되돌렸어요 — ${failed.join(' / ')}` });
    }
    await writeAtomic(settingsFile, JSON.stringify(next, null, 2));
    return { ok: true, settings: maskSecrets(next) };
  });

  // 테스트 알림: 실제 Alertmanager에 가짜 알림을 넣어 채널까지 전체 경로를 시험
  app.post('/api/admin/notify/test', { preHandler: guard, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const now = new Date();
    const res = await up(`${cfg.alertmanagerUrl}/api/v2/alerts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ labels: { alertname: 'TestAlert', severity: 'critical', test: now.toISOString() }, annotations: { title: '테스트 알림', description: '관리자 화면에서 보낸 테스트예요. 이게 보이면 알림 설정이 잘 된 거예요.' }, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 5 * 60_000).toISOString() }]),
    }).catch(e => ({ ok: false, text: async () => (e as Error).message }) as Response);
    if (!res.ok) return reply.code(502).send({ error: `Alertmanager에 닿지 않음: ${await res.text()}` });
    return { ok: true, note: '30초 안에 설정한 채널로 도착해야 해요(묶음 대기 시간).' };
  });

  // 그라파나 켜기·끄기: 여기선 공유 폴더에 want·seen만 쓰고, 컨테이너를 켜고 끄는 건 호스트의 infra/grafana-ctl(state를 써 준다)
  const ctl = (name: string) => join(cfg.grafanaCtlDir, name);
  const gfStatus = async () => {
    const [w, s, n, st] = await Promise.all([readOr(ctl('want')), readOr(ctl('state')), readOr(ctl('seen')), stat(ctl('state')).catch(() => null)]);
    const want = w.trim() === 'on' ? 'on' : 'off';
    const seen = Number(n.trim()) || 0;
    return {
      want, state: GF_STATES.includes(s.trim()) ? s.trim() : 'off', seen,
      idleOffAt: want === 'on' && seen ? seen + GF_IDLE : null,
      watcher: !!st && Date.now() - st.mtimeMs < 90_000, // 감시 스크립트가 15초마다 state를 다시 쓴다
    };
  };
  let lastSeen = 0;
  const touchSeen = async (now = Math.floor(Date.now() / 1000)) => {
    if (now - lastSeen < 30) return; // 화면 조각 요청마다 쓰지 않게
    lastSeen = now;
    await writeAtomic(ctl('seen'), String(now));
  };
  app.get('/api/admin/grafana', { preHandler: guard }, async (req, reply) => {
    reply.setCookie(GF_SESSION, req.cookies[SESSION]!, { httpOnly: true, sameSite: 'strict', secure: cfg.secureCookie, path: '/grafana', maxAge: 12 * 3600 });
    return gfStatus();
  });
  app.post('/api/admin/grafana', { preHandler: guard, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const on = (req.body as { on?: unknown } | undefined)?.on;
    if (typeof on !== 'boolean') return reply.code(400).send({ error: 'on은 true/false' });
    if (on) { lastSeen = 0; await touchSeen(); } // 켠 때부터 1시간
    await writeAtomic(ctl('want'), on ? 'on' : 'off');
    return gfStatus();
  });
  // nginx auth_request 전용(/api/ 밖이라 밖에서 직접 못 연다): 세션이 맞으면 204 + 마지막 사용 시각 갱신
  app.get('/internal/grafana-auth', async (req, reply) => {
    if (!checkSession(cfg.sessionSecret, req.cookies[GF_SESSION])) return reply.code(401).send();
    await touchSeen();
    return reply.code(204).send();
  });

  return { app, metrics, logs };
}

// /metrics는 외부에 열지 않는 별도 포트로(VictoriaMetrics만 내부망에서 긁어 간다)
export async function buildMetricsServer(metrics: Metrics): Promise<FastifyInstance> {
  const m = Fastify({ logger: false });
  // 크롤러 방문 알림(내부망 전용 포트). nginx mirror가 원래 요청의 UA·경로를 머리글로 넘긴다.
  // 분류는 여기서(@fc/shared 한곳) — nginx엔 '봇 같아 보이면 복제'라는 거친 거름만 둔다.
  m.post('/internal/crawl', async (req, reply) => {
    const ua = String(req.headers['x-crawl-ua'] ?? '').slice(0, 500);
    const path = String(req.headers['x-crawl-path'] ?? '/').slice(0, 300);
    const bot = classifyCrawler(ua);
    if (bot) metrics.crawl(bot, crawlKind(path));
    return reply.code(204).send();
  });
  m.get('/metrics', async (_req, reply) => reply.type(metrics.registry.contentType).send(await metrics.registry.metrics()));
  return m;
}
