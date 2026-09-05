import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayoutParams } from "../src/core/layout/index.ts";
import { clampRatio, RATIO_STEP, tall } from "../src/core/layout/index.ts";
import type { Rect } from "../src/core/rect.ts";
import { equals, shrink } from "../src/core/rect.ts";
import type { LayoutCase } from "./support/gen.ts";
import { allCases } from "./support/gen.ts";
import { assertCommon, assertDisjoint, gapBelow, innerArea, label, must } from "./support/props.ts";

const SCREEN: Rect = { x: 0, y: 0, width: 2560, height: 1440 };

function paramsOf(testCase: LayoutCase): LayoutParams {
	return {
		ratio: testCase.ratio,
		gapOuter: testCase.gapOuter,
		gapInner: testCase.gapInner,
	};
}

test("tall ohne Fenster liefert nichts", () => {
	assert.deepEqual(tall(SCREEN, 0, { ratio: 0.65, gapOuter: 0, gapInner: 0 }), []);
	assert.deepEqual(tall(SCREEN, -3, { ratio: 0.65, gapOuter: 0, gapInner: 0 }), []);
});

test("tall mit einem Fenster nimmt die ganze Fläche", () => {
	assert.deepEqual(tall(SCREEN, 1, { ratio: 0.65, gapOuter: 0, gapInner: 0 }), [SCREEN]);
	assert.deepEqual(tall(SCREEN, 1, { ratio: 0.65, gapOuter: 12, gapInner: 4 }), [
		{ x: 12, y: 12, width: 2536, height: 1416 },
	]);
});

test("tall teilt 2560x1440 bei 65 Prozent ohne Abstände exakt", () => {
	assert.deepEqual(tall(SCREEN, 2, { ratio: 0.65, gapOuter: 0, gapInner: 0 }), [
		{ x: 0, y: 0, width: 1664, height: 1440 },
		{ x: 1664, y: 0, width: 896, height: 1440 },
	]);
	assert.deepEqual(tall(SCREEN, 3, { ratio: 0.65, gapOuter: 0, gapInner: 0 }), [
		{ x: 0, y: 0, width: 1664, height: 1440 },
		{ x: 1664, y: 0, width: 896, height: 720 },
		{ x: 1664, y: 720, width: 896, height: 720 },
	]);
});

test("tall mit Abständen bleibt in der Summe exakt", () => {
	const rects = tall(SCREEN, 3, { ratio: 0.65, gapOuter: 10, gapInner: 10 });
	assert.deepEqual(rects, [
		{ x: 10, y: 10, width: 1645, height: 1420 },
		{ x: 1665, y: 10, width: 885, height: 705 },
		{ x: 1665, y: 725, width: 885, height: 705 },
	]);
	// 1645 + 10 + 885 = 2540 und 705 + 10 + 705 = 1420: die innere Fläche.
	assert.deepEqual(shrink(SCREEN, 10), { x: 10, y: 10, width: 2540, height: 1420 });
});

test("tall fällt bei zu schmaler Fläche auf einen senkrechten Stapel zurück", () => {
	// 1 px Breite trägt keine zwei Spalten.
	assert.deepEqual(
		tall({ x: 0, y: 0, width: 1, height: 6 }, 3, {
			ratio: 0.65,
			gapOuter: 0,
			gapInner: 0,
		}),
		[
			{ x: 0, y: 0, width: 1, height: 2 },
			{ x: 0, y: 2, width: 1, height: 2 },
			{ x: 0, y: 4, width: 1, height: 2 },
		],
	);
});

test("tall erfüllt die Layouteigenschaften über Gitter und Fuzz", () => {
	const cases = allCases();
	assert.ok(cases.length > 2000, `zu wenige Fälle: ${cases.length}`);

	for (const testCase of cases) {
		const rects = tall(testCase.area, testCase.count, paramsOf(testCase));
		const inner = innerArea(testCase);
		assertCommon(rects, testCase, "tall");
		assertDisjoint(rects, testCase, "tall");

		if (testCase.count === 1) {
			assert.ok(equals(must(rects[0], "Zelle 0 fehlt"), inner), `count=1: ${label(testCase)}`);
		}
		if (testCase.count < 2 || inner.width < 2) {
			continue;
		}

		const master = must(rects[0], `Master fehlt: ${label(testCase)}`);
		assert.equal(master.x, inner.x, `Master nicht links: ${label(testCase)}`);
		assert.equal(master.y, inner.y, `Master nicht oben: ${label(testCase)}`);
		assert.equal(master.height, inner.height, `Master nicht volle Höhe: ${label(testCase)}`);
		assert.ok(master.width >= 1, `Master ohne Breite: ${label(testCase)}`);

		const rows = rects.slice(1);
		const first = must(rows[0], `Stapel fehlt: ${label(testCase)}`);
		const columnGap = first.x - (master.x + master.width);
		assert.ok(
			columnGap >= 0 && columnGap <= testCase.gapInner,
			`Spaltenabstand ${columnGap} unplausibel: ${label(testCase)}`,
		);
		assert.equal(
			master.width + columnGap + first.width,
			inner.width,
			`Breiten zerlegen die Fläche nicht exakt: ${label(testCase)}`,
		);
		assert.equal(first.y, inner.y, `Stapel beginnt nicht oben: ${label(testCase)}`);

		let heightSum = 0;
		let gapSum = 0;
		for (let i = 0; i < rows.length; i++) {
			const row = must(rows[i], `Stapelzelle ${i} fehlt`);
			assert.equal(row.x, first.x, `Stapelzelle ${i} nicht in der Spalte: ${label(testCase)}`);
			assert.equal(row.width, first.width, `Stapelzelle ${i} andere Breite: ${label(testCase)}`);
			heightSum += row.height;
			if (i > 0) {
				const gap = gapBelow(must(rows[i - 1], "Vorgänger fehlt"), row);
				assert.ok(
					gap >= 0 && gap <= testCase.gapInner,
					`Zeilenabstand ${gap} unplausibel: ${label(testCase)}`,
				);
				gapSum += gap;
			}
		}
		assert.equal(
			heightSum + gapSum,
			inner.height,
			`Höhen zerlegen die Fläche nicht exakt: ${label(testCase)}`,
		);
		const last = must(rows[rows.length - 1], "letzte Zelle fehlt");
		assert.equal(
			last.y + last.height,
			inner.y + inner.height,
			`Stapel endet nicht am unteren Rand: ${label(testCase)}`,
		);

		if (inner.height >= testCase.count - 1) {
			for (let i = 0; i < rects.length; i++) {
				const r = must(rects[i], "Zelle fehlt");
				assert.ok(r.width >= 1 && r.height >= 1, `Zelle ${i} leer: ${label(testCase)}`);
			}
		}
	}
});

test("tall hält alle Zeilenabstände gleich", () => {
	for (const testCase of allCases()) {
		if (testCase.count < 4 || testCase.gapInner === 0) {
			continue;
		}
		const rows = tall(testCase.area, testCase.count, paramsOf(testCase)).slice(1);
		if (rows.length < 3) {
			continue;
		}
		const reference = gapBelow(must(rows[0], "Zeile 0"), must(rows[1], "Zeile 1"));
		for (let i = 2; i < rows.length; i++) {
			const gap = gapBelow(must(rows[i - 1], "Vorgänger"), must(rows[i], "Zeile"));
			assert.equal(gap, reference, `ungleicher Zeilenabstand: ${label(testCase)}`);
		}
	}
});

test("tall ist idempotent und liefert eigenständige Objekte", () => {
	for (const testCase of allCases()) {
		const a = tall(testCase.area, testCase.count, paramsOf(testCase));
		const b = tall(testCase.area, testCase.count, paramsOf(testCase));
		assert.deepEqual(a, b, `nicht idempotent: ${label(testCase)}`);
		for (let i = 0; i < a.length; i++) {
			assert.notEqual(a[i], b[i], `geteiltes Objekt: ${label(testCase)}`);
		}
	}
});

test("größeres Verhältnis macht den Master nie schmaler", () => {
	for (const testCase of allCases()) {
		if (testCase.count < 2) {
			continue;
		}
		const low = clampRatio(testCase.ratio);
		const high = clampRatio(testCase.ratio + RATIO_STEP);
		const gaps = { gapOuter: testCase.gapOuter, gapInner: testCase.gapInner };
		const a = tall(testCase.area, testCase.count, {
			ratio: low,
			gapOuter: gaps.gapOuter,
			gapInner: gaps.gapInner,
		});
		const b = tall(testCase.area, testCase.count, {
			ratio: high,
			gapOuter: gaps.gapOuter,
			gapInner: gaps.gapInner,
		});
		const widthA = must(a[0], "Master A").width;
		const widthB = must(b[0], "Master B").width;
		assert.ok(widthB >= widthA, `Monotonie verletzt (${widthA} > ${widthB}): ${label(testCase)}`);
	}
});
