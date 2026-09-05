import type { Rect } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import type { SurfaceKey, SurfaceRef } from "../core/surface.ts";

/**
 * Momentaufnahme eines KWin-Fensters in schlichten Werten. Der Adapter liest
 * die KWin-Objekte genau einmal je Durchlauf hier hinein; Filter, Anordnung
 * und Geometriewächter arbeiten danach nur noch auf diesen Zahlen und sind
 * deshalb ohne laufenden Compositor prüfbar.
 *
 * Die Feldauswahl ist nicht auf Vorrat gewählt: was hier steht, braucht
 * entweder Meilenstein 3 selbst, oder es hält die Grenze für Meilenstein 4
 * (Ausgabe, Desktops, Activities, `dock`) und 5 (Zustände, Größenschranken)
 * offen. Von den 160 Eigenschaften eines `Window` bleibt alles Übrige draußen.
 *
 * **Kein `floating`**: die Float-Markierung sitzt in der Registry, nicht am
 * KWin-Objekt. `participates` nimmt sie als eigenes Argument.
 */
export interface WindowInfo {
	/** `String(window.internalId)`, trägt geschweifte Klammern. */
	id: WindowId;
	/** Roh übernommen; normalisiert wird erst im Filter, damit es im Test steckt. */
	resourceClass: string;

	// --- Mitgliedschaft -----------------------------------------------------
	managed: boolean;
	deleted: boolean;
	normalWindow: boolean;
	specialWindow: boolean;
	popupWindow: boolean;
	dialog: boolean;
	utility: boolean;
	splash: boolean;
	transient: boolean;
	modal: boolean;
	/** Neben `normalWindow` redundant, aber Auswahlkriterium für MS 4. */
	dock: boolean;

	// --- Surface-Zuordnung --------------------------------------------------
	/** `output.name`; leer, wenn KWin dem Fenster keine Ausgabe zuordnet. */
	outputName: string;
	/** Desktop-Ids. **Leer heißt alle** (PLAN.md Risiko 7). */
	desktopIds: string[];
	/** Activity-UUIDs. **Leer heißt alle**. */
	activityIds: string[];
	/** Gegenprobe zur Regel "leere Liste heißt alle". */
	onAllDesktops: boolean;

	// --- Geometrie und Schranken --------------------------------------------
	frameGeometry: Rect;
	/** Getrennte Zahlen statt `QSize`: kein KWin-Wrappertyp im reinen Teil. */
	minWidth: number;
	minHeight: number;
	maxWidth: number;
	maxHeight: number;

	// --- Layout-Teilnahme ---------------------------------------------------
	fullScreen: boolean;
	minimized: boolean;
	maximizeMode: number;
	/** Ein Vollbildfenster meldet beide als `false` -- deshalb nur hier. */
	moveable: boolean;
	resizeable: boolean;

	// --- Wächter -----------------------------------------------------------
	/** `window.move` / `window.resize`: der Nutzer zieht gerade. */
	move: boolean;
	resize: boolean;
}

/** Eine sichtbare Surface samt der Fläche, auf der ihr Layout rechnet. */
export interface SurfaceView {
	key: SurfaceKey;
	ref: SurfaceRef;
	/** `clientArea(KWin.MaximizeArea, output, desktop)` -- Panel abgezogen. */
	area: Rect;
}

/** Was ein Lesedurchgang liefert. */
export interface Snapshot {
	views: SurfaceView[];
	windows: WindowInfo[];
	/** Aus `workspace.activeWindow` **desselben** Durchgangs, nicht aus einem Signal. */
	activeId: WindowId | null;
	/**
	 * Alle gültigen Activity-UUIDs aus `workspace.activities`. Ist-Menge für
	 * den Registry-GC in `purge.ts` -- nicht die Activities eines Fensters.
	 */
	activities: string[];
	/** Alle gültigen Desktop-Ids aus `workspace.desktops`. */
	desktops: string[];
}
