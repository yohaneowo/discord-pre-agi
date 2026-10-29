// 直接呼叫优先进入会话；未直接呼叫的群聊交给另一层有限度的插话判断。
const commands =
	/^\/(?:new|sessions|list|use|switch|resume|current|session|stop|cancel|help)(?:\s|$)/i;

export const defaultNames = [
	'鲸鱼娘',
	'鯨魚娘',
	'大肥鱼',
	'大肥魚',
	'小鲸鱼',
	'小鯨魚',
	'小肥鱼',
	'小肥魚',
];

export function filterDiscordMessage(message, botUserId, names = defaultNames) {
	if (message.author?.bot || message.author?.id === botUserId) return null;
	const content = String(message.content ?? '').trim();
	if (message.guild_id === undefined) return content || null;
	if (commands.test(content)) return content;
	if (!botUserId || !/^\d+$/.test(botUserId)) return null;
	const mentions = [`<@${botUserId}>`, `<@!${botUserId}>`];
	const calledByName = names.some(
		(name) =>
			name && content.toLocaleLowerCase().includes(name.toLocaleLowerCase()),
	);
	const repliedToBot = message.referenced_message?.author?.id === botUserId;
	if (
		!mentions.some((mention) => content.includes(mention)) &&
		!calledByName &&
		!repliedToBot
	)
		return null;
	const prompt = mentions
		.reduce((text, mention) => text.replaceAll(mention, ''), content)
		.trim();
	return prompt || '有人在群里提及了你，请简短回应。';
}
