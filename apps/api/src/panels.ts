// 관리자 대시보드 패널 = 서버에 미리 정의한 이름 붙은 쿼리. 화면은 이름만 보낸다(임의 쿼리 차단).
import { METRICS as M } from '@fc/shared';

export type Range = '1h' | '24h' | '7d' | '30d';
export const RANGES: Record<Range, { seconds: number; step: string; window: string }> = {
  '1h': { seconds: 3600, step: '60s', window: '5m' },
  '24h': { seconds: 86400, step: '5m', window: '15m' },
  '7d': { seconds: 604800, step: '1h', window: '1h' },
  '30d': { seconds: 2592000, step: '6h', window: '6h' },
};

export interface Panel {
  id: string;
  kind: 'range' | 'instant'; // range: 시계열, instant: 기간 합계·분포
  query: (r: { range: Range; window: string }) => string;
}

export const PANELS: Panel[] = [
  // 핵심 숫자(기간 합계)
  { id: 'total', kind: 'instant', query: ({ range }) => `sum(increase(${M.conversions}[${range}]))` },
  { id: 'failed', kind: 'instant', query: ({ range }) => `sum(increase(${M.conversions}{result="error"}[${range}]))` },
  // 예전엔 path="/"만 세어 안내 페이지(270여 개) 열람이 빠졌다
  { id: 'views', kind: 'instant', query: ({ range }) => `sum(increase(${M.pageViews}{path=~"/|landing"}[${range}]))` },
  { id: 'savedRatio', kind: 'instant', query: ({ range }) => `histogram_quantile(0.5, sum(rate(${M.ratio}_bucket{op=~"compress|pdf-compress"}[${range}])) by (le))` },
  // 시간에 따른 변화
  { id: 'rate', kind: 'range', query: ({ window }) => `sum(rate(${M.conversions}[${window}])) by (result) * 60` },
  { id: 'success', kind: 'range', query: ({ window }) => `sum(rate(${M.conversions}{result="ok"}[${window}])) / sum(rate(${M.conversions}[${window}]))` },
  // 작업이 11종이라 작업별 선 11개는 색이 겹치고 읽기도 어렵다 → 추이는 전체 한 줄, 작업별은 기간 값 막대로
  { id: 'p95', kind: 'range', query: ({ window }) => `histogram_quantile(0.95, sum(rate(${M.duration}_bucket[${window}])) by (le))` },
  { id: 'p95ByOp', kind: 'instant', query: ({ range }) => `sort_desc(histogram_quantile(0.95, sum(rate(${M.duration}_bucket[${range}])) by (le, op)))` },
  // 분포
  { id: 'byOp', kind: 'instant', query: ({ range }) => `sort_desc(sum(increase(${M.conversions}[${range}])) by (op))` },
  { id: 'flows', kind: 'instant', query: ({ range }) => `topk(8, sum(increase(${M.conversions}{result="ok"}[${range}])) by (from, to))` },
  { id: 'errors', kind: 'instant', query: ({ range }) => `sort_desc(sum(increase(${M.conversions}{result="error"}[${range}])) by (op, err) > 0)` },
  { id: 'devices', kind: 'instant', query: ({ range }) => `sum(increase(${M.pageViews}[${range}])) by (device)` },
  { id: 'browsers', kind: 'instant', query: ({ range }) => `sort_desc(sum(increase(${M.pageViews}[${range}])) by (browser))` },
  // 체감 성능(Core Web Vitals p75: 구글 기준과 같은 백분위)
  { id: 'vitals', kind: 'instant', query: ({ range }) => `histogram_quantile(0.75, sum(rate(${M.vitalsMs}_bucket[${range}])) by (le, name))` },
  { id: 'cls', kind: 'instant', query: ({ range }) => `histogram_quantile(0.75, sum(rate(${M.cls}_bucket[${range}])) by (le))` },
  { id: 'vitalsGood', kind: 'instant', query: ({ range }) => `sum(increase(${M.vitalRatings}{rating="good"}[${range}])) by (name) / sum(increase(${M.vitalRatings}[${range}])) by (name)` },
  // 유입·검색 노출(AI 추천 유입을 따로 본다)
  { id: 'referrals', kind: 'instant', query: ({ range }) => `sort_desc(sum(increase(${M.referrals}[${range}])) by (source) > 0)` },
  { id: 'aiReferrals', kind: 'range', query: ({ window }) => `sum(rate(${M.referrals}{source=~"chatgpt|perplexity|claude|gemini|copilot"}[${window}])) by (source) * 3600` },
  { id: 'locales', kind: 'instant', query: ({ range }) => `sort_desc(sum(increase(${M.pageViews}{path=~"/|landing",locale!=""}[${range}])) by (locale) > 0)` },
  { id: 'landingShare', kind: 'instant', query: ({ range }) => `sum(increase(${M.referrals}{path="landing"}[${range}])) / sum(increase(${M.referrals}[${range}]))` },
  { id: 'crawlers', kind: 'instant', query: ({ range }) => `sort_desc(sum(increase(${M.crawls}[${range}])) by (bot) > 0)` },
  { id: 'crawlKinds', kind: 'instant', query: ({ range }) => `sort_desc(sum(increase(${M.crawls}{bot=~"gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|claude-searchbot|perplexitybot|perplexity-user"}[${range}])) by (kind) > 0)` },
  // 서버 상태
  { id: 'apiUp', kind: 'instant', query: () => `up{job="api"}` },
  { id: 'probes', kind: 'instant', query: () => `${M.probeSuccess}` },
  { id: 'probeSecs', kind: 'instant', query: () => `${M.probeSeconds}` },
  { id: 'builds', kind: 'instant', query: () => `max by (component, version) (${M.buildInfo})` },
  // 버전별로 처음 기록된 정확한 시각(tfirst_over_time). 처음엔 그래프용 range 결과에서 계산했더니
  // 5분 간격에선 2분만 산 버전이 통째로 사라지고 첫 배포가 '원래 있던 것'으로 빠졌다
  { id: 'deploys', kind: 'instant', query: ({ range }) => `min by (component, version) (tfirst_over_time(${M.buildInfo}[${range}]))` },
  { id: 'apiP95', kind: 'range', query: ({ window }) => `histogram_quantile(0.95, sum(rate(${M.httpDuration}_bucket[${window}])) by (le))` },
  { id: 'apiMem', kind: 'range', query: () => `fc_api_process_resident_memory_bytes` },
  { id: 'rejected', kind: 'instant', query: ({ range }) => `sum(increase(${M.telemetry}{result="rejected"}[${range}])) by (reason)` },
];

export function panelQuery(p: Panel, range: Range) {
  return p.query({ range, window: RANGES[range].window });
}
