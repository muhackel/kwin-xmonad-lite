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

/**
 * Drei Stufen, nicht zwei. `nicht-abgenommen` ist der Fall, in dem der
 * **Controller** entlastet ist -- sein Soll stimmt mit der gerechneten Zelle
 * ueberein --, der Client die Groesse aber nicht angenommen hat. Das ist kein
 * Fehler des Controllers und trotzdem kein bestandener Geometrienachweis: die
 * Zelle ist nie so angekommen, wie sie gerechnet wurde. Ein solcher Fall wird
 * mit einem geeigneten Client wiederholt.
 */
export interface Finding {
	level: "fehler" | "nicht-abgenommen" | "hinweis";
	text: string;
}

export function fehler(text: string): Finding {
	return { level: "fehler", text };
}

export function nichtAbgenommen(text: string): Finding {
	return { level: "nicht-abgenommen", text };
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
		// `caption` gehoert nicht zum fachlichen Zustand: kwrite haengt beim
		// Aendern ein `*` an den Titel, und ein Titelwechsel zwischen zwei
		// Samples ist keine Unruhe der Geometrie.
		if (
			key === "n" ||
			key === "ms" ||
			key === "s" ||
			key === "r" ||
			key === "trunc" ||
			key === "caption"
		) {
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

	// `r` und `n` sind **Pflicht** auf jedem Satz. Werden sie nur gefiltert,
	// prueft die Lueckenkontrolle im Extremfall eine leere Liste, und die
	// Laufstempel-Menge besteht aus dem einen Wert `undefined` -- eine Datei
	// ohne jedes `r` und `n` bestuende dann klaglos.
	const ohneLaufstempel = records.filter((record) => typeof record.r !== "number").length;
	if (ohneLaufstempel > 0) {
		findings.push(fehler(`${ohneLaufstempel} Sätze ohne Laufstempel \`r\``));
	}
	const ohneNummer = records.filter((record) => typeof record.n !== "number").length;
	if (ohneNummer > 0) {
		findings.push(fehler(`${ohneNummer} Sätze ohne Satznummer \`n\``));
	}

	// Ein zweiter Lauf im selben Journalfenster fiele hier auf.
	const runs = new Set(
		records.map((record) => record.r).filter((value): value is number => typeof value === "number"),
	);
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

	// Die Samplestaffel wird gegen die im `meta`-Satz **angekuendigte** Liste
	// gehalten. Sonst genuegten die beiden fruehen Samples, und genau die
	// spaeten belegen das Einschwingen.
	const meta = records.find((record) => record.k === "meta");
	const angekuendigt = meta === undefined ? undefined : meta.samples;
	if (Array.isArray(angekuendigt)) {
		const vorhanden = new Set(sampleIndices(records));
		for (let i = 0; i < angekuendigt.length; i++) {
			if (!vorhanden.has(i)) {
				findings.push(
					fehler(
						`Sample ${i} (${String(angekuendigt[i])} ms) fehlt: die Staffel ist unvollständig`,
					),
				);
			}
		}
	} else {
		findings.push(fehler("`meta`-Satz ohne Samplestaffel: die Vollständigkeit ist nicht prüfbar"));
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
	/** Millisekunden seit der Epoche, aus dem ISO-Stempel der Journalzeile. */
	zeit: number;
	/** Nummer des Anordnungslaufs, in dem die Zeile entstand. */
	epoche: number | null;
}

export interface DiagnoseLine {
	key: string;
	order: string[];
	participants: string[];
	floating: string[];
	zeit: number;
	epoche: number | null;
}

export interface WriteLine {
	kind: "apply" | "float" | "nachbessern" | "aufgegeben";
	id: string;
	soll: Rect | null;
	ist: Rect | null;
	zeit: number;
	epoche: number | null;
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
	/** Alle Prozesse, die im Auszug Controllerzeilen geschrieben haben. */
	pids: string[];
	/** Die Nummern der Anordnungsläufe, in der Reihenfolge des Auszugs. */
	epochen: Array<{ nummer: number; zeit: number; grund: string }>;
	/** Zeilen, die vor dem letzten `geladen` lagen und deshalb verworfen wurden. */
	verworfen: number;
}

/**
 * `2026-09-06T18:31:30+02:00 HAL9000 kwin_wayland[49086]: kwin-xmonad-lite: …`
 *
 * Ohne Zeit und Prozess ist eine Journalzeile nicht zuzuordnen: der Auszug
 * reicht absichtlich über die Messung hinaus (die `config`-Zeile steht beim
 * Skriptstart), und nach einem `replace` schreiben zwei Prozesse in dieselbe
 * Unit.
 */
const KOPF = /^(\S+)\s+\S+\s+([A-Za-z0-9_.-]+)\[(\d+)\]:/;

export function parseKopf(raw: string): { zeit: number; pid: string } | null {
	const treffer = KOPF.exec(raw);
	if (treffer === null) {
		return null;
	}
	const zeit = Date.parse(treffer[1] ?? "");
	return { zeit: Number.isNaN(zeit) ? 0 : zeit, pid: treffer[3] ?? "" };
}

export interface ParseOptionen {
	/** Nur Zeilen dieses Prozesses gelten. */
	pid?: string;
	/** Zeilen **nach** diesem Zeitpunkt beschreiben die Messung nicht mehr. */
	bis?: number;
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

export function parseJournal(text: string, optionen: ParseOptionen = {}): Journal {
	const journal: Journal = {
		config: null,
		surfaces: [],
		diagnosen: [],
		writes: [],
		externals: [],
		loads: 0,
		pids: [],
		epochen: [],
		verworfen: 0,
	};
	const pids = new Set<string>();
	let zeit = 0;
	let epoche: number | null = null;
	let gezaehlt = 0;

	for (const raw of text.split("\n")) {
		const index = raw.indexOf("kwin-xmonad-lite: ");
		if (index < 0) {
			continue;
		}
		const kopf = parseKopf(raw);
		if (kopf !== null) {
			zeit = kopf.zeit;
			pids.add(kopf.pid);
			if (optionen.pid !== undefined && kopf.pid !== optionen.pid) {
				continue;
			}
		}
		// Zeilen **nach** dem Ende der Messung beschreiben einen Zustand, den
		// die Probe nie gesehen hat. Zeilen davor bleiben: die `config`-Zeile
		// steht beim Skriptstart, lange vor jedem Probelauf.
		if (optionen.bis !== undefined && kopf !== null && kopf.zeit > optionen.bis) {
			continue;
		}
		gezaehlt += 1;
		const zeile = raw.slice(index + "kwin-xmonad-lite: ".length).trim();

		if (zeile.startsWith("geladen")) {
			// Ein neuer Skriptlauf beginnt. Alles davor gehoert **nicht** dazu:
			// Konfiguration, Surface- und Diagnosewerte und jeder Schreibvorgang
			// stammen aus einer Instanz, die es nicht mehr gibt. Ohne diesen
			// Schnitt genuegte ein alter, gueltiger Lauf im selben Auszug, um
			// einen neuen ohne jede eigene Zeile bestehen zu lassen.
			journal.loads += 1;
			journal.verworfen += gezaehlt - 1;
			gezaehlt = 1;
			journal.config = null;
			journal.surfaces = [];
			journal.diagnosen = [];
			journal.writes = [];
			journal.externals = [];
			journal.epochen = [];
			epoche = null;
			continue;
		}
		if (zeile.startsWith("arrange #")) {
			const nummer = Number(/^arrange #(\d+)/.exec(zeile)?.[1] ?? "");
			const f = felder(zeile);
			if (!Number.isNaN(nummer)) {
				epoche = nummer;
				journal.epochen.push({ nummer, zeit, grund: f.get("grund") ?? "" });
			}
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
					zeit,
					epoche,
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
				zeit,
				epoche,
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
				zeit,
				epoche,
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
				zeit,
				epoche,
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
				zeit,
				epoche,
			});
			continue;
		}
		if (zeile.startsWith("extern ")) {
			journal.externals.push(zeile.split(" ")[1] ?? "");
		}
	}

	journal.pids = Array.from(pids);
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
		// Die Entlastung des Controllers wird **je Fenster** geprueft, nicht
		// ueber den Auszug als Ganzes. Ein `aufgegeben` an einem unbeteiligten
		// Fenster entlastet nichts -- vorher genuegte irgendeine solche Zeile
		// im Journal, um eine beliebig falsche Geometrie durchzuwinken.
		const sollJeId = new Map<string, Rect>();
		const sollEpoche = new Map<string, number | null>();
		const aufgegebenJeId = new Map<string, Rect | null>();
		const aufgegebenEpoche = new Map<string, number | null>();
		for (const write of journal.writes) {
			if (write.kind === "apply" && write.soll !== null) {
				sollJeId.set(write.id, write.soll);
				sollEpoche.set(write.id, write.epoche);
			}
			if (write.kind === "aufgegeben") {
				aufgegebenJeId.set(write.id, write.ist);
				aufgegebenEpoche.set(write.id, write.epoche);
			}
		}

		const sollMengeAusJournal = Array.from(sollJeId.values()).map(fmtRect).sort();
		const sollStimmt =
			sollMengeAusJournal.length === offen.length &&
			JSON.stringify(sollMengeAusJournal) === JSON.stringify(offen);

		// Jedes abweichende Fenster braucht seine eigene Entschuldigung: ein
		// Soll, das zur gerechneten Zelle passt, ein `aufgegeben` fuer genau
		// diese Id, und ein dort vermerktes Ist, das zur Messung passt.
		const sollMenge = new Set(offen);
		const unentschuldigt: string[] = [];
		for (const [id, rect] of ist) {
			if (sollMenge.has(fmtRect(rect))) {
				continue;
			}
			const eigenesSoll = sollJeId.get(id);
			const eigenesAufgeben = aufgegebenJeId.get(id);
			const sollPasst = eigenesSoll !== undefined && sollMenge.has(fmtRect(eigenesSoll));
			const istPasst =
				eigenesAufgeben !== undefined &&
				(eigenesAufgeben === null || fmtRect(eigenesAufgeben) === fmtRect(rect));
			// Das Give-up muss **nach** dem letzten Schreibversuch stehen. Ein
			// aelteres entlastet nicht: danach kam ein neuer `apply`, und dessen
			// Ergebnis ist unbelegt.
			const eSoll = sollEpoche.get(id);
			const eAufgeben = aufgegebenEpoche.get(id);
			const reihenfolgePasst =
				eSoll === undefined ||
				eSoll === null ||
				eAufgeben === undefined ||
				eAufgeben === null ||
				eAufgeben >= eSoll;
			if (!(sollPasst && aufgegebenJeId.has(id) && istPasst && reihenfolgePasst)) {
				unentschuldigt.push(`${id} misst ${fmtRect(rect)}`);
			}
		}

		if (sollStimmt && unentschuldigt.length === 0) {
			findings.push(
				nichtAbgenommen(
					"Ist weicht ab, das Soll stimmt und der Controller hat für jedes betroffene " +
						"Fenster aufgegeben: der Client hat die Größe nicht angenommen. Der Controller " +
						"ist entlastet, der Fall ist geometrisch **nicht abgenommen** — an einem Client " +
						"wiederholen, der exakt annimmt (Eignung protokollieren).",
				),
			);
		} else if (sollStimmt) {
			findings.push(
				fehler(
					`Soll ${offen.join(" ")} gegen Ist ${gemessen.join(" ")}; ohne Give-up für ` +
						`dieses Fenster: ${unentschuldigt.join(", ")}`,
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
			// Der Master wird an seiner **vollstaendigen Sollzelle** erkannt, nicht
			// an der Breite allein: bei `ratio=0.5` ist die Stapelspalte genauso
			// breit wie der Master, und die Breitenzaehlung meldete dann zwei
			// Treffer fuer ein voellig korrektes Layout.
			const master = soll[0] as Rect;
			const passende = werte.filter((eintrag) => gleich(eintrag[1], master));
			if (passende.length !== 1) {
				findings.push(
					fehler(
						`${passende.length} Rechtecke mit der Masterzelle ${fmtRect(master)}, erwartet genau eines`,
					),
				);
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

/**
 * Gehoert das gemessene Fenster zu der Surface, die dieser `view`-Satz
 * beschreibt? Leere `desktops`/`activities` heissen "alle" -- so wie es
 * `src/kwin/filter.ts` auch auslegt.
 */
export function gehoertZu(win: ProbeRecord, view: ProbeRecord): boolean {
	if (String(win.output) !== String(view.output)) {
		return false;
	}
	const desktops = win.desktops;
	if (Array.isArray(desktops) && desktops.length > 0) {
		if (!desktops.map(String).includes(String(view.desktop))) {
			return false;
		}
	}
	const activities = win.activities;
	if (Array.isArray(activities) && activities.length > 0) {
		if (!activities.map(String).includes(String(view.activity))) {
			return false;
		}
	}
	return true;
}

export interface RunOptionen {
	/** Erwartete KWin-PID. Kommt aus dem Wrapper, nicht aus der Vorschrift. */
	pid?: string;
}

/**
 * Das Zeitfenster der Messung: von `meta.start` bis zum letzten Satz. Zeilen
 * danach beschreiben einen Zustand, den die Probe nie gesehen hat.
 */
export function messfenster(records: ProbeRecord[]): { von: number; bis: number } | null {
	const meta = records.find((record) => record.k === "meta");
	const start = meta === undefined ? undefined : meta.start;
	if (typeof start !== "number") {
		return null;
	}
	let letztes = 0;
	for (const record of records) {
		if (typeof record.ms === "number" && record.ms > letztes) {
			letztes = record.ms;
		}
	}
	return { von: start, bis: start + letztes };
}

export function run(
	ndjson: string,
	journalText: string,
	args: string[],
	optionen: RunOptionen = {},
): Report {
	const records = parseNdjson(ndjson);
	const fenster = messfenster(records);
	const journal = parseJournal(journalText, {
		pid: optionen.pid,
		bis: fenster === null ? undefined : fenster.bis,
	});
	const findings: Finding[] = [...checkQuality(records), ...checkStability(records)];

	// Ein Auszug mit Zeilen mehrerer KWin-Prozesse gehoert zu mehr als einem
	// Lauf. Ohne ausdrueckliche PID ist dann nicht bestimmt, welcher gemeint
	// ist -- und `parseJournal` naehme stillschweigend den letzten.
	if (optionen.pid === undefined && journal.pids.length > 1) {
		findings.push(
			fehler(
				`Auszug enthält Zeilen von ${journal.pids.length} KWin-Prozessen ` +
					`(${journal.pids.join(", ")}): die Messung braucht \`--kwin-pid\``,
			),
		);
	}
	if (optionen.pid !== undefined && !journal.pids.includes(optionen.pid)) {
		findings.push(fehler(`keine Zeile des Prozesses ${optionen.pid} im Auszug`));
	}
	if (journal.verworfen > 0) {
		findings.push(
			hinweis(
				`${journal.verworfen} Zeilen vor dem letzten \`geladen\` verworfen: sie gehören zu einer ` +
					"früheren Instanz",
			),
		);
	}
	// Ein Anordnungslauf **waehrend** der Messung heisst, dass sich die
	// Geometrie unter der Probe bewegt hat -- die Samples zeigen dann einen
	// Uebergang, keinen Zustand.
	if (fenster !== null) {
		const waehrend = journal.epochen.filter(
			(eintrag) => eintrag.zeit >= fenster.von && eintrag.zeit <= fenster.bis,
		);
		if (waehrend.length > 0) {
			const namen = waehrend.map((eintrag) => `#${eintrag.nummer} (${eintrag.grund})`).join(", ");
			findings.push(
				fehler(
					`während der Messung liefen ${waehrend.length} Anordnungsläufe (${namen}): ` +
						"der Auszug beschreibt einen Übergang, nicht den gemessenen Zustand",
				),
			);
		}
	}

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

		// Bei mehreren gemessenen Surfaces muss die Vorschrift sagen, welche
		// gemeint ist. Vorher fiel die Wahl still auf `views[0]` -- bei zwei
		// Ausgaben also auf eine Zufallsreihenfolge im Auszug.
		if (expect.surface === undefined && views.length > 1) {
			const namen = views.map((record) => String(record.key)).join(", ");
			findings.push(
				fehler(
					`${views.length} Surfaces gemessen (${namen}): die Vorschrift muss \`surface=\` nennen`,
				),
			);
		}

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
				// Zwei unabhaengige Quellen fuer dieselbe Arbeitsflaeche: die
				// Probe misst sie, das Journal meldet sie. Laufen sie
				// auseinander, rechnet das Orakel gegen eine Flaeche, die so nie
				// anlag.
				const gemesseneArea = toRect(view.area as ProbeRect);
				if (!gleich(gemesseneArea, surface.area)) {
					findings.push(
						fehler(
							`Arbeitsfläche widersprüchlich: Probe misst ${fmtRect(gemesseneArea)}, ` +
								`das Journal meldet ${fmtRect(surface.area)}`,
						),
					);
				}

				const ist = new Map<string, Rect>();
				for (const record of records) {
					if (record.k !== "win" || record.s !== letzterSample) {
						continue;
					}
					const id = String(record.id);
					if (!diagnose.participants.includes(id)) {
						continue;
					}
					// Die Teilnehmerliste kommt aus der Registry, die Zugehoerigkeit
					// aus der Messung. Beides muss zusammenpassen -- sonst rechnete
					// das Orakel Fenster einer fremden Surface in dieses Layout.
					// Leere Listen heissen "alle" (Polonium-Issue #222).
					if (!gehoertZu(record, view)) {
						findings.push(
							fehler(
								`Fenster ${id} steht in der Diagnose von ${surface.key}, liegt laut Probe ` +
									"aber auf einer anderen Surface",
							),
						);
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
		// `nicht-abgenommen` zaehlt wie ein Fehler gegen das Bestehen: der
		// Controller mag entlastet sein, die Geometrie ist trotzdem nicht
		// nachgewiesen. Nur `hinweis` laesst den Lauf bestehen.
		bestanden: !findings.some(
			(finding) => finding.level === "fehler" || finding.level === "nicht-abgenommen",
		),
	};
}
