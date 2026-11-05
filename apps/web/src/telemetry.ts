// 익명 사용 통계. 파일 이름·내용·사용자 식별자는 보내지 않는다(스키마는 @fc/shared에서 서버와 공유).
import type { TelemetryEvent } from '@fc/shared';
import { scrubMessage, classifyReferrer, type RefSource } from '@fc/shared';

// 유입 출처: 도메인 이름만 분류해서 보낸다(주소 전체·검색어는 보내지 않는다)
export function referrerSource(): RefSource {
  let utm: string | null = null;
  try { utm = new URLSearchParams(location.search).get('utm_source'); } catch { /* 무시 */ }
  let host = '';
  try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* 무시 */ }
  if (host && host === location.hostname) return 'internal'; // 사이트 안 이동(예전엔 'direct'로 세어 직접 방문이 부풀었다)
  return classifyReferrer(host, utm);
}

const queue: TelemetryEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const ENDPOINT = '/api/t';
// 사용자가 끌 수 있다(설정에 저장). 브라우저 '추적 안 함'도 존중
let enabled = (() => {
  try { if (localStorage.getItem('fc:telemetry') === 'off') return false; } catch { /* 저장소 막힘 */ }
  return (navigator as { doNotTrack?: string }).doNotTrack !== '1';
})();

export function setTelemetry(on: boolean) {
  enabled = on;
  try { localStorage.setItem('fc:telemetry', on ? 'on' : 'off'); } catch { /* 무시 */ }
  if (!on) queue.length = 0;
}
export const telemetryEnabled = () => enabled;

export function track(e: TelemetryEvent) {
  if (!enabled) return;
  if (e.t === 'err') e = { ...e, msg: scrubMessage(e.msg) };
  queue.push(e);
  if (queue.length >= 20) flush();
  else timer ??= setTimeout(flush, 5000);
}

export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  while (queue.length) {
    const events = queue.splice(0, 50);
    const body = JSON.stringify({ v: 1, events });
    // 페이지를 닫는 중에도 전송되도록 sendBeacon 우선
    const ok = navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }));
    if (!ok) fetch(ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  }
}

export async function startVitals() {
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
  const { onLCP, onINP, onCLS, onFCP, onTTFB } = await import('web-vitals');
  const report = (m: { name: string; value: number; rating: string }) =>
    track({ t: 'vital', name: m.name as 'LCP', value: m.value, rating: m.rating as 'good' });
  onLCP(report); onINP(report); onCLS(report); onFCP(report); onTTFB(report);
  addEventListener('error', e => track({ t: 'err', where: 'ui', code: 'unknown', msg: String(e.message ?? '') }));
  addEventListener('unhandledrejection', e => track({ t: 'err', where: 'ui', code: 'unknown', msg: String((e.reason as Error)?.message ?? e.reason ?? '') }));
}
