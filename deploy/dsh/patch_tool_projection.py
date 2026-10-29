"""修复固定版 dsh 工具迁移后所有工具都延迟声明的相容问题。"""

import argparse
import hashlib
import pathlib

EXPECTED = "d18d8ae4c8d961e628708c1e4698e09716a0ebb80e55a672e0bde1029bec1155"
ANCHOR = '''const declarations = toolDeclarations(tools, toolUpdate, history);
	const updateIds = new Set(history.updates.map((update) => update.messageId));
	const offered = new Set(history.tools.filter((tool) => !tool.deferLoading).map((tool) => tool.name));'''
REPLACEMENT = '''const declarations = toolDeclarations(tools, toolUpdate, history);
	// 群聊从完整工具迁移后，供应商仍要求至少一项立即声明的工具。
	// 只提升当前已经可用且未要求延迟的工具，不恢复已移除的权限。
	const eagerFallback = declarations.size > 0 && [...declarations.values()].every((tool) => tool.deferLoading === true)
		? tools?.find((tool) => tool.deferLoading !== true && declarations.has(tool.name))
		: undefined;
	if (eagerFallback) declarations.set(eagerFallback.name, eagerFallback);
	const updateIds = new Set(history.updates.map((update) => update.messageId));
	const offered = new Set(history.tools.filter((tool) => !tool.deferLoading).map((tool) => tool.name));
	if (eagerFallback) offered.add(eagerFallback.name);'''


def prepare(source, target):
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED:
        raise ValueError("dsh-llm 入口不符固定版本，拒绝自动修改。")
    content = raw.decode("utf-8")
    if content.count(ANCHOR) != 1:
        raise ValueError("投影函数锚点不唯一，拒绝猜测套用。")
    target.write_text(content.replace(ANCHOR, REPLACEMENT, 1), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("target", type=pathlib.Path)
    args = parser.parse_args()
    prepare(args.source, args.target)
