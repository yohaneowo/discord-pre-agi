"""在 dsh 服务的实际权限与 cgroup 内验证隔离，失败时阻止启动。"""

import errno
import json
import os
import pathlib
import socket
import subprocess
import sys
import uuid


def connection_blocked(address):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.settimeout(2)
        try:
            connection.sendto(b"dsh-isolation-probe", (address, 443))
            result = 0
        except OSError as error:
            result = error.errno
    # 只有明确的权限拒绝才视为 cgroup 隔离通过，不把网路逾时误当成功。
    return result in (errno.EPERM, errno.EACCES)


def write_blocked(path):
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except OSError as error:
        return error.errno in (errno.EPERM, errno.EACCES, errno.EROFS)
    else:
        os.close(fd)
        os.unlink(path)
        return False


def main():
    token = uuid.uuid4().hex
    sudo = subprocess.run(["sudo", "-n", "true"], capture_output=True)
    checks = {
        "unprivileged": os.geteuid() != 0,
        "sudo_denied": sudo.returncode != 0,
        "maintenance_home_denied": not os.access("/home/dsh-admin", os.R_OK),
        "system_write_denied": write_blocked("/etc/dsh-probe-" + token),
        "application_write_denied": write_blocked("/opt/dsh/probe-" + token),
    }
    path = pathlib.Path("/srv/dsh") / (".probe-" + token)
    try:
        path.write_text("测试工作空间", encoding="utf-8")
        checks["workspace_writable"] = path.read_text(encoding="utf-8") == "测试工作空间"
    finally:
        path.unlink(missing_ok=True)
    for address in ("10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254"):
        checks["private_address_blocked_" + address] = connection_blocked(address)
    print(json.dumps({"isolation_checks": checks}, ensure_ascii=False), flush=True)
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
