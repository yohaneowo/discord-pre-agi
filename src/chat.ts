import type { ChatConfig } from './chat-config.js';
import { BalanceMonitor } from './balance.js';
import { BudgetExceeded, estimateCost, UsageLedger } from './ledger.js';
import { buildPrompt, judgePrompt, parseDecision } from './prompt.js';
import type { ContextLine } from './prompt.js';
import type { ChatMessage, createLlmClient } from './llm.js';
import { isQuietHour, localDate, localHour } from './time.js';

export interface IncomingMessage {
	id: string;
	channelId: string;
	authorId: string;
	authorName: string;
	content: string;
	directed: boolean;
	reply(content: string): Promise<{ id: string } | void>;
}

interface ChannelState {
	history: ContextLine[];
	lastDecision: number;
	pending: number;
	tail: Promise<void>;
}

export function callsByName(
	content: string,
	names: readonly string[],
): boolean {
	return names.some(
		(name) =>
			name.trim() &&
			content.toLocaleLowerCase().includes(name.toLocaleLowerCase()),
	);
}

export function canProactivelySpeak(input: {
	now: Date;
	timeZone: string;
	quietStart: number;
	quietEnd: number;
	quietUntil: number;
	last: number;
	cooldownMs: number;
	count: number;
	limit: number;
	recentOwn: number;
	lastDecision: number;
	decisionIntervalMs: number;
}): boolean {
	const now = input.now.getTime();
	return (
		now >= input.quietUntil &&
		!isQuietHour(
			localHour(input.now, input.timeZone),
			input.quietStart,
			input.quietEnd,
		) &&
		(!input.last || now - input.last >= input.cooldownMs) &&
		(!input.lastDecision ||
			now - input.lastDecision >= input.decisionIntervalMs) &&
		input.count < input.limit &&
		input.recentOwn < 2
	);
}

class CallsPaused extends Error {}

export class ChatEngine {
	private channels = new Map<string, ChannelState>();
	private pending = 0;
	private closed = false;
	constructor(
		readonly config: ChatConfig,
		private llm: ReturnType<typeof createLlmClient>,
		readonly ledger: UsageLedger,
		readonly balance: BalanceMonitor,
		private persona: string,
		private notifyOwner: (message: string) => Promise<void>,
		private now: () => Date = () => new Date(),
	) {}

	async initialize(): Promise<void> {
		if (this.closed) return;
		await this.balance.refresh(this.now());
		if (!this.balance.canCall())
			await this.notice(
				'balance',
				'模型余额不足或暂时无法确认余额，已暂停模型呼叫。可使用 /费用 查看状态。',
			);
	}

	private async notice(kind: string, content: string): Promise<void> {
		if (
			!this.ledger.claimNotice(
				localDate(this.now(), this.config.timeZone),
				kind,
			)
		)
			return;
		try {
			await this.notifyOwner(content);
		} catch {
			console.error('无法通知主人，请检查私讯权限。');
		}
	}

	async handle(message: IncomingMessage): Promise<void> {
		if (this.closed) return;
		let state = this.channels.get(message.channelId);
		if (!state) {
			if (this.channels.size >= 128) {
				const idle = [...this.channels].find(
					([, value]) => value.pending === 0,
				);
				if (idle) this.channels.delete(idle[0]);
				else {
					if (message.directed)
						await message.reply('我这边有点忙，等一下再叫我吧。');
					return;
				}
			}
			state = {
				history: [],
				lastDecision: 0,
				pending: 0,
				tail: Promise.resolve(),
			};
			this.channels.set(message.channelId, state);
		}
		if (state.pending >= 32 || this.pending >= 256) {
			if (message.directed)
				await message.reply('我这边有点忙，等一下再叫我吧。');
			return;
		}
		state.pending++;
		this.pending++;
		const current = state;
		const next = current.tail
			.then(() => this.process(message, current))
			.finally(() => {
				current.pending--;
				this.pending--;
			});
		current.tail = next.catch(() => {});
		return next;
	}

	private append(state: ChannelState, line: ContextLine): void {
		state.history.push(line);
		state.history = state.history.slice(-30);
	}

	private canSpeak(state: ChannelState): boolean {
		const now = this.now();
		const proactive = this.ledger.proactiveState(
			localDate(now, this.config.timeZone),
		);
		return canProactivelySpeak({
			now,
			timeZone: this.config.timeZone,
			quietStart: this.config.quietStart,
			quietEnd: this.config.quietEnd,
			quietUntil: this.ledger.quietUntil(),
			last: proactive.last,
			cooldownMs: this.config.cooldownMs,
			count: proactive.count,
			limit: this.config.dailyProactiveLimit,
			recentOwn: state.history
				.slice(-8)
				.filter((line) => line.role === 'assistant').length,
			lastDecision: state.lastDecision,
			decisionIntervalMs: this.config.decisionIntervalMs,
		});
	}

	private async call(
		messages: ChatMessage[],
		purpose: 'judge' | 'reply',
		maxTokens: number,
	) {
		const now = this.now();
		await this.balance.refresh(now);
		if (!this.balance.canCall()) throw new CallsPaused();
		// 以 UTF-8 字节数加角色封装余量预留，缓存全按较高输入价计算。
		const inputBound =
			Buffer.byteLength(JSON.stringify(messages), 'utf8') +
			messages.length * 64 +
			1024;
		const prices = this.config.prices;
		const reserve = estimateCost(
			{
				prompt_tokens: inputBound,
				completion_tokens: maxTokens,
				total_tokens: inputBound + maxTokens,
			},
			{ ...prices, input: Math.max(prices.input, prices.cache) },
		);
		const id = this.ledger.reserve(
			localDate(now, this.config.timeZone),
			now,
			this.config.llmModel,
			purpose,
			reserve,
			this.config.dailyBudgetUsd,
			prices,
		);
		try {
			const result = await this.llm.complete(messages, {
				maxTokens,
				nonThinking: this.config.deepseekOfficial,
			});
			this.ledger.settle(id, result.usage, prices);
			return result;
		} catch (error) {
			this.ledger.uncertain(id);
			throw error;
		}
	}

	private async process(
		message: IncomingMessage,
		state: ChannelState,
	): Promise<void> {
		this.append(state, {
			id: message.id,
			role: 'user',
			content: JSON.stringify({
				speaker: message.authorId,
				name: message.authorName.slice(0, 100),
				text: message.content.slice(0, 1000),
			}),
		});
		try {
			if (!message.directed) {
				if (!this.canSpeak(state)) return;
				state.lastDecision = this.now().getTime();
				const decision = await this.call(
					judgePrompt(state.history),
					'judge',
					96,
				);
				if (
					!parseDecision(decision.content) ||
					!this.canSpeakAfterDecision(state)
				)
					return;
			}
			const result = await this.call(
				buildPrompt(this.persona, state.history),
				'reply',
				this.config.maxOutputTokens,
			);
			if (!message.directed) {
				if (!this.canSpeakAfterDecision(state)) return;
				const now = this.now();
				if (
					!this.ledger.claimProactive(
						localDate(now, this.config.timeZone),
						now.getTime(),
						this.config.dailyProactiveLimit,
						this.config.cooldownMs,
					)
				)
					return;
			}
			const content = result.content
				.trim()
				.slice(0, 1900)
				.replace(/[\uD800-\uDBFF]$/, '');
			if (!content) {
				if (message.directed)
					await message.reply('刚刚没想好怎么说，再叫我一次吧。');
				return;
			}
			const sent = await message.reply(content);
			this.append(state, {
				id: sent?.id ?? `reply:${message.id}`,
				role: 'assistant',
				content,
			});
		} catch (error) {
			if (error instanceof BudgetExceeded)
				await this.notice(
					'budget',
					'今日模型预算已用完或不足以预留下一次呼叫，已暂停模型呼叫。可使用 /费用 查看用量。',
				);
			else if (error instanceof CallsPaused)
				await this.notice(
					'balance',
					'模型余额不足或暂时无法确认余额，已暂停模型呼叫。可使用 /费用 查看状态。',
				);
			else
				await this.notice(
					'model-error',
					'模型呼叫或回覆失败，请检查供应商状态与频道权限。未确认的呼叫已保留费用预留额。',
				);
			if (message.directed)
				await message.reply(
					error instanceof BudgetExceeded
						? '今天的聊天预算先用到这里，我休息一下。'
						: '我这边暂时接不上，等一下再叫我吧。',
				);
		}
	}

	private canSpeakAfterDecision(state: ChannelState): boolean {
		return this.canSpeak({ ...state, lastDecision: 0 });
	}

	async ownerCommand(
		userId: string,
		name: string,
		minutes?: number,
	): Promise<string> {
		if (userId !== this.config.ownerDiscordId) return '这个指令只给主人使用。';
		if (name === '安静') {
			if (!Number.isInteger(minutes) || minutes! < 1 || minutes! > 1440)
				return '请填写 1～1440 分钟。';
			this.ledger.setQuietUntil(this.now().getTime() + minutes! * 60000);
			return `好，接下来 ${minutes} 分钟不主动插话；直接叫我仍会回应。`;
		}
		await this.balance.refresh(this.now());
		const day = localDate(this.now(), this.config.timeZone);
		const today = this.ledger.summary(day);
		const month = this.ledger.summary(day.slice(0, 7));
		const money = (amount: number) => `$${(amount / 1e9).toFixed(6)}`;
		const snapshot = this.balance.getSnapshot();
		const balance =
			snapshot.status === 'unsupported'
				? '此供应商尚无余额接口（TBD）'
				: snapshot.status === 'unknown'
					? '暂时无法确认，已暂停模型呼叫'
					: `${snapshot.status === 'available' ? '可用' : '不足'}；${snapshot.balances?.map((entry) => `${entry.currency} ${entry.total}`).join('，')}`;
		return [
			`今天（${day}，${this.config.timeZone}）：${today.calls} 次，输入 ${today.promptTokens} / 输出 ${today.completionTokens} token。`,
			`估算加预留：${money(today.chargedNano)} / 每日上限 $${this.config.dailyBudgetUsd}；其中未确认／处理中 ${money(today.uncertainNano)}。`,
			`本月：${month.calls} 次，估算加预留 ${money(month.chargedNano)}；其中未确认／处理中 ${money(month.uncertainNano)}。`,
			`余额：${balance}。`,
			`余额查询时间：${snapshot.checkedAt ?? '尚未查询'}。`,
			'费用按设定的保守费率估算，实际扣款以供应商帐单为准；日志不含对话内容。',
		].join('\n');
	}

	async shutdown(): Promise<void> {
		this.closed = true;
		await Promise.all([...this.channels.values()].map((state) => state.tail));
		this.ledger.close();
	}
}
