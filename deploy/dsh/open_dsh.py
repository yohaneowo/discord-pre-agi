"""开启到独立 VM 的 SSH 隧道，并从该 VM 读取当次私人入口。"""

import argparse
import http.cookiejar
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parents[2]


def read_env(path):
    return dict(line.split("=", 1) for line in path.read_text(encoding="utf-8-sig").splitlines()
                if "=" in line and not line.lstrip().startswith("#"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-open", action="store_true", help="只验证入口，不开启浏览器")
    args = parser.parse_args()
    env_path = ROOT / ".env"
    config = read_env(env_path)
    required = ("DSH_SSH_TARGET", "DSH_SSH_JUMP", "DSH_SSH_KEY", "DSH_KNOWN_HOSTS", "DSH_LOCAL_PORT")
    if not all(config.get(key) for key in required):
        raise RuntimeError("请先在本机 .env 配妥 dsh 连接栏位。")
    port = int(config["DSH_LOCAL_PORT"])
    if not 1024 <= port <= 65535:
        raise RuntimeError("本机隧道端口不在允许范围。")
    known_hosts = pathlib.Path(config["DSH_KNOWN_HOSTS"])
    if not known_hosts.is_absolute():
        known_hosts = ROOT / known_hosts
    ssh = ["ssh", "-J", config["DSH_SSH_JUMP"], "-i", config["DSH_SSH_KEY"],
           "-o", "ForwardAgent=no", "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
           "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=yes",
           "-o", "UserKnownHostsFile=" + str(known_hosts)]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    result = subprocess.run(ssh + [config["DSH_SSH_TARGET"], "sudo -n cat /var/lib/dsh/.env"],
                            capture_output=True, text=True, encoding="utf-8", timeout=40,
                            creationflags=flags)
    if result.returncode:
        raise RuntimeError("无法经维护 SSH 读取 dsh 入口，请检查 VM 与 SSH 连线。")
    remote = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    parsed = urllib.parse.urlsplit(remote.get("DSH_ACCESS_URL", ""))
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.port != 3080 or not (parsed.query or parsed.fragment):
        raise RuntimeError("VM 尚未提供有效的 dsh 私人入口。")
    url = urllib.parse.urlunsplit(parsed._replace(netloc="127.0.0.1:" + str(port)))
    child = None
    with socket.socket() as probe:
        occupied = probe.connect_ex(("127.0.0.1", port)) == 0
    if not occupied:
        child = subprocess.Popen(ssh + ["-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30",
                                       "-o", "ServerAliveCountMax=3", "-L",
                                       f"127.0.0.1:{port}:127.0.0.1:3080", config["DSH_SSH_TARGET"]],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, creationflags=flags)
        for _ in range(100):
            if child.poll() is not None:
                raise RuntimeError("SSH 隧道启动失败。")
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", port)) == 0:
                    break
            time.sleep(0.1)
    try:
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar))
        with opener.open(url, timeout=15) as response:
            if response.status != 200 or not len(jar):
                raise RuntimeError("私人入口登录验收未通过。")
            response.read()
    except Exception:
        if child:
            child.terminate()
        raise RuntimeError("无法通过隧道登入 dsh，请检查服务或端口占用。") from None
    content = env_path.read_text(encoding="utf-8-sig")
    lines = [line for line in content.splitlines() if not line.startswith("DSH_ACCESS_URL=")]
    lines.append("DSH_ACCESS_URL=" + url)
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if not args.no_open and not webbrowser.open(url):
        raise RuntimeError("隧道已就绪，但系统未能开启预设浏览器。私人入口已存入本机 .env。")
    print(json.dumps({"tunnel_ready": True, "authenticated": True, "browser_requested": not args.no_open}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else "连接未完成，请检查本机设定与 VM 状态。", file=sys.stderr)
        sys.exit(1)
