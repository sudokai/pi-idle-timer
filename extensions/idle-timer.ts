/**
 * Idle Timer Extension
 *
 * Shows time since the agent last settled in the footer status bar.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "idle-timer";

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

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let settledAt: number | null = null;

	function stopTimer(ctx: ExtensionContext) {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		settledAt = null;
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	function updateStatus(ctx: ExtensionContext) {
		if (!ctx.hasUI || settledAt === null) {
			return;
		}
		const elapsedSec = Math.floor((Date.now() - settledAt) / 1000);
		const text = formatIdleSeconds(elapsedSec);
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", text));
	}

	function startTimer(ctx: ExtensionContext) {
		stopTimer(ctx);
		settledAt = Date.now();
		updateStatus(ctx);
		timer = setInterval(() => {
			updateStatus(ctx);
		}, 1000);
	}

	pi.on("agent_start", async (_event, ctx) => {
		stopTimer(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!ctx.hasUI || !ctx.isIdle()) {
			return;
		}
		startTimer(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopTimer(ctx);
	});
}