// IndexNow: 바뀐 주소를 빙·얀덱스 등에 바로 알린다(구글은 IndexNow를 쓰지 않음).
// 키는 공개 값이다(규격상 사이트에 그대로 걸어 둔다): apps/web/public/indexnow-key.txt → https://도메인/indexnow-key.txt
// 실행(배포 뒤): node tools/indexnow.mjs https://도메인   — 배포된 사이트맵의 주소를 최대 10,000개까지 보낸다.
// --dry: 보내지 않고 점검만(키 파일이 배포본과 같은지, 몇 개를 보낼지). 로컬 스택(http://localhost)은 --dry로만.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = (process.argv[2] ?? '').replace(/\/$/, '');
const dry = process.argv.includes('--dry');

async function main() {
  const okSite = /^https:\/\//.test(site) || (dry && /^http:\/\/localhost(:\d+)?$/.test(site));
  if (!okSite) { console.error('사용법: node tools/indexnow.mjs https://도메인 [--dry]'); return 1; }
  const key = readFileSync(join(root, 'apps/web/public/indexnow-key.txt'), 'utf8').trim();

  // 배포된 사이트맵을 읽는다(빌드 때 PUBLIC_URL로 주소가 박히므로 로컬 dist와 다를 수 있다)
  const xml = await (await fetch(`${site}/sitemap.xml`)).text();
  const urls = [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]))].filter(u => u.startsWith(site)).slice(0, 10000);
  // 키 파일이 실제로 걸려 있어야 받아 준다 → 먼저 확인
  const live = (await (await fetch(`${site}/indexnow-key.txt`)).text()).trim();
  if (live !== key) { console.error(`키 파일이 배포본과 다르다: ${site}/indexnow-key.txt`); return 1; }

  console.log(`주소 ${urls.length}개${dry ? ' (보내지 않음 --dry)' : ''}`);
  if (dry) { console.log(urls.slice(0, 5).join('\n'), '\n…'); return 0; }
  const body = { host: new URL(site).host, key, keyLocation: `${site}/indexnow-key.txt`, urlList: urls };
  const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  console.log(`응답 ${r.status} ${r.statusText}`); // 200·202 = 받음, 403 = 키 불일치, 422 = 주소가 host와 다름
  return r.ok ? 0 : 1;
}

// fetch 직후 process.exit()는 윈도우 Node에서 'Assertion failed: UV_HANDLE_CLOSING'으로 죽었다 → exitCode만 정하고 자연 종료
process.exitCode = await main();
