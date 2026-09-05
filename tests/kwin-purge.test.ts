import assert from "node:assert/strict";
import { test } from "node:test";

import { surfaceKey } from "../src/core/surface.ts";
import { purgeFromSnapshot } from "../src/kwin/purge.ts";
import type { Snapshot } from "../src/kwin/types.ts";
import { createRegistry, getSurface, getWindow } from "../src/state/registry.ts";
import {
	ACTIVITY,
	DESKTOP,
	OUTPUT,
	singleView,
	snapshotOf,
	view,
	windowInfo,
} from "./support/kwinfake.ts";

const ANDERE_ACTIVITY = "0f7c8f0e-3c1a-4f2b-9a4d-1d0f5b6c7e80";
const ANDERER_DESKTOP = "b7798180-564c-4f75-ad4a-284026ac7a68";
const ANDERE_AUSGABE = "DP-9";

const AREA = singleView().area;

/** Ein Lesedurchgang ohne Fenster, mit den angegebenen Ist-Mengen. */
function leer(activities: string[], desktops: string[]): Snapshot {
	return snapshotOf([singleView()], [], null, activities, desktops);
}

test("eine verschwundene Activity nimmt ihre Surface mit", () => {
	const registry = createRegistry();
	const fremd = surfaceKey({ activity: ANDERE_ACTIVITY, desktop: DESKTOP, output: OUTPUT });
	getSurface(registry, singleView().key);
	getSurface(registry, fremd);

	const result = purgeFromSnapshot(registry, leer([ACTIVITY], [DESKTOP]));

	assert.deepEqual(result.surfaces, [fremd]);
	assert.equal(registry.surfaces.has(singleView().key), true);
	assert.equal(registry.surfaces.has(fremd), false);
});

test("ein verschwundener Desktop nimmt seine Surface mit", () => {
	const registry = createRegistry();
	const fremd = surfaceKey({ activity: ACTIVITY, desktop: ANDERER_DESKTOP, output: OUTPUT });
	getSurface(registry, singleView().key);
	getSurface(registry, fremd);

	const result = purgeFromSnapshot(registry, leer([ACTIVITY], [DESKTOP]));

	assert.deepEqual(result.surfaces, [fremd]);
});

test("eine abgesteckte Ausgabe behaelt ihren Zustand", () => {
	// Testmatrix 9: der Zustand ueberlebt am Ausgabenamen bis zum
	// Sitzungsende, damit ein erneutes Anstecken ihn wiederherstellt.
	const registry = createRegistry();
	const fort = surfaceKey({ activity: ACTIVITY, desktop: DESKTOP, output: ANDERE_AUSGABE });
	const state = getSurface(registry, fort);
	state.order.push("a");

	const result = purgeFromSnapshot(registry, leer([ACTIVITY], [DESKTOP]));

	assert.deepEqual(result.surfaces, []);
	assert.equal(registry.surfaces.has(fort), true);
});

test("ein verschwundenes Fenster nimmt seinen Zustand mit", () => {
	const registry = createRegistry();
	getWindow(registry, "a");
	getWindow(registry, "b");

	const snapshot = snapshotOf([singleView()], [windowInfo("a")], "a");
	const result = purgeFromSnapshot(registry, snapshot);

	assert.deepEqual(result.windows, ["b"]);
	assert.equal(registry.windows.has("a"), true);
	assert.equal(registry.windows.has("b"), false);
});

test("die Snapshot-Listen wirken als Mengen, nicht als Zeichenketten", () => {
	// Wuerde ein Array unbesehen an `purgeSurfaces` durchgereicht, waere dort
	// nichts gueltig und jede Surface flooege raus. Der Test faellt genau
	// darauf herein, wenn die Umwandlung in Set<string> fehlt.
	const registry = createRegistry();
	getSurface(registry, singleView().key);
	const zweite = surfaceKey({ activity: ACTIVITY, desktop: ANDERER_DESKTOP, output: OUTPUT });
	getSurface(registry, zweite);

	const result = purgeFromSnapshot(registry, leer([ACTIVITY], [DESKTOP, ANDERER_DESKTOP]));

	assert.deepEqual(result.surfaces, []);
	assert.equal(registry.surfaces.size, 2);
});

test("ein Snapshot ohne Activities oder Desktops loescht nichts", () => {
	// KWin hat immer mindestens eine Activity und einen Desktop; eine leere
	// Menge ist ein misslungener Lesedurchgang und kein Loeschauftrag.
	const registry = createRegistry();
	getSurface(registry, singleView().key);
	getWindow(registry, "a");

	const result = purgeFromSnapshot(registry, leer([], []));

	assert.equal(result.skippedSurfaces, true);
	assert.deepEqual(result.surfaces, []);
	assert.equal(registry.surfaces.size, 1);
	// Der Fensterteil laeuft trotzdem: er haengt nicht an diesen Listen.
	assert.deepEqual(result.windows, ["a"]);
});

test("eine leere Desktopliste allein genuegt schon zum Ueberspringen", () => {
	const registry = createRegistry();
	getSurface(registry, view(OUTPUT, ANDERER_DESKTOP, ACTIVITY, AREA).key);

	const result = purgeFromSnapshot(registry, leer([ACTIVITY], []));

	assert.equal(result.skippedSurfaces, true);
	assert.equal(registry.surfaces.size, 1);
});
