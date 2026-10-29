// 桥接调用这些接点，消息身份不从模型生成的文字推断。
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { savedPresence } from './discord-tools.mjs';
import { currentRuntime } from './index.mjs';

let toTaiwan;

const MASK = '[已遮蔽]';
const credentialsPath = () =>
	join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml');

// 送往 Discord 的文字一律遮掉进程读得到的机密：名称像金钥的环境变数（含 bot token）、
// dsh 帐号凭证档里的长字串，以及常见格式的金钥。群聊开放完整工具后，她自己逛家里
// 跑个 env 或 cat 也不会把这些贴出去；她能做的事不受影响。
export function redactSecrets(
	text,
	{ env = process.env, credentials = credentialsPath() } = {},
) {
	const values = new Set();
	for (const [key, value] of Object.entries(env))
		if (
			/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i.test(key) &&
			typeof value === 'string' &&
			value.length >= 12
		)
			values.add(value);
	try {
		for (const [value] of readFileSync(credentials, 'utf8').matchAll(
			/[A-Za-z0-9+=_.-]{24,}/g,
		))
			if (/\d/.test(value) && /[A-Za-z]/.test(value)) values.add(value);
	} catch {
		/* 没有凭证档就只遮环境变数与格式。 */
	}
	let result = String(text);
	for (const value of [...values].sort((a, b) => b.length - a.length))
		result = result.split(value).join(MASK);
	return result
		.replace(/[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}/g, MASK)
		.replace(/\bsk-[A-Za-z0-9_-]{20,}/g, MASK);
}

// 群聊一律送台湾繁体；程式码与网址保持原样。字典约 1 MB，第一次用到才载入；
// 转换器坏掉时送原文，宁可简体也不要整句不回。
export async function toGroupText(
	text,
	load = () => import('./vendor/opencc-js/cn2t.js'),
) {
	try {
		toTaiwan ??= (await load()).Converter({ from: 'cn', to: 'twp' });
	} catch {
		return redactSecrets(text);
	}
	return redactSecrets(
		String(text)
			.split(/(```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+)/)
			.map((part, index) => (index % 2 ? part : toTaiwan(part)))
			.join(''),
	);
}

let toSimplified;
const STICKER_MARK = /\[sticker:([^\]\n]{1,80})\]/g;
// 社群台词梗图（meme-library.mjs）；她有时包进反引号，一起拿掉。
const MEME_MARK = /`?\[(?:梗圖|梗图|meme)[:：]\s*([^\]\n]{1,80})\]`?/gi;

// 表情资料里的名字与情绪词是简体，她写的是繁体。
export async function toSimplifiedText(
	text,
	load = () => import('./vendor/opencc-js/t2cn.js'),
) {
	try {
		toSimplified ??= (await load()).Converter({ from: 'tw', to: 'cn' });
		return toSimplified(String(text));
	} catch {
		return String(text);
	}
}

// 工具拦截是同步的，只能用已经载入的转换器；还没载入就回 undefined（不拦）。
export function simplifiedNow(text) {
	return toSimplified?.(String(text));
}

// 群聊回覆送出前：[sticker:…] 换成大肥鱼表情 GIF 附件，其余文字转繁体、遮机密。
// 表情插件没装或出错时，把标记拿掉只送文字，不让「[sticker:开心]」原样出现在群里。
// 模型偶尔把工具调用写成文字（「[tool: sticker_search]」「<tool_use>…</tool_use>」），群里不该看到。
const PSEUDO_TOOL =
	/<tool_use>[\s\S]*?<\/tool_use>|<\/?(?:tool_use|function_calls|invoke|parameter)\b[^>]*>|\[tool:\s*[\w.-]+\]/g;
// 插件给网页用的本机图片连结（![名字](http://127.0.0.1:3080/…)），Discord 打不开：抓下来改成附件。
const LOCAL_IMAGE =
	/!\[[^\]\n]*\]\((https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/[^)\s]+)\)/g;

export async function fetchLocalImage(url) {
	const response = await globalThis.fetch(url, {
		signal: globalThis.AbortSignal.timeout(10000),
	});
	if (!response.ok) throw new Error('本机图片读取失败：' + response.status);
	if (!String(response.headers.get('content-type')).startsWith('image/'))
		throw new Error('不是图片');
	const data = Buffer.from(await response.arrayBuffer());
	if (!data.length || data.length > 8 * 1024 * 1024)
		throw new Error('图片大小不对');
	return {
		filename: basename(new globalThis.URL(url).pathname) || 'image.gif',
		data,
	};
}

export async function prepareGroupReply(
	text,
	{ fetchImage = fetchLocalImage } = {},
) {
	// 她有时把标记包进反引号，先拆掉，免得送出后留下一对空的反引号。
	// dsh-meme 的「[表情: 描述]」是给网页前端换图用的，Discord 换不了，直接拿掉。
	let rest = String(text)
		.replace(PSEUDO_TOOL, '')
		.replace(/`(\[sticker:[^\]\n]{1,80}\])`/g, '$1')
		.replace(/`?\[表情[:：][^\]\n]{0,120}\]`?/g, '');
	let files = [];
	for (const [, url] of [...rest.matchAll(LOCAL_IMAGE)].slice(0, 2))
		try {
			files.push(await fetchImage(url));
		} catch {
			/* 抓不到就只拿掉连结。 */
		}
	rest = rest.replace(LOCAL_IMAGE, '');
	if (rest.includes('[sticker:'))
		try {
			const stickered = await currentRuntime().stickerize(
				rest,
				toSimplifiedText,
			);
			rest = stickered.text;
			files = [...files, ...stickered.files];
		} catch {
			/* 贴图失败只送文字。 */
		}
	// [梗圖:台词或关键词]：在社群台词梗图库里找最像的一张附上（每则最多一张）；找不到就只拿掉标记。
	for (const [, query] of [...rest.matchAll(MEME_MARK)].slice(0, 1))
		try {
			const hit = currentRuntime().memeLibrary?.find(
				await toSimplifiedText(query),
			);
			if (hit)
				files.push({ filename: hit.filename, data: readFileSync(hit.path) });
		} catch {
			/* 找图失败只送文字。 */
		}
	rest = rest
		.replace(MEME_MARK, '')
		.replace(STICKER_MARK, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return {
		text: rest ? await toGroupText(rest) : '',
		files: files.slice(0, 4),
	};
}

// 桥接登入后把它的 REST 客户端交给群聊插件，Discord 工具共用同一个 token 与端点。
export function registerDiscordRest(rest) {
	currentRuntime().discordRest = rest;
}

// 闸道交给群聊插件，她改状态（op 3）要用；重新登入（identify）时带上存档的状态。
export function registerDiscordGateway(gateway) {
	currentRuntime().gateway = gateway;
}

export function socialPresence() {
	return savedPresence(currentRuntime());
}

// huanqi（换气）判定一轮是废的（空回合、刷屏被截断）时，会等这一轮结束、再补一则
// source.kind=loop-guard 的讯息另开一轮。桥接原本只等第一轮，补救轮的回答就不会传到 Discord。
// 这里等补救轮跑完（最多几次），取回答时也把补救轮算进去。
const RESCUE = 'loop-guard';
const sourceOf = (event) => event?.data?.source ?? event?.data?.message?.source;

export async function settleSocialTurn(agent, pause = (ms) => delay(ms)) {
	for (let round = 0; round < 8; round++) {
		await pause(300);
		const events =
			agent.session?.snapshotEvents?.() ?? agent.session?.events ?? [];
		const ended = events.findLastIndex((event) => event.type === 'turn/end');
		if (
			!events
				.slice(ended + 1)
				.some(
					(event) =>
						event.type === 'turn/start' ||
						(event.type === 'user/message' && sourceOf(event)?.kind === RESCUE),
				)
		)
			return;
		await agent.whenIdle();
	}
}

// 与桥接的 extractReply 相同，但回合结束后紧接着是 huanqi 的补救讯息时继续往下收，
// 取最后一则有文字的回答；碰到别的讯息（下一个人说话）就停。
export function extractSocialReply(events, promptSeq) {
	let text = '';
	let reasonKind;
	let errorMessage;
	for (const event of events) {
		if (event.seq < promptSeq) continue;
		if (event.type === 'user/message' && event.seq > promptSeq) {
			if (reasonKind === undefined) continue;
			if (sourceOf(event)?.kind !== RESCUE) break;
			reasonKind = undefined;
			errorMessage = undefined;
			continue;
		}
		if (reasonKind !== undefined) continue;
		if (event.type === 'assistant/message') {
			const joined = (event.data.message?.content ?? [])
				.filter((block) => block.type === 'text')
				.map((block) => block.text ?? '')
				.join('');
			if (joined !== '') text = joined;
			continue;
		}
		if (event.type === 'turn/end') {
			reasonKind = event.data.reason?.kind;
			errorMessage = event.data.reason?.error?.message;
		}
	}
	return { text, reasonKind, errorMessage };
}

// 闸道收到的每一则讯息、编辑、删除都进原文帐本（在任何过滤之前）；写不进去也不影响聊天。
export function socialArchive(kind, data) {
	try {
		currentRuntime().archive?.record(kind, data);
	} catch {
		/* 帐本写入失败只少一笔纪录。 */
	}
}

export function socialGuildOwner(guildId) {
	return currentRuntime().guildOwner(guildId);
}

export function socialConsolidate(lines, place, options) {
	return currentRuntime().consolidate(lines, place, options);
}

export function socialChannelLabel(channelId) {
	return currentRuntime().channelLabel(channelId);
}

// 讯息里的图以前看过的话，回传要附在聊天纪录那一行的提示（见 image-memory.mjs）。
export async function socialImageNotes(message) {
	return (await currentRuntime().imageMemory?.notes(message)) ?? [];
}

export function isSocialOwner(id) {
	return currentRuntime().ownerIds.includes(id);
}

export function admitSocialMessage(message) {
	return currentRuntime().admit(message);
}
export function prepareSocialTurn(agent, channelId, messageId) {
	return currentRuntime().prepare(agent, channelId, messageId);
}
export function handleSocialControl(message, reply) {
	return currentRuntime().control(message, reply);
}

export async function assertGroupSession(ctx, id, cwd) {
	const rows = await ctx.get('sessionPersistence').list();
	const header = rows
		.map((row) => row.header ?? row)
		.find((row) => String(row.id) === id);
	if (!header || header.cwd !== cwd)
		throw new Error('群聊只能绑定同一群聊工作区的会话。');
}
