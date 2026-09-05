import assert from "node:assert/strict";
import { test } from "node:test";

import type { Rect } from "../src/core/rect.ts";
import { UNLIMITED_SIZE } from "../src/kwin/filter.ts";
import { fitToCell, judgeCorrection, judgeWrite, MAX_CORRECTIONS } from "../src/kwin/geometry.ts";
import type { WindowState } from "../src/state/registry.ts";
import { createWindowState } from "../src/state/registry.ts";
import { AREA, windowInfo } from "./support/kwinfake.ts";

const CELL: Rect = { x: 0, y: 0, width: 1664, height: 1410 };

function expecting(rect: Rect, generation: number, attempts: number): WindowState {
	const state = createWindowState();
	state.expectedRect = rect;
	state.applyGeneration = generation;
	state.applyAttempts = attempts;
	return state;
}

// --- fitToCell --------------------------------------------------------------

test("fitToCell laesst eine passende Zelle unveraendert", () => {
	assert.deepEqual(fitToCell(CELL, windowInfo("a"), AREA), CELL);
});

test("fitToCell haelt die Mindestbreite ein", () => {
	const info = windowInfo("a");
	info.minWidth = 900;
	const schmal: Rect = { x: 1664, y: 0, width: 896, height: 1410 };
	const fit = fitToCell(schmal, info, AREA);
	assert.equal(fit.width, 900);
	// Rechts ist kein Platz mehr, also wandert das Fenster nach links.
	assert.equal(fit.x, 1660);
	assert.equal(fit.x + fit.width, AREA.x + AREA.width, "bleibt in der Arbeitsflaeche");
});

test("fitToCell haelt die Mindesthoehe ein", () => {
	const info = windowInfo("a");
	info.minHeight = 800;
	const flach: Rect = { x: 1664, y: 705, width: 896, height: 705 };
	const fit = fitToCell(flach, info, AREA);
	assert.equal(fit.height, 800);
	assert.equal(fit.y, 610);
});

test("fitToCell achtet die Hoechstgroesse", () => {
	const info = windowInfo("a");
	info.maxWidth = 1000;
	assert.equal(fitToCell(CELL, info, AREA).width, 1000);
});

test("fitToCell ignoriert die Hoechstgroesse 2147483647", () => {
	const info = windowInfo("a");
	info.maxWidth = UNLIMITED_SIZE;
	info.maxHeight = UNLIMITED_SIZE;
	assert.deepEqual(fitToCell(CELL, info, AREA), CELL);
});

test("fitToCell verankert lieber links als unter die Mindestgroesse zu gehen", () => {
	const info = windowInfo("a");
	info.minWidth = 4000;
	const fit = fitToCell(CELL, info, AREA);
	assert.equal(fit.width, 4000, "die Mindestbreite gewinnt");
	assert.equal(fit.x, AREA.x, "die linke obere Ecke bleibt in der Flaeche");
});

// --- judgeWrite -------------------------------------------------------------

test("judgeWrite meldet write bei einer Abweichung", () => {
	assert.equal(judgeWrite(windowInfo("a"), CELL), "write");
});

test("judgeWrite meldet unchanged bei genauer Uebereinstimmung", () => {
	// Das ist die eigentliche Flatterbremse: keine Aenderung, kein Schreiben,
	// also auch kein frameGeometryChanged und keine Rueckkopplung.
	const info = windowInfo("a");
	info.frameGeometry = { x: 0, y: 0, width: 1664, height: 1410 };
	assert.equal(judgeWrite(info, CELL), "unchanged");
});

test("judgeWrite meldet drag waehrend move oder resize", () => {
	const zieht = windowInfo("a");
	zieht.move = true;
	assert.equal(judgeWrite(zieht, CELL), "drag");

	const groesst = windowInfo("b");
	groesst.resize = true;
	assert.equal(judgeWrite(groesst, CELL), "drag");
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

// --- judgeCorrection --------------------------------------------------------

test("judgeCorrection meldet ignore ohne Erwartung", () => {
	assert.equal(judgeCorrection(createWindowState(), 1, CELL), "ignore");
});

test("judgeCorrection meldet stale fuer eine andere Generation", () => {
	// Auf Wayland kann eine Bestaetigung beliebig spaet zurueckkommen.
	const state = expecting(CELL, 3, 0);
	assert.equal(judgeCorrection(state, 4, { x: 9, y: 9, width: 9, height: 9 }), "stale");
});

test("judgeCorrection meldet settled bei Uebereinstimmung", () => {
	const state = expecting(CELL, 3, 0);
	assert.equal(judgeCorrection(state, 3, { x: 0, y: 0, width: 1664, height: 1410 }), "settled");
});

test("judgeCorrection meldet retry bei Abweichung", () => {
	const state = expecting(CELL, 3, 0);
	assert.equal(judgeCorrection(state, 3, { x: 0, y: 0, width: 1660, height: 1410 }), "retry");
});

test("judgeCorrection gibt nach zwei Nachbesserungen auf", () => {
	const abweichung: Rect = { x: 0, y: 0, width: 1660, height: 1410 };
	for (let attempts = 0; attempts < MAX_CORRECTIONS; attempts++) {
		assert.equal(judgeCorrection(expecting(CELL, 3, attempts), 3, abweichung), "retry");
	}
	assert.equal(judgeCorrection(expecting(CELL, 3, MAX_CORRECTIONS), 3, abweichung), "giveup");
});

test("eine angekommene Geometrie beruhigt auch nach ausgeschoepften Versuchen", () => {
	const state = expecting(CELL, 3, MAX_CORRECTIONS);
	assert.equal(judgeCorrection(state, 3, { x: 0, y: 0, width: 1664, height: 1410 }), "settled");
});
