// 对实际安装的桥接模块验证权限与提及组合，不连接 gateway 或发送消息。
import assert from 'node:assert/strict';
import { log } from 'node:console';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';

const profile = process.argv[2] ?? '/var/lib/dsh/.dsh/profiles/web';
const entry = createRequire(`${profile}/package.json`).resolve(
	'dsh-plugin-discord',
);
const { isAllowed } = await import(pathToFileURL(entry).href);
const { filterDiscordMessage } = await import(
	new URL('./discord-policy.mjs', pathToFileURL(entry)).href
);
const compiled = await readFile(entry, 'utf8');
const social = compiled.includes(
	'prepareSocialTurn(agent, channelId, messageId)',
);
const make = (extra = {}) => ({
	guild_id: 'guild',
	channel_id: 'room',
	content: '<@123> 你好',
	author: { id: 'owner' },
	...extra,
});
const admitted = (message) =>
	isAllowed(message, '123', ['owner'], ['room']) &&
	filterDiscordMessage(message, '123') !== null;
assert.equal(admitted(make()), true);
assert.equal(admitted(make({ author: { id: 'stranger' } })), social);
assert.equal(admitted(make({ channel_id: 'other-room' })), false);
assert.equal(admitted(make({ author: { id: 'owner', bot: true } })), false);
assert.equal(admitted(make({ content: '没有提及' })), false);
assert.equal(admitted(make({ content: '鲸鱼娘，你好' })), true);
assert.equal(
	admitted(
		make({ content: '继续聊', referenced_message: { author: { id: '123' } } }),
	),
	true,
);
assert.equal(admitted(make({ guild_id: undefined, content: '私聊' })), true);
assert.equal(
	admitted(make({ guild_id: undefined, author: { id: 'stranger' } })),
	false,
);
if (social) {
	const { SocialRuntime } = await import(
		pathToFileURL(
			createRequire(`${profile}/package.json`).resolve('dsh-social-runtime'),
		).href
	);
	const { mkdtemp, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join, resolve, sep } = await import('node:path');
	const root = await mkdtemp(join(tmpdir(), 'dsh-verify-social-'));
	try {
		const runtime = new SocialRuntime(
			{},
			{
				stateRoot: root,
				ownerIds: ['owner'],
				allowedChannels: ['room'],
				groupCwd: '/srv/dsh/discord',
			},
			{},
		);
		assert.equal(
			runtime.admit(
				make({
					author: { id: 'stranger' },
					id: 'ordinary',
					content: '鲸鱼娘，你好',
				}),
			),
			true,
		);
		assert.equal(
			runtime.admit(
				make({ author: { id: 'stranger' }, id: 'command', content: '/new' }),
			),
			false,
		);
		assert.equal(
			runtime.admit(
				make({ author: { id: 'stranger' }, id: 'dm', guild_id: undefined }),
			),
			false,
		);
		const group = { session: { header: { cwd: '/srv/dsh/discord' } } };
		for (const name of [
			'bash',
			'read_file',
			'write_file',
			'run_code',
			'web_search',
			'subagent',
		])
			assert.ok(runtime.toolGuard({ name, agent: group }));
		assert.equal(
			runtime.toolGuard({ name: 'remember', agent: group }),
			undefined,
		);
	} finally {
		assert.ok(
			resolve(root).startsWith(resolve(tmpdir()) + sep + 'dsh-verify-social-'),
		);
		await rm(root, { recursive: true });
	}
}
assert.ok(compiled.includes('new NaturalParticipation('));
assert.ok(compiled.includes('participation.receive(message'));
assert.ok(compiled.includes('participation.recordReply('));
log(
	JSON.stringify({
		installed_bridge_policy_checks: 'passed',
		ordinary_members: social ? 'chat_only' : 'denied',
		unauthorized_controls_and_channels: 'denied',
		gateway_connections_created: 0,
	}),
);
