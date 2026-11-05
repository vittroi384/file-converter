// 웹·API 공용: 익명 통계 이벤트 스키마와 지표 라벨 허용 목록.
// 원칙: 파일 이름·내용·사용자 식별자는 절대 담지 않는다. 라벨 값은 아래 목록 안에서만.
// zod 스키마는 schema.ts에 따로 둔다(브라우저 첫 화면 번들에 zod가 딸려 오지 않게).

export const OPS = [
  'image', 'compress', 'heic', 'psd', 'svg',
  'pdf-merge', 'pdf-split', 'pdf-to-image', 'image-to-pdf', 'pdf-compress',
  'data', 'ocr', 'video',
] as const;
export type Op = (typeof OPS)[number];

export const FORMATS = [
  'jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'heic', 'psd', 'svg', 'pdf',
  'csv', 'tsv', 'json', 'xlsx', 'yaml', 'zip', 'txt',
  'mp4', 'mov', 'webm', 'm4a', 'other',
] as const;
export type Format = (typeof FORMATS)[number];

export const ERROR_CODES = [
  'unsupported', 'decode', 'encode', 'too-large', 'out-of-memory',
  'worker-crash', 'timeout', 'cancelled', 'password', 'unknown',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const VITALS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;
export const RATINGS = ['good', 'needs-improvement', 'poor'] as const;
export const PATHS = ['/', '/admin', 'landing', 'other'] as const;
export const LOCALE_CODES = ['en', 'ko', 'es', 'pt', 'de', 'fr', 'ja', 'hi', 'id', 'zh'] as const;
// 유입 출처(라벨 폭증을 막으려 고정 목록). AI 추천 유입을 따로 본다(QR 사이트 유입 대부분이 ChatGPT였다)
export const REF_SOURCES = ['direct', 'internal', 'chatgpt', 'perplexity', 'claude', 'gemini', 'copilot', 'google', 'bing', 'naver', 'duckduckgo', 'yandex', 'baidu', 'social', 'other'] as const;
export type RefSource = (typeof REF_SOURCES)[number];
// AI 크롤러(nginx가 User-Agent로 분류해 내부 주소로 알린다)
export const CRAWLERS = ['gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-user', 'claude-searchbot', 'perplexitybot', 'perplexity-user', 'google-extended', 'googlebot', 'bingbot', 'applebot', 'bytespider', 'ccbot', 'meta-externalagent', 'other'] as const;
export const CRAWL_KINDS = ['page', 'landing', 'llms', 'sitemap', 'robots', 'other'] as const;
export type Crawler = (typeof CRAWLERS)[number];
export type CrawlKind = (typeof CRAWL_KINDS)[number];

// User-Agent → 크롤러 이름. 사람 브라우저면 null. 순서 중요: 구체적인 것(ChatGPT-User)을 일반(GPTBot)보다 먼저.
// 출처: 각 회사 공개 문서의 UA 토큰(OpenAI·Anthropic·Perplexity·Google·Microsoft·Apple·ByteDance·Common Crawl·Meta)
const CRAWLER_RULES: [Crawler, RegExp][] = [
  ['chatgpt-user', /chatgpt-user/i], ['oai-searchbot', /oai-searchbot/i], ['gptbot', /gptbot/i],
  ['claude-user', /claude-user/i], ['claude-searchbot', /claude-searchbot/i], ['claudebot', /claudebot|anthropic-ai|claude-web/i],
  ['perplexity-user', /perplexity-user/i], ['perplexitybot', /perplexitybot/i],
  ['google-extended', /google-extended/i], ['googlebot', /googlebot|google-inspectiontool/i],
  ['bingbot', /bingbot|bingpreview/i], ['applebot', /applebot/i], ['bytespider', /bytespider/i], ['ccbot', /ccbot/i],
  ['meta-externalagent', /meta-externalagent|facebookbot/i],
];
export function classifyCrawler(ua: string): Crawler | null {
  if (!ua) return null;
  const hit = CRAWLER_RULES.find(([, re]) => re.test(ua));
  if (hit) return hit[0];
  return /bot|crawl|spider|slurp/i.test(ua) ? 'other' : null;
}
// 요청 경로 → 종류(라벨 폭증 방지: 경로 원문은 저장하지 않음)
export function crawlKind(path: string): CrawlKind {
  const p = path.split('?')[0]!.replace(/\/+$/, '') || '/';
  if (p === '/robots.txt') return 'robots';
  if (/^\/sitemap.*\.xml$/.test(p)) return 'sitemap';
  if (/^\/llms(-full)?\.txt$/.test(p)) return 'llms';
  if (/^(\/[a-z]{2})?\/?$/.test(p)) return 'page';
  if (/^(\/[a-z]{2})?\/[a-z0-9]+(-[a-z0-9]+)*$/.test(p)) return 'landing';
  return 'other';
}

// 유입 출처 분류: utm_source가 있으면 그것, 없으면 referrer 도메인
export function classifyReferrer(referrer: string, utmSource?: string | null): RefSource {
  const s = `${utmSource ?? ''} ${referrer}`.toLowerCase();
  if (!s.trim()) return 'direct';
  const rules: [RefSource, RegExp][] = [
    ['chatgpt', /chatgpt|openai/], ['perplexity', /perplexity/], ['claude', /claude\.ai|anthropic/], ['gemini', /gemini|bard/],
    ['copilot', /copilot|bing\.com\/chat|edgeservices/], ['google', /google\./], ['bing', /bing\.com/], ['naver', /naver\./], ['duckduckgo', /duckduckgo/],
    ['yandex', /yandex/], ['baidu', /baidu/], ['social', /facebook|instagram|t\.co|twitter|x\.com|reddit|youtube|threads|linkedin|kakao/],
  ];
  return rules.find(([, re]) => re.test(s))?.[0] ?? 'other';
}

export type { TelemetryEvent } from './schema.ts';

// 지표 이름은 한곳에서만 정의(API 집계, vmalert 규칙, 관리자 화면 쿼리가 같이 쓴다)
export const METRICS = {
  conversions: 'fc_conversions_total',
  duration: 'fc_conversion_duration_seconds',
  inputBytes: 'fc_conversion_input_bytes',
  ratio: 'fc_conversion_size_ratio',
  vitalsMs: 'fc_web_vital_ms', // LCP·INP·FCP·TTFB (밀리초)
  cls: 'fc_web_vital_cls', // CLS는 단위가 없어(0~1) 구간이 달라 따로
  vitalRatings: 'fc_web_vital_ratings_total',
  logPushErrors: 'fc_log_push_errors_total',
  httpDuration: 'fc_api_http_duration_seconds',
  // 알림 전용: 라벨을 줄이고 서버 시작 때 0으로 만들어 둔다. 새로 생긴 시계열의 첫 값은 increase()가
  // 증가로 치지 않아서, '처음 보는 오류가 한꺼번에' 오면 알림이 침묵했다(실제 시험에서 발견, devlog 8절)
  alertConversions: 'fc_alert_conversions_total',
  alertClientErrors: 'fc_alert_client_errors_total',
  clientErrors: 'fc_client_errors_total',
  pageViews: 'fc_page_views_total',
  referrals: 'fc_referrals_total',
  crawls: 'fc_crawler_hits_total',
  telemetry: 'fc_telemetry_events_total',
  buildInfo: 'fc_build_info', // 배포 표시: {component, version} = 1
  probeSuccess: 'fc_probe_success', // 합성 감시 {check} 1/0
  probeSeconds: 'fc_probe_seconds',
} as const;

// 오류 메시지에서 개인정보가 될 만한 것(경로, 파일 이름, 이메일, URL)을 지운다
export function scrubMessage(msg: string): string {
  return msg
    .replace(/[A-Za-z]:\\[^\s'"]+/g, '<path>')
    .replace(/(?:\/[\w.-]+){2,}/g, '<path>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/blob:\S+/g, '<url>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/[^\s'"]+\.(?:jpe?g|png|webp|avif|gif|bmp|heic|psd|svg|pdf|csv|tsv|json|xlsx|ya?ml|zip|mp4|m4v|mov|webm|m4a)\b/gi, '<file>')
    .slice(0, 300);
}

export function formatFromName(name: string): Format {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, Format> = { jpeg: 'jpg', jpg: 'jpg', heif: 'heic', yml: 'yaml', tif: 'other', m4v: 'mp4' };
  const f = (map[ext] ?? ext) as Format;
  return (FORMATS as readonly string[]).includes(f) ? f : 'other';
}
