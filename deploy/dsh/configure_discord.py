"""在已建立的隔离 VM 配置桥接；stdin 接收凭证，不把值写入命令列或日志。"""

import json
import os
import pathlib
import re
import shutil
import sys
import time

import yaml


def main():
    if os.geteuid() != 0 or not pathlib.Path("/etc/dsh-isolated-vm").is_file():
        raise RuntimeError("只能在已初始化的独立 VM 由维护帐号执行。")
    data = json.load(sys.stdin)
    for key in ("owner_id", "channel_id"):
        if not re.fullmatch(r"\d{16,22}", data[key]):
            raise ValueError("Discord 身分设定格式错误。")
    if not re.fullmatch(r"dp\.st\.[A-Za-z0-9._-]+", data["doppler_token"]):
        raise ValueError("Doppler 服务 token 格式错误。")
    stage = pathlib.Path(__file__).resolve().parent
    profile = pathlib.Path("/var/lib/dsh/.dsh/profiles/web/cordis.patch.yml")
    rows = yaml.safe_load(profile.read_text()) or []
    if not isinstance(rows, list) or any(row.get("id") == "discord-bridge" for row in rows):
        raise RuntimeError("既有桥接设定须先审阅，不自动覆盖。")
    backup = pathlib.Path("/var/backups/dsh") / str(time.time_ns())
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(profile, backup / "cordis.patch.yml")
    for name in ("discord", "whale"):
        source = stage / name
        target = pathlib.Path("/opt/dsh/vendor") / name
        if target.exists():
            raise RuntimeError("供应商目录已存在，须先检查版本。")
        shutil.copytree(source, target)
        for path in [target, *target.rglob("*")]:
            os.chown(path, 0, 0)
            path.chmod(0o755 if path.is_dir() else 0o644)
    rows.append({"id": "discord-bridge", "config": {
        "tokenEnv": "DSH_DISCORD_TOKEN", "allowedUsers": [data["owner_id"]],
        "allowedChannels": [data["channel_id"]], "cwd": "/srv/dsh/discord",
        "preset": "whale", "maxChunksPerReply": 3, "maxIncomingBytes": 8000000,
        "notifyEnabled": False, "imessageEnabled": False,
    }})
    profile.write_text(yaml.safe_dump(rows, allow_unicode=True, sort_keys=False), encoding="utf-8")
    profile.chmod(0o600)
    workspace = pathlib.Path("/srv/dsh/discord")
    workspace.mkdir(exist_ok=True, mode=0o700)
    import pwd
    user = pwd.getpwnam("dsh")
    os.chown(workspace, user.pw_uid, user.pw_gid)
    secret_dir = pathlib.Path("/etc/dsh-secrets")
    secret_dir.mkdir(mode=0o700, exist_ok=True)
    secret_dir.chmod(0o700)
    secret = secret_dir / ".env"
    fd = os.open(secret, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write("DOPPLER_TOKEN=" + data["doppler_token"] + "\n")
    shutil.copyfile(stage / "fetch_secrets.py", "/opt/dsh/fetch_secrets.py")
    pathlib.Path("/opt/dsh/fetch_secrets.py").chmod(0o644)
    shutil.copyfile(stage / "dsh-secrets.service", "/etc/systemd/system/dsh-secrets.service")
    dropin = pathlib.Path("/etc/systemd/system/dsh.service.d")
    dropin.mkdir(exist_ok=True)
    shutil.copyfile(stage / "discord-secrets.conf", dropin / "discord-secrets.conf")
    print(json.dumps({"configured": True, "owner_only": True, "guild_mentions_required": True}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("桥接配置未完成，保持服务停机并检查备份；未输出凭证。", file=sys.stderr)
        sys.exit(1)
