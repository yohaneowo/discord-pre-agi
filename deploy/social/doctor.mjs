// 体检：记忆与稳态那些「装好了就以为在动」的东西，每一项都真的去读一次证据再下结论
// （照 dsh-agent-soul 的哨兵原则：不读设定就报绿；读不到就报「读不到」，不算正常）。
// 四级：ok 正常、warn 注意、error 坏了、unknown 读不到。私讯 /体检 看报告，定时跑、有项目变坏就私讯拥有者。
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HOUR = 3600000;
const ICON = { ok: '✅', warn: '⚠️', error: '❌', unknown: '❔' };

const ago = (ms) =>
	ms < 2 * 60000
		? '刚刚'
		: ms < 2 * HOUR
			? `${Math.round(ms / 60000)} 分钟前`
			: ms < 48 * HOUR
				? `${Math.round(ms / HOUR)} 小时前`
				: `${Math.round(ms / (24 * HOUR))} 天前`;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const lines = (path) =>
	readFileSync(path, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return undefined;
			}
		})
		.filter(Boolean);

// 会话纪录是多段 zstd 接在一起的，Node 内建只解第一段，所以用系统的 zstd 逐行读。
async function sessionEvents(path) {
	const { stdout } = await run('zstd', ['-dc', path], {
		maxBuffer: 512 * 1024 * 1024,
	});
	return stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return undefined;
			}
		})
		.filter(Boolean);
}

function findUsage(value) {
	if (!value || typeof value !== 'object') return undefined;
	if ('inputTokens' in value && 'outputTokens' in value) return value;
	for (const child of Object.values(value)) {
		const found = findUsage(child);
		if (found) return found;
	}
	return undefined;
}

const checks = {
	async ledger(runtime, now) {
		if (!runtime.archive) return ['unknown', '原文帐本没有启用'];
		const rows = runtime.archive.load();
		if (!rows.length) return ['warn', '帐本是空的'];
		const last = Date.parse(rows.at(-1).t);
		return [
			now - last < 48 * HOUR ? 'ok' : 'warn',
			`${rows.length} 则，最后一笔 ${ago(now - last)}${now - last < 48 * HOUR ? '' : '（群里很久没人说话，或闸道没在收）'}`,
		];
	},

	async backup(runtime, now) {
		const out = join(runtime.home, 'backups');
		const record = join(out, 'last.json');
		if (!existsSync(record)) {
			const files = existsSync(out) ? readdirSync(out) : [];
			return files.length
				? ['warn', '有备份档，但没有最近一次的结果纪录']
				: ['unknown', '还没有备份过'];
		}
		const last = readJson(record);
		const age = now - Date.parse(last.at);
		if (!last.ok)
			return ['error', `最近一次备份失败（${ago(age)}）：${last.error}`];
		const size = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';
		return [
			age < 26 * HOUR ? 'ok' : age < 50 * HOUR ? 'warn' : 'error',
			`${ago(age)}，完整 ${size(last.full.size)}、核心 ${size(last.core.size)}，列清单验证过 ${last.full.entries} 项`,
		];
	},

	async backfill(runtime) {
		const path = join(runtime.archive?.root ?? '', '.backfill.json');
		if (!runtime.archive || !existsSync(path))
			return ['warn', '还没补抓过旧讯息（私讯 /记忆 补抓）'];
		const report = readJson(path);
		return [
			report.failed?.length ? 'warn' : 'ok',
			`${report.channels} 个频道、补进 ${report.added} 则${report.failed?.length ? `；抓不到：${report.failed.slice(0, 3).join('；')}` : ''}`,
		];
	},

	// 这次启动之后整理出的条目有多少附了出处。人物卡只记到日期，旧条目（加出处功能之前）分不开，
	// 所以看召回记录：它有精确时间，来源写的是第一个出处的讯息 id，没有出处时写 consolidated。
	async notes(runtime, now) {
		const people = join(runtime.root, 'notes', 'people');
		const journal = join(runtime.root, 'notes', 'journal');
		if (!existsSync(people)) return ['unknown', '还没有人物卡'];
		const fresh = runtime
			.memoryScopes('group')
			.flatMap((scope) => runtime.memory.active(scope))
			.filter((record) => Date.parse(record.at) >= runtime.startedAt);
		const cited = fresh.filter((record) =>
			/^\d{5,25}$/.test(String(record.messageId)),
		);
		const days = existsSync(journal) ? readdirSync(journal).sort() : [];
		const newest = days.at(-1)?.slice(0, 10) ?? '（没有）';
		const detail = `${readdirSync(people).length} 张人物卡；这次启动后整理出 ${fresh.length} 条，${cited.length} 条附出处；最新日记 ${newest}`;
		if (fresh.length >= 3 && cited.length / fresh.length < 0.5)
			return ['warn', detail + '（出处太少，整理可能没照格式回）'];
		return [
			newest >= runtime.notes.day(now - 3 * 24 * HOUR) ? 'ok' : 'warn',
			detail,
		];
	},

	async memory(runtime) {
		const counts = runtime
			.memoryScopes('group')
			.map(
				(scope) =>
					`${scope === 'group' ? '群聊' : '私讯'} ${runtime.memory.active(scope).length}`,
			);
		return ['ok', `召回记录：${counts.join('、')} 条（读得出来、格式正常）`];
	},

	// 换气：启动纪录要在这次启动之后写过「apply() done」；判定纪录看最近一天出手几次。
	async huanqi(runtime, now) {
		const state = join(runtime.home, 'state');
		const boot = join(state, 'huanqi-boot.log');
		if (!existsSync(boot)) return ['error', '换气没有载入（没有启动纪录）'];
		const loaded =
			statSync(boot).mtimeMs >= runtime.startedAt - 10 * 60000 &&
			readFileSync(boot, 'utf8')
				.trim()
				.split('\n')
				.at(-1)
				.includes('apply() done');
		if (!loaded) return ['error', '换气这次启动没有载入完成'];
		const turns = join(state, 'huanqi-turns.jsonl');
		if (!existsSync(turns)) return ['ok', '已载入；还没有任何回合判定'];
		const day = lines(turns).filter(
			(row) => now - Date.parse(row.t) < 24 * HOUR,
		);
		const acted = day.filter((row) => !String(row.verdict).startsWith('skip'));
		return [
			'ok',
			`已载入；最近一天 ${day.length} 个回合、出手 ${acted.length} 次；额度 ${day.at(-1)?.credit ?? '?'}/${day.at(-1)?.creditMax ?? '?'}`,
		];
	},

	async turnSteps(runtime, now) {
		const path = join(runtime.root, 'vital-events.jsonl');
		const day = existsSync(path)
			? lines(path).filter((row) => now - Date.parse(row.t) < 24 * HOUR)
			: [];
		return [
			day.length > 5 ? 'warn' : 'ok',
			`上限 ${runtime.config.turnStepLimit ?? 40} 次；最近一天拦下 ${day.length} 次${day.length > 5 ? '（偏多，可能有东西让她一直重试）' : ''}`,
		];
	},

	async spend(runtime, now) {
		const last = runtime.spend.state.readings.at(-1);
		if (!last) return ['unknown', '还没读到余额'];
		const age = now - last.t;
		const balance = `余额 ${last.total.toFixed(2)} 元、今天约花 ${runtime.spend.spentToday(now).toFixed(2)} 元`;
		if (age > HOUR)
			return ['error', `${ago(age)}之后就没再读到余额；${balance}`];
		if (last.total < 5) return ['warn', `${balance}（余额偏低，该充值了）`];
		return ['ok', `${balance}（${ago(age)}读的）`];
	},

	async usageGuard(runtime) {
		if (runtime.ledger.broken) return ['error', '用量纪录写不进去，模型已暂停'];
		const pending = runtime.ledger.summary().pending;
		return [
			pending > 3 ? 'warn' : 'ok',
			`今天 ${runtime.ledger.summary().calls} 次模型调用；未结算 ${pending} 笔`,
		];
	},

	// 最近一周有动过的会话：压缩有没有发生、标签有没有贴上、有没有失败，以及最近一次调用送了多少。
	async compaction(runtime, now) {
		const root = join(runtime.home, 'sessions');
		if (!existsSync(root)) return ['unknown', '找不到会话纪录'];
		const files = [];
		for (const folder of readdirSync(root))
			for (const name of readdirSync(join(root, folder), {
				withFileTypes: true,
			}))
				if (name.isDirectory()) {
					const path = join(root, folder, name.name, 'session.v4.jsonl.zstd');
					if (existsSync(path) && now - statSync(path).mtimeMs < 7 * 24 * HOUR)
						files.push(path);
				}
		let compacted = 0,
			labelled = 0,
			failed = 0,
			largest = 0;
		for (const path of files) {
			const events = await sessionEvents(path);
			for (const event of events) {
				if (event.type?.startsWith('compaction/')) {
					const data = JSON.stringify(event.data ?? {});
					if (event.type === 'compaction/summary') {
						compacted++;
						if (data.includes('以下是較早對話的摘要')) labelled++;
					}
					if (event.data?.error) failed++;
				}
			}
			const usage = [...events]
				.reverse()
				.map((event) => findUsage(event.data))
				.find(Boolean);
			if (usage)
				largest = Math.max(
					largest,
					usage.inputTokens +
						(usage.cacheReadTokens ?? 0) +
						(usage.cacheWriteTokens ?? 0),
				);
		}
		const detail = `最近一周 ${files.length} 个会话；压缩 ${compacted} 次（${labelled} 次有标签）${failed ? `、失败 ${failed} 次` : ''}；最大一次调用送 ${Math.round(largest / 1000)}k token`;
		if (failed || labelled < compacted) return ['error', detail];
		return [
			largest > 130000 ? 'warn' : 'ok',
			detail + (largest > 130000 ? '（超过压缩门槛很多，压缩可能没生效）' : ''),
		];
	},

	// 翻原文与自动想起：真的跑一次，确认不会出错。
	async recallTools(runtime) {
		if (!runtime.archive) return ['unknown', '原文帐本没有启用'];
		const sample = runtime.archive
			.load()
			.findLast((row) => !row.bot && row.content.length >= 6);
		runtime.archive.search({
			query: sample?.content.slice(0, 4) ?? '测试',
			limit: 1,
		});
		const found = sample
			? runtime.archive.related(sample.content, {
					excludeId: sample.id,
					limit: 2,
				})
			: [];
		return [
			'ok',
			`chat_search 与自动想起都跑得动（拿最近一则试，想起 ${found.length} 则）`,
		];
	},
};

const NAMES = {
	ledger: '原文帐本',
	backup: '备份',
	backfill: '补抓旧讯息',
	notes: '背景整理',
	memory: '召回记忆',
	huanqi: '换气',
	turnSteps: '每回合上限',
	spend: '烧钱警报',
	usageGuard: '用量护栏',
	compaction: '压缩',
	recallTools: '翻原文／自动想起',
};

export async function runDoctor(runtime, now = Date.now()) {
	const items = [];
	for (const [key, check] of Object.entries(checks)) {
		let level, detail;
		try {
			[level, detail] = await check(runtime, now);
		} catch (error) {
			// 体检本身出错就照实说「读不到」，不跳过（跳过等于那一格永远是绿的）。
			[level, detail] = [
				'unknown',
				'读不到：' + String(error?.message ?? error).slice(0, 120),
			];
		}
		items.push({ key, name: NAMES[key], level, detail });
	}
	return { at: new Date(now).toISOString(), items };
}

export function doctorText(report) {
	const count = (level) =>
		report.items.filter((item) => item.level === level).length;
	const stamp = new Intl.DateTimeFormat('zh-CN', {
		timeZone: 'Asia/Taipei',
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(new Date(report.at));
	return [
		`体检（${stamp}）：✅ ${count('ok')}  ⚠️ ${count('warn')}  ❌ ${count('error')}  ❔ ${count('unknown')}`,
		...report.items.map(
			(item) => `${ICON[item.level]} ${item.name}：${item.detail}`,
		),
	].join('\n');
}
