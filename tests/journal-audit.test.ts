import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
	istNutzerGrund,
	istNutzerTeil,
	MIN_LAEUFE,
	MIN_SCHREIBVORGAENGE,
	NUTZER_GRUENDE,
	parseEreignisse,
	pruefe,
	pruefeAlltagsstunde,
	TECHNISCHE_GRUENDE,
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

/**
 * Ruhiger Alltagsbetrieb ab Anordnungslauf `von`: je Minute ein Lauf mit einem
 * Nutzergrund und ein `apply` auf ein eigenes Soll. Die Mindestaktivität der
 * Stundenprüfung verlangt Betrieb, keine leere Stunde -- ohne diesen Füller
 * belegte ein Auszug mit drei Zeilen eine Stunde Schleifenfreiheit.
 */
function alltag(von: number, anzahl: number): string[] {
	const zeilen: string[] = [];
	for (let i = 0; i < anzahl; i++) {
		const nummer = von + i;
		zeilen.push(
			zeile(
				1 + i,
				0,
				`arrange #${nummer} grund=windowActivated surfaces=3 mitglieder=6 teilnehmer=6`,
			),
		);
		zeilen.push(zeile(1 + i, 0, `apply {f${i}} soll=896x${700 + i}+1664+0`));
	}
	return zeilen;
}

test("eine volle ruhige Stunde besteht", () => {
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=start surfaces=3 mitglieder=6 teilnehmer=6"),
		zeile(0, 1, "apply {a} soll=1664x1410+0+0"),
		...alltag(2, 9),
		zeile(45, 0, "arrange #11 grund=shortcut:promote surfaces=3 mitglieder=6 teilnehmer=6"),
		zeile(45, 0, "apply {a} soll=896x705+1664+0"),
		zeile(61, 0, "arrange #12 grund=windowRemoved surfaces=3 mitglieder=5 teilnehmer=5"),
	].join("\n");
	const bericht = pruefeAlltagsstunde(text);
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.bestanden, true);
	assert.equal(bericht.laeufe, 12);
	assert.equal(bericht.nutzerlaeufe, 12);
	assert.equal(bericht.schreibvorgaenge, 11);
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
		...alltag(2, 9),
		...zeilen,
		zeile(61, 0, "arrange #11 grund=windowAdded surfaces=1 mitglieder=2 teilnehmer=2"),
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

// ---------------------------------------------------------------------------
// Schärfung aus dem Audit vom 2026-09-06: reiner Nutzeranlass, Freigabe je
// beschriebenem Fenster.
// ---------------------------------------------------------------------------

test("ein Sammelgrund mit technischem Teil maskiert die Schleife nicht mehr", () => {
	// Der Entpreller koalesziert; `geometrieExtern` trifft im Betrieb fast
	// immer mit einem Fensterereignis zusammen. Unter der alten ODER-Regel war
	// dieser Lauf nutzerveranlasst und gab jedes Ziel frei.
	const zeilen = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 5; i++) {
		zeilen.push(
			zeile(
				0,
				10 + i,
				"arrange #2 grund=geometrieExtern,windowActivated surfaces=1 mitglieder=1 teilnehmer=1",
			),
		);
		zeilen.push(zeile(0, 10 + i, "apply {a} soll=1248x1050+0+0"));
	}
	const bericht = pruefe(parseEreignisse(zeilen.join("\n")));
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((text) => text.includes("dasselbe Soll")),
		true,
	);
});

test("ein Nutzerlauf an einem fremden Fenster gibt die Schleife nicht frei", () => {
	// Die alte globale Freigabe leerte `stand` komplett: ein Klick irgendwo im
	// Betrieb hob die Kette an {a} auf, obwohl {a} gar nicht angefasst wurde.
	const zeilen = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 4; i++) {
		zeilen.push(
			zeile(0, 10 + i, "arrange #2 grund=geometrieExtern surfaces=1 mitglieder=2 teilnehmer=2"),
		);
		zeilen.push(zeile(0, 10 + i, "apply {a} soll=1248x1050+0+0"));
		zeilen.push(
			zeile(0, 20 + i, "arrange #3 grund=windowActivated surfaces=1 mitglieder=2 teilnehmer=2"),
		);
		zeilen.push(zeile(0, 20 + i, `apply {b} soll=672x${500 + i}+1248+0`));
	}
	const bericht = pruefe(parseEreignisse(zeilen.join("\n")));
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((text) => text.includes("{a}") && text.includes("dasselbe Soll")),
		true,
	);
});

test("ein Nutzerlauf, der das Fenster selbst beschreibt, gibt es frei", () => {
	// Gegenprobe zum vorigen Test: derselbe Ablauf, aber der Nutzerlauf fasst
	// {a} an. Genau das ist der Alltagsfall (Ziehen, Toggle), und er darf nicht
	// als Schleife gelten.
	const zeilen = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 4; i++) {
		zeilen.push(
			zeile(0, 10 + i, "arrange #2 grund=geometrieExtern surfaces=1 mitglieder=2 teilnehmer=2"),
		);
		zeilen.push(zeile(0, 10 + i, "apply {a} soll=1248x1050+0+0"));
		zeilen.push(
			zeile(0, 20 + i, "arrange #3 grund=moveResizeFinished surfaces=1 mitglieder=2 teilnehmer=2"),
		);
		zeilen.push(zeile(0, 20 + i, "apply {a} soll=1248x1050+0+0"));
		zeilen.push(zeile(0, 20 + i, `apply {b} soll=672x${500 + i}+1248+0`));
	}
	const bericht = pruefe(parseEreignisse(zeilen.join("\n")));
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.bestanden, true);
});

test("die extern-Kette eines Fensters löst nur ein Schreibvorgang an ihm", () => {
	const gemeinsam = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 3; i++) {
		gemeinsam.push(zeile(0, 10 + i, "extern {a}"));
		gemeinsam.push(
			zeile(0, 10 + i, "arrange #2 grund=geometrieExtern surfaces=1 mitglieder=2 teilnehmer=2"),
		);
	}
	const nutzerlauf = zeile(
		0,
		30,
		"arrange #3 grund=windowActivated surfaces=1 mitglieder=2 teilnehmer=2",
	);

	const fremd = pruefe(
		parseEreignisse(
			[
				...gemeinsam,
				nutzerlauf,
				zeile(0, 30, "apply {b} soll=672x500+1248+0"),
				zeile(0, 40, "extern {a}"),
			].join("\n"),
		),
	);
	assert.equal(
		fehler(fremd).some((text) => text.includes("Rückkopplung") && text.includes("{a}")),
		true,
	);

	const eigen = pruefe(
		parseEreignisse(
			[
				...gemeinsam,
				nutzerlauf,
				zeile(0, 30, "apply {a} soll=1248x1050+0+0"),
				zeile(0, 40, "extern {a}"),
			].join("\n"),
		),
	);
	assert.deepEqual(fehler(eigen), []);
});

test("eine Nachbesserung im Nutzerlauf gibt das Fenster nicht frei", () => {
	// `nachbessern` ist die eigene Wirkung des Controllers. Gäbe sie frei,
	// hielte sich eine Nachbesserungsschleife selbst am Leben, sobald irgendein
	// Nutzerereignis in denselben Lauf koalesziert.
	const gemeinsam = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 3; i++) {
		gemeinsam.push(
			zeile(0, 10 + i, "arrange #2 grund=geometrieExtern surfaces=1 mitglieder=1 teilnehmer=1"),
		);
		gemeinsam.push(zeile(0, 10 + i, "apply {a} soll=1248x1050+0+0"));
	}
	const nutzerlauf = zeile(
		0,
		30,
		"arrange #3 grund=windowActivated surfaces=1 mitglieder=1 teilnehmer=1",
	);

	const nur = pruefe(
		parseEreignisse(
			[
				...gemeinsam,
				nutzerlauf,
				zeile(0, 30, "nachbessern {a} versuch=1 ist=1246x1048+0+0 soll=1248x1050+0+0"),
			].join("\n"),
		),
	);
	assert.equal(nur.maxWiederholungen, 4);
	assert.equal(nur.bestanden, false);

	const mitApply = pruefe(
		parseEreignisse(
			[...gemeinsam, nutzerlauf, zeile(0, 30, "apply {a} soll=1248x1050+0+0")].join("\n"),
		),
	);
	assert.deepEqual(fehler(mitApply), []);
});

test("viermal Ziehen desselben Fensters ist keine Schleife", () => {
	// Fehlalarm-Gegenprobe: `moveResizeFinished` ist ein reiner Nutzergrund und
	// der Lauf beschreibt genau das gezogene Fenster.
	const zeilen = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 4; i++) {
		zeilen.push(
			zeile(1, 10 * i, "arrange #2 grund=moveResizeFinished surfaces=1 mitglieder=2 teilnehmer=2"),
		);
		zeilen.push(zeile(1, 10 * i, "apply {a} soll=1248x1050+0+0"));
	}
	const bericht = pruefe(parseEreignisse(zeilen.join("\n")));
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.maxWiederholungen, 1);
});

test("Kommen und Gehen mit wechselndem Soll ist keine Schleife", () => {
	// Fehlalarm-Gegenprobe: rein technische Läufe, aber jedes Mal ein anderes
	// Ziel -- der Zähler hängt am Soll, nicht am Fenster.
	const zeilen = [zeile(0, 0, "geladen, Version 0.0.0")];
	for (let i = 0; i < 8; i++) {
		zeilen.push(
			zeile(
				1,
				i,
				"arrange #2 grund=nachlauf1500:screensChanged surfaces=1 mitglieder=2 teilnehmer=2",
			),
		);
		zeilen.push(zeile(1, i, `apply {a} soll=1248x${1000 + i}+0+0`));
	}
	const bericht = pruefe(parseEreignisse(zeilen.join("\n")));
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.maxWiederholungen, 1);
});

test("eine eigene extern-Meldung zwischen den Schreibvorgängen ist keine Schleife", () => {
	// Die echte Folge von {ab0f184d} aus AP8, Fall 27b: vier Schreibvorgänge auf
	// dasselbe Soll über drei Minuten, jeder an einem eigenen realen Anlass
	// (Fenster auf, Ziehen samt Schließen, Nachhall des Ziehens, Hotplug). Das
	// Fenster meldet dazwischen zweimal `extern` -- eine fremde Verschiebung,
	// keine Rückkopplungskette (die Kette bleibt bei 2, unter der Schwelle 3).
	// Ohne den Reset des Soll-Zählers auf `extern` zählte der alte Auditor hier
	// vier und meldete fälschlich eine Schleife.
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(
			1,
			10,
			"arrange #1 grund=windowActivated,windowAdded surfaces=1 mitglieder=2 teilnehmer=1",
		),
		zeile(1, 10, "apply {a} soll=1920x1032+0+0"),
		zeile(
			1,
			20,
			"arrange #2 grund=closed,windowRemoved,moveResizeFinished surfaces=1 mitglieder=2 teilnehmer=1",
		),
		zeile(1, 20, "apply {a} soll=1920x1032+0+0"),
		zeile(1, 20, "extern {a}"),
		zeile(1, 20, "arrange #3 grund=geometrieExtern surfaces=1 mitglieder=2 teilnehmer=1"),
		zeile(1, 20, "apply {a} soll=1920x1032+0+0"),
		zeile(1, 30, "extern {a}"),
		zeile(
			1,
			30,
			"arrange #4 grund=geometrieExtern,fensterzustand surfaces=1 mitglieder=2 teilnehmer=1",
		),
		zeile(1, 30, "apply {a} soll=1920x1032+0+0"),
	].join("\n");
	const bericht = pruefe(parseEreignisse(text));
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.maxWiederholungen, 2);
	assert.equal(bericht.bestanden, true);
});

test("eine Give-up-Kette in einem technischen Lauf bleibt an der Schwelle", () => {
	// `MAX_CORRECTIONS = 2`: ein `apply` und zwei `nachbessern` sind drei
	// Schreibvorgänge auf dasselbe Soll. Genau drei, nicht mehr -- die Schwelle
	// liegt bei mehr als drei, damit dieser vorgesehene Ablauf grün bleibt.
	const text = [
		zeile(0, 0, "geladen, Version 0.0.0"),
		zeile(0, 1, "arrange #1 grund=geometrieExtern surfaces=1 mitglieder=1 teilnehmer=1"),
		zeile(0, 1, "apply {a} soll=896x235+0+0"),
		zeile(0, 2, "nachbessern {a} versuch=1 ist=894x223+0+0 soll=896x235+0+0"),
		zeile(0, 3, "nachbessern {a} versuch=2 ist=894x223+0+0 soll=896x235+0+0"),
		zeile(0, 4, "aufgegeben {a} nach 2 Versuchen, ist=894x223+0+0"),
	].join("\n");
	const bericht = pruefe(parseEreignisse(text));
	assert.equal(bericht.maxWiederholungen, 3);
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.bestanden, true);
});

test("jeder Grund des Adapters steht in genau einer der beiden Listen", () => {
	// Ohne diese Prüfung wäre `TECHNISCHE_GRUENDE` eine Zierde: der Code
	// entscheidet allein über `NUTZER_GRUENDE`, und ein neuer Grund im Adapter
	// fiele stillschweigend in die technische Auslegung.
	const quelle = readFileSync("src/kwin/adapter.ts", "utf8");
	const gefunden = new Set<string>();
	const muster = /(?:schedule|trigger)\("([^"]+)"\)|runArrange\(\["([^"]+)"\]\)/g;
	let treffer = muster.exec(quelle);
	while (treffer !== null) {
		const name = treffer[1] ?? treffer[2];
		if (name !== undefined) {
			gefunden.add(name);
		}
		treffer = muster.exec(quelle);
	}
	assert.equal(gefunden.size > 0, true);

	for (const name of Array.from(gefunden)) {
		const nutzer = NUTZER_GRUENDE.includes(name);
		const technisch = TECHNISCHE_GRUENDE.includes(name);
		assert.equal(nutzer !== technisch, true, `Grund ${name} steht nicht in genau einer Liste`);
	}
	for (const name of NUTZER_GRUENDE.concat(TECHNISCHE_GRUENDE)) {
		assert.equal(gefunden.has(name), true, `Grund ${name} kommt im Adapter nicht mehr vor`);
	}
});

test("die Teilprüfung trennt Nutzer- von Technikgründen", () => {
	assert.equal(istNutzerGrund("geometrieExtern,fensterzustand"), false);
	assert.equal(istNutzerGrund(""), false);
	assert.equal(istNutzerGrund("windowActivated,windowAdded"), true);
	assert.equal(istNutzerGrund("closed,windowRemoved"), false);
	assert.equal(istNutzerGrund("windowAdded,frischErfunden"), false);
	assert.equal(istNutzerTeil("shortcut:swapNext"), true);
	assert.equal(istNutzerTeil("nachlauf500:dockGeometrie+screensChanged"), false);
});

test("eine leere Stunde belegt nichts", () => {
	const text = [
		marke(0, 0, "== Fall 27 Anfang =="),
		zeile(0, 1, "arrange #1 grund=start surfaces=1 mitglieder=1 teilnehmer=1"),
		zeile(0, 1, "apply {a} soll=1248x1050+0+0"),
		marke(61, 30, "== Fall 27 Ende =="),
	].join("\n");
	const bericht = pruefeAlltagsstunde(text);
	assert.equal(bericht.bestanden, false);
	assert.equal(
		fehler(bericht).some((eintrag) => eintrag.includes(`verlangt sind ${MIN_LAEUFE}`)),
		true,
	);
	assert.equal(
		fehler(bericht).some((eintrag) => eintrag.includes(`verlangt sind ${MIN_SCHREIBVORGAENGE}`)),
		true,
	);
});

test("eine Stunde ohne einen einzigen reinen Nutzerlauf belegt nichts", () => {
	const zeilen = [marke(0, 0, "== Fall 27 Anfang ==")];
	for (let i = 0; i < 12; i++) {
		zeilen.push(
			zeile(
				1 + i,
				0,
				`arrange #${i + 1} grund=geometrieExtern surfaces=1 mitglieder=1 teilnehmer=1`,
			),
		);
		zeilen.push(zeile(1 + i, 0, `apply {a} soll=1248x${1000 + i}+0+0`));
	}
	zeilen.push(marke(61, 30, "== Fall 27 Ende =="));
	const bericht = pruefeAlltagsstunde(zeilen.join("\n"));
	assert.equal(bericht.nutzerlaeufe, 0);
	assert.equal(
		fehler(bericht).some((eintrag) => eintrag.includes("kein rein nutzerveranlasster")),
		true,
	);
});

test("ein Auszug ohne PID meldet einen Hinweis", () => {
	const text = [
		"kwin-xmonad-lite: arrange #1 grund=start surfaces=1 mitglieder=1 teilnehmer=1",
	].join("\n");
	const bericht = pruefe(parseEreignisse(text));
	assert.equal(
		bericht.befunde.some(
			(befund) => befund.level === "hinweis" && befund.text.includes("keine PID"),
		),
		true,
	);
});

// ---------------------------------------------------------------------------
// Die archivierten Nachweise unter `docs/` gegen den geschärften Auditor.
// Sie sind der eigentliche Zweck des Werkzeugs; eine Schärfung, die sie
// umwirft, muss hier auffallen und nicht erst im Flake-Check.
// ---------------------------------------------------------------------------

const ARCHIV = [
	"docs/hal9000-abnahme-2026-09-06.log",
	"docs/ms7-2026-09-06-hal9000.log",
	"docs/ms7-2026-09-06-hal9000-26a-nachtrag.log",
	"docs/ms7-2026-09-06-hal9000-ap7.log",
	"docs/ms7-2026-09-06-hal9000-fall27.log",
	"docs/ms7-2026-09-12-hal9000-ap8.log",
	"docs/ms7-2026-09-12-hal9000-fall27b.log",
	// `-o cat`, deshalb ohne PID: der Auditor meldet dafür einen Hinweis. Für
	// die Schleifenprüfung reicht das, für eine Belegschwelle nicht.
	"docs/shortcuts-2026-09-06-spielkiste.log",
];

for (const pfad of ARCHIV) {
	test(`der archivierte Nachweis ${pfad} besteht die freie Prüfung`, () => {
		const bericht = pruefe(parseEreignisse(readFileSync(pfad, "utf8")));
		assert.deepEqual(fehler(bericht), []);
		assert.equal(bericht.bestanden, true);
	});
}

test("die Alltagsstunde aus Fall 27 besteht die Belegschwelle", () => {
	const bericht = pruefeAlltagsstunde(
		readFileSync("docs/ms7-2026-09-06-hal9000-fall27.log", "utf8"),
	);
	assert.deepEqual(fehler(bericht), []);
	assert.equal(bericht.bestanden, true);
	assert.equal(bericht.laeufe >= MIN_LAEUFE, true);
	assert.equal(bericht.schreibvorgaenge >= MIN_SCHREIBVORGAENGE, true);
	assert.equal(bericht.nutzerlaeufe > 0, true);
});
