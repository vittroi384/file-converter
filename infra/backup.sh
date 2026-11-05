#!/usr/bin/env bash
# 백업: 알림 설정(alerting) · 지표(VictoriaMetrics 스냅샷) · 오류 로그(VictoriaLogs, 몇 초 멈추고 복사) → BACKUP_DIR/<시각>/
# 서버에서 실행: ./infra/backup.sh            (매일 cron 예: 0 4 * * * cd ~/file-converter && ./infra/backup.sh)
# 환경: PROJECT=file-converter BACKUP_DIR=./backups KEEP=14(일)
set -euo pipefail
# 윈도우 Git Bash에서 시험할 때 /v 같은 경로가 C:/... 로 바뀌지 않게(리눅스에선 영향 없음)
export MSYS_NO_PATHCONV=1
PROJECT=${PROJECT:-file-converter}
BACKUP_DIR=${BACKUP_DIR:-./backups}
KEEP=${KEEP:-14}
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/$TS"
mkdir -p "$OUT"
OUT_ABS=$(cd "$OUT" && (pwd -W 2>/dev/null || pwd))
vol() { echo "${PROJECT}_$1"; }
# 볼륨 내용을 tar로(작은 alpine 컨테이너로 읽기 전용 마운트). -h: 링크가 가리키는 실제 파일을 담는다(VM 스냅샷은 링크)
tar_volume() { # 볼륨 하위경로 파일명
  docker run --rm -v "$(vol "$1"):/v:ro" -v "$OUT_ABS:/b" alpine:3.22 tar -C "/v/$2" -czhf "/b/$3" .
}

echo "[1/3] 알림 설정"
tar_volume alerting . alerting.tgz

echo "[2/3] 지표: 스냅샷(실행 중에도 일관된 복사본)"
VM=$(docker compose -p "$PROJECT" ps -q victoriametrics)
SNAP=$(docker exec "$VM" wget -qO- 'http://127.0.0.1:8428/snapshot/create' | sed -n 's/.*"snapshot":"\([^"]*\)".*/\1/p')
[ -n "$SNAP" ] || { echo "스냅샷 실패"; exit 1; }
tar_volume vm-data "snapshots/$SNAP" vm-data.tgz
docker exec "$VM" wget -qO- "http://127.0.0.1:8428/snapshot/delete?snapshot=$SNAP" >/dev/null

echo "[3/3] 오류 로그: 잠깐 멈추고 복사"
docker compose -p "$PROJECT" stop victorialogs >/dev/null
trap 'docker compose -p "$PROJECT" start victorialogs >/dev/null' EXIT
tar_volume vlogs-data . vlogs-data.tgz
docker compose -p "$PROJECT" start victorialogs >/dev/null
trap - EXIT

( cd "$OUT" && sha256sum ./*.tgz > SHA256SUMS )
echo "완료: $OUT ($(du -sh "$OUT" | cut -f1))"
# 오래된 백업 정리
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP" -print -exec rm -rf {} +
