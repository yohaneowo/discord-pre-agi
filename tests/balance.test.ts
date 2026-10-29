import { describe, expect, it, vi } from 'vitest';
import { BalanceMonitor } from '../src/balance.js';
import { availableBalance, chatConfig } from './chat-fixture.js';

describe('余额查询', () => {
	it('启动查询、同日复用，跨本地日期查询且不把金钥送往第三方', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => availableBalance());
		const monitor = new BalanceMonitor(chatConfig(), fetcher);
		await Promise.all([
			monitor.refresh(new Date('2026-10-27T10:00:00Z')),
			monitor.refresh(new Date('2026-10-27T10:00:00Z')),
		]);
		await monitor.refresh(new Date('2026-10-27T11:00:00Z'));
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(monitor.canCall()).toBe(true);
		await monitor.refresh(new Date('2026-10-27T16:01:00Z'));
		expect(fetcher).toHaveBeenCalledTimes(2);
		const other = new BalanceMonitor(
			chatConfig({
				LLM_BASE_URL: 'https://example.invalid/v1',
				LLM_INPUT_USD_PER_M: '0.1',
				LLM_CACHE_USD_PER_M: '0.01',
				LLM_OUTPUT_USD_PER_M: '0.2',
			}),
			fetcher,
		);
		await other.refresh(new Date());
		expect(other.getSnapshot().status).toBe('unsupported');
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it.each([
		Response.json({ is_available: false, balance_infos: [] }),
		Response.json({
			is_available: true,
			balance_infos: [{ currency: 'USD', total_balance: '不是数字' }],
		}),
		new Response('秘密错误本文', { status: 401 }),
	])('余额不足或格式错误时停止付费请求', async (response) => {
		const monitor = new BalanceMonitor(
			chatConfig(),
			vi.fn<typeof fetch>().mockResolvedValue(response),
		);
		await monitor.refresh(new Date());
		expect(monitor.canCall()).toBe(false);
		expect(JSON.stringify(monitor.getSnapshot())).not.toContain('秘密错误本文');
	});
	it('失败后保守暂停，五分钟后可恢复', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new Error('秘密连线资讯'))
			.mockImplementation(async () => availableBalance());
		const monitor = new BalanceMonitor(chatConfig(), fetcher);
		const now = new Date('2026-10-27T10:00:00Z');
		await monitor.refresh(now);
		expect(monitor.canCall()).toBe(false);
		await monitor.refresh(new Date(now.getTime() + 300001));
		expect(monitor.canCall()).toBe(true);
	});
});
