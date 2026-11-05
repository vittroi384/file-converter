import { defineConfig, devices } from '@playwright/test';

// 엔진 3종: Edge(크로미움), WebKit(사파리 엔진), Firefox. 관리자·모니터링 시험은 Edge에서만.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  // 가끔 실패한 1건을 다시 잡기 위해 결과를 파일로도 남기고, 실패 시 한 번 더 돌려 '불안정'으로 표시
  reporter: [['list'], ['json', { outputFile: 'test-results/last-run.json' }]],
  retries: 1,
  use: { baseURL: 'http://localhost:4173', acceptDownloads: true },
  projects: [
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /admin/ },
    { name: 'iphone', use: { ...devices['iPhone 15'] }, testMatch: /(convert|layout)\.spec/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /admin/ },
  ],
  webServer: { command: 'node apps/web/scripts/serve-local.mjs', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
});
