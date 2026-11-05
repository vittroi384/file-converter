// 합성 감시: 1분마다 사이트를 손님처럼 직접 열어 본다. 사람이 안 와도(새벽·트래픽 0) 깨진 걸 먼저 안다.
// 결과는 fc_probe_success{check}(1/0)·fc_probe_seconds{check}. 'ProbeFailing' 규칙이 알린다.
// 감시 UA에는 'bot'을 넣지 않는다 → nginx 봇 복제·크롤러 집계에 안 섞인다.
import { Gauge, type Registry } from 'prom-client';
import { METRICS } from '@fc/shared';

export interface Check { id: string; path: string; expect(r: Response, body: string): string | null }

const CSP_SELF = /connect-src 'self'/;
export const CHECKS: Check[] = [
  { id: 'home', path: '/', expect: (r, b) => (r.status !== 200 ? `상태 ${r.status}` : b.includes('<title>') ? null : '제목 없음') },
  { id: 'headers', path: '/', expect: r => (!CSP_SELF.test(r.headers.get('content-security-policy') ?? '') ? 'CSP(connect-src self) 없음'
      : r.headers.get('cross-origin-embedder-policy') !== 'require-corp' ? 'COEP 없음' : null) },
  { id: 'landing', path: '/ko/heic-to-jpg', expect: (r, b) => (r.status !== 200 ? `상태 ${r.status}` : b.includes('HEIC') ? null : '내용 없음') },
  { id: 'ssr', path: '/ja/avif-to-png', expect: (r, b) => (r.status !== 200 ? `상태 ${r.status}` : b.includes('AVIF') ? null : '내용 없음') },
  { id: 'api', path: '/api/health', expect: (r, b) => (r.status === 200 && b.includes('"ok":true') ? null : `상태 ${r.status}`) },
  { id: 'llms', path: '/llms.txt', expect: (r, b) => (r.status === 200 && b.length > 200 ? null : `상태 ${r.status}`) },
];

export function createProber(registry: Registry, base: string, fetchImpl: typeof fetch = fetch) {
  const ok = new Gauge({ name: METRICS.probeSuccess, help: '합성 감시 성공(1)/실패(0)', registers: [registry], labelNames: ['check'] as const });
  const secs = new Gauge({ name: METRICS.probeSeconds, help: '합성 감시 응답 시간(초)', registers: [registry], labelNames: ['check'] as const });
  const last: Record<string, string | null> = {};
  async function runOnce() {
    await Promise.all(CHECKS.map(async c => {
      const t0 = performance.now();
      let why: string | null;
      try {
        const r = await fetchImpl(base + c.path, { headers: { 'user-agent': 'fc-prober/1 (synthetic check)', 'accept-language': 'en' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        why = c.expect(r, await r.text());
      } catch (e) {
        why = `연결 실패: ${(e as Error).message}`;
      }
      ok.set({ check: c.id }, why ? 0 : 1);
      secs.set({ check: c.id }, (performance.now() - t0) / 1000);
      last[c.id] = why;
    }));
    return { ...last };
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    runOnce,
    start(everyMs = 60_000) { void runOnce(); timer = setInterval(() => void runOnce(), everyMs); timer.unref?.(); },
    stop() { if (timer) clearInterval(timer); },
  };
}
