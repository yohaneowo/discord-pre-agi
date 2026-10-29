"""由独立 root 服务取得 Doppler 的单一 bot 凭证；不把服务 token 交给 dsh。"""

import json
import os
import pathlib
import re
import sys
import tempfile
import urllib.request

DESTINATION = pathlib.Path("/run/dsh-secrets/runtime.env")


def main():
    token = os.environ["DOPPLER_TOKEN"]
    request = urllib.request.Request(
        "https://api.doppler.com/v3/configs/config/secrets/download?format=json&secrets=DSH_DISCORD_TOKEN",
        headers={"Authorization": "Bearer " + token},
    )
    # 不接受重导向，避免将授权头带往其他来源。
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=20) as response:
        secret = json.load(response)["DSH_DISCORD_TOKEN"]
    if not isinstance(secret, str) or not re.fullmatch(r"[A-Za-z0-9._-]{40,256}", secret):
        raise ValueError("凭证格式不符。")
    fd, temporary = tempfile.mkstemp(prefix=".runtime-", dir=DESTINATION.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write("DSH_DISCORD_TOKEN=" + secret + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, DESTINATION)
    finally:
        pathlib.Path(temporary).unlink(missing_ok=True)
    print("Doppler bot 凭证已载入；未向代理提供 Doppler 服务 token。")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Doppler 凭证读取失败，拒绝启动桥接；请检查专用只读服务 token 与网路。", file=sys.stderr)
        sys.exit(1)
