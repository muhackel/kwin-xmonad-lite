import { clampRatio, LAYOUTS, RATIO_DEFAULT } from "../core/layout/index.ts";
import { DEFAULT_EXCLUDES, makeExcludes, normalizeClass } from "./filter.ts";
import type { Gaps } from "./plan.ts";

/**
 * Wirksame Konfiguration eines Laufs. Sie entsteht einmal beim Start aus
 * `[Script-<pluginName>]` und wird danach nicht mehr gelesen -- KWin reicht
 * den Wert aus dem Speicher heraus und liest die Datei erst nach
 * `Workspace::reconfigure()` neu (docs/research.md Abschnitt 2.7).
 */
export interface Config {
	gaps: Gaps;
	/** Ausschlussliste für `isMember`, normalisiert. */
	excludes: Set<string>;
	/** Dieselben Einträge sortiert -- nur für die Journalzeile. */
	excludeList: string[];
	/** Startwert neuer Surfaces und Ziel von `resetLayout`. */
	masterRatio: number;
	/** Dito, aufgelöst aus dem Layoutnamen. */
	layoutIndex: number;
	/** Schaltet die ausführlichen Journalzeilen frei. */
	debug: boolean;
	/** Je Klemmung und je Rückfall auf den Vorgabewert eine Zeile. */
	notes: string[];
}

/**
 * Der Leser liefert **Rohzeichenketten**, keine typisierten Werte.
 *
 * KConfig ersetzt einen nicht konvertierbaren Eintrag bereits selbst durch den
 * Vorgabewert: mit einem numerischen Vorgabewert käme für `gapOuter=abc`
 * schlicht die Vorgabe an, ununterscheidbar von "nicht gesetzt", und keine
 * Korrekturnotiz wäre je zu erzeugen. Mit dem Sentinel unten kommt jede
 * Eingabe unverfälscht durch, und die ganze Umwandlung liegt hinter der
 * Snapshot-Grenze und damit unter `node --test`.
 */
export interface ConfigReader {
	/** Rohwert, oder `null` wenn der Schlüssel nicht gesetzt ist. */
	raw(key: string): string | null;
}

/**
 * Vorgabewert für den Rohleser. Er muss ein Wert sein, den niemand von Hand
 * in `kwinrc` schreibt; der Namensraum des Projekts genügt dafür.
 */
export const RAW_UNSET = "<kxl-unset>";

/** Obergrenze der Abstände. Fängt den Tippfehler ab, nicht den Geschmack. */
export const GAP_MAX = 200;

/** Trennzeichen der Ausschlussliste in `kwinrc`. */
export const EXCLUDE_SEPARATOR = ",";

export function defaultConfig(): Config {
	return {
		gaps: { outer: 0, inner: 0 },
		excludes: makeExcludes(DEFAULT_EXCLUDES),
		excludeList: sortedList(DEFAULT_EXCLUDES),
		masterRatio: RATIO_DEFAULT,
		layoutIndex: 0,
		debug: false,
		notes: [],
	};
}

/** Normalisiert, entfernt Leereinträge und sortiert -- nur für die Ausgabe. */
export function sortedList(entries: string[]): string[] {
	const out: string[] = [];
	for (const entry of entries) {
		const value = normalizeClass(entry);
		if (value.length > 0 && out.indexOf(value) < 0) {
			out.push(value);
		}
	}
	out.sort();
	return out;
}

/** Löst einen Layoutnamen gegen `LAYOUTS` auf; unbekannt ergibt `-1`. */
export function layoutIndexOf(id: string): number {
	for (let i = 0; i < LAYOUTS.length; i++) {
		const layout = LAYOUTS[i];
		if (layout !== undefined && layout.id === id) {
			return i;
		}
	}
	return -1;
}

/**
 * `Math.round(-0)` liefert -0, und `Object.is` unterscheidet das von 0 --
 * ein strikter Vergleich gegen die Vorgabe scheiterte daran.
 */
function withoutNegativeZero(value: number): number {
	return value === 0 ? 0 : value;
}

/**
 * Ein Abstand aus einem Rohwert. Ganzzahlig ist Pflicht: `tall` und `full`
 * liefern ganzzahlige Zellen, und eine gebrochene Kante brächte in jeder
 * Epoche eine Abweichung zwischen Soll und Rücklesen.
 */
function loadGap(reader: ConfigReader, key: string, notes: string[]): number {
	const raw = reader.raw(key);
	if (raw === null) {
		return 0;
	}
	// `Number("")` und `Number(" ")` sind 0 und damit endlich. Ohne diese
	// Sperre wäre ein leer gesetzter Schlüssel stillschweigend die Vorgabe --
	// und der Unterschied zu "nicht gesetzt" ginge verloren.
	if (raw.trim().length === 0 || !Number.isFinite(Number(raw))) {
		notes.push(`config ${key}=${raw} unlesbar, verwende 0`);
		return 0;
	}
	const value = Number(raw);
	const rounded = withoutNegativeZero(Math.round(value));
	if (rounded < 0) {
		notes.push(`config ${key}=${raw} unzulässig, verwende 0`);
		return 0;
	}
	if (rounded > GAP_MAX) {
		notes.push(`config ${key}=${raw} geklemmt auf ${GAP_MAX}`);
		return GAP_MAX;
	}
	if (rounded !== value) {
		notes.push(`config ${key}=${raw} gerundet auf ${rounded}`);
	}
	return rounded;
}

/**
 * Der Masteranteil landet auf zwei Nachkommastellen, genau wie in `stepRatio`.
 * Sonst driftet ein konfigurierter Wert gegen die Rasterwerte, die `Meta+H`
 * und `Meta+L` erreichen, und `resetLayout` träfe sein eigenes Ziel nie.
 */
function loadRatio(reader: ConfigReader, notes: string[]): number {
	const raw = reader.raw("masterRatio");
	if (raw === null) {
		return RATIO_DEFAULT;
	}
	if (raw.trim().length === 0 || !Number.isFinite(Number(raw))) {
		notes.push(`config masterRatio=${raw} unlesbar, verwende ${RATIO_DEFAULT}`);
		return RATIO_DEFAULT;
	}
	const value = Number(raw);
	const clamped = clampRatio(value);
	const rounded = Math.round(clamped * 100) / 100;
	if (clamped !== value) {
		notes.push(`config masterRatio=${raw} geklemmt auf ${rounded}`);
	} else if (rounded !== value) {
		notes.push(`config masterRatio=${raw} gerundet auf ${rounded}`);
	}
	return rounded;
}

/**
 * Groß- und Kleinschreibung wird toleriert, und Leerraum am Rand fällt weg:
 * der Wert kommt aus einem von Hand gepflegten `kwinrc` oder aus einer
 * Nix-Zeichenkette, und sämtliche Einträge in `LAYOUTS` sind kleingeschrieben
 * -- eine Kollision zweier Layoutnamen ist damit ausgeschlossen. Es ist
 * dieselbe Normalisierung, die `normalizeClass` für die Ausschlussliste macht.
 */
function loadLayout(reader: ConfigReader, notes: string[]): number {
	const raw = reader.raw("defaultLayout");
	if (raw === null) {
		return 0;
	}
	const index = layoutIndexOf(normalizeClass(raw));
	if (index < 0) {
		const fallback = LAYOUTS[0];
		notes.push(
			`config defaultLayout=${raw} unbekannt, verwende ${fallback === undefined ? "tall" : fallback.id}`,
		);
		return 0;
	}
	return index;
}

/** Nur `true` und `false` gelten; alles andere ist eine Fehleingabe. */
function loadDebug(reader: ConfigReader, notes: string[]): boolean {
	const raw = reader.raw("debug");
	if (raw === null) {
		return false;
	}
	const value = normalizeClass(raw);
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	notes.push(`config debug=${raw} unlesbar, verwende false`);
	return false;
}

/**
 * Ein **leer gesetzter** Schlüssel heißt leere Liste, nicht Vorgabe: "nichts
 * ausschließen" muss erreichbar bleiben, sonst wäre `plasmashell` nicht
 * mitzukacheln. Das ist folgenreich genug für eine eigene Notiz -- wer sich
 * vertippt, sieht sonst nur, dass plötzlich das Panel im Layout hängt.
 */
function loadExcludes(reader: ConfigReader, notes: string[]): string[] {
	const raw = reader.raw("excludes");
	if (raw === null) {
		return sortedList(DEFAULT_EXCLUDES);
	}
	const list = sortedList(raw.split(EXCLUDE_SEPARATOR));
	if (list.length === 0) {
		notes.push("config excludes leer: kein Fenster wird ausgeschlossen");
	}
	return list;
}

/**
 * Die ganze Umwandlung an einer Stelle: **nie werfen, immer klemmen**, und
 * jede Korrektur bekommt eine Zeile in `notes`. Ein Schlüssel, der nicht
 * gesetzt ist, erzeugt keine -- nur eine gesetzte, aber unbrauchbare Eingabe.
 * Ausgegeben werden die Notizen vom Adapter; diese Datei kennt kein `log`.
 */
export function loadConfig(reader: ConfigReader): Config {
	const notes: string[] = [];
	const outer = loadGap(reader, "gapOuter", notes);
	const inner = loadGap(reader, "gapInner", notes);
	const excludeList = loadExcludes(reader, notes);
	const masterRatio = loadRatio(reader, notes);
	const layoutIndex = loadLayout(reader, notes);
	const debug = loadDebug(reader, notes);

	return {
		gaps: { outer, inner },
		excludes: makeExcludes(excludeList),
		excludeList,
		masterRatio,
		layoutIndex,
		debug,
		notes,
	};
}
