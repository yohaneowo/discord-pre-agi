export interface DiscordConfig {
	discordToken: string;
	discordClientId: string;
	ownerDiscordId: string;
}

export interface Config extends DiscordConfig {
	llmBaseUrl: string;
	llmModel: string;
	llmApiKey: string;
	dailyBudgetUsd: number;
}

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

function requiredValue(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name]?.trim();
	if (!value) throw new ConfigError(`缺少必要环境变数：${name}`);
	return value;
}

function discordId(env: NodeJS.ProcessEnv, name: string): string {
	const value = requiredValue(env, name);
	if (!/^[1-9]\d{16,19}$/.test(value)) {
		throw new ConfigError(`${name} 必须是 17～20 位的 Discord 数字 ID`);
	}
	return value;
}

// 固定回覆只需要 Discord 设定，启用模型时再检查完整设定。
export function readDiscordConfig(
	env: NodeJS.ProcessEnv = process.env,
): DiscordConfig {
	return {
		discordToken: requiredValue(env, 'DISCORD_TOKEN'),
		discordClientId: discordId(env, 'DISCORD_CLIENT_ID'),
		ownerDiscordId: discordId(env, 'OWNER_DISCORD_ID'),
	};
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const required = (name: string) => requiredValue(env, name);
	const llmBaseUrl = required('LLM_BASE_URL');
	try {
		const url = new URL(llmBaseUrl);
		if (
			!['https:', 'http:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			throw new Error();
		}
	} catch {
		throw new ConfigError(
			'LLM_BASE_URL 必须是 HTTP(S) 网址，不能含帐号、密码、查询参数或锚点',
		);
	}
	const budget = required('DAILY_BUDGET_USD');
	const dailyBudgetUsd = Number(budget);
	if (
		!/^\d+(\.\d+)?$/.test(budget) ||
		!Number.isFinite(dailyBudgetUsd) ||
		dailyBudgetUsd <= 0
	) {
		throw new ConfigError('DAILY_BUDGET_USD 必须是大于 0 的有限十进位数字');
	}
	return {
		...readDiscordConfig(env),
		llmBaseUrl: llmBaseUrl.replace(/\/+$/, ''),
		llmModel: required('LLM_MODEL'),
		llmApiKey: required('LLM_API_KEY'),
		dailyBudgetUsd,
	};
}
