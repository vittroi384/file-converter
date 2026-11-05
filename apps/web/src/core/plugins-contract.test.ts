// 화면이 실제로 보내는 옵션이 플러그인 검사를 통과하는지(모든 동작 × 모든 선택지 × 대표 파일).
// 처음엔 손으로 만든 옵션만 시험해서, '자동' 형식이 to를 빼고 보내는 경우를 놓쳐 스마트 압축이 전부 거부됐다.
import { describe, it, expect } from 'vitest';
import { ACTIONS, toRunOptions, smartDefaults } from '../app/actions.ts';
import { pluginById } from './plugins.ts';

const SAMPLE: Record<string, string[]> = {
  image: ['a.jpg', 'a.png', 'a.heic', 'a.psd', 'a.svg', 'a.webp'],
  pdf: ['a.pdf'], data: ['a.csv', 'a.xlsx', 'a.json', 'a.yaml'], video: ['a.mp4', 'a.mov', 'a.webm', 'a.m4a'], other: [],
};
const TEXT_SAMPLES = ['', '1-3', '1, 4-6', 'each'];

describe('화면 옵션 → 플러그인 검사 계약', () => {
  for (const action of ACTIONS) {
    it(action.id, () => {
      const names = action.kinds.flatMap(k => SAMPLE[k] ?? []);
      for (const name of names) {
        const base = smartDefaults(action, [name]);
        const variants = [base];
        for (const f of action.fields) {
          const values = f.type === 'chips' ? f.choices.map(c => c.value) : TEXT_SAMPLES.filter(s => s !== 'each' || action.id === 'pdf-split');
          for (const val of values) variants.push({ ...base, [f.key]: val });
        }
        const plugin = pluginById(action.op(name));
        expect(plugin, `${action.id} ${name}`).toBeTruthy();
        expect(plugin!.inputs, `${action.id}: ${name}을 받아야 함`).toContain(name.split('.').pop() === 'heic' ? 'heic' : name.split('.').pop());
        for (const o of variants) {
          const r = plugin!.validate(toRunOptions(action, o, name, 'ko'));
          expect(r, `${action.id} ${name} ${JSON.stringify(o)}`).toMatchObject({ ok: true });
        }
      }
    });
  }
});
