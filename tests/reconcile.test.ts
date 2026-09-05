import assert from "node:assert/strict";
import { test } from "node:test";

import { RATIO_DEFAULT } from "../src/core/layout/index.ts";
import type { SurfaceState, WindowId } from "../src/core/stack.ts";
import { reconcile } from "../src/state/reconcile.ts";
import { makeRng } from "./support/gen.ts";

function surface(order: WindowId[], focus: WindowId | null): SurfaceState {
	return { order: order.slice(), focus, layoutIndex: 0, masterRatio: RATIO_DEFAULT };
}

test("Reconcile fuegt neue Fenster oberhalb des fokussierten ein", () => {
	const result = reconcile(surface(["a", "b"], "b"), ["a", "b", "neu"], null);
	assert.deepEqual(result.state.order, ["a", "neu", "b"]);
	assert.deepEqual(result.added, ["neu"]);
	assert.deepEqual(result.removed, []);
});

test("Reconcile entfernt verschwundene Fenster (Purge)", () => {
	const result = reconcile(surface(["a", "b", "c"], "a"), ["a", "c"], null);
	assert.deepEqual(result.state.order, ["a", "c"]);
	assert.deepEqual(result.removed, ["b"]);
	assert.deepEqual(result.added, []);
});

test("Reconcile faengt den Fokus auf, wenn das fokussierte Fenster verschwindet", () => {
	const result = reconcile(surface(["a", "b", "c"], "b"), ["a", "c"], null);
	assert.equal(result.state.focus, "c");
});

test("Reconcile toleriert Doppelte in der Mitgliederliste", () => {
	const result = reconcile(surface([], null), ["a", "b", "a", "b"], null);
	assert.deepEqual(result.state.order.slice().sort(), ["a", "b"]);
	assert.equal(result.added.length, 2);
});

test("das aktive Fenster gewinnt beim Fokus", () => {
	const result = reconcile(surface(["a", "b", "c"], "a"), ["a", "b", "c"], "c");
	assert.equal(result.state.focus, "c");
});

test("ein aktives Fenster einer anderen Surface aendert den Fokus nicht", () => {
	const before = surface(["a", "b"], "a");
	const result = reconcile(before, ["a", "b"], "fremd");
	assert.equal(result.state, before, "unveraendert, also dasselbe Objekt");
});

test("neue Fenster stehlen einer inaktiven Surface nicht den Fokus", () => {
	// Sticky-Fenster erscheint in einer Surface, die gerade nicht aktiv ist.
	const result = reconcile(surface(["a", "b"], "b"), ["a", "b", "sticky"], null);
	assert.equal(result.state.focus, "b");
	assert.deepEqual(result.state.order, ["a", "sticky", "b"]);
});

test("die erste Belegung einer leeren Surface bekommt den Fokus", () => {
	const result = reconcile(surface([], null), ["a"], null);
	assert.equal(result.state.focus, "a");
});

test("Reconcile ohne Aenderung liefert denselben Zustand", () => {
	const before = surface(["a", "b"], "a");
	const result = reconcile(before, ["a", "b"], "a");
	assert.equal(result.state, before);
	const again = reconcile(result.state, ["a", "b"], "a");
	assert.equal(again.state, result.state, "idempotent");
});

test("Reconcile haelt seine Invarianten ueber zufaellige Mitgliedermengen", () => {
	const rng = makeRng(20260905);
	const pool = ["a", "b", "c", "d", "e", "f", "g", "h"];
	let state = surface([], null);

	for (let round = 0; round < 2000; round++) {
		const members: WindowId[] = [];
		for (const id of pool) {
			if (rng() < 0.5) {
				members.push(id);
			}
		}
		// Gelegentlich ein Doppelter und ein aktives Fenster von aussen.
		if (members.length > 0 && rng() < 0.2) {
			members.push(members[Math.floor(rng() * members.length)] ?? "a");
		}
		const active = rng() < 0.3 ? (pool[Math.floor(rng() * pool.length)] ?? null) : null;

		const result = reconcile(state, members, active);
		const next = result.state;
		const note = `Runde ${round}, members=${members.join(",")}, active=${active}`;

		const unique = new Set(members);
		assert.equal(next.order.length, unique.size, `Mengengleichheit: ${note}`);
		assert.equal(new Set(next.order).size, next.order.length, `Doppelte: ${note}`);
		for (const id of next.order) {
			assert.ok(unique.has(id), `Fremdling ${id}: ${note}`);
		}
		if (next.focus !== null) {
			assert.ok(next.order.indexOf(next.focus) >= 0, `Fokus ausserhalb: ${note}`);
		} else {
			assert.equal(next.order.length, 0, `Fokus fehlt trotz Mitgliedern: ${note}`);
		}
		assert.equal(
			reconcile(next, members, active).state,
			next,
			`zweiter Durchlauf nicht stabil: ${note}`,
		);
		state = next;
	}
});
