import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DEFAULT_EXCLUDES,
	makeExcludes,
	membersBySurface,
	surfaceKeysFor,
} from "../src/kwin/filter.ts";
import {
	ACTIVITY,
	AREA,
	DESKTOP,
	OUTPUT,
	singleView,
	view,
	windowInfo,
} from "./support/kwinfake.ts";

const EXCLUDES = makeExcludes(DEFAULT_EXCLUDES);

const DESKTOP_2 = "11111111-2222-3333-4444-555555555555";
const ACTIVITY_2 = "99999999-8888-7777-6666-555555555555";
const OUTPUT_2 = "DP-9";

test("ein Fenster gehört zur Surface seiner Ausgabe", () => {
	const info = windowInfo("a");
	const views = [singleView(), view(OUTPUT_2, DESKTOP, ACTIVITY, AREA)];
	assert.deepEqual(surfaceKeysFor(info, views), [`${ACTIVITY}|${DESKTOP}|${OUTPUT}`]);
});

test("ein Fenster einer fremden Ausgabe steht in keiner Surface", () => {
	const info = windowInfo("a");
	info.outputName = OUTPUT_2;
	assert.deepEqual(surfaceKeysFor(info, [singleView()]), []);
});

test("ein Fenster ohne Ausgabe steht in keiner Surface", () => {
	const info = windowInfo("a");
	info.outputName = "";
	assert.deepEqual(surfaceKeysFor(info, [singleView()]), []);
});

test("eine leere Desktopliste heißt alle Desktops", () => {
	// So meldet sich ein Fenster auf allen Desktops, an einem Dock gemessen.
	const info = windowInfo("a");
	info.desktopIds = [];
	info.onAllDesktops = true;
	const views = [singleView(), view(OUTPUT, DESKTOP_2, ACTIVITY, AREA)];
	assert.equal(surfaceKeysFor(info, views).length, 2);
});

test("eine leere Activityliste heißt alle Activities", () => {
	const info = windowInfo("a");
	info.activityIds = [];
	const views = [singleView(), view(OUTPUT, DESKTOP, ACTIVITY_2, AREA)];
	assert.equal(surfaceKeysFor(info, views).length, 2);
});

test("ein Fenster auf zwei Desktops steht in beiden Surfaces", () => {
	const info = windowInfo("a");
	info.desktopIds = [DESKTOP, DESKTOP_2];
	const views = [singleView(), view(OUTPUT, DESKTOP_2, ACTIVITY, AREA)];
	assert.equal(surfaceKeysFor(info, views).length, 2);
});

test("ein Fenster einer fremden Activity steht in keiner Surface", () => {
	const info = windowInfo("a");
	info.activityIds = [ACTIVITY_2];
	assert.deepEqual(surfaceKeysFor(info, [singleView()]), []);
});

test("die Mitgliederliste behält die Reihenfolge der Fensterliste", () => {
	const views = [singleView()];
	const windows = [windowInfo("a"), windowInfo("b"), windowInfo("c")];
	const members = membersBySurface(windows, views, EXCLUDES);
	assert.deepEqual(members.get(views[0]?.key ?? ""), ["a", "b", "c"]);
});

test("ausgeschlossene Fenster tauchen in keiner Surface auf", () => {
	const views = [singleView()];
	const panel = windowInfo("panel");
	panel.normalWindow = false;
	panel.specialWindow = true;
	const windows = [panel, windowInfo("a")];
	assert.deepEqual(membersBySurface(windows, views, EXCLUDES).get(views[0]?.key ?? ""), ["a"]);
});

test("eine Surface ohne Mitglieder erhält eine leere Liste", () => {
	// Ohne diesen Eintrag behielte eine geräumte Surface ihren alten Stapel.
	const views = [singleView()];
	const members = membersBySurface([], views, EXCLUDES);
	assert.equal(members.size, 1);
	assert.deepEqual(members.get(views[0]?.key ?? ""), []);
});

test("ein Sticky-Fenster landet in jeder Surface seiner Ausgabe", () => {
	const sticky = windowInfo("sticky");
	sticky.desktopIds = [];
	sticky.activityIds = [];
	const views = [singleView(), view(OUTPUT, DESKTOP_2, ACTIVITY_2, AREA)];
	const members = membersBySurface([sticky], views, EXCLUDES);
	assert.deepEqual(members.get(views[0]?.key ?? ""), ["sticky"]);
	assert.deepEqual(members.get(views[1]?.key ?? ""), ["sticky"]);
});
