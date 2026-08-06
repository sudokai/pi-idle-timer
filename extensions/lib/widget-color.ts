/**
 * Resolves the prime-agent theme's "muted" foreground color and renders a
 * widget line styled with it.
 *
 * Why this exists: prime-agent's TUI usually runs against the shared daemon,
 * so extension events execute in a daemon worker where ctx.ui.theme throws
 * ("Theme not initialized") and widget lines cross the daemon boundary as
 * plain strings. The only way to color a widget line is to embed the ANSI
 * foreground sequence directly — the same escape the TUI itself emits for the
 * theme's muted color.
 *
 * Pure module: every function takes its inputs explicitly so the unit tests
 * are hermetic. Mirrors prime-agent's own color handling (detectColorMode /
 * fgAnsi / pi-tui's rgbTo256) so the rendered shade matches the TUI exactly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Muted foreground hex for prime-agent's built-in themes (colors.muted, var-refs resolved). */
const MUTED_HEX: Record<string, string> = {
	prime: "#a1a1aa",
	dark: "#808080",
	light: "#6c6c6c",
};
const MUTED_FALLBACK_HEX = MUTED_HEX.prime;

/** ANSI reset that only clears the foreground color (matches Theme.fg). */
const FG_RESET = "[39m";

/**
 * Active color depth, mirroring prime-agent's detectColorMode(). The widget
 * line must use the same mode as the TUI or the terminal may ignore it.
 */
export function detectColorMode(env: Record<string, string | undefined>): "truecolor" | "256color" {
	const colorterm = env.COLORTERM;
	if (colorterm === "truecolor" || colorterm === "24bit") {
		return "truecolor";
	}
	if (env.WT_SESSION) {
		return "truecolor";
	}
	const term = env.TERM || "";
	if (term === "dumb" || term === "" || term === "linux") {
		return "256color";
	}
	if (env.TERM_PROGRAM === "Apple_Terminal") {
		return "256color";
	}
	const inTmux = env.TMUX !== undefined || term.startsWith("tmux");
	if (!inTmux && (term === "screen" || term.startsWith("screen-") || term.startsWith("screen."))) {
		return "256color";
	}
	return "truecolor";
}

/**
 * Muted hex for a theme name. Built-in names are known; a custom theme is read
 * from `<themesDir>/<name>.json` (colors.muted, resolving one level of $var
 * references). Unknown/missing themes fall back to the prime theme's muted.
 */
export function mutedHexForThemeName(themeName: string | undefined, themesDir?: string): string {
	const name = themeName ?? "prime";
	const builtin = MUTED_HEX[name];
	if (builtin) {
		return builtin;
	}
	if (!themesDir) {
		return MUTED_FALLBACK_HEX;
	}
	try {
		const themePath = join(themesDir, `${name}.json`);
		const theme = JSON.parse(readFileSync(themePath, "utf-8")) as {
			vars?: Record<string, string>;
			colors?: { muted?: string };
		};
		let value = theme.colors?.muted;
		if (typeof value === "string" && value.startsWith("$")) {
			value = theme.vars?.[value.slice(1)];
		}
		if (typeof value === "string" && value.startsWith("#")) {
			return value;
		}
	} catch {
		// Missing/malformed custom theme: fall through to the default.
	}
	return MUTED_FALLBACK_HEX;
}

/** Theme name from prime-agent's user settings.json (`theme` key; undefined = auto). */
export function readThemeName(agentDir: string): string | undefined {
	try {
		const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8")) as { theme?: string };
		return settings.theme ?? undefined;
	} catch {
		return undefined;
	}
}

function hexToRgb(hex: string): [number, number, number] {
	const cleaned = hex.replace("#", "");
	return [
		parseInt(cleaned.slice(0, 2), 16),
		parseInt(cleaned.slice(2, 4), 16),
		parseInt(cleaned.slice(4, 6), 16),
	];
}

/** xterm 256-color index for an RGB triple (mirrors pi-tui's rgbTo256). */
export function rgbTo256(r: number, g: number, b: number): number {
	const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
	const GRAY_START = 8;
	const GRAY_STEP = 10;
	const GRAY_COUNT = 24;
	const closest = (value: number, values: number[]): number => {
		let minDist = Infinity;
		let minIdx = 0;
		for (let i = 0; i < values.length; i++) {
			const dist = Math.abs(value - values[i]);
			if (dist < minDist) {
				minDist = dist;
				minIdx = i;
			}
		}
		return minIdx;
	};
	const distance = (a: number, b: number, c: number, x: number, y: number, z: number): number =>
		(a - x) ** 2 * 0.299 + (b - y) ** 2 * 0.587 + (c - z) ** 2 * 0.114;

	const rIdx = closest(r, CUBE_VALUES);
	const gIdx = closest(g, CUBE_VALUES);
	const bIdx = closest(b, CUBE_VALUES);
	const cubeIndex = 16 + 36 * rIdx + 6 * gIdx + bIdx;
	const cubeDist = distance(r, g, b, CUBE_VALUES[rIdx], CUBE_VALUES[gIdx], CUBE_VALUES[bIdx]);

	const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
	const grayIdx = closest(gray, Array.from({ length: GRAY_COUNT }, (_, i) => GRAY_START + i * GRAY_STEP));
	const grayValue = GRAY_START + grayIdx * GRAY_STEP;
	const grayIndex = 232 + grayIdx;
	const grayDist = distance(r, g, b, grayValue, grayValue, grayValue);

	const maxChannel = Math.max(r, g, b);
	const minChannel = Math.min(r, g, b);
	if (maxChannel - minChannel < 10 && grayDist < cubeDist) {
		return grayIndex;
	}
	return cubeIndex;
}

/** ANSI foreground sequence for a hex color in the given color mode (mirrors prime-agent's fgAnsi). */
export function fgAnsiForHex(hex: string, mode: "truecolor" | "256color"): string {
	if (mode === "truecolor") {
		const [r, g, b] = hexToRgb(hex);
		return `[38;2;${r};${g};${b}m`;
	}
	return `[38;5;${rgbTo256(...hexToRgb(hex))}m`;
}

/** A single widget line styled with the theme's muted foreground color. */
export function mutedWidgetLine(text: string, themeName: string | undefined, mode: "truecolor" | "256color", themesDir?: string): string {
	const hex = mutedHexForThemeName(themeName, themesDir);
	return `${fgAnsiForHex(hex, mode)}${text}${FG_RESET}`;
}
