import assert from "node:assert/strict";
import { test } from "node:test";

import type { WindowId } from "../src/core/stack.ts";
import { DEFAULT_EXCLUDES, makeExcludes } from "../src/kwin/filter.ts";
import type { SurfacePlan } from "../src/kwin/plan.ts";
import { NO_GAPS, planArrangement } from "../src/kwin/plan.ts";
import type { Snapshot, WindowInfo } from "../src/kwin/types.ts";
import type { Registry } from "../src/state/registry.ts";
import { createRegistry, getSurface, getWindow, setFloating } from "../src/state/registry.ts";
import { AREA, singleView, windowInfo } from "./support/kwinfake.ts";

const EXCLUDES = makeExcludes(DEFAULT_EXCLUDES);
const KEY = singleView().key;

function snapshot(windows: WindowInfo[], activeId: WindowId | null): Snapshot {
	return { views: [singleView()], windows, activeId };
}

function only(registry: Registry, windows: WindowInfo[], activeId: WindowId | null): SurfacePlan {
	const plan = planArrangement(snapshot(windows, activeId), registry, NO_GAPS, EXCLUDES);
	const surface = plan.surfaces[0];
	if (surface === undefined) {
		throw new Error("keine Surface geplant");
	}
	return surface;
}

test("ein Fenster erhaelt die ganze Arbeitsflaeche", () => {
	// Testmatrix Fall 1. Die Flaeche ist die gemessene clientArea mit
	// abgezogenem Panel, nicht die volle Bildschirmhoehe von 1440.
	const surface = only(createRegistry(), [windowInfo("a")], null);
	assert.deepEqual(surface.placements, [
		{ id: "a", rect: { x: 0, y: 0, width: 2560, height: 1410 } },
	]);
	assert.equal(surface.layoutId, "tall");
});

test("mehrere neue Fenster auf einmal kehren die Reihenfolge um", () => {
	// Folge von XMonads `insertUp`: jedes neue Fenster nimmt den Platz des
	// gerade fokussierten ein und wird selbst fokussiert. Kommen drei auf
	// einmal, steht das zuletzt eingefuegte vorn. Im laufenden Betrieb kommt
	// immer nur eines hinzu; hier faellt es nur beim ersten Abgleich auf.
	const surface = only(createRegistry(), [windowInfo("a"), windowInfo("b"), windowInfo("c")], null);
	assert.deepEqual(surface.members, ["c", "b", "a"]);
});

test("drei Fenster ergeben Tall mit Master 1664 und Stapelzeilen 705", () => {
	// Testmatrix Fall 2. Genau diese sechs Zahlen muessen im Journal stehen.
	const surface = only(createRegistry(), [windowInfo("a"), windowInfo("b"), windowInfo("c")], null);
	assert.deepEqual(surface.placements, [
		{ id: "c", rect: { x: 0, y: 0, width: 1664, height: 1410 } },
		{ id: "b", rect: { x: 1664, y: 0, width: 896, height: 705 } },
		{ id: "a", rect: { x: 1664, y: 705, width: 896, height: 705 } },
	]);
	assert.equal(surface.ratio, 0.65);
});

test("Master und Stapel zerlegen die Flaeche exakt", () => {
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

test("ein nicht teilnehmendes Fenster bleibt in der Reihenfolge und erhaelt kein Rechteck", () => {
	const voll = windowInfo("b");
	voll.fullScreen = true;
	voll.moveable = false;
	voll.resizeable = false;

	const surface = only(createRegistry(), [windowInfo("a"), voll, windowInfo("c")], null);
	assert.deepEqual(surface.members, ["c", "b", "a"], "Reihenfolge bleibt vollstaendig");
	assert.deepEqual(surface.participants, ["c", "a"]);
	assert.equal(surface.placements.length, 2);
});

test("das Verlassen der Layout-Teilnahme loescht die Geometrieerwartung", () => {
	// Sonst kachelt eine verspaetete Wayland-Bestaetigung das Fenster zurueck.
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
	assert.equal(stapel.rect.x + stapel.rect.width, AREA.width, "bleibt in der Flaeche");
});

test("ausgeschlossene Fenster erscheinen weder als Mitglied noch als Platzierung", () => {
	const panel = windowInfo("panel");
	panel.normalWindow = false;
	panel.specialWindow = true;
	panel.dock = true;
	const surface = only(createRegistry(), [panel, windowInfo("a")], null);
	assert.deepEqual(surface.members, ["a"]);
});

test("planArrangement veraendert keinen bestehenden SurfaceState", () => {
	// Der Adapter darf `order` niemals an Ort und Stelle fortschreiben; das
	// wuerde die Registry lautlos vergiften.
	const registry = createRegistry();
	only(registry, [windowInfo("a"), windowInfo("b")], null);

	const vorher = getSurface(registry, KEY);
	const kopie = vorher.order.slice();
	const fokus = vorher.focus;

	only(registry, [windowInfo("a"), windowInfo("b"), windowInfo("c")], null);

	assert.deepEqual(vorher.order, kopie, "das alte Objekt bleibt unberuehrt");
	assert.equal(vorher.focus, fokus);
	assert.notEqual(getSurface(registry, KEY), vorher, "es wurde ersetzt, nicht veraendert");
});

test("die zurueckgegebene Mitgliederliste ist eine Kopie", () => {
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
	assert.equal(surface.raise, null);
});

test("full hebt den fokussierten Teilnehmer", () => {
	const registry = createRegistry();
	const a = windowInfo("a");
	const b = windowInfo("b");
	only(registry, [a, b], "b");
	getSurface(registry, KEY).layoutIndex = 1;

	const surface = only(registry, [a, b], "b");
	assert.equal(surface.layoutId, "full");
	assert.equal(surface.raise, "b");
});

test("full hebt keinen Nichtteilnehmer, sondern den Master", () => {
	// Ein minimiertes Fenster behaelt den Fokus der Surface, darf aber nicht
	// ueber die gekachelten gehoben werden.
	const registry = createRegistry();
	const a = windowInfo("a");
	const b = windowInfo("b");
	only(registry, [a, b], "b");
	getSurface(registry, KEY).layoutIndex = 1;
	b.minimized = true;

	const surface = only(registry, [a, b], null);
	assert.equal(surface.layoutId, "full");
	assert.deepEqual(surface.participants, ["a"]);
	assert.equal(surface.raise, "a", "der Master ersetzt den fehlenden Teilnehmer");
});

test("full hebt nichts, wenn niemand teilnimmt", () => {
	const registry = createRegistry();
	const a = windowInfo("a");
	only(registry, [a], "a");
	getSurface(registry, KEY).layoutIndex = 1;
	a.minimized = true;

	const surface = only(registry, [a], null);
	assert.equal(surface.layoutId, "full");
	assert.equal(surface.raise, null);
});
