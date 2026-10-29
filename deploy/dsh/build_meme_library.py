#!/usr/bin/env python3
"""Build Whale-chan's community meme library from 梗鲸 (aigengtu.com).

The site curates fan-made DeepSeek-chan memes, each with its line of dialogue and a short story; the
author allows non-commercial fan use and hotlinking. This downloads the compressed previews of the
「梗图」 entries and writes index.json, which the social runtime (meme-library.mjs) searches when she
writes [梗圖:…] in a reply. Re-running only fetches what is new.

Run on the VM as the dsh user:
  sudo -u dsh python3 build_meme_library.py [/var/lib/dsh/.dsh/meme-library/aigengtu]
"""

import json
import os
import re
import sys
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor

INDEX_URL = "https://aigengtu.com/gallery-index.json"
CATEGORY = "DeepSeek娘"
USER_AGENT = "Mozilla/5.0 (compatible; whale-chan meme library; personal non-commercial bot)"
MAX_BYTES = 8 * 1024 * 1024


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("too large")
    return data


def entry(image):
    number = re.search(r"/meme/(\d+)\.\w+$", image.get("original", "") or image.get("preview", ""))
    if not number or image.get("type") != "梗图":
        return None
    alt = image.get("alt") or image.get("name") or ""
    quote = re.search(r"『([^』]+)』", alt)
    # 「DeepSeek娘『台词』动作描述表情包」：去掉前面的角色名与结尾的「表情包」，留下台词与描述。
    caption = re.sub(r"^(?:DeepSeek(?:娘|鲸娘)?|蓝色大肥鱼|大肥鱼)\s*", "", alt)
    caption = re.sub(r"表情包$", "", caption).strip()
    story = ((image.get("story") or {}).get("zh") or "").split("。")[0][:120]
    return {
        "n": number.group(1),
        "file": f"img/{number.group(1)}.webp",
        "quote": quote.group(1).strip() if quote else "",
        "caption": caption[:120],
        "story": story,
        "preview": image["preview"],
    }


def main(root):
    os.makedirs(os.path.join(root, "img"), exist_ok=True)
    gallery = json.loads(fetch(INDEX_URL))
    memes = [m for m in (entry(i) for i in gallery["gallery"][CATEGORY]["images"]) if m]

    def download(meme):
        path = os.path.join(root, meme["file"])
        if os.path.exists(path):
            return True
        try:
            data = fetch(meme["preview"])
        except Exception as error:  # noqa: BLE001 - a missing image only drops that meme
            print("skip", meme["n"], error, file=sys.stderr)
            return False
        with open(path + ".part", "wb") as file:
            file.write(data)
        os.replace(path + ".part", path)
        return True

    with ThreadPoolExecutor(max_workers=4) as pool:
        present = list(pool.map(download, memes))
    kept = [{k: v for k, v in m.items() if k != "preview"} for m, ok in zip(memes, present) if ok]
    index = {
        "source": "梗鲸 GengJing https://aigengtu.com/ (fan-made, non-commercial use)",
        "generated_at": gallery.get("generated_at"),
        "count": len(kept),
        "memes": kept,
    }
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=root, delete=False) as file:
        json.dump(index, file, ensure_ascii=False)
        temporary = file.name
    os.replace(temporary, os.path.join(root, "index.json"))
    print(json.dumps({"memes": len(kept), "skipped": len(memes) - len(kept)}))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/var/lib/dsh/.dsh/meme-library/aigengtu")
