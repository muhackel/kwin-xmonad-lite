import assert from "node:assert/strict";
import { test } from "node:test";

import { parseJournal, parseRect, run, ueberlappt } from "../dev/probe/expect-geometry.ts";
import { journal, KEY, ndjson, TALL3 } from "./support/geofixtures.ts";

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

test("eine Client-Abweichung bei stimmendem Soll ist ein Hinweis, kein Fehler", () => {
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
			(finding) => finding.level === "hinweis" && finding.text.includes("nicht angenommen"),
		),
		true,
	);
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
