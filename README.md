# 파일 변환 (file-converter)

사진·PDF·엑셀·영상을 **서버로 보내지 않고** 브라우저 안에서 변환한다. 광고·회원가입 없음.
운영자는 익명 사용 통계(형식·크기·처리 시간만)로 대시보드와 알림을 본다.

라이브: https://localconvert.duckdns.org (Oracle Cloud, DuckDNS + Let's Encrypt, 2026-11 공개). OCI VM 한 대에서 Docker Compose로 운영한다 — [docs/deploy.md](docs/deploy.md).

- 과정 기록: [docs/devlog.md](docs/devlog.md) · 다음 방향: [docs/next-steps.md](docs/next-steps.md)
## 구성
| 폴더 | 내용 |
|---|---|
| apps/web | Vite + React. 변환(워커 풀 + WASM), PWA, 관리자 화면(/admin) |
| apps/api | Fastify. 통계 수신, 관리자 로그인, 지표·로그 조회 중계, 알림 설정 → Alertmanager·vmalert |
| packages/shared | 통계 스키마·지표 이름(웹·API 공용) |
| infra | docker compose: nginx(웹), ssr, api, VictoriaMetrics, VictoriaLogs, vmalert, Alertmanager, Grafana(선택, SSH 터널로만) |
| bench, tools | SSIM·탐색 벤치마크, 픽스처·아이콘 생성, 번들 예산 |

## 명령
```
npm install
npm run dev            # 화면 개발 서버
npm run check          # 타입 검사 + 단위 테스트 + 빌드 + 번들 예산
npx playwright test    # 브라우저 테스트(Edge·WebKit·Firefox·아이폰 화면)

# 전체 스택(비밀값 .env는 프로젝트 밖에 둔다, infra/.env.example 참고)
docker compose -f infra/docker-compose.yml --env-file <경로>/fc.env up -d --build
ADMIN_PW=... node e2e/monitoring.mjs   # 통계→지표→알림 전체 경로 시험(약 7분)
```
