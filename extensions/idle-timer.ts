/**
 * Idle Timer Extension
 *
 * Shows time since the latest assistant message finished.
 *
 * Dual-runtime support (pi and prime-agent):
 * - pi: the built-in footer already renders extension statuses alongside
 *   pwd/tokens/cost/context/model, so ctx.ui.setStatus() is all that is
 *   needed.
 * - prime-agent: the built-in footer is intentionally empty, and the TUI
 *   typically runs against the shared daemon, where extension events execute
 *   in a worker process. In that worker ctx.ui.setFooter() is a no-op and
 *   ctx.ui.theme is not initialized, so neither a custom footer nor themed
 *   status text can work. The channel that does cross the daemon boundary is
 *   ctx.ui.setWidget() with plain string lines, which the TUI renders below
 *   the editor — a footer-adjacent status row. This extension uses that.
 *
 * The host is detected by inspecting the host's @earendil-works/pi-coding-agent
 * package: prime-agent (the pi fork with the IPython tool) exports symbols
 * that pi does not. Override with PI_IDLE_TIMER_WIDGET=1|0 if needed.
 */

import * as pa from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatIdleSeconds } from "./lib/format-idle-seconds.ts";

const STATUS_KEY = "idle-timer";

const HOST = pa as Record<string, unknown>;
const IS_PRIME_AGENT =
	typeof HOST.isIpythonToolResult === "function" ||
	typeof HOST.getPythonSkillRuntimeInfo === "function";
const WIDGET_OVERRIDE = process.env.PI_IDLE_TIMER_WIDGET;
const SHOULD_USE_WIDGET =
	WIDGET_OVERRIDE === "1" || (WIDGET_OVERRIDE === undefined && IS_PRIME_AGENT);

/**
 * Apply the theme's dim style when the theme is available. Prime-agent daemon
 * workers never run initTheme(), so ctx.ui.theme throws there — fall back to
 * plain text instead of crashing the message_end handler.
 */
function dimText(ctx: ExtensionContext, text: string): string {
	try {
		return ctx.ui.theme.fg("dim", text);
	} catch {
		return text;
	}
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let messageEndedAt: number | null = null;

	function clearStatus(ctx: ExtensionContext) {
		if (!ctx.hasUI) {
			return;
		}
		if (SHOULD_USE_WIDGET) {
			ctx.ui.setWidget(STATUS_KEY, undefined);
		} else {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	function setStatusText(ctx: ExtensionContext, text: string) {
		if (!ctx.hasUI) {
			return;
		}
		if (SHOULD_USE_WIDGET) {
			// Widgets cross the daemon boundary as plain string arrays, so they
			// cannot carry theme styling. Rendered just below the editor, in the
			// row the empty built-in footer would occupy.
			ctx.ui.setWidget(STATUS_KEY, [text], { placement: "belowEditor" });
		} else {
			ctx.ui.setStatus(STATUS_KEY, dimText(ctx, text));
		}
	}

	function stopTimer(ctx: ExtensionContext) {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		messageEndedAt = null;
		clearStatus(ctx);
	}

	function updateStatus(ctx: ExtensionContext) {
		if (!ctx.hasUI || messageEndedAt === null) {
			return;
		}
		const elapsedSec = Math.floor((Date.now() - messageEndedAt) / 1000);
		setStatusText(ctx, formatIdleSeconds(elapsedSec));
	}

	function startTimer(ctx: ExtensionContext) {
		stopTimer(ctx);
		messageEndedAt = Date.now();
		updateStatus(ctx);
		timer = setInterval(() => {
			updateStatus(ctx);
		}, 1000);
	}

	pi.on("agent_start", async (_event, ctx) => {
		stopTimer(ctx);
	});

	pi.on("message_start", async (event, ctx) => {
		if (event.message.role === "assistant") {
			stopTimer(ctx);
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role === "assistant" && ctx.hasUI) {
			startTimer(ctx);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopTimer(ctx);
	});
}
