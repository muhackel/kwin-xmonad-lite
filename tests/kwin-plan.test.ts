import assert from "node:assert/strict";
import { test } from "node:test";

import type { Rect } from "../src/core/rect.ts";
import { contains, overlaps } from "../src/core/rect.ts";
import type { WindowId } from "../src/core/stack.ts";
import { DEFAULT_EXCLUDES, makeExcludes } from "../src/kwin/filter.ts";
import type { ArrangePlan, SurfacePlan } from "../src/kwin/plan.ts";
import { NO_GAPS, planArrangement } from "../src/kwin/plan.ts";
import type { Snapshot, WindowInfo } from "../src/kwin/types.ts";
import type { Registry } from "../src/state/registry.ts";
import { createRegistry, getSurface, getWindow, setFloating } from "../src/state/registry.ts";
import {
	ACTIVITY,
	AREA,
	DESKTOP,
	OUTPUT,
	singleView,
	snapshotOf,
	view,
	windowInfo,
} from "./support/kwinfake.ts";

const EXCLUDES = makeExcludes(DEFAULT_EXCLUDES);
const KEY = singleView().key;

function snapshot(windows: WindowInfo[], activeId: WindowId | null): Snapshot {
	return snapshotOf([singleView()], windows, activeId);
}

function only(registry: Registry, windows: WindowInfo[], activeId: WindowId | null): SurfacePlan {
	const plan = planArrangement(snapshot(windows, activeId), registry, NO_GAPS, EXCLUDES);
	const surface = plan.surfaces[0];
	if (surface === undefined) {
		throw new Error("keine Surface geplant");
	}
	return surface;
}

test("ein Fenster erhält die ganze Arbeitsfläche", () => {
	// Testmatrix Fall 1. Die Fläche ist die gemessene clientArea mit
	// abgezogenem Panel, nicht die volle Bildschirmhöhe von 1440.
	const surface = only(createRegistry(), [windowInfo("a")], null);
	assert.deepEqual(surface.placements, [
		{ id: "a", rect: { x: 0, y: 0, width: 2560, height: 1410 } },
	]);
	assert.equal(surface.layoutId, "tall");
});

test("mehrere neue Fenster auf einmal kehren die Reihenfolge um", () => {
	// Folge von XMonads `insertUp`: jedes neue Fenster nimmt den Platz des
	// gerade fokussierten ein und wird selbst fokussiert. Kommen drei auf
	// einmal, steht das zuletzt eingefügte vorn. Im laufenden Betrieb kommt
	// immer nur eines hinzu; hier fällt es nur beim ersten Abgleich auf.
	const surface = only(createRegistry(), [windowInfo("a"), windowInfo("b"), windowInfo("c")], null);
	assert.deepEqual(surface.members, ["c", "b", "a"]);
});

test("drei Fenster ergeben Tall mit Master 1664 und Stapelzeilen 705", () => {
	// Testmatrix Fall 2. Genau diese sechs Zahlen müssen im Journal stehen.
	const surface = only(createRegistry(), [windowInfo("a"), windowInfo("b"), windowInfo("c")], null);
	assert.deepEqual(surface.placements, [
		{ id: "c", rect: { x: 0, y: 0, width: 1664, height: 1410 } },
		{ id: "b", rect: { x: 1664, y: 0, width: 896, height: 705 } },
		{ id: "a", rect: { x: 1664, y: 705, width: 896, height: 705 } },
	]);
	assert.equal(surface.ratio, 0.65);
});

test("Master und Stapel zerlegen die Fläche exakt", () => {
	const surface = only(createRegistry(), [windowInfo("a"), windowInfo("b"), windowInfo("c")], null);
	const master = surface.placements[0];
	const oben = surface.placements[1];
	const unten = surface.placements[2];
	if (master === undefined || oben === undefined || unten === undefined) {
		throw new Error("Platzierung fehlt");
	}
	assert.equal(master.rect.width + oben.rect.width, AREA.width);
	assert.equal(oben.rect.height + unten.rect.height, AREA.height);
});

test("ein zweiter Lauf mit gleicher Eingabe liefert dieselbe Anordnung", () => {
	const registry = createRegistry();
	const windows = [windowInfo("a"), windowInfo("b")];
	const erst = only(registry, windows, null);
	const zweit = only(registry, windows, null);
	assert.deepEqual(zweit.placements, erst.placements);
	assert.deepEqual(zweit.members, erst.members);
});

test("ein nicht teilnehmendes Fenster bleibt in der Reihenfolge und erhält kein Rechteck", () => {
	const voll = windowInfo("b");
	voll.fullScreen = true;
	voll.moveable = false;
	voll.resizeable = false;

	const surface = only(createRegistry(), [windowInfo("a"), voll, windowInfo("c")], null);
	assert.deepEqual(surface.members, ["c", "b", "a"], "Reihenfolge bleibt vollständig");
	assert.deepEqual(surface.participants, ["c", "a"]);
	assert.equal(surface.placements.length, 2);
});

test("das Verlassen der Layout-Teilnahme löscht die Geometrieerwartung", () => {
	// Sonst kachelt eine verspätete Wayland-Bestätigung das Fenster zurück.
	const registry = createRegistry();
	const info = windowInfo("a");
	only(registry, [info], null);

	const state = getWindow(registry, "a");
	state.expectedRect = { x: 1, y: 2, width: 3, height: 4 };
	state.applyAttempts = 1;

	info.minimized = true;
	only(registry, [info], null);

	assert.equal(state.expectedRect, null);
	assert.equal(state.applyAttempts, 0);
});

test("ein floatendes Fenster bleibt Mitglied ohne Rechteck", () => {
	const registry = createRegistry();
	setFloating(registry, "b", true, null);
	const surface = only(registry, [windowInfo("a"), windowInfo("b")], null);
	assert.deepEqual(surface.members, ["b", "a"]);
	assert.deepEqual(surface.participants, ["a"]);
});

test("eine leere Surface erzeugt keine Platzierung", () => {
	const surface = only(createRegistry(), [], null);
	assert.deepEqual(surface.members, []);
	assert.deepEqual(surface.placements, []);
});

test("das aktive Fenster gewinnt den Fokus der Surface", () => {
	const registry = createRegistry();
	only(registry, [windowInfo("a"), windowInfo("b")], "b");
	assert.equal(getSurface(registry, KEY).focus, "b");
});

test("ein Fenster mit Mindestbreite bekommt die geklemmte Zelle", () => {
	// "a" landet nach `insertUp` im Stapel, dessen Spalte nur 896 px breit ist.
	const eng = windowInfo("a");
	eng.minWidth = 1000;
	const surface = only(createRegistry(), [eng, windowInfo("b")], null);
	const stapel = surface.placements[1];
	if (stapel === undefined) {
		throw new Error("Platzierung fehlt");
	}
	assert.equal(stapel.rect.width, 1000);
	assert.equal(stapel.rect.x + stapel.rect.width, AREA.width, "bleibt in der Fläche");
});

test("eine Mindestbreite darf dokumentiert die Masterzelle überlappen", () => {
	const eng = windowInfo("a");
	eng.minWidth = 1000;
	const surface = only(createRegistry(), [eng, windowInfo("b")], null);
	const master = surface.placements[0];
	const stapel = surface.placements[1];
	if (master === undefined || stapel === undefined) {
		throw new Error("Platzierung fehlt");
	}
	assert.equal(overlaps(master.rect, stapel.rect), true);
	assert.equal(contains(AREA, stapel.rect), true);
});

test("eine Höchsthöhe darf dokumentiert Fläche in der Stapelzelle frei lassen", () => {
	const flach = windowInfo("a");
	flach.maxHeight = 400;
	const surface = only(createRegistry(), [flach, windowInfo("b")], null);
	const stapel = surface.placements[1];
	if (stapel === undefined) {
		throw new Error("Platzierung fehlt");
	}
	assert.equal(stapel.rect.height, 400);
	assert.equal(contains(AREA, stapel.rect), true);
	assert.equal(stapel.rect.height < AREA.height, true, "der Rest der Zelle bleibt frei");
});

test("ausgeschlossene Fenster erscheinen weder als Mitglied noch als Platzierung", () => {
	const panel = windowInfo("panel");
	panel.normalWindow = false;
	panel.specialWindow = true;
	panel.dock = true;
	const surface = only(createRegistry(), [panel, windowInfo("a")], null);
	assert.deepEqual(surface.members, ["a"]);
});

test("planArrangement verändert keinen bestehenden SurfaceState", () => {
	// Der Adapter darf `order` niemals an Ort und Stelle fortschreiben; das
	// würde die Registry lautlos vergiften.
	const registry = createRegistry();
	only(registry, [windowInfo("a"), windowInfo("b")], null);

	const vorher = getSurface(registry, KEY);
	const kopie = vorher.order.slice();
	const fokus = vorher.focus;

	only(registry, [windowInfo("a"), windowInfo("b"), windowInfo("c")], null);

	assert.deepEqual(vorher.order, kopie, "das alte Objekt bleibt unberührt");
	assert.equal(vorher.focus, fokus);
	assert.notEqual(getSurface(registry, KEY), vorher, "es wurde ersetzt, nicht verändert");
});

test("die zurückgegebene Mitgliederliste ist eine Kopie", () => {
	const registry = createRegistry();
	const surface = only(registry, [windowInfo("a")], null);
	surface.members.push("fremd");
	assert.deepEqual(getSurface(registry, KEY).order, ["a"]);
});

test("Tall bleibt das Layout, solange niemand wechselt", () => {
	// In Meilenstein 3 gibt es keine Shortcuts, `full` ist unerreichbar --
	// also darf auch nichts gehoben werden.
	const surface = only(createRegistry(), [windowInfo("a")], "a");
	assert.equal(surface.layoutId, "tall");
	assert.deepEqual(surface.raise, []);
});

test("full hebt den fokussierten Teilnehmer zuerst", () => {
	const registry = createRegistry();
	const a = windowInfo("a");
	const b = windowInfo("b");
	only(registry, [a, b], "b");
	getSurface(registry, KEY).layoutIndex = 1;

	const surface = only(registry, [a, b], "b");
	assert.equal(surface.layoutId, "full");
	assert.deepEqual(surface.raise, ["b"]);
});

test("full hebt keinen Nichtteilnehmer, sondern den Master", () => {
	// Ein minimiertes Fenster behält den Fokus der Surface, darf aber nicht
	// über die gekachelten gehoben werden.
	const registry = createRegistry();
	const a = windowInfo("a");
	const b = windowInfo("b");
	only(registry, [a, b], "b");
	getSurface(registry, KEY).layoutIndex = 1;
	b.minimized = true;

	const surface = only(registry, [a, b], null);
	assert.equal(surface.layoutId, "full");
	assert.deepEqual(surface.participants, ["a"]);
	assert.deepEqual(surface.raise, ["a"], "der Master ersetzt den fehlenden Teilnehmer");
});

test("full hebt Float-Fenster nach dem gekachelten in Surface-Reihenfolge", () => {
	const registry = createRegistry();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	const d = windowInfo("d");
	only(registry, [a, b, c, d], "b");
	getSurface(registry, KEY).layoutIndex = 1;
	setFloating(registry, "c", true, null);
	setFloating(registry, "d", true, null);

	const surface = only(registry, [a, b, c, d], "b");
	assert.equal(surface.layoutId, "full");
	assert.deepEqual(surface.raise, ["b", "d", "c"]);
});

test("full hebt ein fokussiertes Float-Fenster zuletzt", () => {
	const registry = createRegistry();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	only(registry, [a, b, c], "b");
	getSurface(registry, KEY).layoutIndex = 1;
	setFloating(registry, "b", true, null);
	setFloating(registry, "c", true, null);

	const surface = only(registry, [a, b, c], "b");
	assert.deepEqual(surface.raise, ["a", "c", "b"]);
});

test("full hebt keine unsichtbaren Float-Fenster", () => {
	const registry = createRegistry();
	const a = windowInfo("a");
	const sichtbar = windowInfo("sichtbar");
	const minimiert = windowInfo("minimiert");
	const vollbild = windowInfo("vollbild");
	const maxEins = windowInfo("max-eins");
	const maxZwei = windowInfo("max-zwei");
	const maxDrei = windowInfo("max-drei");
	only(registry, [a, sichtbar, minimiert, vollbild, maxEins, maxZwei, maxDrei], null);
	getSurface(registry, KEY).layoutIndex = 1;
	for (const id of ["sichtbar", "minimiert", "vollbild", "max-eins", "max-zwei", "max-drei"]) {
		setFloating(registry, id, true, null);
	}
	minimiert.minimized = true;
	vollbild.fullScreen = true;
	maxEins.maximizeMode = 1;
	maxZwei.maximizeMode = 2;
	maxDrei.maximizeMode = 3;

	const surface = only(
		registry,
		[a, sichtbar, minimiert, vollbild, maxEins, maxZwei, maxDrei],
		null,
	);
	assert.deepEqual(surface.raise, ["a", "sichtbar"]);
});

test("Tall hebt auch mit Float-Fenstern nichts", () => {
	const registry = createRegistry();
	const a = windowInfo("a");
	const b = windowInfo("b");
	setFloating(registry, "b", true, null);

	const surface = only(registry, [a, b], "b");
	assert.equal(surface.layoutId, "tall");
	assert.deepEqual(surface.raise, []);
});

test("full hebt ohne Teilnehmer nur die Float-Fenster", () => {
	const registry = createRegistry();
	const a = windowInfo("a");
	const b = windowInfo("b");
	only(registry, [a, b], "b");
	getSurface(registry, KEY).layoutIndex = 1;
	setFloating(registry, "a", true, null);
	setFloating(registry, "b", true, null);

	const surface = only(registry, [a, b], "b");
	assert.deepEqual(surface.participants, []);
	assert.deepEqual(surface.raise, ["a", "b"]);
});

// --- Mehrere Ausgaben und Desktops (Meilenstein 4) -----------------------

const AUSGABE_B = "DP-9";
const DESKTOP_B = "b7798180-564c-4f75-ad4a-284026ac7a68";
/** Zweite Ausgabe, gleich groß, rechts daneben. */
const AREA_B: Rect = { x: 2560, y: 0, width: 2560, height: 1410 };

function auf(output: string, info: WindowInfo): WindowInfo {
	info.outputName = output;
	return info;
}

function aufDesktop(desktop: string, info: WindowInfo): WindowInfo {
	info.desktopIds = [desktop];
	return info;
}

function surfaceOf(plan: ArrangePlan, key: string): SurfacePlan {
	for (const surface of plan.surfaces) {
		if (surface.key === key) {
			return surface;
		}
	}
	throw new Error(`Surface ${key} nicht geplant`);
}

test("zwei Ausgaben führen unabhängige Stapel", () => {
	// Testmatrix 3: eigene Reihenfolge, eigenes Verhältnis, eigenes Layout je
	// Surface -- eine Ausgabe darf die andere nicht anfassen.
	const registry = createRegistry();
	const viewA = singleView();
	const viewB = view(AUSGABE_B, DESKTOP, ACTIVITY, AREA_B);
	const fenster = [
		windowInfo("a1"),
		windowInfo("a2"),
		auf(AUSGABE_B, windowInfo("b1")),
		auf(AUSGABE_B, windowInfo("b2")),
	];

	planArrangement(snapshotOf([viewA, viewB], fenster, null), registry, NO_GAPS, EXCLUDES);
	getSurface(registry, viewB.key).layoutIndex = 1;
	getSurface(registry, viewB.key).masterRatio = 0.5;

	const plan = planArrangement(
		snapshotOf([viewA, viewB], fenster, null),
		registry,
		NO_GAPS,
		EXCLUDES,
	);
	const a = surfaceOf(plan, viewA.key);
	const b = surfaceOf(plan, viewB.key);

	assert.deepEqual(a.members, ["a2", "a1"]);
	assert.deepEqual(b.members, ["b2", "b1"]);
	assert.equal(a.layoutId, "tall");
	assert.equal(b.layoutId, "full");
	assert.equal(a.ratio, 0.65);
	assert.equal(b.ratio, 0.5);
	// Jede Surface rechnet auf ihrer eigenen Fläche.
	assert.deepEqual(a.area, AREA);
	assert.deepEqual(b.area, AREA_B);
	for (const placement of b.placements) {
		assert.equal(placement.rect.x, 2560, "die zweite Ausgabe beginnt bei 2560");
	}
});

test("fällt eine Ausgabe weg, wandern ihre Fenster und der alte Zustand bleibt", () => {
	// Testmatrix 9: die Surface der abgesteckten Ausgabe bleibt am Namen
	// erhalten -- `purgeFromSnapshot` prüft Ausgaben bewusst nicht.
	const registry = createRegistry();
	const viewA = singleView();
	const viewB = view(AUSGABE_B, DESKTOP, ACTIVITY, AREA_B);
	const b1 = auf(AUSGABE_B, windowInfo("b1"));
	planArrangement(
		snapshotOf([viewA, viewB], [windowInfo("a1"), b1], null),
		registry,
		NO_GAPS,
		EXCLUDES,
	);
	assert.deepEqual(getSurface(registry, viewB.key).order, ["b1"]);

	// DP-9 verschwindet, KWin schiebt das Fenster auf die verbliebene Ausgabe.
	auf(OUTPUT, b1);
	const plan = planArrangement(
		snapshotOf([viewA], [windowInfo("a1"), b1], null),
		registry,
		NO_GAPS,
		EXCLUDES,
	);

	assert.equal(plan.surfaces.length, 1);
	assert.deepEqual(surfaceOf(plan, viewA.key).members, ["b1", "a1"]);
	assert.deepEqual(
		getSurface(registry, viewB.key).order,
		["b1"],
		"der Zustand der abgesteckten Ausgabe überlebt",
	);
});

test("zwei Ausgaben auf verschiedenen Desktops kacheln je ihre eigene Menge", () => {
	// Der Per-Output-Desktop-Fall. Auf SPIELKISTE ist
	// `options.perOutputVirtualDesktops` gemessen `false`, alle Ausgaben melden
	// denselben Desktop -- abnehmen lässt sich das dort also nicht. Hier ist
	// es der reine Test.
	const registry = createRegistry();
	const viewA = singleView();
	const viewB = view(AUSGABE_B, DESKTOP_B, ACTIVITY, AREA_B);
	const fenster = [
		windowInfo("a1"),
		auf(AUSGABE_B, aufDesktop(DESKTOP_B, windowInfo("b1"))),
		auf(AUSGABE_B, aufDesktop(DESKTOP_B, windowInfo("b2"))),
	];

	const plan = planArrangement(
		snapshotOf([viewA, viewB], fenster, null),
		registry,
		NO_GAPS,
		EXCLUDES,
	);

	assert.deepEqual(surfaceOf(plan, viewA.key).members, ["a1"]);
	assert.deepEqual(surfaceOf(plan, viewB.key).members, ["b2", "b1"]);
});

test("nach einem Desktopwechsel kachelt die neue Surface und die alte behält ihre Reihenfolge", () => {
	// Testmatrix 5.
	const registry = createRegistry();
	const viewAlt = singleView();
	const viewNeu = view(OUTPUT, DESKTOP_B, ACTIVITY, AREA);
	const alt = [windowInfo("a1"), windowInfo("a2")];
	planArrangement(snapshotOf([viewAlt], alt, null), registry, NO_GAPS, EXCLUDES);
	assert.deepEqual(getSurface(registry, viewAlt.key).order, ["a2", "a1"]);

	const neu = [aufDesktop(DESKTOP_B, windowInfo("b1"))];
	const plan = planArrangement(snapshotOf([viewNeu], neu, null), registry, NO_GAPS, EXCLUDES);

	assert.deepEqual(surfaceOf(plan, viewNeu.key).members, ["b1"]);
	assert.deepEqual(surfaceOf(plan, viewNeu.key).placements, [{ id: "b1", rect: AREA }]);
	assert.deepEqual(
		getSurface(registry, viewAlt.key).order,
		["a2", "a1"],
		"die verlassene Surface behält ihre Reihenfolge",
	);
});
