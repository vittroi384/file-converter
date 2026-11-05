// 사진 한 장으로 스마트 압축 탐색 과정 출력. 실행: node bench/trace-one.ts <파일.jpg|png> [목표] [jpg|webp|avif]
import { readFileSync } from 'node:fs';
import { initCodecs, encoders, decoders, type Fmt } from './codecs-node.ts';
import { loadPng } from '../apps/web/test/load-png.ts';
import { toGray, ssimFast } from '../apps/web/src/core/ssim.ts';
import { searchInterp } from '../apps/web/src/core/search.ts';
import { priorFor } from '../apps/web/src/core/priors.ts';

const [file, t = '0.97', fmt = 'jpg'] = process.argv.slice(2) as [string, string, Fmt];
await initCodecs();
const img = file.endsWith('.png') ? (() => { const p = loadPng(file); return new ImageData(p.data, p.w, p.h); })()
  : await decoders.jpg(readFileSync(file).buffer as ArrayBuffer);
const g0 = toGray(img.data, img.width, img.height);
const target = Number(t);
const prior = priorFor(fmt, target);
console.log('예측', prior);
const r = await searchInterp(async q => {
  const buf = await encoders[fmt](img, q);
  const d = await decoders[fmt](buf);
  const ssim = ssimFast(g0, toGray(d.data, d.width, d.height));
  console.log(`  q=${q} ssim=${ssim.toFixed(4)} ${ssim >= target ? '통과' : '미달'} ${buf.byteLength}B`);
  return { q, bytes: buf.byteLength, ssim };
}, { target, space: 'log', ...prior });
console.log('결과', r.best?.q, r.probes.length + '번');
