import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createLlmClient } from '../src/llm.js';

describe('模型客户端的本机 HTTP 验收', () => {
	it('以真实 fetch 送出请求并读取假伺服器的内容与缓存用量', async () => {
		const requests: { method?: string; url?: string; body: string }[] = [];
		const usage = {
			prompt_tokens: 12,
			completion_tokens: 3,
			total_tokens: 15,
			prompt_cache_hit_tokens: 8,
			prompt_cache_miss_tokens: 4,
		};
		const server = createServer(async (request, response) => {
			let body = '';
			for await (const chunk of request) body += String(chunk);
			requests.push({
				...(request.method ? { method: request.method } : {}),
				...(request.url ? { url: request.url } : {}),
				body,
			});
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					choices: [{ message: { content: '咕噜，听到了。' } }],
					usage,
				}),
			);
		});
		server.listen(0, '127.0.0.1');
		try {
			await once(server, 'listening');
			const address = server.address();
			if (!address || typeof address === 'string')
				throw new Error('本机假伺服器未取得 TCP 端口');
			const messages = [{ role: 'user', content: '你好' }] as const;
			const client = createLlmClient({
				llmBaseUrl: `http://127.0.0.1:${address.port}/v1`,
				llmModel: 'test-model',
				llmApiKey: 'test-only',
			});
			await expect(client.complete(messages)).resolves.toEqual({
				content: '咕噜，听到了。',
				usage,
			});
			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({
				method: 'POST',
				url: '/v1/chat/completions',
			});
			expect(JSON.parse(requests[0]!.body)).toEqual({
				model: 'test-model',
				messages,
				stream: false,
			});
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			});
		}
	});
});
