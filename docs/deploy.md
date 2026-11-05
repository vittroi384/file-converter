# 배포

운영 서버는 OCI 무료 VM 한 대(Ubuntu 24.04, 메모리 2GB 이상 권장 — 컨테이너 메모리 상한 합이 약 1.7GB이고 Grafana(13.x)만 최대 512MB)이고, docker compose로 돌린다(2026-11-05부터 운영 중, https://localconvert.duckdns.org). web(nginx)은 8080 하나만 받고, 그 앞단의 리버스 프록시가 Let's Encrypt 인증서로 HTTPS를 끝내고 `127.0.0.1:8080`으로 넘긴다. 도메인은 DuckDNS 하위 도메인이다.

## 처음 한 번

```bash
# 1) 서버 준비
sudo apt-get update && sudo apt-get install -y git curl
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER   # 다시 로그인
# node 24 (점검·IndexNow·비밀번호 해시용)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs

# 2) 코드
git clone <저장소 주소> ~/file-converter && cd ~/file-converter

# 3) 비밀값 (저장소에 올리지 않는다)
cp infra/.env.example infra/.env
node tools/hash-password.ts '10자 이상 관리자 비밀번호'   # 출력값을 작은따옴표로 감싸 ADMIN_PASSWORD_HASH에
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET에
# PUBLIC_URL=https://실제도메인  (canonical·hreflang·사이트맵에 박힌다)
# SECURE_COOKIE=true

# 4) 첫 배포
FORCE=1 ./infra/deploy.sh
```

HTTPS:
- DNS: DuckDNS 하위 도메인을 서버 공인 IP로.
- 같은 서버의 리버스 프록시(예: Caddy `reverse_proxy 127.0.0.1:8080`)가 Let's Encrypt 인증서를 받고 갱신하며 HTTPS를 끝낸다. 인증서·키 파일은 프로젝트 폴더 밖에 둔다.
- 서버 방화벽(OCI 보안 목록 + ufw)은 80·443만 연다(80은 인증서 발급 확인과 HTTPS 이동용). 8080은 바깥에 열지 않는다.
- api의 신뢰 프록시 수(`TRUST_PROXY_HOPS`)는 앞단 프록시 + nginx = 2.

## 평소 배포

```bash
cd ~/file-converter && ./infra/deploy.sh
```

하는 일: `origin/main` 받기 → 빌드 번호(`커밋-월일시분`) 붙여 빌드 → 교체(`--wait`로 건강 확인) → 첫 화면·CSP·SSR·API 점검 → 실패하면 이전 이미지와 커밋으로 되돌림. 관리자 화면 '서버' 탭의 '배포'와 그래프 점선에 빌드 번호가 찍힌다.

콘텐츠(안내 페이지 등)를 바꿨으면 검색엔진에 알린다: `node tools/indexnow.mjs https://localconvert.duckdns.org` (먼저 `--dry`로 확인 가능).

## 처음 켠 뒤 관리자 화면에서

1. `https://localconvert.duckdns.org/admin` 로그인.
2. 알림 → 채널(텔레그램·디스코드·이메일·웹훅) 하나 이상 켜고 '테스트 알림 보내기'.
3. 알림 → **외부 생존 신호**: healthchecks.io 등에서 체크를 만들고(주기 1분, 유예 5분) 받은 주소를 넣는다. 서버가 통째로 꺼지면 그쪽이 알려 준다.
4. 서버 탭 → '사이트 점검'이 모두 정상인지.

## 백업·복구

```bash
# 매일 새벽 4시(UTC) 백업, 14일 보관
crontab -e
0 4 * * * cd ~/file-converter && ./infra/backup.sh >> backups/backup.log 2>&1
```

- 담는 것: 알림 설정(`alerting` 볼륨), 지표(VictoriaMetrics 스냅샷), 오류 로그(VictoriaLogs, 몇 초 멈추고 복사). 각 파일 SHA-256 포함.
- 복구: `./infra/restore.sh backups/<시각>` → 확인 질문에 `yes` → `docker compose -p file-converter -f infra/docker-compose.yml --env-file infra/.env up -d`.
- 운영을 건드리지 않고 복구를 시험하려면 `PROJECT=fc-restore-test`로 다른 볼륨에 복구한다(devlog 22절에 한 방법).
- 백업 폴더는 서버 디스크에 있다. 서버째 잃는 경우를 대비하려면 `backups/`를 다른 곳(Object Storage 등)으로도 복사한다 — 이건 아직 자동화하지 않았다.

## 되돌리기(수동)

```bash
git log --oneline -5
git reset --hard <커밋> && FORCE=1 ./infra/deploy.sh
```

## Grafana(운영자 대시보드)

관리자 화면(`/admin`)이 핵심 숫자를 보여 준다면, Grafana는 같은 지표·로그를 더 길고 자세히 본다. 공개하지 않고 서버의 `127.0.0.1:3002`에만 열려 있어 SSH 터널로 연다.

```bash
# 처음 한 번: infra/.env에 GRAFANA_ADMIN_PASSWORD를 채운다(비어 있으면 compose가 시작을 거부한다)
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"

# 내 PC에서 터널을 열고 브라우저로 http://localhost:3002 (아이디 admin)
ssh -N -L 3002:127.0.0.1:3002 ubuntu@<서버 주소>
```

- 대시보드 5개(폴더 LocalConvert): 개요 · 유입·AI · 안정성(SLO) · 체감 성능 · 로그. 그래프의 파란 점선은 배포(`fc_build_info`에 새 버전이 처음 보인 시각).
- 데이터 소스·대시보드는 `infra/grafana/`의 파일이 원본이다. 화면에서 고쳐도 저장되지 않으니 JSON을 고치고 서버에 올린다(30초 안에 다시 읽는다).
- 로그 대시보드는 VictoriaLogs 플러그인(`victoriametrics-logs-datasource`, 버전 고정)을 처음 켤 때 grafana.com에서 받는다. 서버가 바깥에 못 나가면 이 데이터 소스와 로그 대시보드만 '플러그인 없음'으로 뜨고 나머지는 그대로 돈다.
- `.env`의 비밀번호는 Grafana가 처음 켜질 때만 쓰인다. 나중에 바꾸려면 `docker compose -p file-converter exec grafana grafana cli admin reset-admin-password '<새 비밀번호>'`.

## 확인 명령

| 무엇 | 명령 |
|---|---|
| 컨테이너 상태 | `docker compose -p file-converter ps` |
| 로그 | `docker compose -p file-converter logs -f --tail 100 api` |
| 전체 경로 점검(27항목) | `BASE=http://127.0.0.1:8080 node e2e/stack.mjs` (SSR을 잠깐 멈추는 항목 포함 — 한산할 때) |
| 지표 직접 보기 | `curl -s 127.0.0.1:8428/api/v1/query --data-urlencode 'query=up'` |
