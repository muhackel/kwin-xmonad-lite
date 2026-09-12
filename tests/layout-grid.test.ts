import assert from "node:assert/strict";
import { test } from "node:test";

import { grid } from "../src/core/layout/index.ts";
import type { LayoutParams } from "../src/core/layout/types.ts";
import type { Rect } from "../src/core/rect.ts";
import { equals } from "../src/core/rect.ts";
import type { LayoutCase } from "./support/gen.ts";
import { allCases } from "./support/gen.ts";
import { assertCommon, assertDisjoint, innerArea, label, must } from "./support/props.ts";

const SCREEN: Rect = { x: 0, y: 0, width: 2560, height: 1440 };
const PARAMS: LayoutParams = { ratio: 0.65, gapOuter: 0, gapInner: 0 };

function paramsOf(testCase: LayoutCase): LayoutParams {
	return {
		ratio: testCase.ratio,
		gapOuter: testCase.gapOuter,
		gapInner: testCase.gapInner,
	};
}

test("grid liefert für n=0 und negative Anzahlen nichts", () => {
	assert.deepEqual(grid(SCREEN, 0, PARAMS), []);
	assert.deepEqual(grid(SCREEN, -2, PARAMS), []);
});

test("grid verwendet für n=1 genau die innere Fläche", () => {
	assert.deepEqual(grid(SCREEN, 1, PARAMS), [SCREEN]);
	assert.deepEqual(
		grid({ x: 7, y: 13, width: 101, height: 97 }, 1, {
			ratio: 0.2,
			gapOuter: 3,
			gapInner: 99,
		}),
		[{ x: 10, y: 16, width: 95, height: 91 }],
	);
});

test("grid ordnet n=2 in einer Spalte an", () => {
	assert.deepEqual(grid(SCREEN, 2, PARAMS), [
		{ x: 0, y: 0, width: 2560, height: 720 },
		{ x: 0, y: 720, width: 2560, height: 720 },
	]);
});

test("grid ordnet n=3 spaltenweise an und gibt der rechten Spalte das Extra", () => {
	assert.deepEqual(grid(SCREEN, 3, PARAMS), [
		{ x: 0, y: 0, width: 1280, height: 1440 },
		{ x: 1280, y: 0, width: 1280, height: 720 },
		{ x: 1280, y: 720, width: 1280, height: 720 },
	]);
});

test("grid verteilt n=5 und n=6 mit festen Restpixeln", () => {
	assert.deepEqual(grid(SCREEN, 5, PARAMS), [
		{ x: 0, y: 0, width: 1280, height: 720 },
		{ x: 0, y: 720, width: 1280, height: 720 },
		{ x: 1280, y: 0, width: 1280, height: 480 },
		{ x: 1280, y: 480, width: 1280, height: 480 },
		{ x: 1280, y: 960, width: 1280, height: 480 },
	]);
	assert.deepEqual(grid({ x: 0, y: 0, width: 1920, height: 1080 }, 6, PARAMS), [
		{ x: 0, y: 0, width: 960, height: 360 },
		{ x: 0, y: 360, width: 960, height: 360 },
		{ x: 0, y: 720, width: 960, height: 360 },
		{ x: 960, y: 0, width: 960, height: 360 },
		{ x: 960, y: 360, width: 960, height: 360 },
		{ x: 960, y: 720, width: 960, height: 360 },
	]);
});

test("grid klemmt Abstände achsenweise und verteilt Restpixel", () => {
	assert.deepEqual(
		grid({ x: 7, y: 13, width: 101, height: 97 }, 5, {
			ratio: 0.65,
			gapOuter: 3,
			gapInner: 7,
		}),
		[
			{ x: 10, y: 16, width: 44, height: 42 },
			{ x: 10, y: 65, width: 44, height: 42 },
			{ x: 61, y: 16, width: 44, height: 26 },
			{ x: 61, y: 49, width: 44, height: 26 },
			{ x: 61, y: 82, width: 44, height: 25 },
		],
	);
	assert.deepEqual(
		grid({ x: 0, y: 0, width: 5, height: 4 }, 4, {
			ratio: 0.65,
			gapOuter: 0,
			gapInner: 100,
		}),
		[
			{ x: 0, y: 0, width: 1, height: 1 },
			{ x: 0, y: 3, width: 1, height: 1 },
			{ x: 4, y: 0, width: 1, height: 1 },
			{ x: 4, y: 3, width: 1, height: 1 },
		],
	);
});

test("grid wählt im Hochformat eine Spalte und im breiten Querformat fünf", () => {
	assert.deepEqual(grid({ x: 20, y: 30, width: 900, height: 1600 }, 3, PARAMS), [
		{ x: 20, y: 30, width: 900, height: 534 },
		{ x: 20, y: 564, width: 900, height: 533 },
		{ x: 20, y: 1097, width: 900, height: 533 },
	]);
	assert.deepEqual(grid({ x: -10, y: 8, width: 3000, height: 400 }, 6, PARAMS), [
		{ x: -10, y: 8, width: 600, height: 400 },
		{ x: 590, y: 8, width: 600, height: 400 },
		{ x: 1190, y: 8, width: 600, height: 400 },
		{ x: 1790, y: 8, width: 600, height: 400 },
		{ x: 2390, y: 8, width: 600, height: 200 },
		{ x: 2390, y: 208, width: 600, height: 200 },
	]);
});

test("grid bleibt bei Null- und Winzflächen endlich und innerhalb", () => {
	assert.deepEqual(grid({ x: 5, y: 7, width: 0, height: 0 }, 3, PARAMS), [
		{ x: 5, y: 7, width: 0, height: 0 },
		{ x: 5, y: 7, width: 0, height: 0 },
		{ x: 5, y: 7, width: 0, height: 0 },
	]);
	assert.deepEqual(grid({ x: 0, y: 0, width: 2, height: 2 }, 5, PARAMS), [
		{ x: 0, y: 0, width: 1, height: 1 },
		{ x: 0, y: 1, width: 1, height: 1 },
		{ x: 1, y: 0, width: 1, height: 1 },
		{ x: 1, y: 1, width: 1, height: 1 },
		{ x: 1, y: 2, width: 1, height: 0 },
	]);
});

test("grid verwirft ungültige Gaps defensiv", () => {
	const area = { x: 1, y: 2, width: 12, height: 8 };
	assert.deepEqual(
		grid(area, 3, { ratio: 0.65, gapOuter: Number.NaN, gapInner: Number.POSITIVE_INFINITY }),
		grid(area, 3, PARAMS),
	);
	assert.deepEqual(
		grid(area, 3, { ratio: 0.65, gapOuter: -20, gapInner: -5 }),
		grid(area, 3, PARAMS),
	);
});

test("masterRatio beeinflusst Grid nicht", () => {
	const low = grid(SCREEN, 5, { ratio: 0.1, gapOuter: 8, gapInner: 4 });
	const high = grid(SCREEN, 5, { ratio: 0.9, gapOuter: 8, gapInner: 4 });
	assert.deepEqual(high, low);
});

test("grid erfüllt Anzahl, Ganzzahligkeit, Grenzen, Trennung und Zerlegung über Gitter und Fuzz", () => {
	const cases = allCases();
	assert.ok(cases.length > 2000, `zu wenige Fälle: ${cases.length}`);

	for (const testCase of cases) {
		const rects = grid(testCase.area, testCase.count, paramsOf(testCase));
		const inner = innerArea(testCase);
		assertCommon(rects, testCase, "grid");
		assertDisjoint(rects, testCase, "grid");
		if (testCase.count <= 0) {
			continue;
		}
		if (testCase.count === 1) {
			assert.ok(equals(must(rects[0], "Zelle 0 fehlt"), inner), label(testCase));
			continue;
		}

		const columns: Rect[][] = [];
		for (const rect of rects) {
			const last = columns[columns.length - 1];
			if (last === undefined || must(last[0], "leere Spalte").x !== rect.x) {
				columns.push([rect]);
			} else {
				last.push(rect);
			}
		}
		const wantedColumns =
			inner.width <= 0 || inner.height <= 0
				? 1
				: Math.max(
						1,
						Math.min(
							testCase.count,
							Math.round(Math.sqrt((testCase.count * inner.width) / (inner.height * (16 / 9)))),
						),
					);
		assert.equal(columns.length, wantedColumns, `Spaltenzahl: ${label(testCase)}`);

		let widthSum = 0;
		let columnGapSum = 0;
		for (let column = 0; column < columns.length; column++) {
			const cells = must(columns[column], "Spalte fehlt");
			const first = must(cells[0], "Spalte leer");
			widthSum += first.width;
			let heightSum = 0;
			let rowGapSum = 0;
			for (let row = 0; row < cells.length; row++) {
				const cell = must(cells[row], "Zelle fehlt");
				assert.equal(cell.x, first.x, `x in Spalte: ${label(testCase)}`);
				assert.equal(cell.width, first.width, `Breite in Spalte: ${label(testCase)}`);
				heightSum += cell.height;
				if (row > 0) {
					const before = must(cells[row - 1], "Vorgänger fehlt");
					const gap = cell.y - (before.y + before.height);
					assert.ok(gap >= 0 && gap <= testCase.gapInner, `Zeilenabstand: ${label(testCase)}`);
					rowGapSum += gap;
				}
			}
			assert.equal(heightSum + rowGapSum, inner.height, `Höhenzerlegung: ${label(testCase)}`);
			if (column > 0) {
				const previous = must(columns[column - 1], "Vorgängerspalte fehlt");
				const previousFirst = must(previous[0], "Vorgängerspalte leer");
				const gap = first.x - (previousFirst.x + previousFirst.width);
				assert.ok(gap >= 0 && gap <= testCase.gapInner, `Spaltenabstand: ${label(testCase)}`);
				columnGapSum += gap;
			}
		}
		assert.equal(widthSum + columnGapSum, inner.width, `Breitenzerlegung: ${label(testCase)}`);

		const baseRows = Math.floor(testCase.count / wantedColumns);
		const extras = testCase.count % wantedColumns;
		for (let column = 0; column < columns.length; column++) {
			const expectedRows = baseRows + (column >= wantedColumns - extras ? 1 : 0);
			assert.equal(must(columns[column], "Spalte fehlt").length, expectedRows, label(testCase));
		}
	}
});
