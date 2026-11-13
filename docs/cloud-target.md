# 클라우드 목표 구성 (확장·이전 대비 설계 · 미적용)

지금은 OCI VM 한 대에서 Docker Compose로 운영 중이다(HTTPS는 Cloudflare, 같은 서버의 Caddy가 넘겨줌, [배포](deploy.md)). 이 문서는 그 위에 OCI 관리형 서비스를 붙이는 확장과, AWS로 옮길 때를 대비한 목표 모습이다. 둘 다 아직 적용하지 않았다.

그림: [08 목표 구성 · OCI](diagrams/08-target-oci.png) · [09 목표 구성 · AWS](diagrams/09-target-aws.png) (원본 `tools/arch/08-target-oci.html`·`09-target-aws.html`, `node tools/arch/render.mjs 08 09`). 그림에서 점선 테두리 + '새로' 표시가 새로 붙일 것, 실선은 지금 있는 것이다.

기본 방침: 지금의 Docker Compose 묶음(web·ssr·api·VictoriaMetrics·VictoriaLogs·vmalert·Alertmanager·Grafana)은 VM 한 대에 그대로 올리고, 바깥(CDN 캐시·백업 보관·비밀값·이미지 저장소·배포 방식)만 바꾼다. 원본은 nginx 하나로 둔다. 언어 이동(`/`), SSG 페이지가 없을 때 SSR로 넘기기, 보안 머리글을 nginx가 이미 하고 있어서, 이것을 CDN 쪽 규칙으로 옮기는 건 확장 단계로 미룬다.

## 역할 대응표

| 역할 | 지금(OCI VM 운영 중) | OCI 확장 | AWS |
|---|---|---|---|
| DNS | Cloudflare(다른 프로젝트 도메인의 하위 주소) | 자기 도메인 + Cloudflare(또는 OCI DNS) | Route 53(또는 Cloudflare) |
| TLS 인증서 | Cloudflare가 HTTPS를 끝내고 같은 서버의 Caddy가 web(nginx):8081로(원본 구간은 HTTP) | Cloudflare(SSL Full(strict) + Origin CA 인증서, 또는 OCI Certificates + Load Balancer) | ACM(CloudFront용은 us-east-1에서 발급) |
| CDN 캐시 | 없음(nginx가 바로 내줌) | Cloudflare 프록시 + 캐시 규칙 | CloudFront 경로별 캐시 동작 |
| WAF·속도 제한 | 없음(api에 경로별 요청 제한만: 통계 120/분 · 로그인 5/분) | Cloudflare WAF 규칙(또는 OCI WAF + LB) | AWS WAF를 CloudFront에 붙임 |
| 원본 받기 | 서버 공인 IP 80·443(리버스 프록시), 8080은 바깥에 열지 않음 | 공개 서브넷 VM 직접, 보안 목록/NSG에 Cloudflare IP만 | 퍼블릭 서브넷 EC2 직접, 보안 그룹에 CloudFront 원본용 관리형 접두사 목록만 |
| 부하 분산 | 없음(한 대) | 두 대 이상일 때 Load Balancer | 두 대 이상일 때 ALB |
| 계산 | 서버 한 대 + docker compose | Ampere A1 VM(arm64) + compose | EC2(Graviton이면 arm64, 아니면 x86) + compose |
| 서버 접속 | SSH | OCI Bastion(22번을 인터넷에 안 엶) | SSM Session Manager(22번 닫음) |
| Grafana 열람 | 127.0.0.1:3002, SSH 터널 | Bastion 터널 | Session Manager 포트 포워딩 |
| 이미지 빌드 | 서버에서 `compose build`(deploy.sh) | CI에서 arm64로 빌드 → OCIR | CI에서 빌드 → ECR |
| 비밀값 | 서버의 `infra/.env`(손으로 만듦) | OCI Vault → 배포 때 `.env` 생성 | Secrets Manager 또는 SSM Parameter Store → 배포 때 `.env` 생성 |
| 서버가 클라우드에 접근할 권한 | 해당 없음 | 인스턴스 주체(동적 그룹 + 정책) | 인스턴스 역할(IAM 인스턴스 프로필) |
| CI가 클라우드에 접근할 권한 | 해당 없음 | 짧게 쓰는 자격 증명 권장(방식은 아래 '열린 항목') | GitHub OIDC → IAM 역할 |
| 배포 지시 | 서버에서 `./infra/deploy.sh` 직접 실행 | SSH(Bastion 경유) 또는 Run Command | SSM Run Command |
| 백업 | backup.sh → 같은 디스크 `backups/`, 14일 | + Object Storage 버킷으로 복사, 수명 주기 규칙 | + S3 버킷으로 복사, 수명 주기 규칙 |
| 지표·로그·알림 | VictoriaMetrics·VictoriaLogs·vmalert·Alertmanager·Grafana | 그대로 | 그대로(CloudWatch는 선택, EC2 상태 검사·자동 복구 경보 정도) |
| 바깥 감시 | 외부 생존 신호(healthchecks.io 등) | 그대로 + 외부 가용성 점검(바깥에서 실제 도메인 열기) | 그대로 + 외부 가용성 점검(Route 53 상태 검사 등) |
| 검색엔진 알림 | IndexNow(`tools/indexnow.mjs`) | 그대로 | 그대로 |

## 그대로인 것

- **브라우저 안 변환.** 파일은 서버로 가지 않는다. 서버가 받는 건 페이지 요청과 익명 숫자(통계)뿐이다. 클라우드를 바꿔도 이 경계는 그대로다.
- **CSP `connect-src 'self'`** 를 비롯한 보안 머리글(COOP·COEP·CSP 등). nginx가 붙이고 CDN은 그대로 전달한다. 배포 점검(deploy.sh)과 합성 감시가 계속 확인한다.
- **compose 묶음과 볼륨.** alerting · vm-data · vlogs-data · am-data · ssr-cache · grafana-data. 공개 포트는 web:8080 하나.
- **SSG 280페이지 + 스트리밍 SSR**(하이브리드 렌더링), nginx의 SSR 캐시.
- **deploy.sh의 점검·되돌림** (첫 화면 · CSP · SSR 주소 · /api/health, 실패하면 이전 이미지). 바뀌는 건 "빌드" 대신 "레지스트리에서 받기"뿐.
- **CI 시험** (단위 · E2E 4엔진 · 운영 경로). 배포 단계는 이 뒤에 붙인다.

## 옮기는 순서 · OCI

운영 중인 VM(리전·네트워크·VM·Docker 설치)은 deploy.md '처음 한 번'으로 이미 갖췄다. 아래는 관리형 서비스로 넓힐 때의 할 일 목록이고, 아직 적용하지 않았다.

- [ ] 리전·구획(compartment) 정하기
- [ ] VCN과 공개 서브넷 만들기, 보안 목록 또는 NSG: 8080은 Cloudflare IP 대역만, 22는 내 IP 또는 Bastion만
- [ ] Ampere A1 VM(Ubuntu 24.04) 만들기, Docker · Node 24 설치(deploy.md '처음 한 번'과 같음)
- [ ] 이미지가 arm64로 빌드되는지 확인(베이스 이미지 nginx·node alpine, Victoria* · Alertmanager · Grafana 이미지의 arm64판 존재 여부)
- [ ] OCIR 저장소 만들기(web · ssr · api)
- [ ] OCI Vault에 비밀값 넣기: ADMIN_PASSWORD_HASH · SESSION_SECRET · GRAFANA_ADMIN_PASSWORD
- [ ] 동적 그룹 + 정책: 이 VM이 Vault 비밀값 읽기, OCIR 받기, 백업 버킷 쓰기
- [ ] Object Storage 버킷(공개 안 함) + 수명 주기 규칙(보관 기간은 정해야 함)
- [ ] backup.sh 뒤에 버킷 복사 단계 추가(지금 빈틈: 백업이 같은 디스크에만 있음), 복구 시험은 restore.sh로
- [ ] deploy.sh를 "빌드" 대신 "OCIR에서 빌드 번호 태그 받기"로 바꾸고, 시작 전에 Vault에서 `.env`(권한 600) 만들기
- [ ] GitHub Actions에 배포 작업 추가: CI 통과 → buildx로 linux/arm64 빌드 → OCIR push → Bastion 경유 SSH 또는 Run Command로 deploy.sh 실행
- [ ] Cloudflare: 자기 도메인을 올리고 DNS를 VM IP로(주황 구름), 캐시 규칙(아래 '주의할 점'), WAF·속도 제한 규칙, 배포 끝에 캐시 비우기
- [ ] 관리자 화면에서 알림 채널·외부 생존 신호 다시 확인, 외부 가용성 점검 추가
- [ ] `BASE=https://convert.getqrmaker.com node e2e/stack.mjs`로 전체 경로 점검, IndexNow 알림

## 옮기는 순서 · AWS

계정에 손대는 명령은 아직 실행하지 않았다.

- [ ] 리전(예: 서울 ap-northeast-2) 정하기, EC2 아키텍처(Graviton arm64 또는 x86) 정하기
- [ ] VPC · 퍼블릭 서브넷 · 보안 그룹: 8080은 CloudFront 원본용 관리형 접두사 목록만, 22는 열지 않음
- [ ] EC2(Ubuntu 24.04) + 탄력적 IP, Docker · Node 24 설치, SSM 에이전트로 Session Manager 접속 확인
- [ ] ECR 저장소 만들기(web · ssr · api)
- [ ] Secrets Manager 또는 SSM Parameter Store에 비밀값 넣기(위와 같은 3개)
- [ ] 인스턴스 역할: 비밀값 읽기, ECR 받기, 백업 버킷 쓰기
- [ ] S3 버킷(퍼블릭 액세스 차단) + 수명 주기 규칙
- [ ] backup.sh 뒤에 S3 복사 단계 추가, restore.sh로 복구 시험
- [ ] deploy.sh를 "ECR에서 받기 + 비밀값으로 `.env` 만들기"로 바꾸기
- [ ] GitHub OIDC 공급자 + 저장소·브랜치로 제한한 IAM 역할 → Actions에서 그 역할로 ECR push, SSM Run Command로 deploy.sh 실행, 성공하면 CloudFront 무효화
- [ ] ACM 인증서(us-east-1) → CloudFront 배포: 원본 EC2:8080, 경로별 캐시 동작, AWS WAF 연결
- [ ] Route 53에 도메인 별칭 레코드 → CloudFront
- [ ] 알림 채널·외부 생존 신호 확인, 필요하면 CloudWatch에 EC2 상태 검사 경보
- [ ] `e2e/stack.mjs` 전체 경로 점검, IndexNow 알림

## 주의할 점

- **HTML 캐시와 언어 이동.** nginx는 `/`에 `Vary: Accept-Language, Cookie`를 붙이고 언어에 따라 다른 응답을 준다. CDN이 `/`를 캐시하면 다른 언어 사용자에게 엉뚱한 첫 화면이 갈 수 있다. `/`·`/api/*`·`/admin`은 캐시하지 않는다.
- **SSG HTML은 지금 `Cache-Control: no-cache`.** 가장자리에서 캐시하려면 CDN 쪽에서 캐시 시간을 따로 정하고, 배포마다 캐시를 비워야(무효화) 옛 페이지가 남지 않는다. `/assets/*`는 해시 파일이라 지금도 1년 캐시라 문제없다.
- **크롤러 집계가 줄어든다.** 봇 요청은 nginx의 mirror로 세는데, CDN이 HTML을 내주면 그 요청은 nginx에 오지 않는다. HTML을 캐시하면 크롤러 숫자가 실제보다 적게 잡힌다.
- **진짜 클라이언트 IP.** api는 `TRUST_PROXY=true`로 X-Forwarded-For를 믿는다. CDN → (LB) → nginx로 단계가 늘면 몇 단계를 믿을지 다시 확인해야 한다.
- **arm64.** Ampere A1(그리고 Graviton)은 arm64다. 지금 deploy.sh는 서버에서 빌드하니 문제가 없었지만, CI에서 빌드하면 대상 아키텍처를 지정해야 한다.
- **정적 파일을 버킷으로 빼는 확장 단계에서는** nginx가 하던 보안 머리글(COOP·COEP·CSP), `/en/x → /x`, 끝 `/` 정리, 없는 주소의 SSR 넘김을 CDN 규칙으로 옮겨야 한다. 특히 COEP·COOP가 빠지면 브라우저 변환 일부가 동작하지 않을 수 있으니 합성 감시 항목을 그대로 돌려 확인한다.
- **백업 버킷은 공개하지 않는다.** 백업에는 알림 설정(채널 토큰 등)이 들어 있다.
- **Grafana는 공개하지 않는다.** compose에서 127.0.0.1:3002에만 묶여 있다. 클라우드에서도 Bastion·Session Manager 터널로만 연다.

## 열린 항목 (공식 문서에서 확인 필요)

- 요금과 무료 한도(OCI Always Free의 Ampere A1·Object Storage·Vault 범위, AWS 프리 티어 범위). 숫자는 적지 않았다.
- OCI에서 GitHub Actions가 장기 API 키 없이 OCIR·배포 권한을 얻는 방법(OIDC 연동 지원 여부와 설정 방식).
- OCI Object Storage로 정적 사이트를 직접 내줄 때 색인 문서·머리글 처리 범위.
- CloudFront가 프라이빗 서브넷 EC2를 직접 원본으로 쓰는 방식(VPC 원본) 적용 조건.
- Lightsail을 쓸 경우 역할·네트워크 연결 범위(EC2보다 기능이 적다는 것만 확실).
- 수명 주기 규칙의 보관 기간(서버 14일과 같게 둘지, 더 길게 둘지).
