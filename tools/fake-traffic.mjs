// 대시보드 확인용 가상 사용량(로컬 스택 전용). 실행: node tools/fake-traffic.mjs [분=4] [주소=http://localhost:8080]
const minutes = Number(process.argv[2] ?? 4), base = process.argv[3] ?? 'http://localhost:8080';
if (!/localhost|127\.0\.0\.1/.test(base)) throw new Error('로컬 주소에만 보낸다(실서버 통계 오염 방지)');
const UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/130.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
];
const OPS = [['heic', 'heic', 'jpg', 1.2, 0.5], ['compress', 'jpg', 'jpg', 1.8, 0.45], ['image', 'png', 'webp', 0.6, 0.3], ['pdf-merge', 'pdf', 'pdf', 0.9, 1], ['pdf-compress', 'pdf', 'pdf', 3.5, 0.3], ['data', 'xlsx', 'csv', 0.3, 0.6], ['image-to-pdf', 'jpg', 'pdf', 1.5, 1]];
const pick = a => a[Math.floor(Math.random() * a.length)];
// 가중치 뽑기: [[값, 가중치], ...]
const wpick = list => { let r = Math.random() * list.reduce((a, [, w]) => a + w, 0); for (const [v, w] of list) if ((r -= w) <= 0) return v; return list[0][0]; };
const REFS = [['chatgpt', 30], ['google', 25], ['direct', 15], ['naver', 8], ['perplexity', 6], ['bing', 4], ['claude', 3], ['gemini', 3], ['social', 3], ['other', 3]];
const LOCALES = [['en', 30], ['ko', 25], ['ja', 10], ['es', 9], ['pt', 7], ['de', 6], ['fr', 5], ['id', 4], ['hi', 2], ['zh', 2]];
// 크롤러(nginx를 통해 → 내부 복제로 집계되는 실제 경로를 탄다)
const BOTS = [
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)', 5],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', 6],
  ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', 3],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 3],
  ['Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 2],
  ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 5],
  ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 2],
];
const BOT_PATHS = [['/llms.txt', 3], ['/llms-full.txt', 1], ['/robots.txt', 1], ['/sitemap.xml', 1], ['/', 2], ['/ko/heic-to-jpg', 3], ['/compress-pdf', 2], ['/ja/merge-pdf', 2]];
const end = Date.now() + minutes * 60_000;
let sent = 0, failed = 0;
while (Date.now() < end) {
  // 바깥에서 들어온 첫 페이지 + 가끔 사이트 안 이동(유입엔 안 잡혀야 함)
  const locale = wpick(LOCALES), landing = Math.random() < 0.55;
  const events = [{ t: 'pv', path: landing ? 'landing' : '/', locale, ref: wpick(REFS) }];
  if (Math.random() < 0.3) events.push({ t: 'pv', path: 'landing', locale, ref: 'internal' });
  if (Math.random() < 0.35) fetch(base + wpick(BOT_PATHS), { headers: { 'user-agent': wpick(BOTS) } }).then(r => r.arrayBuffer()).catch(() => {});
  for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) {
    const [op, from, to, sec, ratio] = OPS[Math.floor(Math.random() ** 1.6 * OPS.length)];
    const ok = Math.random() > 0.04;
    const inBytes = Math.round(2e5 + Math.random() * 4e6);
    events.push(ok
      ? { t: 'conv', op, from, to, ok, ms: sec * 1000 * (0.4 + Math.random() * 1.6), inBytes, outBytes: Math.round(inBytes * ratio * (0.7 + Math.random() * 0.6)) }
      : { t: 'conv', op, from, to: 'other', ok, ms: 500, inBytes, err: pick(['decode', 'out-of-memory', 'password']) });
  }
  // 등급은 구글 기준으로 계산(전부 'good'으로 박으면 대시보드 p75와 등급 비율이 어긋난다)
  const LIM = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };
  const vital = (name, value) => ({ t: 'vital', name, value, rating: value <= LIM[name][0] ? 'good' : value <= LIM[name][1] ? 'needs-improvement' : 'poor' });
  if (Math.random() < 0.5) events.push(vital('LCP', 900 + Math.random() * 2500), vital('INP', 40 + Math.random() * 220), vital('CLS', Math.random() * 0.06), vital('FCP', 600 + Math.random() * 1200), vital('TTFB', 80 + Math.random() * 400));
  // 서버가 잠깐 재시작돼도 멈추지 않고 계속(실제로 컨테이너 재빌드 중에 죽었다)
  try { await fetch(`${base}/api/t`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': pick(UAS) }, body: JSON.stringify({ v: 1, events }) }); sent++; } catch { failed++; }
  await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
}
console.log(`보낸 묶음 ${sent}개, 실패 ${failed}개`);
