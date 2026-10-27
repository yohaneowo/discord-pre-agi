import { Collection, GatewayIntentBits } from 'discord.js';
import type { Message, User } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
	placeholderReply,
	replyToMention,
	requiredIntents,
} from '../src/discord.js';

const botId = '123456789012345678';

function fakeMessage({
	bot = false,
	authorId = '987654321098765432',
	mentioned = true,
	guild = true,
} = {}) {
	const reply = vi.fn().mockResolvedValue(undefined);
	const message = {
		author: { id: authorId, bot },
		mentions: {
			parsedUsers: new Collection<string, User>(
				mentioned ? [[botId, {} as User]] : [],
			),
		},
		inGuild: () => guild,
		reply,
	} as unknown as Message;
	return { message, reply };
}

describe('Discord 阶段 0 提及回应', () => {
	it('被直接提及时只送出固定一句话，关闭提及通知', async () => {
		const { message, reply } = fakeMessage();
		await replyToMention(message, botId);
		expect(reply).toHaveBeenCalledExactlyOnceWith({
			content: placeholderReply,
			allowedMentions: { parse: [], repliedUser: false },
		});
	});
	it.each([
		{ bot: true },
		{ authorId: botId },
		{ mentioned: false },
		{ guild: false },
	])('忽略其他 bot、自身、未直接提及或私讯', async (options) => {
		const { message, reply } = fakeMessage(options);
		await replyToMention(message, botId);
		expect(reply).not.toHaveBeenCalled();
	});
	it('仅要求指定的三个 intents', () => {
		expect(requiredIntents).toEqual([
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
		]);
	});
});
