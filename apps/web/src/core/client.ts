// 화면 쪽에서 쓰는 변환 API. 워커 풀을 하나만 만들어 공유한다.
import { formatFromName, type Format, type Op } from '@fc/shared';
import { WorkerPool, defaultPoolSize } from './pool.ts';
import { imageSize, memoryBudget, hardLimit } from './imgsize.ts';
import { pluginById } from './plugins.ts';
import { ConvertError, isConvertError, type Options, type OutputMeta } from './types.ts';
import { track } from '../telemetry.ts';

let pool: WorkerPool | null = null;
export function getPool() {
  pool ??= new WorkerPool({
    size: defaultPoolSize(),
    memoryBudget: memoryBudget(),
    recycleAbove: 640 * 1024 * 1024, // 300MB였을 땐 1200만 화소(예상 320MB)마다 워커를 버리고 WASM을 다시 올려 100장 일괄이 느려졌다(v2 측정)
    create: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as never,
  });
  return pool;
}

export interface ConvertedFile {
  name: string;
  blob: Blob;
}
export interface Job {
  id: number;
  promise: Promise<{ files: ConvertedFile[]; meta?: OutputMeta; ms: number }>;
  cancel(): void;
}

export function convert(files: File[], op: Op, options: Options, onProgress?: (v: number, note?: string) => void): Job {
  const t0 = performance.now();
  const inBytes = files.reduce((s, f) => s + f.size, 0);
  const from: Format = files.length ? formatFromName(files[0]!.name) : 'other';
  let cancelled = false;
  let poolId = -1;
  const promise = (async () => {
    const plugin = pluginById(op);
    if (!plugin) throw new ConvertError('unsupported', op);
    const checked = plugin.validate(options);
    if (!checked.ok) throw new ConvertError('unsupported', '옵션이 맞지 않아요', checked.error);
    // 파일 머리(256KB)만 읽어 예상 메모리를 계산한다 → 한도를 넘으면 파일 전체를 읽기도 전에 안내하고 멈춘다
    const heads = await Promise.all(files.map(f => f.slice(0, 262144).arrayBuffer()));
    const infos = files.map((f, i) => { const d = imageSize(new Uint8Array(heads[i]!)); return { format: formatFromName(f.name), bytes: f.size, width: d?.w, height: d?.h }; });
    const cost = plugin.cost(infos, checked.value);
    const limit = hardLimit();
    if (cost > limit) throw Object.assign(new ConvertError('too-large', `예상 ${Math.round(cost / 1048576)}MB > 한도 ${Math.round(limit / 1048576)}MB`), { info: { need: cost, limit } });
    const inputs = await Promise.all(files.map(async f => ({ name: f.name, type: f.type, buf: await f.arrayBuffer() })));
    if (cancelled) throw new ConvertError('cancelled', '취소됨');
    if (plugin.mainThread) {
      const runner = await plugin.load();
      const r = await runner(inputs, checked.value, { progress: (v: number, n?: string) => onProgress?.(v, n) } as never);
      const out = r.outputs.map(o => ({ name: o.name, blob: new Blob([o.buf], { type: o.type }) }));
      const ms = performance.now() - t0;
      track({ t: 'conv', op, from, to: out.length ? formatFromName(out[0]!.name) : 'other', ok: true, ms, inBytes, outBytes: out.reduce((s, o) => s + o.blob.size, 0), files: files.length });
      return { files: out, meta: r.meta, ms };
    }
    const run = getPool().run({ op, inputs, options: checked.value }, { onProgress, cost, timeoutMs: plugin.timeoutMs?.(infos, checked.value) });
    poolId = run.id;
    try {
      const r = await run.promise.catch(async (e: unknown) => {
        // 워커에선 못 하고 화면 쪽에서만 되는 경우 같은 플러그인을 화면 쪽에서 다시 실행:
        // - no-offscreen: 워커에서 캔버스를 못 쓰는 브라우저(옛 사파리 등)의 PDF→이미지
        // - svg-text-main: 글자 있는 SVG(브라우저 렌더러·시스템 글꼴이 필요)
        if (isConvertError(e) && (e.detail?.includes('no-offscreen') || e.detail?.includes('svg-text-main'))) {
          const runner = await plugin.load();
          const again = await Promise.all(files.map(async f => ({ name: f.name, type: f.type, buf: await f.arrayBuffer() })));
          return runner(again, checked.value, { progress: (v: number, n?: string) => onProgress?.(v, n) } as never);
        }
        throw e;
      });
      const out = r.outputs.map(o => ({ name: o.name, blob: new Blob([o.buf], { type: o.type }) }));
      const ms = performance.now() - t0;
      const outBytes = out.reduce((s, f) => s + f.blob.size, 0);
      track({ t: 'conv', op, from, to: out.length ? formatFromName(out[0]!.name) : 'other', ok: true, ms, inBytes, outBytes, files: files.length });
      return { files: out, meta: r.meta, ms };
    } catch (e) {
      const err = isConvertError(e) ? e : new ConvertError('unknown', String(e), e);
      if (err.code !== 'cancelled') {
        track({ t: 'conv', op, from, to: 'other', ok: false, ms: performance.now() - t0, inBytes, err: err.code, files: files.length });
        track({ t: 'err', where: op, code: err.code, msg: err.detail ? `${err.message} | ${err.detail}` : err.message });
      }
      throw err;
    }
  })();
  return {
    get id() { return poolId; },
    promise,
    cancel() { cancelled = true; if (poolId >= 0) getPool().cancel(poolId); },
  };
}
