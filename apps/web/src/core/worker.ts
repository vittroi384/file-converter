/// <reference lib="webworker" />
import { pluginById } from './plugins.ts';
import { ConvertError, isConvertError, type RunRequest, type WorkerMessage } from './types.ts';

const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const req = e.data;
  try {
    const plugin = pluginById(req.op);
    if (!plugin) throw new ConvertError('unsupported', `아직 지원하지 않는 작업: ${req.op}`);
    // 워커에서도 옵션을 다시 검사한다(화면을 거치지 않은 요청·버그 대비). 모르는 키는 버려진다.
    const checked = plugin.validate(req.options);
    if (!checked.ok) throw new ConvertError('unsupported', '옵션이 맞지 않아요', checked.error);
    const run = await plugin.load();
    const res = await run(req.inputs, checked.value, { progress: (value, note) => post({ type: 'progress', id: req.id, value, note }) });
    // 입력을 그대로 돌려주는 경우(원본 유지) 같은 버퍼가 두 번 들어가지 않게 중복 제거
    post({ type: 'done', id: req.id, outputs: res.outputs, meta: res.meta }, [...new Set(res.outputs.map(o => o.buf))]);
  } catch (err) {
    const ce = isConvertError(err);
    const code = ce ? err.code : err instanceof RangeError ? 'out-of-memory' : 'unknown';
    const detail = ce ? err.detail : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    post({ type: 'error', id: req.id, code, message: ce ? err.message : '변환 중 문제가 생겼어요', detail });
  }
};
