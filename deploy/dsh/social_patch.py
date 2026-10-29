"""固定版桥接的群聊／私人会话接线；每个接点都要求唯一匹配。"""


def once(content, anchor, replacement):
    if content.count(anchor) != 1:
        raise ValueError("桥接接口已经变动，须重新审阅。")
    return content.replace(anchor, replacement, 1)


def social_patch(content):
    content = 'import { admitSocialMessage, prepareSocialTurn, handleSocialControl, assertGroupSession, isSocialOwner, toGroupText, redactSecrets, registerDiscordRest, socialGuildOwner, socialChannelLabel, socialConsolidate, socialImageNotes, prepareGroupReply, registerDiscordGateway, socialPresence, socialArchive, settleSocialTurn, extractSocialReply } from "dsh-social-runtime/bridge";\n' + content
    # 群聊：文字照常回覆（繁体、遮机密），[sticker:…] 换成的表情 GIF 另发一则附件；私讯只遮机密。
    # 群聊里桥接自己的回合提示（失败、取消、没有文字）不发出去，交给群聊行为处理（失败时她自己说一句）。
    # 「回复」由她自己选：回话开头写 [回覆 #編號] 才挂到那一则，没写就是一般讯息（以前一律挂在叫她的那则）。
    # 她这句在跟谁说话（之后的续聊对象）也跟着她回覆或 @ 的人走。
    content = once(content, 'const sent = await rest.createMessage(message.channel_id, chunk, index === 0 ? message.id : void 0);', '''if (message.guild_id !== void 0 && participation.turnNotice(message.channel_id, chunk)) continue;
const target = message.guild_id === void 0 ? { text: chunk } : participation.replyTarget(message.channel_id, chunk);
const prepared = message.guild_id === void 0 ? { text: redactSecrets(chunk), files: [] } : await prepareGroupReply(target.text);
let sent;
if (prepared.text.trim()) sent = await rest.createMessage(message.channel_id, prepared.text, target.messageId);
if (prepared.files.length) sent = (await rest.createMessageWithFiles(message.channel_id, "", prepared.files)) ?? sent;
if (!sent) continue;''')
    content = once(content, 'participation.recordReply(message.channel_id, chunk, sent.id, message.author.id);', 'participation.recordReply(message.channel_id, target.text, sent.id, participation.replyPartner(target, message.author.id), target.messageId, index === 0);')
    content = once(content, 'return allowedUsers.length === 0 || allowedUsers.includes(message.author.id);', 'return true;')
    # 群聊自动开新会话时不发「(已自动新建会话 …)」：那是给管理用的讯息，群友不需要看到。
    content = once(content, 'const preamble = created && title !== void 0 ?', 'const preamble = this.config.preset !== "whale-social" && created && title !== void 0 ?')
    # huanqi（换气）在回合结束后另开的补救轮：等它跑完，取回答时也算进去，补救的回答才传得到 Discord。
    content = once(content, 'const flushable = this.ctx.get("sessions");', 'await settleSocialTurn(agent);\nconst flushable = this.ctx.get("sessions");')
    content = once(content, 'const reply = extractReply(events, promptSeq);', 'const reply = extractSocialReply(events, promptSeq);')
    # 频道白名单含 "*" 就是所有服务器的所有频道；私讯仍只收拥有者。
    content = once(content, 'if (!allowedChannels.includes(message.channel_id)) return false;', 'if (!allowedChannels.includes("*") && !allowedChannels.includes(message.channel_id)) return false;')
    # 斜线指令的回覆（例如 /new 的「已新建会话」）在群里也转繁体。
    content = once(content, 'const [first, ...others] = reply.chunks;', 'const [first, ...others] = interaction.guild_id === void 0 ? reply.chunks.map((chunk) => redactSecrets(chunk)) : await Promise.all(reply.chunks.map((chunk) => toGroupText(chunk)));')
    # 群聊收图片（存进工作目录 .discord-uploads，她用 read_image 看）；送附件只走 discord_send_message。
    # 桥接「怎么传档案」的提示讲的是 [discord-file:] 送档，群聊用不到，不注入。
    content = once(content, 'if (this.noticed.has(agent)) return;', 'if (this.config.preset === "whale-social" || this.noticed.has(agent)) return;')
    content = once(content, 'maxUploadBytes: config.maxUploadBytes,\n\t\t\t\t\tuploadRoots: config.uploadRoots,\n\t\t\t\t\tmaxIncomingBytes: config.maxIncomingBytes', 'maxUploadBytes: 0,\n\t\t\t\t\tuploadRoots: [],\n\t\t\t\t\tmaxIncomingBytes: Math.min(config.maxIncomingBytes, 8e6)')
    content = once(content, 'const composition = await this.composeSetup(storedPreset);', 'const composition = await this.composeSetup(this.config.preset === "whale-social" ? this.config.preset : storedPreset);')
    content = once(content, 'return service.currentSelection();', 'return { ...service.currentSelection(), ...(this.config.preset === "whale-social" ? { reasoningEffort: "off" } : {}) };')
    content = once(content, '...logged.reasoningEffort === void 0 ? {} : { reasoningEffort: logged.reasoningEffort }', '...logged.reasoningEffort === void 0 ? {} : { reasoningEffort: logged.reasoningEffort }, ...(bridge.config.preset === "whale-social" ? { reasoningEffort: "off" } : {})')
    # 群聊回话长短靠人设控制；上限只在她写长指令、拆帧分析时用得到（1024 曾让这类回合失败）。
    content = once(content, 'return {\n\t\t\tprovider,\n\t\t\tmodel\n\t\t};', 'return { provider, model, maxTokens: this.config.preset === "whale-social" ? 4096 : 2048, ...(this.config.preset === "whale-social" ? { reasoningEffort: "off" } : {}) };')
    # 讯息被编辑：闸道转给群聊行为处理（MESSAGE_CONTENT intent 已开，编辑事件带得到新内容）。
    content = once(content, 'case "INTERACTION_CREATE": {', '''case "MESSAGE_UPDATE": {
\t\t\t\tconst data = payload.d;
\t\t\t\tif (typeof data.id === "string" && typeof data.channel_id === "string") this.options.hooks.onMessageUpdate?.(data);
\t\t\t\treturn;
\t\t\t}
\t\t\tcase "MESSAGE_DELETE":
\t\t\tcase "MESSAGE_DELETE_BULK": {
\t\t\t\tconst data = payload.d;
\t\t\t\tif (typeof data.channel_id === "string") this.options.hooks.onMessageDelete?.(data);
\t\t\t\treturn;
\t\t\t}
\t\t\tcase "INTERACTION_CREATE": {''')
    content = once(content, 'onMessage,\n\t\t\t\t\tonInteraction,', 'onMessage,\n\t\t\t\t\tonMessageUpdate,\n\t\t\t\t\tonMessageDelete,\n\t\t\t\t\tonInteraction,')
    # 她改的状态（discord_edit_me）：闸道交给群聊插件送 op 3；重新登入时 identify 带上存档的状态。
    content = once(content, 'onReady: (ready) => {', 'onReady: (ready) => {\nregisterDiscordGateway(gateway);')
    content = once(content, 'intents: INTENTS.GUILDS | INTENTS.GUILD_MESSAGES', 'presence: () => socialPresence(),\n\t\t\t\tintents: INTENTS.GUILDS | INTENTS.GUILD_MESSAGES')
    content = once(content, 'intents: this.intents,', '...(this.options.presence?.() ? { presence: this.options.presence() } : {}),\n\t\t\t\tintents: this.intents,')
    content = once(content, 'agent.followup(this.userMessage([{', 'prepareSocialTurn(agent, channelId, messageId);\nagent.followup(this.userMessage([{')
    content = once(content, 'const agent = await this.acquire(rawId);', 'if (this.config.preset === "whale-social") await assertGroupSession(this.ctx, rawId, this.config.cwd);\nconst agent = await this.acquire(rawId);')
    content = once(content, '.filter((header) => boundIds.has(header.id))', '.filter((header) => boundIds.has(header.id) && header.cwd === this.config.cwd)')
    content = once(content, 'const reply = await bridge.handle(command, message.channel_id, message.id,', 'const reply = await (message.guild_id === void 0 ? ownerBridge : bridge).handle(command, message.channel_id, message.id,')
    content = once(content, 'const reply = await bridge.handle(command, channelId, interaction.id,', 'const reply = await (interaction.guild_id === void 0 ? ownerBridge : bridge).handle(command, channelId, interaction.id,')
    content = once(content, 'const channelId = interaction.channel_id ?? "";', '''const channelId = interaction.channel_id ?? "";
if (!isSocialOwner(author.id)) {
  void rest.ackEphemeral(interaction.id, interaction.token, "管理命令与确认操作只供拥有者使用。").catch(() => {});
  return;
}''')
    content = once(content, 'participation.interrupt(channelId, commandName);', 'if (!admitSocialMessage({ ...admission, id: interaction.id, content: "/" + commandName })) return;\nparticipation.interrupt(channelId, commandName);')
    start = content.index('const participation = new NaturalParticipation({')
    end = content.index('relay = new QuestionRelay({', start)
    wrapper = '''registerDiscordRest(rest);
const ownerBridge = new SessionBridge({
  ctx, host, store,
  config: { cwd: join(dirname(config.cwd), "owner"), preset: "whale-owner", titlePrefix: "[私人] ", maxChunksPerReply: config.maxChunksPerReply, maxUploadBytes: config.maxUploadBytes, uploadRoots: [], maxIncomingBytes: config.maxIncomingBytes },
  log: (level, text) => logger[level](text),
});
const participation = new NaturalParticipation({
  ctx,
  stateFile: join(dirname(resolveStateFile(config.stateFile, ctx.baseUrl)), "participation-state.json"),
  ownerIds: config.allowedUsers,
  warn: (text) => logger.warn(text),
  guildOwner: (guildId) => socialGuildOwner(guildId),
  channelLabel: (channelId) => socialChannelLabel(channelId),
  consolidate: (lines, place, options) => socialConsolidate(lines, place, options),
  seenImages: (message) => socialImageNotes(message),
  fetchRecent: (channelId, before) => rest.request("GET", `/channels/${channelId}/messages?limit=20&before=${before}`),
});
const onMessage = (message) => {
  // 原文帐本收全部：群聊、私讯、她自己发的，都在过滤之前记下。
  socialArchive("message", message);
  if (!isAllowed(message, botUserId, config.allowedUsers, config.allowedChannels)) return;
  if (!admitSocialMessage(message)) return;
  const controlReply = async (text) => {
    const sent = await rest.createMessage(message.channel_id, message.guild_id === void 0 ? redactSecrets(text) : await toGroupText(text), message.id);
    participation.recordReply(message.channel_id, text, sent.id);
  };
  void (async () => {
    if (await handleSocialControl(message, controlReply)) return;
    await participation.receive(message, { botUserId, botName: botLabel },
      (text, ticket) => deliverMessage({ ...message, content: text, attachments: [...(message.attachments ?? []), ...(message.referenced_message?.attachments ?? [])] }, ticket), controlReply);
  })().catch(() => logger.warn("群聊行为处理未完成，保持安静。"));
};
const onMessageDelete = (data) => socialArchive("delete", data);
const onMessageUpdate = (message) => {
  if (typeof message.content === "string" && message.author) socialArchive("edit", message);
  if (message.guild_id === void 0 || !message.author || typeof message.content !== "string") return;
  if (!isAllowed(message, botUserId, config.allowedUsers, config.allowedChannels)) return;
  if (!admitSocialMessage(message)) return;
  const controlReply = async (text) => {
    const sent = await rest.createMessage(message.channel_id, await toGroupText(text), message.id);
    participation.recordReply(message.channel_id, text, sent.id);
  };
  // 附件在原讯息时已经收过，编辑时不再下载。
  void participation.receiveEdit(message, { botUserId, botName: botLabel },
    (text, ticket) => deliverMessage({ ...message, content: text, attachments: [] }, ticket), controlReply)
    .catch(() => logger.warn("编辑讯息处理未完成，保持安静。"));
};
'''
    return content[:start] + wrapper + content[end:]
