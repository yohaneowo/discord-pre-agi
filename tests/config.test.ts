import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

const validEnv = {
	DISCORD_TOKEN: '测试凭证',
	DISCORD_CLIENT_ID: '123456789012345678', // gitleaks:allow 虚构的测试 ID
	LLM_BASE_URL: 'https://example.invalid/v1/',
	LLM_MODEL: '测试模型',
	LLM_API_KEY: '测试凭证',
	DAILY_BUDGET_USD: '1.25',
	OWNER_DISCORD_ID: '987654321098765432', // gitleaks:allow 虚构的测试 ID
};

describe('集中环境设定', () => {
	it('转换预算、保留 ID 字串并移除网址末尾斜线', () => {
		expect(readConfig(validEnv)).toMatchObject({
			llmBaseUrl: 'https://example.invalid/v1',
			dailyBudgetUsd: 1.25,
			discordClientId: validEnv.DISCORD_CLIENT_ID,
		});
	});
	it.each(Object.keys(validEnv))('拒绝缺少或空白的 %s', (key) => {
		expect(() => readConfig({ ...validEnv, [key]: undefined })).toThrow(key);
		expect(() => readConfig({ ...validEnv, [key]: '  ' })).toThrow(key);
	});
	it.each(['0', '-1', 'Infinity', 'NaN', 'abc', '0x10'])(
		'拒绝无效预算 %s',
		(value) => {
			expect(() =>
				readConfig({ ...validEnv, DAILY_BUDGET_USD: value }),
			).toThrow('DAILY_BUDGET_USD');
		},
	);
	it.each([
		'无效网址',
		'ftp://example.invalid',
		'https://user:password@example.invalid',
		'https://example.invalid?key=测试',
		'https://example.invalid/#片段',
	])('拒绝无效或夹带凭证的网址', (value) => {
		expect(() => readConfig({ ...validEnv, LLM_BASE_URL: value })).toThrow(
			'LLM_BASE_URL',
		);
	});
	it.each(['DISCORD_CLIENT_ID', 'OWNER_DISCORD_ID'])(
		'检查 %s 的数字 ID 格式',
		(key) => {
			expect(() => readConfig({ ...validEnv, [key]: '不是数字' })).toThrow(key);
		},
	);
});
