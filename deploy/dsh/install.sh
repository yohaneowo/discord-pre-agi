#!/usr/bin/env bash
# 仅在新建的专用 VM 内执行；不在 PVE 宿主机或现有服务 VM 执行。
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo '请使用新 VM 的维护帐号以 sudo 执行。' >&2; exit 1; }
[[ -f /etc/dsh-isolated-vm ]] || { echo '此系统没有专用 VM 标记，拒绝安装。' >&2; exit 1; }
id dsh >/dev/null
[[ -d /srv/dsh && -d /var/lib/dsh ]] || exit 1
[[ ! -e /etc/systemd/system/dsh.service ]] || { echo '服务已存在，请先检查现有安装。' >&2; exit 1; }
NODE_VERSION=24.21.0
NODE_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
DSH_VERSION=0.2.1-rc.3
TASK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install -d -m 0755 /opt/dsh/node
curl --silent --show-error --fail --location --connect-timeout 15 --max-time 300 --retry 2 --limit-rate 8M --output /opt/dsh/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
printf '%s  %s\n' "$NODE_SHA256" /opt/dsh/node.tar.xz | sha256sum --check
tar -xJf /opt/dsh/node.tar.xz --strip-components=1 -C /opt/dsh/node
rm -f -- /opt/dsh/node.tar.xz
install -d -o dsh -g dsh -m 0755 /opt/dsh/app
printf '{"private":true,"dependencies":{"@deepseek-ai/dsh":"%s"}}\n' "$DSH_VERSION" > /opt/dsh/app/package.json
chown dsh:dsh /opt/dsh/app/package.json
cd /opt/dsh/app
runuser -u dsh -- env HOME=/var/lib/dsh PATH=/opt/dsh/node/bin:/usr/local/bin:/usr/bin:/bin NODE_OPTIONS=--max-old-space-size=768 npm install --omit=dev --no-audit --no-fund
chown -R root:root /opt/dsh/app
install -o root -g root -m 0755 "$TASK_DIR/run_dsh.py" /opt/dsh/run_dsh.py
install -o root -g root -m 0755 "$TASK_DIR/verify_isolation.py" /opt/dsh/verify_isolation.py
install -o root -g root -m 0644 "$TASK_DIR/dsh.service" /etc/systemd/system/dsh.service
if [[ ! -e /var/lib/dsh/.env ]]; then
	install -o dsh -g dsh -m 0600 /dev/null /var/lib/dsh/.env
fi
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/dsh.service
systemctl enable --now dsh
echo 'dsh 服务已启动；私人入口请从 VM 内 .env 读取，不要贴进聊天。'
