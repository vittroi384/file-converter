// 빌드 3단계: 서버 묶음으로 280페이지(10개 언어 × 메인+랜딩 27)를 HTML로 굽고, 크롤러·AI용 파일을 만들고, 미리 압축한다.
// 실행: node scripts/prerender.mjs   (PUBLIC_URL=https://도메인 으로 정규 주소를 정한다)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const SITE = (process.env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const t0 = Date.now();

const server = await import(pathToFileURL(join(root, 'dist-server', 'entry-server.js')).href);
const { renderStatic, LOCALES, localePath, PRERENDER_SLUGS, allDynamicSlugs, getDict, getLandingT, LANDINGS } = server;

// 템플릿은 SSR 서버도 쓰므로 따로 보관(dist/index.html은 영어 메인으로 덮어쓴다)
const template = readFileSync(join(dist, 'index.html'), 'utf8');
mkdirSync(join(root, 'dist-server'), { recursive: true });
writeFileSync(join(root, 'dist-server', 'template.html'), template);
// 배포 표시용 빌드 번호(SSR 서버가 fc_build_info{component="web"}로 내보낸다). 배포 스크립트가 BUILD_ID를 넘긴다
const BUILD_ID = (process.env.BUILD_ID ?? `local-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`).slice(0, 40);
writeFileSync(join(root, 'dist-server', 'build.json'), JSON.stringify({ version: BUILD_ID, at: new Date().toISOString() }));
const demoPath = join(root, 'src', 'app', 'demo.json');
const demo = existsSync(demoPath) ? JSON.parse(readFileSync(demoPath, 'utf8')) : undefined;

const fill = (r, html) => template
  .replace('<!--app-lang-->', r.lang)
  .replace('<!--app-head-->', r.head)
  .replace('<!--app-html-->', html)
  .replace('<!--app-data-->', r.dataJson);
const write = (path, content) => {
  const file = join(dist, path.replace(/^\//, ''), path.endsWith('.html') || path.includes('.') ? '' : 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

// 1) 페이지 굽기
let pages = 0;
for (const l of LOCALES) {
  for (const slug of ['', ...PRERENDER_SLUGS]) {
    const url = localePath(l, slug);
    const r = await renderStatic(url, SITE, demo);
    if (r.status !== 200) throw new Error(`${url} → ${r.status}`);
    write(url === '/' ? '/index.html' : url, fill(r, r.html));
    pages++;
  }
}
// 관리자(검색 제외, 화면은 브라우저가 그림)와 404
{
  const r = await renderStatic('/admin', SITE);
  write('/admin', fill(r, ''));
  const nf = await renderStatic('/__404', SITE);
  write('/404.html', fill(nf, nf.html));
}

// 2) 사이트맵: 모든 언어판을 서로 연결(hreflang). SSR이 만드는 롱테일 조합도 싣는다.
const allSlugs = ['', ...PRERENDER_SLUGS, ...allDynamicSlugs()];
const today = new Date().toISOString().slice(0, 10);
const sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
for (const slug of allSlugs) for (const l of LOCALES) {
  sitemap.push(`<url><loc>${SITE}${localePath(l, slug)}</loc><lastmod>${today}</lastmod>`);
  for (const a of LOCALES) sitemap.push(`<xhtml:link rel="alternate" hreflang="${a === 'zh' ? 'zh-Hans' : a}" href="${SITE}${localePath(a, slug)}"/>`);
  sitemap.push(`<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${localePath('en', slug)}"/></url>`);
}
sitemap.push('</urlset>');
writeFileSync(join(dist, 'sitemap.xml'), sitemap.join('\n'));

// 3) robots.txt: AI 크롤러도 환영(검색·AI 답변에 인용되도록). 관리자·API만 막는다.
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended'];
writeFileSync(join(dist, 'robots.txt'), [
  '# LocalConvert — converts files in the browser; nothing to hide from crawlers except admin/API.',
  ...AI_BOTS.flatMap(b => [`User-agent: ${b}`, 'Allow: /', 'Disallow: /admin', 'Disallow: /api/', '']),
  'User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api/', '',
  `Sitemap: ${SITE}/sitemap.xml`, '',
].join('\n'));

// 4) llms.txt(llmstxt.org): AI가 사이트를 요약할 때 읽는 평문. 화면과 같은 문구에서 만든다.
const en = getDict('en'), T = getLandingT('en');
const group = k => LANDINGS.filter(d => (k === 'data' ? d.def.kind === 'data' : k === 'pdf' ? ['merge-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-image', 'images-to-pdf'].includes(d.def.kind) : !['data', 'merge-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-image', 'images-to-pdf'].includes(d.def.kind)));
const line = d => { const c = T.build(d.def); return `- [${c.title.split(' — ')[0]}](${SITE}/${d.slug}): ${c.metaDescription}`; };
const llms = [
  `# ${en.site.name}`, '', `> ${en.site.description}`, '',
  'Key facts:',
  '- Files are converted entirely inside the browser tab (WebAssembly + Web Workers). Nothing is uploaded; a Content-Security-Policy blocks connections to other servers.',
  '- Free, no account, no ads. Works on desktop and mobile browsers (Chrome, Edge, Safari, Firefox, Samsung Internet).',
  '- Smart compression measures visual similarity (SSIM) to find the smallest file that still looks the same; usually 3–4 tries.',
  '- Batches run in parallel on several CPU cores and download as one ZIP.',
  `- Available in ${LOCALES.length} languages: ${LOCALES.map(l => `${SITE}${localePath(l)}`).join(', ')}`, '',
  '## Image tools', ...group('image').map(line), '', '## PDF tools', ...group('pdf').map(line), '', '## Data tools', ...group('data').map(line), '',
  '## More', `- [Full text of every tool page](${SITE}/llms-full.txt)`, `- [Sitemap](${SITE}/sitemap.xml)`, '',
].join('\n');
writeFileSync(join(dist, 'llms.txt'), llms);
const full = [`# ${en.site.name} — full text`, '', en.site.description, '', ...en.privacy.body, ''];
for (const d of LANDINGS) {
  const c = T.build(d.def);
  full.push(`## ${c.title}`, `URL: ${SITE}/${d.slug}`, '', c.intro, '', ...c.steps.map((s, i) => `${i + 1}. ${s}`), '', ...c.faq.flatMap(f => [`Q: ${f.q}`, `A: ${f.a}`, '']));
}
writeFileSync(join(dist, 'llms-full.txt'), full.join('\n'));

// 5) 라이선스 고지(MIT·ISC·OFL은 고지를 함께 배포해야 한다)
const lic = ['Open-source software used by LocalConvert', ''];
const nm = join(root, '..', '..', 'node_modules');
for (const pkg of ['react', 'react-dom', 'pdf-lib', 'pdfjs-dist', 'ag-psd', 'libheif-js', 'fflate', 'yaml', 'papaparse', 'xlsx', '@jsquash/jpeg', '@jsquash/png', '@jsquash/webp', '@jsquash/avif', '@jsquash/oxipng', '@jsquash/resize', '@resvg/resvg-wasm', 'web-vitals', '@phosphor-icons/react', '@fontsource-variable/fraunces', 'pretendard', 'tesseract.js', 'tesseract.js-core', '@tesseract.js-data/kor', '@tesseract.js-data/eng', 'mp4box', 'mp4-muxer', 'webm-muxer', 'gifenc']) {
  try {
    const p = JSON.parse(readFileSync(join(nm, pkg, 'package.json'), 'utf8'));
    lic.push(`${pkg}@${p.version} — ${typeof p.license === 'string' ? p.license : p.license?.type ?? 'see package'}`);
  } catch { lic.push(`${pkg} — (not found)`); }
}
lic.push('', 'OCR language data: tessdata_best (int) from tesseract-ocr, Apache-2.0.');
lic.push('', 'Demo photo: Michael Starkie, Unsplash (https://unsplash.com/photos/l50OANxqQXE), Unsplash License.');
writeFileSync(join(dist, 'licenses.txt'), lic.join('\n'));

// 6) 미리 압축(nginx gzip_static·brotli_static이 그대로 보낸다)
let zipped = 0;
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of walk(dist)) {
  if (!/\.(html|js|mjs|css|json|txt|xml|svg|wasm|webmanifest)$/.test(f) || statSync(f).size < 1024) continue;
  const buf = readFileSync(f);
  writeFileSync(f + '.br', brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  writeFileSync(f + '.gz', gzipSync(buf, { level: 9 }));
  zipped++;
}
console.log(`페이지 ${pages}개, 사이트맵 ${allSlugs.length * LOCALES.length}개 주소, 압축 ${zipped}개 파일, ${((Date.now() - t0) / 1000).toFixed(1)}초`);
