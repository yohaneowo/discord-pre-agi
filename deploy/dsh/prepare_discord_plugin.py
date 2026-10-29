"""固定上游版本并插入可独立测试的群聊发话限制，不在公开仓库收录上游代码。"""

import argparse
import hashlib
import json
import pathlib
import shutil
from social_patch import social_patch


def prepare(source, target, expected_sha256, social=False):
    package = json.loads((source / "package.json").read_text(encoding="utf-8"))
    entry = source / "lib/index.js"
    raw = entry.read_bytes()
    if package["name"] != "dsh-plugin-discord" or package["version"] != "0.6.0":
        raise ValueError("桥接版本不符，拒绝套用补丁。")
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError("上游入口 SHA256 不符，须先重新审阅。")
    content = raw.decode("utf-8").replace("\r\n", "\n")
    start = content.find('const onMessage = (message) => {')
    end = content.find('relay = new QuestionRelay({', start)
    if start < 0 or end < 0:
        raise ValueError("上游发话入口已变动，拒绝猜测替换。")
    block = content[start:end]
    replacements = [
        ('const onMessage = (message) => {', 'const deliverMessage = (message, naturalTicket) => {'),
        ('const command = parseCommand(content);\n\t\t\t\t(async () => {', 'const command = parseCommand(content);\n\t\t\t\treturn (async () => {'),
        ('await rest.createMessage(message.channel_id, chunk, index === 0 ? message.id : void 0);', 'if (!participation.canSend(message.channel_id, naturalTicket)) return;\nconst sent = await rest.createMessage(message.channel_id, chunk, index === 0 ? message.id : void 0);\nparticipation.recordReply(message.channel_id, chunk, sent.id);'),
        ('if (reply.files.length > 0) try {', 'if (!participation.canSend(message.channel_id, naturalTicket)) return;\nif (reply.files.length > 0) try {'),
    ]
    for anchor, replacement in replacements:
        if block.count(anchor) != 1:
            raise ValueError("上游发话接线已变动，拒绝套用补丁。")
        block = block.replace(anchor, replacement, 1)
    block = block.replace('participation.recordReply(message.channel_id, chunk, sent.id);', 'participation.recordReply(message.channel_id, chunk, sent.id, message.author.id);', 1)
    wrapper = '''
const participation = new NaturalParticipation({
  ctx,
  stateFile: join(dirname(resolveStateFile(config.stateFile, ctx.baseUrl)), "participation-state.json"),
  ownerIds: config.allowedUsers,
  warn: (text) => logger.warn(text),
});
const onMessage = (message) => {
  if (!isAllowed(message, botUserId, config.allowedUsers, config.allowedChannels)) return;
  void participation.receive(message, { botUserId, botName: botLabel },
    (content, ticket) => deliverMessage({ ...message, content }, ticket),
    async (text) => {
      const sent = await rest.createMessage(message.channel_id, text, message.id);
      participation.recordReply(message.channel_id, text, sent.id);
    },
  ).catch(() => logger.warn("群聊行为处理未完成，保持安静。"));
};
'''
    content = content[:start] + block + wrapper + content[end:]
    anchor = 'const command = commandFromInteraction(commandName, interaction.data?.options ?? []);'
    if content.count(anchor) != 1:
        raise ValueError("上游管理指令入口已变动，拒绝套用补丁。")
    content = content.replace(anchor, 'participation.interrupt(channelId, commandName);\n' + anchor, 1)
    content = 'import { NaturalParticipation } from "./natural-participation.mjs";\n' + content
    if social:
        content = social_patch(content)
    content = "\n".join(line for line in content.splitlines() if not line.startswith("//# sourceMappingURL=")) + "\n"
    (target / "lib").mkdir(parents=True, exist_ok=True)
    for name in ("package.json", "LICENSE", "cordis.patch.yml"):
        shutil.copyfile(source / name, target / name)
    package["version"] = "0.6.0-natural.3"
    if social:
        package["version"] = "0.6.0-social.48"
        package.setdefault("dependencies", {})["dsh-social-runtime"] = "file:/opt/dsh/vendor/social-0.1.42"
    (target / "package.json").write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (target / "lib/index.js").write_text(content, encoding="utf-8")
    shutil.copyfile(pathlib.Path(__file__).with_name("discord-policy.mjs"), target / "lib/discord-policy.mjs")
    shutil.copyfile(pathlib.Path(__file__).with_name("natural-participation.mjs"), target / "lib/natural-participation.mjs")
    print(json.dumps({"prepared": True, "upstream_sha256": expected_sha256}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("target", type=pathlib.Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--social", action="store_true")
    args = parser.parse_args()
    prepare(args.source, args.target, args.sha256, args.social)
