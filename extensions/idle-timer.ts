/**
 * Idle Timer Extension
 *
 * Shows time since the latest assistant message finished in the TUI footer.
 *
 * Dual-runtime support (pi and prime-agent):
 * - pi: the built-in footer already renders extension statuses alongside
 *   pwd/tokens/cost/context/model, so ctx.ui.setStatus() is all that is
 *   needed.
 * - prime-agent: the built-in footer is intentionally empty, so this
 *   extension installs a minimal custom footer that renders every extension
 *   status text (the idle timer among them).
 *
 * The host is detected by inspecting the host's @earendil-works/pi-coding-agent
 * package: prime-agent (the pi fork with the IPython tool) exports symbols
 * that pi does not. Override with PI_IDLE_TIMER_FOOTER=1|0 if needed.
 */

import * as pa from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatIdleSeconds } from "./format-idle-seconds.ts";

const STATUS_KEY = "idle-timer";

const HOST = pa as Record<string, unknown>;
const IS_PRIME_AGENT =
	typeof HOST.isIpythonToolResult === "function" ||
	typeof HOST.getPythonSkillRuntimeInfo === "function";
const FOOTER_OVERRIDE = process.env.PI_IDLE_TIMER_FOOTER;
const SHOULD_INSTALL_FOOTER =
	FOOTER_OVERRIDE === "1" || (FOOTER_OVERRIDE === undefined && IS_PRIME_AGENT);

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let messageEndedAt: number | null = null;
	let footerInstalled = false;

	function stopTimer(ctx: ExtensionContext) {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		messageEndedAt = null;
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	function updateStatus(ctx: ExtensionContext) {
		if (!ctx.hasUI || messageEndedAt === null) {
			return;
		}
		const elapsedSec = Math.floor((Date.now() - messageEndedAt) / 1000);
		const text = formatIdleSeconds(elapsedSec);
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", text));
	}

	/**
	 * prime-agent's built-in footer renders nothing, so install a minimal
	 * custom footer that renders every extension status text. Installed lazily
	 * on first timer display (by then the TUI is fully constructed) and only
	 * under prime-agent — pi's built-in footer already shows statuses.
	 */
	function installStatusesFooter(ctx: ExtensionContext) {
		if (!ctx.hasUI || footerInstalled || !SHOULD_INSTALL_FOOTER) {
			return;
		}
		footerInstalled = true;
		ctx.ui.setFooter((tui, _theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const statuses = [...footerData.getExtensionStatuses().values()];
					const line = statuses.join("   ");
					if (!line) {
						return [];
					}
					return visibleWidth(line) <= width ? [line] : [truncateToWidth(line, width)];
				},
			};
		});
	}

	function startTimer(ctx: ExtensionContext) {
		stopTimer(ctx);
		installStatusesFooter(ctx);
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
		if (ctx.hasUI && footerInstalled) {
			ctx.ui.setFooter(undefined);
			footerInstalled = false;
		}
	});
}
