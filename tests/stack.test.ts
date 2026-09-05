import assert from "node:assert/strict";
import { test } from "node:test";

import { LAYOUTS, RATIO_DEFAULT, RATIO_MAX, RATIO_MIN } from "../src/core/layout/index.ts";
import type { SurfaceState, WindowId } from "../src/core/stack.ts";
import {
	createSurface,
	currentLayout,
	focusMaster,
	focusNext,
	focusPrev,
	growMaster,
	insert,
	nextLayout,
	promote,
	remove,
	resetLayout,
	setFocus,
	shrinkMaster,
	swapNext,
	swapPrev,
} from "../src/core/stack.ts";

function surface(order: WindowId[], focus: WindowId | null): SurfaceState {
	return { order: order.slice(), focus, layoutIndex: 0, masterRatio: RATIO_DEFAULT };
}

test("createSurface liefert eine leere Surface mit Vorgabewerten", () => {
	const state = createSurface();
	assert.deepEqual(state.order, []);
	assert.equal(state.focus, null);
	assert.equal(state.layoutIndex, 0);
	assert.equal(state.masterRatio, RATIO_DEFAULT);
	assert.equal(currentLayout(state).id, "tall");
});

// --- Fokus ------------------------------------------------------------------

test("Fokus laeuft zyklisch vor und zurueck", () => {
	const state = surface(["a", "b", "c"], "a");
	assert.equal(focusNext(state).focus, "b");
	assert.equal(focusNext(focusNext(state)).focus, "c");
	assert.equal(focusNext(focusNext(focusNext(state))).focus, "a");
	assert.equal(focusPrev(state).focus, "c");
});

test("Fokus laeuft ueber alle Mitglieder, nicht nur ueber Layout-Teilnehmer", () => {
	// Floatende und minimierte Fenster stehen mit in `order` (PLAN.md 4 und 7).
	const state = surface(["a", "float", "c"], "a");
	assert.equal(focusNext(state).focus, "float");
});

test("Fokus ohne Vorgabe faengt vorne an, leere Surface bleibt unveraendert", () => {
	assert.equal(focusNext(surface(["a", "b"], null)).focus, "a");
	assert.equal(focusPrev(surface(["a", "b"], null)).focus, "a");
	const empty = surface([], null);
	assert.equal(focusNext(empty), empty);
	assert.equal(focusMaster(empty), empty);
});

test("focusMaster springt auf Position 0", () => {
	const state = surface(["a", "b", "c"], "c");
	const once = focusMaster(state);
	assert.equal(once.focus, "a");
	assert.equal(focusMaster(once), once, "zweiter Aufruf ist wirkungslos");
});

test("setFocus nimmt nur Mitglieder und loescht mit null", () => {
	const state = surface(["a", "b"], "a");
	assert.equal(setFocus(state, "b").focus, "b");
	assert.equal(setFocus(state, "fremd"), state);
	assert.equal(setFocus(state, null).focus, null);
});

// --- Reihenfolge ------------------------------------------------------------

test("Swap tauscht mit dem Nachbarn, der Fokus bleibt am Fenster", () => {
	const state = surface(["a", "b", "c"], "b");
	const next = swapNext(state);
	assert.deepEqual(next.order, ["a", "c", "b"]);
	assert.equal(next.focus, "b");
	const prev = swapPrev(state);
	assert.deepEqual(prev.order, ["b", "a", "c"]);
	assert.equal(prev.focus, "b");
});

test("Swap laeuft am Rand zyklisch um", () => {
	assert.deepEqual(swapNext(surface(["a", "b", "c"], "c")).order, ["c", "b", "a"]);
	assert.deepEqual(swapPrev(surface(["a", "b", "c"], "a")).order, ["c", "b", "a"]);
});

test("Swap ohne Fokus oder mit einem Fenster bleibt wirkungslos", () => {
	const single = surface(["a"], "a");
	assert.equal(swapNext(single), single);
	const unfocused = surface(["a", "b"], null);
	assert.equal(swapNext(unfocused), unfocused);
});

test("Promote holt das fokussierte Fenster nach vorne, der Rest behaelt die Reihenfolge", () => {
	// XMonads swapMaster: kein Tausch mit dem alten Master.
	const next = promote(surface(["a", "b", "c", "d"], "c"));
	assert.deepEqual(next.order, ["c", "a", "b", "d"]);
	assert.equal(next.focus, "c");
});

test("Promote am Master und ohne Fokus bleibt wirkungslos", () => {
	const master = surface(["a", "b"], "a");
	assert.equal(promote(master), master);
	const unfocused = surface(["a", "b"], null);
	assert.equal(promote(unfocused), unfocused);
});

test("Insert setzt das neue Fenster oberhalb des fokussierten", () => {
	// XMonads insertUp: das neue Fenster nimmt den Platz ein, der Rest rutscht.
	const next = insert(surface(["a", "b", "c"], "b"), "neu");
	assert.deepEqual(next.order, ["a", "neu", "b", "c"]);
	assert.equal(next.focus, "neu");
});

test("Insert ohne Fokus und in eine leere Surface legt vorne an", () => {
	assert.deepEqual(insert(surface(["a"], null), "neu").order, ["neu", "a"]);
	assert.deepEqual(insert(createSurface(), "neu").order, ["neu"]);
});

test("Insert eines bekannten Fensters bleibt wirkungslos", () => {
	const state = surface(["a", "b"], "a");
	assert.equal(insert(state, "b"), state);
});

test("Remove setzt den Fokus auf den Nachfolger", () => {
	const next = remove(surface(["a", "b", "c"], "b"), "b");
	assert.deepEqual(next.order, ["a", "c"]);
	assert.equal(next.focus, "c");
});

test("Remove des letzten Fensters faellt auf den Vorgaenger zurueck", () => {
	const next = remove(surface(["a", "b", "c"], "c"), "c");
	assert.deepEqual(next.order, ["a", "b"]);
	assert.equal(next.focus, "b");
	assert.equal(remove(surface(["a"], "a"), "a").focus, null);
});

test("Remove eines unbeteiligten Fensters laesst den Fokus stehen", () => {
	const state = surface(["a", "b", "c"], "a");
	assert.equal(remove(state, "b").focus, "a");
	assert.equal(remove(state, "fremd"), state);
});

// --- Layout und Masteranteil ------------------------------------------------

test("nextLayout zykliert ueber die Layoutliste", () => {
	let state = createSurface();
	for (let i = 1; i <= LAYOUTS.length; i++) {
		state = nextLayout(state);
		assert.equal(state.layoutIndex, i % LAYOUTS.length);
	}
	assert.equal(state.layoutIndex, 0);
});

test("resetLayout setzt Index und Verhaeltnis zurueck", () => {
	const changed = growMaster(nextLayout(createSurface()));
	const reset = resetLayout(changed);
	assert.equal(reset.layoutIndex, 0);
	assert.equal(reset.masterRatio, RATIO_DEFAULT);
	assert.equal(resetLayout(reset), reset);
});

test("Masteranteil bleibt auf zwei Nachkommastellen", () => {
	// 0.65 + 0.05 waere ohne Rundung 0.7000000000000001.
	assert.equal(growMaster(createSurface()).masterRatio, 0.7);
	assert.equal(shrinkMaster(createSurface()).masterRatio, 0.6);
	let state = createSurface();
	for (let i = 0; i < 3; i++) {
		state = growMaster(state);
	}
	assert.equal(state.masterRatio, 0.8);
});

test("Masteranteil bleibt in den Grenzen und haelt dort an", () => {
	let state = createSurface();
	for (let i = 0; i < 20; i++) {
		state = growMaster(state);
	}
	assert.equal(state.masterRatio, RATIO_MAX);
	assert.equal(growMaster(state), state);
	for (let i = 0; i < 40; i++) {
		state = shrinkMaster(state);
	}
	assert.equal(state.masterRatio, RATIO_MIN);
	assert.equal(shrinkMaster(state), state);
});

// --- Konvention -------------------------------------------------------------

test("kein Reducer aendert den Eingabezustand", () => {
	const reducers: [string, (s: SurfaceState) => SurfaceState][] = [
		["focusNext", focusNext],
		["focusPrev", focusPrev],
		["focusMaster", focusMaster],
		["swapNext", swapNext],
		["swapPrev", swapPrev],
		["promote", promote],
		["insert", (s) => insert(s, "neu")],
		["remove", (s) => remove(s, "b")],
		["setFocus", (s) => setFocus(s, "c")],
		["nextLayout", nextLayout],
		["resetLayout", resetLayout],
		["growMaster", growMaster],
		["shrinkMaster", shrinkMaster],
	];

	for (const entry of reducers) {
		const name = entry[0];
		const reducer = entry[1];
		const state = surface(["a", "b", "c"], "b");
		const order = state.order;
		const result = reducer(state);
		assert.deepEqual(order, ["a", "b", "c"], `${name} hat die Reihenfolge veraendert`);
		assert.equal(state.focus, "b", `${name} hat den Fokus veraendert`);
		assert.equal(state.masterRatio, RATIO_DEFAULT, `${name} hat das Verhaeltnis veraendert`);
		assert.equal(state.layoutIndex, 0, `${name} hat den Layoutindex veraendert`);
		if (result !== state) {
			assert.notEqual(result.order, order, `${name} teilt das Reihenfolge-Array`);
		}
	}
});
