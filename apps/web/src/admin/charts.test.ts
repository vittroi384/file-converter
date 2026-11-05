import { describe, it, expect } from 'vitest';
import { segments } from './charts.tsx';

describe('선 끊기', () => {
  it('빈 구간에서 끊고, 고른 간격이면 한 줄', () => {
    const p = (t: number): [number, number] => [t, 1];
    expect(segments([p(0), p(60), p(120), p(180)])).toHaveLength(1);
    const s = segments([p(0), p(60), p(120), p(3000), p(3060)]);
    expect(s.map(x => x.length)).toEqual([3, 2]);
    expect(segments([p(0)])).toEqual([[p(0)]]);
  });
});

import { deployTimes } from './charts.tsx';
describe('배포 시각', () => {
  it('버전별 처음 기록 시각, api·web 중 이른 쪽, 기간 전부터 있던 버전은 뺀다', () => {
    const s = (component: string, version: string, t: number) => ({ metric: { component, version }, value: [0, String(t)] as [number, string] });
    // 실제 로컬 스택에서 본 값: api v1→v2→v3, web은 v2부터 수집
    // 기간 시작 990초: v1(10초 뒤)은 '원래 있던 것', v2(130초 뒤)·v3는 배포
    const r = deployTimes([s('api', 'v1', 1000), s('api', 'v2', 1120), s('api', 'v3', 1330), s('web', 'v2', 1223), s('web', 'v3', 1313)] as never, 990_000);
    expect(r).toEqual([{ t: 1120_000, label: 'v2' }, { t: 1313_000, label: 'v3' }]);
    expect(deployTimes(undefined, 0)).toEqual([]);
  });
  it('경계: 기간 시작 뒤 정확히 2분은 원래 있던 것으로 본다(초과부터 배포)', () => {
    const one = (t: number) => deployTimes([{ metric: { component: 'api', version: 'x' }, value: [0, String(t)] }] as never, 0);
    expect(one(120)).toEqual([]);
    expect(one(121)).toHaveLength(1);
  });
});

import { groupLogs } from './Admin.tsx';
describe('오류 로그 묶기', () => {
  it('같은 출처·위치·코드·메시지는 한 줄, 많이 난 것부터, 처음·마지막 시각', () => {
    const it = (t: string, msg: string, code = 'decode') => ({ _time: t, _msg: msg, code, where: 'heic', source: 'client' });
    const g = groupLogs([it('2026-11-04T10:03', 'bad'), it('2026-11-04T10:02', 'other'), it('2026-11-04T10:01', 'bad'), it('2026-11-04T10:00', 'bad')]);
    expect(g.map(x => [x.last._msg, x.count])).toEqual([['bad', 3], ['other', 1]]);
    expect(g[0]!.first._time).toBe('2026-11-04T10:00');
    expect(g[0]!.last._time).toBe('2026-11-04T10:03');
  });
});
