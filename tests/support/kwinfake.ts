import type { Rect } from "../../src/core/rect.ts";
import { surfaceKey } from "../../src/core/surface.ts";
import type { GeometryPort } from "../../src/kwin/apply.ts";
import { UNLIMITED_SIZE } from "../../src/kwin/filter.ts";
import type { Timer } from "../../src/kwin/timer.ts";
import type { Snapshot, SurfaceView, WindowInfo } from "../../src/kwin/types.ts";

export const ACTIVITY = "a89f5ec2-ab8e-4108-8088-7118500a3aab";
export const DESKTOP = "89539ae6-e06b-4c76-a057-95df959578a9";
export const OUTPUT = "DP-1";

/** Die auf SPIELKISTE gemessene Arbeitsfläche, Panel abgezogen. */
export const AREA: Rect = { x: 0, y: 0, width: 2560, height: 1410 };

/**
 * Ein unauffälliges, verwaltbares Fenster. Die Tests verändern danach
 * einzelne Felder direkt — Objekt-Spread scheitert am Parser der QJSEngine,
 * und `tests/` hält sich an dieselben Grenzen wie `src/`.
 */
export function windowInfo(id: string): WindowInfo {
	return {
		id,
		resourceClass: "kwrite",

		managed: true,
		deleted: false,
		normalWindow: true,
		specialWindow: false,
		popupWindow: false,
		dialog: false,
		utility: false,
		splash: false,
		transient: false,
		modal: false,
		dock: false,

		outputName: OUTPUT,
		desktopIds: [DESKTOP],
		activityIds: [ACTIVITY],
		onAllDesktops: false,

		frameGeometry: { x: 0, y: 0, width: 800, height: 600 },
		minWidth: 0,
		minHeight: 0,
		maxWidth: UNLIMITED_SIZE,
		maxHeight: UNLIMITED_SIZE,

		fullScreen: false,
		minimized: false,
		maximizeMode: 0,
		moveable: true,
		resizeable: true,

		move: false,
		resize: false,
	};
}

export function view(output: string, desktop: string, activity: string, area: Rect): SurfaceView {
	const ref = { activity, desktop, output };
	return { key: surfaceKey(ref), ref, area };
}

/** Die Standard-Surface: eine Ausgabe, ein Desktop, eine Activity. */
export function singleView(): SurfaceView {
	return view(OUTPUT, DESKTOP, ACTIVITY, AREA);
}

/**
 * Ein Lesedurchgang. `activities` und `desktops` sind die **Ist-Mengen des
 * Systems** für den Registry-GC, nicht die eines Fensters; die Vorgabe
 * erklärt die Standardwerte für gültig.
 */
export function snapshotOf(
	views: SurfaceView[],
	windows: WindowInfo[],
	activeId: string | null,
	activities: string[] = [ACTIVITY],
	desktops: string[] = [DESKTOP],
): Snapshot {
	return { views, windows, activeId, activities, desktops };
}

export interface FakeTimer extends Timer {
	/** Löst den verbundenen Handler aus, wie es der echte Timer täte. */
	fire(): void;
	/** Wie oft `start()` gerufen wurde — zeigt einen unnötigen Neustart. */
	starts(): number;
	/**
	 * Stellt einen Timer nach, dessen `singleShot`-Zuweisung **nicht**
	 * durchschlägt: `fire()` lässt ihn dann laufen. Gemessen ist nur, dass die
	 * Eigenschaft existiert und `false` meldet — wer sich auf ihre Wirkung
	 * verlässt, fällt hier auf.
	 */
	setRepeating(value: boolean): void;
}

export function fakeTimer(): FakeTimer {
	let handler: (() => void) | null = null;
	let running = false;
	let started = 0;
	let repeating = false;

	return {
		interval: 0,
		singleShot: false,
		get active(): boolean {
			return running;
		},
		timeout: {
			connect(fn: () => void): void {
				handler = fn;
			},
		},
		start(): void {
			running = true;
			started += 1;
		},
		stop(): void {
			running = false;
		},
		fire(): void {
			running = repeating;
			if (handler !== null) {
				handler();
			}
		},
		starts(): number {
			return started;
		},
		setRepeating(value: boolean): void {
			repeating = value;
		},
	};
}

// --- Geometriezugriff -------------------------------------------------------

export interface FakePort extends GeometryPort {
	/** Istgeometrie setzen, etwa für eine fremde Änderung. */
	place(id: string, rect: Rect): void;
	/** Handle entfernen: `read` liefert danach `null`, `write` `false`. */
	drop(id: string): void;
	setDragging(id: string, value: boolean): void;
	setBlocked(id: string, value: boolean): void;
	/**
	 * Was das Fenster aus einem Zielwert macht. Vorgabe ist die Übernahme;
	 * ein Größenraster wird hier nachgestellt.
	 */
	setAccept(id: string, fn: (rect: Rect) => Rect): void;
	/** Läuft nach jedem `write` -- hier lässt sich ein synchrones Signal auslösen. */
	setOnWrite(fn: (id: string, rect: Rect) => void): void;
	reads(): number;
	writes(): number;
	writesFor(id: string): number;
}

export function fakePort(): FakePort {
	const geometry = new Map<string, Rect>();
	const dragging = new Set<string>();
	const blocked = new Set<string>();
	const accept = new Map<string, (rect: Rect) => Rect>();
	const writeCount = new Map<string, number>();
	let onWrite: ((id: string, rect: Rect) => void) | null = null;
	let readTotal = 0;
	let writeTotal = 0;

	function place(id: string, rect: Rect): void {
		geometry.set(id, rect);
	}

	return {
		place,
		drop(id: string): void {
			geometry.delete(id);
		},
		setDragging(id: string, value: boolean): void {
			if (value) {
				dragging.add(id);
			} else {
				dragging.delete(id);
			}
		},
		setBlocked(id: string, value: boolean): void {
			if (value) {
				blocked.add(id);
			} else {
				blocked.delete(id);
			}
		},
		setAccept(id: string, fn: (rect: Rect) => Rect): void {
			accept.set(id, fn);
		},
		setOnWrite(fn: (id: string, rect: Rect) => void): void {
			onWrite = fn;
		},
		reads: () => readTotal,
		writes: () => writeTotal,
		writesFor: (id: string) => writeCount.get(id) ?? 0,

		read(id: string): Rect | null {
			readTotal += 1;
			return geometry.get(id) ?? null;
		},
		write(id: string, rect: Rect): boolean {
			if (!geometry.has(id)) {
				return false;
			}
			writeTotal += 1;
			writeCount.set(id, (writeCount.get(id) ?? 0) + 1);
			const shape = accept.get(id);
			geometry.set(id, shape === undefined ? rect : shape(rect));
			if (onWrite !== null) {
				onWrite(id, rect);
			}
			return true;
		},
		dragging: (id: string) => dragging.has(id),
		blocked: (id: string) => !geometry.has(id) || blocked.has(id),
	};
}
