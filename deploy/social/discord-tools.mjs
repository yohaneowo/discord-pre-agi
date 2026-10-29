// 她在 Discord 的手：一般操作群友都能叫她做；删别人的讯息、踢人、封人、禁言、身分组与权限、
// 服务器设定、表情、邀请、私讯只认站长或该服务器的群主；她自己的头像、名字、状态只认站长
// （宿主验证的 Discord ID，不看显示名称或模型参数）。每次操作都记一笔供站长查。
import {
	appendFileSync,
	existsSync,
	readFileSync,
	readdirSync,
	realpathSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { gifToolkit } from './gif-tools.mjs';

const MAX_FILE = 8 * 1024 * 1024;

// dsh-meme 的 send_meme／meme_list 候选给的是相对路径：目前图库的「memes/分类/档名」，
// 或别的图库的「图库id/memes/分类/档名」。在各图库根目录底下找出实际档案。
export function memePath(roots, path) {
	const relative = String(path).replace(/^\/+/, '');
	if (relative.split(/[\\/]/).includes('..'))
		throw new Error('附件路径不能往上跳：' + path);
	for (const root of roots) {
		const direct = join(root, relative);
		if (existsSync(direct)) return direct;
		let packs;
		try {
			packs = readdirSync(root, { withFileTypes: true }).filter((entry) =>
				entry.isDirectory(),
			);
		} catch {
			continue;
		}
		for (const pack of packs) {
			const inside = join(root, pack.name, relative);
			if (existsSync(inside)) return inside;
		}
	}
	throw new Error('找不到这个图：' + path);
}

// 附件不经过文字的机密遮蔽，所以在这里把关：只收工作目录（/srv/dsh）底下的档案，
// 链接不能跳出去；像金钥的档名一律不收；文字档内容里有机密也不收。
export function attachmentReader(roots, redact) {
	const allowed = [roots].flat();
	return (path) => {
		const real = realpathSync(String(path));
		if (
			!allowed.some((root) => {
				try {
					return real.startsWith(realpathSync(root) + sep);
				} catch {
					return false;
				}
			})
		)
			throw new Error('附件只能是工作目录里的档案：' + path);
		if (
			/^\.env|credential|secret|id_[a-z0-9]+$|\.(pem|key)$/i.test(
				basename(real),
			)
		)
			throw new Error('这种档案不能传：' + basename(real));
		if (statSync(real).size > MAX_FILE)
			throw new Error('档案超过 8 MB：' + basename(real));
		const data = readFileSync(real);
		const head = data.subarray(0, 8192);
		if (!head.includes(0)) {
			const text = data.toString('utf8');
			if (redact(text) !== text)
				throw new Error('档案里有金钥或凭证，不传：' + basename(real));
		}
		return { filename: basename(real), data };
	};
}

const id = { type: 'string', pattern: '^\\d{5,25}$' };
const object = (properties, required = []) => ({
	type: 'object',
	properties,
	required,
	additionalProperties: false,
});
const text = (maxLength, minLength = 1) => ({
	type: 'string',
	minLength,
	maxLength,
});
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const file = { type: 'string', minLength: 1, maxLength: 300 };

const OWNER_DENIED = '这个操作只有站长，或这个服务器的群主叫我才能做。';
const MIME = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
};

// 服务器头像、表情、她自己的头像都用 data URI 上传。
export function dataUri({ filename, data }, max = MAX_FILE) {
	const mime = MIME[filename.split('.').pop().toLowerCase()];
	if (!mime) throw new Error('图片只收 png、jpg、gif、webp：' + filename);
	if (data.length > max)
		throw new Error(
			`图片太大（上限 ${Math.round(max / 1024)} KB）：` + filename,
		);
	return `data:${mime};base64,${data.toString('base64')}`;
}

// 有附件就走 multipart（payload_json + files[n]），否则一般 JSON。
async function postMessage(rest, channelId, payload, files = []) {
	if (!files.length)
		return await rest.request(
			'POST',
			`/channels/${channelId}/messages`,
			payload,
		);
	const form = new globalThis.FormData();
	form.append(
		'payload_json',
		JSON.stringify({
			...payload,
			attachments: files.map((item, index) => ({
				id: index,
				filename: item.filename,
			})),
		}),
	);
	files.forEach((item, index) =>
		form.append(
			`files[${index}]`,
			new globalThis.Blob([item.data]),
			item.filename,
		),
	);
	return await rest.request(
		'POST',
		`/channels/${channelId}/messages`,
		{},
		form,
	);
}

// Claude大小姐（claude-ojouchan，AstrBot 上的 Claude）：大肥鱼看图常看错，被笑了就带着图去问她。
// 她只回大肥鱼这一个 bot，所以不会互相回个没完；每小时最多问几次，省她的 Claude 额度。
const OJOUSAMA = {
	id: '1565256739425751070',
	channel: '1565277372129747048', // 「大小姐的小天地」
	perHour: 5,
	waitMs: 75_000,
};
const ojousamaAsks = [];
const sleep = (ms) =>
	new Promise((resolve) => globalThis.setTimeout(resolve, ms));
const oldestFirst = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);

// 发问之后等她回：找发问之后她发的讯息，她可能分几则说，等到没有新的再合起来。
async function waitForOjousama(rest, channelId, afterId) {
	const deadline = Date.now() + OJOUSAMA.waitMs;
	let seen = 0;
	let replies = [];
	while (Date.now() < deadline) {
		await sleep(3000);
		const messages = await rest.request(
			'GET',
			`/channels/${channelId}/messages?after=${afterId}&limit=20`,
		);
		replies = (messages ?? [])
			.filter((message) => message.author?.id === OJOUSAMA.id)
			.sort(oldestFirst);
		if (replies.length && replies.length === seen) break;
		seen = replies.length;
	}
	return replies.map((message) => message.content).filter(Boolean);
}

// 她自己的使用者 ID，查一次就记着（分辨「她自己的讯息」）。
async function selfId(rest) {
	rest.selfId ??= (await rest.request('GET', '/users/@me')).id;
	return rest.selfId;
}

const member = (row) => ({
	id: row.user?.id,
	name: row.user?.global_name || row.user?.username,
	username: row.user?.username,
	nick: row.nick ?? null,
	roles: row.roles,
	joined_at: row.joined_at,
	timed_out_until: row.communication_disabled_until ?? null,
	bot: Boolean(row.user?.bot),
});

// 列成员与搜寻成员要在 Developer Portal 打开 Server Members Intent，没开时 Discord 回 403。
const membersIntent = (error) => {
	throw /\b403\b|Missing Access/.test(String(error?.message))
		? new Error(
				'Discord 不让我列成员：要请站长在 Discord Developer Portal 的 Bot 页面打开 Server Members Intent。',
			)
		: error;
};

const CHANNEL_TYPES = {
	text: 0,
	voice: 2,
	category: 4,
	announcement: 5,
	stage: 13,
	forum: 15,
};

// 频道的额外设定：慢速模式、NSFW、语音人数上限、分类、排序、讨论串封存与锁定。
function channelSettings({
	slowmode_seconds,
	nsfw,
	user_limit,
	parent_id,
	position,
	archived,
	locked,
}) {
	return {
		...(slowmode_seconds !== undefined
			? { rate_limit_per_user: slowmode_seconds }
			: {}),
		...(nsfw !== undefined ? { nsfw } : {}),
		...(user_limit !== undefined ? { user_limit } : {}),
		...(parent_id !== undefined
			? { parent_id: parent_id === 'none' ? null : parent_id }
			: {}),
		...(position !== undefined ? { position } : {}),
		...(archived !== undefined ? { archived } : {}),
		...(locked !== undefined ? { locked } : {}),
	};
}

const channelExtras = {
	slowmode_seconds: integer(0, 21600),
	nsfw: { type: 'boolean' },
	user_limit: integer(0, 99),
	position: integer(0, 500),
};

const DEFINITIONS = [
	{
		name: 'discord_list_channels',
		guild: true,
		description:
			'列出这个 Discord 服务器的频道（id、名称、类型、分类、主题）。',
		parameters: object({}),
		run: async (rest, _args, { guildId }) =>
			(await rest.request('GET', `/guilds/${guildId}/channels`)).map(
				({ id, name, type, parent_id, topic }) => ({
					id,
					name,
					type,
					parent_id,
					topic,
				}),
			),
	},
	{
		name: 'discord_server_info',
		guild: true,
		description:
			'查这个服务器的资料：名称、群主（owner_id 与名字）、成员与在线人数、描述。',
		parameters: object({}),
		run: async (rest, _args, { guildId }) => {
			const guild = await rest.request(
				'GET',
				`/guilds/${guildId}?with_counts=true`,
			);
			const owner = await rest
				.request('GET', `/users/${guild.owner_id}`)
				.catch(() => undefined);
			return {
				id: guild.id,
				name: guild.name,
				owner_id: guild.owner_id,
				owner_name: owner?.global_name || owner?.username,
				members: guild.approximate_member_count,
				online: guild.approximate_presence_count,
				description: guild.description,
			};
		},
	},
	{
		name: 'discord_list_roles',
		guild: true,
		description: '列出服务器的身分组（id、名称、颜色、位置）。',
		parameters: object({}),
		run: async (rest, _args, { guildId }) =>
			(await rest.request('GET', `/guilds/${guildId}/roles`)).map(
				({ id, name, color, position }) => ({ id, name, color, position }),
			),
	},
	{
		name: 'discord_read_messages',
		description: '读某个频道最近的讯息（最多 50 则，新的在后面）。',
		parameters: object(
			{ channel_id: id, limit: { type: 'integer', minimum: 1, maximum: 50 } },
			['channel_id'],
		),
		run: async (rest, { channel_id, limit = 20 }) =>
			(
				await rest.request(
					'GET',
					`/channels/${channel_id}/messages?limit=${limit}`,
				)
			)
				.reverse()
				.map((message) => ({
					id: message.id,
					author: message.author?.global_name || message.author?.username,
					author_id: message.author?.id,
					content: String(message.content ?? '').slice(0, 500),
					time: message.timestamp,
				})),
	},
	{
		name: 'discord_send_message',
		description:
			'发讯息到指定频道。可以附图片或档案（files 给工作目录 /srv/dsh 底下的绝对路径，或 send_meme／meme_list 候选里的 path 原样，最多 4 个、每个 8 MB 内）；reply_to 给讯息 id 就是回覆那则（带引用）；sticker_ids 发服务器的贴图（discord_emojis 查得到）；poll 发投票。可以 <@使用者id> 提及人，不会 @everyone 或身分组。只是在目前这个群聊回话、又没有附件或这些功能时，直接说就好，不用这个工具。',
		parameters: object(
			{
				channel_id: id,
				content: { type: 'string', maxLength: 1900 },
				files: { type: 'array', items: file, maxItems: 4 },
				reply_to: id,
				sticker_ids: { type: 'array', items: id, maxItems: 3 },
				poll: object(
					{
						question: text(300),
						answers: {
							type: 'array',
							items: text(55),
							minItems: 2,
							maxItems: 10,
						},
						hours: integer(1, 768),
						multiple: { type: 'boolean' },
					},
					['question', 'answers'],
				),
			},
			['channel_id'],
		),
		run: async (
			rest,
			{ channel_id, content = '', files = [], reply_to, sticker_ids, poll },
			{ localize, attachment },
		) => {
			if (!content.trim() && !files.length && !sticker_ids?.length && !poll)
				throw new Error('没有文字也没有附件、贴图或投票。');
			const sent = await postMessage(
				rest,
				channel_id,
				{
					content: content.trim() ? await localize(content) : '',
					allowed_mentions: { parse: ['users'] },
					...(reply_to
						? {
								message_reference: {
									message_id: reply_to,
									fail_if_not_exists: false,
								},
							}
						: {}),
					...(sticker_ids?.length ? { sticker_ids } : {}),
					...(poll
						? {
								poll: {
									question: { text: await localize(poll.question) },
									answers: await Promise.all(
										poll.answers.map(async (answer) => ({
											poll_media: { text: await localize(answer) },
										})),
									),
									duration: poll.hours ?? 24,
									allow_multiselect: Boolean(poll.multiple),
									layout_type: 1,
								},
							}
						: {}),
				},
				files.map(attachment),
			);
			return { id: sent?.id, ...(files.length ? { files: files.length } : {}) };
		},
	},
	{
		name: 'discord_ask_ojousama',
		description:
			'带着图去问 Claude大小姐（她看图很准）。你看图看错、被群友笑、大家傻眼或说你看错的时候才用：image 给那张图在工作目录的路径（群友传的图路径写在讯息里），或图片／动图的网址（Tenor、GIPHY、KLIPY 连结也可以，动图会先拆成 6 格格子图再给她），question 写你想问的。不填 channel_id 就发到「大小姐的小天地」，也可以填现在这个频道；会 @ 她，等她回答（一分钟内）后把她的话交回给你。在别的频道问的，就回原本的频道更正；在同一个频道问的，大家都看到她的回答了，有反应就好，不用转述。工具失败时，那是工具的错误讯息，不是大小姐说的话。只问图片的事，不要每张图都去问；一小时最多 5 次。',
		parameters: object(
			{
				image: { type: 'string', minLength: 1, maxLength: 500 },
				question: text(300),
				channel_id: id,
			},
			['image', 'question'],
		),
		run: async (
			rest,
			{ image, question, channel_id },
			{ attachment, imageForOjousama },
		) => {
			// 没问到时说清楚：讯息没发出去、她什么都没收到，免得把错误讯息当成她的回答转述。
			const notAsked = (reason) =>
				new Error(
					`没有问到大小姐，讯息没发出去，她什么都没收到。原因：${reason}`,
				);
			const now = Date.now();
			while (ojousamaAsks.length && now - ojousamaAsks[0] > 3_600_000)
				ojousamaAsks.shift();
			if (ojousamaAsks.length >= OJOUSAMA.perHour)
				throw notAsked(
					'这一小时已经问过她 5 次了，晚点再去，先跟大家说你也不确定。',
				);
			const channelId = channel_id ?? OJOUSAMA.channel;
			let prepared, sent;
			try {
				prepared = await imageForOjousama(image);
				sent = await postMessage(
					rest,
					channelId,
					{
						content: `<@${OJOUSAMA.id}> ${question.trim()}${prepared.animated ? '（動圖，拆成 6 格，左到右、上到下是時間順序）' : ''}`,
						allowed_mentions: { users: [OJOUSAMA.id] },
					},
					[attachment(prepared.path)],
				);
			} catch (error) {
				throw notAsked(String(error?.message ?? error));
			}
			ojousamaAsks.push(now);
			const answer = await waitForOjousama(rest, channelId, sent.id);
			return answer.length
				? {
						from: 'Claude大小姐',
						answer: answer.join('\n'),
						asked_in: channelId,
					}
				: {
						answer: null,
						asked_in: channelId,
						note: '讯息有发出去，但大小姐一分多钟内没有回答（可能在忙或额度用完了）。她什么都没说，不要替她编答案。',
					};
		},
	},
	{
		name: 'discord_edit_message',
		description: '改你自己发过的一则讯息的文字（只能改你自己的）。',
		parameters: object(
			{ channel_id: id, message_id: id, content: text(1900) },
			['channel_id', 'message_id', 'content'],
		),
		run: async (rest, { channel_id, message_id, content }, { localize }) => {
			const message = await rest.request(
				'GET',
				`/channels/${channel_id}/messages/${message_id}`,
			);
			if (message.author?.id !== (await selfId(rest)))
				throw new Error('只能改我自己发的讯息。');
			await rest.request(
				'PATCH',
				`/channels/${channel_id}/messages/${message_id}`,
				{
					content: await localize(content),
					allowed_mentions: { parse: ['users'] },
				},
			);
			return { edited: message_id };
		},
	},
	{
		name: 'discord_pin_message',
		description: '把讯息置顶，或取消置顶（pin=false）。',
		parameters: object(
			{ channel_id: id, message_id: id, pin: { type: 'boolean' } },
			['channel_id', 'message_id'],
		),
		run: async (rest, { channel_id, message_id, pin = true }) => {
			const method = pin ? 'PUT' : 'DELETE';
			try {
				await rest.request(
					method,
					`/channels/${channel_id}/messages/pins/${message_id}`,
				);
			} catch (error) {
				// 新版置顶端点不通时退回旧的。
				if (!/\b(404|405)\b/.test(String(error?.message))) throw error;
				await rest.request(
					method,
					`/channels/${channel_id}/pins/${message_id}`,
				);
			}
			return { message_id, pinned: pin };
		},
	},
	{
		name: 'discord_add_reaction',
		description:
			'在某则讯息上加表情反应（emoji 直接给字元，或自订表情 name:id）。',
		parameters: object(
			{
				channel_id: id,
				message_id: id,
				emoji: { type: 'string', minLength: 1, maxLength: 80 },
			},
			['channel_id', 'message_id', 'emoji'],
		),
		run: async (rest, { channel_id, message_id, emoji }) => {
			await rest.request(
				'PUT',
				`/channels/${channel_id}/messages/${message_id}/reactions/${encodeURIComponent(emoji)}/@me`,
			);
			return { done: true };
		},
	},
	{
		name: 'discord_create_thread',
		description:
			'在频道开讨论串；给 message_id 就从那则讯息开。在论坛频道发帖也用这个：name 是标题，content 是内文（论坛帖一定要有内文）；一般频道给 content 就在新讨论串里先说这句。',
		parameters: object(
			{
				channel_id: id,
				name: { type: 'string', minLength: 1, maxLength: 100 },
				message_id: id,
				content: text(1900),
			},
			['channel_id', 'name'],
		),
		run: async (
			rest,
			{ channel_id, name, message_id, content },
			{ localize },
		) => {
			if (message_id) {
				const thread = await rest.request(
					'POST',
					`/channels/${channel_id}/messages/${message_id}/threads`,
					{ name },
				);
				return { id: thread.id, name: thread.name };
			}
			const body = content ? await localize(content) : undefined;
			const parent = body
				? await rest.request('GET', `/channels/${channel_id}`)
				: undefined;
			// 论坛（15）与媒体（16）频道的帖子要连同第一则讯息一起建立。
			if ([15, 16].includes(parent?.type)) {
				const post = await rest.request(
					'POST',
					`/channels/${channel_id}/threads`,
					{
						name,
						message: { content: body, allowed_mentions: { parse: ['users'] } },
					},
				);
				return { id: post.id, name: post.name, forum: true };
			}
			const thread = await rest.request(
				'POST',
				`/channels/${channel_id}/threads`,
				{
					name,
					type: 11,
				},
			);
			if (body)
				await postMessage(rest, thread.id, {
					content: body,
					allowed_mentions: { parse: ['users'] },
				});
			return { id: thread.id, name: thread.name };
		},
	},
	{
		name: 'discord_create_channel',
		guild: true,
		description:
			'在服务器开新频道：文字、语音、分类（category）、公告、论坛、舞台。可指定主题、放进哪个分类（parent_id）、排序位置、慢速模式秒数、NSFW、语音人数上限。',
		parameters: object(
			{
				name: { type: 'string', minLength: 1, maxLength: 100 },
				kind: { type: 'string', enum: Object.keys(CHANNEL_TYPES) },
				topic: { type: 'string', maxLength: 1024 },
				parent_id: id,
				...channelExtras,
			},
			['name'],
		),
		run: async (
			rest,
			{ name, kind = 'text', topic, parent_id, ...extras },
			{ guildId },
		) => {
			const channel = await rest.request(
				'POST',
				`/guilds/${guildId}/channels`,
				{
					name,
					type: CHANNEL_TYPES[kind] ?? 0,
					...(topic ? { topic } : {}),
					...(parent_id ? { parent_id } : {}),
					...channelSettings(extras),
				},
			);
			return { id: channel.id, name: channel.name, type: channel.type };
		},
	},
	{
		name: 'discord_edit_channel',
		description:
			'改频道（讨论串、论坛帖也是频道）：名称、主题、移进别的分类（parent_id，给 "none" 就移出分类）、排序位置、慢速模式秒数、NSFW、语音人数上限；讨论串可以封存（archived）或锁定（locked）。',
		parameters: object(
			{
				channel_id: id,
				name: { type: 'string', minLength: 1, maxLength: 100 },
				topic: { type: 'string', maxLength: 1024 },
				parent_id: { type: 'string', pattern: '^(?:\\d{5,25}|none)$' },
				...channelExtras,
				archived: { type: 'boolean' },
				locked: { type: 'boolean' },
			},
			['channel_id'],
		),
		run: async (rest, { channel_id, name, topic, ...extras }) => {
			const channel = await rest.request('PATCH', `/channels/${channel_id}`, {
				...(name ? { name } : {}),
				...(topic !== undefined ? { topic } : {}),
				...channelSettings(extras),
			});
			return {
				id: channel.id,
				name: channel.name,
				topic: channel.topic,
				parent_id: channel.parent_id,
			};
		},
	},
	{
		name: 'discord_delete_channel',
		owner: true,
		description: '删除频道（只有站长或这个服务器的群主叫你才做得了）。',
		parameters: object({ channel_id: id }, ['channel_id']),
		run: async (rest, { channel_id }) => {
			await rest.request('DELETE', `/channels/${channel_id}`);
			return { deleted: channel_id };
		},
	},
	{
		name: 'discord_delete_message',
		description:
			'删除一则讯息。你自己发的谁叫你删都可以；别人的讯息只有站长或这个服务器的群主叫你才删得了。',
		parameters: object({ channel_id: id, message_id: id }, [
			'channel_id',
			'message_id',
		]),
		run: async (rest, { channel_id, message_id }, { requireOwner }) => {
			const message = await rest.request(
				'GET',
				`/channels/${channel_id}/messages/${message_id}`,
			);
			if (message.author?.id !== (await selfId(rest))) await requireOwner();
			await rest.request(
				'DELETE',
				`/channels/${channel_id}/messages/${message_id}`,
			);
			return { deleted: message_id };
		},
	},
	{
		name: 'discord_bulk_delete',
		owner: true,
		description:
			'一次删掉频道里最近的 count 则讯息（2～100 则，14 天内的），或指定的 message_ids（只有站长或这个服务器的群主叫你才做得了）。',
		parameters: object(
			{
				channel_id: id,
				count: integer(2, 100),
				message_ids: { type: 'array', items: id, minItems: 1, maxItems: 100 },
			},
			['channel_id'],
		),
		run: async (rest, { channel_id, count, message_ids }) => {
			let ids = message_ids;
			if (!ids?.length) {
				if (!count) throw new Error('要给 count 或 message_ids。');
				const fresh = Date.now() - 14 * 86400000 + 60000;
				ids = (
					await rest.request(
						'GET',
						`/channels/${channel_id}/messages?limit=${count}`,
					)
				)
					.filter((row) => Date.parse(row.timestamp) > fresh)
					.map((row) => row.id);
			}
			if (!ids.length) throw new Error('没有 14 天内的讯息可以删。');
			if (ids.length === 1)
				await rest.request(
					'DELETE',
					`/channels/${channel_id}/messages/${ids[0]}`,
				);
			else
				await rest.request(
					'POST',
					`/channels/${channel_id}/messages/bulk-delete`,
					{ messages: ids },
				);
			return { deleted: ids.length };
		},
	},
	{
		name: 'discord_kick_member',
		guild: true,
		owner: true,
		description: '把成员踢出服务器（只有站长或这个服务器的群主叫你才做得了）。',
		parameters: object({ user_id: id }, ['user_id']),
		run: async (rest, { user_id }, { guildId }) => {
			await rest.request('DELETE', `/guilds/${guildId}/members/${user_id}`);
			return { kicked: user_id };
		},
	},
	{
		name: 'discord_ban_member',
		guild: true,
		owner: true,
		description:
			'封锁成员，可顺便删掉他最近几秒内的讯息（只有站长或这个服务器的群主叫你才做得了）。',
		parameters: object(
			{
				user_id: id,
				delete_message_seconds: {
					type: 'integer',
					minimum: 0,
					maximum: 604800,
				},
			},
			['user_id'],
		),
		run: async (rest, { user_id, delete_message_seconds = 0 }, { guildId }) => {
			await rest.request('PUT', `/guilds/${guildId}/bans/${user_id}`, {
				delete_message_seconds,
			});
			return { banned: user_id };
		},
	},
	{
		name: 'discord_set_member_roles',
		guild: true,
		owner: true,
		description:
			'给成员加上或拿掉身分组（只有站长或这个服务器的群主叫你才做得了）。',
		parameters: object(
			{
				user_id: id,
				add: { type: 'array', items: id, maxItems: 10 },
				remove: { type: 'array', items: id, maxItems: 10 },
			},
			['user_id'],
		),
		run: async (rest, { user_id, add = [], remove = [] }, { guildId }) => {
			for (const role of add)
				await rest.request(
					'PUT',
					`/guilds/${guildId}/members/${user_id}/roles/${role}`,
				);
			for (const role of remove)
				await rest.request(
					'DELETE',
					`/guilds/${guildId}/members/${user_id}/roles/${role}`,
				);
			return { user_id, added: add, removed: remove };
		},
	},
	{
		name: 'discord_set_channel_permissions',
		owner: true,
		description:
			'设定频道对某个身分组或成员的权限覆写；allow／deny 是 Discord 权限位元的十进位字串（只有站长或这个服务器的群主叫你才做得了）。',
		parameters: object(
			{
				channel_id: id,
				target_id: id,
				target: { type: 'string', enum: ['role', 'member'] },
				allow: { type: 'string', pattern: '^\\d{1,20}$' },
				deny: { type: 'string', pattern: '^\\d{1,20}$' },
			},
			['channel_id', 'target_id', 'target'],
		),
		run: async (
			rest,
			{ channel_id, target_id, target, allow = '0', deny = '0' },
		) => {
			await rest.request(
				'PUT',
				`/channels/${channel_id}/permissions/${target_id}`,
				{ type: target === 'member' ? 1 : 0, allow, deny },
			);
			return { channel_id, target_id, allow, deny };
		},
	},
	{
		name: 'discord_edit_server',
		guild: true,
		owner: true,
		description:
			'改服务器名称、描述、头像（icon）或横幅（banner）。icon／banner 给图片路径（工作目录里的档案，群友传的图在 .discord-uploads）；横幅要服务器加成到 2 级才有（只有站长或这个服务器的群主叫你才做得了）。',
		parameters: object({
			name: { type: 'string', minLength: 2, maxLength: 100 },
			description: { type: 'string', maxLength: 300 },
			icon: file,
			banner: file,
		}),
		run: async (
			rest,
			{ name, description, icon, banner },
			{ guildId, attachment },
		) => {
			const guild = await rest.request('PATCH', `/guilds/${guildId}`, {
				...(name ? { name } : {}),
				...(description !== undefined ? { description } : {}),
				...(icon ? { icon: dataUri(attachment(icon)) } : {}),
				...(banner ? { banner: dataUri(attachment(banner)) } : {}),
			});
			return {
				name: guild.name,
				description: guild.description,
				icon: Boolean(guild.icon),
				banner: Boolean(guild.banner),
			};
		},
	},
	{
		name: 'discord_member_info',
		guild: true,
		description:
			'查成员：action=info 看某人的资料（昵称、身分组、加入时间、是否被禁言）；search 用名字开头找人（拿到 ID）；list 列出成员（最多 100 个）。',
		parameters: object(
			{
				action: { type: 'string', enum: ['info', 'search', 'list'] },
				user_id: id,
				query: text(32),
				limit: integer(1, 100),
			},
			['action'],
		),
		run: async (rest, { action, user_id, query, limit = 25 }, { guildId }) => {
			if (action === 'info') {
				if (!user_id) throw new Error('要给 user_id。');
				return member(
					await rest.request('GET', `/guilds/${guildId}/members/${user_id}`),
				);
			}
			if (action === 'search' && !query) throw new Error('要给 query。');
			const path =
				action === 'search'
					? `/guilds/${guildId}/members/search?query=${encodeURIComponent(query)}&limit=${limit}`
					: `/guilds/${guildId}/members?limit=${limit}`;
			return (await rest.request('GET', path).catch(membersIntent)).map(member);
		},
	},
	{
		name: 'discord_edit_member',
		guild: true,
		owner: true,
		description:
			'管成员：改昵称（nick，给空字串就清掉）、禁言 timeout_minutes 分钟（最多 40320＝28 天，0＝解除）、语音里静音（mute）或拒听（deaf）、把他移到别的语音频道（voice_channel_id）或踢出语音（disconnect）。只有站长或这个服务器的群主叫你才做得了。',
		parameters: object(
			{
				user_id: id,
				nick: { type: 'string', maxLength: 32 },
				timeout_minutes: integer(0, 40320),
				mute: { type: 'boolean' },
				deaf: { type: 'boolean' },
				voice_channel_id: id,
				disconnect: { type: 'boolean' },
			},
			['user_id'],
		),
		run: async (
			rest,
			{
				user_id,
				nick,
				timeout_minutes,
				mute,
				deaf,
				voice_channel_id,
				disconnect,
			},
			{ guildId },
		) => {
			const body = {
				...(nick !== undefined ? { nick } : {}),
				...(timeout_minutes !== undefined
					? {
							communication_disabled_until: timeout_minutes
								? new Date(Date.now() + timeout_minutes * 60000).toISOString()
								: null,
						}
					: {}),
				...(mute !== undefined ? { mute } : {}),
				...(deaf !== undefined ? { deaf } : {}),
				...(voice_channel_id ? { channel_id: voice_channel_id } : {}),
				...(disconnect ? { channel_id: null } : {}),
			};
			if (!Object.keys(body).length) throw new Error('没有要改的项目。');
			return member(
				await rest.request(
					'PATCH',
					`/guilds/${guildId}/members/${user_id}`,
					body,
				),
			);
		},
	},
	{
		name: 'discord_bans',
		guild: true,
		owner: true,
		description:
			'封锁名单：action=list 列出被封的人，unban 解封某人（只有站长或这个服务器的群主叫你才做得了）。',
		parameters: object(
			{ action: { type: 'string', enum: ['list', 'unban'] }, user_id: id },
			['action'],
		),
		run: async (rest, { action, user_id }, { guildId }) => {
			if (action === 'unban') {
				if (!user_id) throw new Error('要给 user_id。');
				await rest.request('DELETE', `/guilds/${guildId}/bans/${user_id}`);
				return { unbanned: user_id };
			}
			return (
				await rest.request('GET', `/guilds/${guildId}/bans?limit=100`)
			).map((row) => ({
				id: row.user?.id,
				name: row.user?.global_name || row.user?.username,
				reason: row.reason,
			}));
		},
	},
	{
		name: 'discord_manage_role',
		guild: true,
		owner: true,
		description:
			'建立、修改或删除身分组：名称、颜色（#RRGGBB）、权限（Discord 权限位元的十进位字串）、是否分开显示（hoist）、能不能被 @（mentionable）。只有站长或这个服务器的群主叫你才做得了。',
		parameters: object(
			{
				action: { type: 'string', enum: ['create', 'edit', 'delete'] },
				role_id: id,
				name: text(100),
				color: { type: 'string', pattern: '^#?[0-9a-fA-F]{6}$' },
				permissions: { type: 'string', pattern: '^\\d{1,20}$' },
				hoist: { type: 'boolean' },
				mentionable: { type: 'boolean' },
			},
			['action'],
		),
		run: async (rest, { action, role_id, color, ...fields }, { guildId }) => {
			if (action !== 'create' && !role_id) throw new Error('要给 role_id。');
			if (action === 'delete') {
				await rest.request('DELETE', `/guilds/${guildId}/roles/${role_id}`);
				return { deleted: role_id };
			}
			const body = {
				...fields,
				...(color ? { color: parseInt(color.replace('#', ''), 16) } : {}),
			};
			const role =
				action === 'create'
					? await rest.request('POST', `/guilds/${guildId}/roles`, body)
					: await rest.request(
							'PATCH',
							`/guilds/${guildId}/roles/${role_id}`,
							body,
						);
			return { id: role.id, name: role.name, color: role.color };
		},
	},
	{
		name: 'discord_emojis',
		guild: true,
		description:
			'服务器的自订表情与贴图。action=list 列出（谁都能叫；表情在讯息里写 <:名字:id>，动态的 <a:名字:id>；贴图用 discord_send_message 的 sticker_ids）。create_emoji／delete_emoji／create_sticker／delete_sticker 要站长或这个服务器的群主叫你才做：表情图 256 KB 内（png、jpg、gif、webp），贴图 512 KB 内（png、apng、gif），file 给工作目录里的图；贴图的 tags 填一个相关的 emoji 名称。',
		parameters: object(
			{
				action: {
					type: 'string',
					enum: [
						'list',
						'create_emoji',
						'delete_emoji',
						'create_sticker',
						'delete_sticker',
					],
				},
				name: { type: 'string', pattern: '^[\\w]{2,32}$' },
				file,
				emoji_id: id,
				sticker_id: id,
				tags: text(200),
				description: { type: 'string', maxLength: 100 },
			},
			['action'],
		),
		run: async (
			rest,
			{ action, name, file: path, emoji_id, sticker_id, tags, description },
			{ guildId, attachment, requireOwner },
		) => {
			if (action === 'list') {
				const [emojis, stickers] = await Promise.all([
					rest.request('GET', `/guilds/${guildId}/emojis`),
					rest.request('GET', `/guilds/${guildId}/stickers`),
				]);
				return {
					emojis: emojis.map((row) => ({
						id: row.id,
						name: row.name,
						animated: Boolean(row.animated),
					})),
					stickers: stickers.map((row) => ({
						id: row.id,
						name: row.name,
						tags: row.tags,
					})),
				};
			}
			await requireOwner();
			if (action === 'delete_emoji' || action === 'delete_sticker') {
				const target = action === 'delete_emoji' ? emoji_id : sticker_id;
				if (!target) throw new Error('要给要删的 id。');
				await rest.request(
					'DELETE',
					`/guilds/${guildId}/${action === 'delete_emoji' ? 'emojis' : 'stickers'}/${target}`,
				);
				return { deleted: target };
			}
			if (!name || !path) throw new Error('要给 name 和 file。');
			const image = attachment(path);
			if (action === 'create_emoji') {
				const emoji = await rest.request('POST', `/guilds/${guildId}/emojis`, {
					name,
					image: dataUri(image, 256 * 1024),
				});
				return { id: emoji.id, name: emoji.name };
			}
			if (!/\.(png|apng|gif)$/i.test(image.filename))
				throw new Error('贴图只收 png、apng、gif：' + image.filename);
			if (image.data.length > 512 * 1024)
				throw new Error('贴图超过 512 KB：' + image.filename);
			const form = new globalThis.FormData();
			form.append('name', name);
			form.append('description', description ?? '');
			form.append('tags', tags || name);
			form.append('file', new globalThis.Blob([image.data]), image.filename);
			const sticker = await rest.request(
				'POST',
				`/guilds/${guildId}/stickers`,
				{},
				form,
			);
			return { id: sticker.id, name: sticker.name };
		},
	},
	{
		name: 'discord_invites',
		guild: true,
		owner: true,
		description:
			'邀请链接：action=create 在某频道开一个（max_age_hours 0＝永久，max_uses 0＝不限次数），list 列出现有的，delete 删掉某个邀请码（只有站长或这个服务器的群主叫你才做得了）。',
		parameters: object(
			{
				action: { type: 'string', enum: ['create', 'list', 'delete'] },
				channel_id: id,
				max_age_hours: integer(0, 168),
				max_uses: integer(0, 100),
				code: { type: 'string', pattern: '^[\\w-]{2,32}$' },
			},
			['action'],
		),
		run: async (
			rest,
			{ action, channel_id, max_age_hours = 24, max_uses = 0, code },
			{ guildId },
		) => {
			if (action === 'list')
				return (await rest.request('GET', `/guilds/${guildId}/invites`)).map(
					(row) => ({
						code: row.code,
						url: 'https://discord.gg/' + row.code,
						channel: row.channel?.name,
						uses: row.uses,
						max_uses: row.max_uses,
						by: row.inviter?.global_name || row.inviter?.username,
					}),
				);
			if (action === 'delete') {
				if (!code) throw new Error('要给 code。');
				await rest.request('DELETE', `/invites/${code}`);
				return { deleted: code };
			}
			if (!channel_id) throw new Error('要给 channel_id。');
			const invite = await rest.request(
				'POST',
				`/channels/${channel_id}/invites`,
				{
					max_age: max_age_hours * 3600,
					max_uses,
					unique: true,
				},
			);
			return { code: invite.code, url: 'https://discord.gg/' + invite.code };
		},
	},
	{
		name: 'discord_dm',
		owner: true,
		description:
			'私讯某个人（可附档案，规则同 discord_send_message）。只有站长或群主叫你才做；对方关掉私讯就送不到。',
		parameters: object(
			{
				user_id: id,
				content: { type: 'string', maxLength: 1900 },
				files: { type: 'array', items: file, maxItems: 4 },
			},
			['user_id'],
		),
		run: async (
			rest,
			{ user_id, content = '', files = [] },
			{ localize, attachment },
		) => {
			if (!content.trim() && !files.length)
				throw new Error('没有文字也没有附件。');
			const channel = await rest.request('POST', '/users/@me/channels', {
				recipient_id: user_id,
			});
			const sent = await postMessage(
				rest,
				channel.id,
				{
					content: content.trim() ? await localize(content) : '',
					allowed_mentions: { parse: [] },
				},
				files.map(attachment),
			);
			return { id: sent?.id, to: user_id };
		},
	},
	{
		name: 'discord_events',
		guild: true,
		description:
			'服务器的排程活动：action=list 列出，create 建立（name、start 与 end 用 ISO 时间如 2026-11-01T20:00:00+08:00；在语音或舞台频道办就给 channel_id，否则给 location 地点且一定要有 end），delete 删掉（要站长或这个服务器的群主叫你）。',
		parameters: object(
			{
				action: { type: 'string', enum: ['list', 'create', 'delete'] },
				event_id: id,
				name: text(100),
				description: { type: 'string', maxLength: 1000 },
				start: text(40),
				end: text(40),
				location: text(100),
				channel_id: id,
			},
			['action'],
		),
		run: async (rest, args, { guildId, localize, requireOwner }) => {
			const { action, event_id, name, description, start, end, location } =
				args;
			if (action === 'list')
				return (
					await rest.request('GET', `/guilds/${guildId}/scheduled-events`)
				).map((row) => ({
					id: row.id,
					name: row.name,
					start: row.scheduled_start_time,
					end: row.scheduled_end_time,
					location: row.entity_metadata?.location,
					channel_id: row.channel_id,
				}));
			if (action === 'delete') {
				if (!event_id) throw new Error('要给 event_id。');
				await requireOwner(null);
				await rest.request(
					'DELETE',
					`/guilds/${guildId}/scheduled-events/${event_id}`,
				);
				return { deleted: event_id };
			}
			const time = (value) => {
				const at = Date.parse(value ?? '');
				if (!Number.isFinite(at)) throw new Error('时间看不懂：' + value);
				return new Date(at).toISOString();
			};
			if (!name || !start) throw new Error('要给 name 和 start。');
			const channel = args.channel_id
				? await rest.request('GET', `/channels/${args.channel_id}`)
				: undefined;
			if (!channel && (!location || !end))
				throw new Error('不在语音频道办的活动要给 location 和 end。');
			const event = await rest.request(
				'POST',
				`/guilds/${guildId}/scheduled-events`,
				{
					name: await localize(name),
					privacy_level: 2,
					scheduled_start_time: time(start),
					...(end ? { scheduled_end_time: time(end) } : {}),
					...(description ? { description: await localize(description) } : {}),
					...(channel
						? {
								entity_type: channel.type === 13 ? 1 : 2,
								channel_id: channel.id,
							}
						: {
								entity_type: 3,
								entity_metadata: { location: await localize(location) },
							}),
				},
			);
			return {
				id: event.id,
				name: event.name,
				start: event.scheduled_start_time,
			};
		},
	},
	{
		name: 'discord_audit_log',
		guild: true,
		owner: true,
		description:
			'看服务器的稽核日志（谁做了什么管理操作），可以只看某人（user_id）或某类操作（action_type，Discord 的数字代码）。只有站长或这个服务器的群主叫你才做得了。',
		parameters: object({
			limit: integer(1, 50),
			user_id: id,
			action_type: integer(1, 200),
		}),
		run: async (rest, { limit = 20, user_id, action_type }, { guildId }) => {
			const query = new globalThis.URLSearchParams({ limit: String(limit) });
			if (user_id) query.set('user_id', user_id);
			if (action_type) query.set('action_type', String(action_type));
			const log = await rest.request(
				'GET',
				`/guilds/${guildId}/audit-logs?${query}`,
			);
			const names = new Map(
				(log.users ?? []).map((user) => [
					user.id,
					user.global_name || user.username,
				]),
			);
			return (log.audit_log_entries ?? []).map((row) => ({
				action_type: row.action_type,
				by: names.get(row.user_id) ?? row.user_id,
				target_id: row.target_id,
				reason: row.reason,
				changes: (row.changes ?? [])
					.slice(0, 5)
					.map((change) => change.key)
					.join(','),
			}));
		},
	},
	{
		name: 'discord_edit_me',
		description:
			'改你自己：这个服务器里的昵称（nick，谁叫都可以，空字串＝清掉）；头像（avatar，给图片路径）、使用者名称（username，一小时最多改两次）、状态（status：online／idle／dnd／invisible）与自订状态文字（activity）只有站长叫你才改。',
		parameters: object({
			nick: { type: 'string', maxLength: 32 },
			avatar: file,
			username: { type: 'string', minLength: 2, maxLength: 32 },
			status: { type: 'string', enum: ['online', 'idle', 'dnd', 'invisible'] },
			activity: { type: 'string', maxLength: 128 },
		}),
		run: async (
			rest,
			{ nick, avatar, username, status, activity },
			{ guildId, attachment, requireSiteOwner, setPresence, localize },
		) => {
			const done = {};
			if (avatar || username || status || activity !== undefined)
				requireSiteOwner();
			if (nick !== undefined) {
				if (!guildId) throw new Error('不知道是哪个服务器。');
				await rest.request('PATCH', `/guilds/${guildId}/members/@me`, {
					nick: nick ? await localize(nick) : null,
				});
				done.nick = nick || null;
			}
			if (avatar || username) {
				const me = await rest.request('PATCH', '/users/@me', {
					...(avatar ? { avatar: dataUri(attachment(avatar)) } : {}),
					...(username ? { username } : {}),
				});
				done.username = me.username;
				if (avatar) done.avatar = true;
			}
			if (status || activity !== undefined) {
				done.presence = setPresence({
					status,
					activity: activity ? await localize(activity) : activity,
				});
			}
			if (!Object.keys(done).length) throw new Error('没有要改的项目。');
			return done;
		},
	},
];

export const OWNER_ONLY_TOOLS = DEFINITIONS.filter((tool) => tool.owner).map(
	(tool) => tool.name,
);

// 状态走闸道（op 3）。存进档案，重启后桥接重新登入（identify）时一起带上。
export function presenceFile(runtime) {
	return join(runtime.root, 'presence.json');
}

export function savedPresence(runtime) {
	if (runtime.presence === undefined) {
		try {
			runtime.presence = JSON.parse(
				readFileSync(presenceFile(runtime), 'utf8'),
			);
		} catch {
			runtime.presence = null;
		}
	}
	return runtime.presence ?? undefined;
}

function setPresence(runtime, { status, activity }) {
	const current = savedPresence(runtime) ?? {
		since: null,
		activities: [],
		status: 'online',
		afk: false,
	};
	const next = {
		...current,
		...(status ? { status } : {}),
		...(activity !== undefined
			? {
					activities: activity
						? [{ name: 'Custom Status', type: 4, state: activity }]
						: [],
				}
			: {}),
	};
	const gateway = runtime.gateway;
	if (gateway?.ws?.readyState !== 1)
		throw new Error('Discord 连线还没好，等一下再试。');
	gateway.send(gateway.ws, { op: 3, d: next });
	runtime.presence = next;
	writeFileSync(presenceFile(runtime), JSON.stringify(next), { mode: 0o600 });
	return { status: next.status, activity: next.activities[0]?.state ?? null };
}

export function discordTools(runtime, localize, redact = (text) => text) {
	// 工作目录，加上表情插件的资料夹（meme_render 做好的梗图在 renders/）
	// 与 dsh-meme 的图库（「我的收藏」等在 meme-packs，内建图库在插件包里）。
	const dshHome = dirname(runtime.root);
	const memeRoots = [
		join(dshHome, 'meme-packs'),
		join(dshHome, 'profiles', 'web', 'node_modules', 'dsh-meme', 'memes'),
	];
	const read = attachmentReader(
		[
			dirname(runtime.groupRoot),
			join(dshHome, 'nekowhale-stickers'),
			...memeRoots,
		],
		redact,
	);
	const attachment = (path) =>
		read(isAbsolute(String(path)) ? path : memePath(memeRoots, path));
	const gifs = gifToolkit(runtime);
	return DEFINITIONS.map((definition) => ({
		name: definition.name,
		description: definition.description,
		parameters: definition.parameters,
		output: {
			schema: object({ ok: { type: 'boolean' }, message: { type: 'string' } }, [
				'ok',
			]),
			render: (_args, result) => [
				{
					type: 'text',
					text: result.ok ? result.message : '没有做成：' + result.message,
				},
			],
		},
		execute: async (args, exec) => {
			const source = runtime.sourceForTurn(exec.agent);
			const log = (ok, message) => {
				try {
					appendFileSync(
						join(runtime.root, 'discord-actions.jsonl'),
						JSON.stringify({
							at: new Date().toISOString(),
							tool: definition.name,
							by: source?.authorId ?? null,
							owner: Boolean(source?.owner),
							args,
							ok,
							message: message.slice(0, 300),
						}) + '\n',
						{ mode: 0o600 },
					);
				} catch {
					/* 记录写不进去不影响操作本身。 */
				}
			};
			if (!runtime.discordRest)
				return { ok: false, message: 'Discord 还没连上，等一下再试。' };
			// 群主可以管理自己的服务器：他本来就有这些权限，只是改叫她做；目标频道必须在他的服务器里。
			const ownerAllowed = async (channelId) => {
				if (source?.owner) return true;
				try {
					return (
						Boolean(source?.guildId) &&
						(await runtime.guildOwner(source.guildId)) === source.authorId &&
						(!channelId ||
							(
								await runtime.discordRest.request(
									'GET',
									`/channels/${channelId}`,
								)
							)?.guild_id === source.guildId)
					);
				} catch {
					return false;
				}
			};
			if (definition.owner && !(await ownerAllowed(args.channel_id))) {
				log(false, OWNER_DENIED);
				return { ok: false, message: OWNER_DENIED };
			}
			const guildId = source?.guildId || runtime.lastGuildId;
			if (definition.guild && !guildId)
				return { ok: false, message: '不知道是哪个服务器。' };
			try {
				const data = await definition.run(runtime.discordRest, args, {
					guildId,
					localize,
					attachment,
					// 同一个工具里有些动作谁都能叫、有些要站长或群主（删别人的讯息、建表情……）。
					requireOwner: async (channelId = args.channel_id) => {
						if (!(await ownerAllowed(channelId))) throw new Error(OWNER_DENIED);
					},
					// 她自己的头像、名字、状态只认站长，群主也不行。
					requireSiteOwner: () => {
						if (!source?.owner) throw new Error('这个只有站长叫我才能改。');
					},
					setPresence: (change) => setPresence(runtime, change),
					// 给大小姐的图：网址先下载、动图拆成格子图（贴在这个频道的分享连结用 Discord 附好的预览）。
					imageForOjousama: (image) =>
						gifs.imageForOjousama(image, source?.channelId),
				});
				const message = JSON.stringify(data).slice(0, 6000);
				log(true, message);
				return { ok: true, message };
			} catch (error) {
				const message = String(error?.message ?? error)
					.replace(/^discord REST /, '')
					.slice(0, 500);
				log(false, message);
				return { ok: false, message };
			}
		},
	}));
}
