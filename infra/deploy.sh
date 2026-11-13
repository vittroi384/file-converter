#!/usr/bin/env bash
# 배포(서버에서): 최신 코드 받기 → 빌드 번호 붙여 이미지 빌드 → 교체 → 건강 확인 → 간단 점검 → 실패하면 이전 이미지로.
# 실행: cd ~/file-converter && ./infra/deploy.sh
# 필요: infra/.env (비밀값, 저장소에 없음 — infra/.env.example 참고), docker compose v2, node 24(점검용)
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-infra/.env}
COMPOSE=(docker compose -p file-converter -f infra/docker-compose.yml --env-file "$ENV_FILE")
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE 없음 (infra/.env.example 참고)"; exit 1; }

git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && [ "${FORCE:-}" != "1" ]; then echo "이미 최신 (FORCE=1로 다시 빌드)"; exit 0; fi
PREV=$(git rev-parse --short HEAD)
git merge --ff-only --quiet origin/main
export BUILD_ID="$(git rev-parse --short HEAD)-$(date -u +%m%d%H%M)" # 관리자 화면 '배포' 세로선에 찍힌다
echo "배포 $PREV → $BUILD_ID"

# 지금 이미지에 이전 태그를 붙여 둔다(되돌리기용)
for s in web ssr api; do
  img=$(docker compose -p file-converter ps -q "$s" 2>/dev/null | xargs -r docker inspect -f '{{.Image}}' 2>/dev/null || true)
  [ -n "$img" ] && docker tag "$img" "file-converter-$s:previous" || true
done

"${COMPOSE[@]}" build --pull
"${COMPOSE[@]}" up -d --wait --wait-timeout 120

# 점검: 첫 화면·보안 머리글·SSR·API (합성 감시와 같은 항목)
PORT=$(grep -E '^WEB_PORT=' "$ENV_FILE" | cut -d= -f2 || true); PORT=${PORT:-8080}
check() { curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$1" | grep -q '^200$'; }
ok=1
check / || ok=0
curl -fsSI "http://127.0.0.1:$PORT/" | grep -qi "content-security-policy: .*connect-src 'self'" || ok=0
check /ja/avif-to-png || ok=0
check /api/health || ok=0
if [ "$ok" = 1 ]; then
  echo "배포 완료: $BUILD_ID"
  echo "검색엔진 알림(선택): node tools/indexnow.mjs \$PUBLIC_URL"
  exit 0
fi

echo "점검 실패 → 이전 이미지로 되돌림"
git reset --quiet --hard "$PREV"
for s in web ssr api; do docker image inspect "file-converter-$s:previous" >/dev/null 2>&1 && docker tag "file-converter-$s:previous" "file-converter-$s:latest"; done
"${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 120
echo "되돌림 완료(이전 버전 $PREV). 원인: docker compose -p file-converter logs --tail 200"
exit 1
