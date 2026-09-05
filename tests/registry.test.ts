import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rect } from "../src/core/rect.ts";
import type { SurfaceState, WindowId } from "../src/core/stack.ts";
import { promote } from "../src/core/stack.ts";
import { surfaceKey } from "../src/core/surface.ts";
import {
	clearExpectation,
	createRegistry,
	getSurface,
	getWindow,
	purgeSurfaces,
	purgeWindows,
	putSurface,
	setFloating,
} from "../src/state/registry.ts";

const ACTIVITY = "b1f2c3d4-0000-4000-8000-abcdefabcdef";
const LEFT = surfaceKey({ activity: ACTIVITY, desktop: "1", output: "DP-1" });
const RIGHT = surfaceKey({ activity: ACTIVITY, desktop: "1", output: "DP-2" });

const RECT_A: Rect = { x: 10, y: 20, width: 800, height: 600 };
const RECT_B: Rect = { x: 0, y: 0, width: 1280, height: 720 };

/** Belegt eine Surface, ohne den Umweg ueber einzelne Reducer-Aufrufe. */
function withOrder(state: SurfaceState, order: WindowId[], focus: WindowId | null): SurfaceState {
	return {
		order: order.slice(),
		focus,
		layoutIndex: state.layoutIndex,
		masterRatio: state.masterRatio,
	};
}

test("getSurface legt bei Bedarf an und liefert danach dasselbe Objekt", () => {
	const registry = createRegistry();
	const first = getSurface(registry, LEFT);
	assert.deepEqual(first.order, []);
	assert.equal(getSurface(registry, LEFT), first);
	assert.equal(registry.surfaces.size, 1);
});

test("putSurface haengt das Ergebnis eines Reducers ein", () => {
	const registry = createRegistry();
	const state = withOrder(getSurface(registry, LEFT), ["a", "b"], "b");
	putSurface(registry, LEFT, promote(state));
	assert.deepEqual(getSurface(registry, LEFT).order, ["b", "a"]);
});

test("getWindow legt einen Fensterzustand mit Vorgaben an", () => {
	const registry = createRegistry();
	const state = getWindow(registry, "w1");
	assert.equal(state.floating, false);
	assert.equal(state.floatRect, null);
	assert.equal(state.tiledRect, null);
	assert.equal(state.lastObservedRect, null);
	assert.equal(state.expectedRect, null);
	assert.equal(state.applyAttempts, 0);
	assert.equal(state.writeGeneration, 0);
	assert.equal(getWindow(registry, "w1"), state);
});

test("Float merkt sich die Geometrie und loescht die Erwartung", () => {
	const registry = createRegistry();
	const window = getWindow(registry, "w1");
	window.expectedRect = RECT_B;
	window.applyAttempts = 2;

	setFloating(registry, "w1", true, RECT_A);
	assert.equal(window.floating, true);
	assert.deepEqual(window.floatRect, RECT_A);
	assert.equal(window.expectedRect, null);
	assert.equal(window.applyAttempts, 0);
});

test("eine bereits gemerkte Float-Geometrie ueberlebt das naechste Umschalten", () => {
	const registry = createRegistry();
	setFloating(registry, "w1", true, RECT_A);
	setFloating(registry, "w1", false, RECT_B);
	assert.deepEqual(getWindow(registry, "w1").floatRect, RECT_B);

	setFloating(registry, "w1", true, RECT_A);
	assert.deepEqual(getWindow(registry, "w1").floatRect, RECT_B, "die gemerkte gewinnt");
});

test("Float doppelt gesetzt bleibt wirkungslos", () => {
	const registry = createRegistry();
	setFloating(registry, "w1", true, RECT_A);
	setFloating(registry, "w1", true, RECT_B);
	assert.deepEqual(getWindow(registry, "w1").floatRect, RECT_A);
});

test("clearExpectation raeumt Erwartung und Versuchszaehler", () => {
	const registry = createRegistry();
	const window = getWindow(registry, "w1");
	window.expectedRect = RECT_A;
	window.applyAttempts = 2;
	window.lastObservedRect = RECT_B;
	clearExpectation(registry, "w1");
	assert.equal(window.expectedRect, null);
	assert.equal(window.applyAttempts, 0);
	// Der zuletzt beobachtete Istwert bleibt: an ihm erkennt der Signalpfad
	// spaeter den eigenen Nachhall.
	assert.deepEqual(window.lastObservedRect, RECT_B);
	clearExpectation(registry, "unbekannt");
});

test("purgeWindows loescht alles, was nicht in der Ist-Menge steht", () => {
	const registry = createRegistry();
	getWindow(registry, "w1");
	getWindow(registry, "w2");
	getWindow(registry, "w3");
	const removed = purgeWindows(registry, new Set(["w2"]));
	assert.deepEqual(removed.slice().sort(), ["w1", "w3"]);
	assert.deepEqual(Array.from(registry.windows.keys()), ["w2"]);
});

test("purgeSurfaces entfernt verschwundene Activities und Desktops", () => {
	const registry = createRegistry();
	getSurface(registry, LEFT);
	getSurface(registry, surfaceKey({ activity: ACTIVITY, desktop: "9", output: "DP-1" }));
	getSurface(registry, surfaceKey({ activity: "weg", desktop: "1", output: "DP-1" }));
	registry.surfaces.set("kaputt", getSurface(registry, LEFT));

	const removed = purgeSurfaces(registry, new Set([ACTIVITY]), new Set(["1"]));
	assert.equal(removed.length, 3);
	assert.deepEqual(Array.from(registry.surfaces.keys()), [LEFT]);
});

test("der Zustand eines abgesteckten Bildschirms ueberlebt die Bereinigung", () => {
	const registry = createRegistry();
	getSurface(registry, LEFT);
	getSurface(registry, RIGHT);
	// DP-2 ist abgesteckt, kommt in keiner Ausgabenliste mehr vor.
	purgeSurfaces(registry, new Set([ACTIVITY]), new Set(["1"]));
	assert.equal(registry.surfaces.has(RIGHT), true);
});

test("Sticky: dasselbe Fenster steht unabhaengig in zwei Surfaces", () => {
	const registry = createRegistry();
	putSurface(registry, LEFT, withOrder(getSurface(registry, LEFT), ["a", "sticky"], "sticky"));
	putSurface(registry, RIGHT, withOrder(getSurface(registry, RIGHT), ["sticky", "b"], "sticky"));

	putSurface(registry, LEFT, promote(getSurface(registry, LEFT)));
	assert.deepEqual(getSurface(registry, LEFT).order, ["sticky", "a"]);
	assert.deepEqual(getSurface(registry, RIGHT).order, ["sticky", "b"], "andere Surface unberuehrt");
});
