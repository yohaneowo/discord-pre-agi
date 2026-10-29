import { ConfigError, readConfig } from './config.js';
import type { Config } from './config.js';

export interface Prices {
	input: number;
	cache: number;
	output: number;
}

export interface ChatConfig extends Config {
	botNames: string[];
	personaPath: string | undefined;
	dataDir: string;
	timeZone: string;
	quietStart: number;
	quietEnd: number;
	cooldownMs: number;
	decisionIntervalMs: number;
	dailyProactiveLimit: number;
	maxOutputTokens: number;
	prices: Prices;
	deepseekOfficial: boolean;
}

export function readChatConfig(
	env: NodeJS.ProcessEnv = process.env,
): ChatConfig {
	const config = readConfig(env);
	const integer = (
		name: string,
		fallback: number,
		min: number,
		max: number,
	) => {
		const value = env[name]?.trim();
		const result = value ? Number(value) : fallback;
		if (!Number.isSafeInteger(result) || result < min || result > max)
			throw new ConfigError(`${name} 必须是 ${min}～${max} 的整数`);
		return result;
	};
	const timeZone = env.BOT_TIMEZONE?.trim() || 'Asia/Taipei';
	try {
		new Intl.DateTimeFormat('en', { timeZone }).format();
	} catch {
		throw new ConfigError('BOT_TIMEZONE 必须是有效时区');
	}
	const url = new URL(config.llmBaseUrl);
	const deepseekOfficial =
		url.origin === 'https://api.deepseek.com' &&
		['/', '/v1', '/v1/'].includes(url.pathname);
	const official: Record<string, Prices> = {
		'deepseek-flash': { cache: 0.006, input: 0.3, output: 1.2 },
		'deepseek-v4-pro': { cache: 0.044, input: 1.32, output: 3.96 },
	};
	const priceNames = [
		'LLM_INPUT_USD_PER_M',
		'LLM_CACHE_USD_PER_M',
		'LLM_OUTPUT_USD_PER_M',
	];
	const supplied = priceNames.filter((name) => env[name]?.trim());
	let prices = deepseekOfficial ? official[config.llmModel] : undefined;
	if (supplied.length) {
		if (supplied.length !== priceNames.length)
			throw new ConfigError('自订计价必须同时填写三个 LLM_*_USD_PER_M 栏位');
		const values = priceNames.map((name) => Number(env[name]));
		if (
			values.some(
				(value) => !Number.isFinite(value) || value < 0 || value > 1000,
			)
		)
			throw new ConfigError('自订 token 价格必须为 0～1000 的数字');
		prices = { input: values[0]!, cache: values[1]!, output: values[2]! };
	} else if (!prices) {
		throw new ConfigError(
			'未知供应商或模型的价格为 TBD，请填写三个 LLM_*_USD_PER_M 栏位',
		);
	}
	if (config.dailyBudgetUsd > 10000)
		throw new ConfigError('DAILY_BUDGET_USD 不可超过 10000');
	return {
		...config,
		botNames: (env.BOT_NAMES || '')
			.split(',')
			.map((name) => name.trim())
			.filter(Boolean),
		personaPath: env.PERSONA_PATH?.trim() || undefined,
		dataDir: env.DATA_DIR?.trim() || 'data',
		timeZone,
		quietStart: integer('QUIET_START_HOUR', 0, 0, 23),
		quietEnd: integer('QUIET_END_HOUR', 8, 0, 23),
		cooldownMs: integer('PROACTIVE_COOLDOWN_MINUTES', 10, 1, 1440) * 60000,
		decisionIntervalMs:
			integer('DECISION_INTERVAL_SECONDS', 60, 1, 3600) * 1000,
		dailyProactiveLimit: integer('DAILY_PROACTIVE_LIMIT', 10, 0, 1000),
		maxOutputTokens: integer('MAX_OUTPUT_TOKENS', 512, 32, 2048),
		prices,
		deepseekOfficial,
	};
}
