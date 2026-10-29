"""在拒绝外网的 systemd 暂时服务中启动本机假 Discord 验收。"""

import subprocess


if __name__ == "__main__":
    subprocess.run(["systemctl", "stop", "dsh-social-e2e"], capture_output=True)
    subprocess.run(["systemctl", "reset-failed", "dsh-social-e2e"], capture_output=True)
    args = ["systemd-run", "--unit=dsh-social-e2e", "--collect"]
    for prop in (
        "User=dsh",
        "WorkingDirectory=/srv/dsh/verification",
        "Environment=DSH_HOME=/var/lib/dsh/.dsh-e2e",
        "MemoryMax=800M",
        "CPUQuota=60%",
        "NoNewPrivileges=true",
        "CapabilityBoundingSet=",
        "ProtectSystem=strict",
        "ProtectHome=true",
        "PrivateTmp=true",
        "PrivateDevices=true",
        "ReadWritePaths=/var/lib/dsh/.dsh-e2e /srv/dsh/verification",
        "IPAddressDeny=any",
        "IPAddressAllow=localhost",
    ):
        args.append("--property=" + prop)
    subprocess.run(args + ["/opt/dsh/node/bin/node", "/opt/dsh/social-e2e.mjs"], check=True)
