import type { WindowId } from "../core/stack.ts";
import type { SurfaceKey } from "../core/surface.ts";
import type { SurfaceView, WindowInfo } from "./types.ts";

/** Was `maxSize` fuer "unbegrenzt" meldet (an KWin 6.7.4 gemessen). */
export const UNLIMITED_SIZE = 2147483647;

/**
 * Vorgabe der Ausschlussliste (PLAN.md Abschnitt 7). Ab Meilenstein 6 kommt
 * sie aus `readConfig`, deshalb nimmt `makeExcludes` schon jetzt eine Liste
 * entgegen statt die Konstante direkt zu lesen.
 */
export const DEFAULT_EXCLUDES: string[] = [
	"krunner",
	"yakuake",
	"kded6",
	"polkit-kde-authentication-agent-1",
	"plasmashell",
	"xwaylandvideobridge",
	"steam_app_default",
];

export function normalizeClass(value: string): string {
	return value.trim().toLowerCase();
}

export function makeExcludes(list: string[]): Set<string> {
	const set = new Set<string>();
	for (const entry of list) {
		set.add(normalizeClass(entry));
	}
	return set;
}

/**
 * Ein Fenster, das seine Groesse nicht aendern kann, wird nicht verwaltet
 * (PLAN.md Abschnitt 7). Die Pruefung auf `UNLIMITED_SIZE` muss zuerst
 * kommen: sonst gilt ein Fenster ohne Hoechstgroesse als fest, sobald die
 * Mindestgroesse zufaellig denselben Wert traegt. Die Null-Sperre schuetzt
 * das gemessene Dock mit `minSize 0x0`.
 */
export function isFixedSize(info: WindowInfo): boolean {
	if (info.maxWidth >= UNLIMITED_SIZE || info.maxHeight >= UNLIMITED_SIZE) {
		return false;
	}
	return (
		info.minWidth > 0 &&
		info.minHeight > 0 &&
		info.minWidth === info.maxWidth &&
		info.minHeight === info.maxHeight
	);
}

/**
 * Dauerhafte Surface-Mitgliedschaft. Prueft **nicht** `moveable`/`resizeable`:
 * ein Fenster im Vollbild meldet beide als `false`, soll aber Mitglied
 * bleiben und nach dem Vollbild an seinen Platz zurueckkehren (PLAN.md
 * Abschnitt 4, Matrix 12). Ebenso wenig geprueft werden Floating,
 * Minimierung, Maximierung und Vollbild -- die schalten nur die
 * Layout-Teilnahme ab.
 *
 * Der Ausschluss laeuft ueber **Vollmatch** der normalisierten
 * `resourceClass`, nicht ueber Teilzeichenketten (Anti-Pattern
 * Tessera/Aerogel): `plasmashell` faellt heraus, `plasmashell-testbed` nicht.
 */
export function isMember(info: WindowInfo, excludes: Set<string>): boolean {
	return (
		info.managed &&
		!info.deleted &&
		info.normalWindow &&
		!info.specialWindow &&
		!info.popupWindow &&
		!info.dialog &&
		!info.utility &&
		!info.splash &&
		!info.dock &&
		!info.transient &&
		!info.modal &&
		!isFixedSize(info) &&
		!excludes.has(normalizeClass(info.resourceClass))
	);
}

/** Nur Layout-Teilnehmer bekommen ein Rechteck. `floating` kommt aus der Registry. */
export function participates(info: WindowInfo, floating: boolean): boolean {
	return (
		!floating &&
		!info.minimized &&
		!info.fullScreen &&
		info.maximizeMode === 0 &&
		info.moveable &&
		info.resizeable
	);
}

/**
 * In welchen sichtbaren Surfaces ist das Fenster Mitglied? Die Asymmetrie ist
 * gewollt: KWin ordnet jedem Fenster genau **eine** Ausgabe zu, dort gilt
 * "leer heisst alle" nicht. Bei Desktops und Activities gilt es (PLAN.md
 * Risiko 7) — ein Fenster auf allen Desktops wird in jeder Surface
 * mitgekachelt.
 */
export function surfaceKeysFor(info: WindowInfo, views: SurfaceView[]): SurfaceKey[] {
	const keys: SurfaceKey[] = [];
	for (let i = 0; i < views.length; i++) {
		const view = views[i];
		if (view === undefined) {
			continue;
		}
		if (info.outputName !== view.ref.output) {
			continue;
		}
		if (info.desktopIds.length > 0 && info.desktopIds.indexOf(view.ref.desktop) < 0) {
			continue;
		}
		if (info.activityIds.length > 0 && info.activityIds.indexOf(view.ref.activity) < 0) {
			continue;
		}
		keys.push(view.key);
	}
	return keys;
}

/**
 * Mitgliedermenge je Surface, in der Reihenfolge der Fensterliste — damit
 * `reconcile` bei mehreren neuen Fenstern deterministisch einfuegt. Jede
 * sichtbare Surface bekommt einen Eintrag, auch eine leere: sonst behielte
 * eine geraeumte Surface ihren alten Stapel.
 */
export function membersBySurface(
	windows: WindowInfo[],
	views: SurfaceView[],
	excludes: Set<string>,
): Map<SurfaceKey, WindowId[]> {
	const members = new Map<SurfaceKey, WindowId[]>();
	for (const view of views) {
		members.set(view.key, []);
	}
	for (const info of windows) {
		if (!isMember(info, excludes)) {
			continue;
		}
		for (const key of surfaceKeysFor(info, views)) {
			const list = members.get(key);
			if (list !== undefined) {
				list.push(info.id);
			}
		}
	}
	return members;
}
