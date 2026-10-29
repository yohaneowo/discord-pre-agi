import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'discord.js';
import { ConfigError, readDiscordConfig } from './config.js';
import { readChatConfig } from './chat-config.js';
import { createDiscordClient } from './discord.js';
import { createLlmClient } from './llm.js';
import { UsageLedger } from './ledger.js';
import { BalanceMonitor } from './balance.js';
import { ChatEngine } from './chat.js';
import { loadPersona } from './prompt.js';

let client: Client | undefined;
let engine: ChatEngine | undefined;

try {
	const mode = process.env.BOT_MODE?.trim() || 'fixed';
	if (!['fixed', 'chat'].includes(mode))
		throw new ConfigError('BOT_MODE 必须是 fixed 或 chat');
	const discord = readDiscordConfig();
	if (mode === 'chat') {
		const config = readChatConfig();
		const persona = loadPersona(config.personaPath);
		mkdirSync(config.dataDir, { recursive: true });
		engine = new ChatEngine(
			config,
			createLlmClient(config),
			new UsageLedger(join(config.dataDir, 'usage.sqlite')),
			new BalanceMonitor(config),
			persona,
			async (content) => {
				if (!client) return;
				const owner = await client.users.fetch(config.ownerDiscordId);
				await owner.send({ content, allowedMentions: { parse: [] } });
			},
		);
	}
	client = createDiscordClient(engine);
	const activeClient = client;
	let stopping = false;
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.once(signal, () => {
			if (stopping) return;
			stopping = true;
			void (async () => {
				await engine?.shutdown();
				await activeClient.destroy();
			})().catch(() => {
				process.exitCode = 1;
			});
		});
	}
	await client.login(discord.discordToken);
} catch (error) {
	await client?.destroy();
	await engine?.shutdown();
	// 连线错误可能夹带凭证，只显示本地设定检查产生的讯息。
	console.error(
		error instanceof ConfigError
			? error.message
			: '机器人启动失败，请检查环境设定、凭证与网路。',
	);
	process.exitCode = 1;
}
