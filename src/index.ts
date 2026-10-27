import { ConfigError, readConfig } from './config.js';
import { createDiscordClient } from './discord.js';

const client = createDiscordClient();

try {
	const config = readConfig();
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.once(signal, () => client.destroy());
	}
	await client.login(config.discordToken);
} catch (error) {
	await client.destroy();
	// 连线错误可能夹带凭证，只显示本地设定检查产生的讯息。
	console.error(
		error instanceof ConfigError
			? error.message
			: '机器人启动失败，请检查环境设定、凭证与网路。',
	);
	process.exitCode = 1;
}
