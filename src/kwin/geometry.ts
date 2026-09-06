import type { Rect } from "../core/rect.ts";
import { equals } from "../core/rect.ts";
import type { WindowState } from "../state/registry.ts";
import { UNLIMITED_SIZE } from "./filter.ts";
import type { WindowInfo } from "./types.ts";

/** Nachbesserungen je **Schreibgeneration** (PLAN.md Abschnitt 4, Punkt 4). */
export const MAX_CORRECTIONS = 2;

/** Warum eine Geometrie geschrieben wird — oder eben nicht. */
export type WriteVerdict = "write" | "unchanged" | "abandoned" | "drag" | "maximized";

/** Ob eine Float-Geometrie geschrieben und eine neue eingefangen werden darf. */
export type PlaceVerdict = "place" | "drag" | "blocked";

/** Was eine Meldung von `frameGeometryChanged` bedeutet. */
export type SignalVerdict = "ignore" | "settled" | "diverged";

/** Was eine eingeplante Nachprüfung ergibt. */
export type RecheckVerdict = "ignore" | "stale" | "settled" | "retry" | "giveup";

/**
 * Schiebt ein Rechteck in die Arbeitsfläche, ohne seine Größe zu ändern. Ist
 * das Rechteck größer als die Fläche, gewinnt deren linke obere Ecke.
 */
export function anchorInto(rect: Rect, area: Rect): Rect {
	let x = rect.x;
	let y = rect.y;
	if (x + rect.width > area.x + area.width) {
		x = area.x + area.width - rect.width;
	}
	if (y + rect.height > area.y + area.height) {
		y = area.y + area.height - rect.height;
	}
	if (x < area.x) {
		x = area.x;
	}
	if (y < area.y) {
		y = area.y;
	}

	return { x, y, width: rect.width, height: rect.height };
}

/**
 * Klemmt die Layoutzelle an die Größenschranken des Fensters. Der
 * Layoutkern kennt keine Fensterbeschränkungen; passt ein Fenster nicht in
 * seine Zelle, darf das Ergebnis die Nachbarzelle überlappen oder einen Teil
 * frei lassen, muss aber in der Arbeitsfläche verankert bleiben (PLAN.md
 * Abschnitt 6).
 *
 * Das ist ein Vorgriff auf Meilenstein 5, und zwar ein nötiger: ohne
 * Klemmung meldet ein Fenster mit Größenraster in jeder Epoche eine
 * abweichende Geometrie zurück und erzeugt zwei Nachbesserungen. Der Zähler
 * finge das ab, aber die Abnahme heißt "kein Flattern", nicht "gedeckeltes
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

	return anchorInto({ x: cell.x, y: cell.y, width, height }, area);
}

/**
 * Vor dem Schreiben. `"unchanged"` deckt ein erreichtes Ziel ab;
 * `"abandoned"` ein bereits aufgegebenes, unverändertes Soll/Ist-Paar. Beide
 * verhindern einen Write und damit eine neue Rückkopplung.
 */
export function judgeWrite(info: WindowInfo, target: Rect, state: WindowState): WriteVerdict {
	if (info.move || info.resize) {
		return "drag";
	}
	if (info.maximizeMode !== 0) {
		return "maximized";
	}
	if (equals(info.frameGeometry, target)) {
		return "unchanged";
	}
	if (
		state.expectedRect === null &&
		state.applyAttempts >= MAX_CORRECTIONS &&
		state.tiledRect !== null &&
		state.lastObservedRect !== null &&
		equals(target, state.tiledRect) &&
		equals(info.frameGeometry, state.lastObservedRect)
	) {
		return "abandoned";
	}
	return "write";
}

/**
 * Vor dem Float-Schreibvorgang und vor dem Einfangen einer Float-Geometrie.
 * `place` ist der dritte Schreibpfad neben Epoche und Nachprüfung und der
 * einzige ohne `judgeWrite`: die Float-Markierung hängt an der Mitgliedschaft,
 * und die kennt weder Vollbild noch Maximierung (Abschnitt 7). Ohne dieses
 * Urteil schriebe ein Toggle am maximierten Fenster dessen `frameGeometry` --
 * `moveResize` prüft den Maximierungsmodus nicht (`docs/research.md`
 * Abschnitt 4.3), PLAN.md Abschnitt 4 Punkt 3 verlangt `maximizeMode == 0`.
 *
 * Dasselbe Urteil entscheidet, ob die aktuelle Geometrie als `floatRect`
 * taugt: die Vollbildfläche ist keine Float-Geometrie, und `anchorInto`
 * verschiebt beim Wiederherstellen nur, es verkleinert nicht -- das Fenster
 * überdeckte danach das Panel.
 */
export function judgePlace(info: WindowInfo): PlaceVerdict {
	if (info.move || info.resize) {
		return "drag";
	}
	if (info.minimized || info.fullScreen || info.maximizeMode !== 0) {
		return "blocked";
	}
	return "place";
}

/**
 * Nach einer Meldung von `frameGeometryChanged`. Ein KWin-Signal trägt
 * **keine** Schreibgeneration; eine zu erfinden wäre eine Lüge im
 * Datenfluss. Das Urteil prüft deshalb nur gegen die aktuelle Erwartung des
 * Fensters, und `"diverged"` heißt ausschließlich "eine Nachprüfung
 * einplanen" — nachgebessert wird nie im Signalpfad.
 */
export function judgeSignal(state: WindowState, actual: Rect): SignalVerdict {
	if (state.expectedRect === null) {
		return "ignore";
	}
	if (equals(actual, state.expectedRect)) {
		return "settled";
	}
	return "diverged";
}

/**
 * Für die eingeplante Nachprüfung, die ihre Generation aus dem Zeitpunkt des
 * Einplanens mitbringt. `"stale"` heißt: ein neuerer Write besitzt diese
 * Erwartung inzwischen, dieser Eintrag hat nichts mehr zu melden. Der Zähler
 * begrenzt die Nachbesserungen je Schreibgeneration.
 */
export function judgeRecheck(state: WindowState, generation: number, actual: Rect): RecheckVerdict {
	if (state.expectedRect === null) {
		return "ignore";
	}
	if (state.writeGeneration !== generation) {
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
