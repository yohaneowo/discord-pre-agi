import { describe, expect, it } from 'vitest';
import { chatConfig } from './chat-fixture.js';

describe('聊天设定与价格', () => {
	it('官方 Flash 使用核对过的高峰保守费率与可调整的插话设定', () => {
		expect(chatConfig()).toMatchObject({
			prices: { input: 0.3, cache: 0.006, output: 1.2 },
			deepseekOfficial: true,
			cooldownMs: 600000,
			timeZone: 'Asia/Taipei',
			quietStart: 0,
			quietEnd: 8,
			dailyProactiveLimit: 10,
		});
		expect(
			chatConfig({
				BOT_NAMES: '鲸鲸, 小鲸 ',
				DAILY_PROACTIVE_LIMIT: '0',
				QUIET_START_HOUR: '23',
			}),
		).toMatchObject({
			botNames: ['鲸鲸', '小鲸'],
			dailyProactiveLimit: 0,
			quietStart: 23,
		});
	});
	it.each([
		{ LLM_BASE_URL: 'https://example.invalid/v1' },
		{ LLM_MODEL: '未知模型' },
		{ LLM_BASE_URL: 'https://api.deepseek.com.example.invalid' },
	])('未知价格时拒绝静默套用官方价格', (extra) => {
		expect(() => chatConfig(extra)).toThrow('TBD');
	});
	it('换供应商只需设定，并要求完整的自订费率', () => {
		expect(
			chatConfig({
				LLM_BASE_URL: 'https://example.invalid/v1',
				LLM_INPUT_USD_PER_M: '0.2',
				LLM_CACHE_USD_PER_M: '0.01',
				LLM_OUTPUT_USD_PER_M: '0.4',
			}),
		).toMatchObject({
			deepseekOfficial: false,
			prices: { input: 0.2, cache: 0.01, output: 0.4 },
		});
		expect(() => chatConfig({ LLM_INPUT_USD_PER_M: '0.1' })).toThrow('同时');
	});
	it.each([
		{ BOT_TIMEZONE: '无效时区' },
		{ DAILY_PROACTIVE_LIMIT: '-1' },
		{ QUIET_START_HOUR: '24' },
		{ MAX_OUTPUT_TOKENS: 'NaN' },
		{ PROACTIVE_COOLDOWN_MINUTES: '0' },
	])('拒绝无效时区与行为上限', (extra) => {
		expect(() => chatConfig(extra)).toThrow();
	});
});
