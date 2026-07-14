import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatIdleSeconds } from "../extensions/idle-timer.ts";

describe("formatIdleSeconds", () => {
	const cases: Array<[number, string]> = [
		[0, "idle 0s"],
		[59, "idle 59s"],
		[60, "idle 1m 00s"],
		[3599, "idle 59m 59s"],
		[3600, "idle 1h 00m"],
		[3720, "idle 1h 02m"],
	];

	for (const [seconds, expected] of cases) {
		it(`${seconds}s → ${expected}`, () => {
			assert.equal(formatIdleSeconds(seconds), expected);
		});
	}
});