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
		"@earendil-works/pi-tui": path.join(root, "node_modules/@earendil-works/pi-tui/dist/index.js"),
	};
	const jiti = createJiti(import.meta.url, { moduleCache: false, alias: aliases });
	return jiti.import(EXT_PATH, { default: true });
}

function makeMockPi() {
	const handlers = new Map();
	const statuses = new Map();
	let footerFactory;
	const ui = {
		setStatus(key: string, text: string | undefined) {
			if (text === undefined) statuses.delete(key);
			else statuses.set(key, text);
		},
		setFooter(factory: unknown) {
			footerFactory = factory;
		},
		theme: { fg: (_style: string, text: string) => text },
	};
	return {
		handlers,
		statuses,
		ui,
		get footerFactory() {
			return footerFactory;
		},
		pi: { on: (event: string, handler: unknown) => handlers.set(event, handler) },
		ctx: { hasUI: true, ui },
	};
}

function footerLines(mock: ReturnType<typeof makeMockPi>, statusTexts: string[]) {
	const factory = mock.footerFactory;
	assert.equal(typeof factory, "function", "expected a custom footer to be installed");
	const footerData = {
		getExtensionStatuses: () => new Map(statusTexts.map((t, i) => [`k${i}`, t])),
		onBranchChange: () => () => {},
	};
	const component = factory({ requestRender() {} }, { fg: (_s: string, t: string) => t }, footerData);
	return component.render(200) as string[];
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

			// Control the clock for deterministic elapsed-time assertions
			const realNow = Date.now;
			let now = 1_700_000_000_000;
			Date.now = () => now;
			try {
				const h = (ev: string) => mock.handlers.get(ev);

				// Assistant message starts -> still hidden
				await h("message_start")({ message: { role: "assistant" } }, mock.ctx);
				assert.equal(mock.statuses.size, 0);

				// Assistant message finishes -> timer starts at idle 0s
				await h("message_end")({ message: { role: "assistant" } }, mock.ctx);
				assert.equal(mock.statuses.get("idle-timer"), "idle 0s");

				// Footer: prime-agent installs a statuses footer; pi does not
				if (rt.prime) {
					const lines = footerLines(mock, [mock.statuses.get("idle-timer") ?? ""]);
					assert.ok(lines[0]?.includes("idle 0s"), `footer should render the timer, got ${lines}`);
				} else {
					assert.equal(mock.footerFactory, undefined, "pi must keep its built-in footer");
				}

				// Ticking: advance the clock, let the 1s interval fire
				now += 5000;
				await new Promise((r) => setTimeout(r, 1100));
				assert.equal(mock.statuses.get("idle-timer"), "idle 5s");

				// Next turn starts -> hidden again
				await h("agent_start")({}, mock.ctx);
				assert.equal(mock.statuses.size, 0);

				// Long idle formatting via a fresh message_end after 61s
				await h("message_end")({ message: { role: "assistant" } }, mock.ctx);
				assert.equal(mock.statuses.get("idle-timer"), "idle 0s");
				now += 61_000;
				await new Promise((r) => setTimeout(r, 1100));
				assert.equal(mock.statuses.get("idle-timer"), "idle 1m 01s");

				// Shutdown: timer cleared, footer removed
				await h("session_shutdown")({}, mock.ctx);
				assert.equal(mock.statuses.size, 0);
				assert.equal(mock.footerFactory, undefined);
			} finally {
				Date.now = realNow;
			}
		});
	});
}
