import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
export function loadPng(path: string) {
  const png = PNG.sync.read(readFileSync(path));
  return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) };
}
