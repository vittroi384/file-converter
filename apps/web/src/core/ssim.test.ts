import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { toGray, ssimReference } from './ssim.ts';
import { loadPng } from '../../test/load-png.ts';

const dir = fileURLToPath(new URL('../../test/fixtures/ssim/', import.meta.url));
const expected: Record<string, number> = JSON.parse(readFileSync(dir + 'expected.json', 'utf8'));
const gray = (name: string) => { const p = loadPng(dir + name + '.png'); return toGray(p.data, p.w, p.h); };
const ref = gray('ref');

describe('ssimReference vs scikit-image', () => {
  it('같은 이미지는 1', () => { expect(ssimReference(ref, ref)).toBeCloseTo(1, 6); });
  for (const [k, v] of Object.entries(expected)) {
    it(`${k}: skimage ${v}`, () => {
      const s = ssimReference(ref, gray(k));
      console.log(k, 'mine', s.toFixed(6), 'skimage', v, 'diff', (s - v).toFixed(6));
      expect(Math.abs(s - v)).toBeLessThan(0.00001);
    });
  }
});

import { ssimFast } from './ssim.ts';
describe('ssimFast = ssimReference', () => {
  for (const k of Object.keys(expected)) {
    it(k, () => { const g = gray(k); expect(Math.abs(ssimFast(ref, g) - ssimReference(ref, g))).toBeLessThan(1e-6); });
  }
  it('작은 이미지는 기준판으로 넘김', () => {
    const t = { w: 10, h: 10, data: new Float32Array(100).fill(50) };
    expect(ssimFast(t, t)).toBeCloseTo(1, 6);
  });
});

import { ssimRgba } from './ssim.ts';
describe('ssimRgba = ssimFast(toGray)', () => {
  for (const k of Object.keys(expected)) {
    it(k, () => {
      const a = loadPng(dir + 'ref.png'), b = loadPng(dir + k + '.png');
      const want = ssimFast(toGray(a.data, a.w, a.h), toGray(b.data, b.w, b.h));
      expect(Math.abs(ssimRgba({ width: a.w, height: a.h, data: a.data }, { width: b.w, height: b.h, data: b.data }) - want)).toBeLessThan(1e-6);
    });
  }
});
