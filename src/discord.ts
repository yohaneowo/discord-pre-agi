import {
	Client,
	Events,
	GatewayIntentBits,
	MessageFlags,
	SlashCommandBuilder,
} from 'discord.js';
import type { Message } from 'discord.js';
import type { ChatEngine } from './chat.js';
import { callsByName } from './chat.js';

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

export function createDiscordClient(engine?: ChatEngine): Client {
	const client = new Client({ intents: requiredIntents });
	client.once(Events.ClientReady, () => {
		console.info(
			engine
				? '机器人已连线，模型聊天模式已启用。'
				: '机器人已连线，等待群友提及。',
		);
		if (!engine) return;
		if (client.user?.id !== engine.config.discordClientId) {
			console.error('应用程式 ID 与目前 bot 不一致，已停止连线。');
			void client
				.destroy()
				.then(() => engine.shutdown())
				.catch(() => {});
			return;
		}
		void (async () => {
			await engine.initialize();
			const commands = [
				new SlashCommandBuilder()
					.setName('费用')
					.setNameLocalizations({ 'zh-TW': '費用' })
					.setDescription('给主人查看模型用量、预算与余额')
					.setContexts(0),
				new SlashCommandBuilder()
					.setName('安静')
					.setNameLocalizations({ 'zh-TW': '安靜' })
					.setDescription('暂停主动插话，直接叫我仍会回应')
					.setContexts(0)
					.addIntegerOption((option) =>
						option
							.setName('分钟')
							.setNameLocalizations({ 'zh-TW': '分鐘' })
							.setDescription('安静多久')
							.setMinValue(1)
							.setMaxValue(1440)
							.setRequired(true),
					),
			];
			for (const command of commands)
				await client.application!.commands.create(command);
			console.info('主人指令已注册。');
		})().catch(() =>
			console.error('模型初始化或指令注册失败，请检查设定与应用程式安装权限。'),
		);
		const timer = setInterval(() => {
			void engine
				.initialize()
				.catch(() => console.error('余额检查失败，模型呼叫将保守暂停。'));
		}, 60000);
		timer.unref();
		client.once(Events.Invalidated, () => clearInterval(timer));
	});
	client.on(Events.Error, () => console.error('Discord 连线发生错误。'));
	client.on(Events.MessageCreate, (message) => {
		if (!client.user) return;
		const botId = client.user.id;
		if (
			engine &&
			message.inGuild() &&
			!message.author.bot &&
			message.author.id !== botId &&
			message.content.trim()
		) {
			const names = [
				...engine.config.botNames,
				client.user.username,
				client.user.globalName ?? '',
				message.guild.members.me?.displayName ?? '',
			].filter(Boolean);
			void engine
				.handle({
					id: message.id,
					channelId: message.channelId,
					authorId: message.author.id,
					authorName:
						message.member?.displayName ??
						message.author.globalName ??
						message.author.username,
					content: message.content,
					directed:
						message.mentions.parsedUsers.has(botId) ||
						message.mentions.repliedUser?.id === botId ||
						callsByName(message.content, names),
					reply: async (content) =>
						message.reply({
							content,
							allowedMentions: { parse: [], repliedUser: false },
						}),
				})
				.catch(() => console.error('频道回覆失败，请检查频道权限。'));
			return;
		}
		if (engine) return;
		void replyToMention(message, botId).catch(() => {
			console.error('无法送出回覆，请检查频道权限与连线。');
		});
	});
	client.on(Events.InteractionCreate, (interaction) => {
		if (
			!engine ||
			!interaction.isChatInputCommand() ||
			!['费用', '安静'].includes(interaction.commandName)
		)
			return;
		void (async () => {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const result = await engine.ownerCommand(
				interaction.user.id,
				interaction.commandName,
				interaction.commandName === '安静'
					? interaction.options.getInteger('分钟', true)
					: undefined,
			);
			await interaction.editReply({
				content: result,
				allowedMentions: { parse: [] },
			});
		})().catch(() => console.error('主人指令执行失败。'));
	});
	return client;
}
