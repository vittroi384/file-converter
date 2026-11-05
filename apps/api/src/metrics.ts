// 익명 통계 → Prometheus 지표. VictoriaMetrics가 /metrics를 긁어 간다.
// 라벨은 전부 허용 목록(@fc/shared) 안의 값만 들어온다(스키마 검증을 통과한 이벤트만 기록).
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { METRICS, CRAWLERS, CRAWL_KINDS, type Crawler, type CrawlKind } from '@fc/shared';
import type { TelemetryEvent } from '@fc/shared';
import type { Browser, Device } from './ua.ts';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'fc_api_' });

  const conversions = new Counter({
    name: METRICS.conversions, help: '변환 수', registers: [registry],
    labelNames: ['op', 'from', 'to', 'result', 'err', 'browser', 'device'] as const,
  });
  // 처리 시간: 0.05초 ~ 5분
  const duration = new Histogram({
    name: METRICS.duration, help: '변환 처리 시간(초)', registers: [registry],
    labelNames: ['op', 'device'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120, 300],
  });
  // 입력 크기: 10KB ~ 2GB
  const inputBytes = new Histogram({
    name: METRICS.inputBytes, help: '입력 크기(바이트)', registers: [registry],
    labelNames: ['op'] as const,
    buckets: [1e4, 1e5, 5e5, 1e6, 5e6, 1e7, 5e7, 1e8, 5e8, 2e9],
  });
  // 결과/입력 크기 비율(압축률): 0.05 ~ 4
  const ratio = new Histogram({
    name: METRICS.ratio, help: '결과 크기 / 입력 크기', registers: [registry],
    labelNames: ['op'] as const,
    buckets: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.5, 4],
  });
  const vitalsMs = new Histogram({
    name: METRICS.vitalsMs, help: '웹 성능 지표(ms): LCP·INP·FCP·TTFB', registers: [registry],
    labelNames: ['name', 'device'] as const,
    buckets: [50, 100, 200, 300, 500, 800, 1200, 1800, 2500, 4000, 6000, 10000],
  });
  const cls = new Histogram({
    name: METRICS.cls, help: '누적 레이아웃 이동(CLS)', registers: [registry],
    labelNames: ['device'] as const,
    buckets: [0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1],
  });
  const vitalRatings = new Counter({
    name: METRICS.vitalRatings, help: '웹 성능 등급 분포', registers: [registry],
    labelNames: ['name', 'rating', 'device'] as const,
  });
  const clientErrors = new Counter({
    name: METRICS.clientErrors, help: '브라우저 오류 수', registers: [registry],
    labelNames: ['where', 'code', 'browser'] as const,
  });
  const pageViews = new Counter({
    name: METRICS.pageViews, help: '페이지 열람', registers: [registry],
    labelNames: ['path', 'device', 'browser', 'locale'] as const,
  });
  // 유입 출처: 사이트 밖에서 들어온 첫 페이지만(사이트 안 이동 'internal'은 세지 않음)
  const referrals = new Counter({
    name: METRICS.referrals, help: '유입 출처(AI 추천 포함)', registers: [registry],
    labelNames: ['source', 'path', 'locale'] as const,
  });
  // 크롤러 방문: nginx가 봇 요청을 내부 주소로 복제해 알린다(봇은 JS를 안 돌려 브라우저 통계에 안 잡힌다)
  const crawls = new Counter({
    name: METRICS.crawls, help: '크롤러 방문(AI·검색)', registers: [registry],
    labelNames: ['bot', 'kind'] as const,
  });
  // AI 크롤러가 처음 오는 순간도 increase()가 잡도록 주요 조합을 0으로
  for (const bot of CRAWLERS) for (const kind of CRAWL_KINDS) crawls.inc({ bot, kind }, 0);
  const telemetry = new Counter({
    name: METRICS.telemetry, help: '통계 이벤트 수신(받음/거부)', registers: [registry],
    labelNames: ['result', 'reason'] as const,
  });
  const logPushErrors = new Counter({ name: METRICS.logPushErrors, help: 'VictoriaLogs 전송 실패', registers: [registry] });
  // 알림 전용 카운터(라벨 최소, 시작 때 0)
  const alertConversions = new Counter({ name: METRICS.alertConversions, help: '변환 수(알림용)', registers: [registry], labelNames: ['result'] as const });
  const alertClientErrors = new Counter({ name: METRICS.alertClientErrors, help: '브라우저 오류 수(알림용)', registers: [registry] });
  alertConversions.inc({ result: 'ok' }, 0);
  alertConversions.inc({ result: 'error' }, 0);
  alertClientErrors.inc(0);
  telemetry.inc({ result: 'accepted', reason: '' }, 0);
  for (const reason of ['bot', 'batch', 'event']) telemetry.inc({ result: 'rejected', reason }, 0);
  // 배포 표시: 버전이 바뀐 순간이 곧 배포 시각(관리자 그래프에 세로선)
  const buildInfo = new Gauge({ name: METRICS.buildInfo, help: '실행 중인 빌드', registers: [registry], labelNames: ['component', 'version'] as const });
  buildInfo.set({ component: 'api', version: (process.env.BUILD_ID ?? 'dev').slice(0, 40) }, 1);
  const httpDuration = new Histogram({
    name: METRICS.httpDuration, help: 'API 응답 시간(초)', registers: [registry],
    labelNames: ['route', 'method', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  });

  function record(e: TelemetryEvent, who: { browser: Browser; device: Device }) {
    switch (e.t) {
      case 'conv':
        conversions.inc({ op: e.op, from: e.from, to: e.to, result: e.ok ? 'ok' : 'error', err: e.err ?? '', browser: who.browser, device: who.device });
        alertConversions.inc({ result: e.ok ? 'ok' : 'error' });
        if (e.ok) {
          duration.observe({ op: e.op, device: who.device }, e.ms / 1000);
          inputBytes.observe({ op: e.op }, e.inBytes);
          if (e.inBytes > 0 && e.outBytes !== undefined) ratio.observe({ op: e.op }, e.outBytes / e.inBytes);
        }
        break;
      case 'vital':
        if (e.name === 'CLS') cls.observe({ device: who.device }, e.value);
        else vitalsMs.observe({ name: e.name, device: who.device }, e.value);
        vitalRatings.inc({ name: e.name, rating: e.rating, device: who.device });
        break;
      case 'err':
        clientErrors.inc({ where: e.where, code: e.code, browser: who.browser });
        alertClientErrors.inc();
        break;
      case 'pv':
        pageViews.inc({ path: e.path, device: who.device, browser: who.browser, locale: e.locale });
        if (e.ref !== 'internal') referrals.inc({ source: e.ref, path: e.path, locale: e.locale });
        break;
    }
  }

  const crawl = (bot: Crawler, kind: CrawlKind) => crawls.inc({ bot, kind });
  return { registry, record, crawl, telemetry, logPushErrors, httpDuration };
}
export type Metrics = ReturnType<typeof createMetrics>;
