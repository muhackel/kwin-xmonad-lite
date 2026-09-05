import type { Rect } from "../../src/core/rect.ts";
import { surfaceKey } from "../../src/core/surface.ts";
import { UNLIMITED_SIZE } from "../../src/kwin/filter.ts";
import type { Timer } from "../../src/kwin/timer.ts";
import type { SurfaceView, WindowInfo } from "../../src/kwin/types.ts";

export const ACTIVITY = "a89f5ec2-ab8e-4108-8088-7118500a3aab";
export const DESKTOP = "89539ae6-e06b-4c76-a057-95df959578a9";
export const OUTPUT = "DP-1";

/** Die auf SPIELKISTE gemessene Arbeitsflaeche, Panel abgezogen. */
export const AREA: Rect = { x: 0, y: 0, width: 2560, height: 1410 };

/**
 * Ein unauffaelliges, verwaltbares Fenster. Die Tests veraendern danach
 * einzelne Felder direkt — Objekt-Spread scheitert am Parser der QJSEngine,
 * und `tests/` haelt sich an dieselben Grenzen wie `src/`.
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

export interface FakeTimer extends Timer {
	/** Loest den verbundenen Handler aus, wie es der echte Timer taete. */
	fire(): void;
	/** Wie oft `start()` gerufen wurde — zeigt einen unnoetigen Neustart. */
	starts(): number;
}

export function fakeTimer(): FakeTimer {
	let handler: (() => void) | null = null;
	let running = false;
	let started = 0;

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
			running = false;
			if (handler !== null) {
				handler();
			}
		},
		starts(): number {
			return started;
		},
	};
}
