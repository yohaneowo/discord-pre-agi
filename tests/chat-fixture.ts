import { readChatConfig } from '../src/chat-config.js';

export const chatEnv = {
	DISCORD_TOKEN: '测试凭证',
	DISCORD_CLIENT_ID: '123456789012345678', // gitleaks:allow 虚构的测试 ID
	OWNER_DISCORD_ID: '987654321098765432', // gitleaks:allow 虚构的测试 ID
	LLM_BASE_URL: 'https://api.deepseek.com',
	LLM_MODEL: 'deepseek-flash',
	LLM_API_KEY: '测试凭证',
	DAILY_BUDGET_USD: '1',
};

export function chatConfig(extra: NodeJS.ProcessEnv = {}) {
	return readChatConfig({ ...chatEnv, ...extra });
}

export const availableBalance = () =>
	Response.json({
		is_available: true,
		balance_infos: [{ currency: 'USD', total_balance: '10.00' }],
	});
export const completion = (content = '听到了。') => ({
	content,
	usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
});
