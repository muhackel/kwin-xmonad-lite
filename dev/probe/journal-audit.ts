/**
 * Auditor des Controller-Journals.
 *
 * Er beantwortet die Frage der Alltagsstunde: hat der Controller irgendwo
 * geschrieben, ohne dass es dafür einen Anlass gab?
 *
 * Vier Entscheidungen, jede aus einem Fehlschlag eines einfacheren Entwurfs:
 *
 * 1. **Alle Schreibarten zählen**, nicht nur `apply`. `float` und
 *    `nachbessern` schreiben ebenfalls Geometrie; ein Auditor, der sie
 *    übersieht, erklärt eine Nachbesserungsschleife für ruhig.
 * 2. **`nachbessern` hängt am Fenster, nicht am letzten Anordnungslauf.** Es
 *    läuft im Recheck-Timer und gehört zur Schreibgeneration des Fensters. Es
 *    wird deshalb dem letzten `apply` **derselben Id** zugerechnet.
 * 3. **Technische Gründe sind kein Freibrief.** `geometrieExtern`,
 *    `nachlauf*`, `dock*`, `screensChanged`, `screenGeometry` und `closed`
 *    setzen den Wiederholungszähler nicht zurück. Sonst hielte sich eine
 *    Rückkopplung `extern -> arrange -> apply -> extern` selbst am Leben und
 *    wiese formal immer einen "neuen Anlass" vor.
 * 4. **Unklares wird ausgewiesen, nicht gewertet.** Eine Lücke im Auszug oder
 *    ein Schreibvorgang ohne zuordenbaren Lauf zählt weder als bestanden noch
 *    als Schleife -- er wird zur manuellen Prüfung gemeldet.
 */

// ---------------------------------------------------------------------------
// Gründe
// ---------------------------------------------------------------------------

/**
 * Die Namen stammen aus `src/kwin/adapter.ts`. Sie heißen `desktopChanged`
 * und `activityChanged` -- nicht wie die KWin-Signale, aus denen sie stammen.
 */
export const NUTZER_GRUENDE = [
	"start",
	"windowAdded",
	"windowRemoved",
	"windowActivated",
	"fensterzustand",
	"moveResizeFinished",
	"floatToggle",
	"desktopChanged",
	"activityChanged",
	"activitiesChanged",
	"desktopsChanged",
];

/**
 * Technisch, aber kein Anlass im Sinne des Kriteriums: diese Gründe entstehen
 * aus dem System selbst und teils aus der eigenen Wirkung des Controllers.
 */
export const TECHNISCHE_GRUENDE = [
	"geometrieExtern",
	"dockGeometrie",
	"dockEntfernt",
	"dockHinzugefügt",
	"screensChanged",
	"screenGeometry",
	"closed",
];

export function istNutzerGrund(grund: string): boolean {
	for (const teil of grund.split(",")) {
		if (teil.startsWith("shortcut:")) {
			return true;
		}
		if (NUTZER_GRUENDE.includes(teil)) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Zeilen
// ---------------------------------------------------------------------------

export type Schreibart = "apply" | "float" | "nachbessern";

export interface Ereignis {
	zeit: string;
	art: "arrange" | Schreibart | "aufgegeben" | "extern" | "geladen" | "marke";
	/** Bei `arrange`: der Grund. Sonst leer. */
	grund: string;
	/** Bei Schreibvorgängen: die Fenster-Id. */
	id: string;
	/** Sollrechteck als Zeichenkette, so wie es im Journal steht. */
	soll: string;
	/** Der Prozess, der die Zeile geschrieben hat. */
	pid: string;
	/** Bei `arrange`: die Nummer aus `arrange #n`. Sonst `null`. */
	epoche: number | null;
	/** Bei `marke`: der Text der Abnahmemarke. */
	text: string;
}

const ZEIT = /^(\S+)\s/;
const KOPF = /^\S+\s+\S+\s+([A-Za-z0-9_.-]+)\[(\d+)\]:/;

/**
 * Die Abnahmemarken kommen aus `systemd-cat -t kxl-abnahme` und tragen deshalb
 * eine **eigene** PID. Sie grenzen den Prüfzeitraum ab; für die Frage, ob ein
 * einziger Skriptlauf vorliegt, zählen sie nicht mit.
 */
const MARKE = "kxl-abnahme[";

export function parseEreignisse(text: string): Ereignis[] {
	const ereignisse: Ereignis[] = [];
	for (const raw of text.split("\n")) {
		const zeitTreffer = ZEIT.exec(raw);
		const zeit = zeitTreffer === null ? "" : (zeitTreffer[1] ?? "");
		const kopf2 = KOPF.exec(raw);
		const pid = kopf2 === null ? "" : (kopf2[2] ?? "");

		const markeIndex = raw.indexOf(MARKE);
		if (markeIndex >= 0) {
			const doppelpunkt = raw.indexOf(": ", markeIndex);
			ereignisse.push({
				zeit,
				art: "marke",
				grund: "",
				id: "",
				soll: "",
				pid,
				epoche: null,
				text: doppelpunkt < 0 ? "" : raw.slice(doppelpunkt + 2).trim(),
			});
			continue;
		}

		const index = raw.indexOf("kwin-xmonad-lite: ");
		if (index < 0) {
			continue;
		}
		const zeile = raw.slice(index + "kwin-xmonad-lite: ".length).trim();
		const teile = zeile.split(" ");
		const kopf = teile[0] ?? "";

		if (kopf === "arrange") {
			const grund = teile.find((teil) => teil.startsWith("grund=")) ?? "grund=";
			const nummer = Number(/^arrange #(\d+)/.exec(zeile)?.[1] ?? "");
			ereignisse.push({
				zeit,
				art: "arrange",
				grund: grund.slice("grund=".length),
				id: "",
				soll: "",
				pid,
				epoche: Number.isNaN(nummer) ? null : nummer,
				text: "",
			});
			continue;
		}
		if (kopf === "apply" || kopf === "float" || kopf === "nachbessern") {
			const soll = teile.find((teil) => teil.startsWith("soll=")) ?? "soll=";
			ereignisse.push({
				zeit,
				art: kopf,
				grund: "",
				id: teile[1] ?? "",
				soll: soll.slice("soll=".length),
				pid,
				epoche: null,
				text: "",
			});
			continue;
		}
		if (kopf === "aufgegeben" || kopf === "extern") {
			ereignisse.push({
				zeit,
				art: kopf,
				grund: "",
				id: teile[1] ?? "",
				soll: "",
				pid,
				epoche: null,
				text: "",
			});
			continue;
		}
		if (zeile.startsWith("geladen")) {
			ereignisse.push({
				zeit,
				art: "geladen",
				grund: "",
				id: "",
				soll: "",
				pid,
				epoche: null,
				text: "",
			});
		}
	}
	return ereignisse;
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

export interface Befund {
	level: "fehler" | "hinweis" | "manuell";
	text: string;
}

export interface Bericht {
	befunde: Befund[];
	/** Zahl der Schreibvorgänge insgesamt. */
	schreibvorgaenge: number;
	/** Schreibvorgänge ohne zuordenbaren Anordnungslauf. */
	unklar: number;
	/** Höchste Zahl gleicher Schreibvorgänge ohne nutzerveranlassten Grund. */
	maxWiederholungen: number;
	/** true, wenn kein Fehler und der Anteil "unklar" die Schwelle hält. */
	bestanden: boolean;
	/** Fenster, die die Geometrie nicht angenommen haben. */
	aufgegebene: string[];
	/** Alle Prozesse, die Controllerzeilen geschrieben haben. */
	pids: string[];
	/** Die Nummern der Anordnungsläufe, in der Reihenfolge des Auszugs. */
	epochen: number[];
}

/** Mehr als drei gleiche Schreibvorgänge ohne neuen Anlass gelten als Schleife. */
export const MAX_WIEDERHOLUNGEN = 3;

/** Ab diesem Anteil unklarer Zuordnungen ist der Auszug nicht belastbar. */
export const MAX_UNKLAR_ANTEIL = 0.05;

interface FensterStand {
	soll: string;
	zaehler: number;
	gemeldet: boolean;
}

export interface PruefOptionen {
	/**
	 * Fenster-Ids, für die die Vorschrift ein `aufgegeben` **bewusst
	 * provoziert**. Nur für sie bleibt es ein Hinweis; jedes andere ist im
	 * Stundenmodus ein Fehler.
	 */
	provoziert?: string[];
}

export function pruefe(ereignisse: Ereignis[], optionen: PruefOptionen = {}): Bericht {
	const befunde: Befund[] = [];
	const stand = new Map<string, FensterStand>();
	// Der letzte `apply` je Fenster: daran hängt die Zuordnung von
	// `nachbessern`, nicht am letzten Anordnungslauf.
	const letztesSoll = new Map<string, string>();
	const provoziert = new Set(optionen.provoziert ?? []);
	let grundOffen: string | null = null;
	let schreibvorgaenge = 0;
	let unklar = 0;
	let maxWiederholungen = 0;
	// Eine Kette **je Fenster**: eine globale verdrängte sich gegenseitig,
	// sobald zwei Fenster abwechselnd meldeten -- genau der Fall, in dem eine
	// Rückkopplung am ehesten entsteht.
	const externKetten = new Map<string, number>();
	const aufgegebene: string[] = [];
	const pids = new Set<string>();
	const epochen: number[] = [];
	let letztePid = "";

	for (const ereignis of ereignisse) {
		if (ereignis.art === "marke") {
			continue;
		}
		if (ereignis.pid !== "") {
			pids.add(ereignis.pid);
		}
		// Ein Prozesswechsel ist ein Skriptneustart, auch ohne `geladen`-Zeile
		// im Auszug: nach einem `replace` schreibt eine andere KWin-Instanz.
		if (letztePid !== "" && ereignis.pid !== "" && ereignis.pid !== letztePid) {
			stand.clear();
			letztesSoll.clear();
			grundOffen = null;
			externKetten.clear();
		}
		if (ereignis.pid !== "") {
			letztePid = ereignis.pid;
		}
		if (ereignis.art === "geladen") {
			// Ein neuer Skriptlauf beginnt: alles davor gehört nicht dazu.
			stand.clear();
			letztesSoll.clear();
			grundOffen = null;
			externKetten.clear();
			continue;
		}
		if (ereignis.art === "arrange") {
			grundOffen = ereignis.grund;
			if (ereignis.epoche !== null) {
				epochen.push(ereignis.epoche);
			}
			if (istNutzerGrund(ereignis.grund)) {
				// Ein echter Anlass macht jedes bisherige Ziel wieder frei.
				stand.clear();
				externKetten.clear();
			}
			continue;
		}
		if (ereignis.art === "extern") {
			const bisher = externKetten.get(ereignis.id) ?? 0;
			const jetzt = bisher + 1;
			externKetten.set(ereignis.id, jetzt);
			if (jetzt > 3) {
				befunde.push({
					level: "fehler",
					text:
						`Rückkopplung: ${ereignis.id} meldet zum ${jetzt}. Mal ` +
						`\`extern\`, ohne dass eine Nutzeraktion dazwischenlag (${ereignis.zeit})`,
				});
				externKetten.set(ereignis.id, 0);
			}
			continue;
		}
		if (ereignis.art === "aufgegeben") {
			aufgegebene.push(ereignis.id);
			befunde.push({
				level: provoziert.has(ereignis.id) ? "hinweis" : "hinweis",
				text: provoziert.has(ereignis.id)
					? `${ereignis.id} hat die Geometrie nicht angenommen (aufgegeben, ${ereignis.zeit}) — als provoziert erklärt`
					: `${ereignis.id} hat die Geometrie nicht angenommen (aufgegeben, ${ereignis.zeit})`,
			});
			continue;
		}

		// Ab hier: ein Schreibvorgang.
		schreibvorgaenge += 1;
		// `nachbessern` gehört zur Schreibgeneration **seines** Fensters. Ohne
		// vorangehenden `apply` derselben Id gibt es keine, der es zuzurechnen
		// wäre -- der frühere Rückfall auf das eigene `soll=` tat nur so.
		if (ereignis.art === "nachbessern" && !letztesSoll.has(ereignis.id)) {
			unklar += 1;
			befunde.push({
				level: "manuell",
				text:
					`Nachbesserung an ${ereignis.id} (${ereignis.zeit}) ohne vorangehenden \`apply\` ` +
					"derselben Id: keiner Schreibgeneration zuzuordnen, manuell zu prüfen",
			});
			continue;
		}
		const soll =
			ereignis.art === "nachbessern"
				? (letztesSoll.get(ereignis.id) ?? ereignis.soll)
				: ereignis.soll;
		if (ereignis.art !== "nachbessern") {
			letztesSoll.set(ereignis.id, ereignis.soll);
		}

		if (grundOffen === null) {
			unklar += 1;
			befunde.push({
				level: "manuell",
				text:
					`Schreibvorgang an ${ereignis.id} (${ereignis.zeit}) ohne vorangehende ` +
					"`arrange`-Zeile: Auszug unvollständig, manuell zu prüfen",
			});
			continue;
		}

		const vorher = stand.get(ereignis.id);
		if (vorher !== undefined && vorher.soll === soll) {
			vorher.zaehler += 1;
			maxWiederholungen = Math.max(maxWiederholungen, vorher.zaehler);
			// Nur **einmal** melden, aber weiterzählen: ein Rücksetzen des Zählers
			// ließ `maxWiederholungen` systematisch untertreiben, gerade bei den
			// langen Ketten, um die es geht.
			if (vorher.zaehler > MAX_WIEDERHOLUNGEN && !vorher.gemeldet) {
				vorher.gemeldet = true;
				befunde.push({
					level: "fehler",
					text:
						`${ereignis.id} wurde ${vorher.zaehler}-mal auf dasselbe Soll ${soll} geschrieben, ` +
						`ohne dass eine Nutzeraktion dazwischenlag (zuletzt ${ereignis.zeit}, ` +
						`Grund ${grundOffen})`,
				});
			}
		} else {
			stand.set(ereignis.id, { soll, zaehler: 1, gemeldet: false });
			maxWiederholungen = Math.max(maxWiederholungen, 1);
		}
	}

	const anteilUnklar = schreibvorgaenge === 0 ? 0 : unklar / schreibvorgaenge;
	if (anteilUnklar > MAX_UNKLAR_ANTEIL) {
		befunde.push({
			level: "fehler",
			text:
				`${Math.round(anteilUnklar * 100)} % der Schreibvorgänge sind keinem Lauf zuzuordnen: ` +
				"der Auszug belegt nichts",
		});
	}

	return {
		befunde,
		schreibvorgaenge,
		unklar,
		maxWiederholungen,
		bestanden: !befunde.some((befund) => befund.level === "fehler"),
		aufgegebene,
		pids: Array.from(pids),
		epochen,
	};
}

/**
 * Lücken und Rücksprünge in der Folge der Anordnungsläufe.
 *
 * Der Zähler läuft in einer Instanz strikt um eins hoch. Eine Lücke heißt
 * deshalb: dem Auszug fehlen Zeilen. Ein Rücksprung heißt: das Skript wurde neu
 * geladen -- und wenn dabei keine `geladen`-Zeile im Auszug steht, ist er
 * zusammengesetzt.
 */
export function epochenluecken(epochen: number[]): { luecken: number[][]; ruecksprung: boolean } {
	const luecken: number[][] = [];
	let ruecksprung = false;
	for (let i = 1; i < epochen.length; i++) {
		const vorher = epochen[i - 1] as number;
		const jetzt = epochen[i] as number;
		if (jetzt < vorher) {
			ruecksprung = true;
		} else if (jetzt > vorher + 1) {
			luecken.push([vorher, jetzt]);
		}
	}
	return { luecken, ruecksprung };
}

// ---------------------------------------------------------------------------
// Belegschwelle der Alltagsstunde
// ---------------------------------------------------------------------------

export const MIN_MINUTEN = 60;

/** Zeitspanne des Auszugs in Minuten, aus den ISO-Zeitstempeln. */
export function spanneMinuten(ereignisse: Ereignis[]): number | null {
	const zeiten = ereignisse
		.map((ereignis) => Date.parse(ereignis.zeit))
		.filter((wert) => !Number.isNaN(wert));
	if (zeiten.length < 2) {
		return null;
	}
	let min = zeiten[0] as number;
	let max = zeiten[0] as number;
	for (const zeit of zeiten) {
		if (zeit < min) {
			min = zeit;
		}
		if (zeit > max) {
			max = zeit;
		}
	}
	return (max - min) / 60000;
}

/**
 * Ein zu kurzer Auszug, eine Lücke oder ein Skriptneustart mitten in der
 * Messung führen zu "nicht ausreichend belegt" -- nicht zu "bestanden".
 */
export function pruefeAlltagsstunde(text: string, optionen: PruefOptionen = {}): Bericht {
	const ereignisse = parseEreignisse(text);
	const bericht = pruefe(ereignisse, optionen);
	const provoziert = new Set(optionen.provoziert ?? []);

	// Der Prüfzeitraum sind die **Fallmarken**, nicht die erste und letzte
	// Zeile: ein Auszug kann vor und nach dem Fall beliebig weit reichen.
	const marken = ereignisse.filter((ereignis) => ereignis.art === "marke");
	const minuten = marken.length >= 2 ? spanneMinuten(marken) : spanneMinuten(ereignisse);
	if (marken.length < 2) {
		bericht.befunde.push({
			level: "hinweis",
			text:
				"weniger als zwei Fallmarken (`kxl-abnahme`) im Auszug: der Prüfzeitraum ist die " +
				"Spanne aller Zeilen, nicht der markierte Fall",
		});
	}

	if (minuten === null) {
		bericht.befunde.push({
			level: "fehler",
			text: "keine auswertbaren Zeitstempel: der Auszug braucht `journalctl -o short-iso`",
		});
	} else if (minuten < MIN_MINUTEN) {
		bericht.befunde.push({
			level: "fehler",
			text: `nicht ausreichend belegt: der Auszug deckt ${minuten.toFixed(1)} min ab, verlangt sind ${MIN_MINUTEN}`,
		});
	}

	// Ein Give-up ist im Stundenmodus ein Fehler -- PLAN.md Abschnitt 11
	// verlangt "kein `aufgegeben` außerhalb bewusst provozierter Fälle".
	// Provozierte Fälle nennt die Vorschrift beim Aufruf, nicht das Werkzeug.
	for (const id of bericht.aufgegebene) {
		if (!provoziert.has(id)) {
			bericht.befunde.push({
				level: "fehler",
				text:
					`${id} hat die Geometrie nicht angenommen (aufgegeben) — außerhalb eines bewusst ` +
					"provozierten Falls. Wenn der Fall es vorsieht: `--provoziert` nennen.",
			});
		}
	}

	// Skriptlauf: die `geladen`-Zeile ist nur **ein** Indiz, und sie fehlt in
	// jedem Auszug, der mitten im Lauf beginnt. Belastbar ist die Kombination
	// aus einer PID und einer lückenlosen Epochenfolge: ein Reload schriebe
	// eine `geladen`-Zeile **und** setzte den Zähler auf #1 zurück.
	const controllerzeilen = ereignisse.filter((ereignis) => ereignis.art !== "marke");
	const neustarts = controllerzeilen.filter((ereignis) => ereignis.art === "geladen").length;
	const erste = controllerzeilen[0];
	if (neustarts > 1) {
		bericht.befunde.push({
			level: "fehler",
			text: `nicht ausreichend belegt: ${neustarts} Skriptläufe im Auszug, die Stunde muss ein Lauf sein`,
		});
	} else if (neustarts === 1 && erste !== undefined && erste.art !== "geladen") {
		bericht.befunde.push({
			level: "fehler",
			text:
				"nicht ausreichend belegt: Skriptneustart mitten im Auszug — die `geladen`-Zeile ist " +
				"nicht die erste Controllerzeile",
		});
	}

	if (bericht.pids.length > 1) {
		bericht.befunde.push({
			level: "fehler",
			text: `nicht ausreichend belegt: Zeilen von ${bericht.pids.length} KWin-Prozessen (${bericht.pids.join(", ")})`,
		});
	}

	const { luecken, ruecksprung } = epochenluecken(bericht.epochen);
	for (const [von, bis] of luecken) {
		bericht.befunde.push({
			level: "fehler",
			text: `Journallücke: Anordnungslauf #${von} springt auf #${bis}, dem Auszug fehlen Zeilen`,
		});
	}
	if (ruecksprung && neustarts === 0) {
		bericht.befunde.push({
			level: "fehler",
			text: "Rücksprung der Anordnungsnummer ohne `geladen`-Zeile: der Auszug ist zusammengesetzt",
		});
	}
	if (neustarts === 0) {
		bericht.befunde.push({
			level: "hinweis",
			text:
				"keine `geladen`-Zeile im Auszug: der Skriptstart liegt davor. Die Kontinuität ist über " +
				`eine PID und die lückenlose Folge #${bericht.epochen[0] ?? "?"}–#${bericht.epochen[bericht.epochen.length - 1] ?? "?"} belegt.`,
		});
	}

	bericht.bestanden = !bericht.befunde.some((befund) => befund.level === "fehler");
	return bericht;
}
