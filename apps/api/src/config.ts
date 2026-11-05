// 환경 변수. 비밀값은 저장소에 두지 않는다(.env는 .gitignore).
import { randomBytes } from 'node:crypto';

const env = process.env;

export interface Config {
  port: number;
  metricsPort: number; // /metrics 전용(내부망). 외부에 열지 않는다
  host: string;
  adminPasswordHash: string; // scrypt$salt$hash (tools/hash-password.ts로 생성)
  sessionSecret: string;
  secureCookie: boolean;
  victoriaMetricsUrl: string;
  victoriaLogsUrl: string;
  vmalertUrl: string;
  alertmanagerUrl: string;
  dataDir: string; // 알림 설정 저장 위치
  rulesFile: string; // vmalert가 읽는 규칙 파일(공유 볼륨)
  alertmanagerFile: string; // Alertmanager가 읽는 설정 파일(공유 볼륨)
  publicUrl: string;
  trustProxy: boolean | number; // 숫자 = API 앞 프록시 겹수(nginx + Cloudflare/Caddy = 2). true는 맨 왼쪽 XFF(위조 가능)를 믿는다
  probeUrl: string; // 합성 감시가 열어 볼 주소(비우면 끔). compose에선 http://web:8080
  grafanaCtlDir: string; // 그라파나 켜기·끄기 공유 폴더(want·seen은 API가, state는 호스트의 infra/grafana-ctl이 쓴다)
}

export function loadConfig(over: Partial<Config> = {}): Config {
  return {
    port: Number(env.PORT ?? 8787),
    metricsPort: Number(env.METRICS_PORT ?? 9464),
    host: env.HOST ?? '0.0.0.0',
    adminPasswordHash: env.ADMIN_PASSWORD_HASH ?? '',
    // 비밀이 없으면 실행마다 새로 만든다(재시작하면 로그인이 풀림 — 운영에선 꼭 지정)
    sessionSecret: env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    secureCookie: env.SECURE_COOKIE !== 'false',
    victoriaMetricsUrl: env.VM_URL ?? 'http://localhost:8428',
    victoriaLogsUrl: env.VLOGS_URL ?? 'http://localhost:9428',
    vmalertUrl: env.VMALERT_URL ?? 'http://localhost:8880',
    alertmanagerUrl: env.ALERTMANAGER_URL ?? 'http://localhost:9093',
    dataDir: env.DATA_DIR ?? './data',
    rulesFile: env.RULES_FILE ?? './data/rules/fc.rules.yml',
    alertmanagerFile: env.ALERTMANAGER_FILE ?? './data/alertmanager/alertmanager.yml',
    publicUrl: env.PUBLIC_URL ?? 'http://localhost:4173',
    trustProxy: /^\d+$/.test(env.TRUST_PROXY ?? '') ? Number(env.TRUST_PROXY) : env.TRUST_PROXY === 'true',
    probeUrl: env.PROBE_URL ?? '',
    grafanaCtlDir: env.GRAFANA_CTL_DIR ?? './data/grafana-ctl',
    ...over,
  };
}
