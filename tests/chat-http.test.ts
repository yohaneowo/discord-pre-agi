import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ChatEngine } from '../src/chat.js';
import { BalanceMonitor } from '../src/balance.js';
import { UsageLedger } from '../src/ledger.js';
import { createLlmClient } from '../src/llm.js';
import { chatConfig } from './chat-fixture.js';

describe('聊天到本机假 API 的完整流程', () => {
	it('判断与聊天透过真实 HTTP 传输，限制输出并将两次用量入帐', async () => {
		const requests: Record<string, unknown>[] = [];
		const server = createServer(async (request, response) => {
			let raw = '';
			for await (const chunk of request) raw += String(chunk);
			requests.push(JSON.parse(raw) as Record<string, unknown>);
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					choices: [
						{
							message: {
								content:
									requests.length === 1
										? '{"speak":true,"reason":"接住话题"}'
										: '这件事我也想听听。',
							},
						},
					],
					usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
				}),
			);
		});
		server.listen(0, '127.0.0.1');
		let engine: ChatEngine | undefined;
		try {
			await once(server, 'listening');
			const address = server.address();
			if (!address || typeof address === 'string')
				throw new Error('假伺服器未就绪');
			const config = chatConfig({
				LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
				LLM_API_KEY: 'test-only',
				LLM_INPUT_USD_PER_M: '0.3',
				LLM_CACHE_USD_PER_M: '0.006',
				LLM_OUTPUT_USD_PER_M: '1.2',
			});
			const ledger = new UsageLedger(':memory:');
			engine = new ChatEngine(
				config,
				createLlmClient(config),
				ledger,
				new BalanceMonitor(config),
				'测试人设',
				async () => {},
				() => new Date('2026-10-27T10:00:00Z'),
			);
			const replies: string[] = [];
			await engine.handle({
				id: 'one',
				channelId: 'room',
				authorId: 'member',
				authorName: '群友',
				content: '今天发现一件趣事',
				directed: false,
				reply: async (text) => {
					replies.push(text);
					return { id: 'sent' };
				},
			});
			expect(replies).toEqual(['这件事我也想听听。']);
			expect(requests.map((request) => request.max_tokens)).toEqual([96, 512]);
			expect(ledger.summary('2026-10-27')).toMatchObject({
				calls: 2,
				promptTokens: 40,
				completionTokens: 20,
				uncertainNano: 0,
			});
		} finally {
			await engine?.shutdown();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			});
		}
	});
});
