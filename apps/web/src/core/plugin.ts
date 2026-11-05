// 변환기 플러그인 계약. 이전엔 OpRunner 함수 하나라서 '무엇을 받고, 무엇을 내고, 메모리를 얼마나 쓰고,
// 어떤 옵션이 맞는지'가 코드 곳곳(actions.ts, imgsize.ts, 각 run 함수)에 흩어져 있었다.
// - 명세(manifest): 가볍다. 화면(받을 수 있는지·비용·옵션 검사)과 워커(실행 전 재검사)가 같이 쓴다.
// - 실행부(load): 무겁다(WASM). 워커에서 쓸 때만 불러온다.
import type { Format } from '@fc/shared';
import type { OpRunner, Options } from './types.ts';

// ── 작은 옵션 검증기(화면 묶음에 zod를 들이지 않으려고) ──
export type Check<T> = (v: unknown, path: string) => { ok: true; value: T } | { ok: false; error: string };
export const v = {
  enumOf: <T extends string>(values: readonly T[], def?: T): Check<T> => (x, p) =>
    x === undefined && def !== undefined ? { ok: true, value: def }
      : typeof x === 'string' && (values as readonly string[]).includes(x) ? { ok: true, value: x as T } : { ok: false, error: `${p}: ${values.join('|')} 중 하나` },
  num: (min: number, max: number, def?: number): Check<number> => (x, p) => {
    if (x === undefined && def !== undefined) return { ok: true, value: def };
    const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
    return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? { ok: true, value: n } : { ok: false, error: `${p}: ${min}~${max}` };
  },
  // 없으면 '자동'(변환기가 고름). 스마트 압축의 형식 '자동'은 to를 빼고 보낸다.
  optEnum: <T extends string>(values: readonly T[]): Check<T | undefined> => (x, p) => (x === undefined ? { ok: true, value: undefined } : v.enumOf(values)(x, p)),
  optNum: (min: number, max: number): Check<number | undefined> => (x, p) => (x === undefined || x === '' ? { ok: true, value: undefined } : v.num(min, max)(x, p)),
  str: (re: RegExp, def = ''): Check<string> => (x, p) =>
    x === undefined ? { ok: true, value: def } : typeof x === 'string' && x.length <= 200 && re.test(x) ? { ok: true, value: x } : { ok: false, error: `${p}: 형식이 맞지 않음` },
  bool: (def: boolean): Check<boolean> => x => ({ ok: true, value: x === undefined ? def : x === true || x === 'true' }),
};
export function object<S extends Record<string, Check<unknown>>>(shape: S) {
  type Out = { [K in keyof S]: S[K] extends Check<infer T> ? T : never };
  return (input: Options): { ok: true; value: Out } | { ok: false; error: string } => {
    const out: Record<string, unknown> = {};
    for (const [k, check] of Object.entries(shape)) {
      const r = check(input[k], k);
      if (!r.ok) return r;
      if (r.value !== undefined) out[k] = r.value;
    }
    return { ok: true, value: out as Out }; // 모르는 키는 버린다
  };
}

export interface InputInfo { format: Format; bytes: number; width?: number; height?: number }

export interface ConverterPlugin {
  id: string;
  inputs: readonly Format[]; // 받는 형식
  outputs(options: Options): readonly Format[]; // 이 옵션이면 나오는 형식
  arity: 'one' | 'many'; // 파일 하나씩 / 여러 개를 하나로
  internal?: boolean; // 통계에 안 잡히는 내부 작업(하위 워커용)
  mainThread?: boolean; // 워커가 아니라 화면 쪽에서 실행(자기 작업자를 따로 띄우는 라이브러리 — OCR)
  validate(options: Options): { ok: true; value: Options } | { ok: false; error: string };
  cost(inputs: InputInfo[], options: Options): number; // 예상 메모리(바이트)
  timeoutMs?(inputs: InputInfo[], options: Options): number; // 워커 시간 초과(없으면 풀 기본 5분). 영상처럼 오래 걸리는 작업만
  load(): Promise<OpRunner>;
}

export function accepts(p: ConverterPlugin, f: Format) { return p.inputs.includes(f); }
