// 她看动图的办法：模型只看得懂静态图，动图（GIF 档、Tenor／GIPHY／KLIPY 连结、mp4）平均抽 6 格，
// 拼成一张 3×2 的格子图存进工作目录，她再用 read_image 看那张。用 ffmpeg 做（VM 上要装）。
// 分享页的网址先找 Discord 替那则讯息附好的预览（动图本身的网址，像 KLIPY 的分享页会挡程式），
// 找不到才抓分享页的 og 标签；网址本身带的描述（tenor.com/view/cat-vibing-gif-1）当标题。
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_BYTES = 20 * 1024 * 1024;
const FRAMES = 6;
const ANIMATED = /\.(gif|mp4|webm|mov|m4v)$/i;
const EXTENSION = {
	'image/gif': '.gif',
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
	'video/mp4': '.mp4',
	'video/webm': '.webm',
};
const object = (properties, required = []) => ({
	type: 'object',
	properties,
	required,
	additionalProperties: false,
});

// 分享页网址里的描述：tenor.com/view/cat-vibing-gif-123、giphy.com/gifs/funny-cat-AbC123、klipy.com/gifs/a7med-434。
export function gifTitle(url) {
	const match =
		/tenor\.com\/(?:[a-z-]+\/)?view\/([^/?#]+?)-gif-\d+/i.exec(url) ??
		/giphy\.com\/gifs\/(?:[^/?#]+\/)?([^/?#]+)-[A-Za-z0-9]{6,}(?:[/?#]|$)/i.exec(
			url,
		) ??
		/klipy\.com\/gifs\/([^/?#]+)/i.exec(url);
	if (!match) return '';
	let title;
	try {
		title = decodeURIComponent(match[1]);
	} catch {
		title = match[1];
	}
	return title.replace(/[-_]+/g, ' ').trim().slice(0, 80);
}

const pageMeta = (html, property) =>
	new RegExp(
		`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
		'i',
	).exec(html)?.[1] ??
	new RegExp(
		`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
		'i',
	).exec(html)?.[1];

async function download(url, signal) {
	const response = await globalThis.fetch(url, {
		signal,
		redirect: 'follow',
		headers: {
			'user-agent': 'Mozilla/5.0 (compatible; whale-chan gif frames)',
		},
	});
	if (!response.ok)
		throw new Error(`下載失敗（HTTP ${response.status}）：${url}`);
	const size = Number(response.headers.get('content-length') ?? 0);
	if (size > MAX_BYTES) throw new Error('動圖太大（超過 20 MB）');
	const data = Buffer.from(await response.arrayBuffer());
	if (data.length > MAX_BYTES) throw new Error('動圖太大（超過 20 MB）');
	return {
		data,
		type: String(response.headers.get('content-type') ?? '').split(';')[0],
	};
}

// Discord 已经替贴了这个网址的讯息附好预览：在这个频道最近的讯息里找，用预览里的动图网址。
async function embedMedia(runtime, url, channelId) {
	if (!channelId || !runtime.discordRest) return undefined;
	const messages = await runtime.discordRest
		.request('GET', `/channels/${channelId}/messages?limit=50`)
		.catch(() => []);
	for (const message of messages ?? []) {
		if (!String(message.content ?? '').includes(url)) continue;
		for (const embed of message.embeds ?? []) {
			const media =
				embed.video?.proxy_url ??
				embed.video?.url ??
				embed.image?.proxy_url ??
				embed.image?.url ??
				embed.thumbnail?.proxy_url ??
				embed.thumbnail?.url;
			if (media) return { url: media, title: embed.title ?? '' };
		}
	}
	return undefined;
}

// 分享页换成真正的动图网址；本来就是档案的网址原样回传。
async function resolveMedia(runtime, url, channelId, signal) {
	const host = new globalThis.URL(url).host;
	const direct =
		ANIMATED.test(new globalThis.URL(url).pathname) ||
		/\.(png|jpe?g|webp)$/i.test(new globalThis.URL(url).pathname) ||
		/(?:^|\.)(?:discordapp\.(?:com|net)|discord\.com)$/i.test(host);
	if (direct) return { url, title: gifTitle(url) };
	const fromEmbed = await embedMedia(runtime, url, channelId);
	if (fromEmbed)
		return { url: fromEmbed.url, title: gifTitle(url) || fromEmbed.title };
	const page = await download(url, signal);
	if (!page.type.includes('html')) return { url, title: gifTitle(url), page };
	const html = page.data.toString('utf8');
	const media =
		pageMeta(html, 'og:video:secure_url') ??
		pageMeta(html, 'og:video') ??
		pageMeta(html, 'og:image');
	if (!media) throw new Error('這個頁面找不到動圖。');
	return {
		url: media.replace(/&amp;/g, '&'),
		title: gifTitle(url) || (pageMeta(html, 'og:title') ?? '').slice(0, 80),
	};
}

export function gifToolkit(runtime) {
	const root = dirname(runtime.groupRoot);
	const out = join(runtime.groupRoot, '.discord-uploads', 'gif-frames');
	const inside = async (path) => {
		const real = await realpath(path);
		const base = await realpath(root);
		if (!real.startsWith(base + sep))
			throw new Error('只收工作目錄裡的檔案或 http(s) 網址：' + path);
		if ((await stat(real)).size > MAX_BYTES)
			throw new Error('動圖太大（超過 20 MB）');
		return real;
	};

	// 来源（工作目录里的路径、图片／动图网址、分享页）变成工作目录里的一个档案。
	// downloaded 为 true 表示是这次下载的，用完可以删。
	async function fetchSource(source, channelId, signal) {
		const input = String(source).trim();
		if (!/^[a-z]+:\/\//i.test(input))
			return { path: await inside(input), title: '', downloaded: false };
		if (!/^https?:\/\//i.test(input))
			throw new Error('只收工作目錄裡的檔案或 http(s) 網址：' + input);
		await mkdir(out, { recursive: true });
		const media = await resolveMedia(runtime, input, channelId, signal);
		const file = media.page ?? (await download(media.url, signal));
		const extension =
			EXTENSION[file.type] ??
			(extname(new globalThis.URL(media.url).pathname).toLowerCase() || '.bin');
		const path = join(out, `${randomUUID().slice(0, 8)}${extension}`);
		await writeFile(path, file.data);
		return { path, title: media.title, downloaded: true };
	}

	// 平均抽 6 格拼成 3×2 的格子图。
	async function frameSheet(input, signal) {
		await mkdir(out, { recursive: true });
		const probe = await run(
			'ffprobe',
			[
				'-v',
				'error',
				'-show_entries',
				'format=duration',
				'-of',
				'csv=p=0',
				input,
			],
			{ signal, timeout: 15_000 },
		).catch(() => ({ stdout: '' }));
		const seconds = Number.parseFloat(probe.stdout) || 0;
		// 抽格的速率：整段平均 6 格；量不到长度就每秒一格。
		const rate = seconds > 0 ? `${FRAMES}/${seconds.toFixed(3)}` : '1';
		const sheet = join(out, `${randomUUID().slice(0, 8)}.jpg`);
		await run(
			'ffmpeg',
			[
				'-v',
				'error',
				'-y',
				'-i',
				input,
				'-vf',
				`fps=${rate},scale=320:-2:flags=lanczos,tile=3x2:padding=4:color=white`,
				'-frames:v',
				'1',
				'-q:v',
				'4',
				sheet,
			],
			{ signal, timeout: 30_000 },
		);
		return { sheet, seconds };
	}

	// 给大小姐看的图：动图先拆成格子图（她的模型也只看得到动图第一格），静态图原样。
	async function imageForOjousama(source, channelId) {
		const signal = globalThis.AbortSignal.timeout(30_000);
		const got = await fetchSource(source, channelId, signal);
		if (!ANIMATED.test(got.path)) return { path: got.path, animated: false };
		try {
			return {
				path: (await frameSheet(got.path, signal)).sheet,
				animated: true,
			};
		} finally {
			if (got.downloaded) await rm(got.path, { force: true });
		}
	}

	const tools = [
		{
			name: 'gif_frames',
			description:
				'看動圖：模型只看得懂靜態圖，動圖（.gif 檔、Tenor／GIPHY／KLIPY 連結、mp4）用這個平均抽 6 格，拼成一張 3×2 的格子圖，再用 read_image 看那張（格子由左到右、上到下是時間順序）。source 給群友傳的圖存好的路徑，或動圖／分享頁的網址（貼在現在這個頻道的連結會直接用 Discord 附好的預覽）。被問到、或那張動圖跟話題有關時才用。',
			parameters: object(
				{ source: { type: 'string', minLength: 1, maxLength: 500 } },
				['source'],
			),
			output: {
				schema: object(
					{ ok: { type: 'boolean' }, message: { type: 'string' } },
					['ok'],
				),
				render: (_args, result) => [
					{
						type: 'text',
						text: result.ok ? result.message : '沒有做成：' + result.message,
					},
				],
			},
			execute: async ({ source }, exec) => {
				const signal = globalThis.AbortSignal.timeout(30_000);
				let got;
				try {
					got = await fetchSource(
						source,
						runtime.sourceForTurn?.(exec?.agent)?.channelId,
						signal,
					);
					const { sheet, seconds } = await frameSheet(got.path, signal);
					return {
						ok: true,
						message: `做好了：${sheet}（${seconds ? `約 ${seconds.toFixed(1)} 秒，` : ''}6 格，左到右、上到下是時間順序${got.title ? `；網址上的描述：${got.title}` : ''}）。用 read_image 看這張。`,
					};
				} catch (error) {
					return {
						ok: false,
						message: String(error?.message ?? error).slice(0, 300),
					};
				} finally {
					if (got?.downloaded) await rm(got.path, { force: true });
				}
			},
		},
	];
	return { tools, imageForOjousama };
}

export function gifTools(runtime) {
	return gifToolkit(runtime).tools;
}
