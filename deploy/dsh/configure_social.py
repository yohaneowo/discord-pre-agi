"""隔离验收通过后，备份并启用群聊、私人管理与记忆用量护栏。"""

import argparse
import datetime
import json
import os
import pathlib
import shutil
import subprocess

import yaml


# huanqi（换气）的设定：它自己的压缩与「用检索工具取回」提示都关掉——压缩之后改用带出处的压缩来做，
# 我们也没有它那套检索工具。其余照它的预设。
HUANQI_CONFIG = {"fullCompactOnBreaker": False, "regionCompactAfterCuts": 0, "postCompactRecallHint": False}


def configure(upgrade=False, group_tools=None, no_daily_limits=False, all_channels=False, stickers=None, memes=None, huanqi=None):
    if os.geteuid() != 0:
        raise RuntimeError("必须由 VM 维护帐号以 root 执行。")
    result = json.loads(pathlib.Path("/var/lib/dsh/.dsh-e2e/result.json").read_text())
    if not result.get("ok") or len(result.get("checks", [])) < 13:
        raise RuntimeError("完整隔离验收尚未通过，拒绝更动正式服务。")
    profile = pathlib.Path("/var/lib/dsh/.dsh/profiles/web")
    patch = profile / "cordis.patch.yml"
    rows = yaml.safe_load(patch.read_text())
    bridge = next(row for row in rows if row.get("id") == "discord-bridge")["config"]
    existing = next((row for row in rows if row.get("id") == "social-runtime"), None)
    if existing is not None and not upgrade:
        raise RuntimeError("已经配置，拒绝重复覆盖。")
    if not bridge.get("allowedUsers") or not bridge.get("allowedChannels"):
        raise RuntimeError("缺少既有拥有者或频道白名单。")
    if bridge.get("gatewayUrl") or bridge.get("restBaseUrl") or bridge.get("token"):
        raise RuntimeError("正式桥接不得使用测试端点或内嵌凭证。")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = pathlib.Path("/var/backups/dsh") / ("before-social-" + stamp)
    backup.mkdir(mode=0o700, parents=True)
    for name in ("cordis.yml", "cordis.patch.yml", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "discord-bridge-state.json", "participation-state.json"):
        if (profile / name).exists():
            shutil.copyfile(profile / name, backup / name)
            (backup / name).chmod(0o600)
    social = {"id": "social-runtime", "config": {
        "ownerIds": bridge["allowedUsers"],
        "allowedChannels": bridge["allowedChannels"],
        "groupCwd": bridge["cwd"],
        "stateRoot": "/var/lib/dsh/.dsh/social-runtime",
        "limits": {"input": 2000000, "output": 50000, "calls": 200, "maxOutput": 8192, "timeZone": "Asia/Taipei"},
    }}
    if existing is None:
        rows.append(social)
        existing = social
    if all_channels:
        # 拥有者决定：bot 所在的所有服务器、所有频道都能说话（私讯仍只收拥有者）。
        bridge["allowedChannels"] = ["*"]
        existing.setdefault("config", {})["allowedChannels"] = ["*"]
    if no_daily_limits:
        # 拥有者暂时不要每日上限；护栏要求正整数，所以设成用不完的数。单次输出上限仍保留。
        existing.setdefault("config", {}).setdefault("limits", {}).update(input=10**12, output=10**12, calls=10**12)
    if group_tools is not None:
        # 群聊开放完整工具由拥有者决定并承担群友诱导的风险；送往 Discord 的文字仍会遮掉机密。
        existing.setdefault("config", {})["groupTools"] = group_tools
    if stickers:
        # 大肥鱼表情（dsh-nekowhale-stickers）：只用它的 stickers 服务与搜图、模板工具。
        # 网页桌宠与「双击查余额」（会用到 DeepSeek 登入）关掉；它自己的提示词关掉，由群聊人设说明用法。
        row = next((row for row in rows if row.get("id") == "nekowhale-stickers"), None)
        if row is None:
            row = {"id": "nekowhale-stickers"}
            rows.append(row)
        row["config"] = {"autoSync": "lazy", "promptMode": "off", "frequency": "rare", "persona": "self", "agentCuration": False, "returnImageToModel": False, "pet": False, "petBubbles": False, "petBalance": False}
    if huanqi:
        row = next((row for row in rows if row.get("id") == "huanqi"), None)
        if row is None:
            row = {"id": "huanqi"}
            rows.append(row)
        row["config"] = dict(HUANQI_CONFIG)
    bridge.update(preset="whale-social", notifyEnabled=False, imessageEnabled=False)
    account = next((row for row in rows if row.get("id") == "llm-deepseek-account"), None)
    if account is None:
        account = {"id": "llm-deepseek-account", "config": {}}
        rows.append(account)
    account.setdefault("config", {}).update(maxTokens=2048, retryPolicy={"mode": "normal", "maxRetries": 0})
    subprocess.run(["systemctl", "stop", "dsh"], check=True)
    patch.write_text(yaml.safe_dump(rows, allow_unicode=True, sort_keys=False))
    os.chown(patch, 999, 999)
    patch.chmod(0o600)
    command = ["sudo", "-u", "dsh", "env", "HOME=/var/lib/dsh", "DSH_HOME=/var/lib/dsh/.dsh", "DSH_HOST_MODULES=/opt/dsh/app/node_modules/@deepseek-ai", "PATH=/opt/dsh/node/bin:/usr/bin:/bin", "/opt/dsh/node/bin/node", "/opt/dsh/app/node_modules/@deepseek-ai/dsh/lib/bin.js", "plugin", "--profile", "web", "add", "file:/opt/dsh/vendor/discord-0.6.0-social.48", "file:/opt/dsh/vendor/social-0.1.42", "file:/opt/dsh/vendor/social-presets-0.45.0", *(["file:" + stickers] if stickers else []), *(["file:" + memes] if memes else []), *(["file:" + huanqi] if huanqi else []), "--config.auto-install-peers=false", "--ignore-scripts"]
    try:
        install = subprocess.run(command, cwd="/srv/dsh", capture_output=True, text=True, timeout=120)
        (backup / "install.log").write_text(install.stdout + install.stderr)
        (backup / "install.log").chmod(0o600)
        if install.returncode:
            raise RuntimeError("插件安装未完成，请查看 VM 私人安装日志并恢复备份。")
        dropin = pathlib.Path("/etc/systemd/system/dsh.service.d/social-runtime.conf")
        dropin.write_text('[Service]\nEnvironment="DSH_HOST_MODULES=/opt/dsh/app/node_modules/@deepseek-ai"\nEnvironment="TZ=Asia/Taipei"\n')
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "start", "dsh"], check=True)
    except Exception:
        # 安装失败保留停止状态，不让不完整的边界配置进入真实群聊。
        raise
    print(json.dumps({"configured": True, "backup": str(backup)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upgrade", action="store_true", help="保留既有护栏设定，只升级已验收的固定套件")
    parser.add_argument("--group-tools", choices=("chat", "full"), help="群聊只给 remember（chat）或与私人会话一样的完整工具（full）；不给就保留现状")
    parser.add_argument("--no-daily-limits", action="store_true", help="取消每日调用次数与 token 上限（单次输出上限保留）")
    parser.add_argument("--all-channels", action="store_true", help="所有服务器的所有频道都能说话（频道白名单设为 *）")
    parser.add_argument("--stickers", help="已审阅的 dsh-nekowhale-stickers 套件目录（/opt/dsh/vendor 底下），一起装进 profile")
    parser.add_argument("--memes", help="已审阅的 dsh-meme 套件目录（/opt/dsh/vendor 底下），一起装进 profile；图库在 $HOME/.dsh/meme-packs")
    parser.add_argument("--huanqi", help="已审阅的 dsh-huanqi（换气）套件目录（/opt/dsh/vendor 底下），一起装进 profile")
    args = parser.parse_args()
    configure(args.upgrade, args.group_tools, args.no_daily_limits, args.all_channels, args.stickers, args.memes, args.huanqi)
