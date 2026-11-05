// 첫 화면 전후 비교 데모: Unsplash 사진(Michael Starkie, Unsplash License)에서 사람이 없는 부분만 잘라
// 우리 스마트 압축 엔진으로 실제로 압축한 결과와 숫자를 만든다(숫자를 꾸며 쓰지 않는다).
// 실행: node tools/make-demo.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initCodecs, encoders, decoders } from '../bench/codecs-node.ts';
import { ssimRgba } from '../apps/web/src/core/ssim.ts';
import { searchInterp } from '../apps/web/src/core/search.ts';
import { priorFor } from '../apps/web/src/core/priors.ts';
import resize, { initResize } from '@jsquash/resize';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

await initCodecs();
// Node에선 resize WASM을 fetch로 못 불러온다 → 파일을 직접 컴파일해 넘긴다
const req = createRequire(import.meta.url);
await initResize(await WebAssembly.compile(readFileSync(join(dirname(req.resolve('@jsquash/resize/package.json')), 'lib/resize/pkg/squoosh_resize_bg.wasm'))));
const src = await decoders.jpg(readFileSync('bench/data/assets/unsplash-l50OANxqQXE.jpg').buffer as ArrayBuffer);
// 원본 3992×3508. 향신료 원뿔·허브 바구니 부분(사람은 오른쪽 아래 → x 2780 이후·y 1900 이후 제외)
const cx = 700, cy = 1000, cw = 2080, ch = 1560; // 4:3
const crop = new Uint8ClampedArray(cw * ch * 4);
for (let y = 0; y < ch; y++) crop.set(src.data.subarray(((cy + y) * src.width + cx) * 4, ((cy + y) * src.width + cx + cw) * 4), y * cw * 4);
const W = 960, H = 720; // 1200px는 두 장 합쳐 약 1MB라 모바일 첫 화면에 무거웠다
const img = await resize(new ImageData(crop, cw, ch), { width: W, height: H, method: 'lanczos3', fitMethod: 'stretch', premultiply: false, linearRGB: true });

// '원본'은 폰이 저장하는 정도의 고화질 JPEG(품질 92)
const before = await encoders.jpg(img, 92);
const target = 0.97;
let best: { q: number; buf: ArrayBuffer; ssim: number } | null = null;
const r = await searchInterp(async q => {
  const buf = await encoders.webp(img, q);
  const ssim = ssimRgba(img, await decoders.webp(buf));
  if (ssim >= target && (!best || buf.byteLength < best.buf.byteLength)) best = { q, buf, ssim };
  return { q, bytes: buf.byteLength, ssim };
}, { target, space: 'log', ...priorFor('webp', target) });
const b = best as unknown as { q: number; buf: ArrayBuffer; ssim: number };

mkdirSync('apps/web/public/demo', { recursive: true });
writeFileSync('apps/web/public/demo/market-before.jpg', new Uint8Array(before));
writeFileSync('apps/web/public/demo/market-after.webp', new Uint8Array(b.buf));
const demo = {
  before: { src: '/demo/market-before.jpg', bytes: before.byteLength, fmt: 'jpg', width: W, height: H },
  after: { src: '/demo/market-after.webp', bytes: b.buf.byteLength, fmt: 'webp', ssim: +b.ssim.toFixed(4), q: b.q, tries: r.probes.length },
  // 첫 화면 '탐색 장면'용 실제 기록: 탐색이 시도한 순서 + 품질별 곡선(그림 배경)
  target,
  probes: r.probes.map(p => ({ q: p.q, ssim: +p.ssim.toFixed(4), bytes: p.bytes })),
  curve: await Promise.all(Array.from({ length: 15 }, (_, i) => 30 + i * 5).map(async q => {
    const buf = await encoders.webp(img, q);
    return { q, ssim: +ssimRgba(img, await decoders.webp(buf)).toFixed(4), bytes: buf.byteLength };
  })),
};
writeFileSync('apps/web/src/app/demo.json', JSON.stringify(demo, null, 2));
console.log(demo);
