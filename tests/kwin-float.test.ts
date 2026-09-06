import assert from "node:assert/strict";
import { test } from "node:test";

import type { Rect } from "../src/core/rect.ts";
import { contains } from "../src/core/rect.ts";
import { DEFAULT_EXCLUDES, makeExcludes } from "../src/kwin/filter.ts";
import { setFloat, toggleFloat } from "../src/kwin/float.ts";
import type { SurfacePlan } from "../src/kwin/plan.ts";
import type { WindowInfo } from "../src/kwin/types.ts";
import { getWindow } from "../src/state/registry.ts";
import type { EpochRig } from "./support/epochrig.ts";
import { epochRig } from "./support/epochrig.ts";
import { ACTIVITY, AREA, OUTPUT, singleView, view, windowInfo } from "./support/kwinfake.ts";

const EXCLUDES = makeExcludes(DEFAULT_EXCLUDES);
const START: Rect = { x: 40, y: 30, width: 800, height: 600 };
const MOVED: Rect = { x: 300, y: 240, width: 900, height: 700 };

function sync(rig: EpochRig, info: WindowInfo): Rect {
	const actual = rig.port.read(info.id);
	if (actual === null) {
		throw new Error(`Geometrie für ${info.id} fehlt`);
	}
	info.frameGeometry = actual;
	return actual;
}

function firstFloat(rig: EpochRig, windows: WindowInfo[], info: WindowInfo): void {
	sync(rig, info);
	assert.equal(toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES), "gefloatet");
	rig.run(windows, info.id);
}

function sinkMovedFloat(): {
	rig: EpochRig;
	windows: WindowInfo[];
	info: WindowInfo;
	surface: SurfacePlan;
} {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	const windows = [a, b, c];
	for (const info of windows) {
		rig.port.place(info.id, START);
	}
	rig.run(windows, "b");
	firstFloat(rig, windows, b);
	rig.port.place("b", MOVED);
	sync(rig, b);
	rig.geometry.notifyChanged("b");
	assert.deepEqual(rig.externals, []);
	assert.equal(toggleFloat(rig.registry, rig.geometry, b, AREA, EXCLUDES), "gekachelt");
	const surface = rig.run(windows, "b").plan.surfaces[0];
	if (surface === undefined) {
		throw new Error("Surface fehlt");
	}
	return { rig, windows, info: b, surface };
}

test("der erste Float-Toggle behält die Geometrie und lässt den Rest nachrücken", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const c = windowInfo("c");
	const windows = [a, b, c];
	for (const info of windows) {
		rig.port.place(info.id, START);
	}
	rig.run(windows, "b");

	rig.port.setAccept("b", () => ({ x: 10, y: 10, width: 880, height: 700 }));
	rig.geometry.apply("b", { x: 5, y: 5, width: 900, height: 700 });
	assert.equal(rig.geometry.pendingCount(), 1);
	const current = sync(rig, b);
	const writesAtWindow = rig.port.writesFor("b");
	const writesBeforeEpoch = rig.port.writes();

	assert.equal(toggleFloat(rig.registry, rig.geometry, b, AREA, EXCLUDES), "gefloatet");
	assert.deepEqual(getWindow(rig.registry, "b").floatRect, current);
	assert.equal(rig.geometry.pendingCount(), 0);
	assert.equal(rig.port.writesFor("b"), writesAtWindow, "der erste Toggle schreibt nicht");
	const result = rig.run(windows, "b");
	assert.deepEqual(result.plan.surfaces[0]?.participants, ["c", "a"]);
	assert.equal(rig.port.writesFor("b"), writesAtWindow);
	assert.equal(rig.port.writes() > writesBeforeEpoch, true, "die übrigen Fenster rücken nach");
});

test("Sink speichert die verschobene Float-Geometrie und kachelt an alter Stelle ein", () => {
	const { rig, surface } = sinkMovedFloat();
	const placement = surface.placements.find((entry) => entry.id === "b");
	assert.deepEqual(getWindow(rig.registry, "b").floatRect, MOVED);
	assert.deepEqual(surface.members, ["c", "b", "a"]);
	assert.equal(surface.members.indexOf("b"), 1);
	assert.equal(surface.participants.indexOf("b") === -1, false);
	assert.equal(getWindow(rig.registry, "b").floating, false);
	assert.deepEqual(getWindow(rig.registry, "b").tiledRect, placement?.rect);
});

test("der zweite Float-Toggle stellt floatRect wieder her und bewahrt tiledRect", () => {
	const { rig, windows, info } = sinkMovedFloat();
	const state = getWindow(rig.registry, "b");
	const tiled = state.tiledRect;
	assert.notEqual(tiled, null);
	const logStart = rig.logs.length;
	const writes = rig.port.writesFor("b");
	sync(rig, info);

	assert.equal(toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES), "wiederhergestellt");
	assert.deepEqual(rig.port.read("b"), MOVED);
	assert.deepEqual(state.tiledRect, tiled);
	assert.notEqual(state.tiledRect?.x, state.floatRect?.x);
	rig.run(windows, "b");
	assert.equal(rig.port.writesFor("b"), writes + 1, "nur place schreibt am Float-Fenster");
	const logs = rig.logs.slice(logStart);
	assert.equal(
		logs.some((line) => line.indexOf("float b soll=") === 0),
		true,
	);
	assert.equal(
		logs.some((line) => line.indexOf("apply b soll=") === 0),
		false,
	);
});

test("das synchrone Signal der Float-Platzierung gilt nicht als externe Verschiebung", () => {
	const rig = epochRig();
	const info = windowInfo("a");
	rig.port.place("a", START);
	rig.run([info], "a");
	getWindow(rig.registry, "a").floatRect = MOVED;
	sync(rig, info);
	let signals = 0;
	rig.port.setOnWrite((id) => {
		signals += 1;
		rig.geometry.notifyChanged(id);
	});

	assert.equal(toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES), "wiederhergestellt");
	assert.equal(signals, 1);
	assert.deepEqual(rig.externals, []);
});

test("eine gemerkte Float-Geometrie wird in die aktuelle Arbeitsfläche verankert", () => {
	const rig = epochRig();
	const info = windowInfo("a");
	const outside: Rect = { x: 5000, y: 2000, width: 500, height: 400 };
	rig.port.place("a", START);
	rig.run([info], "a");
	getWindow(rig.registry, "a").floatRect = outside;
	sync(rig, info);

	assert.equal(toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES), "wiederhergestellt");
	const actual = rig.port.read("a");
	if (actual === null) {
		throw new Error("Float-Geometrie fehlt");
	}
	assert.equal(contains(AREA, actual), true);
	assert.equal(actual.width, outside.width);
	assert.equal(actual.height, outside.height);
});

test("ein maximiertes Fenster wird erst nach dem Restore wiederhergestellt", () => {
	const { rig, windows, info } = sinkMovedFloat();
	const state = getWindow(rig.registry, "b");
	const writes = rig.port.writesFor("b");
	sync(rig, info);
	info.maximizeMode = 3;
	rig.port.place("b", AREA);
	info.frameGeometry = AREA;

	assert.equal(
		toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES),
		"gefloatetOhneWiederherstellung",
	);
	assert.equal(state.floating, true);
	assert.equal(rig.port.writesFor("b"), writes, "place schreibt nicht am maximierten Fenster");
	assert.deepEqual(rig.port.read("b"), AREA, "die Maximierung bleibt unangetastet");
	assert.deepEqual(state.floatRect, MOVED, "die gemerkte Float-Geometrie überlebt");
	assert.equal(state.floatRestorePending, true);
	assert.equal(rig.geometry.pendingCount(), 0);

	rig.run(windows, "b");
	assert.equal(rig.port.writesFor("b"), writes, "im Sonderzustand bleibt der Auftrag offen");
	assert.equal(state.floatRestorePending, true);
	info.maximizeMode = 0;
	rig.run(windows, "b");
	assert.deepEqual(rig.port.read("b"), MOVED);
	assert.equal(rig.port.writesFor("b"), writes + 1);
	assert.equal(state.floatRestorePending, false);
	rig.run(windows, "b");
	assert.equal(rig.port.writesFor("b"), writes + 1, "die Wiederherstellung läuft nur einmal");
});

test("erstmaliges Floaten im Vollbild fängt keine Geometrie ein", () => {
	const rig = epochRig();
	const info = windowInfo("a");
	rig.port.place("a", START);
	rig.run([info], "a");
	info.fullScreen = true;
	info.frameGeometry = AREA;
	rig.port.place("a", AREA);

	assert.equal(
		toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES),
		"gefloatetOhneWiederherstellung",
	);
	const state = getWindow(rig.registry, "a");
	assert.equal(state.floating, true);
	assert.equal(state.floatRect, null);
	assert.equal(state.floatRestorePending, false);
	assert.deepEqual(rig.port.read("a"), AREA);
});

test("das Einkacheln im Vollbild fängt die Vollbildfläche nicht als floatRect ein", () => {
	const { rig, windows, info } = sinkMovedFloat();
	const state = getWindow(rig.registry, "b");
	sync(rig, info);
	assert.equal(toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES), "wiederhergestellt");
	sync(rig, info);
	info.fullScreen = true;
	info.frameGeometry = AREA;

	assert.equal(toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES), "gekachelt");
	assert.equal(state.floating, false);
	assert.deepEqual(state.floatRect, MOVED, "nicht die Vollbildfläche");
	rig.run(windows, "b");
});

test("während des Ziehens wird die Float-Geometrie noch nicht wiederhergestellt", () => {
	const { rig, info } = sinkMovedFloat();
	const writes = rig.port.writesFor("b");
	sync(rig, info);
	info.move = true;

	assert.equal(
		toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES),
		"gefloatetOhneWiederherstellung",
	);
	assert.equal(rig.port.writesFor("b"), writes);
	assert.deepEqual(getWindow(rig.registry, "b").floatRect, MOVED);
	assert.equal(getWindow(rig.registry, "b").floatRestorePending, true);
});

test("ein Sticky-Fenster floatet global in allen sichtbaren Surfaces", () => {
	const rig = epochRig();
	const info = windowInfo("a");
	info.desktopIds = [];
	info.activityIds = [];
	const views = [singleView(), view(OUTPUT, "desktop-zwei", ACTIVITY, AREA)];
	rig.port.place("a", START);
	rig.run([info], "a", views);
	sync(rig, info);
	assert.equal(toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES), "gefloatet");

	const result = rig.run([info], "a", views);
	assert.equal(result.plan.surfaces.length, 2);
	for (const surface of result.plan.surfaces) {
		assert.deepEqual(surface.members, ["a"]);
		assert.deepEqual(surface.participants, []);
	}
});

test("ein zweites Floaten am floatenden Fenster bleibt folgenlos", () => {
	const { rig, info } = sinkMovedFloat();
	sync(rig, info);
	assert.equal(toggleFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES), "wiederhergestellt");
	const state = getWindow(rig.registry, "b");
	const floatRect = state.floatRect;
	const writes = rig.port.writesFor("b");
	sync(rig, info);

	assert.equal(
		setFloat(rig.registry, rig.geometry, info, AREA, EXCLUDES, "float"),
		"bereitsGefloatet",
	);
	assert.equal(state.floating, true);
	assert.deepEqual(state.floatRect, floatRect);
	assert.equal(rig.port.writesFor("b"), writes, "bereitsGefloatet schreibt nicht");
});

test("Sink am gekachelten Fenster lässt Erwartung und Nachprüfung stehen", () => {
	const rig = epochRig();
	const a = windowInfo("a");
	const b = windowInfo("b");
	const windows = [a, b];
	for (const info of windows) {
		rig.port.place(info.id, START);
	}
	rig.run(windows, "b");
	// Ein Größenraster hält die Erwartung offen und plant eine Nachprüfung ein.
	rig.port.setAccept("b", () => ({ x: 10, y: 10, width: 880, height: 700 }));
	const target: Rect = { x: 5, y: 5, width: 900, height: 700 };
	rig.geometry.apply("b", target);
	assert.equal(rig.geometry.pendingCount(), 1);
	const state = getWindow(rig.registry, "b");
	const writes = rig.port.writesFor("b");
	sync(rig, b);

	assert.equal(setFloat(rig.registry, rig.geometry, b, AREA, EXCLUDES, "tile"), "bereitsGekachelt");
	assert.equal(state.floating, false);
	assert.deepEqual(state.expectedRect, target);
	assert.equal(rig.geometry.pendingCount(), 1);
	assert.equal(rig.port.writesFor("b"), writes, "bereitsGekachelt schreibt nicht");
});

test("Dialoge und Festfenster ändern beim Float-Toggle keinen Registry-Zustand", () => {
	const rig = epochRig();
	const dialog = windowInfo("dialog");
	dialog.dialog = true;
	const fixed = windowInfo("fest");
	fixed.minWidth = 400;
	fixed.minHeight = 300;
	fixed.maxWidth = 400;
	fixed.maxHeight = 300;

	assert.equal(toggleFloat(rig.registry, rig.geometry, dialog, AREA, EXCLUDES), "keinMitglied");
	assert.equal(toggleFloat(rig.registry, rig.geometry, fixed, AREA, EXCLUDES), "keinMitglied");
	assert.equal(rig.registry.windows.size, 0);
	assert.equal(rig.geometry.pendingCount(), 0);
});
