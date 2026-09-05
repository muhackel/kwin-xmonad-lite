import assert from "node:assert/strict";
import { test } from "node:test";

import type { Rect } from "../src/core/rect.ts";
import type { WindowId } from "../src/core/stack.ts";
import { createGeometryController, RECHECK_MS } from "../src/kwin/apply.ts";
import { MAX_CORRECTIONS } from "../src/kwin/geometry.ts";
import type { Registry } from "../src/state/registry.ts";
import { createRegistry, getWindow } from "../src/state/registry.ts";
import type { FakePort, FakeTimer } from "./support/kwinfake.ts";
import { fakePort, fakeTimer } from "./support/kwinfake.ts";

const START: Rect = { x: 0, y: 0, width: 800, height: 600 };
const TARGET: Rect = { x: 0, y: 0, width: 1664, height: 1410 };
const ANDERS: Rect = { x: 1664, y: 0, width: 896, height: 1410 };
/** Was ein Fenster mit Größenraster daraus macht. */
const GERASTERT: Rect = { x: 0, y: 0, width: 1660, height: 1410 };

interface Rig {
	registry: Registry;
	port: FakePort;
	timer: FakeTimer;
	extern: WindowId[];
	logs: string[];
	apply(id: WindowId, target: Rect): void;
	notifyChanged(id: WindowId): void;
	accept(id: WindowId, actual: Rect): void;
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
		accept: controller.accept,
		forget: controller.forget,
		pendingCount: controller.pendingCount,
	};
}

/** Ein Fenster, das jeden Zielwert brav übernimmt. */
function braves(r: Rig, id: WindowId): void {
	r.port.place(id, START);
}

/** Ein Fenster mit Größenraster: es nimmt den Zielwert nie genau an. */
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
	assert.equal(r.timer.active, false, "keine Nachprüfung nötig");
});

test("das eigene synchrone Signal während des Writes wird verworfen", () => {
	// Auf Wayland ist eine reine Verschiebung sofort wirksam:
	// frameGeometryChanged kommt mitten im Schreiben zurück.
	const r = rig();
	braves(r, "a");
	let rückstöße = 0;
	r.port.setOnWrite((id) => {
		rückstöße += 1;
		r.notifyChanged(id);
	});

	r.apply("a", TARGET);

	assert.equal(rückstöße, 1, "der Rückstoß ist tatsächlich gelaufen");
	assert.equal(r.port.writes(), 1, "kein zweiter Write");
	assert.equal(r.pendingCount(), 0);
});

// --- Abweichung, Nachprüfung, Nachbesserung --------------------------------

test("ein abweichendes Rücklesen plant eine Nachprüfung, schreibt aber nicht", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);

	assert.equal(r.port.writes(), 1, "genau der eine Zielschreibvorgang");
	assert.equal(r.pendingCount(), 1);
	assert.equal(r.timer.active, true);
	assert.deepEqual(getWindow(r.registry, "a").expectedRect, TARGET, "Erwartung bleibt offen");
});

test("eine zeitversetzte Bestätigung beruhigt über den Signalpfad", () => {
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

test("eine zeitversetzte Bestätigung räumt auch die Nachprüfung ab", () => {
	// Bliebe der Eintrag stehen, feuerte der Timer noch einmal ins Leere und
	// läse dabei ein Fenster, an dem es nichts mehr zu tun gibt.
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	assert.equal(r.pendingCount(), 1);

	r.port.setAccept("a", (rect) => rect);
	r.port.place("a", TARGET);
	r.notifyChanged("a");

	assert.equal(r.pendingCount(), 0);
	assert.equal(r.timer.active, false, "ohne verbleibende Arbeit hält der Timer an");

	const reads = r.port.reads();
	const writes = r.port.writes();
	r.timer.fire();
	assert.equal(r.port.reads(), reads, "ein dennoch ausgelöster Lauf liest nichts");
	assert.equal(r.port.writes(), writes);
});

test("der Signalpfad plant bei Abweichung nur eine Nachprüfung ein", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	const vorher = r.port.writes();

	r.notifyChanged("a");

	assert.equal(r.port.writes(), vorher, "kein Write im Signal-Callback");
	assert.equal(r.pendingCount(), 1);
});

test("nachgebessert wird höchstens einmal je Fenster und Timerlauf", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	assert.equal(r.port.writesFor("a"), 1);

	r.timer.fire();
	assert.equal(r.port.writesFor("a"), 2, "erster Versuch");
	assert.equal(getWindow(r.registry, "a").applyAttempts, 1);
	assert.equal(r.timer.active, true, "der nächste Lauf ist eingeplant");

	r.timer.fire();
	assert.equal(r.port.writesFor("a"), 3, "zweiter Versuch");
	assert.equal(getWindow(r.registry, "a").applyAttempts, MAX_CORRECTIONS);

	r.timer.fire();
	assert.equal(r.port.writesFor("a"), 3, "danach ist Schluss");
});

test("nach dem Aufgeben sind Erwartung und Nachprüfung leer", () => {
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

test("ein verspätetes Signal nach dem Aufgeben ist Nachhall, keine fremde Änderung", () => {
	// Ohne lastObservedRect startete jedes aufgegebene Fenster im nächsten
	// Signal einen neuen Anordnungs- und Nachbesserungszyklus -- genau das
	// Flattern, das der Zähler verhindern soll.
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

test("eine fremde Verschiebung auf das alte Soll ist kein Nachhall", () => {
	// Nach einem Giveup ist tiledRect absichtlich das nie erreichte Soll. Wer
	// den Nachhall auch daran erkennt, verschluckt genau diese Verschiebung.
	const r = rig();
	braves(r, "a");
	r.apply("a", TARGET);

	// Ab jetzt nimmt das Fenster keinen Zielwert mehr genau an.
	r.port.setAccept("a", () => GERASTERT);
	r.apply("a", ANDERS);
	r.timer.fire();
	r.timer.fire();
	r.timer.fire();

	const state = getWindow(r.registry, "a");
	assert.deepEqual(state.tiledRect, TARGET, "das alte Soll steht noch");
	assert.deepEqual(state.lastObservedRect, GERASTERT, "der Istwert weicht davon ab");

	// Ein fremdes Programm schiebt das Fenster genau auf das alte Soll.
	r.port.place("a", TARGET);
	r.notifyChanged("a");

	assert.deepEqual(r.extern, ["a"]);
});

// --- Generationen -----------------------------------------------------------

test("eine Anordnung ohne eigenen Write entwertet die Erwartung nicht", () => {
	// Die Regressionsprobe auf den Fehler aus Meilenstein 3: dort hing die
	// Generation an der globalen Arrange-Epoche, und schon der nächste Lauf
	// eines beliebigen anderen Fensters machte die Erwartung unerreichbar.
	const r = rig();
	stures(r, "a");
	braves(r, "b");
	r.apply("a", TARGET);

	r.apply("b", ANDERS); // eine spätere Epoche, ein anderes Fenster

	r.timer.fire();
	assert.equal(r.port.writesFor("a"), 2, "a wird trotzdem nachgebessert");
});

test("ein neuer Zielwert ersetzt die Erwartung und entwertet die alte Nachprüfung", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	assert.equal(r.pendingCount(), 1);

	// Der zweite Zielwert wird angenommen; die alte Nachprüfung steht noch,
	// gehört aber zur vorigen Schreibgeneration.
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
	test(`${grund}: forget löscht Erwartung und Nachprüfung`, () => {
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
		assert.equal(r.port.reads(), reads, "kein späterer Timerlauf liest");
		assert.equal(r.port.writes(), writes, "und schreibt erst recht nicht");
	});
}

// --- Fremde Änderungen -----------------------------------------------------

test("die eigene, bereits beruhigte Geometrie meldet keine fremde Änderung", () => {
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
	assert.equal(r.port.writes(), 1, "gemeldet, nicht zurückgeschrieben");
});

test("während eines Ziehens wird nichts gemeldet", () => {
	const r = rig();
	braves(r, "a");
	r.apply("a", TARGET);
	r.port.setDragging("a", true);

	r.port.place("a", ANDERS);
	r.notifyChanged("a");

	assert.deepEqual(r.extern, [], "interactiveMoveResizeFinished ordnet danach an");
});

test("eine Nachprüfung während des Ziehens lässt die Erwartung fallen", () => {
	// Bliebe sie offen, fiele das erste Signal nach dem Loslassen in den
	// Erwartungszweig: der Timer schöbe das Fenster ohne Anordnungslauf
	// zurück, statt die Verschiebung zu melden.
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	assert.equal(r.pendingCount(), 1);

	r.port.setDragging("a", true);
	r.timer.fire();

	const state = getWindow(r.registry, "a");
	assert.equal(state.expectedRect, null);
	assert.equal(r.pendingCount(), 0);

	// Loslassen: die Geometrie steht dort, wo der Nutzer sie hingezogen hat.
	r.port.setDragging("a", false);
	r.port.place("a", ANDERS);
	const writes = r.port.writes();
	r.notifyChanged("a");

	assert.deepEqual(r.extern, ["a"], "gemeldet, nicht unter der Hand zurückgeschoben");
	assert.equal(r.port.writes(), writes);
});

test("accept schließt eine offene Erwartung eines älteren Zielwerts", () => {
	// Der Client lieferte GERASTERT statt TARGET, die Nachprüfung steht an.
	// Rechnet die nächste Epoche genau GERASTERT als neues Soll, meldet
	// `judgeWrite` "unchanged" und der Adapter ruft `accept`. Ohne das schöbe
	// der Nachprüfungslauf das Fenster auf das veraltete TARGET zurück.
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	assert.equal(r.pendingCount(), 1);
	const writes = r.port.writes();

	r.accept("a", GERASTERT);

	const state = getWindow(r.registry, "a");
	assert.equal(state.expectedRect, null);
	assert.equal(r.pendingCount(), 0);
	assert.equal(r.timer.active, false, "nichts mehr eingeplant, der Timer steht");
	assert.deepEqual(state.tiledRect, GERASTERT);
	assert.deepEqual(state.lastObservedRect, GERASTERT);

	r.timer.fire();
	assert.equal(r.port.writes(), writes, "kein Write auf das alte Soll");

	// Der Nachhall dieses Werts ist keine fremde Änderung mehr.
	r.notifyChanged("a");
	assert.deepEqual(r.extern, []);
});

test("accept ohne Registry-Eintrag ist wirkungslos", () => {
	const r = rig();
	r.accept("fremd", TARGET);
	assert.equal(r.registry.windows.has("fremd"), false);
	assert.equal(r.pendingCount(), 0);
});

test("das Signal eines anderen Fensters geht während eines Writes nicht verloren", () => {
	const r = rig();
	braves(r, "a");
	braves(r, "b");
	// b ist bereits gekachelt und wird von außen verschoben, während an a
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

test("ein zwischen Write und Nachprüfung geschlossenes Fenster wird vergessen", () => {
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

// --- Der Nachprüfungstimer -------------------------------------------------

test("der Controller stellt den Timer auf Einmalbetrieb ein", () => {
	const r = rig();
	assert.equal(r.timer.singleShot, true);
	assert.equal(r.timer.interval, RECHECK_MS);
});

test("ein leerer Durchlauf hält den Timer an", () => {
	// Gemessen ist nur, dass `singleShot` existiert — nicht, dass die Zuweisung
	// wirkt. Ohne das eigene `stop()` feuerte der Timer sonst für immer alle
	// 50 ms ins Leere. Bewusst am nackten Timer aufgebaut: jeder Weg über
	// settle, forget oder giveup räumte selbst auf und verdeckte die Annahme.
	const r = rig();
	r.timer.setRepeating(true);
	r.timer.start();

	r.timer.fire();

	assert.equal(r.timer.active, false);
});

test("eine Nachbesserung startet den Timer nicht zweimal", () => {
	const r = rig();
	stures(r, "a");
	r.apply("a", TARGET);
	assert.equal(r.timer.starts(), 1, "das abweichende Rücklesen plant ein");

	r.timer.fire();

	assert.equal(r.timer.starts(), 2, "der Retry plant ein, der Schlussblock nicht noch einmal");
	assert.equal(r.timer.active, true);
});
