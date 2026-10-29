import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { BudgetExceeded, estimateCost, UsageLedger } from '../src/ledger.js';
import { localDate } from '../src/time.js';

const prices = { input: 0.3, cache: 0.006, output: 1.2 };
const now = new Date('2026-10-27T10:00:00Z');
const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };

describe('费用与 SQLite 护栏', () => {
	it('依缓存用量估算，缺缓存字段按未命中；金额使用整数奈美元', () => {
		expect(estimateCost(usage, prices)).toBe(42000);
		expect(
			estimateCost({ ...usage, prompt_cache_hit_tokens: 80 }, prices),
		).toBe(18480);
		expect(
			estimateCost({ ...usage, prompt_cache_miss_tokens: 20 }, prices),
		).toBe(18480);
	});
	it('先预留、确认后结算，失败保留整笔额度，超过预算无法再预留', () => {
		const ledger = new UsageLedger(':memory:');
		try {
			const id = ledger.reserve(
				'2026-10-27',
				now,
				'test',
				'reply',
				500000000,
				1,
				prices,
			);
			expect(ledger.summary('2026-10-27').uncertainNano).toBe(500000000);
			ledger.settle(id, usage, prices);
			expect(ledger.summary('2026-10-27')).toMatchObject({
				calls: 1,
				chargedNano: 42000,
				uncertainNano: 0,
				promptTokens: 100,
			});
			const failed = ledger.reserve(
				'2026-10-27',
				now,
				'test',
				'judge',
				900000000,
				1,
				prices,
			);
			ledger.uncertain(failed);
			expect(() =>
				ledger.reserve(
					'2026-10-27',
					now,
					'test',
					'reply',
					100000000,
					1,
					prices,
				),
			).toThrow(BudgetExceeded);
			expect(ledger.summary('2026-10-27').uncertainNano).toBe(900000000);
			ledger.reserve('2026-10-28', now, 'test', 'reply', 100000000, 1, prices);
			expect(ledger.summary('2026-10').calls).toBe(3);
		} finally {
			ledger.close();
		}
	});
	it('跨连线与重启仍保留预留、安静时间、插话上限与通知去重', () => {
		const directory = mkdtempSync(join(tmpdir(), 'discord-ledger-'));
		const path = join(directory, 'usage.sqlite');
		const one = new UsageLedger(path);
		const two = new UsageLedger(path);
		try {
			one.reserve('2026-10-27', now, 'test', 'reply', 700000000, 1, prices);
			expect(() =>
				two.reserve('2026-10-27', now, 'test', 'reply', 400000000, 1, prices),
			).toThrow(BudgetExceeded);
			one.setQuietUntil(now.getTime() + 60000);
			expect(one.claimProactive('2026-10-27', now.getTime(), 1, 60000)).toBe(
				true,
			);
			expect(
				two.claimProactive('2026-10-27', now.getTime() + 60001, 1, 60000),
			).toBe(false);
			expect(one.claimNotice('2026-10-27', 'budget')).toBe(true);
			expect(two.claimNotice('2026-10-27', 'budget')).toBe(false);
		} finally {
			one.close();
			two.close();
		}
		const reopened = new UsageLedger(path);
		try {
			expect(reopened.summary('2026-10-27').chargedNano).toBe(700000000);
			expect(reopened.quietUntil()).toBe(now.getTime() + 60000);
			const reader = new Database(path, { readonly: true });
			try {
				const row = reader.prepare('SELECT * FROM requests').get() as Record<
					string,
					unknown
				>;
				expect(row.state).toBe('reserved');
				expect(Object.keys(row)).not.toContain('content');
			} finally {
				reader.close();
			}
		} finally {
			reopened.close();
			for (const suffix of ['', '-wal', '-shm'])
				rmSync(`${path}${suffix}`, { force: true });
			rmdirSync(directory);
		}
	});
	it('日界线采用设定时区', () => {
		expect(localDate(new Date('2026-10-27T16:00:00Z'), 'Asia/Taipei')).toBe(
			'2026-10-28',
		);
	});
});
