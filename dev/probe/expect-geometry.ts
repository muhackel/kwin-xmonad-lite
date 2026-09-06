/**
 * Orakel der Geometrie-Probe.
 *
 * Es beantwortet eine einzige Frage: stimmen die **gemessenen**
 * Fenstergeometrien mit dem überein, was die Fallvorschrift verlangt?
 *
 * Drei Regeln, jede aus einem Fehlschlag früherer Entwürfe:
 *
 * 1. **Die Erwartung kommt aus der Vorschrift, nicht aus dem geprüften
 *    System.** Layout, Fensterzahl, Masteranteil und Abstände werden von außen
 *    vorgegeben. Zöge das Orakel sie aus dem Journal, passte eine falsche
 *    Anordnung zu ihrem eigenen falschen Protokoll und der Fall bestünde.
 * 2. **Prüfregeln je Layout.** `full` erzeugt absichtlich deckungsgleiche
 *    Rechtecke; eine pauschale Überlappungsprüfung lehnte korrektes Verhalten
 *    ab.
 * 3. **Client-Abweichung ist kein Controller-Fehler.** Weicht das Ist vom Soll
 *    ab, während das Soll stimmt, hat der Client die Größe nicht angenommen.
 *    Das ist ein anderer Befund als eine falsche Layoutrechnung und wird
 *    getrennt gemeldet.
 */

import { LAYOUTS } from "../../src/core/layout/index.ts";
import type { Rect } from "../../src/core/rect.ts";

// ---------------------------------------------------------------------------
// Sätze der Probe
// ---------------------------------------------------------------------------

/** Rechteck der Probe: kurze Feldnamen, plus die Rundungsangabe. */
export interface ProbeRect {
	x: number;
	y: number;
	w: number;
	h: number;
	exakt?: boolean;
}

export interface ProbeRecord {
	k: string;
	r?: number;
	n?: number;
	ms?: number;
	s?: number;
	[key: string]: unknown;
}

export interface Finding {
	level: "fehler" | "hinweis";
	text: string;
}

export function fehler(text: string): Finding {
	return { level: "fehler", text };
}

export function hinweis(text: string): Finding {
	return { level: "hinweis", text };
}

export function parseNdjson(text: string): ProbeRecord[] {
	const records: ProbeRecord[] = [];
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = (lines[i] ?? "").trim();
		if (line === "") {
			continue;
		}
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch (_error) {
			records.push({ k: "unlesbar", zeile: i + 1 });
			continue;
		}
		if (
			typeof value === "object" &&
			value !== null &&
			typeof (value as ProbeRecord).k === "string"
		) {
			records.push(value as ProbeRecord);
		} else {
			records.push({ k: "unlesbar", zeile: i + 1 });
		}
	}
	return records;
}

// ---------------------------------------------------------------------------
// 1. Datenqualität
// ---------------------------------------------------------------------------

/**
 * Fachliche Felder eines Fenstersatzes, ohne Lauf- und Sequenzfelder.
 *
 * `n`, `ms` und `s` unterscheiden sich zwischen zwei Samples **immer**;
 * zeichengleiche Sätze gäbe es nie. Verglichen wird deshalb genau das, was
 * gleich bleiben muss, wenn die Anordnung eingeschwungen ist.
 */
export function fachlich(record: ProbeRecord): string {
	const kopie: Record<string, unknown> = {};
	const keys = Object.keys(record).sort();
	for (const key of keys) {
		if (key === "n" || key === "ms" || key === "s" || key === "r" || key === "trunc") {
			continue;
		}
		kopie[key] = record[key];
	}
	return JSON.stringify(kopie);
}

export function sampleIndices(records: ProbeRecord[]): number[] {
	const seen = new Set<number>();
	for (const record of records) {
		if (typeof record.s === "number") {
			seen.add(record.s);
		}
	}
	return Array.from(seen).sort((a, b) => a - b);
}

function ofSample(records: ProbeRecord[], kind: string, sample: number): ProbeRecord[] {
	return records.filter((record) => record.k === kind && record.s === sample);
}

export function checkQuality(records: ProbeRecord[]): Finding[] {
	const findings: Finding[] = [];

	if (records.length === 0) {
		return [fehler("keine Sätze: die Probe hat nichts ins Journal geschrieben")];
	}
	for (const record of records) {
		if (record.k === "unlesbar") {
			findings.push(fehler(`Zeile ${String(record.zeile)} ist kein JSON-Satz`));
		}
		if (record.k === "error") {
			findings.push(fehler(`Probe meldet einen Fehler: ${String(record.d)}`));
		}
	}

	const end = records.filter((record) => record.k === "end");
	if (end.length === 0) {
		findings.push(fehler("kein `end`-Satz: der Lauf ist unvollständig"));
	} else {
		const letzter = end[end.length - 1] as ProbeRecord;
		if (letzter.st !== "ok") {
			findings.push(fehler(`\`end\` meldet st=${String(letzter.st)}`));
		}
		if (letzter.timer_aktiv !== 0) {
			findings.push(fehler(`\`end\` meldet timer_aktiv=${String(letzter.timer_aktiv)}`));
		}
	}

	// Ein zweiter Lauf im selben Journalfenster fiele hier auf.
	const runs = new Set(records.map((record) => record.r));
	if (runs.size > 1) {
		findings.push(fehler(`${runs.size} verschiedene Laufstempel in einer Datei`));
	}

	const numbers = records
		.map((record) => record.n)
		.filter((value): value is number => typeof value === "number")
		.sort((a, b) => a - b);
	for (let i = 0; i < numbers.length; i++) {
		if (numbers[i] !== i) {
			findings.push(
				fehler(`Satznummern nicht lückenlos: erwartet ${i}, gefunden ${String(numbers[i])}`),
			);
			break;
		}
	}

	const samples = sampleIndices(records);
	const erste = ofSample(records, "win", samples[0] ?? 0);
	const letzteIndex = samples[samples.length - 1] ?? 0;
	const letzte = ofSample(records, "win", letzteIndex);
	const letzteIds = new Set(letzte.map((record) => String(record.id)));
	for (const record of erste) {
		if (!letzteIds.has(String(record.id))) {
			findings.push(fehler(`Fenster ${String(record.id)} fehlt im letzten Sample`));
		}
	}

	return findings;
}

/**
 * Eingeschwungen heißt: die beiden späten Samples tragen dieselben fachlichen
 * Werte -- dieselben Fenster, dieselben Geometrien und dieselben
 * Arbeitsflächen.
 */
export function checkStability(records: ProbeRecord[]): Finding[] {
	const samples = sampleIndices(records);
	if (samples.length < 2) {
		return [fehler("weniger als zwei Samples: Stabilität nicht prüfbar")];
	}
	const vorletzter = samples[samples.length - 2] as number;
	const letzter = samples[samples.length - 1] as number;
	const findings: Finding[] = [];

	for (const kind of ["win", "view"]) {
		const a = ofSample(records, kind, vorletzter).map(fachlich).sort();
		const b = ofSample(records, kind, letzter).map(fachlich).sort();
		if (a.length !== b.length) {
			findings.push(
				fehler(
					`Sample ${vorletzter} und ${letzter} haben unterschiedlich viele \`${kind}\`-Sätze ` +
						`(${a.length} gegen ${b.length}): nicht eingeschwungen`,
				),
			);
			continue;
		}
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) {
				findings.push(
					fehler(
						`\`${kind}\` weicht zwischen Sample ${vorletzter} und ${letzter} ab: ${String(a[i])}`,
					),
				);
				break;
			}
		}
	}
	return findings;
}

// ---------------------------------------------------------------------------
// 2. Journal
// ---------------------------------------------------------------------------

export interface SurfaceLine {
	key: string;
	layout: string;
	n: number;
	ratio: number;
	area: Rect;
}

export interface DiagnoseLine {
	key: string;
	order: string[];
	participants: string[];
	floating: string[];
}

export interface WriteLine {
	kind: "apply" | "float" | "nachbessern" | "aufgegeben";
	id: string;
	soll: Rect | null;
	ist: Rect | null;
}

export interface ConfigLine {
	gapOuter: number;
	gapInner: number;
	ratio: number;
	layoutIndex: number;
	debug: boolean;
}

export interface Journal {
	config: ConfigLine | null;
	surfaces: SurfaceLine[];
	diagnosen: DiagnoseLine[];
	writes: WriteLine[];
	externals: string[];
	loads: number;
}

/** `1664x1410+0+0` — dieselbe Form, die `fmt` in epoch.ts und apply.ts schreibt. */
export function parseRect(text: string): Rect | null {
	const match = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/.exec(text.trim());
	if (match === null) {
		return null;
	}
	return {
		width: Number(match[1]),
		height: Number(match[2]),
		x: Number(match[3]),
		y: Number(match[4]),
	};
}

function felder(rest: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const teil of rest.split(" ")) {
		const index = teil.indexOf("=");
		if (index > 0) {
			out.set(teil.slice(0, index), teil.slice(index + 1));
		}
	}
	return out;
}

function liste(value: string | undefined): string[] {
	if (value === undefined || value === "") {
		return [];
	}
	return value.split(",");
}

export function parseJournal(text: string): Journal {
	const journal: Journal = {
		config: null,
		surfaces: [],
		diagnosen: [],
		writes: [],
		externals: [],
		loads: 0,
	};

	for (const raw of text.split("\n")) {
		const index = raw.indexOf("kwin-xmonad-lite: ");
		if (index < 0) {
			continue;
		}
		const zeile = raw.slice(index + "kwin-xmonad-lite: ".length).trim();

		if (zeile.startsWith("geladen")) {
			journal.loads += 1;
			continue;
		}
		if (zeile.startsWith("config gaps=")) {
			const f = felder(zeile.slice("config ".length));
			const gaps = (f.get("gaps") ?? "0/0").split("/");
			journal.config = {
				gapOuter: Number(gaps[0]),
				gapInner: Number(gaps[1]),
				ratio: Number(f.get("ratio")),
				layoutIndex: Number(f.get("layout")),
				debug: f.get("debug") === "true",
			};
			continue;
		}
		if (zeile.startsWith("surface ") && zeile.includes(" layout=")) {
			const rest = zeile.slice("surface ".length);
			const key = rest.slice(0, rest.indexOf(" "));
			const f = felder(rest);
			const area = parseRect(f.get("fläche") ?? "");
			if (area !== null) {
				journal.surfaces.push({
					key,
					layout: f.get("layout") ?? "",
					n: Number(f.get("n")),
					ratio: Number(f.get("ratio")),
					area,
				});
			}
			continue;
		}
		if (zeile.startsWith("diagnose ")) {
			const rest = zeile.slice("diagnose ".length);
			const key = rest.slice(0, rest.indexOf(" "));
			const f = felder(rest);
			journal.diagnosen.push({
				key,
				order: liste(f.get("order")),
				participants: liste(f.get("teilnehmer")),
				floating: liste(f.get("float")),
			});
			continue;
		}
		if (zeile.startsWith("apply ") || zeile.startsWith("float ")) {
			const teile = zeile.split(" ");
			const f = felder(zeile);
			journal.writes.push({
				kind: zeile.startsWith("apply ") ? "apply" : "float",
				id: teile[1] ?? "",
				soll: parseRect(f.get("soll") ?? ""),
				ist: null,
			});
			continue;
		}
		if (zeile.startsWith("nachbessern ")) {
			const teile = zeile.split(" ");
			const f = felder(zeile);
			journal.writes.push({
				kind: "nachbessern",
				id: teile[1] ?? "",
				soll: parseRect(f.get("soll") ?? ""),
				ist: parseRect(f.get("ist") ?? ""),
			});
			continue;
		}
		if (zeile.startsWith("aufgegeben ")) {
			const teile = zeile.split(" ");
			const f = felder(zeile);
			journal.writes.push({
				kind: "aufgegeben",
				id: teile[1] ?? "",
				soll: null,
				ist: parseRect(f.get("ist") ?? ""),
			});
			continue;
		}
		if (zeile.startsWith("extern ")) {
			journal.externals.push(zeile.split(" ")[1] ?? "");
		}
	}

	return journal;
}

// ---------------------------------------------------------------------------
// 3. Erwartung
// ---------------------------------------------------------------------------

export interface Expectation {
	layout: string;
	n: number;
	ratio: number;
	gapOuter: number;
	gapInner: number;
	/** Ohne Angabe wird die einzige Surface geprüft; sonst diese. */
	surface?: string;
}

/** `layout=tall n=3 ratio=0.65 gaps=8/4 surface=…` */
export function parseExpectation(args: string[]): Expectation | null {
	if (args.length === 0) {
		return null;
	}
	const f = felder(args.join(" "));
	const gaps = (f.get("gaps") ?? "0/0").split("/");
	return {
		layout: f.get("layout") ?? "tall",
		n: Number(f.get("n")),
		ratio: Number(f.get("ratio")),
		gapOuter: Number(gaps[0]),
		gapInner: Number(gaps[1]),
		surface: f.get("surface"),
	};
}

/** Die letzte Surface-Zeile des geprüften Schlüssels. */
export function letzteSurface(journal: Journal, key?: string): SurfaceLine | null {
	const passende =
		key === undefined ? journal.surfaces : journal.surfaces.filter((s) => s.key === key);
	return passende.length === 0 ? null : (passende[passende.length - 1] as SurfaceLine);
}

export function letzteDiagnose(journal: Journal, key: string): DiagnoseLine | null {
	const passende = journal.diagnosen.filter((d) => d.key === key);
	return passende.length === 0 ? null : (passende[passende.length - 1] as DiagnoseLine);
}

/**
 * Erster Schritt: sagt das Journal überhaupt, was die Vorschrift verlangt?
 * Erst danach lohnt der Blick auf die Geometrie -- sonst bestünde ein Fall,
 * dessen Anordnung sauber zu einem falschen Masteranteil passt.
 */
export function checkJournal(journal: Journal, expect: Expectation): Finding[] {
	const findings: Finding[] = [];
	const surface = letzteSurface(journal, expect.surface);
	if (surface === null) {
		return [fehler("keine `surface`-Zeile im Journalauszug")];
	}
	if (surface.layout !== expect.layout) {
		findings.push(
			fehler(`Journal meldet layout=${surface.layout}, vorgegeben war ${expect.layout}`),
		);
	}
	if (surface.n !== expect.n) {
		findings.push(fehler(`Journal meldet n=${surface.n}, vorgegeben waren ${expect.n}`));
	}
	if (Math.abs(surface.ratio - expect.ratio) > 1e-9) {
		findings.push(fehler(`Journal meldet ratio=${surface.ratio}, vorgegeben war ${expect.ratio}`));
	}
	if (journal.config === null) {
		findings.push(
			fehler(
				"keine `config`-Zeile im Auszug: sie steht beim Skriptstart, der Auszug muss dorthin zurückreichen",
			),
		);
	} else {
		if (
			journal.config.gapOuter !== expect.gapOuter ||
			journal.config.gapInner !== expect.gapInner
		) {
			findings.push(
				fehler(
					`Journal meldet gaps=${journal.config.gapOuter}/${journal.config.gapInner}, ` +
						`vorgegeben waren ${expect.gapOuter}/${expect.gapInner}`,
				),
			);
		}
		if (!journal.config.debug) {
			findings.push(
				fehler(
					"`debug=false`: ohne die Diagnosezeile sind Teilnehmer und Float-Markierung nicht belegbar",
				),
			);
		}
	}
	return findings;
}

// ---------------------------------------------------------------------------
// 4. Geometrie
// ---------------------------------------------------------------------------

export function toRect(probe: ProbeRect): Rect {
	return { x: probe.x, y: probe.y, width: probe.w, height: probe.h };
}

export function gleich(a: Rect, b: Rect): boolean {
	return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function fmtRect(rect: Rect): string {
	return `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
}

/** Max/Min-Form: das kurze `a.x < b.x + b.width` meldet für Breite 0 falsch. */
export function ueberlappt(a: Rect, b: Rect): boolean {
	const links = Math.max(a.x, b.x);
	const rechts = Math.min(a.x + a.width, b.x + b.width);
	const oben = Math.max(a.y, b.y);
	const unten = Math.min(a.y + a.height, b.y + b.height);
	return links < rechts && oben < unten;
}

export function enthalten(aussen: Rect, innen: Rect): boolean {
	return (
		innen.x >= aussen.x &&
		innen.y >= aussen.y &&
		innen.x + innen.width <= aussen.x + aussen.width &&
		innen.y + innen.height <= aussen.y + aussen.height
	);
}

export function sollZellen(expect: Expectation, area: Rect): Rect[] {
	const def = LAYOUTS.find((entry) => entry.id === expect.layout);
	if (def === undefined) {
		return [];
	}
	return def.apply(area, expect.n, {
		ratio: expect.ratio,
		gapOuter: expect.gapOuter,
		gapInner: expect.gapInner,
	});
}

export interface GeometryInput {
	/** Ist-Geometrien der Layout-Teilnehmer, nach Fenster-Id. */
	ist: Map<string, Rect>;
	/** Fläche der geprüften Surface, aus der Probe. */
	area: Rect;
	expect: Expectation;
	journal: Journal;
}

export function checkGeometry(input: GeometryInput): Finding[] {
	const findings: Finding[] = [];
	const { ist, area, expect, journal } = input;
	const soll = sollZellen(expect, area);

	if (ist.size !== expect.n) {
		findings.push(fehler(`${ist.size} Teilnehmer gemessen, vorgegeben waren ${expect.n}`));
	}
	if (soll.length === 0) {
		return [...findings, fehler(`unbekanntes Layout \`${expect.layout}\``)];
	}

	// Multimengenvergleich: die Zuordnung Fenster zu Zelle kennt die Probe
	// nicht, die Menge der belegten Rechtecke aber schon.
	const offen = soll.map(fmtRect).sort();
	const gemessen = Array.from(ist.values()).map(fmtRect).sort();
	if (JSON.stringify(offen) !== JSON.stringify(gemessen)) {
		const sollJeId = new Map<string, Rect>();
		for (const write of journal.writes) {
			if (write.kind === "apply" && write.soll !== null) {
				sollJeId.set(write.id, write.soll);
			}
		}
		const sollMengeAusJournal = Array.from(sollJeId.values()).map(fmtRect).sort();
		const sollStimmt =
			sollMengeAusJournal.length === offen.length &&
			JSON.stringify(sollMengeAusJournal) === JSON.stringify(offen);
		const aufgegeben = journal.writes.some((write) => write.kind === "aufgegeben");
		if (sollStimmt && aufgegeben) {
			findings.push(
				hinweis(
					"Ist weicht ab, das Soll stimmt und der Controller hat aufgegeben: " +
						"der Client hat die Größe nicht angenommen. Fall an einem Client wiederholen, " +
						"der exakt annimmt (Eignung protokollieren).",
				),
			);
		} else {
			findings.push(fehler(`Soll ${offen.join(" ")} gegen Ist ${gemessen.join(" ")}`));
		}
	}

	for (const [id, rect] of ist) {
		if (!enthalten(area, rect)) {
			findings.push(
				fehler(`Fenster ${id} liegt mit ${fmtRect(rect)} außerhalb von ${fmtRect(area)}`),
			);
		}
	}

	if (expect.layout === "tall") {
		const werte = Array.from(ist.entries());
		for (let i = 0; i < werte.length; i++) {
			for (let j = i + 1; j < werte.length; j++) {
				const a = werte[i] as [string, Rect];
				const b = werte[j] as [string, Rect];
				if (ueberlappt(a[1], b[1])) {
					findings.push(fehler(`${a[0]} und ${b[0]} überlappen sich in \`tall\``));
				}
			}
		}
		if (expect.n > 1) {
			const master = soll[0] as Rect;
			const passende = werte.filter((eintrag) => eintrag[1].width === master.width);
			if (passende.length !== 1) {
				findings.push(
					fehler(
						`${passende.length} Rechtecke mit Masterbreite ${master.width}, erwartet genau eines`,
					),
				);
			} else if ((passende[0] as [string, Rect])[1].x !== master.x) {
				findings.push(fehler("die Masterzelle liegt nicht links"));
			}
		}
	}

	if (expect.layout === "full") {
		// Deckungsgleich ist hier das erwartete Ergebnis, nicht der Fehler.
		const werte = Array.from(ist.values());
		const erstes = werte[0];
		if (erstes !== undefined) {
			for (const rect of werte) {
				if (!gleich(rect, erstes)) {
					findings.push(fehler(`\`full\` liefert unterschiedliche Rechtecke: ${fmtRect(rect)}`));
					break;
				}
			}
		}
	}

	return findings;
}

// ---------------------------------------------------------------------------
// Zusammenführung
// ---------------------------------------------------------------------------

export interface Report {
	findings: Finding[];
	bestanden: boolean;
}

export function run(ndjson: string, journalText: string, args: string[]): Report {
	const records = parseNdjson(ndjson);
	const journal = parseJournal(journalText);
	const findings: Finding[] = [...checkQuality(records), ...checkStability(records)];

	const expect = parseExpectation(args);
	if (expect !== null) {
		findings.push(...checkJournal(journal, expect));

		const samples = sampleIndices(records);
		const letzterSample = samples[samples.length - 1] ?? 0;
		const surface = letzteSurface(journal, expect.surface);
		const views = records.filter(
			(record) =>
				record.k === "view" && record.s === letzterSample && typeof record.key === "string",
		);
		const view =
			expect.surface === undefined
				? (views.find((record) => surface === null || record.key === surface.key) ?? views[0])
				: views.find((record) => record.key === expect.surface);

		if (view === undefined || view.area === undefined || view.area === null) {
			findings.push(fehler("keine passende `view` mit Arbeitsfläche im letzten Sample"));
		} else if (surface === null) {
			findings.push(fehler("keine `surface`-Zeile: Teilnehmer nicht bestimmbar"));
		} else {
			const diagnose = letzteDiagnose(journal, surface.key);
			if (diagnose === null) {
				findings.push(
					fehler(
						`keine \`diagnose\`-Zeile für ${surface.key}: die Layout-Teilnahme steht in der Registry, ` +
							"nicht am KWin-Fenster -- der Lauf braucht `debug=true`",
					),
				);
			} else {
				const ist = new Map<string, Rect>();
				for (const record of records) {
					if (record.k !== "win" || record.s !== letzterSample) {
						continue;
					}
					const id = String(record.id);
					if (!diagnose.participants.includes(id)) {
						continue;
					}
					const geo = record.geo as ProbeRect | null | undefined;
					if (geo === null || geo === undefined) {
						findings.push(fehler(`Fenster ${id} hat keine Geometrie im letzten Sample`));
						continue;
					}
					if (geo.exakt === false) {
						findings.push(hinweis(`Fenster ${id} meldete eine gebrochene Geometrie, gerundet`));
					}
					ist.set(id, toRect(geo));
				}
				findings.push(
					...checkGeometry({
						ist,
						area: toRect(view.area as ProbeRect),
						expect,
						journal,
					}),
				);
			}
		}
	}

	return {
		findings,
		bestanden: !findings.some((finding) => finding.level === "fehler"),
	};
}
