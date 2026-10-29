"""启动 dsh，把私人入口存入 .env，并避免将入口凭证写进服务日志。"""

import os
import pathlib
import re
import signal
import subprocess
import sys
import urllib.parse

ENV_PATH = pathlib.Path("/var/lib/dsh/.env")
URL = re.compile(r"https?://[^\s<>\"']+")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def save_url(value):
    content = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
    lines = [line for line in content.splitlines() if not line.startswith("DSH_ACCESS_URL=")]
    lines.append("DSH_ACCESS_URL=" + value)
    fd = os.open(ENV_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)
        else:
            os.chmod(ENV_PATH, 0o600)
        os.write(fd, ("\n".join(lines) + "\n").encode())
    finally:
        os.close(fd)


def sanitize(line):
    line = ANSI.sub("", line)
    for match in list(URL.finditer(line)):
        value = match.group().rstrip(",;)")
        try:
            parsed = urllib.parse.urlsplit(value)
            if parsed.hostname in ("127.0.0.1", "localhost") and parsed.port == 3080 and (parsed.query or parsed.fragment):
                save_url(value)
        except ValueError:
            pass
    def redact(match):
        try:
            parsed = urllib.parse.urlsplit(match.group().rstrip(",;)"))
            if parsed.query or parsed.fragment or parsed.username or parsed.password:
                return "[私人入口资讯已省略]"
            return match.group()
        except ValueError:
            return "[入口资讯已省略]"
    line = URL.sub(redact, line)
    if re.search(r"token|secret|password|authorization|bearer|credential|cookie|api[_-]?key", line, re.I):
        return "dsh 的凭证相关诊断已省略。\n"
    return line


def main():
    child = subprocess.Popen(
        ["/opt/dsh/node/bin/node", "/opt/dsh/app/node_modules/@deepseek-ai/dsh/lib/bin.js", "--profile", "web", "--no-open"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8", errors="replace", start_new_session=True,
    )
    def stop(signum, _frame):
        try:
            os.killpg(child.pid, signum)
        except ProcessLookupError:
            pass
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    for line in child.stdout:
        print(sanitize(line), end="", flush=True)
    return child.wait()


if __name__ == "__main__":
    sys.exit(main())
