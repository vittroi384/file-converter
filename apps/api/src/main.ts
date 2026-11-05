import { loadConfig } from './config.ts';
import { buildServer, buildMetricsServer } from './server.ts';
import { loadSettings, renderRules, renderAlertmanager, writeAtomic } from './alerting.ts';
import { join } from 'node:path';
import { createProber } from './prober.ts';

const cfg = loadConfig();
if (!cfg.adminPasswordHash) console.warn('[경고] ADMIN_PASSWORD_HASH가 없어 관리자 로그인이 막혀 있어요. node tools/hash-password.ts 로 만드세요.');

// 켤 때마다 설정(JSON, 원본)에서 규칙·Alertmanager 설정을 다시 만든다.
// 처음엔 '없을 때만' 만들어서, 규칙 수식을 고쳐 배포해도 옛 수식이 계속 쓰였다(시험 중 발견).
const settings = await loadSettings(join(cfg.dataDir, 'alert-settings.json'));
await writeAtomic(cfg.rulesFile, renderRules(settings));
await writeAtomic(cfg.alertmanagerFile, renderAlertmanager(settings, cfg.publicUrl));

const { app, metrics, logs } = await buildServer(cfg);
const metricsApp = await buildMetricsServer(metrics);
await app.listen({ port: cfg.port, host: cfg.host });
await metricsApp.listen({ port: cfg.metricsPort, host: cfg.host });
console.log(`API :${cfg.port}, 지표 :${cfg.metricsPort}`);
if (cfg.probeUrl) { createProber(metrics.registry, cfg.probeUrl.replace(/\/$/, '')).start(); console.log(`합성 감시: ${cfg.probeUrl}`); }

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await logs.flush();
    await Promise.all([app.close(), metricsApp.close()]);
    process.exit(0);
  });
}
