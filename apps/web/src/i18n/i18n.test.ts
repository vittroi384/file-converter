import { describe, it, expect } from 'vitest';
import { LOCALES, getDict, getLandingT } from './all.ts';
import { LANDINGS } from './landings.ts';

const HANGUL = /[가-힣]/;

describe('랜딩 270페이지 문구 검사', () => {
  for (const l of LOCALES) {
    it(l, () => {
      const T = getLandingT(l);
      const problems: string[] = [];
      for (const d of LANDINGS) {
        const c = T.build(d.def);
        const all = [c.title, c.metaDescription, c.intro, ...c.steps, ...c.faq.flatMap(x => [x.q, x.a])];
        if (all.some(s => !s || /undefined|null|NaN/.test(s))) problems.push(`${d.slug}: 빈 값·undefined`);
        if (l !== 'ko' && all.some(s => HANGUL.test(s))) problems.push(`${d.slug}: 한국어 섞임`);
        // 검색 결과에서 잘리지 않게(라틴 문자 기준 70자, CJK는 글자가 넓어 40자)
        const cjk = l === 'ja' || l === 'zh' || l === 'ko';
        if (c.title.length > (cjk ? 40 : 75)) problems.push(`${d.slug}: 제목 ${c.title.length}자`);
        if (c.metaDescription.length > (cjk ? 110 : 190)) problems.push(`${d.slug}: 설명 ${c.metaDescription.length}자`);
        if (c.faq.length < 3) problems.push(`${d.slug}: 질문 ${c.faq.length}개`);
      }
      expect(problems).toEqual([]);
    });
  }
});

describe('화면 사전', () => {
  it('함수형 문구가 숫자를 넣는다', () => {
    for (const l of LOCALES) {
      const t = getDict(l);
      expect(t.ui.saveAll(3)).toContain('3');
      expect(t.ui.remaining(2)).toContain('2');
      expect(l === 'ko' || !HANGUL.test(JSON.stringify(t))).toBe(true);
    }
  });
});
