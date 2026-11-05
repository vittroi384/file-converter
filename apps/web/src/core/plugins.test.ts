import { describe, it, expect } from 'vitest';
import { OPS } from '@fc/shared';
import { PLUGINS, pluginById, videoTimeoutMs } from './plugins.ts';

describe('변환기 플러그인 계약', () => {
  it('공개 작업(OPS)마다 플러그인이 하나씩 있다', () => {
    for (const op of OPS) expect(pluginById(op), op).toBeTruthy();
    expect(new Set(PLUGINS.map(p => p.id)).size).toBe(PLUGINS.length);
  });
  it('옵션 검사: 잘못된 값 거부, 기본값 채움, 모르는 키 버림', () => {
    const img = pluginById('image')!;
    expect(img.validate({ to: 'exe' }).ok).toBe(false);
    expect(img.validate({ quality: 500 }).ok).toBe(false);
    const ok = img.validate({ to: 'webp', quality: '70', evil: '<script>' });
    expect(ok).toEqual({ ok: true, value: { to: 'webp', quality: 70, engine: 'wasm', lang: 'en' } });
    expect(pluginById('pdf-split')!.validate({ ranges: '1-3; rm -rf' }).ok).toBe(false);
    expect(pluginById('compress')!.validate({ target: 0.5 }).ok).toBe(false);
  });
  it('출력 형식은 옵션을 따른다', () => {
    expect(pluginById('image')!.outputs({ to: 'avif' })).toEqual(['avif']);
    expect(pluginById('pdf-merge')!.outputs({})).toEqual(['pdf']);
  });
  it('비용은 화소 수에 비례하고, 크기를 모르면 파일 크기로', () => {
    const p = pluginById('image')!;
    const small = p.cost([{ format: 'jpg', bytes: 1e6, width: 1000, height: 1000 }], {});
    const big = p.cost([{ format: 'jpg', bytes: 1e6, width: 4000, height: 3000 }], {});
    // 고정분(32MB)을 빼면 화소 수(12배)에 정확히 비례(처음엔 고정분을 잊고 '8배 이상'으로 적어 틀렸다)
    const fixed = 32 * 1024 * 1024;
    expect((big - fixed) / (small - fixed)).toBeCloseTo(12, 6);
    expect(p.cost([{ format: 'psd', bytes: 5e7 }], {})).toBeGreaterThan(5e8);
  });
  it('받는 형식이 겹치지 않게 이미지 계열을 나눴다(형식별로 정확히 하나의 이미지 작업)', () => {
    for (const f of ['jpg', 'heic', 'psd', 'svg'] as const) expect(PLUGINS.filter(p => ['image', 'heic', 'psd', 'svg'].includes(p.id) && p.inputs.includes(f))).toHaveLength(1);
  });
});

describe('너무 큰 파일 판단', () => {
  it('크기 줄이기를 고르면 예상 메모리가 줄어든다(디코드 때 미리 축소)', () => {
    const p = pluginById('compress')!;
    const big = [{ format: 'jpg' as const, bytes: 1e5, width: 7000, height: 7000 }];
    const full = p.cost(big, {});
    const sns = p.cost(big, { maxWidth: 1080 });
    expect(sns).toBeLessThan(full / 5);
    expect(p.cost(big, { maxWidth: 20000 })).toBe(full); // 원본보다 큰 목표면 그대로
  });
});

describe('작업별 시간 초과', () => {
  const MB = 1024 * 1024;
  it('영상은 파일 크기에 맞춰 늘고 30분에서 멈춘다, 나머지는 풀 기본값', () => {
    const v = pluginById('video')!;
    expect(v.timeoutMs).toBe(videoTimeoutMs);
    expect(v.timeoutMs!([{ format: 'mp4', bytes: 1 * MB }], {})).toBeGreaterThanOrEqual(5 * 60_000);
    const mid = v.timeoutMs!([{ format: 'mp4', bytes: 100 * MB }], {});
    expect(mid).toBe(5 * 60_000 + 600_000);
    expect(v.timeoutMs!([{ format: 'mov', bytes: 4000 * MB }], {})).toBe(30 * 60_000);
    for (const p of PLUGINS) if (p.id !== 'video') expect(p.timeoutMs, p.id).toBeUndefined();
  });
});
