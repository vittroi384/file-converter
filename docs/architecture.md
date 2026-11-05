# LocalConvert 구조

파일을 서버로 보내지 않는 변환기다. 변환은 전부 브라우저 탭 안(Web Worker + WebAssembly)에서 일어나고, 서버는 페이지를 내주고 익명 숫자(통계)를 받아 모니터링·알림에 쓴다.

그림은 `docs/diagrams/*.png`(GetQRMaker 아키텍처 그림과 같은 문법). 원본은 `tools/arch/*.html` + `arch.css`, `node tools/arch/render.mjs`로 다시 그린다. 예전 Mermaid판은 `docs/diagrams/mermaid/`.

| 그림 | 내용 |
|---|---|
| [01 시스템 구성도](diagrams/01-system.png) | 기기(화면·풀·워커)와 서버(nginx·SSR·API·VictoriaMetrics·Logs·vmalert·Alertmanager) |
| [02 데이터 모델(ERD)](diagrams/02-data-model.png) | 통계 이벤트 → 지표 시계열·로그, 알림 설정 → 규칙·AM 파일 |
| [03 변환 흐름](diagrams/03-convert-flow.png) | 파일 놓기 → 옵션 검사 → 비용·한도 → 풀 입장 → 워커 → 결과 → 통계 |
| [04 요청 경로](diagrams/04-request-routing.png) | nginx: 봇 복제 · 정적 · 구운 HTML · SSR 캐시 · 언어 이동 · 장애 시 |
| [05 알림 흐름](diagrams/05-alert-flow.png) | 감지 → 판단(vmalert) → 전달(Alertmanager) → 채널 |
| [06 배포 구성](diagrams/06-deploy.png) | compose 서비스·포트·메모리 상한·볼륨, 한 Dockerfile에서 두 이미지 |
| [07 스마트 압축](diagrams/07-smart-compress.png) | 보통 크기 탐색(v5)과 큰 사진 모자이크 탐색, 원본 유지 조건 |
| Grafana (그림 없음) | `infra/grafana/`: VictoriaMetrics·VictoriaLogs를 읽는 대시보드 5개(개요·유입·SLO·체감 성능·로그), 127.0.0.1:3002, SSH 터널로만 연다([배포](deploy.md)) |
| [08 목표 구성 · OCI](diagrams/08-target-oci.png) | 확장 설계(미적용, 지금은 OCI VM 한 대 + compose로 운영 중): Cloudflare → Ampere VM(compose 그대로) + Object Storage 백업·Vault·OCIR·CI 배포 — `docs/cloud-target.md` |
| [09 목표 구성 · AWS](diagrams/09-target-aws.png) | 이전 대비 설계(미적용): Route 53·CloudFront·ACM·WAF → EC2(compose) + S3·Secrets Manager·ECR·OIDC 배포 |

## 데이터 모델에 대해

관계형 DB는 없다. ERD 표기는 "무엇이 무엇으로 바뀌어 어디에 남는가"를 보이려고 썼다.

- 브라우저가 보내는 것: `TelemetryBatch { v: 1, events[1~50] }`. 이벤트는 4종(`conv`·`vital`·`err`·`pv`)이고 값은 전부 허용 목록(enum)이나 범위 있는 숫자다. 파일 이름·내용은 스키마에 자리가 없다. 오류 메시지는 경로·이름·메일·URL을 지운 300자.
- 서버가 남기는 것: 이벤트 → Prometheus 지표(VictoriaMetrics, 90일), 브라우저 오류 → VictoriaLogs(30일), 관리자 설정 → `alert-settings.json` + 거기서 만든 `fc.rules.yml`·`alertmanager.yml`.
- 라벨이 폭증하지 않게: 경로 원문 대신 종류(`page`·`landing`·`llms`…), User-Agent 원문 대신 브라우저 6종·기기 2종·봇 16종.

## 변환기 플러그인 계약

`apps/web/src/core/plugin.ts`(계약), `core/plugins.ts`(등록부). 작업 하나 = 명세 하나.

| 항목 | 뜻 |
|---|---|
| `inputs` | 받는 형식 |
| `outputs(options)` | 이 옵션이면 나오는 형식 |
| `arity` | 파일 하나씩 / 여러 개를 하나로 |
| `validate(options)` | 범위·허용값 검사, 기본값 채움, 모르는 키 버림. 화면과 워커가 두 번 부른다 |
| `cost(inputs, options)` | 예상 메모리(바이트). 풀 입장과 '너무 큰 파일' 판단에 쓴다. 크기 줄이기를 고르면 줄어든다 |
| `timeoutMs(inputs, options)` | 선택. 워커 시간 초과(없으면 풀 기본 5분). 영상은 파일 크기에 맞춰 최대 30분 |
| `load()` | 무거운 실행부(WASM)를 쓸 때만 불러온다 |

`plugins-contract.test.ts`가 화면의 모든 동작 × 모든 선택지 × 대표 파일로 만든 실제 옵션이 검사를 통과하는지 본다(손으로 만든 옵션만 시험하다 '자동' 형식을 놓친 적이 있다 — devlog 15절).

## 설계 패턴과 코드 위치

| 패턴 | 어디에 | 왜 |
|---|---|---|
| 전략(Strategy) | `core/plugins.ts` 작업별 플러그인, `ops/codecs.ts` 디코더(브라우저 내장 ↔ WASM) | 형식·환경마다 다른 방법을 같은 모양으로 갈아 끼운다 |
| 등록부 + 지연 로딩(Registry, lazy plugin) | `pluginById` + `load()` | 첫 화면 JS 예산(90KB) 안에 머물면서 작업은 계속 늘린다 |
| 어댑터(Adapter) | `ops/pdf.ts` `OffscreenFactory`(pdf.js 캔버스 공장), `codecs.ts` `decodeWasm`·`decodeNative` | 워커·사파리처럼 API가 다른 환경을 같은 인터페이스로 |
| 퍼사드(Facade) | `core/client.ts` `convert()` | 화면은 함수 하나만 안다(검사·비용·풀·결과·통계는 안쪽) |
| 객체 풀 + 격벽(Object Pool, Bulkhead) | `core/pool.ts` `WorkerPool`, PDF 압축의 하위 풀 | 워커 재사용, 한 작업이 죽어도 그 워커만 버리고 새로 |
| 입장 제어(Admission control) | `WorkerPool` 메모리 예산, `client.ts` 기기 한도 | 동시에 너무 많이·너무 크게 돌려 탭이 꺼지는 것을 막는다 |
| 명령(Command) | `CommandPalette.tsx`, `registerCommands` | 화면 기능을 이름 붙은 명령으로 모아 Ctrl+K에서 실행 |
| 관찰자(Observer) | 진행률 콜백(`onProgress`), web-vitals 보고 | 워커 → 풀 → 화면으로 상태를 흘려보낸다 |
| 템플릿·빌더(Template, Builder) | `i18n/landing.generic.ts` `fromPack`, `landings.ts` | 언어 8개는 짧은 묶음(pack)에서 안내 페이지 문구를 찍어 낸다 |
| 의존성 주입(DI) | `apps/api/src/server.ts` `buildServer(cfg, deps)` | 시험에서 VictoriaMetrics·Alertmanager를 가짜 fetch로 바꾼다 |
| 우아한 성능 저하(Graceful degradation) | 사파리 대체 경로, SSR 장애 시 캐시·정적 404, 스크롤 장면의 정적 그림 | 기능이 없거나 죽은 부분이 있어도 핵심은 돈다 |
| 묶음 전송(Batching) | `telemetry.ts` 큐(20개 또는 5초), 닫을 때 `sendBeacon`, 실패하면 `fetch(keepalive)`로 한 번 | 요청 수를 줄인다. **재시도는 없다**(통계가 일부 빠져도 괜찮은 자료라서) |
| 되돌리기(Rollback) | `PUT /api/admin/settings` | 새 설정 적용(reload)이 실패하면 이전 파일로 되돌리고 다시 reload |
| 하이드레이션(Hydration) | `entry-client.tsx` `hydrateRoot` | 구운 HTML·SSR 결과 위에 같은 React 트리를 붙인다 |

## 렌더링

- SSG: `scripts/prerender.mjs`가 10개 언어 × (첫 화면 + 안내 27쪽) = 280쪽을 React 19 `prerenderToNodeStream`으로 굽는다. 사이트맵 470주소, `llms.txt`·`llms-full.txt`, `.gz`·`.br`.
- SSR: 목록에 없는 변환 조합(`/ja/avif-to-png` 등)과 404는 `scripts/ssr-server.mjs`가 `renderToPipeableStream`으로 그린다. nginx가 200은 하루, 404는 10분 캐시하고 만료 뒤 일주일은 옛 것을 주며 뒤에서 갱신.
- 언어: '/'에 처음 온 사람(언어 쿠키 없음·봇 아님)은 SSR 서버가 Accept-Language q값으로 고른 언어 주소로 302. 영어면 정적 첫 화면을 그대로(X-Accel-Redirect).
- 브로틀리(`.br`)는 nginx 공식 이미지에 모듈이 없어 지금은 `.gz`만 쓴다.

## 알림 규칙 (11개 + 생존 신호)

`apps/api/src/alerting.ts` `RULES`. 기준값·켜기/끄기는 관리자 화면에서 바꾸고, 저장하면 규칙 파일을 다시 써서 vmalert·Alertmanager가 다시 읽는다(실패하면 이전 설정 복구).

| 규칙 | 등급 | 뜻 |
|---|---|---|
| ApiDown | critical | 지표 수집이 N분 끊김 |
| 오류 예산 빠른 소진 | critical | 30일 성공률 목표(기본 99%) 기준, 1시간·5분 둘 다 소진 속도 14.4배 이상(그대로면 약 2일에 예산 소진) |
| 사이트 점검 실패 | critical | 1분마다 직접 여는 점검(첫 화면·CSP/COEP·안내 페이지·SSR·API·llms.txt) 중 하나가 N분 실패 |
| 오류 예산 느린 소진 | warning | 6시간·30분 둘 다 6배 이상(약 5일) |
| 변환 성공률 낮음 | warning | 15분 성공률 < 기준(10건 이상일 때) |
| 변환이 느려짐 | warning | p95 처리 시간 > 기준 |
| 브라우저 오류 급증 | warning | 10분 오류 수 > 기준 |
| 통계 거부 급증 | warning | 거부 비율 > 기준 |
| 첫 화면이 느림 | warning | LCP p75 > 기준 |
| 오류 로그 저장 실패 | warning | VictoriaLogs 전송 실패 |
| 방문이 끊김 | info(기본 꺼짐) | N시간 방문 0 |
| Watchdog | — | 늘 울림. 외부 생존 신호 주소로만 1분마다(사람에게 안 감) |

critical은 방해 금지 시간에도 오고 1시간마다 다시 온다. 소진 속도 규칙은 VictoriaMetrics에 실제로 질의해 식이 계산되는지, 목표를 올리면(99.5%) 울리는지 확인했다(devlog 21절).

## 단계별 장애와 대응

| 무엇이 죽나 | 어떻게 되나 | 확인 |
|---|---|---|
| 변환 워커 | 그 작업만 실패, 워커 새로 만들어 다음 작업 계속 | `pool.test.ts` |
| 큰 파일로 메모리 부족 위험 | 시작 전 '약 X 필요, 한도 Y' 안내. 크기 줄이기를 고르면 진행 | e2e '메모리 작은 기기' |
| SSR 서버 | 캐시된 페이지는 계속, 없는 주소는 정적 404, '/'는 영어 첫 화면 | `e2e/stack.mjs` |
| API | 변환은 그대로(서버 불필요). 통계만 빠짐. `ApiDown` 알림 | `monitoring.mjs` |
| vmalert가 규칙 없이 시작 | API 건강 확인 뒤 시작 + 30초마다 규칙 다시 읽기 | devlog 8절 |
| 알림 설정 적용 실패 | 이전 설정으로 되돌리고 화면에 이유 | `server.test.ts` |
| 서버 전체 · 감시 경로 일부 | 1분마다 바깥 주소로 보내던 생존 신호가 끊겨 바깥 서비스가 알린다(관리자 화면에 주소만 넣으면 켜짐) | `e2e/deadman.mjs` |

## 개인정보

- 파일 바이트는 탭 밖으로 나가지 않는다. CSP `connect-src 'self'`로 브라우저가 다른 서버 연결을 막는다.
- 결과 파일에 위치 정보(GPS)·카메라 정보를 남기지 않는다. 다시 인코딩하면 원래 없어지고, 원본 바이트를 쓰는 경로(압축 결과가 커서 원본 유지, 사진 → PDF)는 `ops/strip.ts`로 지운다(devlog 19절).
- 통계는 숫자와 허용 목록 값만. 시험(`convert.spec.ts` afterEach)이 통계에 파일 이름·내용이 섞이면 실패한다.
