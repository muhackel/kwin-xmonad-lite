import type { Rect } from "../core/rect.ts";
import { rounded } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import type { SurfaceRef } from "../core/surface.ts";
import { surfaceKey } from "../core/surface.ts";
import { log } from "./log.ts";
import type { Snapshot, SurfaceView, WindowInfo } from "./types.ts";

/**
 * Die eine Seite der Snapshot-Grenze, die KWin-Objekte anfasst. Alle Listen
 * werden mit klassischen Zählschleifen durchlaufen: `windowList()`,
 * `desktops` und `activities` sind array-artig, aber keine Arrays.
 */

/** `internalId` ist ein QUuid-Objekt; als Zeichenkette trägt es Klammern. */
export function windowId(window: KwinWindow): WindowId {
	return String(window.internalId);
}

/**
 * Jedes Rechteck wird beim Auslesen gerundet (PLAN.md Abschnitt 4, Punkt 3:
 * „gerundet vergleichen“). Damit vergleichen `judgeWrite`, das Rücklesen nach
 * dem Schreiben und der Signalpfad alle gegen ganze Pixel — gemessen
 * ganzzahlig ist nur `clientArea`, nicht `frameGeometry`.
 */
function toRect(rect: QRect): Rect {
	return rounded({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

export function readFrameGeometry(window: KwinWindow): Rect {
	return toRect(window.frameGeometry);
}

function readDesktopIds(list: ArrayLike<KwinVirtualDesktop>): string[] {
	const ids: string[] = [];
	for (let i = 0; i < list.length; i++) {
		const desktop = list[i];
		if (desktop !== undefined) {
			ids.push(desktop.id);
		}
	}
	return ids;
}

function readActivityIds(list: ArrayLike<string>): string[] {
	const ids: string[] = [];
	for (let i = 0; i < list.length; i++) {
		const id = list[i];
		if (id !== undefined) {
			ids.push(id);
		}
	}
	return ids;
}

export function readWindow(window: KwinWindow): WindowInfo {
	const output = window.output;
	return {
		id: windowId(window),
		resourceClass: window.resourceClass,

		managed: window.managed,
		deleted: window.deleted,
		normalWindow: window.normalWindow,
		specialWindow: window.specialWindow,
		popupWindow: window.popupWindow,
		dialog: window.dialog,
		utility: window.utility,
		splash: window.splash,
		transient: window.transient,
		modal: window.modal,
		dock: window.dock,

		outputName: output === null ? "" : output.name,
		desktopIds: readDesktopIds(window.desktops),
		activityIds: readActivityIds(window.activities),
		onAllDesktops: window.onAllDesktops,

		frameGeometry: readFrameGeometry(window),
		minWidth: window.minSize.width,
		minHeight: window.minSize.height,
		maxWidth: window.maxSize.width,
		maxHeight: window.maxSize.height,

		fullScreen: window.fullScreen,
		minimized: window.minimized,
		maximizeMode: window.maximizeMode,
		moveable: window.moveable,
		resizeable: window.resizeable,

		move: window.move,
		resize: window.resize,
	};
}

/**
 * Alle sichtbaren Surfaces. Der Leser baut sie für **jede** Ausgabe, nicht
 * nur für eine: die Einschränkung "ein Output, ein Desktop" aus Meilenstein 3
 * betrifft die Abnahme, nicht die Funktion. Eine künstliche Beschränkung
 * müsste Meilenstein 4 sofort wieder herausreißen.
 */
export function readViews(): SurfaceView[] {
	const views: SurfaceView[] = [];
	const activity = workspace.currentActivity;
	const screens = workspace.screens;

	for (let i = 0; i < screens.length; i++) {
		const output = screens[i];
		if (output === undefined) {
			continue;
		}
		const desktop = workspace.currentDesktopForScreen(output) ?? workspace.currentDesktop;
		if (desktop === null) {
			log(`Ausgabe ${output.name} hat keinen Desktop, wird übersprungen`);
			continue;
		}
		const ref: SurfaceRef = { activity, desktop: desktop.id, output: output.name };
		views.push({
			key: surfaceKey(ref),
			ref,
			area: toRect(workspace.clientArea(KWin.MaximizeArea, output, desktop)),
		});
	}
	return views;
}

export interface Reading {
	snapshot: Snapshot;
	/**
	 * Die Fensterobjekte zum selben Lesedurchgang. Der Plan rechnet mit Ids,
	 * das Schreiben braucht die Objekte; ein späteres Nachschlagen über
	 * `windowList()` könnte ein inzwischen totes Objekt erwischen.
	 */
	handles: Map<WindowId, KwinWindow>;
}

export function readSnapshot(): Reading {
	const views = readViews();
	const list = workspace.windowList();
	const windows: WindowInfo[] = [];
	const handles = new Map<WindowId, KwinWindow>();

	for (let i = 0; i < list.length; i++) {
		const window = list[i];
		if (window === undefined) {
			continue;
		}
		const info = readWindow(window);
		windows.push(info);
		handles.set(info.id, window);
	}

	const active = workspace.activeWindow;
	const activeId = active === null ? null : windowId(active);

	// Die Ist-Mengen für den Registry-GC. Beide Listen sind array-artig, aber
	// keine Arrays -- dieselben Leser wie für die Fenstereigenschaften.
	const activities = readActivityIds(workspace.activities);
	const desktops = readDesktopIds(workspace.desktops);

	return { snapshot: { views, windows, activeId, activities, desktops }, handles };
}

/** Immer das ganze Rect zuweisen — eine Teilzuweisung wirkt nicht. */
export function writeFrameGeometry(window: KwinWindow, rect: Rect): void {
	window.frameGeometry = {
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
	};
}
