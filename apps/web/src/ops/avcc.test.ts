import { describe, it, expect } from 'vitest';
import { repairAvcC } from './avcc.ts';

// 리눅스 파이어폭스(Playwright 1.64.1 noble)에서 640×360 avc1.64001e로 실제로 받은 값
const SPS = [103, 100, 0, 30, 172, 217, 64, 160, 47, 249, 97, 0, 0, 3, 0, 1, 0, 30, 132, 128, 15, 22, 45, 150];
const PPS = [104, 235, 236, 178, 44];
const FIREFOX_DESC = new Uint8Array([1, 100, 0, 30, 3, 1, 0, 25, 103, ...SPS, 1, 0, 6, 104, ...PPS]);
const len = (n: number[]) => [0, 0, 0, n.length, ...n];
const KEY = new Uint8Array([...len(SPS), ...len(PPS), ...len([101, 136, 132, 0])]);
const GOOD = new Uint8Array([1, 100, 0, 30, 0xff, 0xe1, 0, SPS.length, ...SPS, 1, 0, PPS.length, ...PPS]);

describe('repairAvcC', () => {
  it('NAL 머리가 두 번 든 avcC를 키프레임의 SPS·PPS로 다시 만든다', () => {
    expect(Array.from(repairAvcC(FIREFOX_DESC, KEY)!)).toEqual(Array.from(GOOD));
  });
  it('이미 맞는 avcC는 그대로(같은 객체)', () => {
    expect(repairAvcC(GOOD, KEY)).toBe(GOOD);
  });
  it('avcC가 없으면 키프레임으로 만든다', () => {
    expect(Array.from(repairAvcC(undefined, KEY)!)).toEqual(Array.from(GOOD));
  });
  it('키프레임에 SPS·PPS가 없으면 손대지 않는다', () => {
    expect(repairAvcC(FIREFOX_DESC, new Uint8Array(len([101, 136, 132, 0])))).toBe(FIREFOX_DESC);
  });
});
