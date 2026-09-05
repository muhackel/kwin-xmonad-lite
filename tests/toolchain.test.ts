import assert from "node:assert/strict";
import { test } from "node:test";

import { format } from "../src/kwin/log.ts";

test("format setzt das Praefix vor die Nachricht", () => {
	const result: string = format("Hallo");
	assert.equal(result, "kwin-xmonad-lite: Hallo");
});

test("format kommt mit leerer Nachricht zurecht", () => {
	assert.equal(format(""), "kwin-xmonad-lite: ");
});
