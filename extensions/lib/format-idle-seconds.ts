/**
 * Pure idle-time formatting. Kept free of runtime imports so it can be unit
 * tested with plain node --experimental-strip-types.
 */

export function formatIdleSeconds(totalSeconds: number): string {
	if (totalSeconds < 60) {
		return `idle ${totalSeconds}s`;
	}
	if (totalSeconds < 3600) {
		const m = Math.floor(totalSeconds / 60);
		const s = totalSeconds % 60;
		return `idle ${m}m ${String(s).padStart(2, "0")}s`;
	}
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	return `idle ${h}h ${String(m).padStart(2, "0")}m`;
}
