// Markdown 是记忆正本；只追加记录与遗忘事件，召回沿用已审阅的鱼记忆算法。
import { createHash, randomUUID } from 'node:crypto';
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export class MemoryStore {
	constructor(root, engine, { timeZone = 'Asia/Taipei', dailyQuota = 8 } = {}) {
		this.root = root;
		this.engine = engine;
		this.timeZone = timeZone;
		this.dailyQuota = dailyQuota;
		this.lastRecall = new Map();
		mkdirSync(root, { recursive: true, mode: 0o700 });
	}

	directory(scope) {
		const directory = join(
			this.root,
			createHash('sha256').update(scope).digest('hex').slice(0, 32),
		);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		return directory;
	}

	day(now) {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: this.timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format(new Date(now));
	}

	all(scope) {
		const directory = this.directory(scope);
		const records = [];
		for (const name of readdirSync(directory)) {
			if (!/^[a-f0-9-]{36}\.md$/.test(name)) continue;
			const path = join(directory, name);
			if (statSync(path).size > 12000)
				throw new Error('记忆档异常，暂停写入以保护原档。');
			const content = readFileSync(path, 'utf8');
			const match = /^---\r?\n([^\n]+)\r?\n---\r?\n([\s\S]*)$/.exec(content);
			if (!match) throw new Error('记忆格式损坏，请先检查原档。');
			const record = JSON.parse(match[1]);
			if (
				record.scope !== scope ||
				record.id + '.md' !== name ||
				!['memory', 'forget', 'recall'].includes(record.type)
			)
				throw new Error('记忆范围不符。');
			records.push({ ...record, text: match[2].trim() });
		}
		return records.sort(
			(a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
		);
	}

	active(scope) {
		const records = this.all(scope);
		const forgotten = new Set(
			records
				.filter((record) => record.type === 'forget')
				.map((record) => record.target),
		);
		return records.filter(
			(record) => record.type === 'memory' && !forgotten.has(record.id),
		);
	}

	append(scope, metadata, text) {
		const directory = this.directory(scope);
		const path = join(directory, metadata.id + '.md');
		const temporary = path + '.tmp';
		writeFileSync(
			temporary,
			'---\n' +
				JSON.stringify({ ...metadata, scope }) +
				'\n---\n' +
				text +
				'\n',
			{ flag: 'wx', mode: 0o600 },
		);
		renameSync(temporary, path);
	}

	remember(scope, source, args, now = Date.now()) {
		if (!source?.authorId || !source.messageId)
			throw new Error('没有可验证的消息来源，不写入记忆。');
		const text = String(args.text ?? '').trim();
		if (
			!text ||
			text.length > 500 ||
			/dp\.st\.|sk-[a-z0-9]{16,}|[a-z0-9_-]{20,}\.[a-z0-9_-]{6,}\.[a-z0-9_-]{20,}/i.test(
				text,
			)
		)
			throw new Error('内容不适合写入记忆。');
		const existing = this.active(scope);
		const duplicate = existing.find(
			(record) => record.authorId === source.authorId && record.text === text,
		);
		if (duplicate) return { ok: true, id: duplicate.id, duplicate: true };
		if (
			this.all(scope).filter(
				(record) =>
					record.type === 'memory' &&
					this.day(Date.parse(record.at)) === this.day(now),
			).length >= this.dailyQuota
		)
			return { ok: false, message: '今天先记到这里。' };
		const id = randomUUID();
		this.append(
			scope,
			{
				id,
				type: 'memory',
				at: new Date(now).toISOString(),
				authorId: source.authorId,
				authorName: String(source.authorName || '').slice(0, 80),
				messageId: source.messageId,
				...(source.channelId ? { channelId: source.channelId } : {}),
				...(source.guildId ? { guildId: source.guildId } : {}),
				kind: args.kind === 'fact' ? 'fact' : 'event',
				importance: Math.max(
					0,
					Math.min(1, Number.isFinite(args.importance) ? args.importance : 0.5),
				),
				tags: Array.isArray(args.tags)
					? args.tags.slice(0, 6).map((tag) => String(tag).slice(0, 40))
					: [],
			},
			text,
		);
		return { ok: true, id };
	}

	forget(scope, target, now = Date.now()) {
		if (!this.active(scope).some((record) => record.id === target))
			return false;
		this.append(
			scope,
			{
				id: randomUUID(),
				type: 'forget',
				target,
				at: new Date(now).toISOString(),
			},
			'拥有者要求不再召回，原记录保留。',
		);
		return true;
	}

	recall(scope, query, now = Date.now()) {
		return this.recallAcross([scope], query, now);
	}

	// 她是同一个人：群聊与拥有者私讯的记忆一起找，结果带上来自哪个范围（私讯的就是「私下」的事）。
	// 各范围仍存在自己的资料夹，召回刷新也写回原范围。
	recallAcross(scopes, query, now = Date.now()) {
		const records = scopes.flatMap((scope) =>
			this.active(scope).map((record) => ({ ...record, scope })),
		);
		const recalled = new Map();
		for (const scope of scopes)
			for (const event of this.all(scope)) {
				if (event.type === 'recall')
					for (const id of event.targets || []) recalled.set(id, event.at);
			}
		const data = this.engine.blank();
		Object.assign(data.policy, {
			baseHalfLifeDays: 30,
			maxItems: 6,
			maxChars: 800,
			factsMax: 2,
			queryGate: 0,
		});
		data.memories = records.map((record) => ({
			id: record.id,
			text: record.text,
			at: record.at,
			createdAt: record.at,
			category: record.kind === 'fact' ? 'stable_profile' : 'event',
			importance: record.importance,
			emotion: null,
			tags: record.tags,
			source: '有来源的群聊记录',
			reinforcedAt: null,
			lastReinforcedDay: null,
			activationAnchor: recalled.get(record.id) || record.at,
			activation0: 1,
		}));
		const result = this.engine.recall(data, query, now, scopes[0]);
		const selected = result.selected
			.slice(0, 6)
			.map((row) => records.find((record) => record.id === row.m.id))
			.filter(Boolean);
		const summary = {
			time: now,
			ids: selected.map((record) => record.id),
			rows: result.selected
				.slice(0, 6)
				.map((row) => ({ id: row.m.id, scores: row.s })),
		};
		for (const scope of scopes) {
			this.lastRecall.set(scope, summary);
			const targets = selected
				.filter(
					(record) =>
						record.scope === scope &&
						(!recalled.has(record.id) ||
							this.day(Date.parse(recalled.get(record.id))) !== this.day(now)),
				)
				.map((record) => record.id);
			if (targets.length)
				this.append(
					scope,
					{
						id: randomUUID(),
						type: 'recall',
						at: new Date(now).toISOString(),
						targets,
					},
					'召回刷新鲜活度，原始事件时间不变。',
				);
		}
		return selected;
	}
}
