import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { imageSize, memoryBudget } from './imgsize.ts';
import { pluginById } from './plugins.ts';

const fx = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../e2e/fixtures/${n}`, import.meta.url))));

describe('파일 머리로 크기 읽기(Pillow·실제 파일 기준)', () => {
  it('JPG(SOF 앞에 EXIF 있음), PNG, HEIC', () => {
    expect(imageSize(fx('photo.jpg'))).toEqual({ w: 768, h: 512 });
    expect(imageSize(fx('rotated-exif6.jpg'))).toEqual({ w: 300, h: 200 }); // 저장된 크기(회전 전)
    expect(imageSize(fx('transparent.png'))).toEqual({ w: 300, h: 200 });
    expect(imageSize(fx('iphone.heic'))).toEqual({ w: 768, h: 512 });
  });
  it('모르는 형식·짧은 데이터는 null', () => {
    expect(imageSize(fx('excel-korean.csv'))).toBeNull();
    expect(imageSize(new Uint8Array(4))).toBeNull();
  });
});

describe('메모리 예상·예산', () => {
  it('5000만 화소 사진은 1GB 이상으로 본다(실측 2.2GB)', () => {
    const head = new Uint8Array(64);
    head.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(head.buffer).setUint32(16, 8640); new DataView(head.buffer).setUint32(20, 5760);
    const s = imageSize(head)!;
    expect(pluginById('image')!.cost([{ format: 'png', bytes: 14e6, width: s.w, height: s.h }], {})).toBeGreaterThan(1e9);
  });
  it('기기별 예산', () => {
    expect(memoryBudget({ deviceMemory: 8, userAgent: 'Windows' })).toBe(2048 * 1024 * 1024);
    expect(memoryBudget({ deviceMemory: 2, userAgent: 'Android Mobile' })).toBe(384 * 1024 * 1024);
    expect(memoryBudget({ userAgent: 'iPhone' })).toBe(512 * 1024 * 1024);
  });
});

import { prescaleFor } from '../ops/codecs.ts';
describe('디코드하면서 줄이기', () => {
  const buf = (n: string) => { const b = fx(n); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  it('목표가 원본 절반보다 작을 때만, 목표의 2배로', () => {
    expect(prescaleFor(buf('photo.jpg'))).toBeUndefined(); // 크기 지정 없음
    expect(prescaleFor(buf('photo.jpg'), 640)).toBeUndefined(); // 768 → 640: 절반보다 큼
    expect(prescaleFor(buf('photo.jpg'), 100)).toEqual({ w: 200, h: 133 });
  });
  it('90° 회전 JPEG는 돌린 뒤 방향 기준', () => {
    // 저장은 300×200, 보이는 건 200×300 → 가로 40 목표면 80×120으로 펼침
    expect(prescaleFor(buf('rotated-exif6.jpg'), 40)).toEqual({ w: 80, h: 120 });
  });
});

import { hardLimit, HARD_FACTOR } from './imgsize.ts';
describe('작업 한도', () => {
  it('예산의 3배: PC 8GB → 6GB, 메모리 0.5GB 폰 → 하한 384MB×3', () => {
    expect(hardLimit({ deviceMemory: 8, userAgent: 'Windows' })).toBe(2048 * 1048576 * HARD_FACTOR);
    expect(hardLimit({ deviceMemory: 0.5, userAgent: 'Android Mobile' })).toBe(384 * 1048576 * HARD_FACTOR);
  });
});
