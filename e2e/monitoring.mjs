// 모니터링 전체 경로 시험(docker compose 스택이 떠 있어야 함). 약 5분 걸린다.
// 실행: ADMIN_PW=... node e2e/monitoring.mjs
// 통계 → API → VictoriaMetrics / 오류 → VictoriaLogs / 설정 → Alertmanager 재적용 / 오류 급증 → 알림 도착 / API 정지 → 'API 다운' 알림 도착
import http from 'node:http';
import { execSync } from 'node:child_process';

const WEB = 'http://localhost:8080';
const VM = 'http://localhost:8428';
const PW = process.env.ADMIN_PW;
const COMPOSE = process.env.COMPOSE ?? 'docker compose -f infra/docker-compose.yml';
if (!PW) throw new Error('ADMIN_PW 필요');

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]`, ...a);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); log(ok ? '통과' : '실패', name, extra); };
const waitFor = async (what, fn, timeoutMs, everyMs = 5000) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) { log('시간 초과:', what); return null; }
    await new Promise(r => setTimeout(r, everyMs));
  }
};

// 1) 웹훅 수신 서버(텔레그램 대신)
const received = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => { try { received.push({ at: Date.now(), ...JSON.parse(body) }); } catch { /* 무시 */ } res.end('ok'); });
}).listen(9999);
log('웹훅 수신 대기 :9999');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const sendT = events => fetch(`${WEB}/api/t`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ v: 1, events }) });

try {
  // 2) 통계 → 지표
  const marker = Math.floor(Math.random() * 1000) + 1000;
  const r = await sendT([{ t: 'conv', op: 'pdf-compress', from: 'pdf', to: 'pdf', ok: true, ms: marker, inBytes: 2_000_000, outBytes: 500_000 }, { t: 'pv', path: '/' }]);
  check('nginx → API 통계 수신(204)', r.status === 204);
  const vmHit = await waitFor('VictoriaMetrics에 지표 도착', async () => {
    const j = await (await fetch(`${VM}/api/v1/query?query=${encodeURIComponent('sum(fc_conversions_total{op="pdf-compress",device="mobile",browser="safari"})')}`)).json();
    return Number(j.data.result[0]?.value[1] ?? 0) >= 1;
  }, 90_000);
  check('API → VictoriaMetrics(모바일·사파리 라벨)', !!vmHit);

  // 3) 오류 → 로그(개인정보 제거)
  await sendT([{ t: 'err', where: 'pdf-compress', code: 'decode', msg: `marker${marker} C:\\Users\\hong\\주민등록.pdf hong@ex.com` }]);
  const login = await fetch(`${WEB}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW }) });
  check('관리자 로그인', login.status === 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'x-requested-with': 'fc-admin', 'content-type': 'application/json' };
  const logHit = await waitFor('VictoriaLogs에 로그 도착', async () => {
    const j = await (await fetch(`${WEB}/api/admin/logs?q=marker${marker}&hours=1`, { headers: H })).json();
    return j.items?.[0];
  }, 30_000, 2000);
  check('오류 → VictoriaLogs', !!logHit, logHit ? JSON.stringify(logHit._msg) : '');
  check('로그에 개인정보 없음', !!logHit && !/hong|주민|ex\.com/.test(JSON.stringify(logHit)));

  // 4) 대시보드 패널
  const panels = await (await fetch(`${WEB}/api/admin/panels?range=1h`, { headers: H })).json();
  const errs = Object.entries(panels.panels).filter(([, p]) => p.error).map(([k, p]) => `${k}: ${p.error}`);
  check('대시보드 패널 전부 질의 성공', errs.length === 0, errs.join(' | '));

  // 5) 알림 채널 설정 → Alertmanager 재적용
  const { settings } = await (await fetch(`${WEB}/api/admin/settings`, { headers: H })).json();
  settings.channels.webhook = { enabled: true, url: 'http://host.docker.internal:9999/alert' };
  settings.quietHours.enabled = false; // 시험 중엔 방해 금지 끔
  settings.rules.ApiDown.threshold = 1; // 1분
  const put = await fetch(`${WEB}/api/admin/settings`, { method: 'PUT', headers: H, body: JSON.stringify(settings) });
  check('알림 설정 저장·재적용', put.status === 200, put.status === 200 ? '' : await put.text());

  // 6) 테스트 알림 → 웹훅 도착
  await fetch(`${WEB}/api/admin/notify/test`, { method: 'POST', headers: H, body: '{}' });
  const testHit = await waitFor('테스트 알림 도착', async () => received.find(x => x.alerts?.some(a => a.labels.alertname === 'TestAlert')), 60_000, 2000);
  check('테스트 알림 → 웹훅 도착', !!testHit);

  // 7) 오류 급증 → 규칙 → 알림
  for (let i = 0; i < 5; i++) await sendT(Array.from({ length: 5 }, () => ({ t: 'err', where: 'ui', code: 'unknown', msg: 'spike test' })));
  log('브라우저 오류 25건 보냄. 수집 30초 + 평가 30초 + 묶음 대기 30초를 기다린다');
  const spike = await waitFor('오류 급증 알림', async () => received.find(x => x.alerts?.some(a => a.labels.alertname === 'ClientErrorSpike' && a.status === 'firing')), 180_000);
  check('오류 급증 → vmalert → Alertmanager → 웹훅', !!spike, spike ? `(${((spike.at - t0) / 1000).toFixed(0)}s)` : '');

  // 8) API 정지 → API 없이도 'API 다운' 알림이 와야 한다
  log('API 컨테이너 정지');
  execSync(`${COMPOSE} stop api`, { stdio: 'ignore', env: process.env });
  const down = await waitFor('API 다운 알림', async () => received.find(x => x.alerts?.some(a => a.labels.alertname === 'ApiDown' && a.status === 'firing')), 240_000);
  check('API가 죽어도 API 다운 알림 도착', !!down, down ? `(정지 후 ${((down.at - t0) / 1000).toFixed(0)}s 시점)` : '');
  if (down) log('알림 내용:', JSON.stringify(down.alerts.find(a => a.labels.alertname === 'ApiDown').annotations));
} finally {
  execSync(`${COMPOSE} start api`, { stdio: 'ignore', env: process.env });
  server.close();
  const failed = results.filter(r => !r.ok);
  log(`결과: ${results.length - failed.length}/${results.length} 통과`);
  process.exitCode = failed.length ? 1 : 0;
}
