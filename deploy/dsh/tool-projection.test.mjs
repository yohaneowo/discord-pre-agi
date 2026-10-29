// 在 VM 上验证真实宿主的纯投影函数，不读凭证、不连接模型或 Discord。
import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
const entry = process.env.DSH_LLM_ENTRY;
const { projectToolUpdates } = entry
	? await import(pathToFileURL(entry).href)
	: {};
const tool = (name, deferred = false) => ({
	name,
	description: '测试工具',
	parameters: { type: 'object', properties: {} },
	...(deferred ? { deferLoading: true } : {}),
});
const legacy = tool('legacy_system_tool'),
	memory = tool('remember');
const change = {
	id: 'update',
	role: 'developer',
	content: [
		{ type: 'tool-addition', toolName: 'remember' },
		{ type: 'tool-removal', toolName: 'legacy_system_tool' },
	],
};
const history = {
	tools: [legacy],
	updates: [{ messageId: 'update', additions: [memory] }],
};

test(
	'移除所有旧工具后，当前记忆工具立即声明，且不恢复系统工具',
	{ skip: !entry },
	() => {
		const result = projectToolUpdates(
			[change],
			[memory],
			'addition-only',
			history,
		);
		assert.deepEqual(result.tools, [memory]);
		assert.deepEqual(result.messages, []);
	},
);
test('仍有立即声明工具时保留原有延迟加载语义', { skip: !entry }, () => {
	const result = projectToolUpdates(
		[change],
		[legacy, memory],
		'addition-only',
		history,
	);
	assert.equal(
		result.tools.find((t) => t.name === 'remember').deferLoading,
		true,
	);
	assert.ok(result.messages[0].content.some((b) => b.type === 'tool-addition'));
});
test('明确要求全延迟的工具不擅自提升权限', { skip: !entry }, () => {
	const deferred = tool('remember', true);
	const result = projectToolUpdates([change], [deferred], 'addition-only', {
		...history,
		updates: [{ messageId: 'update', additions: [deferred] }],
	});
	assert.equal(result.tools[0].deferLoading, true);
});
