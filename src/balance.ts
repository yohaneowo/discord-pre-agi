import type { ChatConfig } from './chat-config.js';
import { localDate } from './time.js';

export interface BalanceSnapshot {
	status: 'unknown' | 'available' | 'unavailable' | 'unsupported';
	checkedAt?: string;
	balances?: { currency: string; total: string }[];
}

export class BalanceMonitor {
	private snapshot: BalanceSnapshot;
	private nextCheck = 0;
	private day = '';
	private pending: Promise<void> | undefined;
	constructor(
		private config: ChatConfig,
		private fetchImpl: typeof fetch = fetch,
	) {
		this.snapshot = {
			status: config.deepseekOfficial ? 'unknown' : 'unsupported',
		};
	}

	getSnapshot(): BalanceSnapshot {
		return this.snapshot;
	}
	canCall(): boolean {
		return ['available', 'unsupported'].includes(this.snapshot.status);
	}

	async refresh(now: Date): Promise<void> {
		if (!this.config.deepseekOfficial) return;
		if (this.pending) return this.pending;
		const day = localDate(now, this.config.timeZone);
		if (now.getTime() < this.nextCheck && day === this.day) return;
		this.day = day;
		this.pending = this.check(now).finally(() => {
			this.pending = undefined;
		});
		return this.pending;
	}

	private async check(now: Date): Promise<void> {
		try {
			const response = await this.fetchImpl(
				'https://api.deepseek.com/user/balance',
				{
					headers: { Authorization: `Bearer ${this.config.llmApiKey}` },
					redirect: 'error',
					signal: AbortSignal.timeout(10000),
				},
			);
			if (!response.ok) {
				await response.body?.cancel();
				throw new Error();
			}
			const raw: unknown = await response.json();
			if (
				typeof raw !== 'object' ||
				raw === null ||
				!('is_available' in raw) ||
				typeof raw.is_available !== 'boolean' ||
				!('balance_infos' in raw) ||
				!Array.isArray(raw.balance_infos)
			)
				throw new Error();
			const balances = raw.balance_infos.map((entry: unknown) => {
				if (
					typeof entry !== 'object' ||
					entry === null ||
					!('currency' in entry) ||
					!['CNY', 'USD'].includes(String(entry.currency)) ||
					!('total_balance' in entry) ||
					typeof entry.total_balance !== 'string' ||
					!/^-?\d+(\.\d+)?$/.test(entry.total_balance)
				)
					throw new Error();
				return { currency: String(entry.currency), total: entry.total_balance };
			});
			this.snapshot = {
				status: raw.is_available ? 'available' : 'unavailable',
				checkedAt: now.toISOString(),
				balances,
			};
			this.nextCheck =
				now.getTime() + (raw.is_available ? 24 * 3600000 : 300000);
		} catch {
			this.snapshot = { status: 'unknown', checkedAt: now.toISOString() };
			this.nextCheck = now.getTime() + 300000;
		}
	}
}
