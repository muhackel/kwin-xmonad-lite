/**
 * Fall 20b, strukturell: wie oft schreibt der Controller je Befehl auf
 * `workspace.activeWindow`?
 *
 * Live ist das nicht zählbar. Das Journal meldet `aktiviere <id>`, aber diese
 * Zeile schreibt der Controller über sich selbst -- sie belegt, dass er es
 * einmal *sagt*, nicht dass er es einmal *tut*. `checks.activate-once` erzwingt
 * genau eine Schreibstelle im Quelltext, sagt aber nichts darüber, wie oft sie
 * je Befehl durchlaufen wird.
 *
 * Hier zählt der Setter selbst. Die Tests bilden dabei den Fall nach, um den es
 * geht: KWin nimmt die Aktivierung an und gibt den Fokus trotzdem einem anderen
 * Fenster -- dem modalen Dialog.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { adapterRig, rigFenster } from "./support/adapterrig.ts";

const FOKUSBEFEHLE = ["xml-focus-next", "xml-focus-prev", "xml-focus-master"];

function rigMitDreiFenstern(): ReturnType<typeof adapterRig> {
	const rig = adapterRig({
		fenster: [rigFenster("a"), rigFenster("b"), rigFenster("c")],
		config: { debug: "true" },
	});
	rig.start();
	rig.beruhigen();
	return rig;
}

test("das Rig erreicht den Adapter und registriert alle zwölf Kürzel", () => {
	const rig = rigMitDreiFenstern();
	assert.equal(rig.tasten().length, 12);
	assert.equal(
		rig.tasten().every((name) => name.startsWith("xml-")),
		true,
	);
});

test("ein Anordnungslauf schreibt nie auf activeWindow", () => {
	// Daran hängt die Schleifenfreiheit: aktivieren löst `windowActivated` aus,
	// das eine Epoche anmeldet, und die Epoche aktiviert nie selbst.
	const rig = rigMitDreiFenstern();
	assert.deepEqual(rig.aktivierungen, []);
});

test("jeder Fokusbefehl setzt höchstens eine Aktivierung ab", () => {
	for (const befehl of FOKUSBEFEHLE) {
		const rig = rigMitDreiFenstern();
		rig.fokus("a");
		rig.taste(befehl);
		rig.beruhigen();
		assert.ok(
			rig.aktivierungen.length <= 1,
			`${befehl} setzte ${rig.aktivierungen.length} Aktivierungen ab: ${rig.aktivierungen.join(", ")}`,
		);
	}
});

test("Fall 20b: eine umgeleitete Aktivierung wird nicht wiederholt", () => {
	// KWin nimmt die Aktivierung an und gibt den Fokus dem modalen Dialog.
	// Der Controller darf daraufhin **nicht** erneut aktivieren -- sonst
	// entstünde genau die Schleife, die Fall 20b ausschließen soll.
	const rig = adapterRig({
		fenster: [rigFenster("m1"), rigFenster("m2"), rigFenster("m3"), rigFenster("dialog")],
		config: { debug: "true" },
	});
	rig.start();
	rig.beruhigen();
	rig.fokus("m3");
	rig.umleitenAuf("dialog");

	rig.taste("xml-focus-next");
	rig.beruhigen();

	assert.equal(
		rig.aktivierungen.length,
		1,
		`erwartet genau eine Aktivierung, gezählt ${rig.aktivierungen.length}: ${rig.aktivierungen.join(", ")}`,
	);
});

test("auch mehrere Befehle hintereinander bleiben bei einer Aktivierung je Befehl", () => {
	const rig = adapterRig({
		fenster: [rigFenster("m1"), rigFenster("m2"), rigFenster("m3"), rigFenster("dialog")],
		config: { debug: "true" },
	});
	rig.start();
	rig.beruhigen();
	rig.fokus("m1");
	rig.umleitenAuf("dialog");

	for (let i = 0; i < 3; i++) {
		rig.taste("xml-focus-next");
		rig.beruhigen();
	}

	assert.ok(
		rig.aktivierungen.length <= 3,
		`drei Befehle, ${rig.aktivierungen.length} Aktivierungen: ${rig.aktivierungen.join(", ")}`,
	);
});

test("Layout- und Reihenfolgebefehle aktivieren gar nicht", () => {
	for (const befehl of ["xml-next-layout", "xml-shrink", "xml-expand", "xml-promote"]) {
		const rig = rigMitDreiFenstern();
		rig.fokus("a");
		rig.taste(befehl);
		rig.beruhigen();
		assert.deepEqual(
			rig.aktivierungen,
			[],
			`${befehl} hat aktiviert: ${rig.aktivierungen.join(", ")}`,
		);
	}
});
