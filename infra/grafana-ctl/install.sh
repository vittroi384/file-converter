#!/usr/bin/env bash
# 서버에 grafana-ctl을 systemd 서비스로 등록(한 번만). 실행: sudo ./infra/grafana-ctl/install.sh
# docker를 쓸 수 있는 사용자(sudo를 부른 사용자)로 돈다. 로그: journalctl -u fc-grafana-ctl
set -euo pipefail
DIR=$(cd "$(dirname "$0")/../.." && pwd)
RUN_AS=${SUDO_USER:-$(id -un)}
chmod +x "$DIR/infra/grafana-ctl/grafana-ctl.sh"
cat >/etc/systemd/system/fc-grafana-ctl.service <<EOF
[Unit]
Description=file-converter grafana on/off (admin switch)
After=docker.service
Requires=docker.service

[Service]
User=$RUN_AS
WorkingDirectory=$DIR
ExecStart=$DIR/infra/grafana-ctl/grafana-ctl.sh --loop
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now fc-grafana-ctl.service
systemctl --no-pager status fc-grafana-ctl.service | head -5
