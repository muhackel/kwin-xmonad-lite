import type { Rect } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import type { SurfaceKey, SurfaceRef } from "../core/surface.ts";

/**
 * Momentaufnahme eines KWin-Fensters in schlichten Werten. Der Adapter liest
 * die KWin-Objekte genau einmal je Durchlauf hier hinein; Filter, Anordnung
 * und Geometriewaechter arbeiten danach nur noch auf diesen Zahlen und sind
 * deshalb ohne laufenden Compositor pruefbar.
 *
 * Die Feldauswahl ist nicht auf Vorrat gewaehlt: was hier steht, braucht
 * entweder Meilenstein 3 selbst, oder es haelt die Grenze fuer Meilenstein 4
 * (Ausgabe, Desktops, Activities, `dock`) und 5 (Zustaende, Groessenschranken)
 * offen. Von den 160 Eigenschaften eines `Window` bleibt alles Uebrige drausen.
 *
 * **Kein `floating`**: die Float-Markierung sitzt in der Registry, nicht am
 * KWin-Objekt. `participates` nimmt sie als eigenes Argument.
 */
export interface WindowInfo {
	/** `String(window.internalId)`, traegt geschweifte Klammern. */
	id: WindowId;
	/** Roh uebernommen; normalisiert wird erst im Filter, damit es im Test steckt. */
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
	/** Neben `normalWindow` redundant, aber Auswahlkriterium fuer MS 4. */
	dock: boolean;

	// --- Surface-Zuordnung --------------------------------------------------
	/** `output.name`; leer, wenn KWin dem Fenster keine Ausgabe zuordnet. */
	outputName: string;
	/** Desktop-Ids. **Leer heisst alle** (PLAN.md Risiko 7). */
	desktopIds: string[];
	/** Activity-UUIDs. **Leer heisst alle**. */
	activityIds: string[];
	/** Gegenprobe zur Regel "leere Liste heisst alle". */
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

	// --- Waechter -----------------------------------------------------------
	/** `window.move` / `window.resize`: der Nutzer zieht gerade. */
	move: boolean;
	resize: boolean;
}

/** Eine sichtbare Surface samt der Flaeche, auf der ihr Layout rechnet. */
export interface SurfaceView {
	key: SurfaceKey;
	ref: SurfaceRef;
	/** `clientArea(KWin.MaximizeArea, output, desktop)` -- Panel abgezogen. */
	area: Rect;
}

/**
 * Was ein Lesedurchgang liefert. Bewusst schmal: Meilenstein 4 haengt fuer
 * `purgeSurfaces` die Listen der gueltigen Activities und Desktops an, das ist
 * additiv und bricht den Schnitt nicht.
 */
export interface Snapshot {
	views: SurfaceView[];
	windows: WindowInfo[];
	/** Aus `workspace.activeWindow` **desselben** Durchgangs, nicht aus einem Signal. */
	activeId: WindowId | null;
}
