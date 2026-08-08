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
 *   the editor — a footer-adjacent status row. Because the lines are plain
 *   strings, the theme's muted color is embedded as an ANSI foreground
 *   sequence (the same escape the TUI itself emits).
 *
 * The host is detected by inspecting the host's @earendil-works/pi-coding-agent
 * package: prime-agent (the pi fork with the IPython tool) exports symbols
 * that pi does not. Override with PI_IDLE_TIMER_WIDGET=1|0 if needed.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import * as pa from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatIdleSeconds } from "./lib/format-idle-seconds.ts";
import { detectColorMode, mutedWidgetLine, readThemeName } from "./lib/widget-color.ts";

const STATUS_KEY = "idle-timer";
// omp's native HUD prefixes child/tree rows with one space after Text's
// normal left padding. Match that gutter for the below-editor timer widget.
const WIDGET_LEFT_GUTTER = " ";

const HOST = pa as Record<string, unknown>;
const IS_PRIME_AGENT =
	typeof HOST.isIpythonToolResult === "function" ||
	typeof HOST.getPythonSkillRuntimeInfo === "function";
const WIDGET_OVERRIDE = process.env.PI_IDLE_TIMER_WIDGET;
const SHOULD_USE_WIDGET =
	WIDGET_OVERRIDE === "1" || (WIDGET_OVERRIDE === undefined && IS_PRIME_AGENT);

// prime-agent's user dir (agentDir/settings.json + agentDir/themes). The
// extension cannot import prime-agent's config module, so this mirrors the
// default CONFIG_DIR_NAME (".prime/agent") under the user's home.
const AGENT_DIR = join(homedir(), ".prime", "agent");
// Captured at module load: prime-agent restores the client's env while
// loading extensions, so COLORTERM/TERM here describe the TUI's terminal.
const COLOR_MODE = detectColorMode(process.env);

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

	// The muted widget line is resolved lazily (first timer display) and
	// cached: the theme name comes from prime-agent's settings.json, which the
	// daemon worker cannot reach through ctx.
	let mutedLine: ((text: string) => string) | null = null;

	function setStatusText(ctx: ExtensionContext, text: string) {
		if (!ctx.hasUI) {
			return;
		}
		if (SHOULD_USE_WIDGET) {
			// Widget lines cross the daemon boundary as plain strings, so the
			// muted color is embedded as ANSI. Rendered just below the editor,
			// in the row the empty built-in footer would occupy.
			if (mutedLine === null) {
				const themeName = readThemeName(AGENT_DIR);
				const themesDir = join(AGENT_DIR, "themes");
				mutedLine = (t) => mutedWidgetLine(t, themeName, COLOR_MODE, themesDir);
			}
			// A trailing "\n" adds a blank row of bottom margin so the timer
			// doesn't sit flush against the terminal's last row. The TUI renders
			// each widget string through wrapTextWithAnsi, which keeps the empty
			// line after the newline (whitespace-only array entries are dropped).
			ctx.ui.setWidget(STATUS_KEY, [mutedLine(WIDGET_LEFT_GUTTER + text) + "\n"], { placement: "belowEditor" });
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
