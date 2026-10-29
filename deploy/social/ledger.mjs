// 应用层 token 护栏；未知用量保留预留，不假称是供应商金额上限。
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
const { structuredClone } = globalThis;

export class TokenLedger {
	constructor(
		root,
		{
			input = 2000000,
			output = 50000,
			calls = 200,
			maxOutput = 8192,
			timeZone = 'Asia/Taipei',
		} = {},
	) {
		this.root = root;
		this.limits = { input, output, calls, maxOutput, timeZone };
		if (
			![input, output, calls, maxOutput].every(
				(value) => Number.isSafeInteger(value) && value > 0,
			)
		)
			throw new Error('用量上限必须是正整数。');
		mkdirSync(root, { recursive: true, mode: 0o700 });
		this.path = join(root, 'usage-state.json');
		this.audit = join(root, 'usage-events.jsonl');
		try {
			this.data = JSON.parse(readFileSync(this.path, 'utf8'));
		} catch (error) {
			if (error.code !== 'ENOENT')
				throw new Error('用量纪录损坏，暂不呼叫模型。', { cause: error });
			this.data = { version: 1, days: {}, pending: {} };
		}
		if (this.data.version !== 1 || !this.data.days || !this.data.pending)
			throw new Error('用量纪录格式错误。');
		if (
			!Object.values(this.data.days).every(
				(row) =>
					row &&
					['input', 'output', 'calls'].every(
						(key) => Number.isSafeInteger(row[key]) && row[key] >= 0,
					),
			) ||
			!Object.values(this.data.pending).every(
				(row) =>
					row &&
					this.data.days[row.day] &&
					['input', 'output'].every(
						(key) => Number.isSafeInteger(row[key]) && row[key] >= 0,
					),
			)
		)
			throw new Error('用量纪录数值错误，暂不呼叫模型。');
	}

	day(now = Date.now()) {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: this.limits.timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format(new Date(now));
	}

	commit(next, event) {
		if (this.broken) throw new Error('用量纪录不可写，已暂停模型。');
		try {
			appendFileSync(this.audit, JSON.stringify(event) + '\n', { mode: 0o600 });
			const temporary = this.path + '.tmp';
			writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
			renameSync(temporary, this.path);
			this.data = next;
		} catch {
			this.broken = true;
			throw new Error('用量纪录保存失败，已暂停模型。');
		}
	}

	reserve(options, now = Date.now()) {
		const cap = options.maxTokens ?? this.limits.maxOutput;
		if (!Number.isSafeInteger(cap) || cap < 1 || cap > this.limits.maxOutput)
			throw new Error('本次模型输出超过初期护栏。');
		// 图片在请求里只是附件参照，按位元组估会低估；每张另外预留约一张图的上限（DeepSeek 每图至多约一千多 token）。
		const images = (options.messages ?? []).reduce(
			(count, message) =>
				count +
				(Array.isArray(message.content)
					? message.content.filter((block) => block.type === 'image').length
					: 0),
			0,
		);
		const input =
			Buffer.byteLength(
				JSON.stringify({
					system: options.system,
					messages: options.messages,
					tools: options.tools,
				}),
				'utf8',
			) +
			8192 +
			images * 4096;
		const output = cap * 2;
		const day = this.day(now);
		const current = this.data.days[day] ?? { input: 0, output: 0, calls: 0 };
		if (
			current.calls >= this.limits.calls ||
			current.input + input > this.limits.input ||
			current.output + output > this.limits.output
		)
			throw new Error('今天的模型用量先到这里，稍后再聊。');
		const id = randomUUID();
		const next = structuredClone(this.data);
		next.days[day] = {
			input: current.input + input,
			output: current.output + output,
			calls: current.calls + 1,
		};
		next.pending[id] = { day, input, output };
		this.commit(next, {
			type: 'reserve',
			id,
			day,
			input,
			output,
			provider: options.provider,
			model: options.model,
			time: now,
		});
		return id;
	}

	settle(id, usage) {
		const pending = this.data.pending[id];
		if (!pending) return;
		const fields = ['inputTokens', 'outputTokens'];
		if (
			!usage ||
			!fields.every(
				(key) => Number.isSafeInteger(usage[key]) && usage[key] >= 0,
			)
		)
			return;
		const extra = ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];
		if (
			!extra.every(
				(key) =>
					usage[key] === undefined ||
					(Number.isSafeInteger(usage[key]) && usage[key] >= 0),
			)
		)
			return;
		const input =
			usage.inputTokens +
			(usage.cacheReadTokens ?? 0) +
			(usage.cacheWriteTokens ?? 0);
		const output = usage.outputTokens + (usage.reasoningTokens ?? 0);
		const next = structuredClone(this.data);
		next.days[pending.day].input += input - pending.input;
		next.days[pending.day].output += output - pending.output;
		delete next.pending[id];
		this.commit(next, {
			type: 'settle',
			id,
			day: pending.day,
			input,
			output,
			time: Date.now(),
		});
	}

	summary(now = Date.now()) {
		const day = this.day(now);
		return {
			day,
			...(this.data.days[day] ?? { input: 0, output: 0, calls: 0 }),
			pending: Object.values(this.data.pending).filter((row) => row.day === day)
				.length,
			limits: this.limits,
		};
	}
}
