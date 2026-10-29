// 她认得看过的图：每张图片算一个画面指纹（dHash，64 位元），跟以前看过的比。
// 差 6 位以内就是同一张图，被裁切、缩放、重新压缩也认得（完全不同的图通常差 30 位左右）。
// 认出来时在聊天纪录那一行后面附上「这张图某时在哪出现过」和那则讯息的 id，她用 chat_open 看当时大家怎么说：
// 答案来自原文帐本，不是凭印象。记录只追加在 image-memory.jsonl；指纹用 ffmpeg 缩成 9×8 灰阶来算。
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	appendFile,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SAME = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const SAVED = /^(\d{17,20})-.+\.(png|jpe?g|gif|webp)$/i;

// Discord 讯息 id 里带着发送时间。
export const snowflakeTime = (id) =>
	Number((BigInt(id) >> 22n) + 1420070400000n);

export const distance = (a, b) => {
	let x = BigInt('0x' + a) ^ BigInt('0x' + b),
		count = 0;
	for (; x; x &= x - 1n) count++;
	return count;
};

// 9×8 灰阶，每列比较相邻两格亮暗：64 位元，以十六进位字串保存。
export async function dhash(path) {
	const { stdout } = await run(
		'ffmpeg',
		[
			'-v',
			'error',
			'-i',
			path,
			'-vf',
			'scale=9:8,format=gray',
			'-frames:v',
			'1',
			'-f',
			'rawvideo',
			'pipe:1',
		],
		{ encoding: 'buffer', timeout: 10_000, maxBuffer: 1 << 16 },
	);
	if (stdout.length < 72) throw new Error('图片读不出来');
	let bits = 0n;
	for (let y = 0; y < 8; y++)
		for (let x = 0; x < 8; x++)
			bits =
				(bits << 1n) | (stdout[y * 9 + x] > stdout[y * 9 + x + 1] ? 1n : 0n);
	return bits.toString(16).padStart(16, '0');
}

const imagesOf = (message) =>
	(Array.isArray(message.attachments) ? message.attachments : []).filter(
		(file) =>
			String(file?.content_type ?? '').startsWith('image/') ||
			IMAGE.test(String(file?.filename ?? '')),
	);

export class ImageMemory {
	constructor({
		file,
		uploads,
		label = async () => undefined,
		timeZone = 'Asia/Taipei',
		hash = dhash,
	}) {
		this.file = file;
		this.uploads = uploads;
		this.label = label;
		this.hash = hash;
		this.clock = new Intl.DateTimeFormat('en-GB', {
			timeZone,
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		});
		this.entries = [];
		this.ready = this.load();
	}

	async load() {
		try {
			for (const line of (await readFile(this.file, 'utf8')).split('\n'))
				if (line.trim()) this.entries.push(JSON.parse(line));
		} catch {
			/* 还没有记录。 */
		}
	}

	async remember(entry) {
		if (this.entries.some((seen) => seen.id === entry.id && seen.h === entry.h))
			return;
		this.entries.push(entry);
		await appendFile(this.file, JSON.stringify(entry) + '\n', { mode: 0o600 });
	}

	// 跟以前看过的比：群聊只比群聊里看过的（私讯的图不拿到群里说），私讯两边都比。挑最早那次（当时的讨论在那里）。
	match(hash, id, scope) {
		return this.entries
			.filter(
				(seen) =>
					seen.id !== id &&
					(scope === 'dm' || seen.scope === 'group') &&
					distance(seen.h, hash) <= SAME,
			)
			.sort((a, b) => a.t - b.t)[0];
	}

	async describe(seen) {
		const part = Object.fromEntries(
			this.clock
				.formatToParts(new Date(seen.t))
				.map(({ type, value }) => [type, value]),
		);
		const place =
			seen.scope === 'dm'
				? '私訊裡'
				: await this.label(seen.channel_id)
						.then((label) => (label?.channel ? `在 #${label.channel}` : ''))
						.catch(() => '');
		return `［這張圖 ${part.month}/${part.day} ${part.hour}:${part.minute} ${place}出現過${seen.author ? `（${seen.author} 傳的）` : ''}，想知道當時大家怎麼說，用 chat_open 看〔${seen.id}〕］`;
	}

	// 存好的档（桥接把叫她的图存在工作目录，档名开头是讯息 id）优先；没存就从讯息附件的网址下载。
	async fileFor(message, attachment) {
		const name = String(attachment.filename ?? '');
		const saved = join(this.uploads, `${message.id}-${name}`);
		try {
			if ((await stat(saved)).isFile())
				return { path: saved, temporary: false };
		} catch {
			/* 没存，下载。 */
		}
		const response = await globalThis.fetch(attachment.url, {
			signal: globalThis.AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`下载失败 ${response.status}`);
		const data = Buffer.from(await response.arrayBuffer());
		if (data.length > MAX_BYTES) throw new Error('图片太大');
		const path = join(tmpdir(), `whale-image-${randomUUID()}`);
		await writeFile(path, data);
		return { path, temporary: true };
	}

	// 一则讯息的图：认得的回传提示（附在聊天纪录那一行），并把这几张记下来。出错就当没看过，不影响聊天。
	async notes(message) {
		await this.ready;
		const notes = [];
		const scope = message.guild_id ? 'group' : 'dm';
		for (const attachment of imagesOf(message).slice(0, 2)) {
			let file;
			try {
				file = await this.fileFor(message, attachment);
				const h = await this.hash(file.path);
				const seen = this.match(h, message.id, scope);
				await this.remember({
					h,
					id: String(message.id),
					channel_id: String(message.channel_id ?? ''),
					author: String(
						message.author?.global_name || message.author?.username || '',
					).slice(0, 40),
					scope,
					t: snowflakeTime(message.id),
				});
				if (seen) notes.push(await this.describe(seen));
			} catch {
				/* 这张图算不出指纹就略过。 */
			} finally {
				if (file?.temporary) await rm(file.path, { force: true });
			}
		}
		return notes;
	}

	// 启动时把工作目录里存过的旧图补进来（作者、频道从原文帐本查）。回传新补了几张。
	async backfill(lookup = () => undefined) {
		await this.ready;
		const known = new Set(this.entries.map((seen) => seen.id));
		let added = 0;
		let names;
		try {
			names = await readdir(this.uploads);
		} catch {
			return 0;
		}
		for (const name of names) {
			const match = SAVED.exec(name);
			if (!match || known.has(match[1])) continue;
			try {
				const row = lookup(match[1]);
				await this.remember({
					h: await this.hash(join(this.uploads, name)),
					id: match[1],
					channel_id: String(row?.channel_id ?? ''),
					author: String(row?.author ?? '').slice(0, 40),
					scope: row?.scope === 'dm' ? 'dm' : 'group',
					t: snowflakeTime(match[1]),
				});
				known.add(match[1]);
				added++;
			} catch {
				/* 读不出来的档略过。 */
			}
		}
		return added;
	}
}
