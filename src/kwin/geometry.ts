import type { Rect } from "../core/rect.ts";
import { equals } from "../core/rect.ts";
import type { WindowState } from "../state/registry.ts";
import { UNLIMITED_SIZE } from "./filter.ts";
import type { WindowInfo } from "./types.ts";

/** Nachbesserungen je Anordnungsepoche (PLAN.md Abschnitt 4, Punkt 4). */
export const MAX_CORRECTIONS = 2;

/** Warum eine Geometrie geschrieben wird — oder eben nicht. */
export type WriteVerdict = "write" | "unchanged" | "drag" | "maximized";

/** Was eine Meldung von `frameGeometryChanged` bedeutet. */
export type CheckVerdict = "ignore" | "stale" | "settled" | "retry" | "giveup";

/**
 * Klemmt die Layoutzelle an die Groessenschranken des Fensters. Der
 * Layoutkern kennt keine Fensterbeschraenkungen; passt ein Fenster nicht in
 * seine Zelle, darf das Ergebnis die Nachbarzelle ueberlappen oder einen Teil
 * frei lassen, muss aber in der Arbeitsflaeche verankert bleiben (PLAN.md
 * Abschnitt 6).
 *
 * Das ist ein Vorgriff auf Meilenstein 5, und zwar ein noetiger: ohne
 * Klemmung meldet ein Fenster mit Groessenraster in jeder Epoche eine
 * abweichende Geometrie zurueck und erzeugt zwei Nachbesserungen. Der Zaehler
 * finge das ab, aber die Abnahme heisst "kein Flattern", nicht "gedeckeltes
 * Flattern".
 */
export function fitToCell(cell: Rect, info: WindowInfo, area: Rect): Rect {
	let width = cell.width;
	let height = cell.height;

	if (info.minWidth > 0 && width < info.minWidth) {
		width = info.minWidth;
	}
	if (info.minHeight > 0 && height < info.minHeight) {
		height = info.minHeight;
	}
	if (info.maxWidth < UNLIMITED_SIZE && width > info.maxWidth) {
		width = info.maxWidth;
	}
	if (info.maxHeight < UNLIMITED_SIZE && height > info.maxHeight) {
		height = info.maxHeight;
	}

	let x = cell.x;
	let y = cell.y;
	if (x + width > area.x + area.width) {
		x = area.x + area.width - width;
	}
	if (y + height > area.y + area.height) {
		y = area.y + area.height - height;
	}
	// Die linke obere Ecke gewinnt: lieber rechts ueberstehen als das Fenster
	// unter seine Mindestgroesse druecken.
	if (x < area.x) {
		x = area.x;
	}
	if (y < area.y) {
		y = area.y;
	}

	return { x, y, width, height };
}

/**
 * Vor dem Schreiben. `"unchanged"` ist die eigentliche Flatterbremse: eine
 * Epoche ohne Aenderung schreibt gar nichts, also feuert auch kein
 * `frameGeometryChanged`, also entsteht keine Rueckkopplung.
 */
export function judgeWrite(info: WindowInfo, target: Rect): WriteVerdict {
	if (info.move || info.resize) {
		return "drag";
	}
	if (info.maximizeMode !== 0) {
		return "maximized";
	}
	if (equals(info.frameGeometry, target)) {
		return "unchanged";
	}
	return "write";
}

/**
 * Nach einer Meldung von `frameGeometryChanged`. `"stale"` verwirft eine
 * Bestaetigung, die zu einer aelteren Epoche gehoert — auf Wayland kann eine
 * Groessenaenderung beliebig spaet zurueckkommen.
 */
export function judgeCorrection(
	state: WindowState,
	generation: number,
	actual: Rect,
): CheckVerdict {
	if (state.expectedRect === null) {
		return "ignore";
	}
	if (state.applyGeneration !== generation) {
		return "stale";
	}
	if (equals(actual, state.expectedRect)) {
		return "settled";
	}
	if (state.applyAttempts >= MAX_CORRECTIONS) {
		return "giveup";
	}
	return "retry";
}
