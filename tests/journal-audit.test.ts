import assert from "node:assert/strict";
import { test } from "node:test";

import {
	istNutzerGrund,
	parseEreignisse,
	pruefe,
	pruefeAlltagsstunde,
} from "../dev/probe/journal-audit.ts";

const HOST = "SPIELKISTE kwin_wayland[3200]: kwin-xmonad-lite:";

/** Zeitstempel in der Form, die `journalctl -o short-iso` liefert. */
function zeile(minute: number, sekunde: number, text: string): string {
	const basis = Date.UTC(2026, 8, 6, 8, minute, sekunde);
	const iso = new Date(basis).toISOString().slice(0, 19);
	return `${iso}+00:00 ${HOST} ${text}`;
}

function fehler(bericht: ReturnType<typeof pruefe>): string[] {
	return bericht.befunde.filter((befund) => befund.level === "fehler").map((befund) => befund.text);
}

test("ein ruhiger Auszug besteht", () => {
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=start surfaces=1 mitglieder=2 teilnehmer=2"),
		zeile(0, 1, "apply {a} soll=1248x1050+0+0"),
		zeile(0, 1, "apply {b} soll=672x1050+1248+0"),
		zeile(5, 0, "arrange #2 grund=windowAdded surfaces=1 mitglieder=3 teilnehmer=3"),
		zeile(5, 0, "apply {c} soll=672x525+1248+525"),
	].join("\n");
	const bericht = pruefe(parseEreignisse(text));
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.schreibvorgaenge, 3);
	assert.equal(bericht.unklar, 0);
});

test("die Rückkopplung extern und arrange und apply wird als Schleife erkannt", () => {
	// Genau der Fall, den ein Auditor durchließe, der `geometrieExtern` als
	// neuen Anlass gelten lässt: der Zähler würde bei jedem Durchgang
	// zurückgesetzt und die Schleife liefe unbemerkt weiter.
	const zeilen = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 6; i++) {
		zeilen.push(zeile(0, 10 + i, "extern {a}"));
		zeilen.push(
			zeile(0, 10 + i, "arrange #2 grund=geometrieExtern surfaces=1 mitglieder=2 teilnehmer=2"),
		);
		zeilen.push(zeile(0, 10 + i, "apply {a} soll=1248x1050+0+0"));
	}
	const bericht = pruefe(parseEreignisse(zeilen.join("\n")));
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((text) => text.includes("dasselbe Soll") || text.includes("Rückkopplung")),
		true,
	);
});

test("Nachbesserungen zwischen unabhängigen Läufen sind keine Schleife", () => {
	// `nachbessern` gehört zur Schreibgeneration des Fensters. Zwischen den
	// beiden Läufen liegt jeweils eine Nutzeraktion; das ist der normale,
	// vorgesehene Ablauf und darf nicht als Schleife gelten.
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=windowAdded surfaces=1 mitglieder=2 teilnehmer=2"),
		zeile(0, 1, "apply {a} soll=896x235+0+0"),
		zeile(0, 2, "nachbessern {a} versuch=1 ist=894x223+0+0 soll=896x235+0+0"),
		zeile(0, 3, "nachbessern {a} versuch=2 ist=894x223+0+0 soll=896x235+0+0"),
		zeile(10, 0, "arrange #2 grund=shortcut:promote surfaces=1 mitglieder=2 teilnehmer=2"),
		zeile(10, 0, "apply {a} soll=672x525+1248+0"),
		zeile(10, 1, "nachbessern {a} versuch=1 ist=670x520+1248+0 soll=672x525+1248+0"),
	].join("\n");
	const bericht = pruefe(parseEreignisse(text));
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.bestanden, true);
});

test("Nachbesserungen zählen als Schreibvorgänge mit", () => {
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=nachlauf500:dockGeometrie surfaces=1 mitglieder=1 teilnehmer=1"),
		zeile(0, 1, "apply {a} soll=896x235+0+0"),
		zeile(0, 2, "nachbessern {a} versuch=1 ist=894x223+0+0 soll=896x235+0+0"),
		zeile(0, 3, "nachbessern {a} versuch=2 ist=894x223+0+0 soll=896x235+0+0"),
		zeile(0, 4, "nachbessern {a} versuch=3 ist=894x223+0+0 soll=896x235+0+0"),
	].join("\n");
	const bericht = pruefe(parseEreignisse(text));
	assert.equal(bericht.schreibvorgaenge, 4);
	assert.equal(bericht.bestanden, false);
});

test("ein Schreibvorgang ohne vorangehenden Lauf ist manuell zu prüfen", () => {
	const text = [zeile(0, 1, "apply {a} soll=1248x1050+0+0")].join("\n");
	const bericht = pruefe(parseEreignisse(text));
	assert.equal(bericht.unklar, 1);
	assert.equal(
		bericht.befunde.some((befund) => befund.level === "manuell"),
		true,
	);
	assert.equal(bericht.bestanden, false);
});

test("float zählt als Schreibart mit", () => {
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=floatToggle surfaces=1 mitglieder=1 teilnehmer=0"),
		zeile(0, 1, "float {a} soll=800x600+100+100"),
	].join("\n");
	const bericht = pruefe(parseEreignisse(text));
	assert.equal(bericht.schreibvorgaenge, 1);
});

test("technische Gründe setzen den Zähler nicht zurück", () => {
	const zeilen = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 5; i++) {
		zeilen.push(
			zeile(
				0,
				10 + i,
				"arrange #2 grund=nachlauf1500:screensChanged surfaces=1 mitglieder=1 teilnehmer=1",
			),
		);
		zeilen.push(zeile(0, 10 + i, "apply {a} soll=1248x1050+0+0"));
	}
	const bericht = pruefe(parseEreignisse(zeilen.join("\n")));
	assert.equal(bericht.bestanden, false);
});

test("ein nutzerveranlasster Grund macht das Ziel wieder frei", () => {
	const zeilen = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 5; i++) {
		zeilen.push(
			zeile(0, 10 + i, "arrange #2 grund=shortcut:focusNext surfaces=1 mitglieder=1 teilnehmer=1"),
		);
		zeilen.push(zeile(0, 10 + i, "apply {a} soll=1248x1050+0+0"));
	}
	const bericht = pruefe(parseEreignisse(zeilen.join("\n")));
	assert.equal(bericht.bestanden, true);
});

test("die Grundnamen des Adapters werden erkannt", () => {
	assert.equal(istNutzerGrund("desktopChanged"), true);
	assert.equal(istNutzerGrund("activityChanged"), true);
	assert.equal(istNutzerGrund("shortcut:expand"), true);
	assert.equal(istNutzerGrund("windowActivated,shortcut:focusNext"), true);
	assert.equal(istNutzerGrund("geometrieExtern"), false);
	assert.equal(istNutzerGrund("nachlauf500:dockHinzugefügt"), false);
	// Die Namen der KWin-Signale sind nicht die Gründe des Adapters.
	assert.equal(istNutzerGrund("currentDesktopChanged"), false);
});

test("ein zu kurzer Auszug gilt als nicht ausreichend belegt", () => {
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=start surfaces=1 mitglieder=1 teilnehmer=1"),
		zeile(30, 0, "apply {a} soll=1248x1050+0+0"),
	].join("\n");
	const bericht = pruefeAlltagsstunde(text);
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((eintrag) => eintrag.includes("nicht ausreichend belegt")),
		true,
	);
});

test("ein zweiter Skriptlauf in der Stunde gilt als nicht ausreichend belegt", () => {
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=start surfaces=1 mitglieder=1 teilnehmer=1"),
		zeile(30, 0, "geladen, Version 0.0.0"),
		zeile(61, 0, "arrange #1 grund=start surfaces=1 mitglieder=1 teilnehmer=1"),
	].join("\n");
	const bericht = pruefeAlltagsstunde(text);
	assert.equal(
		fehler(bericht).some((eintrag) => eintrag.includes("Skriptläufe")),
		true,
	);
});

test("eine volle ruhige Stunde besteht", () => {
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=start surfaces=3 mitglieder=6 teilnehmer=6"),
		zeile(0, 1, "apply {a} soll=1664x1410+0+0"),
		zeile(20, 0, "arrange #2 grund=windowActivated surfaces=3 mitglieder=6 teilnehmer=6"),
		zeile(45, 0, "arrange #3 grund=shortcut:promote surfaces=3 mitglieder=6 teilnehmer=6"),
		zeile(45, 0, "apply {a} soll=896x705+1664+0"),
		zeile(61, 0, "arrange #4 grund=windowRemoved surfaces=3 mitglieder=5 teilnehmer=5"),
	].join("\n");
	const bericht = pruefeAlltagsstunde(text);
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.bestanden, true);
});

// ---------------------------------------------------------------------------
// Nachbesserungen aus dem Audit vom 2026-09-06.
// ---------------------------------------------------------------------------

/** Eine Marke, wie `systemd-cat -t kxl-abnahme` sie schreibt: eigene PID. */
function marke(minute: number, sekunde: number, text: string): string {
	const basis = Date.UTC(2026, 8, 6, 8, minute, sekunde);
	const iso = new Date(basis).toISOString().slice(0, 19);
	return `${iso}+00:00 SPIELKISTE kxl-abnahme[9999]: ${text}`;
}

/** Eine Controllerzeile unter abweichender PID: nach einem `replace`. */
function fremdeZeile(minute: number, sekunde: number, text: string): string {
	const basis = Date.UTC(2026, 8, 6, 8, minute, sekunde);
	const iso = new Date(basis).toISOString().slice(0, 19);
	return `${iso}+00:00 SPIELKISTE kwin_wayland[9100]: kwin-xmonad-lite: ${text}`;
}

/** Eine Stunde ruhiger Betrieb, in die sich Einzelfälle einsetzen lassen. */
function stunde(zeilen: string[]): string {
	return [
		marke(0, 0, "== Fall 27 Anfang =="),
		zeile(0, 1, "arrange #1 grund=start surfaces=1 mitglieder=2 teilnehmer=2"),
		zeile(0, 1, "apply {a} soll=1248x1050+0+0"),
		...zeilen,
		zeile(61, 0, "arrange #2 grund=windowAdded surfaces=1 mitglieder=2 teilnehmer=2"),
		marke(61, 30, "== Fall 27 Ende =="),
	].join("\n");
}

test("ein einzelner Skriptneustart mitten im Auszug fällt auf", () => {
	// Die alte Schwelle sprang erst bei zwei `geladen`-Zeilen an; genau eine
	// mitten im Auszug lief durch.
	const bericht = pruefeAlltagsstunde(stunde([zeile(30, 0, "geladen, Version 0.0.0")]));
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((text) => text.includes("Skriptneustart mitten im Auszug")),
		true,
	);
});

test("ein Auszug ohne geladen-Zeile besteht bei einer PID und lückenloser Folge", () => {
	// Genau die Lage des echten Fall-27-Artefakts: der Auszug beginnt mitten im
	// Lauf. Belegt wird die Kontinuität dann über PID und Epochenfolge.
	const bericht = pruefeAlltagsstunde(stunde([]));
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.bestanden, true);
});

test("eine Lücke in der Folge der Anordnungsläufe fällt auf", () => {
	const bericht = pruefeAlltagsstunde(
		stunde([zeile(30, 0, "arrange #100 grund=windowAdded surfaces=1 mitglieder=2 teilnehmer=2")]),
	);
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((text) => text.includes("Journallücke")),
		true,
	);
});

test("Zeilen zweier KWin-Prozesse belegen keine durchgehende Stunde", () => {
	const bericht = pruefeAlltagsstunde(
		stunde([
			fremdeZeile(30, 0, "arrange #2 grund=windowAdded surfaces=1 mitglieder=2 teilnehmer=2"),
		]),
	);
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((text) => text.includes("KWin-Prozessen")),
		true,
	);
});

test("ein unerwartetes Give-up ist im Stundenmodus ein Fehler", () => {
	const bericht = pruefeAlltagsstunde(
		stunde([zeile(30, 0, "aufgegeben {b} nach 2 Versuchen, ist=670x520+1248+0")]),
	);
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((text) => text.includes("außerhalb eines bewusst provozierten Falls")),
		true,
	);
});

test("ein provoziertes Give-up bleibt ein Hinweis", () => {
	const bericht = pruefeAlltagsstunde(
		stunde([zeile(30, 0, "aufgegeben {b} nach 2 Versuchen, ist=670x520+1248+0")]),
		{ provoziert: ["{b}"] },
	);
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.bestanden, true);
});

test("eine Nachbesserung ohne vorangehenden apply ist nicht zuzuordnen", () => {
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=start surfaces=1 mitglieder=1 teilnehmer=1"),
		zeile(0, 2, "nachbessern {x} versuch=1 ist=100x100+0+0 soll=200x200+0+0"),
	].join("\n");
	const bericht = pruefe(parseEreignisse(text));
	assert.equal(bericht.unklar, 1);
	assert.equal(
		bericht.befunde.some(
			(befund) => befund.level === "manuell" && befund.text.includes("ohne vorangehenden"),
		),
		true,
	);
});

test("zwei Fenster mit verschränkten extern-Ketten werden beide erkannt", () => {
	// Die frühere globale Kette wurde von jedem Wechsel zurückgesetzt; zwei
	// abwechselnd meldende Fenster kamen nie über eins hinaus.
	const zeilen = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 5; i++) {
		zeilen.push(zeile(1, i, "extern {a}"));
		zeilen.push(zeile(1, i, "extern {b}"));
		zeilen.push(
			zeile(1, i, "arrange #1 grund=geometrieExtern surfaces=1 mitglieder=2 teilnehmer=2"),
		);
	}
	const bericht = pruefe(parseEreignisse(zeilen.join("\n")));
	assert.equal(
		fehler(bericht).some((text) => text.includes("{a}")),
		true,
	);
	assert.equal(
		fehler(bericht).some((text) => text.includes("{b}")),
		true,
	);
});

test("die Fallmarken grenzen den Prüfzeitraum ab", () => {
	// Der Auszug reicht über eine Stunde, der markierte Fall dauert 40 Minuten.
	// Vorher zählte die Spanne aller Zeilen und der Fall bestand.
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=start surfaces=1 mitglieder=1 teilnehmer=1"),
		marke(10, 0, "== Fall 27 Anfang =="),
		zeile(30, 0, "arrange #2 grund=windowAdded surfaces=1 mitglieder=1 teilnehmer=1"),
		marke(50, 0, "== Fall 27 Ende =="),
		zeile(70, 0, "arrange #3 grund=windowAdded surfaces=1 mitglieder=1 teilnehmer=1"),
	].join("\n");
	const bericht = pruefeAlltagsstunde(text);
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((text2) => text2.includes("40.0 min")),
		true,
	);
});
