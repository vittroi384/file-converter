import { describe, it, expect } from 'vitest';
import { strategies, type Probe } from './search.ts';

// 단조 증가 가짜 곡선: ssim = 1 - 0.3·exp(-q/20), bytes = q²
const curve = (q: number): Probe => ({ q, bytes: q * q + 100, ssim: 1 - 0.3 * Math.exp(-q / 20) });
const optimalQ = (T: number) => { for (let q = 1; q <= 100; q++) if (curve(q).ssim >= T) return q; return null; };

describe.each(Object.entries(strategies))('%s', (_name, search) => {
  for (const T of [0.75, 0.9, 0.97, 0.99]) {
    it(`목표 ${T}에서 최적 품질을 찾는다`, async () => {
      const r = await search(async q => curve(q), { target: T });
      expect(r.best?.q).toBe(optimalQ(T));
      expect(r.probes.length).toBeLessThanOrEqual(9);
    });
  }
  it('도달 불가능한 목표는 null', async () => {
    const r = await search(async q => curve(q), { target: 0.9999 });
    expect(r.best).toBeNull();
  });
  it('최저 품질도 통과하면 최저 품질', async () => {
    const r = await search(async q => curve(q), { target: 0.5 });
    expect(r.best?.q).toBe(1);
  });
  it('같은 품질을 두 번 인코딩하지 않는다', async () => {
    const r = await search(async q => curve(q), { target: 0.97 });
    expect(new Set(r.probes.map(p => p.q)).size).toBe(r.probes.length);
  });
});

import { searchInterp } from './search.ts';
import { priorFor } from './priors.ts';
describe('v4 뉴턴 점프', () => {
  it('기울기를 주면 같은 답을 더 적은 시도로', async () => {
    const T = 0.97;
    const plain = await searchInterp(async q => curve(q), { target: T, guess: 30, step: 2 });
    // 가짜 곡선의 실제 기울기: f = q/20 - ln 0.3 → dq/df = 20
    const newton = await searchInterp(async q => curve(q), { target: T, guess: 30, step: 2, slope: 20 });
    expect(newton.best?.q).toBe(plain.best?.q);
    expect(newton.probes.length).toBeLessThan(plain.probes.length);
  });
  it('예측표: 목표가 오르면 시작 품질도 오르고, 기울기는 양수', () => {
    for (const fmt of ['jpg', 'webp', 'avif']) {
      const a = priorFor(fmt, 0.95), b = priorFor(fmt, 0.98);
      expect(b.guess!).toBeGreaterThanOrEqual(a.guess!);
      expect(a.slope ?? 1).toBeGreaterThan(0);
    }
    expect(priorFor('png', 0.97)).toEqual({});
  });
});

import { searchInterpParallel } from './search.ts';
describe('v6 병렬 후보(한 차례 2개)', () => {
  // 동시에 몇 개가 돌고 있는지 재는 evaluate
  const tracked = () => {
    let now = 0, max = 0;
    const ev = async (q: number) => { now++; max = Math.max(max, now); await new Promise(r => setTimeout(r, 0)); now--; return curve(q); };
    return { ev, max: () => max };
  };
  for (const T of [0.75, 0.9, 0.97, 0.99]) {
    for (const prior of [{}, { guess: 60, step: 4, slope: 20 }, { guess: 20, step: 2, slope: 20 }]) {
      it(`목표 ${T}, 예측 ${JSON.stringify(prior)}: 최적 품질을 찾고, 동시에 2개까지만, 같은 품질은 한 번만`, async () => {
        const t = tracked();
        const r = await searchInterpParallel(t.ev, { target: T, ...prior });
        expect(r.best?.q).toBe(optimalQ(T));
        expect(t.max()).toBeLessThanOrEqual(2);
        expect(new Set(r.probes.map(p => p.q)).size).toBe(r.probes.length);
        expect(r.rounds).toBeLessThanOrEqual(7);
      });
    }
  }
  it('도달 불가능한 목표는 null, 최저 품질도 통과하면 1', async () => {
    expect((await searchInterpParallel(async q => curve(q), { target: 0.9999, guess: 90, step: 3, slope: 20 })).best).toBeNull();
    expect((await searchInterpParallel(async q => curve(q), { target: 0.5, guess: 30, step: 3, slope: 20 })).best?.q).toBe(1);
  });
  it('예측이 맞으면 v5보다 적은 차례로 같은 답', async () => {
    for (const T of [0.9, 0.97, 0.99]) {
      const o = { target: T, guess: optimalQ(T)! + 3, step: 3, slope: 20 };
      const v5 = await searchInterp(async q => curve(q), o);
      const v6 = await searchInterpParallel(async q => curve(q), o);
      expect(v6.best?.q).toBe(v5.best?.q);
      expect(v6.rounds).toBeLessThan(v5.probes.length);
    }
  });
  it('기어 내려오는 곡선(정체)에서도 끝난다', async () => {
    // 목표 바로 위에서 크게 꺾이는 곡선: 보간이 계속 한쪽으로 빗나간다
    const bent = (q: number): Probe => ({ q, bytes: q, ssim: q >= 40 ? 0.99 + q * 1e-5 : 0.5 + q * 1e-3 });
    const o = { target: 0.98, guess: 90, step: 2, slope: 5 };
    const r = await searchInterpParallel(async q => bent(q), o);
    expect(r.best?.q).toBe(40);
    // 처음 버전은 한 칸씩 기어 25회. 지금은 차례 수가 v5 시도 수(11)보다 적어야 한다
    expect(r.rounds).toBeLessThan((await searchInterp(async q => bent(q), o)).probes.length);
  });
});
