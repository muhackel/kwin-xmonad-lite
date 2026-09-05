import assert from "node:assert/strict";
import { test } from "node:test";

import type { Rect } from "../src/core/rect.ts";
import type { WindowId } from "../src/core/stack.ts";
import { createGeometryController } from "../src/kwin/apply.ts";
import { MAX_CORRECTIONS } from "../src/kwin/geometry.ts";
import type { Registry } from "../src/state/registry.ts";
import { createRegistry, getWindow } from "../src/state/registry.ts";
import type { FakePort, FakeTimer } from "./support/kwinfake.ts";
import { fakePort, fakeTimer } from "./support/kwinfake.ts";

const START: Rect = { x: 0, y: 0, width: 800, height: 600 };
const TARGET: Rect = { x: 0, y: 0, width: 1664, height: 1410 };
const ANDERS: Rect = { x: 1664, y: 0, width: 896, height: 1410 };
/** Was ein Fenster mit Groessenraster daraus macht. */
const GERASTERT: Rect = { x: 0, y: 0, width: 1660, height: 1410 };

interface Rig {
	registry: Registry;
	port: FakePort;
	timer: FakeTimer;
	extern: WindowId[];
	logs: string[];
	apply(id: WindowId, target: Rect): void;
	notifyChanged(id: WindowId): void;
	forget(id: WindowId): void;
	pendingCount(): number;
}

function rig(): Rig {
	const registry = createRegistry();
	const port = fakePort();
	const timer = fakeTimer();
	const extern: WindowId[] = [];
	const logs: string[] = [];
	const controller = createGeometryController(registry, port, () => timer, {
		external(id: WindowId): void {
			extern.push(id);
		},
		log(message: string): void {
			logs.push(message);
		},
	});
	return {
		registry,
		port,
		timer,
		extern,
		logs,
		apply: controller.apply,
		notifyChanged: controller.notifyChanged,
		forget: controller.forget,
		pendingCount: controller.pendingCount,
	};
}

/** Ein Fenster, das jeden Zielwert brav uebernimmt. */
function braves(r: Rig, id: WindowId): void {
	r.port.place(id, START);
}

/** Ein Fenster mit Groessenraster: es nimmt den Zielwert nie genau an. */
function stures(r: Rig, id: WindowId): void {
	r.port.place(id, START);
	r.port.setAccept(id, () => GERASTERT);
}

// --- Der Gutfall ------------------------------------------------------------

test("ein angenommener Zielwert ist sofort erledigt", () => {
	const r = rig();
	braves(r, "a");
	r.apply("a", TARGET);

	const state = getWindow(r.registry, "a");
	assert.equal(state.expectedRect, null, "keine offene Erwartung");
	assert.deepEqual(state.tiledRect, TARGET);
	assert.deepEqual(state.lastObservedRect, TARGET);
	assert.equal(state.writeGeneration, 1);
	assert.equal(r.port.writes(), 1);
	assert.equal(r.pendingCount(), 0);
	assert.equal(r.timer.active, false, "keine Nachpruefung noetig");
});

test("das eigene synchrone Signal waehrend des Writes wird verworfen", () => {
	// Auf Wayland ist eine reine Verschiebung sofort wirksam:
	// frameGeometryChanged kommt mitten im Schreiben zurueck.
	const r = rig();
	braves(r, "a");
	let rueckstoesse = 0;
	r.port.setOnWrite((id) => {
		rueckstoesse += 1;
		r.notifyChanged(id);
	});

	r.apply("a", TARGET);

	assert.equal(rueckstoesse, 1, "der Rueckstoss ist tatsaechlich gelaufen");
	assert.equal(r.port.writes(), 1, "kein zweiter Write");
	assert.equal(r.pendingCount(), 0);
});

// --- Abweichung, Nachpruefung, Nachbesserung --------------------------------

test("ein abweichendes Ruecklesen plant eine Nachpruefung, schreibt aber nicht", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);

	assert.equal(r.port.writes(), 1, "genau der eine Zielschreibvorgang");
	assert.equal(r.pendingCount(), 1);
	assert.equal(r.timer.active, true);
	assert.deepEqual(getWindow(r.registry, "a").expectedRect, TARGET, "Erwartung bleibt offen");
});

test("eine zeitversetzte Bestaetigung beruhigt ueber den Signalpfad", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);

	// Der Client hat sich anders entschieden und meldet den Zielwert nach.
	r.port.setAccept("a", (rect) => rect);
	r.port.place("a", TARGET);
	r.notifyChanged("a");

	const state = getWindow(r.registry, "a");
	assert.equal(state.expectedRect, null);
	assert.deepEqual(state.lastObservedRect, TARGET);
	assert.equal(r.port.writes(), 1, "der Signalpfad schreibt nie");
});

test("der Signalpfad plant bei Abweichung nur eine Nachpruefung ein", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	const vorher = r.port.writes();

	r.notifyChanged("a");

	assert.equal(r.port.writes(), vorher, "kein Write im Signal-Callback");
	assert.equal(r.pendingCount(), 1);
});

test("nachgebessert wird hoechstens einmal je Fenster und Timerlauf", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	assert.equal(r.port.writesFor("a"), 1);

	r.timer.fire();
	assert.equal(r.port.writesFor("a"), 2, "erster Versuch");
	assert.equal(getWindow(r.registry, "a").applyAttempts, 1);
	assert.equal(r.timer.active, true, "der naechste Lauf ist eingeplant");

	r.timer.fire();
	assert.equal(r.port.writesFor("a"), 3, "zweiter Versuch");
	assert.equal(getWindow(r.registry, "a").applyAttempts, MAX_CORRECTIONS);

	r.timer.fire();
	assert.equal(r.port.writesFor("a"), 3, "danach ist Schluss");
});

test("nach dem Aufgeben sind Erwartung und Nachpruefung leer", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	r.timer.fire();
	r.timer.fire();
	r.timer.fire();

	const state = getWindow(r.registry, "a");
	assert.equal(state.expectedRect, null);
	assert.equal(state.applyAttempts, 0);
	assert.deepEqual(state.lastObservedRect, GERASTERT, "der Istwert gilt als akzeptiert");
	assert.equal(r.pendingCount(), 0);
	assert.equal(r.timer.active, false);
	assert.equal(
		r.logs.filter((line) => line.indexOf("aufgegeben") === 0).length,
		1,
		"genau eine Aufgabe im Journal",
	);
});

test("ein verspaetetes Signal nach dem Aufgeben ist Nachhall, keine fremde Aenderung", () => {
	// Ohne lastObservedRect startete jedes aufgegebene Fenster im naechsten
	// Signal einen neuen Anordnungs- und Nachbesserungszyklus -- genau das
	// Flattern, das der Zaehler verhindern soll.
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	r.timer.fire();
	r.timer.fire();
	r.timer.fire();
	const writes = r.port.writes();

	r.notifyChanged("a");

	assert.deepEqual(r.extern, [], "kein external()");
	assert.equal(r.port.writes(), writes, "kein weiterer Write");
	assert.equal(r.pendingCount(), 0);
	assert.equal(r.timer.active, false, "kein neuer Timer");
});

// --- Generationen -----------------------------------------------------------

test("eine Anordnung ohne eigenen Write entwertet die Erwartung nicht", () => {
	// Die Regressionsprobe auf den Fehler aus Meilenstein 3: dort hing die
	// Generation an der globalen Arrange-Epoche, und schon der naechste Lauf
	// eines beliebigen anderen Fensters machte die Erwartung unerreichbar.
	const r = rig();
	stures(r, "a");
	braves(r, "b");
	r.apply("a", TARGET);

	r.apply("b", ANDERS); // eine spaetere Epoche, ein anderes Fenster

	r.timer.fire();
	assert.equal(r.port.writesFor("a"), 2, "a wird trotzdem nachgebessert");
});

test("ein neuer Zielwert ersetzt die Erwartung und entwertet die alte Nachpruefung", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	assert.equal(r.pendingCount(), 1);

	// Der zweite Zielwert wird angenommen; die alte Nachpruefung steht noch,
	// gehoert aber zur vorigen Schreibgeneration.
	r.port.setAccept("a", (rect) => rect);
	r.apply("a", ANDERS);
	const state = getWindow(r.registry, "a");
	assert.equal(state.writeGeneration, 2);
	assert.equal(state.applyAttempts, 0);
	assert.equal(state.expectedRect, null, "sofort beruhigt");

	const reads = r.port.reads();
	const writes = r.port.writes();
	r.timer.fire();
	assert.equal(r.port.reads(), reads, "der veraltete Eintrag liest nicht einmal");
	assert.equal(r.port.writes(), writes);
});

// --- Verlassen der Layout-Teilnahme ----------------------------------------

for (const grund of ["minimiert", "maximiert", "Vollbild", "floatend"]) {
	test(`${grund}: forget loescht Erwartung und Nachpruefung`, () => {
		const r = rig();
		stures(r, "a");
		r.apply("a", TARGET);
		assert.equal(r.pendingCount(), 1);

		r.forget("a");

		const state = getWindow(r.registry, "a");
		assert.equal(state.expectedRect, null);
		assert.equal(state.applyAttempts, 0);
		assert.equal(r.pendingCount(), 0);

		const reads = r.port.reads();
		const writes = r.port.writes();
		r.timer.fire();
		assert.equal(r.port.reads(), reads, "kein spaeterer Timerlauf liest");
		assert.equal(r.port.writes(), writes, "und schreibt erst recht nicht");
	});
}

// --- Fremde Aenderungen -----------------------------------------------------

test("die eigene, bereits beruhigte Geometrie meldet keine fremde Aenderung", () => {
	const r = rig();
	braves(r, "a");
	r.apply("a", TARGET);

	r.notifyChanged("a");

	assert.deepEqual(r.extern, []);
});

test("eine fremde Verschiebung meldet genau einmal external", () => {
	const r = rig();
	braves(r, "a");
	r.apply("a", TARGET);

	r.port.place("a", ANDERS);
	r.notifyChanged("a");

	assert.deepEqual(r.extern, ["a"]);
	assert.equal(r.port.writes(), 1, "gemeldet, nicht zurueckgeschrieben");
});

test("waehrend eines Ziehens wird nichts gemeldet", () => {
	const r = rig();
	braves(r, "a");
	r.apply("a", TARGET);
	r.port.setDragging("a", true);

	r.port.place("a", ANDERS);
	r.notifyChanged("a");

	assert.deepEqual(r.extern, [], "interactiveMoveResizeFinished ordnet danach an");
});

test("das Signal eines anderen Fensters geht waehrend eines Writes nicht verloren", () => {
	const r = rig();
	braves(r, "a");
	braves(r, "b");
	// b ist bereits gekachelt und wird von aussen verschoben, waehrend an a
	// geschrieben wird.
	r.apply("b", ANDERS);
	r.port.place("b", START);
	r.port.setOnWrite((id) => {
		if (id === "a") {
			r.notifyChanged("b");
		}
	});

	r.apply("a", TARGET);

	assert.deepEqual(r.extern, ["b"]);
});

// --- Tote Fenster -----------------------------------------------------------

test("an einem verschwundenen Fenster wird weder geschrieben noch gelesen", () => {
	const r = rig();
	// Kein place(): das Handle ist fort, bevor der Plan angewandt wird.
	r.apply("a", TARGET);

	assert.equal(r.port.writes(), 0);
	assert.equal(r.port.reads(), 0, "nach einem gescheiterten Write wird nicht gelesen");
	assert.equal(getWindow(r.registry, "a").expectedRect, null);
	assert.equal(r.pendingCount(), 0);
});

test("ein zwischen Write und Nachpruefung geschlossenes Fenster wird vergessen", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	assert.equal(r.pendingCount(), 1);

	r.port.drop("a");
	const writes = r.port.writes();
	r.timer.fire();

	assert.equal(r.port.writes(), writes, "kein Write an einem toten Objekt");
	assert.equal(r.pendingCount(), 0);
	assert.equal(getWindow(r.registry, "a").expectedRect, null);
});
