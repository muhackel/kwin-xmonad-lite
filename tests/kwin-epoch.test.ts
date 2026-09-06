import assert from "node:assert/strict";
import { test } from "node:test";

import type { Rect } from "../src/core/rect.ts";
import { MAX_CORRECTIONS } from "../src/kwin/geometry.ts";
import type { SurfacePlan } from "../src/kwin/plan.ts";
import { getSurface, getWindow, setFloating } from "../src/state/registry.ts";
import { epochRig } from "./support/epochrig.ts";
import { singleView, windowInfo } from "./support/kwinfake.ts";

const START: Rect = { x: 40, y: 30, width: 800, height: 600 };
const GERASTERT: Rect = { x: 0, y: 0, width: 1660, height: 1400 };

function surface(result: ReturnType<ReturnType<typeof epochRig>["run"]>): SurfacePlan {
	const value = result.plan.surfaces[0];
	if (value === undefined) {
		throw new Error("Surface fehlt");
	}
	return value;
}

function mount(rig: ReturnType<typeof epochRig>, ids: string[]): void {
	for (const id of ids) {
		rig.port.place(id, START);
	}
}

test("Vollbild lässt den Rest nachrücken und kehrt an dieselbe Stelle zurück", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	mount(rig, ["a", "b", "c"]);
	const first = surface(rig.run([a, b, c], "b"));

	b.fullScreen = true;
	b.moveable = false;
	b.resizeable = false;
	const without = surface(rig.run([a, b, c], "b"));
	assert.deepEqual(without.members, ["c", "b", "a"]);
	assert.deepEqual(without.participants, ["c", "a"]);

	b.fullScreen = false;
	b.moveable = true;
	b.resizeable = true;
	const restored = surface(rig.run([a, b, c], "b"));
	assert.deepEqual(restored.members, first.members);
	assert.equal(restored.members.indexOf("b"), 1);
	assert.equal(getSurface(rig.registry, singleView().key).focus, "b");
	assert.deepEqual(restored.placements, first.placements);
});

test("Minimieren und Wiederherstellen bewahrt die Reihenfolge und kommt zur Ruhe", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	mount(rig, ["a", "b", "c"]);
	const first = surface(rig.run([a, b, c], "b"));

	b.minimized = true;
	assert.deepEqual(surface(rig.run([a, b, c], "b")).participants, ["c", "a"]);
	b.minimized = false;
	const restored = surface(rig.run([a, b, c], "b"));
	assert.deepEqual(restored.members, first.members);
	assert.deepEqual(restored.placements, first.placements);

	const writes = rig.port.writes();
	rig.run([a, b, c], "b");
	assert.equal(rig.port.writes(), writes, "der identische Folgelauf schreibt nichts");
});

test("alle drei Maximierungsmodi verlassen das Layout und kehren zurück", () => {
	for (const mode of [1, 2, 3]) {
		const rig = epochRig();
		const a = windowInfo("a");
		const b = windowInfo("b");
		const c = windowInfo("c");
		mount(rig, ["a", "b", "c"]);
		const first = surface(rig.run([a, b, c], "b"));

		b.maximizeMode = mode;
		assert.equal(surface(rig.run([a, b, c], "b")).participants.indexOf("b"), -1, `Modus ${mode}`);
		b.maximizeMode = 0;
		const restored = surface(rig.run([a, b, c], "b"));
		assert.deepEqual(restored.placements, first.placements, `Modus ${mode}`);
	}
});

test("ein Fenster kehrt erst nach dem letzten Ausschlussgrund zurück", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	mount(rig, ["a", "b"]);
	rig.run([a, b], "b");

	b.fullScreen = true;
	b.minimized = true;
	assert.equal(surface(rig.run([a, b], "b")).participants.indexOf("b"), -1);
	b.fullScreen = false;
	assert.equal(surface(rig.run([a, b], "b")).participants.indexOf("b"), -1);
	b.minimized = false;
	assert.equal(surface(rig.run([a, b], "b")).participants.indexOf("b") >= 0, true);
});

test("der Surface-Fokus folgt dem aktiven KWin-Fenster", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	mount(rig, ["a", "b", "c"]);
	rig.run([a, b, c], "b");

	b.fullScreen = true;
	rig.run([a, b, c], "b");
	assert.equal(getSurface(rig.registry, singleView().key).focus, "b");
	rig.run([a, b, c], "c");
	assert.equal(getSurface(rig.registry, singleView().key).focus, "c");
});

test("der Austritt verwirft Erwartung und eingeplante Nachprüfung sofort", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	mount(rig, ["a", "b", "c"]);
	rig.port.setAccept("b", () => GERASTERT);
	rig.run([a, b, c], "b");
	assert.equal(rig.geometry.pendingCount(), 1);
	assert.notEqual(getWindow(rig.registry, "b").expectedRect, null);

	b.fullScreen = true;
	rig.run([a, b, c], "b");
	assert.equal(rig.geometry.pendingCount(), 0);
	assert.equal(getWindow(rig.registry, "b").expectedRect, null);
	const reads = rig.port.reads();
	const writes = rig.port.writes();
	rig.timer.fire();
	assert.equal(rig.port.reads(), reads);
	assert.equal(rig.port.writes(), writes);
});

test("eine identische zweite Epoche schreibt nichts", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	mount(rig, ["a", "b"]);
	rig.run([a, b], "a");
	const writes = rig.port.writes();

	rig.run([a, b], "a");
	assert.equal(rig.port.writes(), writes);
});

test("ein Client mit Größenraster terminiert innerhalb der Korrekturgrenze", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	rig.port.place("a", START);
	rig.port.setAccept("a", () => GERASTERT);
	rig.run([a], "a");

	for (let i = 0; i < MAX_CORRECTIONS + 1; i++) {
		rig.timer.fire();
	}
	assert.equal(rig.port.writesFor("a") <= 1 + MAX_CORRECTIONS, true);
	assert.equal(rig.logs.filter((line) => line.indexOf("aufgegeben a") === 0).length, 1);
	assert.equal(rig.timer.active, false);
	assert.equal(rig.geometry.pendingCount(), 0);
});

test("eine spätere Epoche wiederholt ein bereits aufgegebenes Ziel nicht", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	rig.port.place("a", START);
	rig.port.setAccept("a", () => GERASTERT);
	const first = surface(rig.run([a], "a"));
	const target = first.placements[0]?.rect;
	assert.notEqual(target, undefined);

	for (let i = 0; i < MAX_CORRECTIONS + 1; i++) {
		rig.timer.fire();
	}
	const state = getWindow(rig.registry, "a");
	const writes = rig.port.writesFor("a");
	const giveups = rig.logs.filter((line) => line.indexOf("aufgegeben a") === 0).length;
	assert.deepEqual(state.tiledRect, target, "das aufgegebene Layoutziel bleibt vermerkt");

	rig.run([a], "a");
	assert.equal(rig.port.writesFor("a"), writes);
	assert.equal(rig.geometry.pendingCount(), 0);
	assert.equal(rig.logs.filter((line) => line.indexOf("aufgegeben a") === 0).length, giveups);

	const moved: Rect = { x: 20, y: 30, width: 900, height: 700 };
	rig.port.place("a", moved);
	rig.geometry.notifyChanged("a");
	assert.deepEqual(rig.externals, ["a"]);
	rig.run([a], "a");
	assert.equal(
		rig.port.writesFor("a"),
		writes + 1,
		"eine echte Verschiebung öffnet einen neuen Versuch",
	);
});

test("die Hebeliste wird an den Port übergeben", () => {
	const rig = epochRig();
	rig.config.layoutIndex = 1;
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	mount(rig, ["a", "b", "c"]);
	setFloating(rig.registry, "c", true, null);

	const plan = surface(rig.run([a, b, c], "c"));
	assert.equal(plan.layoutId, "full");
	// Das fokussierte Fenster floatet, ist also kein Teilnehmer: gehoben wird
	// zuerst der Master der Teilnehmer, danach das fokussierte Float-Fenster.
	assert.deepEqual(plan.participants, ["b", "a"]);
	assert.deepEqual(plan.raise, ["b", "c"]);
	assert.deepEqual(rig.raises, ["b", "c"], "die berechnete Liste wird auch vollzogen");
});

test("tall hebt nichts", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	mount(rig, ["a", "b", "c"]);
	setFloating(rig.registry, "c", true, null);

	const plan = surface(rig.run([a, b, c], "c"));
	assert.equal(plan.layoutId, "tall");
	assert.deepEqual(plan.raise, []);
	assert.deepEqual(rig.raises, []);
});

test("ein Fenster ohne Handle löst nach dem Schreibfehler keinen Lesezugriff aus", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const reads = rig.port.reads();
	rig.run([a], "a");

	assert.equal(rig.port.writes(), 0);
	assert.equal(rig.port.reads(), reads + 1, "nur die Momentaufnahme liest");
	const after = rig.port.reads();
	rig.timer.fire();
	assert.equal(rig.port.reads(), after);
	assert.equal(rig.geometry.pendingCount(), 0);
	assert.deepEqual(surface(rig.run([], null)).placements, []);
	assert.deepEqual(getWindow(rig.registry, "a").expectedRect, null);
});
