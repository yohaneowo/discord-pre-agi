// 一次性真实模型验证：独立会话、无 Discord 发送、只保存结果状态。
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import { createUserMessage } from '/opt/dsh/app/node_modules/@deepseek-ai/dsh-llm/lib/index.js';
import { currentRuntime } from '/var/lib/dsh/.dsh/profiles/web/node_modules/dsh-social-runtime/index.mjs';

export const name = 'model-migration-probe';
export const inject = ['agents', 'sessions', 'agentPresets', 'llm'];
const resultPath =
	'/var/lib/dsh/.dsh/social-runtime/model-migration-probe.json';
export function apply(ctx) {
	if (existsSync(resultPath)) return;
	ctx.effect(() => {
		let handle;
		let disposed = false;
		const save = (value) =>
			writeFileSync(resultPath, JSON.stringify(value), { mode: 0o600 });
		void (async () => {
			await delay(1500);
			if (disposed) return;
			const runtime = currentRuntime();
			const cwd = join(runtime.groupRoot, '.verification');
			mkdirSync(cwd, { recursive: true });
			const config = {
				provider: 'deepseek-account',
				model: 'deepseek-flash',
				maxTokens: 64,
				reasoningEffort: 'off',
			};
			handle = await ctx.agents.create({
				sessionId: 'session-' + randomUUID(),
				meta: { cwd, agentPreset: 'whale-social' },
				agentOptions: config,
				setup: async (agentCtx) => {
					await ctx.get('agentPresets').mount(agentCtx, 'whale-social');
				},
			});
			const agent = handle.agent;
			runtime.mount(agent);
			agent.session.append('request/header', {
				header: {
					config,
					tools: [
						{
							name: 'legacy_test_tool',
							description: '仅用于迁移验证的旧工具，无执行程序',
							parameters: { type: 'object', properties: {} },
						},
					],
				},
				reason: 'initial',
			});
			agent.followup(
				createUserMessage({
					content: [
						{
							type: 'text',
							text: '这是一次维护连线验证。请只回复 OK，不使用工具，不记忆这项验证。',
						},
					],
					source: { kind: 'maintenance-probe' },
				}),
			);
			let timer;
			const timeout = new Promise((_, reject) => {
				timer = setTimeout(() => {
					agent.cancel({ kind: 'user' });
					reject(new Error('模型验证逾时'));
				}, 60000);
			});
			try {
				await Promise.race([agent.whenIdle(), timeout]);
			} finally {
				clearTimeout(timer);
			}
			await ctx.get('sessions').flush(agent.session);
			const events = agent.session.snapshotEvents();
			const end = [...events].reverse().find((e) => e.type === 'turn/end');
			const assistant = events.filter((e) => e.type === 'assistant/message');
			save({
				ok: end?.data.reason.kind === 'completed' && assistant.length > 0,
				reason: end?.data.reason.kind,
				errorCode: end?.data.reason.error?.code,
				sessionId: agent.id,
				migrated: events.filter((e) => e.type === 'request/header').length >= 2,
				discordMessagesSent: 0,
			});
		})().catch((error) =>
			save({ ok: false, error: error.message, discordMessagesSent: 0 }),
		);
		return () => {
			disposed = true;
			void handle?.dispose();
		};
	});
}
