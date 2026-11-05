import { describe, it, expect } from 'vitest';
import { decodeText, inferCell, parse, serialize, flattenObject } from './data.ts';

const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

// "이름,전화\n김철수,01012345678" 를 EUC-KR로 인코딩한 바이트(엑셀 한국어 CSV 재현)
const eucKr = new Uint8Array([0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xc0, 0xfc, 0xc8, 0xad, 0x0a, 0xb1, 0xe8, 0xc3, 0xb6, 0xbc, 0xf6, 0x2c, 0x30, 0x31, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38]).buffer;

describe('인코딩', () => {
  it('EUC-KR CSV 자동 판별', () => {
    const r = decodeText(eucKr);
    expect(r.encoding).toBe('euc-kr');
    expect(r.text).toBe('이름,전화\n김철수,01012345678');
  });
  it('UTF-8 BOM 제거', () => {
    expect(decodeText(buf('﻿a,b')).text).toBe('a,b');
  });
});

describe('셀 추론', () => {
  it('앞자리 0·긴 번호는 문자열 유지', () => {
    expect(inferCell('01012345678')).toBe('01012345678');
    expect(inferCell('1234567890123456')).toBe('1234567890123456'); // 16자리 카드번호
    expect(inferCell('007')).toBe('007');
  });
  it('일반 숫자·불리언·빈칸', () => {
    expect(inferCell('42')).toBe(42);
    expect(inferCell('-3.5')).toBe(-3.5);
    expect(inferCell('0')).toBe(0);
    expect(inferCell('true')).toBe(true);
    expect(inferCell('')).toBeNull();
  });
});

describe('변환', () => {
  it('EUC-KR CSV → JSON: 한글·전화번호 보존', async () => {
    const p = await parse(eucKr, 'csv');
    const out = JSON.parse(text(await serialize(p, 'json')));
    expect(out).toEqual([{ 이름: '김철수', 전화: '01012345678' }]);
  });
  it('JSON → CSV: BOM, 따옴표·줄바꿈 이스케이프, 열 합집합', async () => {
    const p = await parse(buf(JSON.stringify([{ a: 1, b: 'x,"y"' }, { a: 2, c: '줄\n바꿈' }])), 'json');
    const raw = new Uint8Array(await serialize(p, 'csv'));
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const back = await parse(raw.buffer as ArrayBuffer, 'csv');
    expect(back.rows).toEqual([{ a: 1, b: 'x,"y"', c: null }, { a: 2, b: null, c: '줄\n바꿈' }]);
  });
  it('중첩 JSON → 표: 점 표기로 펼침', () => {
    expect(flattenObject({ a: { b: 1, c: { d: 'x' } }, tags: ['t1', 't2'] })).toEqual({ 'a.b': 1, 'a.c.d': 'x', tags: 't1, t2' });
  });
  it('YAML ↔ JSON 왕복', async () => {
    const src = { name: '테스트', list: [1, 2], nested: { ok: true } };
    const y = await serialize({ tree: src }, 'yaml');
    const back = await parse(y, 'yaml');
    expect(back.tree).toEqual(src);
  });
  it('CSV → XLSX → CSV 왕복(여러 행, 한글, 앞자리 0)', async () => {
    const csv = buf('이름,코드,점수\n가,007,90\n나,010,85.5\n');
    const x = await serialize(await parse(csv, 'csv'), 'xlsx');
    const back = await parse(x, 'xlsx');
    expect(back.rows).toEqual([{ 이름: '가', 코드: '007', 점수: 90 }, { 이름: '나', 코드: '010', 점수: 85.5 }]);
  });
  it('TSV 파싱', async () => {
    const p = await parse(buf('a\tb\n1\thello, world\n'), 'tsv');
    expect(p.rows).toEqual([{ a: 1, b: 'hello, world' }]);
  });
  it('문법 오류는 decode 오류', async () => {
    await expect(parse(buf('{bad json'), 'json')).rejects.toMatchObject({ code: 'decode' });
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
describe('엑셀 CSV 인코딩 자동 판별(파이썬으로 만든 실제 인코딩 파일)', () => {
  const dir = fileURLToPath(new URL('../../test/fixtures/encodings/', import.meta.url));
  const want: Record<string, string> = JSON.parse(readFileSync(dir + 'expected.json', 'utf8'));
  for (const enc of Object.keys(want)) {
    it(enc, () => {
      const b = readFileSync(dir + enc + '.csv');
      const r = decodeText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      expect(r.encoding).toBe(enc);
      expect(r.text).toBe(want[enc]);
    });
  }
});

describe('인코딩 판별 회귀 테스트(검증에 썼던 40개, 화면 언어 4가지)', () => {
  const dir = fileURLToPath(new URL('../../test/fixtures/encodings/holdout/', import.meta.url));
  const m: { file: string; text: string }[] = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  for (const hint of [undefined, 'en', 'ko', 'ja', 'zh']) {
    it(`화면 언어 ${hint ?? '없음'}`, () => {
      const wrong = m.filter(x => { const b = readFileSync(dir + x.file); return decodeText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, hint).text !== x.text; }).map(x => x.file);
      expect(wrong).toEqual([]);
    });
  }
});
