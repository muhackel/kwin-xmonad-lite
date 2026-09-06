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
	art: "arrange" | Schreibart | "aufgegeben" | "extern" | "geladen";
	/** Bei `arrange`: der Grund. Sonst leer. */
	grund: string;
	/** Bei Schreibvorgängen: die Fenster-Id. */
	id: string;
	/** Sollrechteck als Zeichenkette, so wie es im Journal steht. */
	soll: string;
}

const ZEIT = /^(\S+)\s/;

export function parseEreignisse(text: string): Ereignis[] {
	const ereignisse: Ereignis[] = [];
	for (const raw of text.split("\n")) {
		const index = raw.indexOf("kwin-xmonad-lite: ");
		if (index < 0) {
			continue;
		}
		const zeitTreffer = ZEIT.exec(raw);
		const zeit = zeitTreffer === null ? "" : (zeitTreffer[1] ?? "");
		const zeile = raw.slice(index + "kwin-xmonad-lite: ".length).trim();
		const teile = zeile.split(" ");
		const kopf = teile[0] ?? "";

		if (kopf === "arrange") {
			const grund = teile.find((teil) => teil.startsWith("grund=")) ?? "grund=";
			ereignisse.push({
				zeit,
				art: "arrange",
				grund: grund.slice("grund=".length),
				id: "",
				soll: "",
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
			});
			continue;
		}
		if (kopf === "aufgegeben" || kopf === "extern") {
			ereignisse.push({ zeit, art: kopf, grund: "", id: teile[1] ?? "", soll: "" });
			continue;
		}
		if (zeile.startsWith("geladen")) {
			ereignisse.push({ zeit, art: "geladen", grund: "", id: "", soll: "" });
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
}

/** Mehr als drei gleiche Schreibvorgänge ohne neuen Anlass gelten als Schleife. */
export const MAX_WIEDERHOLUNGEN = 3;

/** Ab diesem Anteil unklarer Zuordnungen ist der Auszug nicht belastbar. */
export const MAX_UNKLAR_ANTEIL = 0.05;

interface FensterStand {
	soll: string;
	zaehler: number;
}

export function pruefe(ereignisse: Ereignis[]): Bericht {
	const befunde: Befund[] = [];
	const stand = new Map<string, FensterStand>();
	// Der letzte `apply` je Fenster: daran hängt die Zuordnung von
	// `nachbessern`, nicht am letzten Anordnungslauf.
	const letztesSoll = new Map<string, string>();
	let grundOffen: string | null = null;
	let schreibvorgaenge = 0;
	let unklar = 0;
	let maxWiederholungen = 0;
	let externKette = 0;
	let letzterExtern = "";

	for (const ereignis of ereignisse) {
		if (ereignis.art === "geladen") {
			// Ein neuer Skriptlauf beginnt: alles davor gehört nicht dazu.
			stand.clear();
			letztesSoll.clear();
			grundOffen = null;
			externKette = 0;
			continue;
		}
		if (ereignis.art === "arrange") {
			grundOffen = ereignis.grund;
			if (istNutzerGrund(ereignis.grund)) {
				// Ein echter Anlass macht jedes bisherige Ziel wieder frei.
				stand.clear();
				externKette = 0;
			}
			continue;
		}
		if (ereignis.art === "extern") {
			if (ereignis.id === letzterExtern) {
				externKette += 1;
				if (externKette > 2) {
					befunde.push({
						level: "fehler",
						text:
							`Rückkopplung: ${ereignis.id} meldet zum ${externKette + 1}. Mal in Folge ` +
							`\`extern\`, ohne dass eine Nutzeraktion dazwischenlag (${ereignis.zeit})`,
					});
					externKette = 0;
				}
			} else {
				letzterExtern = ereignis.id;
				externKette = 1;
			}
			continue;
		}
		if (ereignis.art === "aufgegeben") {
			befunde.push({
				level: "hinweis",
				text: `${ereignis.id} hat die Geometrie nicht angenommen (aufgegeben, ${ereignis.zeit})`,
			});
			continue;
		}

		// Ab hier: ein Schreibvorgang.
		schreibvorgaenge += 1;
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
			if (vorher.zaehler > MAX_WIEDERHOLUNGEN) {
				befunde.push({
					level: "fehler",
					text:
						`${ereignis.id} wurde ${vorher.zaehler}-mal auf dasselbe Soll ${soll} geschrieben, ` +
						`ohne dass eine Nutzeraktion dazwischenlag (zuletzt ${ereignis.zeit}, ` +
						`Grund ${grundOffen})`,
				});
				vorher.zaehler = 0;
			}
		} else {
			stand.set(ereignis.id, { soll, zaehler: 1 });
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
	};
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
export function pruefeAlltagsstunde(text: string): Bericht {
	const ereignisse = parseEreignisse(text);
	const bericht = pruefe(ereignisse);
	const minuten = spanneMinuten(ereignisse);

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

	const neustarts = ereignisse.filter((ereignis) => ereignis.art === "geladen").length;
	if (neustarts > 1) {
		bericht.befunde.push({
			level: "fehler",
			text: `nicht ausreichend belegt: ${neustarts} Skriptläufe im Auszug, die Stunde muss ein Lauf sein`,
		});
	}

	bericht.bestanden = !bericht.befunde.some((befund) => befund.level === "fehler");
	return bericht;
}
