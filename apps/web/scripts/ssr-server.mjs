// 스트리밍 SSR 서버: 미리 굽지 않은 주소(롱테일 변환 조합·404)를 요청 때 렌더한다. nginx가 결과를 캐시한다.
// 실행: node scripts/ssr-server.mjs  (PORT=8790, PUBLIC_URL=https://도메인)
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const PORT = Number(process.env.PORT ?? 8790);
const { renderStream, preferredLocale } = await import(pathToFileURL(join(root, 'dist-server', 'entry-server.js')).href);
const template = readFileSync(join(root, 'dist-server', 'template.html'), 'utf8');
const [head, tail] = template.split('<!--app-html-->');
const stats = { requests: 0, rendered: 0, notFound: 0, errors: 0, totalMs: 0 };
const buildFile = join(root, 'dist-server', 'build.json');
const BUILD = existsSync(buildFile) ? JSON.parse(readFileSync(buildFile, 'utf8')).version.replace(/[^\w.-]/g, '') : 'dev';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/__ssr/metrics') {
    // VictoriaMetrics가 긁어 간다(내부망 전용 경로)
    res.setHeader('content-type', 'text/plain; version=0.0.4');
    res.end([
      '# TYPE fc_ssr_requests_total counter', `fc_ssr_requests_total{result="ok"} ${stats.rendered}`, `fc_ssr_requests_total{result="notfound"} ${stats.notFound}`, `fc_ssr_requests_total{result="error"} ${stats.errors}`,
      '# TYPE fc_ssr_render_seconds_sum counter', `fc_ssr_render_seconds_sum ${(stats.totalMs / 1000).toFixed(3)}`,
      '# TYPE fc_build_info gauge', `fc_build_info{component="web",version="${BUILD}"} 1`, '',
    ].join('\n'));
    return;
  }
  if (url.pathname === '/__lang') {
    // nginx가 '/'에 처음 온 사람(언어 쿠키 없음·봇 아님)을 보낸다. 영어면 정적 첫 화면을 그대로, 아니면 언어 주소로.
    const l = preferredLocale(req.headers['accept-language']);
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('vary', 'Accept-Language, Cookie');
    if (l === 'en') { res.setHeader('x-accel-redirect', '/__static/index.html'); res.end(); }
    else { res.statusCode = 302; res.setHeader('location', `/${l}`); res.end(); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
  stats.requests++;
  const t0 = performance.now();
  try {
    const r = await renderStream(url.pathname, SITE, {
      before: r => head.replace('<!--app-lang-->', r.lang).replace('<!--app-head-->', r.head),
      after: r => tail.replace('<!--app-data-->', r.dataJson),
    }, (() => {
      // 원래 setHeader를 먼저 붙잡는다(덮어쓴 함수 안에서 res.setHeader를 부르면 자기 자신을 끝없이 불러 응답이 멈췄다)
      const set = res.setHeader.bind(res);
      res.setHeader = (k, v) => {
        set(k, v);
        if (k === 'content-type') {
          // 200은 하루 캐시 + 만료 뒤에도 일주일은 옛 것을 주며 뒤에서 갱신, 404는 10분
          set('cache-control', res.statusCode === 200 ? 'public, max-age=86400, stale-while-revalidate=604800' : 'public, max-age=600');
          set('x-render', 'ssr');
        }
        return res;
      };
      return res;
    })());
    if (r.status === 404) stats.notFound++; else stats.rendered++;
  } catch (e) {
    stats.errors++;
    console.error('SSR 실패', url.pathname, e);
    if (!res.headersSent) { res.statusCode = 500; res.end('error'); }
  } finally {
    stats.totalMs += performance.now() - t0;
  }
});
server.listen(PORT, () => console.log(`SSR :${PORT}`));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)));
