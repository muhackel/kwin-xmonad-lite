import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DEFAULT_EXCLUDES,
	isFixedSize,
	isMember,
	makeExcludes,
	normalizeClass,
	participates,
	UNLIMITED_SIZE,
} from "../src/kwin/filter.ts";
import { windowInfo } from "./support/kwinfake.ts";

const EXCLUDES = makeExcludes(DEFAULT_EXCLUDES);

test("ein gewoehnliches Fenster ist Surface-Mitglied und Layout-Teilnehmer", () => {
	const info = windowInfo("a");
	assert.equal(isMember(info, EXCLUDES), true);
	assert.equal(participates(info, false), true);
});

test("ein Vollbildfenster bleibt Mitglied, obwohl moveable und resizeable false sind", () => {
	// Genau die Werte, die an KWin 6.7.4 gemessen wurden.
	const info = windowInfo("a");
	info.fullScreen = true;
	info.maximizeMode = 3;
	info.moveable = false;
	info.resizeable = false;

	assert.equal(isMember(info, EXCLUDES), true, "sonst verliert es seinen Platz");
	assert.equal(participates(info, false), false);
});

test("Dialog, Transient, Modal, Splash, Utility, Popup und Dock sind keine Mitglieder", () => {
	const felder = ["dialog", "transient", "modal", "splash", "utility", "popupWindow", "dock"];
	for (const feld of felder) {
		const info = windowInfo("a");
		(info as unknown as Record<string, boolean>)[feld] = true;
		assert.equal(isMember(info, EXCLUDES), false, `${feld} sollte ausschliessen`);
	}
});

test("ein Fenster ohne normalWindow faellt heraus", () => {
	const info = windowInfo("a");
	info.normalWindow = false;
	assert.equal(isMember(info, EXCLUDES), false);
});

test("ein specialWindow faellt heraus", () => {
	// So meldet sich das gemessene Plasma-Panel.
	const info = windowInfo("a");
	info.specialWindow = true;
	assert.equal(isMember(info, EXCLUDES), false);
});

test("nicht verwaltete und geloeschte Fenster fallen heraus", () => {
	const unmanaged = windowInfo("a");
	unmanaged.managed = false;
	assert.equal(isMember(unmanaged, EXCLUDES), false);

	const gone = windowInfo("b");
	gone.deleted = true;
	assert.equal(isMember(gone, EXCLUDES), false);
});

test("die Ausschlussliste trifft nur bei Vollmatch der Klasse", () => {
	const raus = windowInfo("a");
	raus.resourceClass = "plasmashell";
	assert.equal(isMember(raus, EXCLUDES), false);

	const drin = windowInfo("b");
	drin.resourceClass = "plasmashell-testbed";
	assert.equal(isMember(drin, EXCLUDES), true, "Teilzeichenkette darf nicht greifen");
});

test("Grossschreibung und Leerraum stoeren den Ausschluss nicht", () => {
	assert.equal(normalizeClass("  KRunner "), "krunner");
	const info = windowInfo("a");
	info.resourceClass = "  KRunner ";
	assert.equal(isMember(info, EXCLUDES), false);
});

test("gleiche Mindest- und Hoechstgroesse macht ein Fenster fest", () => {
	const info = windowInfo("a");
	info.minWidth = 400;
	info.minHeight = 300;
	info.maxWidth = 400;
	info.maxHeight = 300;
	assert.equal(isFixedSize(info), true);
	assert.equal(isMember(info, EXCLUDES), false);
});

test("die Hoechstgroesse 2147483647 macht ein Fenster nicht fest", () => {
	const info = windowInfo("a");
	info.minWidth = UNLIMITED_SIZE;
	info.minHeight = UNLIMITED_SIZE;
	assert.equal(isFixedSize(info), false, "unbegrenzt ist keine Festgroesse");
	assert.equal(isMember(info, EXCLUDES), true);
});

test("ein Fenster mit Nullgroessen gilt nicht als fest", () => {
	// Das gemessene Dock meldet minSize 0x0; ohne die Null-Sperre waere das
	// eine Festgroesse, sobald maxSize je einmal ebenfalls 0 meldet.
	const info = windowInfo("a");
	info.minWidth = 0;
	info.minHeight = 0;
	info.maxWidth = 0;
	info.maxHeight = 0;
	assert.equal(isFixedSize(info), false);
});

test("Layout-Teilnahme faellt bei floating, minimiert, Vollbild und Maximierung weg", () => {
	assert.equal(participates(windowInfo("a"), true), false, "floating");

	const minimiert = windowInfo("b");
	minimiert.minimized = true;
	assert.equal(participates(minimiert, false), false);

	const voll = windowInfo("c");
	voll.fullScreen = true;
	assert.equal(participates(voll, false), false);

	const max = windowInfo("d");
	max.maximizeMode = 3;
	assert.equal(participates(max, false), false);
});

test("Layout-Teilnahme verlangt moveable und resizeable", () => {
	const unbeweglich = windowInfo("a");
	unbeweglich.moveable = false;
	assert.equal(participates(unbeweglich, false), false);

	const starr = windowInfo("b");
	starr.resizeable = false;
	assert.equal(participates(starr, false), false);
});

test("eine teilweise Maximierung schaltet die Teilnahme ebenfalls ab", () => {
	for (const modus of [1, 2, 3]) {
		const info = windowInfo("a");
		info.maximizeMode = modus;
		assert.equal(participates(info, false), false, `maximizeMode ${modus}`);
	}
});
