// 모자이크 탐색 검증: 큰 사진에서 '전체 탐색' 대 '모자이크로 품질 찾고 전체 1회 인코딩'.
// 판정: 모자이크 결과의 '원본 전체' SSIM이 목표 이상인지, 용량 차이, 시간.
// 실행: node bench/mosaic-eval.ts [목표=0.97] [포맷=jpg,webp,avif]
import { readFileSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs';
import { initCodecs, encoders, decoders, type Fmt } from './codecs-node.ts';
import { toGray, ssimFast } from '../apps/web/src/core/ssim.ts';
import { searchInterp } from '../apps/web/src/core/search.ts';
import { priorFor } from '../apps/web/src/core/priors.ts';
import { searchLarge } from '../apps/web/src/core/search-large.ts';

const target = Number(process.argv[2] ?? 0.97);
const fmts = (process.argv[3] ?? 'jpg,webp,avif').split(',') as Fmt[];
await initCodecs();
const L = 'bench/data/large/';
const files = [...readdirSync(L).filter(f => /^batch-00[0-3]\.jpg$/.test(f)).map(f => L + f), L + 'photo-50mp.jpg', 'bench/data/assets/unsplash-l50OANxqQXE.jpg'];
mkdirSync('bench/out', { recursive: true });

async function search(img: ImageData, fmt: Fmt) {
  const g0 = toGray(img.data, img.width, img.height);
  const t0 = performance.now();
  const r = await searchInterp(async q => {
    const buf = await encoders[fmt](img, q);
    const d = await decoders[fmt](buf);
    return { q, bytes: buf.byteLength, ssim: ssimFast(g0, toGray(d.data, d.width, d.height)) };
  }, { target, space: 'log', ...priorFor(fmt, target) });
  return { q: r.best!.q, bytes: r.best!.bytes, tries: r.probes.length, ms: performance.now() - t0 };
}

for (const f of files) {
  const img = await decoders.jpg(readFileSync(f).buffer as ArrayBuffer);
  const name = f.split('/').pop()!;
  for (const fmt of fmts) {
    const full = await search(img, fmt);
    const t0 = performance.now();
    const L2 = (await searchLarge(img, target, priorFor(fmt, target), { encode: (im, q) => encoders[fmt](im as ImageData, q), decode: b => decoders[fmt](b) }))!;
    const mosaicMs = performance.now() - t0;
    const m = { q: L2.q, tries: L2.mosaicTries };
    const finalBuf = L2.buf;
    const fullSsim = L2.ssim;
    const row = {
      file: name, mp: +(img.width * img.height / 1e6).toFixed(1), fmt, target,
      qFull: full.q, qMosaic: m.q, fullSsimAtMosaicQ: +fullSsim.toFixed(4), meetsTarget: fullSsim >= target,
      bytesRegretPct: +((finalBuf.byteLength / full.bytes - 1) * 100).toFixed(1),
      secFull: +(full.ms / 1000).toFixed(1), secMosaic: +(mosaicMs / 1000).toFixed(1), triesFull: full.tries, triesMosaic: m.tries, fullEncodes: L2.fullEncodes,
    };
    console.log(JSON.stringify(row));
    appendFileSync('bench/out/mosaic.jsonl', JSON.stringify(row) + '\n');
  }
}
