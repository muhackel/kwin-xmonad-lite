import assert from "node:assert/strict";
import { test } from "node:test";

import type { Rect } from "../src/core/rect.ts";
import { UNLIMITED_SIZE } from "../src/kwin/filter.ts";
import {
	anchorInto,
	fitToCell,
	judgeRecheck,
	judgeSignal,
	judgeWrite,
	MAX_CORRECTIONS,
} from "../src/kwin/geometry.ts";
import type { WindowState } from "../src/state/registry.ts";
import { createWindowState } from "../src/state/registry.ts";
import { AREA, windowInfo } from "./support/kwinfake.ts";

const CELL: Rect = { x: 0, y: 0, width: 1664, height: 1410 };
const AREA_B: Rect = { x: 2560, y: 0, width: 2560, height: 1410 };

function expecting(rect: Rect, generation: number, attempts: number): WindowState {
	const state = createWindowState();
	state.expectedRect = rect;
	state.writeGeneration = generation;
	state.applyAttempts = attempts;
	return state;
}

// --- fitToCell --------------------------------------------------------------

test("fitToCell lässt eine passende Zelle unverändert", () => {
	assert.deepEqual(fitToCell(CELL, windowInfo("a"), AREA), CELL);
});

test("fitToCell hält die Mindestbreite ein", () => {
	const info = windowInfo("a");
	info.minWidth = 900;
	const schmal: Rect = { x: 1664, y: 0, width: 896, height: 1410 };
	const fit = fitToCell(schmal, info, AREA);
	assert.equal(fit.width, 900);
	// Rechts ist kein Platz mehr, also wandert das Fenster nach links.
	assert.equal(fit.x, 1660);
	assert.equal(fit.x + fit.width, AREA.x + AREA.width, "bleibt in der Arbeitsfläche");
});

test("fitToCell hält die Mindesthöhe ein", () => {
	const info = windowInfo("a");
	info.minHeight = 800;
	const flach: Rect = { x: 1664, y: 705, width: 896, height: 705 };
	const fit = fitToCell(flach, info, AREA);
	assert.equal(fit.height, 800);
	assert.equal(fit.y, 610);
});

test("fitToCell lässt eine Mindesthöhe über die Arbeitsfläche hinausragen", () => {
	const info = windowInfo("a");
	info.minHeight = 2000;
	const fit = fitToCell(CELL, info, AREA);
	assert.equal(fit.height, 2000, "die Mindesthöhe gewinnt");
	assert.equal(fit.y, AREA.y, "die obere Kante bleibt in der Fläche");
});

test("fitToCell achtet die Höchstgröße", () => {
	const info = windowInfo("a");
	info.maxWidth = 1000;
	assert.deepEqual(fitToCell(CELL, info, AREA), { x: 0, y: 0, width: 1000, height: 1410 });
});

test("fitToCell klemmt beide Achsen an die Höchstgröße", () => {
	const info = windowInfo("a");
	info.maxWidth = 700;
	info.maxHeight = 400;
	assert.deepEqual(fitToCell(CELL, info, AREA), { x: 0, y: 0, width: 700, height: 400 });
});

test("fitToCell beschränkt nur die Höhe, wenn die Breite unbegrenzt ist", () => {
	const info = windowInfo("a");
	info.maxHeight = 400;
	assert.deepEqual(fitToCell(CELL, info, AREA), { x: 0, y: 0, width: 1664, height: 400 });
});

test("fitToCell ignoriert die Höchstgröße 2147483647", () => {
	const info = windowInfo("a");
	info.maxWidth = UNLIMITED_SIZE;
	info.maxHeight = UNLIMITED_SIZE;
	assert.deepEqual(fitToCell(CELL, info, AREA), CELL);
});

test("fitToCell verankert lieber links als unter die Mindestgröße zu gehen", () => {
	const info = windowInfo("a");
	info.minWidth = 4000;
	const fit = fitToCell(CELL, info, AREA);
	assert.equal(fit.width, 4000, "die Mindestbreite gewinnt");
	assert.equal(fit.x, AREA.x, "die linke obere Ecke bleibt in der Fläche");
});

test("fitToCell ist idempotent", () => {
	const info = windowInfo("a");
	info.minWidth = 1000;
	info.maxHeight = 400;
	const cell: Rect = { x: 1664, y: 705, width: 896, height: 705 };
	const einmal = fitToCell(cell, info, AREA);
	assert.deepEqual(fitToCell(einmal, info, AREA), einmal);
});

test("anchorInto verankert an einer versetzten Arbeitsfläche", () => {
	const rechtsUnten: Rect = { x: 5000, y: 1300, width: 400, height: 300 };
	assert.deepEqual(anchorInto(rechtsUnten, AREA_B), {
		x: 4720,
		y: 1110,
		width: 400,
		height: 300,
	});
	const linksOben: Rect = { x: 2000, y: -100, width: 400, height: 300 };
	assert.deepEqual(anchorInto(linksOben, AREA_B), { x: 2560, y: 0, width: 400, height: 300 });
});

test("anchorInto lässt Größe und ein passendes Rechteck unverändert", () => {
	const rect: Rect = { x: 3000, y: 100, width: 800, height: 600 };
	assert.deepEqual(anchorInto(rect, AREA_B), rect);
});

// --- judgeWrite -------------------------------------------------------------

test("judgeWrite meldet write bei einer Abweichung", () => {
	assert.equal(judgeWrite(windowInfo("a"), CELL), "write");
});

test("judgeWrite meldet unchanged bei genauer Übereinstimmung", () => {
	// Das ist die eigentliche Flatterbremse: keine Änderung, kein Schreiben,
	// also auch kein frameGeometryChanged und keine Rückkopplung.
	const info = windowInfo("a");
	info.frameGeometry = { x: 0, y: 0, width: 1664, height: 1410 };
	assert.equal(judgeWrite(info, CELL), "unchanged");
});

test("judgeWrite meldet drag während move oder resize", () => {
	const zieht = windowInfo("a");
	zieht.move = true;
	assert.equal(judgeWrite(zieht, CELL), "drag");

	const größt = windowInfo("b");
	größt.resize = true;
	assert.equal(judgeWrite(größt, CELL), "drag");
});

test("judgeWrite meldet maximized bei maximizeMode ungleich null", () => {
	const info = windowInfo("a");
	info.maximizeMode = 3;
	assert.equal(judgeWrite(info, CELL), "maximized");
});

test("der Ziehzustand gewinnt gegen die Maximierung", () => {
	const info = windowInfo("a");
	info.move = true;
	info.maximizeMode = 3;
	assert.equal(judgeWrite(info, CELL), "drag");
});

// --- judgeSignal ------------------------------------------------------------

test("judgeSignal meldet ignore ohne Erwartung", () => {
	assert.equal(judgeSignal(createWindowState(), CELL), "ignore");
});

test("judgeSignal meldet settled bei Übereinstimmung", () => {
	const state = expecting(CELL, 3, 0);
	assert.equal(judgeSignal(state, { x: 0, y: 0, width: 1664, height: 1410 }), "settled");
});

test("judgeSignal meldet diverged bei Abweichung, nie retry", () => {
	// Ein KWin-Signal trägt keine Schreibgeneration, und der Signalpfad
	// schreibt nie: er kann nur eine Nachprüfung einplanen.
	const state = expecting(CELL, 3, MAX_CORRECTIONS);
	assert.equal(judgeSignal(state, { x: 0, y: 0, width: 1660, height: 1410 }), "diverged");
});

// --- judgeRecheck -----------------------------------------------------------

test("judgeRecheck meldet ignore ohne Erwartung", () => {
	assert.equal(judgeRecheck(createWindowState(), 1, CELL), "ignore");
});

test("judgeRecheck meldet stale für eine ältere Schreibgeneration", () => {
	// Der Eintrag wurde für Generation 3 eingeplant, inzwischen läuft 4:
	// ein neuerer Write besitzt die Erwartung.
	const state = expecting(CELL, 4, 0);
	assert.equal(judgeRecheck(state, 3, { x: 9, y: 9, width: 9, height: 9 }), "stale");
});

test("judgeRecheck meldet settled bei Übereinstimmung", () => {
	const state = expecting(CELL, 3, 0);
	assert.equal(judgeRecheck(state, 3, { x: 0, y: 0, width: 1664, height: 1410 }), "settled");
});

test("judgeRecheck meldet retry bei Abweichung", () => {
	const state = expecting(CELL, 3, 0);
	assert.equal(judgeRecheck(state, 3, { x: 0, y: 0, width: 1660, height: 1410 }), "retry");
});

test("judgeRecheck gibt nach zwei Nachbesserungen auf", () => {
	const abweichung: Rect = { x: 0, y: 0, width: 1660, height: 1410 };
	for (let attempts = 0; attempts < MAX_CORRECTIONS; attempts++) {
		assert.equal(judgeRecheck(expecting(CELL, 3, attempts), 3, abweichung), "retry");
	}
	assert.equal(judgeRecheck(expecting(CELL, 3, MAX_CORRECTIONS), 3, abweichung), "giveup");
});

test("eine angekommene Geometrie beruhigt auch nach ausgeschöpften Versuchen", () => {
	const state = expecting(CELL, 3, MAX_CORRECTIONS);
	assert.equal(judgeRecheck(state, 3, { x: 0, y: 0, width: 1664, height: 1410 }), "settled");
});
