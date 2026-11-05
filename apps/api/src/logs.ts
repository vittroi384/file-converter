// 오류 상세 → VictoriaLogs(JSON Lines). 모아서 2초마다 보낸다. 실패해도 API는 멈추지 않는다.
import { scrubMessage } from '@fc/shared';

export interface LogEntry {
  _msg: string;
  _time?: string;
  level: 'error' | 'warn' | 'info';
  source: 'client' | 'api';
  where?: string;
  code?: string;
  browser?: string;
  device?: string;
}

export function createLogShipper(baseUrl: string, onError: () => void, opts: { intervalMs?: number; maxBuffer?: number; fetchImpl?: typeof fetch } = {}) {
  const buf: LogEntry[] = [];
  const max = opts.maxBuffer ?? 2000;
  const doFetch = opts.fetchImpl ?? fetch;
  let dropped = 0;
  const url = `${baseUrl}/insert/jsonline?_stream_fields=source,where&_msg_field=_msg&_time_field=_time`;

  function push(e: LogEntry) {
    // 서버에서도 한 번 더 정화(브라우저가 정화를 우회해 보낸 경우 대비)
    const entry = { ...e, _msg: scrubMessage(e._msg), _time: e._time ?? new Date().toISOString() };
    if (buf.length >= max) { buf.shift(); dropped++; }
    buf.push(entry);
  }

  async function flush() {
    if (!buf.length) return;
    const batch = buf.splice(0, buf.length);
    try {
      const res = await doFetch(url, { method: 'POST', body: batch.map(b => JSON.stringify(b)).join('\n'), headers: { 'content-type': 'application/stream+json' }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      onError();
      // 다음에 다시 보내도록 앞에 되돌린다(버퍼 상한 안에서)
      buf.unshift(...batch.slice(-Math.max(0, max - buf.length)));
    }
  }

  const timer = setInterval(() => { void flush(); }, opts.intervalMs ?? 2000);
  timer.unref();
  return { push, flush, stop: () => clearInterval(timer), get pending() { return buf.length; }, get dropped() { return dropped; } };
}
export type LogShipper = ReturnType<typeof createLogShipper>;
