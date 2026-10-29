"""把按频道分开的旧群聊记忆（scope guild-<频道>）复制进共用的 group 范围；原档不动，可重复执行。"""

import argparse
import hashlib
import json
import pathlib
import re

HEADER = re.compile(r"^---\r?\n([^\n]+)\r?\n---\r?\n", re.S)


def directory(root, scope):
    return root / hashlib.sha256(scope.encode()).hexdigest()[:32]


def migrate(root):
    target = directory(root, "group")
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    copied = skipped = 0
    for path in sorted(root.glob("*/*.md")):
        if path.parent == target:
            continue
        content = path.read_text(encoding="utf-8")
        match = HEADER.match(content)
        if not match:
            continue
        meta = json.loads(match.group(1))
        if not str(meta.get("scope", "")).startswith("guild-"):
            continue
        destination = target / path.name
        if destination.exists():
            skipped += 1
            continue
        meta["scope"] = "group"
        destination.write_text("---\n" + json.dumps(meta, ensure_ascii=False) + "\n---\n" + content[match.end():], encoding="utf-8")
        destination.chmod(0o600)
        copied += 1
    return {"copied": copied, "skipped": skipped, "target": target.name}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=pathlib.Path, help="social-runtime/memory 目录")
    print(json.dumps(migrate(parser.parse_args().root)))
