import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlmClient } from '../src/llm.js';

const config = {
	llmBaseUrl: 'https://example.invalid/v1/',
	llmModel: '测试模型',
	llmApiKey: '测试凭证',
};
const usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 };
const completion = { choices: [{ message: { content: '咕噜。' } }], usage };
const messages = [{ role: 'user', content: '你好' }] as const;

afterEach(() => vi.useRealTimers());

describe('使用假 fetch 的模型客户端', () => {
	it('送出 OpenAI 相容请求并回传内容与用量', async () => {
		const fakeFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(completion));
		const result = await createLlmClient(config, { fetch: fakeFetch }).complete(
			messages,
		);
		expect(result).toEqual({ content: '咕噜。', usage });
		expect(fakeFetch).toHaveBeenCalledWith(
			'https://example.invalid/v1/chat/completions',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer 测试凭证',
				},
				body: JSON.stringify({
					model: config.llmModel,
					messages,
					stream: false,
				}),
				redirect: 'error',
			}),
		);
	});
	it('保留 DeepSeek 的缓存命中与未命中用量，包含零', async () => {
		const cachedUsage = {
			...usage,
			prompt_cache_hit_tokens: 0,
			prompt_cache_miss_tokens: 12,
		};
		const fakeFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json({ ...completion, usage: cachedUsage }));
		expect(
			(await createLlmClient(config, { fetch: fakeFetch }).complete(messages))
				.usage,
		).toEqual(cachedUsage);
	});
	it.each([401, 429, 500])('处理 HTTP %s 且不泄露错误本文', async (status) => {
		const fakeFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('不可回显的服务端资料', { status }));
		await expect(
			createLlmClient(config, { fetch: fakeFetch }).complete(messages),
		).rejects.toMatchObject({
			code: 'http',
			status,
			message: `模型请求失败（HTTP ${status}）`,
		});
	});
	it('处理非 JSON 回应', async () => {
		const fakeFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('<html>错误</html>'));
		await expect(
			createLlmClient(config, { fetch: fakeFetch }).complete(messages),
		).rejects.toMatchObject({ code: 'format' });
	});
	it.each([
		null,
		{ choices: [] },
		{ ...completion, choices: [{ message: { content: null } }] },
		{ ...completion, usage: null },
		{ ...completion, usage: { ...usage, prompt_tokens: -1 } },
		{ ...completion, usage: { ...usage, total_tokens: '15' } },
		{ ...completion, usage: { ...usage, completion_tokens: 1.5 } },
		{ ...completion, usage: { ...usage, prompt_cache_hit_tokens: '0' } },
		{ ...completion, usage: { ...usage, prompt_cache_miss_tokens: -2 } },
	])('拒绝错误的内容或用量格式', async (value) => {
		const fakeFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(value));
		await expect(
			createLlmClient(config, { fetch: fakeFetch }).complete(messages),
		).rejects.toMatchObject({ code: 'format' });
	});
	it('处理网路异常且不泄露底层错误', async () => {
		const fakeFetch = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new Error('不可回显的连线资料'));
		await expect(
			createLlmClient(config, { fetch: fakeFetch }).complete(messages),
		).rejects.toMatchObject({ code: 'network', message: '无法连接模型服务' });
	});
	it.each(['请求', '回应本文'])('逾时会中止%s', async (stage) => {
		vi.useFakeTimers();
		const fakeFetch = vi
			.fn<typeof fetch>()
			.mockImplementation(async (_input, init) => {
				const stalled = new Promise<never>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('测试中止', 'AbortError')),
					);
				});
				if (stage === '请求') return stalled;
				return { ok: true, json: () => stalled } as unknown as Response;
			});
		const pending = createLlmClient(config, {
			fetch: fakeFetch,
			timeoutMs: 50,
		}).complete(messages);
		const assertion = expect(pending).rejects.toMatchObject({
			code: 'timeout',
		});
		await vi.advanceTimersByTimeAsync(50);
		await assertion;
		expect(vi.getTimerCount()).toBe(0);
	});
	it('成功后清除逾时计时器', async () => {
		vi.useFakeTimers();
		const fakeFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(completion));
		await createLlmClient(config, { fetch: fakeFetch }).complete(messages);
		expect(vi.getTimerCount()).toBe(0);
	});
});
