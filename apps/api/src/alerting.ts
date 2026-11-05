// 알림 설정(관리자 화면에서 편집) → vmalert 규칙 파일 + Alertmanager 설정 파일.
// 알림은 Alertmanager가 채널로 '직접' 보낸다 → API가 죽어도 'API 다운' 알림은 간다.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stringify } from 'yaml';
import { z } from 'zod';
import { METRICS as M } from '@fc/shared';

export type Severity = 'critical' | 'warning' | 'info';
export interface RuleDef {
  id: string;
  title: string; // 한국어 제목(알림 문구)
  desc: string;
  severity: Severity;
  unit: string;
  defaults: { enabled: boolean; threshold: number; for: string };
  min: number;
  max: number;
  expr: (threshold: number) => string;
}

// 최소 사용량 조건: 변환이 거의 없을 때 1건 실패로 '성공률 0%' 알림이 울리지 않게
const enoughTraffic = `sum(increase(${M.alertConversions}[15m])) >= 10`;

// SLO 오류 예산 소진 속도(구글 SRE 워크북의 다중 창 방식). 기준값 = 30일 성공률 목표(%), 예산 = 1 − 목표.
// 소진 속도 14.4 = 그대로 가면 30일 예산을 약 2일에 다 쓴다(긴 창 1시간 + 짧은 창 5분이 둘 다 넘어야: 이미 회복됐으면 안 울림)
// 소진 속도 6 = 약 5일(6시간 + 30분). 적은 사용량에서 1건 실패로 울리지 않게 최소 건수 조건.
const errRatio = (w: string) => `(sum(increase(${M.alertConversions}{result="error"}[${w}])) / sum(increase(${M.alertConversions}[${w}])))`;
const burn = (slo: number, rate: number, long: string, short: string, minCount: number) => {
  const limit = (rate * (100 - slo) / 100).toFixed(5);
  return `${errRatio(long)} > ${limit} and on() ${errRatio(short)} > ${limit} and on() (sum(increase(${M.alertConversions}[${long}])) >= ${minCount})`;
};

export const RULES: RuleDef[] = [
  { id: 'ApiDown', title: 'API 서버 응답 없음', desc: '지표 수집이 끊겼어요. 서버가 죽었거나 네트워크 문제예요.', severity: 'critical', unit: '분',
    defaults: { enabled: true, threshold: 2, for: '0s' }, min: 1, max: 30,
    expr: () => `up{job="api"} == 0` },
  { id: 'ConversionSuccessLow', title: '변환 성공률 낮음', desc: '최근 15분 성공률이 기준보다 낮아요(변환 10건 이상일 때만).', severity: 'warning', unit: '%',
    defaults: { enabled: true, threshold: 90, for: '15m' }, min: 50, max: 99.9,
    expr: t => `(sum(rate(${M.alertConversions}{result="ok"}[15m])) / sum(rate(${M.alertConversions}[15m]))) * 100 < ${t} and on() (${enoughTraffic})` },
  { id: 'SloBurnFast', title: '오류 예산 빠르게 소진', desc: '이 속도면 한 달 실패 허용치를 약 2일에 다 써요(1시간·5분 둘 다). 기준값은 30일 성공률 목표예요.', severity: 'critical', unit: '% 목표',
    defaults: { enabled: true, threshold: 99, for: '2m' }, min: 95, max: 99.99,
    expr: t => burn(t, 14.4, '1h', '5m', 20) },
  { id: 'SloBurnSlow', title: '오류 예산 천천히 소진', desc: '이 속도면 한 달 실패 허용치를 약 5일에 다 써요(6시간·30분 둘 다).', severity: 'warning', unit: '% 목표',
    defaults: { enabled: true, threshold: 99, for: '15m' }, min: 95, max: 99.99,
    expr: t => burn(t, 6, '6h', '30m', 50) },
  { id: 'ConversionSlow', title: '변환이 느려짐', desc: '처리 시간 상위 5%(p95)가 기준보다 길어요.', severity: 'warning', unit: '초',
    defaults: { enabled: true, threshold: 20, for: '30m' }, min: 1, max: 300,
    expr: t => `histogram_quantile(0.95, sum(rate(${M.duration}_bucket[30m])) by (le)) > ${t}` },
  { id: 'ClientErrorSpike', title: '브라우저 오류 급증', desc: '10분 동안 브라우저 오류가 기준보다 많아요. 배포 직후라면 새 버전 문제일 수 있어요.', severity: 'warning', unit: '건/10분',
    defaults: { enabled: true, threshold: 20, for: '0s' }, min: 1, max: 10000,
    expr: t => `sum(increase(${M.alertClientErrors}[10m])) > ${t}` },
  { id: 'TelemetryRejected', title: '통계 거부 급증', desc: '형식이 틀린 통계가 많아요. 공격이거나, 화면 새 버전과 서버 스키마가 어긋났어요.', severity: 'warning', unit: '%',
    defaults: { enabled: true, threshold: 30, for: '15m' }, min: 1, max: 100,
    expr: t => `(sum(rate(${M.telemetry}{result="rejected"}[15m])) / sum(rate(${M.telemetry}[15m]))) * 100 > ${t}` },
  { id: 'SlowFirstPaint', title: '첫 화면이 느림', desc: '방문자 75%가 겪는 LCP(가장 큰 요소 표시 시간)가 기준보다 길어요.', severity: 'warning', unit: 'ms',
    defaults: { enabled: true, threshold: 4000, for: '1h' }, min: 500, max: 20000,
    expr: t => `histogram_quantile(0.75, sum(rate(${M.vitalsMs}_bucket{name="LCP"}[1h])) by (le)) > ${t}` },
  { id: 'LogPushFailing', title: '오류 로그 저장 실패', desc: 'VictoriaLogs로 오류 로그를 못 보내고 있어요.', severity: 'warning', unit: '건/10분',
    defaults: { enabled: true, threshold: 0, for: '10m' }, min: 0, max: 1000,
    expr: t => `sum(increase(${M.logPushErrors}[10m])) > ${t}` },
  { id: 'ProbeFailing', title: '사이트 점검 실패', desc: '1분마다 사이트를 직접 열어 보는 점검(첫 화면·보안 머리글·안내 페이지·SSR·API·llms.txt) 중 하나가 기준 시간 넘게 실패해요.', severity: 'critical', unit: '분',
    defaults: { enabled: true, threshold: 3, for: '3m' }, min: 1, max: 60,
    expr: () => `min(${M.probeSuccess}) == 0` },
  { id: 'NoTraffic', title: '방문이 끊김', desc: '기준 시간 동안 방문이 0이에요. 사이트 주소·DNS·인증서 문제일 수 있어요.', severity: 'info', unit: '시간',
    defaults: { enabled: false, threshold: 6, for: '0s' }, min: 1, max: 72,
    expr: t => `sum(increase(${M.pageViews}[${Math.round(t)}h])) == 0` },
];

// ApiDown·ProbeFailing의 기준값은 '몇 분'이므로 for로 쓴다
const forOf = (r: RuleDef, s: RuleSetting) => (r.id === 'ApiDown' || r.id === 'ProbeFailing' ? `${Math.round(s.threshold)}m` : s.for);

const RuleSetting = z.object({ enabled: z.boolean(), threshold: z.number(), for: z.string().regex(/^\d+[smh]$/) });
type RuleSetting = z.infer<typeof RuleSetting>;

export const Settings = z.object({
  rules: z.record(z.string(), RuleSetting),
  channels: z.object({
    telegram: z.object({ enabled: z.boolean(), botToken: z.string().max(200), chatId: z.string().max(50) }),
    discord: z.object({ enabled: z.boolean(), webhookUrl: z.string().max(500) }),
    email: z.object({ enabled: z.boolean(), smarthost: z.string().max(200), from: z.string().max(200), to: z.string().max(500), username: z.string().max(200), password: z.string().max(200) }),
    webhook: z.object({ enabled: z.boolean(), url: z.string().max(500) }),
    // 외부 생존 신호(dead man's switch): 1분마다 '살아 있음'을 이 주소로. 끊기면 그쪽 서비스가 알려 준다
    deadman: z.object({ enabled: z.boolean(), url: z.string().max(500) }),
  }),
  quietHours: z.object({ enabled: z.boolean(), start: z.string().regex(/^\d\d:\d\d$/), end: z.string().regex(/^\d\d:\d\d$/) }),
  repeatHours: z.number().min(1).max(72),
});
export type Settings = z.infer<typeof Settings>;

export function defaultSettings(): Settings {
  return {
    rules: Object.fromEntries(RULES.map(r => [r.id, { ...r.defaults }])),
    channels: {
      telegram: { enabled: false, botToken: '', chatId: '' },
      discord: { enabled: false, webhookUrl: '' },
      email: { enabled: false, smarthost: '', from: '', to: '', username: '', password: '' },
      webhook: { enabled: false, url: '' },
      deadman: { enabled: false, url: '' },
    },
    quietHours: { enabled: true, start: '00:00', end: '08:00' },
    repeatHours: 4,
  };
}

// 비밀값은 화면으로 보낼 때 가린다. 가려진 값이 그대로 돌아오면 기존 값을 유지한다.
export const MASK = '••••••';
const SECRET_KEYS: [keyof Settings['channels'], string][] = [['telegram', 'botToken'], ['discord', 'webhookUrl'], ['email', 'password'], ['webhook', 'url'], ['deadman', 'url']];
export function maskSecrets(s: Settings): Settings {
  const c = structuredClone(s);
  for (const [ch, k] of SECRET_KEYS) { const o = c.channels[ch] as Record<string, unknown>; if (o[k]) o[k] = MASK; }
  return c;
}
export function mergeSecrets(incoming: Settings, current: Settings): Settings {
  const c = structuredClone(incoming);
  for (const [ch, k] of SECRET_KEYS) {
    const o = c.channels[ch] as Record<string, unknown>;
    if (o[k] === MASK) o[k] = (current.channels[ch] as Record<string, unknown>)[k];
  }
  return c;
}

export function validateSettings(s: Settings): string[] {
  const errs: string[] = [];
  for (const r of RULES) {
    const v = s.rules[r.id];
    if (!v) { errs.push(`${r.title}: 설정 없음`); continue; }
    if (v.threshold < r.min || v.threshold > r.max) errs.push(`${r.title}: 기준값은 ${r.min}~${r.max}${r.unit}`);
  }
  const ch = s.channels;
  if (ch.telegram.enabled && (!/^\d+:[\w-]{20,}$/.test(ch.telegram.botToken) || !/^-?\d+$/.test(ch.telegram.chatId))) errs.push('텔레그램: 봇 토큰(숫자:문자) 또는 채팅 ID(숫자)가 이상해요');
  if (ch.discord.enabled && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(ch.discord.webhookUrl)) errs.push('디스코드: 웹훅 주소가 이상해요');
  if (ch.webhook.enabled && !/^https?:\/\//.test(ch.webhook.url)) errs.push('웹훅: 주소가 http(s)로 시작해야 해요');
  if (ch.deadman.enabled && !/^https?:\/\//.test(ch.deadman.url)) errs.push('생존 신호: 주소가 http(s)로 시작해야 해요');
  if (ch.email.enabled && (!/^[\w.-]+:\d+$/.test(ch.email.smarthost) || !ch.email.to.includes('@') || !ch.email.from.includes('@'))) errs.push('이메일: 서버(호스트:포트)·보내는/받는 주소를 확인해 주세요');
  return errs;
}

export function renderRules(s: Settings) {
  // 생존 신호(Watchdog)는 사람에게 가는 등급이 아니라 severity 'none' → 목록 타입을 넓힌다
  const rules: { alert: string; expr: string; for: string; labels: Record<string, string>; annotations: Record<string, string> }[] = RULES.filter(r => s.rules[r.id]?.enabled).map(r => {
    const v = s.rules[r.id]!;
    return {
      alert: r.id,
      expr: r.expr(v.threshold),
      for: forOf(r, v),
      labels: { severity: r.severity },
      annotations: { title: r.title, description: `${r.desc} (기준 ${v.threshold}${r.unit}, 현재 {{ $value | humanize }})` },
    };
  });
  // 생존 신호: 늘 울리는 알림. 지표 수집 → 규칙 평가 → 알림 전송 경로를 전부 거치므로 어느 하나만 멈춰도 바깥에서 끊긴 걸 안다
  if (s.channels.deadman.enabled) rules.push({ alert: 'Watchdog', expr: 'vector(1)', for: '0s', labels: { severity: 'none' }, annotations: { title: '생존 신호', description: '서버 감시 경로가 살아 있음' } });
  return '# 자동 생성(관리자 화면 → API). 손으로 고치면 다음 저장 때 덮어써진다.\n' + stringify({ groups: [{ name: 'file-converter', interval: '1m', rules }] });
}

// Alertmanager 알림 문구(한국어). Go 템플릿.
const TEXT = `{{ range .Alerts }}{{ if eq .Status "firing" }}🔴{{ else }}✅ 해결{{ end }} [{{ .Labels.severity }}] {{ .Annotations.title }}
{{ .Annotations.description }}
{{ end }}`;

export function renderAlertmanager(s: Settings, publicUrl: string) {
  const ch = s.channels;
  const receiver: Record<string, unknown> = { name: 'main' };
  if (ch.telegram.enabled) receiver.telegram_configs = [{ bot_token: ch.telegram.botToken, chat_id: Number(ch.telegram.chatId), message: TEXT, parse_mode: '', send_resolved: true }];
  if (ch.discord.enabled) receiver.discord_configs = [{ webhook_url: ch.discord.webhookUrl, title: '파일 변환 알림', message: TEXT, send_resolved: true }];
  if (ch.webhook.enabled) receiver.webhook_configs = [{ url: ch.webhook.url, send_resolved: true }];
  if (ch.email.enabled) receiver.email_configs = [{ to: ch.email.to, from: ch.email.from, smarthost: ch.email.smarthost, auth_username: ch.email.username, auth_password: ch.email.password, headers: { Subject: '[파일 변환] {{ .CommonAnnotations.title }}' }, text: TEXT, send_resolved: true }];
  const quiet = s.quietHours.enabled;
  const config: Record<string, unknown> = {
    route: {
      receiver: 'main',
      group_by: ['alertname'],
      group_wait: '30s',
      group_interval: '5m',
      repeat_interval: `${s.repeatHours}h`,
      routes: [
        // 생존 신호는 사람에게 보내지 않고 바깥 감시 주소로만, 1분마다(방해 금지 시간과 무관)
        // repeat를 group_interval(1m)과 같게 두면 확인 순간 경과가 59.9초라 한 번 건너뛰어 실제로는 2분 간격이었다(e2e/deadman.mjs 실측) → 30초
        ...(ch.deadman.enabled ? [{ receiver: 'deadman', matchers: ['alertname="Watchdog"'], group_wait: '0s', group_interval: '1m', repeat_interval: '30s' }] : []),
        // 긴급은 방해 금지 시간에도 보낸다
        { receiver: 'main', matchers: ['severity="critical"'], repeat_interval: '1h' },
        { receiver: 'main', matchers: ['severity=~"warning|info"'], ...(quiet ? { mute_time_intervals: ['quiet'] } : {}) },
      ],
    },
    receivers: [receiver, ...(ch.deadman.enabled ? [{ name: 'deadman', webhook_configs: [{ url: ch.deadman.url, send_resolved: false }] }] : [])],
    ...(quiet ? { time_intervals: [{ name: 'quiet', time_intervals: [{ times: [{ start_time: s.quietHours.start, end_time: s.quietHours.end }], location: 'Asia/Seoul' }] }] } : {}),
  };
  return `# 자동 생성(관리자 화면 → API). 외부 주소: ${publicUrl}\n` + stringify(config);
}

export async function loadSettings(file: string): Promise<Settings> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    const def = defaultSettings();
    // 새 규칙이 추가돼도 옛 설정 파일이 깨지지 않게 기본값과 합친다
    return Settings.parse({ ...def, ...raw, rules: { ...def.rules, ...raw.rules }, channels: { ...def.channels, ...raw.channels } });
  } catch {
    return defaultSettings();
  }
}

export async function writeAtomic(file: string, content: string) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, file); // 읽는 쪽이 반쯤 쓴 파일을 보지 않게
}

export async function readOr(file: string, fallback = ''): Promise<string> {
  try { return await readFile(file, 'utf8'); } catch { return fallback; }
}
