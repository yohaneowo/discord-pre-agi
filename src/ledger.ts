import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Prices } from './chat-config.js';
import type { TokenUsage } from './llm.js';

const nano = 1_000_000_000;

export class BudgetExceeded extends Error {
	constructor() {
		super('今日预算不足以预留下一次模型呼叫');
	}
}

export function estimateCost(usage: TokenUsage, prices: Prices): number {
	// 缓存字段缺少时按未命中计价，不把缺值猜成零用量。
	const hit =
		usage.prompt_cache_hit_tokens ??
		(usage.prompt_cache_miss_tokens === undefined
			? 0
			: usage.prompt_tokens - usage.prompt_cache_miss_tokens);
	return Math.ceil(
		(hit * prices.cache +
			(usage.prompt_tokens - hit) * prices.input +
			usage.completion_tokens * prices.output) *
			1000,
	);
}

export class UsageLedger {
	private db: Database.Database;
	constructor(path: string) {
		this.db = new Database(path);
		this.db.pragma('journal_mode = WAL');
		this.db.pragma('busy_timeout = 5000');
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS requests (
				id TEXT PRIMARY KEY, day TEXT NOT NULL, started_at TEXT NOT NULL,
				model TEXT NOT NULL, purpose TEXT NOT NULL, state TEXT NOT NULL,
				charged_nano INTEGER NOT NULL, reserved_nano INTEGER NOT NULL,
				prompt_tokens INTEGER, completion_tokens INTEGER, cache_hit_tokens INTEGER,
				cache_miss_tokens INTEGER, prices TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS requests_day ON requests(day);
			CREATE TABLE IF NOT EXISTS proactive (at_ms INTEGER NOT NULL, day TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value REAL NOT NULL);
			CREATE TABLE IF NOT EXISTS notices (day TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(day, kind));
		`);
	}

	reserve(
		day: string,
		now: Date,
		model: string,
		purpose: 'judge' | 'reply',
		amount: number,
		budgetUsd: number,
		prices: Prices,
	): string {
		return this.db
			.transaction(() => {
				if (!Number.isSafeInteger(amount) || amount < 0)
					throw new Error('无效的费用预留');
				if (
					this.summary(day).chargedNano + amount >
					Math.floor(budgetUsd * nano)
				)
					throw new BudgetExceeded();
				const id = randomUUID();
				this.db
					.prepare(
						'INSERT INTO requests (id, day, started_at, model, purpose, state, charged_nano, reserved_nano, prices) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
					)
					.run(
						id,
						day,
						now.toISOString(),
						model,
						purpose,
						'reserved',
						amount,
						amount,
						JSON.stringify(prices),
					);
				return id;
			})
			.immediate();
	}

	settle(id: string, usage: TokenUsage, prices: Prices): void {
		this.db
			.prepare(
				`UPDATE requests SET state = 'confirmed', charged_nano = ?, prompt_tokens = ?, completion_tokens = ?, cache_hit_tokens = ?, cache_miss_tokens = ? WHERE id = ? AND state = 'reserved'`,
			)
			.run(
				estimateCost(usage, prices),
				usage.prompt_tokens,
				usage.completion_tokens,
				usage.prompt_cache_hit_tokens ?? null,
				usage.prompt_cache_miss_tokens ?? null,
				id,
			);
	}

	uncertain(id: string): void {
		// 错误或逾时也可能已产生供应商费用，保留整笔预留额。
		this.db
			.prepare(
				"UPDATE requests SET state = 'uncertain' WHERE id = ? AND state = 'reserved'",
			)
			.run(id);
	}

	summary(prefix: string) {
		return this.db
			.prepare(
				`SELECT COUNT(*) AS calls, COALESCE(SUM(charged_nano), 0) AS chargedNano,
			COALESCE(SUM(CASE WHEN state != 'confirmed' THEN charged_nano ELSE 0 END), 0) AS uncertainNano,
			COALESCE(SUM(prompt_tokens), 0) AS promptTokens, COALESCE(SUM(completion_tokens), 0) AS completionTokens
			FROM requests WHERE day LIKE ?`,
			)
			.get(`${prefix}%`) as {
			calls: number;
			chargedNano: number;
			uncertainNano: number;
			promptTokens: number;
			completionTokens: number;
		};
	}

	proactiveState(day: string) {
		const count = this.db
			.prepare('SELECT COUNT(*) AS count FROM proactive WHERE day = ?')
			.get(day) as { count: number };
		const last = this.db
			.prepare('SELECT MAX(at_ms) AS last FROM proactive')
			.get() as { last: number | null };
		return { count: count.count, last: last.last ?? 0 };
	}

	claimProactive(
		day: string,
		now: number,
		limit: number,
		cooldownMs: number,
	): boolean {
		return this.db
			.transaction(() => {
				const state = this.proactiveState(day);
				if (
					state.count >= limit ||
					(state.last && now - state.last < cooldownMs)
				)
					return false;
				this.db
					.prepare('INSERT INTO proactive (day, at_ms) VALUES (?, ?)')
					.run(day, now);
				return true;
			})
			.immediate();
	}

	quietUntil(): number {
		return (
			(
				this.db
					.prepare("SELECT value FROM settings WHERE name = 'quiet_until'")
					.get() as { value: number } | undefined
			)?.value ?? 0
		);
	}

	setQuietUntil(value: number): void {
		this.db
			.prepare(
				"INSERT INTO settings (name, value) VALUES ('quiet_until', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
			)
			.run(value);
	}

	claimNotice(day: string, kind: string): boolean {
		return (
			this.db
				.prepare('INSERT OR IGNORE INTO notices (day, kind) VALUES (?, ?)')
				.run(day, kind).changes > 0
		);
	}

	close(): void {
		this.db.close();
	}
}
