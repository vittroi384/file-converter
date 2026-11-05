// 외부 생존 신호 전체 경로 시험(docker compose 스택 필요, 약 5분).
// 이 PC에 '바깥 감시 서비스' 흉내(신호 받기)를 띄우고 → 관리자 API로 주소 설정 → 1분 간격 신호 도착 확인
// → Alertmanager를 멈추면 신호가 끊기는지 확인 → 원래 설정으로 되돌림.
// 실행: ADMIN_PW=... node e2e/deadman.mjs
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:8080';
const PORT = 9977;
const pings = [];
const sink = http.createServer((req, res) => { pings.push(Date.now()); req.resume(); res.end('ok'); }).listen(PORT, '0.0.0.0');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
const ok = (c, name, extra = '') => { console.log(`${c ? '통과' : '실패'}  ${name}${extra ? `  (${extra})` : ''}`); if (!c) fail++; };

const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PW }) });
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error(`로그인 실패 ${login.status}`);
const H = { cookie, 'content-type': 'application/json', 'x-requested-with': 'fc-admin' };
const before = (await (await fetch(`${BASE}/api/admin/settings`, { headers: H })).json()).settings;

try {
  const next = structuredClone(before);
  next.channels.deadman = { enabled: true, url: `http://host.docker.internal:${PORT}/ping` };
  const put = await fetch(`${BASE}/api/admin/settings`, { method: 'PUT', headers: H, body: JSON.stringify(next) });
  ok(put.ok, '생존 신호 주소 저장·적용', String(put.status));

  // vmalert 평가(30초)·규칙 다시 읽기 + Alertmanager 1분 반복 → 3분 안에 2번 이상 와야 한다
  await sleep(180_000);
  const n = pings.length;
  ok(n >= 2, '1분 간격 신호 도착', `${n}번`);
  // 처음엔 40~130초로 느슨하게 잡아 실제 2분 간격을 통과시켰다 → 45~80초
  if (n >= 2) { const gaps = pings.slice(1).map((t, i) => Math.round((t - pings[i]) / 1000)); ok(gaps.every(g => g >= 45 && g <= 80), '간격 약 1분', gaps.join('·') + '초'); }

  // 감시 경로 하나(Alertmanager)를 멈추면 신호가 끊겨야 바깥에서 장애를 안다
  execFileSync('docker', ['stop', 'file-converter-alertmanager-1']);
  const at = pings.length;
  await sleep(150_000);
  ok(pings.length === at, 'Alertmanager가 멈추면 신호가 끊긴다', `멈춘 뒤 ${pings.length - at}번`);
} finally {
  execFileSync('docker', ['start', 'file-converter-alertmanager-1']);
  await sleep(5000);
  const r = await fetch(`${BASE}/api/admin/settings`, { method: 'PUT', headers: H, body: JSON.stringify(before) });
  console.log(`설정 되돌림: ${r.status}`);
  sink.close();
}
console.log(fail ? `\n실패 ${fail}개` : '\n모두 통과');
process.exitCode = fail ? 1 : 0;
