// 社群做的鲸鱼娘台词梗图（梗鲸 aigengtu.com，非营利粉丝向可用）：她在回话里写「[梗圖:台词或关键词]」，
// 桥接在这里找最像的一张附上去，跟 [sticker:…] 一样不多花一次模型呼叫。
// 索引由 deploy/dsh/build_meme_library.py 建（台词是简体，查询前先转简体）；找不到够像的就不附图，不乱配。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { grams } from './archive.mjs';

// 台词最重要，描述其次，梗来历只当参考。
const WEIGHT = { quote: 3, caption: 1, story: 0.5 };
const RECENT = 30;

export class MemeLibrary {
	constructor(root) {
		this.root = root;
		this.mtime = 0;
		this.entries = [];
		this.idf = new Map();
		this.recent = [];
	}

	// 索引档换了（重跑建库脚本）就重新载入。
	load() {
		const file = join(this.root, 'index.json');
		let mtime;
		try {
			mtime = statSync(file).mtimeMs;
		} catch {
			this.entries = [];
			return;
		}
		if (mtime === this.mtime) return;
		this.mtime = mtime;
		const index = JSON.parse(readFileSync(file, 'utf8'));
		this.entries = (index.memes ?? [])
			.filter((meme) => existsSync(join(this.root, meme.file)))
			.map((meme) => ({
				...meme,
				quoteText: String(meme.quote ?? '').toLowerCase(),
				grams: {
					quote: grams(meme.quote ?? ''),
					caption: grams(meme.caption ?? ''),
					story: grams(meme.story ?? ''),
				},
			}));
		const df = new Map();
		for (const entry of this.entries)
			for (const gram of new Set([
				...entry.grams.quote,
				...entry.grams.caption,
				...entry.grams.story,
			]))
				df.set(gram, (df.get(gram) ?? 0) + 1);
		this.idf = new Map(
			[...df].map(([gram, count]) => [
				gram,
				Math.log(this.entries.length / count) + 1,
			]),
		);
	}

	// query 要先转简体。回传 { path, filename, caption }，没有够像的就 undefined。
	find(query) {
		this.load();
		const text = String(query).trim().toLowerCase();
		const wanted = grams(text);
		if (!this.entries.length || !wanted.size) return undefined;
		const scored = [];
		for (const entry of this.entries) {
			let score = 0,
				hits = 0;
			for (const gram of wanted) {
				const idf = this.idf.get(gram) ?? 0;
				const field = entry.grams.quote.has(gram)
					? 'quote'
					: entry.grams.caption.has(gram)
						? 'caption'
						: entry.grams.story.has(gram)
							? 'story'
							: undefined;
				if (!field) continue;
				score += WEIGHT[field] * idf;
				// 梗来历只加分，不算对上。
				if (field !== 'story') hits++;
			}
			// 整句台词对上最准；否则至少要对上两个片段（只给两个字的就对上那一个）。
			const exact = text.length >= 2 && entry.quoteText.includes(text);
			if (exact) score += 10 * wanted.size;
			if (exact || hits >= Math.min(2, wanted.size))
				scored.push({ entry, score });
		}
		if (!scored.length) return undefined;
		scored.sort(
			(a, b) => b.score - a.score || a.entry.n.localeCompare(b.entry.n),
		);
		// 差不多像的几张里，挑最近没发过的，免得每次都同一张。
		const close = scored.filter(({ score }) => score >= scored[0].score * 0.8);
		const pick =
			close.find(({ entry }) => !this.recent.includes(entry.n)) ?? close[0];
		this.recent = [
			...this.recent.filter((n) => n !== pick.entry.n),
			pick.entry.n,
		].slice(-RECENT);
		return {
			path: join(this.root, pick.entry.file),
			filename: basename(pick.entry.file),
			caption: pick.entry.quote || pick.entry.caption,
		};
	}
}
