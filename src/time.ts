export function localDate(now: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now);
	const part = (type: string) =>
		parts.find((item) => item.type === type)!.value;
	return `${part('year')}-${part('month')}-${part('day')}`;
}

export function localHour(now: Date, timeZone: string): number {
	return Number(
		new Intl.DateTimeFormat('en-GB', {
			timeZone,
			hour: '2-digit',
			hourCycle: 'h23',
		}).format(now),
	);
}

export function isQuietHour(hour: number, start: number, end: number): boolean {
	if (start === end) return false;
	return start < end
		? hour >= start && hour < end
		: hour >= start || hour < end;
}
