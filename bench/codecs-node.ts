// Node에서 jSquash 코덱 쓰기(WASM 파일을 직접 컴파일해서 init에 넘김)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import encJpeg, { init as initEncJpeg } from '@jsquash/jpeg/encode.js';
import decJpeg, { init as initDecJpeg } from '@jsquash/jpeg/decode.js';
import encWebp, { init as initEncWebp } from '@jsquash/webp/encode.js';
import decWebp, { init as initDecWebp } from '@jsquash/webp/decode.js';
import encAvif, { init as initEncAvif } from '@jsquash/avif/encode.js';
import decAvif, { init as initDecAvif } from '@jsquash/avif/decode.js';

const require = createRequire(import.meta.url);
const root = (p: string) => dirname(require.resolve(`@jsquash/${p}/package.json`));
const wasm = (p: string, f: string) => WebAssembly.compile(readFileSync(join(root(p), f)));

// jSquash가 기대하는 ImageData 모양(Node엔 ImageData가 없다)
(globalThis as any).ImageData ??= class { data: Uint8ClampedArray; width: number; height: number; constructor(d: Uint8ClampedArray, w: number, h: number) { this.data = d; this.width = w; this.height = h; } };

export async function initCodecs() {
  await initEncJpeg(await wasm('jpeg', 'codec/enc/mozjpeg_enc.wasm'));
  await initDecJpeg(await wasm('jpeg', 'codec/dec/mozjpeg_dec.wasm'));
  await initEncWebp(await wasm('webp', 'codec/enc/webp_enc.wasm'));
  await initDecWebp(await wasm('webp', 'codec/dec/webp_dec.wasm'));
  await initEncAvif(await wasm('avif', 'codec/enc/avif_enc.wasm'));
  await initDecAvif(await wasm('avif', 'codec/dec/avif_dec.wasm'));
}

export type Fmt = 'jpg' | 'webp' | 'avif';
export const encoders: Record<Fmt, (img: ImageData, q: number) => Promise<ArrayBuffer>> = {
  jpg: (img, q) => encJpeg(img, { quality: q }),
  webp: (img, q) => encWebp(img, { quality: q }),
  avif: (img, q) => encAvif(img, { quality: q, speed: 6 }),
};
// 색 보존 실험용: 품질 외 옵션(4:4:4 등)을 함께 넘긴다
export const encodeWith = (fmt: Fmt, img: ImageData, q: number, extra: Record<string, unknown>) =>
  fmt === 'jpg' ? encJpeg(img, { quality: q, ...extra }) : fmt === 'webp' ? encWebp(img, { quality: q, ...extra }) : encAvif(img, { quality: q, speed: 6, ...extra });
export const decoders: Record<Fmt, (buf: ArrayBuffer) => Promise<ImageData>> = {
  jpg: b => decJpeg(b),
  webp: b => decWebp(b),
  avif: async b => (await decAvif(b))!,
};
