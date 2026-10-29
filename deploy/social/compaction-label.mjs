// 压缩出来的摘要前面贴一张标签：这是摘要不是原话、涵盖哪个频道哪段时间，要核对就用 chat_search
// 按时间翻原文帐本。做法照 dsh-agent-soul 的 dsh-agent-compaction（继承内建压缩、只在摘要前面加一块），
// 但指针换成她用得上的：时间范围，而不是她打不开的会话纪录 seq。
const HEADER =
	/（(?:(#[^｜，）\n]+)(?:｜[^，）\n]*)?，)?群聊新訊息，(\d{4})\/(\d{1,2})\/(\d{1,2})/g;
const LINE = /^(\d{2}):(\d{2}) /gm;

const pad = (value) => String(value).padStart(2, '0');

export function summaryLabel(messages = []) {
	const channels = new Set();
	let first, last;
	for (const message of messages) {
		const text = (Array.isArray(message?.content) ? message.content : [])
			.filter((block) => block?.type === 'text')
			.map((block) => block.text ?? '')
			.join('\n');
		// 依序走过标题与时间行：时间行用它前面最近一个标题的日期。
		const marks = [
			...[...text.matchAll(HEADER)].map((match) => ({
				index: match.index,
				header: match,
			})),
			...[...text.matchAll(LINE)].map((match) => ({
				index: match.index,
				line: match,
			})),
		].sort((a, b) => a.index - b.index);
		let day;
		for (const mark of marks) {
			if (mark.header) {
				const [, channel, year, month, date] = mark.header;
				if (channel) channels.add(channel);
				day = `${year}/${pad(month)}/${pad(date)}`;
			} else if (day) {
				const stamp = `${day} ${mark.line[1]}:${mark.line[2]}`;
				first ??= stamp;
				last = stamp;
			}
		}
	}
	const range = first
		? `：涵蓋${channels.size ? ' ' + [...channels].slice(0, 3).join('、') : ''} ${first} – ${last}`
		: '';
	return `> 以下是較早對話的摘要（不是原話）${range}。要核對原話，用 chat_search 查這段時間（since／until 填日期）。`;
}

// 给内建压缩引擎加标签：只覆盖 summarize，先让它照常做完，再在摘要最前面加一块；
// 加不上就原样返回，绝不让压缩本身失败。不用 #private 栏位（插件实例会被包成 Proxy）。
export function withSummaryLabel(Base) {
	return class WhaleCompaction extends Base {
		async summarize(input, agent, signal) {
			const result = await super.summarize(input, agent, signal);
			if (!Array.isArray(result?.summary) || !result.summary.length)
				return result;
			try {
				return {
					...result,
					summary: [
						{ type: 'text', text: summaryLabel(input?.messages) },
						...result.summary,
					],
				};
			} catch {
				return result;
			}
		}
	};
}
