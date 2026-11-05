import { describe, it, expect } from 'vitest';
import { parsePath, localePath, preferredLocale, LOCALES } from './locales.ts';

describe('주소 ↔ 언어', () => {
  it('기본 언어(en)는 주소 앞에 붙지 않는다', () => {
    expect(parsePath('/')).toEqual({ locale: 'en', slug: '' });
    expect(parsePath('/heic-to-jpg')).toEqual({ locale: 'en', slug: 'heic-to-jpg' });
    expect(parsePath('/ko')).toEqual({ locale: 'ko', slug: '' });
    expect(parsePath('/ko/merge-pdf/')).toEqual({ locale: 'ko', slug: 'merge-pdf' });
    expect(parsePath('/en/merge-pdf')).toEqual({ locale: 'en', slug: 'en' }); // /en 접두는 쓰지 않는다
  });
  it('왕복', () => {
    for (const l of LOCALES) for (const s of ['', 'compress-image']) expect(parsePath(localePath(l, s))).toEqual({ locale: l, slug: s });
  });
});

describe('브라우저 언어 고르기', () => {
  it('지역 태그·가중치', () => {
    expect(preferredLocale('ko-KR,ko;q=0.9,en-US;q=0.8')).toBe('ko');
    expect(preferredLocale('pt-BR,pt;q=0.9')).toBe('pt');
    expect(preferredLocale('zh-TW')).toBe('zh');
    expect(preferredLocale('it-IT,de;q=0.5')).toBe('de'); // 이탈리아어 미지원 → 다음 후보
    expect(preferredLocale('en;q=0.2,ja;q=0.9')).toBe('ja');
  });
  it('모르면 영어', () => {
    expect(preferredLocale('')).toBe('en');
    expect(preferredLocale(undefined)).toBe('en');
    expect(preferredLocale('it,ru')).toBe('en');
    expect(preferredLocale('ko;q=0')).toBe('en');
  });
});
