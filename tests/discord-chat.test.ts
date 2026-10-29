import { Collection, Events, MessageFlags } from 'discord.js';
import type {
	ChatInputCommandInteraction,
	ClientUser,
	Message,
	User,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createDiscordClient } from '../src/discord.js';
import type { ChatEngine } from '../src/chat.js';
import { chatConfig } from './chat-fixture.js';

describe('Discord 聊天接线', () => {
	it.each(['直接提及', '回覆 bot', '叫名字'])(
		'%s 都触发回应，关闭回覆的提及通知',
		async (kind) => {
			const config = chatConfig({ BOT_NAMES: '鲸鲸' });
			const handle = vi.fn<ChatEngine['handle']>().mockResolvedValue(undefined);
			const engine = { config, handle } as unknown as ChatEngine;
			const client = createDiscordClient(engine);
			client.user = {
				id: config.discordClientId,
				username: '测试机器人',
			} as ClientUser;
			const reply = vi.fn(async () => ({ id: 'sent' }));
			try {
				const message = {
					id: 'message',
					channelId: 'room',
					content: kind === '叫名字' ? '鲸鲸来聊聊' : '你好',
					author: { id: 'member', bot: false, username: '群友' },
					mentions: {
						parsedUsers: new Collection(
							kind === '直接提及' ? [[config.discordClientId, {} as User]] : [],
						),
						repliedUser:
							kind === '回覆 bot' ? { id: config.discordClientId } : null,
					},
					guild: { members: { me: { displayName: '测试机器人' } } },
					inGuild: () => true,
					reply,
				} as unknown as Message<true>;
				client.emit(Events.MessageCreate, message);
				expect(handle).toHaveBeenCalledWith(
					expect.objectContaining({ directed: true }),
				);
				await handle.mock.calls[0]![0].reply('测试回覆');
				expect(reply).toHaveBeenCalledWith({
					content: '测试回覆',
					allowedMentions: { parse: [], repliedUser: false },
				});
			} finally {
				await client.destroy();
			}
		},
	);
	it('主人指令使用仅操作者可见的回覆', async () => {
		const ownerCommand = vi.fn(async () => '费用资讯');
		const client = createDiscordClient({
			ownerCommand,
		} as unknown as ChatEngine);
		const deferReply = vi.fn(async () => {});
		const editReply = vi.fn(async () => {});
		try {
			client.emit(Events.InteractionCreate, {
				isChatInputCommand: () => true,
				commandName: '费用',
				user: { id: 'operator' },
				deferReply,
				editReply,
			} as unknown as ChatInputCommandInteraction);
			await vi.waitFor(() => expect(editReply).toHaveBeenCalled());
			expect(deferReply).toHaveBeenCalledWith({
				flags: MessageFlags.Ephemeral,
			});
			expect(ownerCommand).toHaveBeenCalledWith('operator', '费用', undefined);
		} finally {
			await client.destroy();
		}
	});
});
