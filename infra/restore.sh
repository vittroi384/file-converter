#!/usr/bin/env bash
# 복구: backup.sh가 만든 폴더 하나를 볼륨에 되살린다. 기존 볼륨 내용은 지우고 덮는다.
# 실행: PROJECT=file-converter ./infra/restore.sh ./backups/20261104T080000Z
#   - 확인 질문을 건너뛰려면 YES=1
#   - 다른 프로젝트 이름(PROJECT=fc-restore-test)으로 복구하면 운영 볼륨을 건드리지 않고 시험할 수 있다
set -euo pipefail
# 윈도우 Git Bash에서 시험할 때 /v 같은 경로가 C:/... 로 바뀌지 않게(리눅스에선 영향 없음)
export MSYS_NO_PATHCONV=1
PROJECT=${PROJECT:-file-converter}
SRC=${1:?"사용법: ./infra/restore.sh <백업 폴더>"}
SRC_ABS=$(cd "$SRC" && (pwd -W 2>/dev/null || pwd))
( cd "$SRC" && sha256sum -c SHA256SUMS ) || { echo "백업 파일이 손상됐다(SHA256 불일치)"; exit 1; }
if [ "${YES:-}" != "1" ]; then
  read -r -p "프로젝트 '$PROJECT'의 알림 설정·지표·로그를 '$SRC'로 덮어쓴다. 계속? (yes) " a
  [ "$a" = "yes" ] || exit 1
fi
vol() { echo "${PROJECT}_$1"; }
restore_volume() { # 볼륨 파일명
  docker volume create "$(vol "$1")" >/dev/null
  docker run --rm -v "$(vol "$1"):/v" -v "$SRC_ABS:/b:ro" alpine:3.22 sh -c "find /v -mindepth 1 -delete && tar -C /v -xzf /b/$2"
}
# 쓰는 쪽을 먼저 멈춘다(실행 중이 아니면 그냥 지나감)
docker compose -p "$PROJECT" stop api vmalert alertmanager victoriametrics victorialogs >/dev/null 2>&1 || true
restore_volume alerting alerting.tgz
restore_volume vm-data vm-data.tgz
restore_volume vlogs-data vlogs-data.tgz
# 볼륨은 node 사용자(1000)가 써야 한다(api 설정 저장)
docker run --rm -v "$(vol alerting):/v" alpine:3.22 chown -R 1000:1000 /v
echo "복구 끝. 다시 켜기: docker compose -p $PROJECT -f infra/docker-compose.yml --env-file <env> up -d"
