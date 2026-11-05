import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripJpeg, stripPng, stripWebp, stripMetadata } from './strip.ts';
import { jpegOrientation } from './exif.ts';

const FX = join(__dirname, '../../../../e2e/fixtures/gps');
const load = (n: string) => { const b = readFileSync(join(FX, n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const has = (buf: ArrayBuffer, s: string) => Buffer.from(buf).includes(s);
const LEAKS = ['LEAKCAM', 'SECRETPLACE', 'GPSLatitude'];

describe('메타데이터 지우기', () => {
  it('시험 파일에는 표식이 실제로 들어 있다(시험이 헛돌지 않게)', () => {
    for (const f of ['gps.jpg', 'gps.png', 'gps.webp']) expect(has(load(f), 'SECRETPLACE'), f).toBe(true);
    expect(has(load('gps.webp'), 'GPSLatitude')).toBe(true);
  });
  it('JPEG: GPS·카메라 정보 제거, 영상 데이터는 바이트 그대로', () => {
    const src = load('gps.jpg');
    const out = stripJpeg(src);
    for (const m of LEAKS) expect(has(out, m), m).toBe(false);
    const sos = (b: ArrayBuffer) => { const u = new Uint8Array(b); for (let i = 2; i < u.length - 1; i++) if (u[i] === 0xff && u[i + 1] === 0xda) return Buffer.from(u.subarray(i)); return Buffer.alloc(0); };
    expect(sos(out).equals(sos(src))).toBe(true);
    expect(out.byteLength).toBeLessThan(src.byteLength);
  });
  it('JPEG: 방향을 남기라고 하면 방향 태그만 남는다', () => {
    const out = stripJpeg(load('gps-rot6.jpg'), { keepOrientation: true });
    expect(jpegOrientation(out)).toBe(6);
    for (const m of LEAKS) expect(has(out, m), m).toBe(false);
    expect(jpegOrientation(stripJpeg(load('gps-rot6.jpg')))).toBe(1);
  });
  it('PNG: eXIf 등 제거, IDAT는 그대로', () => {
    const src = load('gps.png');
    const out = stripPng(src);
    for (const m of LEAKS) expect(has(out, m), m).toBe(false);
    expect(has(out, 'IDAT') && has(out, 'IEND')).toBe(true);
  });
  it('WebP: EXIF·XMP 제거, RIFF 크기·플래그 정합', () => {
    const out = stripWebp(load('gps.webp'));
    for (const m of LEAKS) expect(has(out, m), m).toBe(false);
    const v = new DataView(out);
    expect(v.getUint32(4, true)).toBe(out.byteLength - 8);
    expect(new Uint8Array(out)[20]! & 0x0c).toBe(0);
  });
  it('지울 줄 모르는 형식은 null(원본 대신 다시 인코딩한 결과를 쓰게)', () => {
    expect(stripMetadata(new ArrayBuffer(10), 'avif')).toBeNull();
  });
  it('망가진 파일은 건드리지 않는다', () => {
    const junk = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02]).buffer;
    expect(stripJpeg(junk)).toBe(junk);
  });
});
