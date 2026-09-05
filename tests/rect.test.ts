import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rect } from "../src/core/rect.ts";
import {
	clampGap,
	contains,
	divideVertical,
	equals,
	overlaps,
	shrink,
	splitWeighted,
} from "../src/core/rect.ts";
import { must } from "./support/props.ts";

const AREA: Rect = { x: 0, y: 0, width: 2560, height: 1440 };

test("equals vergleicht alle vier Werte", () => {
	assert.ok(equals(AREA, { x: 0, y: 0, width: 2560, height: 1440 }));
	assert.ok(!equals(AREA, { x: 1, y: 0, width: 2560, height: 1440 }));
	assert.ok(!equals(AREA, { x: 0, y: 0, width: 2560, height: 1439 }));
});

test("contains akzeptiert Beruehrung, lehnt Ueberstand ab", () => {
	assert.ok(contains(AREA, { x: 0, y: 0, width: 2560, height: 1440 }));
	assert.ok(contains(AREA, { x: 2559, y: 1439, width: 1, height: 1 }));
	assert.ok(!contains(AREA, { x: 2560, y: 0, width: 1, height: 1 }));
	assert.ok(!contains(AREA, { x: -1, y: 0, width: 1, height: 1 }));
});

test("overlaps ignoriert Beruehrung und leere Rechtecke", () => {
	const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
	assert.ok(overlaps(a, { x: 9, y: 9, width: 5, height: 5 }));
	assert.ok(!overlaps(a, { x: 10, y: 0, width: 5, height: 5 }));
	assert.ok(!overlaps(a, { x: 5, y: 5, width: 0, height: 5 }));
});

test("shrink zieht den Abstand allseitig ab", () => {
	assert.deepEqual(shrink(AREA, 10), { x: 10, y: 10, width: 2540, height: 1420 });
	assert.deepEqual(shrink(AREA, 0), AREA);
});

test("shrink klemmt zu grosse und negative Abstaende", () => {
	// 3x3 traegt hoechstens 1 px Rand, sonst bliebe keine Flaeche uebrig.
	assert.deepEqual(shrink({ x: 0, y: 0, width: 3, height: 3 }, 8), {
		x: 1,
		y: 1,
		width: 1,
		height: 1,
	});
	// Der engere der beiden Achsenwerte gewinnt.
	assert.deepEqual(shrink({ x: 0, y: 0, width: 100, height: 5 }, 20), {
		x: 2,
		y: 2,
		width: 96,
		height: 1,
	});
	assert.deepEqual(shrink({ x: 4, y: 4, width: 10, height: 10 }, -5), {
		x: 4,
		y: 4,
		width: 10,
		height: 10,
	});
	assert.deepEqual(shrink({ x: 0, y: 0, width: 0, height: 0 }, 4), {
		x: 0,
		y: 0,
		width: 0,
		height: 0,
	});
});

test("clampGap laesst jeder Zelle mindestens ein Pixel", () => {
	assert.equal(clampGap(8, 1000, 2), 8);
	assert.equal(clampGap(8, 40, 12), 2);
	assert.equal(clampGap(8, 5, 5), 0);
	assert.equal(clampGap(8, 1000, 1), 0);
	assert.equal(clampGap(-3, 1000, 2), 0);
	assert.equal(clampGap(2.7, 1000, 2), 2);
});

test("splitWeighted verteilt den Rest von vorne und trifft die Summe exakt", () => {
	assert.deepEqual(splitWeighted(100, [1, 1, 1], 0), [34, 33, 33]);
	assert.deepEqual(splitWeighted(99, [1, 1, 1], 0), [33, 33, 33]);
	assert.deepEqual(splitWeighted(10, [3, 1], 0), [7, 3]);
	assert.deepEqual(splitWeighted(1440, [1, 1], 0), [720, 720]);
});

test("splitWeighted rechnet den Abstand vorher heraus", () => {
	const sizes = splitWeighted(100, [1, 1, 1], 10);
	assert.deepEqual(sizes, [27, 27, 26]);
	let sum = 0;
	for (let i = 0; i < sizes.length; i++) {
		sum += sizes[i] ?? 0;
	}
	assert.equal(sum + 2 * 10, 100);
});

test("splitWeighted haelt unbrauchbare Gewichte aus", () => {
	// Alle Gewichte unbrauchbar: Gleichverteilung.
	assert.deepEqual(splitWeighted(90, [0, 0, 0], 0), [30, 30, 30]);
	// Einzelnes unbrauchbares Gewicht zaehlt als 0, die Zelle behaelt ihr Pixel.
	assert.deepEqual(splitWeighted(90, [Number.NaN, 1], 0), [1, 89]);
});

test("splitWeighted kommt mit zu wenig Platz und Randfaellen zurecht", () => {
	assert.deepEqual(splitWeighted(5, [1, 1, 1, 1, 1, 1], 0), [1, 1, 1, 1, 1, 0]);
	assert.deepEqual(splitWeighted(100, [], 0), []);
	assert.deepEqual(splitWeighted(100, [1], 8), [100]);
});

test("divideVertical stapelt lueckenlos und trifft den unteren Rand", () => {
	const rects = divideVertical({ x: 5, y: 7, width: 100, height: 100 }, [1, 1, 1], 10);
	assert.deepEqual(rects, [
		{ x: 5, y: 7, width: 100, height: 27 },
		{ x: 5, y: 44, width: 100, height: 27 },
		{ x: 5, y: 81, width: 100, height: 26 },
	]);
	const last = must(rects[2], "dritte Zelle fehlt");
	assert.equal(last.y + last.height, 107);
});
