import assert from "node:assert/strict";
import { test } from "node:test";

import { parseJournal, parseRect, run, ueberlappt } from "../dev/probe/expect-geometry.ts";
import {
	journal,
	KEY,
	ndjson,
	TALL2_RATIO50,
	TALL3,
	UHR,
	verketten,
} from "./support/geofixtures.ts";

const TALL_ERWARTUNG = ["layout=tall", "n=3", "ratio=0.65", "gaps=0/0"];

function fenster(zellen: Array<{ x: number; y: number; w: number; h: number }>): Array<{
	id: string;
	geo: { x: number; y: number; w: number; h: number };
}> {
	const ids = ["a", "b", "c", "d"];
	return zellen.map((geo, index) => ({ id: ids[index] ?? `w${index}`, geo }));
}

function fehlertexte(report: ReturnType<typeof run>): string[] {
	return report.findings
		.filter((finding) => finding.level === "fehler")
		.map((finding) => finding.text);
}

test("eine saubere Tall-Messung besteht", () => {
	const report = run(ndjson({ fenster: fenster(TALL3) }), journal(), TALL_ERWARTUNG);
	assert.deepEqual(fehlertexte(report), []);
	assert.equal(report.bestanden, true);
});

test("full besteht mit deckungsgleichen Rechtecken", () => {
	const voll = { x: 8, y: 8, w: 1904, h: 1034 };
	const report = run(
		ndjson({ fenster: fenster([voll, voll, voll]) }),
		journal({ layout: "full", ratio: 0.55, gaps: "8/4" }),
		["layout=full", "n=3", "ratio=0.55", "gaps=8/4"],
	);
	assert.deepEqual(fehlertexte(report), []);
});

test("ein fehlendes Fenster im letzten Sample fällt auf", () => {
	const report = run(
		ndjson({ fenster: fenster(TALL3), fehltImLetztenSample: ["c"] }),
		journal(),
		TALL_ERWARTUNG,
	);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("fehlt im letzten Sample")),
		true,
	);
	assert.equal(report.bestanden, false);
});

test("abweichende späte Samples gelten als nicht eingeschwungen", () => {
	const verschoben = fenster(TALL3).map((eintrag, index) =>
		index === 0 ? { ...eintrag, geo: { ...eintrag.geo, w: eintrag.geo.w - 4 } } : eintrag,
	);
	const report = run(
		ndjson({ fenster: fenster(TALL3), letztesSampleAbweichend: verschoben }),
		journal(),
		TALL_ERWARTUNG,
	);
	assert.equal(
		fehlertexte(report).some(
			(text) => text.includes("nicht eingeschwungen") || text.includes("weicht zwischen"),
		),
		true,
	);
});

test("unterschiedliche Lauf- und Sequenzfelder allein sind kein Fehlschlag", () => {
	// `n`, `ms` und `s` unterscheiden sich zwischen zwei Samples immer; nur
	// deshalb vergleicht das Orakel die fachlichen Felder.
	const report = run(ndjson({ fenster: fenster(TALL3) }), journal(), TALL_ERWARTUNG);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("weicht zwischen")),
		false,
	);
});

test("ein fehlender end-Satz macht den Lauf unvollständig", () => {
	const report = run(ndjson({ fenster: fenster(TALL3), ohneEnd: true }), journal(), TALL_ERWARTUNG);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("kein `end`-Satz")),
		true,
	);
});

test("überlappende Zellen fallen in tall auf", () => {
	const ueberlappend = [
		{ x: 0, y: 0, w: 1248, h: 1050 },
		{ x: 1248, y: 0, w: 672, h: 525 },
		{ x: 1200, y: 525, w: 672, h: 525 },
	];
	const report = run(ndjson({ fenster: fenster(ueberlappend) }), journal(), TALL_ERWARTUNG);
	const texte = fehlertexte(report);
	assert.equal(
		texte.some((text) => text.includes("überlappen")),
		true,
	);
});

test("eine falsche Masterbreite fällt auf", () => {
	const schmal = [
		{ x: 0, y: 0, w: 1240, h: 1050 },
		{ x: 1248, y: 0, w: 672, h: 525 },
		{ x: 1248, y: 525, w: 672, h: 525 },
	];
	const report = run(ndjson({ fenster: fenster(schmal) }), journal(), TALL_ERWARTUNG);
	assert.equal(report.bestanden, false);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("Soll") || text.includes("Masterbreite")),
		true,
	);
});

test("ein vom Journal abweichender Masteranteil fällt vor der Geometrie auf", () => {
	// Die Anordnung passt zu ratio=0.5, die Vorschrift verlangte 0.65: ohne
	// die unabhängige Vorgabe bestünde dieser Fall.
	const halb = [
		{ x: 0, y: 0, w: 960, h: 1050 },
		{ x: 960, y: 0, w: 960, h: 525 },
		{ x: 960, y: 525, w: 960, h: 525 },
	];
	const report = run(ndjson({ fenster: fenster(halb) }), journal({ ratio: 0.5 }), TALL_ERWARTUNG);
	assert.equal(report.bestanden, false);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("ratio=0.5")),
		true,
	);
});

test("eine Client-Abweichung bei stimmendem Soll entlastet den Controller, nimmt den Fall aber nicht ab", () => {
	const quittiert = [
		{ x: 0, y: 0, w: 1248, h: 1050 },
		{ x: 1248, y: 0, w: 670, h: 520 },
		{ x: 1248, y: 525, w: 672, h: 525 },
	];
	const report = run(
		ndjson({ fenster: fenster(quittiert) }),
		journal({
			applies: [
				["a", "1248x1050+0+0"],
				["b", "672x525+1248+0"],
				["c", "672x525+1248+525"],
			],
			aufgegeben: ["b"],
		}),
		TALL_ERWARTUNG,
	);
	assert.deepEqual(fehlertexte(report), []);
	assert.equal(
		report.findings.some(
			(finding) =>
				finding.level === "nicht-abgenommen" && finding.text.includes("nicht angenommen"),
		),
		true,
	);
	// Der Controller ist entlastet, der Geometrienachweis ist trotzdem nicht
	// erbracht -- der Fall wird an einem geeigneten Client wiederholt.
	assert.equal(report.bestanden, false);
});

test("ohne Diagnosezeile ist die Layout-Teilnahme nicht belegbar", () => {
	const report = run(
		ndjson({ fenster: fenster(TALL3) }),
		journal({ ohneDiagnose: true }),
		TALL_ERWARTUNG,
	);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("diagnose")),
		true,
	);
});

test("ohne config-Zeile fehlt der Beleg der wirksamen Abstände", () => {
	const report = run(
		ndjson({ fenster: fenster(TALL3) }),
		journal({ ohneConfig: true }),
		TALL_ERWARTUNG,
	);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("`config`-Zeile")),
		true,
	);
});

test("parseRect liest die Journalform und lehnt anderes ab", () => {
	assert.deepEqual(parseRect("1664x1410+2560+0"), {
		width: 1664,
		height: 1410,
		x: 2560,
		y: 0,
	});
	assert.equal(parseRect("1664x1410"), null);
});

test("parseJournal trennt Surface, Diagnose und Schreibarten", () => {
	const parsed = parseJournal(
		journal({
			float: ["c"],
			applies: [["a", "1248x1050+0+0"]],
		}),
	);
	assert.equal(parsed.loads, 1);
	assert.equal(parsed.surfaces.length, 1);
	assert.equal(parsed.surfaces[0]?.key, KEY);
	assert.deepEqual(parsed.diagnosen[0]?.floating, ["c"]);
	assert.equal(parsed.writes.length, 1);
	assert.equal(parsed.writes[0]?.kind, "apply");
});

test("ueberlappt meldet für ein Rechteck der Breite 0 keine Überlappung", () => {
	const leer = { x: 10, y: 0, width: 0, height: 100 };
	const rechts = { x: 5, y: 0, width: 20, height: 100 };
	assert.equal(ueberlappt(leer, rechts), false);
});

// ---------------------------------------------------------------------------
// Nachbesserungen aus dem Audit vom 2026-09-06. Jeder dieser Fälle bestand vor
// der Korrektur -- das ist der eigentliche Befund: ein Orakel, das ungültige
// Nachweise durchwinkt, ist von einem funktionierenden nicht zu unterscheiden.
// ---------------------------------------------------------------------------

test("ein früherer Skriptlauf im selben Auszug trägt den neuen nicht", () => {
	// Der Vorlauf ist vollständig und in sich stimmig; der eigentliche Lauf
	// meldet nach seiner `geladen`-Zeile nichts. Vorher erbte er Konfiguration,
	// Surface- und Diagnosewerte des Vorlaufs und bestand damit ohne eine
	// einzige eigene Zeile.
	const report = run(
		ndjson({ fenster: fenster(TALL3) }),
		journal({ nurGeladen: true, vorlauf: {} }),
		TALL_ERWARTUNG,
	);
	assert.equal(report.bestanden, false);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("keine `surface`-Zeile")),
		true,
	);
});

test("ein Give-up an einem unbeteiligten Fenster entlastet nichts", () => {
	// Drei Fenster, alle drei mit falscher Größe, dazu ein `aufgegeben` für ein
	// Fenster, das gar nicht im Layout steht. Vorher genügte diese eine fremde
	// Zeile, um die Abweichung als Client-Eigenheit durchgehen zu lassen.
	const falsch = [
		{ x: 0, y: 0, w: 1900, h: 1000 },
		{ x: 1900, y: 0, w: 20, h: 500 },
		{ x: 1900, y: 500, w: 20, h: 550 },
	];
	const report = run(
		ndjson({ fenster: fenster(falsch) }),
		journal({
			applies: [
				["a", "1248x1050+0+0"],
				["b", "672x525+1248+0"],
				["c", "672x525+1248+525"],
			],
			aufgegeben: ["fremd"],
		}),
		TALL_ERWARTUNG,
	);
	assert.equal(report.bestanden, false);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("ohne Give-up für dieses Fenster")),
		true,
	);
});

test("tall mit ratio 0.5 besteht, obwohl Master und Stapel gleich breit sind", () => {
	// Die Masterprüfung über die Breite allein zählte hier zwei Treffer und
	// lehnte ein völlig korrektes Layout ab.
	const report = run(
		ndjson({ fenster: fenster(TALL2_RATIO50) }),
		journal({ teilnehmer: ["a", "b"], n: 2, ratio: 0.5 }),
		["layout=tall", "n=2", "ratio=0.5", "gaps=0/0"],
	);
	assert.deepEqual(fehlertexte(report), []);
	assert.equal(report.bestanden, true);
});

test("Sätze ohne Laufstempel und Satznummer fallen auf", () => {
	const report = run(
		ndjson({ fenster: fenster(TALL3), ohneLaufstempel: true, ohneSatznummer: true }),
		journal(),
		TALL_ERWARTUNG,
	);
	assert.equal(report.bestanden, false);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("ohne Laufstempel")),
		true,
	);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("ohne Satznummer")),
		true,
	);
});

test("eine abgebrochene Samplestaffel fällt auf", () => {
	// Der `meta`-Satz kündigt vier Samples an, geschrieben sind zwei: so sieht
	// ein Lauf aus, der vor dem Einschwingen endete.
	const report = run(
		ndjson({
			fenster: fenster(TALL3),
			samples: [0, 500],
			angekuendigteSamples: [0, 500, 1500, 3000],
		}),
		journal(),
		TALL_ERWARTUNG,
	);
	assert.equal(report.bestanden, false);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("Staffel ist unvollständig")),
		true,
	);
});

test("ein Fenster einer fremden Surface zählt nicht als Teilnehmer", () => {
	// Die Diagnosezeile nennt die drei Ids, die Messung legt sie auf eine
	// andere Ausgabe. Vorher wurden sie trotzdem in dieses Layout gerechnet.
	const fremde = fenster(TALL3).map((eintrag) => ({
		...eintrag,
		extra: { output: "OTHER" },
	}));
	const report = run(ndjson({ fenster: fremde }), journal(), TALL_ERWARTUNG);
	assert.equal(report.bestanden, false);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("liegt laut Probe aber auf einer anderen")),
		true,
	);
});

test("eine widersprüchliche Arbeitsfläche fällt auf", () => {
	// Die Probe misst 1920x1080, das Journal meldet 1920x1050. Eine der beiden
	// Quellen irrt, und gerechnet wird gegen eine Fläche, die so nie anlag.
	const report = run(
		ndjson({ fenster: fenster(TALL3), flaeche: { x: 0, y: 0, w: 1920, h: 1080 } }),
		journal(),
		TALL_ERWARTUNG,
	);
	assert.equal(report.bestanden, false);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("Arbeitsfläche widersprüchlich")),
		true,
	);
});

test("zwei KWin-Prozesse im Auszug verlangen eine ausdrückliche PID", () => {
	// Nach einem `replace` schreiben zwei Prozesse in dieselbe Unit. Welcher
	// gemeint ist, kann der Auszug nicht selbst entscheiden.
	const report = run(
		ndjson({ fenster: fenster(TALL3) }),
		verketten(journal({ pid: "1000", beginnMs: UHR - 120_000 }), journal({ pid: "2000" })),
		TALL_ERWARTUNG,
	);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("KWin-Prozessen")),
		true,
	);
});

test("mit ausdrücklicher PID zählt nur der genannte Prozess", () => {
	const report = run(
		ndjson({ fenster: fenster(TALL3) }),
		verketten(journal({ pid: "1000", beginnMs: UHR - 120_000 }), journal({ pid: "2000" })),
		TALL_ERWARTUNG,
		{ pid: "2000" },
	);
	assert.deepEqual(fehlertexte(report), []);
	assert.equal(report.bestanden, true);
});

test("ein Give-up vor dem letzten Schreibversuch entlastet nicht", () => {
	// Reihenfolge im Journal: erst `aufgegeben`, dann ein neuer `apply`. Was
	// nach diesem `apply` geschah, ist unbelegt -- das alte Give-up deckt es
	// nicht ab.
	const quittiert = [
		{ x: 0, y: 0, w: 1248, h: 1050 },
		{ x: 1248, y: 0, w: 670, h: 520 },
		{ x: 1248, y: 525, w: 672, h: 525 },
	];
	const report = run(
		ndjson({ fenster: fenster(quittiert) }),
		verketten(
			journal({
				beginnMs: UHR - 120_000,
				epoche: 1,
				applies: [["b", "672x525+1248+0"]],
				aufgegeben: [["b", "670x520+1248+0"]],
				nurGeladen: false,
			}),
			journal({
				beginnMs: UHR - 60_000,
				epoche: 2,
				applies: [
					["a", "1248x1050+0+0"],
					["b", "672x525+1248+0"],
					["c", "672x525+1248+525"],
				],
			}),
		),
		TALL_ERWARTUNG,
		{ pid: "2397" },
	);
	assert.equal(report.bestanden, false);
});

test("ein Anordnungslauf während der Messung macht den Auszug unbrauchbar", () => {
	// Die Samples zeigen dann einen Übergang, keinen Zustand -- und das Orakel
	// verglich ihn stillschweigend mit dem Soll.
	const report = run(
		ndjson({ fenster: fenster(TALL3) }),
		journal({ arrangeWaehrendMessung: true }),
		TALL_ERWARTUNG,
	);
	assert.equal(report.bestanden, false);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("während der Messung")),
		true,
	);
});

test("zwei gemessene Surfaces verlangen die Angabe, welche gemeint ist", () => {
	// Genau die Lage aus Fall 26. Vorher fiel die Wahl still auf die erste
	// `view` im Auszug.
	const report = run(
		ndjson({ fenster: fenster(TALL3), zweiteView: true }),
		journal(),
		TALL_ERWARTUNG,
	);
	assert.equal(
		fehlertexte(report).some((text) => text.includes("Surfaces gemessen")),
		true,
	);
});

test("mit surface= besteht derselbe Auszug", () => {
	const report = run(ndjson({ fenster: fenster(TALL3), zweiteView: true }), journal(), [
		...TALL_ERWARTUNG,
		`surface=${KEY}`,
	]);
	assert.deepEqual(fehlertexte(report), []);
	assert.equal(report.bestanden, true);
});
