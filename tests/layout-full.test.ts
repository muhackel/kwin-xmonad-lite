import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayoutParams } from "../src/core/layout/index.ts";
import { full } from "../src/core/layout/index.ts";
import type { Rect } from "../src/core/rect.ts";
import { equals } from "../src/core/rect.ts";
import type { LayoutCase } from "./support/gen.ts";
import { allCases } from "./support/gen.ts";
import { assertCommon, innerArea, label, must } from "./support/props.ts";

const SCREEN: Rect = { x: 0, y: 0, width: 2560, height: 1440 };

function paramsOf(testCase: LayoutCase): LayoutParams {
	return {
		ratio: testCase.ratio,
		gapOuter: testCase.gapOuter,
		gapInner: testCase.gapInner,
	};
}

test("full ohne Fenster liefert nichts", () => {
	assert.deepEqual(full(SCREEN, 0, { ratio: 0.65, gapOuter: 8, gapInner: 8 }), []);
});

test("full gibt jedem Fenster die ganze Fläche minus Außenabstand", () => {
	assert.deepEqual(full(SCREEN, 3, { ratio: 0.65, gapOuter: 20, gapInner: 8 }), [
		{ x: 20, y: 20, width: 2520, height: 1400 },
		{ x: 20, y: 20, width: 2520, height: 1400 },
		{ x: 20, y: 20, width: 2520, height: 1400 },
	]);
});

test("full ignoriert das Master-Verhältnis und den Innenabstand", () => {
	const a = full(SCREEN, 2, { ratio: 0.1, gapOuter: 0, gapInner: 0 });
	const b = full(SCREEN, 2, { ratio: 0.9, gapOuter: 0, gapInner: 64 });
	assert.deepEqual(a, b);
});

test("full erfüllt die Layouteigenschaften über Gitter und Fuzz", () => {
	for (const testCase of allCases()) {
		const rects = full(testCase.area, testCase.count, paramsOf(testCase));
		const inner = innerArea(testCase);
		assertCommon(rects, testCase, "full");
		for (let i = 0; i < rects.length; i++) {
			const r = must(rects[i], "Zelle fehlt");
			assert.ok(equals(r, inner), `Zelle ${i} ist nicht die ganze Fläche: ${label(testCase)}`);
		}
	}
});

test("full liefert eigenständige Objekte je Zelle", () => {
	const rects = full(SCREEN, 3, { ratio: 0.65, gapOuter: 0, gapInner: 0 });
	assert.notEqual(rects[0], rects[1]);
	assert.notEqual(rects[1], rects[2]);
	const first = must(rects[0], "Zelle 0");
	first.width = 1;
	assert.equal(must(rects[1], "Zelle 1").width, 2560);
});
