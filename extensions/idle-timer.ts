/**
 * Idle Timer Extension
 *
 * Shows time since the latest assistant message finished.
 *
 * Runtime support (pi, omp, and prime-agent):
 * - pi: the built-in footer already renders extension statuses alongside
 *   pwd/tokens/cost/context/model, so ctx.ui.setStatus() is all that is
 *   needed.
 * - omp: the status renderer strips ANSI and does not add Text's left gutter.
 *   The timer therefore uses a below-editor widget, where the live theme can
 *   provide the muted color and Text supplies the normal one-cell gutter.
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
 * package: prime-agent exports IPython-tool symbols, and omp exports its
 * subagent HUD renderer. Override with PI_IDLE_TIMER_WIDGET=1|0 if needed.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import * as pa from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatIdleSeconds } from "./lib/format-idle-seconds.ts";
import { detectColorMode, mutedWidgetLine, readThemeName } from "./lib/widget-color.ts";

const STATUS_KEY = "idle-timer";
const HOST = pa as Record<string, unknown>;
const IS_PRIME_AGENT =
	typeof HOST.isIpythonToolResult === "function" ||
	typeof HOST.getPythonSkillRuntimeInfo === "function";
// omp exposes the subagent HUD renderer; its status renderer strips ANSI and
// has no Text gutter, so use the widget channel for the timer there as well.
const IS_OMP = typeof HOST.renderSubagentHudLines === "function";
// Prime-agent widget strings bypass Text and require one explicit left gutter.
const WIDGET_LEFT_GUTTER = " ";
const WIDGET_OVERRIDE = process.env.PI_IDLE_TIMER_WIDGET;
const SHOULD_USE_WIDGET =
	WIDGET_OVERRIDE === "1" || (WIDGET_OVERRIDE === undefined && (IS_PRIME_AGENT || IS_OMP));

// prime-agent's user dir (agentDir/settings.json + agentDir/themes). The
// extension cannot import prime-agent's config module, so this mirrors the
// default CONFIG_DIR_NAME (".prime/agent") under the user's home.
const AGENT_DIR = join(homedir(), ".prime", "agent");
// Captured at module load: prime-agent restores the client's env while
// loading extensions, so COLORTERM/TERM here describe the TUI's terminal.
const COLOR_MODE = detectColorMode(process.env);

/**
 * Apply the theme's dim style when available. Return plain text when the
 * runtime does not initialize a theme.
 */
function dimText(ctx: ExtensionContext, text: string): string {
	try {
		return ctx.ui.theme.fg("dim", text);
	} catch {
		return text;
	}
}

/** Register idle timer lifecycle handlers for pi-compatible runtimes. */
export default function idleTimerExtension(pi: ExtensionAPI) {
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

	// The prime-agent widget line is resolved lazily and cached because its
	// daemon worker cannot access ctx.ui.theme.
	let mutedLine: ((text: string) => string) | null = null;

	function setStatusText(ctx: ExtensionContext, text: string) {
		if (!ctx.hasUI) {
			return;
		}
		if (SHOULD_USE_WIDGET) {
			if (IS_OMP) {
				// OMP's status renderer strips ANSI and has no Text gutter.
				// Its widget renderer supplies the gutter and keeps this theme
				// color sequence.
				let line = text;
				try {
					line = ctx.ui.theme.fg("muted", text);
				} catch {
					// Keep the timer visible if the theme is unavailable.
				}
				ctx.ui.setWidget(STATUS_KEY, [line + "\n"], { placement: "belowEditor" });
			} else {
				// Widget lines cross the prime-agent daemon boundary as plain
				// strings, so embed the theme's muted color as ANSI.
				if (mutedLine === null) {
					const themeName = readThemeName(AGENT_DIR);
					const themesDir = join(AGENT_DIR, "themes");
					mutedLine = (t) => mutedWidgetLine(t, themeName, COLOR_MODE, themesDir);
				}
				// A trailing "\n" adds a blank row of bottom margin.
				ctx.ui.setWidget(
					STATUS_KEY,
					[mutedLine(WIDGET_LEFT_GUTTER + text) + "\n"],
					{ placement: "belowEditor" },
				);
			}
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
