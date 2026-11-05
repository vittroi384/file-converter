// 번들 크기 예산. 넘으면 실패(종료 코드 1). 실행: node tools/check-budget.mjs [dist 폴더]
// 예산 근거: devlog 4·9절 실측값 + 약 10% 여유. 늘려야 하면 이유를 devlog에 적고 늘린다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'apps/web/dist';
const assets = readdirSync(join(dist, 'assets'));
const gz = f => gzipSync(readFileSync(join(dist, 'assets', f)), { level: 9 }).length;
const one = re => { const m = assets.filter(f => re.test(f)); if (m.length !== 1) throw new Error(`${re} 파일이 ${m.length}개`); return m[0]; };
const KB = 1024;

// 서비스 워커는 공유하기 받기만 한다(오프라인 캐시 없음) → 작아야 한다
const swBytes = statSync(join(dist, 'sw.js')).size;

const checks = [
  ['첫 화면 JS (gzip)', gz(one(/^index-.*\.js$/)), 90 * KB],
  ['첫 화면 CSS (gzip)', gz(one(/^index-.*\.css$/)), 24 * KB],
  ['관리자 JS (gzip)', gz(one(/^Admin-.*\.js$/)), 15 * KB],
  ['서비스 워커', swBytes, 4 * KB],
];
let fail = 0;
for (const [name, size, limit] of checks) {
  const ok = size <= limit;
  if (!ok) fail++;
  console.log(`${ok ? '통과' : '초과'}  ${name.padEnd(18)} ${(size / KB).toFixed(1).padStart(7)} KB / 예산 ${(limit / KB).toFixed(0)} KB`);
}
process.exit(fail ? 1 : 0);
