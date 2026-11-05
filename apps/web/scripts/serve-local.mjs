// 로컬 시험용 서버: 운영 nginx와 같은 규칙(보안 헤더, 구운 HTML 우선, 없으면 스트리밍 SSR, /api 중계).
// 실행: node scripts/serve-local.mjs  (PORT=4173)
import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const PORT = Number(process.env.PORT ?? 4173);
const SITE = `http://localhost:${PORT}`;
const { renderStream } = await import(pathToFileURL(join(root, 'dist-server', 'entry-server.js')).href);
const [head, tail] = readFileSync(join(root, 'dist-server', 'template.html'), 'utf8').split('<!--app-html-->');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };
// infra/nginx/default.conf와 같은 헤더
const SECURITY = {
  'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' blob: data:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
  if (url.pathname.startsWith('/api/')) {
    // 시험 중엔 API가 없을 수 있다 → 통계는 그냥 받아 준다(테스트는 따로 가로챈다)
    const up = http.request({ host: 'localhost', port: 8787, path: req.url, method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', () => { res.statusCode = 502; res.end(); });
    req.pipe(up);
    return;
  }
  // 1) 정적 파일 → 2) 구운 HTML(폴더/index.html) → 3) 스트리밍 SSR
  const clean = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
  const candidates = [join(dist, clean), join(dist, clean, 'index.html')];
  const file = candidates.find(f => f.startsWith(dist) && existsSync(f) && statSync(f).isFile());
  if (file) {
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('cache-control', file.includes(`${'assets'}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (file.endsWith('.html')) res.setHeader('x-render', 'ssg');
    createReadStream(file).pipe(res);
    return;
  }
  try {
    await renderStream(url.pathname, SITE, {
      before: r => head.replace('<!--app-lang-->', r.lang).replace('<!--app-head-->', r.head),
      after: r => tail.replace('<!--app-data-->', r.dataJson),
    }, (() => {
      // 원래 setHeader를 먼저 붙잡는다(덮어쓴 함수 안에서 res.setHeader를 부르면 자기 자신을 끝없이 불러 응답이 멈췄다)
      const set = res.setHeader.bind(res);
      res.setHeader = (k, v) => { set(k, v); if (k === 'content-type') set('x-render', 'ssr'); return res; };
      return res;
    })());
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.end('error'); }
  }
}).listen(PORT, () => console.log(`local :${PORT}`));
