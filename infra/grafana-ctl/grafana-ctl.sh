#!/usr/bin/env bash
# 그라파나 켜기·끄기(호스트에서 실행). 관리자 화면이 공유 볼륨(api 컨테이너의 /ctl)에 쓴 want·seen을 보고
# grafana 컨테이너만 켜고 끈 뒤 state를 써 준다. 컨테이너에 docker.sock을 주지 않으려고 호스트 쪽에 둔다.
# 실행: infra/grafana-ctl/grafana-ctl.sh [--loop]   (서버에선 install.sh가 systemd 서비스로 등록)
# 환경: ENV_FILE=infra/.env  IDLE=3600(초, 안 쓰면 끔)  INTERVAL=15(초)
set -uo pipefail
export MSYS_NO_PATHCONV=1 # 윈도우 Git Bash에서 /ctl 경로가 바뀌지 않게
cd "$(dirname "$0")/../.."
ENV_FILE=${ENV_FILE:-infra/.env}
IDLE=${IDLE:-3600}
INTERVAL=${INTERVAL:-15}
COMPOSE=(docker compose -p file-converter -f infra/docker-compose.yml --env-file "$ENV_FILE" --profile grafana)

ctl() { "${COMPOSE[@]}" exec -T api sh -c "$1"; }
put() { ctl "printf %s $2 > /ctl/$1.tmp && mv /ctl/$1.tmp /ctl/$1"; }
log() { echo "$(date -u +%FT%TZ) $*"; }

tick() {
  local r want seen id health
  r=$(ctl 'echo "$(cat /ctl/want 2>/dev/null || echo off) $(cat /ctl/seen 2>/dev/null || echo 0)"') || return 0 # api가 내려가 있으면 이번엔 건너뜀
  read -r want seen <<<"$r"
  [[ $seen =~ ^[0-9]+$ ]] || seen=0
  if [ "$want" = on ] && [ $(($(date +%s) - seen)) -gt "$IDLE" ]; then want=off; put want off; log "안 쓴 지 ${IDLE}초 → 끔"; fi
  id=$("${COMPOSE[@]}" ps -q grafana 2>/dev/null)
  health=$([ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)
  if [ "$want" = on ]; then
    if [ -z "$id" ]; then put state starting; log 켬; "${COMPOSE[@]}" up -d --no-deps grafana >/dev/null 2>&1 || log '켜기 실패'
    elif [ "$health" = healthy ]; then put state on
    else put state starting; fi
  else
    if [ -n "$id" ]; then put state stopping; log 끔; "${COMPOSE[@]}" stop grafana >/dev/null 2>&1 || log '끄기 실패'; fi
    put state off
  fi
}

if [ "${1:-}" = --loop ]; then
  while :; do tick; sleep "$INTERVAL"; done
else
  tick
fi
