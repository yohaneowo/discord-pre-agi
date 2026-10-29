import type { Config } from './config.js';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface TokenUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_cache_hit_tokens?: number;
	prompt_cache_miss_tokens?: number;
}

export type LlmErrorCode = 'timeout' | 'http' | 'format' | 'network';

export class LlmError extends Error {
	constructor(
		public readonly code: LlmErrorCode,
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = 'LlmError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCompletion(value: unknown): {
	content: string;
	usage: TokenUsage;
} {
	const invalid = () =>
		new LlmError('format', '模型回传格式错误：需要文字内容与有效的 token 用量');
	if (!isRecord(value) || !Array.isArray(value.choices)) throw invalid();
	const choice: unknown = value.choices[0];
	if (
		!isRecord(choice) ||
		!isRecord(choice.message) ||
		typeof choice.message.content !== 'string'
	)
		throw invalid();
	const raw = value.usage;
	if (!isRecord(raw)) throw invalid();
	const count = (key: string): number => {
		const token = raw[key];
		if (typeof token !== 'number' || !Number.isSafeInteger(token) || token < 0)
			throw invalid();
		return token;
	};
	const usage: TokenUsage = {
		prompt_tokens: count('prompt_tokens'),
		completion_tokens: count('completion_tokens'),
		total_tokens: count('total_tokens'),
	};
	if (raw.prompt_cache_hit_tokens !== undefined)
		usage.prompt_cache_hit_tokens = count('prompt_cache_hit_tokens');
	if (raw.prompt_cache_miss_tokens !== undefined)
		usage.prompt_cache_miss_tokens = count('prompt_cache_miss_tokens');
	if (
		usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens ||
		(usage.prompt_cache_hit_tokens ?? 0) > usage.prompt_tokens ||
		(usage.prompt_cache_miss_tokens ?? 0) > usage.prompt_tokens ||
		(usage.prompt_cache_hit_tokens !== undefined &&
			usage.prompt_cache_miss_tokens !== undefined &&
			usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens !==
				usage.prompt_tokens)
	)
		throw invalid();
	return { content: choice.message.content, usage };
}

export function createLlmClient(
	config: Pick<Config, 'llmBaseUrl' | 'llmModel' | 'llmApiKey'>,
	options: { fetch?: typeof fetch; timeoutMs?: number } = {},
) {
	const fetchImpl = options.fetch ?? fetch;
	const timeoutMs = options.timeoutMs ?? 30_000;
	if (
		!Number.isSafeInteger(timeoutMs) ||
		timeoutMs <= 0 ||
		timeoutMs > 2_147_483_647
	) {
		throw new Error('模型逾时毫秒数必须是有效的正整数');
	}
	return {
		async complete(
			messages: readonly ChatMessage[],
			request: { maxTokens?: number; nonThinking?: boolean } = {},
		) {
			if (
				request.maxTokens !== undefined &&
				(!Number.isSafeInteger(request.maxTokens) || request.maxTokens < 1)
			)
				throw new Error('输出 token 上限必须是正整数');
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetchImpl(
					`${config.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${config.llmApiKey}`,
						},
						body: JSON.stringify({
							model: config.llmModel,
							messages,
							stream: false,
							...(request.maxTokens === undefined
								? {}
								: { max_tokens: request.maxTokens }),
							...(request.nonThinking
								? { thinking: { type: 'disabled' } }
								: {}),
						}),
						signal: controller.signal,
						redirect: 'error',
					},
				);
				if (!response.ok) {
					await response.body?.cancel();
					throw new LlmError(
						'http',
						`模型请求失败（HTTP ${response.status}）`,
						response.status,
					);
				}
				let value: unknown;
				try {
					value = await response.json();
				} catch (error) {
					if (error instanceof SyntaxError)
						throw new LlmError('format', '模型回传格式错误：不是有效 JSON');
					throw error;
				}
				return parseCompletion(value);
			} catch (error) {
				if (controller.signal.aborted)
					throw new LlmError('timeout', '模型请求逾时');
				if (error instanceof LlmError) throw error;
				throw new LlmError('network', '无法连接模型服务');
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
