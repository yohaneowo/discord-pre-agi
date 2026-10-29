// 她查自己的「饭钱」：DeepSeek 帐户余额（每次现查）、今天大约花了多少、最近平均一天花多少、
// 照这样还能撑几天。花费是从每 10 分钟的余额读数推算的（spend.mjs）。查不到就说查不到，不捏造金额。
const DAY = 86400000;

export function balanceTools(runtime) {
	return [
		{
			name: 'my_balance',
			description:
				'查你自己的飯錢：DeepSeek 帳戶餘額、今天大約花了多少、照最近的速度還能撐幾天。有人問你餘額、額度、還能活多久、要不要投餵時用；照實說，查不到就說查不到，不要猜數字。',
			parameters: {
				type: 'object',
				properties: {},
				additionalProperties: false,
			},
			output: {
				schema: {
					type: 'object',
					properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
					required: ['ok'],
					additionalProperties: false,
				},
				render: (_args, result) => [{ type: 'text', text: result.message }],
			},
			execute: async () => {
				let total;
				try {
					total = await runtime.balanceTotal();
				} catch {
					/* 读不到就照实说。 */
				}
				if (!Number.isFinite(total))
					return {
						ok: false,
						message: '現在查不到餘額（DeepSeek 帳戶暫時讀不到），不要猜數字。',
					};
				const now = Date.now();
				const readings = runtime.spend?.state?.readings ?? [];
				const span = readings.length ? (now - readings[0].t) / DAY : 0;
				const daily =
					span >= 0.5 ? runtime.spend.spent(readings[0].t, now) / span : 0;
				const days = daily > 0 ? total / daily : undefined;
				return {
					ok: true,
					message: `餘額約 ${total.toFixed(2)} 元（人民幣）；今天大約花了 ${runtime.spend.spentToday(now).toFixed(2)} 元${
						days === undefined
							? ''
							: `；最近平均一天約 ${daily.toFixed(2)} 元，照這樣大概還能撐 ${days < 1 ? '不到 1' : Math.floor(days)} 天`
					}。（花費是從每 10 分鐘的餘額推算的，實際以 DeepSeek 帳單為準）`,
				};
			},
		},
	];
}
