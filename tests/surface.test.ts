import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSurfaceKey, surfaceKey } from "../src/core/surface.ts";

const REF = {
	activity: "b1f2c3d4-0000-4000-8000-abcdefabcdef",
	desktop: "3",
	output: "DP-1",
};

test("Surface-Schluessel laeuft verlustfrei hin und zurueck", () => {
	const key = surfaceKey(REF);
	assert.equal(key, "b1f2c3d4-0000-4000-8000-abcdefabcdef|3|DP-1");
	assert.deepEqual(parseSurfaceKey(key), REF);
});

test("Surface-Schluessel weist den Trenner in einer Komponente ab", () => {
	assert.throws(() => surfaceKey({ activity: "a|b", desktop: "1", output: "DP-1" }));
	assert.throws(() => surfaceKey({ activity: "a", desktop: "1|2", output: "DP-1" }));
	assert.throws(() => surfaceKey({ activity: "a", desktop: "1", output: "DP|1" }));
});

test("parseSurfaceKey lehnt fehlerhafte Schluessel ab", () => {
	assert.equal(parseSurfaceKey("nur-ein-teil"), null);
	assert.equal(parseSurfaceKey("a|1"), null);
	assert.equal(parseSurfaceKey("a|1|DP-1|zuviel"), null);
	assert.deepEqual(parseSurfaceKey("||"), { activity: "", desktop: "", output: "" });
});
