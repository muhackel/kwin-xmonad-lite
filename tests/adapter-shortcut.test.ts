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
	try {
		assert.equal(rig.tasten().length, 12);
		assert.equal(
			rig.tasten().every((name) => name.startsWith("xml-")),
			true,
		);
	} finally {
		rig.dispose();
	}
});

test("ein Anordnungslauf schreibt nie auf activeWindow", () => {
	// Daran hängt die Schleifenfreiheit: aktivieren löst `windowActivated` aus,
	// das eine Epoche anmeldet, und die Epoche aktiviert nie selbst.
	const rig = rigMitDreiFenstern();
	try {
		assert.deepEqual(rig.aktivierungen, []);
	} finally {
		rig.dispose();
	}
});

test("jeder Fokusbefehl setzt höchstens eine Aktivierung ab", () => {
	for (const befehl of FOKUSBEFEHLE) {
		const rig = rigMitDreiFenstern();
		try {
			rig.fokus("a");
			rig.taste(befehl);
			rig.beruhigen();
			assert.ok(
				rig.aktivierungen.length <= 1,
				`${befehl} setzte ${rig.aktivierungen.length} Aktivierungen ab: ${rig.aktivierungen.join(", ")}`,
			);
		} finally {
			rig.dispose();
		}
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
	try {
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
	} finally {
		rig.dispose();
	}
});

test("auch mehrere Befehle hintereinander bleiben bei einer Aktivierung je Befehl", () => {
	const rig = adapterRig({
		fenster: [rigFenster("m1"), rigFenster("m2"), rigFenster("m3"), rigFenster("dialog")],
		config: { debug: "true" },
	});
	try {
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
	} finally {
		rig.dispose();
	}
});

test("Layout- und Reihenfolgebefehle aktivieren gar nicht", () => {
	for (const befehl of ["xml-next-layout", "xml-shrink", "xml-expand", "xml-promote"]) {
		const rig = rigMitDreiFenstern();
		try {
			rig.fokus("a");
			rig.taste(befehl);
			rig.beruhigen();
			assert.deepEqual(
				rig.aktivierungen,
				[],
				`${befehl} hat aktiviert: ${rig.aktivierungen.join(", ")}`,
			);
		} finally {
			rig.dispose();
		}
	}
});

test("jede Aktivierung erzeugt genau eine aktiviere-Zeile, in derselben Reihenfolge", () => {
	const rig = rigMitDreiFenstern();
	try {
		rig.fokus("a");
		rig.taste("xml-focus-next");
		rig.beruhigen();
		rig.fokus("b");
		rig.taste("xml-focus-prev");
		rig.beruhigen();

		// `aktivierungen` zählt über `value.id` (das Feld des Rig-Fensters, ohne
		// Klammern), das Journal über die `WindowId` (`internalId`, mit
		// Klammern) -- dieselbe Doppelung, die `adapter.ts` als „Zwei
		// verschiedene Id-Normalisierungen" dokumentiert.
		const aktiviereZeilen = rig.logs.filter((zeile) => zeile.includes("aktiviere "));
		assert.equal(aktiviereZeilen.length, rig.aktivierungen.length);
		for (let i = 0; i < rig.aktivierungen.length; i++) {
			assert.ok(
				(aktiviereZeilen[i] ?? "").endsWith(`aktiviere {${rig.aktivierungen[i]}}`),
				`Zeile ${i}: ${aktiviereZeilen[i]} passt nicht zu ${rig.aktivierungen[i]}`,
			);
		}
	} finally {
		rig.dispose();
	}
});

test("die diagnose-Zeile erscheint nur bei aktivem debug", () => {
	// Jeder `adapterRig()`-Aufruf überschreibt `globalThis.workspace` sofort
	// (siehe Kommentar in `adapterrig.ts`). Der zweite Rig darf deshalb erst
	// entstehen, nachdem der erste seinen Lauf vollständig beendet hat --
	// sonst liefe `mitDebug.start()` auf dem Workspace von `ohneDebug`.
	const mitDebug = adapterRig({
		fenster: [rigFenster("a"), rigFenster("b")],
		config: { debug: "true" },
	});
	mitDebug.start();
	mitDebug.beruhigen();

	const ohneDebug = adapterRig({
		fenster: [rigFenster("a"), rigFenster("b")],
	});
	ohneDebug.start();
	ohneDebug.beruhigen();

	try {
		assert.ok(mitDebug.logs.some((zeile) => zeile.includes("diagnose ")));
		assert.equal(
			ohneDebug.logs.some((zeile) => zeile.includes("diagnose ")),
			false,
		);
	} finally {
		mitDebug.dispose();
		ohneDebug.dispose();
	}
});

test("xml-shrink löst eine Epoche mit grund=shortcut:shrink aus", () => {
	const rig = rigMitDreiFenstern();
	try {
		rig.taste("xml-shrink");
		rig.beruhigen();
		assert.ok(rig.logs.some((zeile) => zeile.includes("grund=shortcut:shrink")));
	} finally {
		rig.dispose();
	}
});

test("Fall 20b: ein Nichtmitglied als Umleitungsziel bleibt bei einer Aktivierung und einer aktiviere-Zeile", () => {
	// Der Dialog ist über drei unabhängige Kriterien gleichzeitig ein
	// Nichtmitglied (`filter.ts` schließt jedes davon einzeln aus) -- die
	// Kombination steht für den modalen Dialog aus Fall 20b, nicht für einen
	// bestimmten Ausschlussgrund.
	const dialogFenster = rigFenster("dialog", undefined, {
		dialog: true,
		modal: true,
		transient: true,
	});
	const rig = adapterRig({
		fenster: [rigFenster("m1"), rigFenster("m2"), rigFenster("m3"), dialogFenster],
		config: { debug: "true" },
	});
	try {
		rig.start();
		rig.beruhigen();
		assert.ok(rig.logs.some((zeile) => zeile.includes("mitglieder=3")));

		rig.fokus("m3");
		rig.umleitenAuf("dialog");
		rig.taste("xml-focus-next");
		rig.beruhigen();

		assert.equal(rig.aktivierungen.length, 1);
		const aktiviereZeilen = rig.logs.filter((zeile) => zeile.includes("aktiviere "));
		assert.equal(aktiviereZeilen.length, 1);
	} finally {
		rig.dispose();
	}
});

test("Full-Layout: jeder Fokusbefehl hebt und aktiviert höchstens einmal", () => {
	const rig = rigMitDreiFenstern();
	// Der Marker sitzt bewusst auf der `surface`-Zeile der Epoche
	// (`surface <key> layout=full n=…`), nicht auf der `befehl`-Zeile des
	// Kommandos selbst -- die meldet `layout=full` schon, sobald `nextLayout`
	// die Registry umstellt, auch ohne dass danach je eine Epoche läuft.
	const vollLayoutGemeldet = (): boolean =>
		rig.logs.some((zeile) => zeile.includes("layout=full n="));
	try {
		let versuche = 0;
		while (!vollLayoutGemeldet() && versuche < 8) {
			rig.taste("xml-next-layout");
			rig.beruhigen();
			versuche += 1;
		}
		assert.ok(vollLayoutGemeldet(), "full-Layout nicht erreicht");

		for (const befehl of FOKUSBEFEHLE) {
			rig.aktivierungen.length = 0;
			rig.taste(befehl);
			rig.beruhigen();
			assert.ok(rig.hebungen.length > 0, `${befehl}: keine Hebung im Full-Layout`);
			assert.ok(
				rig.aktivierungen.length <= 1,
				`${befehl}: ${rig.aktivierungen.length} Aktivierungen`,
			);
		}
	} finally {
		rig.dispose();
	}
});
