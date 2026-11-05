// 관리자 API 호출. 상태를 바꾸는 요청엔 x-requested-with를 붙인다(서버가 다른 사이트발 요청을 막는 표시).
export class ApiError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-requested-with': 'fc-admin' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (j as { error?: string }).error ?? `오류 ${res.status}`);
  return j as T;
}

export type Range = '1h' | '24h' | '7d' | '30d';
export interface Series { metric: Record<string, string>; values?: [number, string][]; value?: [number, string] }
export interface PanelData { kind: 'range' | 'instant'; result?: Series[]; error?: string }
export interface RuleInfo { id: string; title: string; desc: string; severity: string; unit: string; min: number; max: number }
export interface Settings {
  rules: Record<string, { enabled: boolean; threshold: number; for: string }>;
  channels: {
    telegram: { enabled: boolean; botToken: string; chatId: string };
    discord: { enabled: boolean; webhookUrl: string };
    email: { enabled: boolean; smarthost: string; from: string; to: string; username: string; password: string };
    webhook: { enabled: boolean; url: string };
    deadman: { enabled: boolean; url: string };
  };
  quietHours: { enabled: boolean; start: string; end: string };
  repeatHours: number;
}
export interface AlertsState {
  firing: { labels: Record<string, string>; annotations: Record<string, string>; startsAt: string }[];
  rules: { id: string; state: string; health?: string; lastError?: string }[];
  silences: { id: string; alertname?: string; endsAt: string }[];
  reachable: { alertmanager: boolean; vmalert: boolean };
}
// state는 서버의 infra/grafana-ctl이 쓴다. watcher=false면 그 스크립트가 멈춰 있다
export interface GrafanaState { want: 'on' | 'off'; state: 'off' | 'starting' | 'on' | 'stopping'; seen: number; idleOffAt: number | null; watcher: boolean }
export interface LogItem { _time: string; _msg: string; where?: string; code?: string; browser?: string; device?: string; level?: string; source?: string }

export const api = {
  me: () => call<{ authed: boolean }>('GET', '/api/admin/me'),
  login: (password: string) => call<{ ok: true }>('POST', '/api/admin/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/api/admin/logout', {}),
  panels: (range: Range) => call<{ panels: Record<string, PanelData> }>('GET', `/api/admin/panels?range=${range}`),
  logs: (q: string, hours: number) => call<{ items: LogItem[]; error?: string }>('GET', `/api/admin/logs?q=${encodeURIComponent(q)}&hours=${hours}&limit=200`),
  alerts: () => call<AlertsState>('GET', '/api/admin/alerts'),
  settings: () => call<{ settings: Settings; rules: RuleInfo[] }>('GET', '/api/admin/settings'),
  saveSettings: (s: Settings) => call<{ ok: true; settings: Settings }>('PUT', '/api/admin/settings', s),
  testNotify: () => call<{ ok: true; note: string }>('POST', '/api/admin/notify/test', {}),
  silence: (alertname: string, hours: number) => call<{ ok: true }>('POST', '/api/admin/silence', { alertname, hours }),
  grafana: () => call<GrafanaState>('GET', '/api/admin/grafana'),
  setGrafana: (on: boolean) => call<GrafanaState>('POST', '/api/admin/grafana', { on }),
};
