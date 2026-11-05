// 운영과 같은 스택(docker compose) 전체 경로 검사: nginx 규칙·SSG·SSR 캐시·언어 이동·크롤러 집계·유입 집계·SSR 장애 대비.
// 실행: node e2e/stack.mjs   (스택이 http://localhost:8080 에 떠 있어야 함)
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:8080';
const UA = {
  human: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)',
  claude: 'Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
  google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};
let fail = 0;
const ok = (cond, name, extra = '') => { console.log(`${cond ? '통과' : '실패'}  ${name}${extra ? `  (${extra})` : ''}`); if (!cond) fail++; };
const get = (path, { ua = UA.human, lang, cookie } = {}) => fetch(BASE + path, { redirect: 'manual', headers: { 'user-agent': ua, ...(lang ? { 'accept-language': lang } : {}), ...(cookie ? { cookie } : {}) } });
const title = async r => (await r.text()).match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const apiMetrics = () => execFileSync('docker', ['exec', 'file-converter-api-1', 'wget', '-qO-', 'http://127.0.0.1:9464/metrics'], { encoding: 'utf8' });
const metric = (txt, line) => Number(txt.split('\n').find(l => l.startsWith(line + ' '))?.split(' ').pop() ?? 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEC = ['content-security-policy', 'cross-origin-embedder-policy', 'cross-origin-opener-policy', 'x-content-type-options'];
const hasSec = r => SEC.every(h => r.headers.get(h));

// ── 언어 이동 ──
{
  let r = await get('/', { lang: 'ko-KR,ko;q=0.9,en;q=0.8' });
  ok(r.status === 302 && r.headers.get('location') === '/ko', '한국어 브라우저 첫 방문 → /ko', `${r.status} ${r.headers.get('location')}`);
  r = await get('/', { lang: 'en-US,en;q=0.9,ja;q=0.5' });
  ok(r.status === 200 && (await title(r)).startsWith('LocalConvert — File converter'), '영어 브라우저 → 영어 첫 화면(정적)');
  r = await get('/', { lang: 'fr;q=0.2,ja;q=0.9' });
  ok(r.status === 302 && r.headers.get('location') === '/ja', 'q값 순서 반영(ja 0.9 > fr 0.2)', r.headers.get('location'));
  r = await get('/', { lang: 'ko', cookie: 'lc_lang=en' });
  ok(r.status === 200, '직접 고른 언어(쿠키)가 있으면 이동 안 함');
  r = await get('/', { lang: 'ko', ua: UA.google });
  ok(r.status === 200, '검색 봇은 이동 안 함(정식 주소 유지)');
  ok(hasSec(r) && /Accept-Language/.test(r.headers.get('vary') ?? ''), '첫 화면 보안 머리글·Vary');
}
// ── 구운 HTML / SSR / 주소 정리 ──
{
  let r = await get('/ko/heic-to-jpg');
  ok(r.status === 200 && (await title(r)).includes('HEIC를 JPG로'), '구운 페이지(SSG)');
  ok(!r.headers.get('x-cache') && hasSec(r), 'SSG는 SSR을 안 거침·보안 머리글');
  const path = `/ja/avif-to-png?x=${Date.now()}`; // 캐시 키는 $uri라 쿼리는 무시된다
  r = await get('/ja/avif-to-png');
  const first = r.headers.get('x-cache');
  ok(r.status === 200 && (await title(r)).includes('AVIFをPNGに'), '롱테일 주소는 SSR', `x-cache ${first}`);
  r = await get(path);
  ok(r.headers.get('x-cache') === 'HIT', '두 번째는 nginx 캐시', r.headers.get('x-cache'));
  ok(hasSec(r), 'SSR 응답 보안 머리글');
  r = await get('/nope-to-zzz');
  ok(r.status === 404 && (await title(r)).startsWith('404'), '없는 주소 → SSR 404 페이지', String(r.status));
  r = await get('/en/heic-to-jpg');
  ok(r.status === 301 && r.headers.get('location')?.endsWith('/heic-to-jpg'), '/en/x → /x', r.headers.get('location'));
  r = await get('/ko/');
  ok(r.status === 301 && r.headers.get('location')?.endsWith('/ko'), '끝 / 제거', r.headers.get('location'));
  r = await get('/__ssr/metrics');
  ok(r.status === 404, 'SSR 지표는 밖에서 못 연다');
  r = await get('/llms.txt');
  ok(r.status === 200 && /charset=utf-8/i.test(r.headers.get('content-type') ?? ''), 'llms.txt utf-8', r.headers.get('content-type'));
  r = await fetch(BASE + '/ko/heic-to-jpg', { headers: { 'accept-encoding': 'gzip' } });
  ok(r.headers.get('content-encoding') === 'gzip', '미리 압축한 .gz 사용');
}
// ── 크롤러 집계(봇마다 정확히 1번, 사람은 0번) ──
{
  const before = apiMetrics();
  const k = (bot, kind) => `fc_crawler_hits_total{bot="${bot}",kind="${kind}"}`;
  await get('/llms.txt', { ua: UA.gptbot });
  await get('/ko/heic-to-jpg', { ua: UA.gptbot });
  await get('/ja/avif-to-png', { ua: UA.gptbot }); // SSR 경로: 내부 이동 뒤 두 번 세지 않는지
  await get('/', { ua: UA.claude, lang: 'ko' });
  await get('/robots.txt', { ua: UA.google });
  await get('/ko/heic-to-jpg', { ua: UA.human });
  await get('/assets/none.js', { ua: UA.gptbot }); // 정적 묶음은 안 셈
  await sleep(500);
  const after = apiMetrics();
  const d = (bot, kind) => metric(after, k(bot, kind)) - metric(before, k(bot, kind));
  ok(d('gptbot', 'llms') === 1, 'GPTBot llms.txt 1번', d('gptbot', 'llms'));
  ok(d('gptbot', 'landing') === 2, 'GPTBot 안내 페이지 2번(SSG 1 + SSR 1, 중복 없음)', d('gptbot', 'landing'));
  ok(d('claude-user', 'page') === 1, 'Claude-User 첫 화면 1번', d('claude-user', 'page'));
  ok(d('googlebot', 'robots') === 1, 'Googlebot robots 1번', d('googlebot', 'robots'));
  ok(d('gptbot', 'other') === 0, '정적 묶음(/assets)은 안 셈', d('gptbot', 'other'));
  const sum = t => t.split('\n').filter(l => l.startsWith('fc_crawler_hits_total{')).reduce((a, l) => a + Number(l.split(' ').pop()), 0);
  ok(sum(after) - sum(before) === 5, '전체 증가 5(사람 요청은 0)', sum(after) - sum(before));
}
// ── 유입 집계(브라우저 통계 경로) ──
{
  const before = apiMetrics();
  const post = events => fetch(BASE + '/api/t', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA.human }, body: JSON.stringify({ v: 1, events }) });
  await post([{ t: 'pv', path: 'landing', locale: 'ja', ref: 'chatgpt' }, { t: 'pv', path: 'landing', locale: 'ja', ref: 'internal' }]);
  const after = apiMetrics();
  const key = 'fc_referrals_total{source="chatgpt",path="landing",locale="ja"}';
  ok(metric(after, key) - metric(before, key) === 1, 'ChatGPT 유입 1번(사이트 안 이동은 안 셈)');
}
// ── 그라파나(/grafana/): 관리자 세션 없이는 켜져 있어도 못 연다 ──
{
  let r = await get('/grafana/');
  ok(r.status === 302 && r.headers.get('location') === '/admin#server', '/grafana/ 세션 없음 → /admin', `${r.status} ${r.headers.get('location')}`);
  r = await fetch(BASE + '/grafana/api/user', { redirect: 'manual', headers: { 'x-webauth-user': 'admin' } });
  ok(r.status === 302, '로그인 머리글(X-WEBAUTH-USER)을 위조해도 못 연다', String(r.status));
  r = await get('/grafana/api/user', { cookie: `fc_gf=${Date.now() + 3600_000}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` });
  ok(r.status === 302, '위조한 세션 쿠키도 못 연다', String(r.status));
  r = await get('/internal/grafana-auth');
  ok(r.status === 404, 'nginx 확인용 주소는 밖에서 못 연다', String(r.status));
}
// ── SSR 장애 대비 ──
{
  docker('stop', 'file-converter-ssr-1');
  try {
    let r = await get('/ja/avif-to-png');
    ok(r.status === 200 && r.headers.get('x-cache') !== 'MISS', 'SSR이 꺼져도 캐시된 페이지는 나간다', `${r.status} ${r.headers.get('x-cache')}`);
    r = await get(`/zh/png-to-gif`);
    ok(r.status === 404 && (await r.text()).includes('<html'), 'SSR이 꺼지고 캐시도 없으면 정적 404 페이지', String(r.status));
    r = await get('/', { lang: 'ko' });
    ok(r.status === 200, 'SSR이 꺼져도 첫 화면은 영어로라도 나간다', String(r.status));
  } finally {
    docker('start', 'file-converter-ssr-1');
  }
}
console.log(fail ? `\n실패 ${fail}개` : '\n모두 통과');
process.exit(fail ? 1 : 0);
