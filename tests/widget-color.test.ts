import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	detectColorMode,
	fgAnsiForHex,
	mutedHexForThemeName,
	mutedWidgetLine,
	readThemeName,
	rgbTo256,
} from "../extensions/lib/widget-color.ts";

describe("detectColorMode", () => {
	it("prefers COLORTERM=truecolor", () => {
		assert.equal(detectColorMode({ COLORTERM: "truecolor", TERM: "xterm-256color" }), "truecolor");
		assert.equal(detectColorMode({ COLORTERM: "24bit" }), "truecolor");
	});
	it("treats Windows Terminal as truecolor", () => {
		assert.equal(detectColorMode({ WT_SESSION: "x", TERM: "xterm-256color" }), "truecolor");
	});
	it("falls back to 256color for limited terminals", () => {
		assert.equal(detectColorMode({ TERM: "dumb" }), "256color");
		assert.equal(detectColorMode({ TERM: "linux" }), "256color");
		assert.equal(detectColorMode({ TERM: "xterm", TERM_PROGRAM: "Apple_Terminal" }), "256color");
	});
	it("treats tmux and plain screen differently", () => {
		assert.equal(detectColorMode({ TERM: "screen", TMUX: "/tmp/tmux" }), "truecolor");
		assert.equal(detectColorMode({ TERM: "screen" }), "256color");
		assert.equal(detectColorMode({ TERM: "tmux-256color" }), "truecolor");
	});
	it("defaults to truecolor", () => {
		assert.equal(detectColorMode({ TERM: "xterm-256color" }), "truecolor");
	});
	it("treats an empty TERM as 256color", () => {
		assert.equal(detectColorMode({}), "256color");
	});
});

describe("mutedHexForThemeName", () => {
	it("maps the built-in themes", () => {
		assert.equal(mutedHexForThemeName("prime"), "#a1a1aa");
		assert.equal(mutedHexForThemeName("dark"), "#808080");
		assert.equal(mutedHexForThemeName("light"), "#6c6c6c");
	});
	it("defaults to the prime theme when unset", () => {
		assert.equal(mutedHexForThemeName(undefined), "#a1a1aa");
	});
	it("reads colors.muted from a custom theme, resolving $var refs", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-idle-timer-theme-"));
		try {
			writeFileSync(
				join(dir, "midnight.json"),
				JSON.stringify({ vars: { gray: "#999999" }, colors: { muted: "$gray" } }),
			);
			assert.equal(mutedHexForThemeName("midnight", dir), "#999999");
			writeFileSync(
				join(dir, "plain.json"),
				JSON.stringify({ colors: { muted: "#123456" } }),
			);
			assert.equal(mutedHexForThemeName("plain", dir), "#123456");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("falls back to prime muted for missing/malformed themes", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-idle-timer-theme-"));
		try {
			assert.equal(mutedHexForThemeName("nope", dir), "#a1a1aa");
			writeFileSync(join(dir, "bad.json"), "not json");
			assert.equal(mutedHexForThemeName("bad", dir), "#a1a1aa");
			writeFileSync(join(dir, "novar.json"), JSON.stringify({ colors: { muted: "$missing" } }));
			assert.equal(mutedHexForThemeName("novar", dir), "#a1a1aa");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("readThemeName", () => {
	it("reads the theme key from settings.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-idle-timer-agent-"));
		try {
			writeFileSync(join(dir, "settings.json"), JSON.stringify({ theme: "dark" }));
			assert.equal(readThemeName(dir), "dark");
			writeFileSync(join(dir, "settings.json"), JSON.stringify({}));
			assert.equal(readThemeName(dir), undefined);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("returns undefined when settings.json is missing", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-idle-timer-agent-"));
		try {
			assert.equal(readThemeName(dir), undefined);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("rgbTo256", () => {
	it("matches xterm cube/gray quantization for the muted colors", () => {
		// Verified against pi-tui's rgbTo256.
		assert.equal(rgbTo256(161, 161, 170), 247); // prime muted #a1a1aa
		assert.equal(rgbTo256(128, 128, 128), 244); // dark muted #808080
		assert.equal(rgbTo256(108, 108, 108), 242); // light muted #6c6c6c
	});
});

describe("fgAnsiForHex", () => {
	it("emits 24-bit color in truecolor mode", () => {
		assert.equal(fgAnsiForHex("#a1a1aa", "truecolor"), "\x1b[38;2;161;161;170m");
	});
	it("emits 256-color in 256color mode", () => {
		assert.equal(fgAnsiForHex("#a1a1aa", "256color"), "\x1b[38;5;247m");
	});
});

describe("mutedWidgetLine", () => {
	it("wraps the text in the muted color and resets the foreground only", () => {
		assert.equal(
			mutedWidgetLine("idle 0s", undefined, "truecolor"),
			"\x1b[38;2;161;161;170midle 0s\x1b[39m",
		);
		assert.equal(
			mutedWidgetLine("idle 0s", "dark", "256color"),
			"\x1b[38;5;244midle 0s\x1b[39m",
		);
	});
});
