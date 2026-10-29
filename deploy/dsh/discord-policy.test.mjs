import assert from 'node:assert/strict';
import test from 'node:test';
import { filterDiscordMessage } from './discord-policy.mjs';

test('叫名字与回复 bot 都不需要再次提及', () => {
	const base = {
		guild_id: 'guild',
		author: { id: 'member' },
		content: '鲸鱼娘，你觉得呢？',
	};
	assert.equal(filterDiscordMessage(base, '123'), base.content);
	for (const name of ['小肥魚', '小鯨魚', '大肥鱼'])
		assert.equal(filterDiscordMessage({ ...base, content: name }, '123'), name);
	assert.equal(
		filterDiscordMessage(
			{
				...base,
				content: '继续',
				referenced_message: { author: { id: '123' } },
			},
			'123',
		),
		'继续',
	);
	assert.equal(
		filterDiscordMessage(
			{
				...base,
				content: '继续',
				referenced_message: { author: { id: 'other' } },
			},
			'123',
		),
		null,
	);
});

const message = (content, extra = {}) => ({
	guild_id: 'test-guild',
	author: { id: 'member' },
	content,
	...extra,
});

test('普通文字、全体与角色提及留待判断，明确提及属于直接呼叫', () => {
	for (const text of [
		'你好',
		'@everyone 你好',
		'<@&123> 你好',
		'<@1234> 你好',
		'/unknown',
	]) {
		assert.equal(filterDiscordMessage(message(text), '123'), null);
	}
	assert.equal(filterDiscordMessage(message('<@123> 你好'), '123'), '你好');
	assert.equal(filterDiscordMessage(message('你好 <@!123>'), '123'), '你好');
});

test('管理命令保留，但前缀碰撞不能绕过提及条件', () => {
	assert.equal(filterDiscordMessage(message('/new 测试'), '123'), '/new 测试');
	assert.equal(filterDiscordMessage(message('/new-secret'), '123'), null);
	assert.equal(
		filterDiscordMessage(message('<@123> /unknown'), '123'),
		'/unknown',
	);
});

test('机器人不回应，私聊保留普通内容；缺少 bot 身分时拒绝群聊', () => {
	assert.equal(
		filterDiscordMessage(
			message('<@123> hi', { author: { id: 'other', bot: true } }),
			'123',
		),
		null,
	);
	assert.equal(
		filterDiscordMessage(
			message('<@123> hi', { author: { id: '123' } }),
			'123',
		),
		null,
	);
	assert.equal(
		filterDiscordMessage(message('你好', { guild_id: undefined }), '123'),
		'你好',
	);
	assert.equal(filterDiscordMessage(message('<@123> hi'), undefined), null);
});
