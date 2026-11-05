// WebM 읽기: webm-muxer로 만든 파일을 다시 읽어 트랙·프레임·시각이 그대로인지
import { describe, it, expect } from 'vitest';
import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import { parseMkv, isWebm } from './mkv.ts';

function make(streaming: boolean) {
  const m = new Muxer({
    target: new ArrayBufferTarget(), streaming,
    video: { codec: 'V_VP9', width: 320, height: 240 },
    audio: { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: 48000 },
  });
  const head = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]); // OpusHead
  for (let i = 0; i < 90; i++) {
    const t = Math.round((i * 1e6) / 30); // 3초 30fps
    m.addVideoChunkRaw(new Uint8Array([i, i, i, 7]), i % 30 === 0 ? 'key' : 'delta', t);
    if (i % 3 === 0) m.addAudioChunkRaw(new Uint8Array([0xaa, i]), 'key', Math.round((i / 3) * 100_000), i === 0 ? { decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description: head } } : undefined);
  }
  m.finalize();
  return new Uint8Array(m.target.buffer);
}

describe('parseMkv', () => {
  for (const streaming of [false, true]) {
    it(streaming ? '스트리밍(크기 모름) 형식' : '일반 형식', () => {
      const b = make(streaming);
      expect(isWebm(b)).toBe(true);
      const r = parseMkv(b);
      const v = r.tracks.find(t => t.type === 'video')!, a = r.tracks.find(t => t.type === 'audio')!;
      expect(v).toMatchObject({ codecId: 'V_VP9', width: 320, height: 240 });
      expect(a).toMatchObject({ codecId: 'A_OPUS', channels: 2, sampleRate: 48000 });
      expect(a.codecPrivate?.slice(0, 8)).toEqual(new TextEncoder().encode('OpusHead'));
      expect(v.samples).toHaveLength(90);
      expect(v.samples.filter(s => s.key).map(s => Math.round(s.ts / 1000))).toEqual([0, 1000, 2000]);
      expect([...v.samples[45]!.data]).toEqual([45, 45, 45, 7]);
      expect(Math.abs(v.samples[45]!.ts - 1_500_000)).toBeLessThanOrEqual(1000); // 기본 시간 단위 1ms
      expect(a.samples).toHaveLength(30);
      expect([...a.samples[10]!.data]).toEqual([0xaa, 30]);
      expect(r.duration).toBeGreaterThan(2_900_000);
    });
  }
  it('WebM이 아니면 거부', () => {
    expect(() => parseMkv(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toThrow();
  });
});
