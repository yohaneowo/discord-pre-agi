import { Client, Events, GatewayIntentBits } from 'discord.js';
import type { Message } from 'discord.js';

export const placeholderReply = '咕噜，我在这儿，刚刚还在水里发呆呢。';
export const requiredIntents = [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.MessageContent,
];

export async function replyToMention(
	message: Pick<Message, 'author' | 'mentions' | 'inGuild' | 'reply'>,
	botId: string,
): Promise<void> {
	if (!message.inGuild() || message.author.bot || message.author.id === botId)
		return;
	// 仅接受讯息里的直接提及；回覆通知与全体提及不会触发。
	if (!message.mentions.parsedUsers.has(botId)) return;
	await message.reply({
		content: placeholderReply,
		allowedMentions: { parse: [], repliedUser: false },
	});
}

export function createDiscordClient(): Client {
	const client = new Client({ intents: requiredIntents });
	client.once(Events.ClientReady, () =>
		console.info('机器人已连线，等待群友提及。'),
	);
	client.on(Events.Error, () => console.error('Discord 连线发生错误。'));
	client.on(Events.MessageCreate, (message) => {
		if (!client.user) return;
		void replyToMention(message, client.user.id).catch(() => {
			console.error('无法送出回覆，请检查频道权限与连线。');
		});
	});
	return client;
}
