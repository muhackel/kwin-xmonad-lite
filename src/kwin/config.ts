import { LAYOUTS, RATIO_DEFAULT } from "../core/layout/index.ts";
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
