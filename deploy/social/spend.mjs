// 烧钱警报：不设每日上限（拥有者的决定），只在花得多或突然暴增时私讯拥有者。
// 花费从 DeepSeek 真实余额推算：相邻两次读数的减少才算花掉，余额变多当成充值、不算。
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const HOUR = 3600000;

export class SpendWatch {
	constructor(
		path,
		{
			dailyYuan = 5,
			spikeFactor = 3,
			minSpikeYuan = 0.5,
			timeZone = 'Asia/Taipei',
		} = {},
	) {
		this.path = path;
		this.options = { dailyYuan, spikeFactor, minSpikeYuan, timeZone };
		try {
			this.state = JSON.parse(readFileSync(path, 'utf8'));
		} catch {
			this.state = { readings: [], dailyAlerted: '', spikeAlertedAt: 0 };
		}
	}

	day(at) {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: this.options.timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format(new Date(at));
	}

	// 两个时间点之间花掉的钱：只加总减少的部分。
	spent(from, to) {
		let total = 0;
		const rows = this.state.readings;
		for (let i = 1; i < rows.length; i++)
			if (rows[i].t > from && rows[i].t <= to)
				total += Math.max(0, rows[i - 1].total - rows[i].total);
		return total;
	}

	spentToday(now = Date.now()) {
		const today = this.day(now);
		let start = now;
		for (const row of this.state.readings)
			if (this.day(row.t) === today) {
				start = row.t;
				break;
			}
		// 今天第一笔读数之前的那段也算今天（上一笔是昨天读的）。
		const before = this.state.readings.findLast((row) => row.t < start);
		return this.spent(before ? before.t : start, now);
	}

	save() {
		const temporary = this.path + '.tmp';
		writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600 });
		renameSync(temporary, this.path);
	}

	// 记一笔余额读数，回传该私讯拥有者的提醒（今天花超过门槛一天一次；一小时暴增三小时最多一次）。
	record(total, now = Date.now()) {
		const { dailyYuan, spikeFactor, minSpikeYuan } = this.options;
		this.state.readings = [
			...this.state.readings.filter((row) => now - row.t < 48 * HOUR),
			{ t: now, total },
		];
		const alerts = [];
		const today = this.spentToday(now);
		if (today >= dailyYuan && this.state.dailyAlerted !== this.day(now)) {
			this.state.dailyAlerted = this.day(now);
			alerts.push({ kind: 'daily', today, balance: total });
		}
		const lastHour = this.spent(now - HOUR, now);
		const history = this.state.readings[0].t;
		const hours = Math.min(23, (now - HOUR - history) / HOUR);
		const usual =
			hours >= 3 ? this.spent(now - 24 * HOUR, now - HOUR) / hours : 0;
		if (
			hours >= 3 &&
			lastHour >= minSpikeYuan &&
			lastHour > spikeFactor * usual &&
			now - this.state.spikeAlertedAt >= 3 * HOUR
		) {
			this.state.spikeAlertedAt = now;
			alerts.push({ kind: 'spike', lastHour, usual, today, balance: total });
		}
		this.save();
		return alerts;
	}
}

export function spendText(alert) {
	const yuan = (value) => value.toFixed(2) + ' 元';
	return alert.kind === 'daily'
		? `提醒：今天已经花了约 ${yuan(alert.today)}（从 DeepSeek 余额推算），余额剩 ${yuan(alert.balance)}。没有设上限，我会照常回话；要我收手就跟我说。`
		: `提醒：最近一小时花了约 ${yuan(alert.lastHour)}，是平常每小时（约 ${yuan(alert.usual)}）的好几倍；今天累计约 ${yuan(alert.today)}，余额剩 ${yuan(alert.balance)}。可能有人一直叫我做事，或我卡在什么地方，你看一下。`;
}
