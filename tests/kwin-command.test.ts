import assert from "node:assert/strict";
import { test } from "node:test";

import type { Rect } from "../src/core/rect.ts";
import { contains } from "../src/core/rect.ts";
import { surfaceKey } from "../src/core/surface.ts";
import type { CommandName, CommandResult } from "../src/kwin/command.ts";
import { pickSurface, runCommand, SHORTCUTS } from "../src/kwin/command.ts";
import type { SurfaceView, WindowInfo } from "../src/kwin/types.ts";
import { getWindow } from "../src/state/registry.ts";
import type { EpochRig } from "./support/epochrig.ts";
import { epochRig } from "./support/epochrig.ts";
import {
	ACTIVITY,
	AREA,
	DESKTOP,
	OUTPUT,
	singleView,
	snapshotFor,
	view,
	windowInfo,
} from "./support/kwinfake.ts";
import { must } from "./support/props.ts";

/** Wie `must()`, nur für die Nullwerte der Adapterschicht. */
function need<T>(value: T | null, message: string): T {
	if (value === null) {
		throw new Error(message);
	}
	return value;
}

const OUTPUT_2 = "DP-9";
const AREA_2: Rect = { x: 2560, y: 0, width: 1920, height: 1080 };
const START: Rect = { x: 40, y: 30, width: 800, height: 600 };

const KEY_1 = surfaceKey({ activity: ACTIVITY, desktop: DESKTOP, output: OUTPUT });
const KEY_2 = surfaceKey({ activity: ACTIVITY, desktop: DESKTOP, output: OUTPUT_2 });

function twoViews(): SurfaceView[] {
	return [singleView(), view(OUTPUT_2, DESKTOP, ACTIVITY, AREA_2)];
}

function cmd(
	rig: EpochRig,
	name: CommandName,
	windows: WindowInfo[],
	activeId: string | null,
	views?: SurfaceView[],
): CommandResult {
	return runCommand(
		name,
		snapshotFor(windows, activeId, views),
		rig.registry,
		rig.geometry,
		rig.config,
	);
}

/** Drei gewöhnliche Fenster mit einer Istgeometrie und einer gefüllten Surface. */
function threeWindows(rig: EpochRig, activeId: string): WindowInfo[] {
	const windows = [windowInfo("a"), windowInfo("b"), windowInfo("c")];
	for (const info of windows) {
		rig.port.place(info.id, START);
	}
	rig.run(windows, activeId);
	return windows;
}

function orderOf(rig: EpochRig, key: string): string[] {
	return must(rig.registry.surfaces.get(key), `Surface ${key} fehlt`).order.slice();
}

// --- Surface-Wahl -----------------------------------------------------------

test("ein aktives Mitglied wählt seine eigene Surface", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "b");
	const pick = pickSurface(snapshotFor(windows, "b"), rig.config.excludes);
	assert.equal(need(pick, "kein Pick").via, "aktiv");
	assert.equal(need(pick, "kein Pick").key, KEY_1);
});

test("ein aktives Nichtmitglied gibt seine Ausgabe vor, nicht die erste View", () => {
	const rig = epochRig();
	const views = twoViews();
	const a = windowInfo("a");
	const b = windowInfo("b");
	b.outputName = OUTPUT_2;
	const runner = windowInfo("krunner");
	runner.resourceClass = "krunner";
	runner.outputName = OUTPUT_2;
	const windows = [a, b, runner];
	for (const info of windows) {
		rig.port.place(info.id, START);
	}
	rig.run(windows, null, views);

	const result = cmd(rig, "nextLayout", windows, "krunner", views);
	assert.equal(result.note.indexOf(`befehl nextLayout surface=${KEY_2} via=ausgabe`), 0);
	assert.equal(result.arrange, true);
	assert.equal(must(rig.registry.surfaces.get(KEY_2), "Surface 2 fehlt").layoutIndex, 1);
	assert.equal(must(rig.registry.surfaces.get(KEY_1), "Surface 1 fehlt").layoutIndex, 0);
});

test("ohne aktives Fenster gewinnt die erste View", () => {
	const rig = epochRig();
	const views = twoViews();
	const a = windowInfo("a");
	rig.port.place("a", START);
	rig.run([a], null, views);

	const pick = pickSurface(snapshotFor([a], null, views), rig.config.excludes);
	assert.equal(need(pick, "kein Pick").via, "erste");
	assert.equal(need(pick, "kein Pick").key, KEY_1);
});

test("ein aktives Fenster ohne Ausgabe fällt auf die erste View zurück", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	a.outputName = "";
	const pick = pickSurface(snapshotFor([a], "a", twoViews()), rig.config.excludes);
	assert.equal(need(pick, "kein Pick").via, "erste");
	assert.equal(need(pick, "kein Pick").key, KEY_1);
});

test("ohne sichtbare Surface ist jeder der zwölf Befehle wirkungslos", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	assert.equal(pickSurface(snapshotFor([a], "a", []), rig.config.excludes), null);
	for (const shortcut of SHORTCUTS) {
		const result = cmd(rig, shortcut.name, [a], "a", []);
		assert.equal(result.focus, null, shortcut.name);
		assert.equal(result.arrange, false, shortcut.name);
		assert.equal(result.note.indexOf(`befehl ${shortcut.name} ohne Wirkung:`), 0);
	}
	assert.equal(rig.registry.surfaces.size, 0);
});

test("ein Fenster auf allen Desktops liefert genau eine sichtbare Surface", () => {
	const rig = epochRig();
	const views = twoViews();
	const a = windowInfo("a");
	a.outputName = OUTPUT_2;
	a.desktopIds = [];
	a.activityIds = [];
	a.onAllDesktops = true;
	rig.port.place("a", START);
	rig.run([a], "a", views);
	const layoutBefore = must(rig.registry.surfaces.get(KEY_1), "Surface 1 fehlt").layoutIndex;

	const result = cmd(rig, "nextLayout", [a], "a", views);
	assert.equal(result.note.indexOf(`befehl nextLayout surface=${KEY_2} via=aktiv`), 0);
	assert.equal(must(rig.registry.surfaces.get(KEY_1), "Surface 1 fehlt").layoutIndex, layoutBefore);
});

// --- Reconcile im Befehl ----------------------------------------------------

test("ein noch nicht eingetragenes Fenster ist beim Fokusbefehl schon dabei", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	const d = windowInfo("d");
	rig.port.place("d", START);
	assert.equal(orderOf(rig, KEY_1).indexOf("d"), -1);

	const result = cmd(rig, "focusNext", windows.concat([d]), "a");
	assert.equal(orderOf(rig, KEY_1).indexOf("d") >= 0, true);
	assert.equal(result.focus !== null, true);
	assert.equal(result.arrange, true);
});

test("ein verschwundenes Fenster wird nie Fokusziel", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	const ghost = windowInfo("geist");
	rig.port.place("geist", START);
	rig.run(windows.concat([ghost]), "geist");
	assert.equal(orderOf(rig, KEY_1).indexOf("geist") >= 0, true);

	// Der Geist fehlt jetzt in der Momentaufnahme; `reconcile` räumt ihn vor
	// dem Reducer aus der Reihenfolge.
	const result = cmd(rig, "focusNext", windows, "a");
	assert.equal(orderOf(rig, KEY_1).indexOf("geist"), -1);
	assert.notEqual(result.focus, "geist");
	assert.equal(result.note.indexOf("geist"), -1);
	assert.equal(result.note.indexOf("nicht mehr im Snapshot"), -1);
});

// --- Fokus ------------------------------------------------------------------

test("der Fokus läuft zyklisch durch die Reihenfolge", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	const order = orderOf(rig, KEY_1);
	const first = must(order[0], "leere Reihenfolge");
	const second = must(order[1], "zu kurze Reihenfolge");
	const third = must(order[2], "zu kurze Reihenfolge");

	let active = first;
	const seen: string[] = [];
	for (let i = 0; i < 3; i++) {
		const result = cmd(rig, "focusNext", windows, active);
		const next = need(result.focus, "kein Fokusziel");
		seen.push(next);
		active = next;
	}
	assert.deepEqual(seen, [second, third, first]);
});

test("der Fokusbefehl führt den Fokus dem aktiven Fenster nach", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	const order = orderOf(rig, KEY_1);
	const second = must(order[1], "zu kurze Reihenfolge");
	const third = must(order[2], "zu kurze Reihenfolge");
	// Der gespeicherte Fokus zeigt auf das erste, KWin meldet das zweite
	// Fenster als aktiv -- `reconcile` zieht nach, also gewinnt das dritte.
	const result = cmd(rig, "focusNext", windows, second);
	assert.equal(result.focus, third);
	assert.equal(
		result.note.indexOf(`befehl focusNext surface=${KEY_1} via=aktiv fokus=${third}`),
		0,
	);
});

test("der zweite focusMaster ordnet nicht neu an, meldet den Fokus aber weiter", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "b");
	const master = must(orderOf(rig, KEY_1)[0], "leere Reihenfolge");

	const first = cmd(rig, "focusMaster", windows, "b");
	assert.equal(first.focus, master);
	assert.equal(first.arrange, true);
	const second = cmd(rig, "focusMaster", windows, master);
	assert.equal(second.focus, master);
	assert.equal(second.arrange, false);
	assert.equal(second.note.indexOf(" unverändert") > 0, true);
});

// --- Reihenfolge ------------------------------------------------------------

test("swapNext bleibt bei einem einzigen Mitglied wirkungslos", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	rig.port.place("a", START);
	rig.run([a], "a");

	const result = cmd(rig, "swapNext", [a], "a");
	assert.equal(result.arrange, false);
	assert.equal(result.focus, null);
	assert.deepEqual(orderOf(rig, KEY_1), ["a"]);
});

test("swapNext ohne Fokus lässt die Reihenfolge stehen", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	const before = orderOf(rig, KEY_1);
	must(rig.registry.surfaces.get(KEY_1), "Surface fehlt").focus = null;

	const result = cmd(rig, "swapNext", windows, null);
	assert.equal(result.arrange, false);
	assert.deepEqual(orderOf(rig, KEY_1), before);
});

test("promote holt das Fenster von Position 2 an den Master", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	const order = orderOf(rig, KEY_1);
	const a = must(order[0], "leere Reihenfolge");
	const b = must(order[1], "zu kurze Reihenfolge");
	const c = must(order[2], "zu kurze Reihenfolge");

	const result = cmd(rig, "promote", windows, c);
	assert.deepEqual(orderOf(rig, KEY_1), [c, a, b]);
	assert.equal(result.focus, null);
	assert.equal(result.arrange, true);
});

// --- Leere Surface ----------------------------------------------------------

test("auf einer leeren Surface wirkt nur der Layoutbefehl", () => {
	const rig = epochRig();
	for (const name of ["focusNext", "swapNext", "promote"] as CommandName[]) {
		const result = cmd(rig, name, [], null);
		assert.equal(result.arrange, false, name);
		assert.equal(result.focus, null, name);
	}

	const result = cmd(rig, "nextLayout", [], null);
	assert.equal(result.arrange, true);
	assert.equal(must(rig.registry.surfaces.get(KEY_1), "Surface fehlt").layoutIndex, 1);
	assert.equal(result.note.indexOf(`befehl nextLayout surface=${KEY_1} via=erste layout=full`), 0);
});

// --- Layout und Masteranteil ------------------------------------------------

test("nextLayout läuft im Kreis von tall über full zurück nach tall", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	const first = cmd(rig, "nextLayout", windows, "a");
	assert.equal(first.note.indexOf("layout=full") > 0, true);
	const second = cmd(rig, "nextLayout", windows, "a");
	assert.equal(second.note.indexOf("layout=tall") > 0, true);
	assert.equal(must(rig.registry.surfaces.get(KEY_1), "Surface fehlt").layoutIndex, 0);
});

test("expand läuft bis 0,9 und hält dort an", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	const steps = [0.7, 0.75, 0.8, 0.85, 0.9];
	for (const wanted of steps) {
		const result = cmd(rig, "expand", windows, "a");
		assert.equal(result.arrange, true);
		assert.equal(result.note.indexOf(`ratio=${wanted}`) > 0, true, `ratio=${wanted}`);
	}
	const stuck = cmd(rig, "expand", windows, "a");
	assert.equal(stuck.arrange, false);
	assert.equal(stuck.note.indexOf("ratio=0.9 unverändert") > 0, true);
});

test("shrink läuft bis 0,1 und hält dort an", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	for (let i = 0; i < 11; i++) {
		assert.equal(cmd(rig, "shrink", windows, "a").arrange, true, `Schritt ${i}`);
	}
	const stuck = cmd(rig, "shrink", windows, "a");
	assert.equal(stuck.arrange, false);
	assert.equal(stuck.note.indexOf("ratio=0.1 unverändert") > 0, true);
	assert.equal(must(rig.registry.surfaces.get(KEY_1), "Surface fehlt").masterRatio, 0.1);
});

test("resetLayout zieht Ratio und Layout auf die konfigurierten Werte", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "a");
	cmd(rig, "expand", windows, "a");
	cmd(rig, "nextLayout", windows, "a");
	rig.config.masterRatio = 0.5;
	rig.config.layoutIndex = 1;

	const result = cmd(rig, "resetLayout", windows, "a");
	const state = must(rig.registry.surfaces.get(KEY_1), "Surface fehlt");
	assert.equal(result.arrange, true);
	assert.equal(state.masterRatio, 0.5);
	assert.equal(state.layoutIndex, 1);
	assert.equal(cmd(rig, "resetLayout", windows, "a").arrange, false);
});

test("die konfigurierten Werte gelten nur für eine neu angelegte Surface", () => {
	const rig = epochRig();
	const views = twoViews();
	const a = windowInfo("a");
	rig.port.place("a", START);
	rig.run([a], "a", [singleView()]);
	cmd(rig, "expand", [a], "a");
	const before = must(rig.registry.surfaces.get(KEY_1), "Surface 1 fehlt");
	assert.equal(before.masterRatio, 0.7);

	rig.config.masterRatio = 0.5;
	rig.config.layoutIndex = 1;
	const b = windowInfo("b");
	b.outputName = OUTPUT_2;
	rig.port.place("b", START);
	cmd(rig, "focusMaster", [a, b], "b", views);

	const created = must(rig.registry.surfaces.get(KEY_2), "Surface 2 fehlt");
	assert.equal(created.masterRatio, 0.5);
	assert.equal(created.layoutIndex, 1);
	assert.equal(must(rig.registry.surfaces.get(KEY_1), "Surface 1 fehlt").masterRatio, 0.7);
	assert.equal(must(rig.registry.surfaces.get(KEY_1), "Surface 1 fehlt").layoutIndex, 0);
});

// --- Float und Sink ---------------------------------------------------------

test("toggleFloat nimmt das aktive Fenster aus dem Layout", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "b");

	const result = cmd(rig, "toggleFloat", windows, "b");
	assert.equal(result.arrange, true);
	assert.equal(result.focus, null);
	assert.equal(result.note.indexOf(`fenster=b → gefloatet`) > 0, true);
	assert.equal(getWindow(rig.registry, "b").floating, true);

	const surface = must(rig.run(windows, "b").plan.surfaces[0], "Surface fehlt");
	assert.equal(surface.participants.indexOf("b"), -1);
	assert.equal(
		surface.placements.some((entry) => entry.id === "b"),
		false,
	);
});

test("sink ordnet an, obwohl Reihenfolge und Fokus unverändert bleiben", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "b");
	cmd(rig, "toggleFloat", windows, "b");
	rig.run(windows, "b");
	const before = must(rig.registry.surfaces.get(KEY_1), "Surface fehlt");
	const order = before.order.slice();
	const focus = before.focus;

	const result = cmd(rig, "sink", windows, "b");
	const after = must(rig.registry.surfaces.get(KEY_1), "Surface fehlt");
	assert.equal(result.note.indexOf("fenster=b → gekachelt") > 0, true);
	assert.equal(result.arrange, true);
	assert.deepEqual(after.order, order);
	assert.equal(after.focus, focus);
	assert.equal(getWindow(rig.registry, "b").floating, false);
});

test("sink am gekachelten Fenster lässt die offene Erwartung stehen", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "b");
	// Ein Fenster mit Größenraster: das Rücklesen weicht ab, die Erwartung
	// bleibt offen und eine Nachprüfung ist eingeplant.
	rig.port.setAccept("b", () => ({ x: 10, y: 10, width: 880, height: 700 }));
	const target: Rect = { x: 5, y: 5, width: 900, height: 700 };
	rig.geometry.apply("b", target);
	assert.equal(rig.geometry.pendingCount(), 1);
	const writes = rig.port.writes();

	const result = cmd(rig, "sink", windows, "b");
	assert.equal(result.arrange, false);
	assert.equal(result.note.indexOf("fenster=b → bereitsGekachelt") > 0, true);
	assert.equal(rig.port.writes(), writes, "der Frühausstieg schreibt nicht");
	assert.deepEqual(getWindow(rig.registry, "b").expectedRect, target);
	assert.equal(rig.geometry.pendingCount(), 1, "die eingeplante Nachprüfung überlebt");
});

test("Float ohne aktives Fenster und auf einem Nichtmitglied bleibt wirkungslos", () => {
	const rig = epochRig();
	const windows = threeWindows(rig, "b");
	const runner = windowInfo("krunner");
	runner.resourceClass = "krunner";
	rig.port.place("krunner", START);

	const ohne = cmd(rig, "toggleFloat", windows, null);
	assert.equal(ohne.arrange, false);
	assert.equal(ohne.note, "befehl toggleFloat ohne Wirkung: kein aktives Fenster");

	const fremd = cmd(rig, "toggleFloat", windows.concat([runner]), "krunner");
	assert.equal(fremd.arrange, false);
	assert.equal(fremd.note.indexOf("fenster=krunner → keinMitglied") > 0, true);
	assert.equal(rig.registry.windows.has("krunner"), false);
});

test("die Float-Wiederherstellung verankert gegen die Fläche der zweiten Ausgabe", () => {
	const rig = epochRig();
	const views = twoViews();
	const a = windowInfo("a");
	a.outputName = OUTPUT_2;
	const outside: Rect = { x: 100, y: 100, width: 500, height: 400 };
	rig.port.place("a", START);
	rig.run([a], "a", views);
	getWindow(rig.registry, "a").floatRect = outside;
	a.frameGeometry = need(rig.port.read("a"), "Geometrie fehlt");

	const result = cmd(rig, "toggleFloat", [a], "a", views);
	assert.equal(result.arrange, true);
	assert.equal(result.note.indexOf("fenster=a → wiederhergestellt") > 0, true);
	const actual = need(rig.port.read("a"), "Float-Geometrie fehlt");
	assert.equal(contains(AREA_2, actual), true);
	assert.equal(contains(AREA, actual), false);
	assert.equal(actual.width, outside.width);
	assert.equal(actual.height, outside.height);
});

// --- Die Tabelle ------------------------------------------------------------

test("die Tastentabelle trägt genau zwölf Aktionen", () => {
	assert.equal(SHORTCUTS.length, 12);
});

test("die objectNames sind ab dem ersten Release unwiderruflich", () => {
	const names: string[] = [];
	for (const shortcut of SHORTCUTS) {
		names.push(shortcut.objectName);
	}
	assert.deepEqual(names, [
		"xml-focus-next",
		"xml-focus-prev",
		"xml-swap-next",
		"xml-swap-prev",
		"xml-focus-master",
		"xml-promote",
		"xml-shrink",
		"xml-expand",
		"xml-sink",
		"xml-toggle-float",
		"xml-next-layout",
		"xml-reset-layout",
	]);
});

test("keine Taste ist doppelt vergeben", () => {
	const keys = new Set<string>();
	for (const shortcut of SHORTCUTS) {
		assert.equal(keys.has(shortcut.keys), false, shortcut.keys);
		keys.add(shortcut.keys);
	}
	assert.equal(keys.size, SHORTCUTS.length);
});

test("die Tabelle deckt jeden Befehlsnamen genau einmal ab", () => {
	// Ein neuer Wert in `CommandName` bricht hier schon den Typcheck.
	const expected: Record<CommandName, true> = {
		focusNext: true,
		focusPrev: true,
		swapNext: true,
		swapPrev: true,
		focusMaster: true,
		promote: true,
		shrink: true,
		expand: true,
		sink: true,
		toggleFloat: true,
		nextLayout: true,
		resetLayout: true,
	};
	const seen = new Set<string>();
	for (const shortcut of SHORTCUTS) {
		assert.equal(seen.has(shortcut.name), false, shortcut.name);
		seen.add(shortcut.name);
		assert.equal(expected[shortcut.name], true);
		assert.equal(shortcut.text.length > 0, true, shortcut.name);
	}
	assert.deepEqual(Object.keys(expected).sort(), Array.from(seen).sort());
});
