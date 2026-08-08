/**
 * Loads extensions/idle-timer.ts through the REAL extension loader each
 * runtime uses (jiti) with the runtime's own module aliases, then drives the
 * event lifecycle against a mock ExtensionAPI.
 *
 * Runtime installs are resolved from env (PI_IDLE_TIMER_PI_DIR /
 * PI_IDLE_TIMER_PRIME_DIR) with machine-local defaults; missing runtimes are
 * skipped so `npm test` stays green anywhere.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXT_PATH = fileURLToPath(new URL("../extensions/idle-timer.ts", import.meta.url));

const DEFAULTS = {
	pi: "/Users/user/.local/share/mise/installs/node/24.15.0/lib/node_modules/@earendil-works/pi-coding-agent",
	"prime-agent": "/Users/user/.local/share/mise/installs/node/24.15.0/lib/node_modules/prime-agent",
};

const RUN_TIMES = [
	{ name: "pi", prime: false },
	{ name: "prime-agent", prime: true },
];

function runtimeRoot(name: string): string {
	const env = name === "pi" ? "PI_IDLE_TIMER_PI_DIR" : "PI_IDLE_TIMER_PRIME_DIR";
	return process.env[env] ?? DEFAULTS[name];
}

async function loadExtension(root: string) {
	const require = createRequire(pathToFileURL(path.join(root, "package.json")));
	const { createJiti } = await import(pathToFileURL(path.join(root, "node_modules/jiti/lib/jiti-static.mjs")).href);
	const aliases = {
		"@earendil-works/pi-coding-agent": path.join(root, "dist/index.js"),
	};
	const jiti = createJiti(import.meta.url, { moduleCache: false, alias: aliases });
	return jiti.import(EXT_PATH, { default: true });
}

interface MockUi {
	setStatus(key: string, text: string | undefined): void;
	setWidget(key: string, content: string[] | undefined, options?: { placement?: string }): void;
	theme: { fg(style: string, text: string): string };
}

interface MockContext {
	hasUI: boolean;
	ui: MockUi;
}

interface MockPi {
	handlers: Map<string, (event: unknown, ctx: MockContext) => Promise<void>>;
	statuses: Map<string, string>;
	widgets: Map<string, string[]>;
	ui: MockUi;
	widgetOptions: { placement?: string } | undefined;
	pi: { on(event: string, handler: (event: unknown, ctx: MockContext) => Promise<void>): void };
	ctx: MockContext;
}

function makeMockPi(): MockPi {
	const handlers = new Map<string, (event: unknown, ctx: MockContext) => Promise<void>>();
	const statuses = new Map<string, string>();
	const widgets = new Map<string, string[]>();
	let widgetOptions: { placement?: string } | undefined;
	const ui: MockUi = {
		setStatus(key: string, text: string | undefined) {
			if (text === undefined) statuses.delete(key);
			else statuses.set(key, text);
		},
		setWidget(key: string, content: string[] | undefined, options?: { placement?: string }) {
			widgetOptions = options;
			if (content === undefined) widgets.delete(key);
			else widgets.set(key, content);
		},
		theme: { fg: (_style: string, text: string) => text },
	};
	return {
		handlers,
		statuses,
		widgets,
		ui,
		get widgetOptions() {
			return widgetOptions;
		},
		pi: { on: (event, handler) => void handlers.set(event, handler) },
		ctx: { hasUI: true, ui },
	};
}

// The prime-agent widget line is ANSI-styled with the theme's muted color
// (e.g. "\x1b[38;2;161;161;170midle 0s\x1b[39m\n") and carries a trailing
// newline so the TUI renders a blank row of bottom margin after the timer.
// Assert on the text, the color envelope, and the spacing newline rather
// than the exact string.
function assertWidgetLine(mock: MockPi, key: string, expectedText: string) {
	const lines = mock.widgets.get(key);
	assert.ok(Array.isArray(lines) && lines.length === 1, `expected a widget line for ${key}`);
	const line = lines[0];
	assert.ok(line.startsWith("\x1b[38;"), `widget line must be ANSI-colored, got ${JSON.stringify(line)}`);
	assert.ok(line.endsWith("\x1b[39m\n"), "widget line must reset the foreground color and end with the bottom-margin newline");
	assert.ok(line.includes(expectedText), `widget line should contain ${JSON.stringify(expectedText)}, got ${JSON.stringify(line)}`);
}

for (const rt of RUN_TIMES) {
	describe(`extension under ${rt.name} runtime`, () => {
		it("loads, detects the host, and drives the idle timer", async (t) => {
			const root = runtimeRoot(rt.name);
			if (!existsSync(path.join(root, "dist/index.js"))) {
				t.skip(`${rt.name} not installed at ${root}`);
				return;
			}

			const factory = await loadExtension(root);
			assert.equal(typeof factory, "function", "extension must export a default factory function");

			const mock = makeMockPi();
			factory(mock.pi);

			// All expected events subscribed
			for (const ev of ["agent_start", "message_start", "message_end", "session_shutdown"]) {
				assert.equal(typeof mock.handlers.get(ev), "function", `missing handler for ${ev}`);
			}

			// Fresh session: hidden
			assert.equal(mock.statuses.size, 0);
			assert.equal(mock.widgets.size, 0);

			// Control the clock for deterministic elapsed-time assertions
			const realNow = Date.now;
			let now = 1_700_000_000_000;
			Date.now = () => now;
			try {
				const h = (ev: string) => mock.handlers.get(ev);

				// Assistant message starts -> still hidden
				await h("message_start")({ message: { role: "assistant" } }, mock.ctx);
				assert.equal(mock.statuses.size, 0);
				assert.equal(mock.widgets.size, 0);

				// Assistant message finishes -> timer starts at idle 0s
				await h("message_end")({ message: { role: "assistant" } }, mock.ctx);
				if (rt.prime) {
					// prime-agent: rendered as a below-editor widget (daemon-safe channel)
					assertWidgetLine(mock, "idle-timer", "idle 0s");
					assert.equal(mock.widgetOptions?.placement, "belowEditor");
					assert.equal(mock.statuses.size, 0, "prime-agent must not rely on footer statuses");
				} else {
					// pi: rendered in the built-in footer via setStatus
					assert.equal(mock.statuses.get("idle-timer"), "idle 0s");
					assert.equal(mock.widgets.size, 0, "pi must keep its built-in footer");
				}

				// Ticking: advance the clock, let the 1s interval fire
				now += 5000;
				await new Promise((r) => setTimeout(r, 1100));
				if (rt.prime) {
					assertWidgetLine(mock, "idle-timer", "idle 5s");
				} else {
					assert.equal(mock.statuses.get("idle-timer"), "idle 5s");
				}

				// Next turn starts -> hidden again
				await h("agent_start")({}, mock.ctx);
				assert.equal(mock.statuses.size, 0);
				assert.equal(mock.widgets.size, 0);

				// Long idle formatting via a fresh message_end after 61s
				await h("message_end")({ message: { role: "assistant" } }, mock.ctx);
				if (rt.prime) {
					assertWidgetLine(mock, "idle-timer", "idle 0s");
				} else {
					assert.equal(mock.statuses.get("idle-timer"), "idle 0s");
				}
				now += 61_000;
				await new Promise((r) => setTimeout(r, 1100));
				if (rt.prime) {
					assertWidgetLine(mock, "idle-timer", "idle 1m 01s");
				} else {
					assert.equal(mock.statuses.get("idle-timer"), "idle 1m 01s");
				}

				// Shutdown: timer cleared everywhere
				await h("session_shutdown")({}, mock.ctx);
				assert.equal(mock.statuses.size, 0);
				assert.equal(mock.widgets.size, 0);
			} finally {
				Date.now = realNow;
			}
		});
	});
}
