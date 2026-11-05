import { describe, it, expect } from 'vitest';
import { LOCALES, getDict } from '../i18n/all.ts';
import { errorReason } from './error-reason.ts';

const ko = getDict('ko'), en = getDict('en');
const err = (code: string, detail?: string) => ({ name: 'ConvertError', code, detail });

describe('오류 밑 구체적 이유', () => {
  it('영상 작업의 detail 표식 → 사전 문구', () => {
    expect(errorReason(ko, err('unsupported', 'no-webcodecs'))).toBe(ko.reasons.noWebcodecs);
    expect(errorReason(ko, err('unsupported', 'no-video'))).toBe(ko.reasons.noVideo);
    expect(errorReason(ko, err('unsupported', 'no-audio'))).toBe(ko.reasons.noAudio);
    expect(errorReason(en, err('unsupported', 'encoder:avc1.640028:1920x1080'))).toBe(en.reasons.encoderMp4);
    expect(errorReason(en, err('unsupported', 'encoder:vp09.00.41.08:1280x720'))).toBe(en.reasons.encoderWebm);
    expect(errorReason(en, err('unsupported', 'decoder:hvc1.1.6.L93.B0'))).toContain('HEVC (H.265)');
    expect(errorReason(en, err('unsupported', 'decoder:av01.0.08M.08'))).toContain('AV1');
    expect(errorReason(en, err('unsupported', 'webm-codec:V_THEORA'))).toContain('THEORA');
    expect(errorReason(en, err('unsupported', 'audio:ac-3'))).toBe(en.reasons.audioCodec);
    expect(errorReason(ko, err('too-large', 'gif-seconds:42'))).toContain('42');
    expect(errorReason(ko, err('too-large', 'gif-pixels:300x1920x1080'))).toBe(ko.reasons.gifPixels);
  });
  it('목록에 없는 detail·다른 코드는 내지 않는다', () => {
    expect(errorReason(ko, err('unsupported', 'to: mp4|webm 중 하나'))).toBeNull(); // 옵션 검사 결과
    expect(errorReason(ko, err('decode', 'no-video'))).toBeNull();
    expect(errorReason(ko, err('unknown', 'TypeError: x is undefined'))).toBeNull();
    expect(errorReason(ko, err('too-large'))).toBeNull(); // 메모리 한도(숫자 안내는 따로)
    expect(errorReason(ko, err('too-large', 'gif-seconds:abc'))).toBeNull();
    expect(errorReason(ko, null)).toBeNull();
  });
  it('모든 언어에 문구가 있고 숫자·코덱 이름이 들어간다', () => {
    for (const l of LOCALES) {
      const t = getDict(l);
      for (const v of Object.values(t.reasons)) if (typeof v === 'string') expect(v.length, l).toBeGreaterThan(5);
      expect(t.reasons.gifSeconds(42), l).toContain('42');
      expect(t.reasons.videoCodec('AV1'), l).toContain('AV1');
      expect(t.ui.status(2, 5, 1), l).toMatch(/2[^]*5|5[^]*2/);
      expect(t.nav.skip.length, l).toBeGreaterThan(2);
    }
  });
});
