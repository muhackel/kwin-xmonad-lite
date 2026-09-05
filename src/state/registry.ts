import type { Rect } from "../core/rect.ts";
import type { SurfaceState, WindowId } from "../core/stack.ts";
import { createSurface } from "../core/stack.ts";
import type { SurfaceKey } from "../core/surface.ts";
import { parseSurfaceKey } from "../core/surface.ts";

/**
 * Fensterzustand, global und nicht je Surface: ein Fenster floatet überall
 * oder nirgends (PLAN.md Abschnitt 7).
 */
export interface WindowState {
	floating: boolean;
	floatRect: Rect | null;
	/** Das Rechteck, das das Layout zuletzt **wollte**. */
	tiledRect: Rect | null;
	/**
	 * Das Rechteck, das das Fenster zuletzt nachweislich **hatte** und das der
	 * Controller akzeptiert hat -- gesetzt bei `settled` und bei `giveup`. Nach
	 * einem Giveup fällt es von `tiledRect` auseinander, und genau daran
	 * erkennt der Signalpfad den eigenen Nachhall: ein verspätetes
	 * `frameGeometryChanged` mit diesem Wert ist keine fremde Änderung.
	 */
	lastObservedRect: Rect | null;
	expectedRect: Rect | null;
	applyAttempts: number;
	/**
	 * Zählt **Schreibvorgänge dieses Fensters**, nicht Anordnungsepochen: nur
	 * ein neuer Zielwert erhöht sie. Eine Epoche ohne Write darf eine offene
	 * Erwartung nicht altern lassen.
	 */
	writeGeneration: number;
}

/**
 * Der Behälter ist veränderlich, die Zustände darin sind es nicht: ein
 * Reducer liefert einen neuen `SurfaceState`, der hier eingehängt wird.
 */
export interface Registry {
	surfaces: Map<SurfaceKey, SurfaceState>;
	windows: Map<WindowId, WindowState>;
}

export function createRegistry(): Registry {
	return { surfaces: new Map(), windows: new Map() };
}

export function createWindowState(): WindowState {
	return {
		floating: false,
		floatRect: null,
		tiledRect: null,
		lastObservedRect: null,
		expectedRect: null,
		applyAttempts: 0,
		writeGeneration: 0,
	};
}

export function getSurface(registry: Registry, key: SurfaceKey): SurfaceState {
	const existing = registry.surfaces.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = createSurface();
	registry.surfaces.set(key, created);
	return created;
}

export function putSurface(registry: Registry, key: SurfaceKey, state: SurfaceState): void {
	registry.surfaces.set(key, state);
}

export function getWindow(registry: Registry, id: WindowId): WindowState {
	const existing = registry.windows.get(id);
	if (existing !== undefined) {
		return existing;
	}
	const created = createWindowState();
	registry.windows.set(id, created);
	return created;
}

/**
 * Float-Umschaltung nach PLAN.md Abschnitt 7. `current` ist die Geometrie, die
 * das Fenster gerade hat; sie kennt erst der Adapter, hier wird sie nur
 * durchgereicht.
 */
export function setFloating(
	registry: Registry,
	id: WindowId,
	floating: boolean,
	current: Rect | null,
): WindowState {
	const state = getWindow(registry, id);
	if (state.floating === floating) {
		return state;
	}
	state.floating = floating;
	if (floating) {
		// Beim ersten Umschalten die aktuelle Geometrie behalten, eine bereits
		// gemerkte floatRect gewinnt und wird später wiederhergestellt.
		if (state.floatRect === null) {
			state.floatRect = current;
		}
		state.expectedRect = null;
		state.applyAttempts = 0;
	} else if (current !== null) {
		state.floatRect = current;
	}
	return state;
}

/** Vor jedem Verlassen der Layout-Teilnahme fällig (PLAN.md Abschnitt 4). */
export function clearExpectation(registry: Registry, id: WindowId): void {
	const state = registry.windows.get(id);
	if (state === undefined) {
		return;
	}
	state.expectedRect = null;
	state.applyAttempts = 0;
}

/**
 * Ghost-Purge: alles, was nicht in der Ist-Menge steht, fliegt raus. Die
 * Ist-Menge kommt aus `workspace.windowList()`, nie aus Eigenschaften toter
 * Objekte (Idee Tessera `driver.ts:239-258`, MIT).
 */
export function purgeWindows(registry: Registry, live: Set<WindowId>): WindowId[] {
	const removed: WindowId[] = [];
	for (const id of Array.from(registry.windows.keys())) {
		if (!live.has(id)) {
			registry.windows.delete(id);
			removed.push(id);
		}
	}
	return removed;
}

/**
 * Entfernt Surfaces verschwundener Activities und Desktops. Ausgaben werden
 * **nicht** geprüft: der Zustand eines abgesteckten Bildschirms bleibt am
 * Namen bis zum Sitzungsende erhalten (PLAN.md Abschnitt 4).
 */
export function purgeSurfaces(
	registry: Registry,
	activities: Set<string>,
	desktops: Set<string>,
): SurfaceKey[] {
	const removed: SurfaceKey[] = [];
	for (const key of Array.from(registry.surfaces.keys())) {
		const ref = parseSurfaceKey(key);
		if (ref === null || !activities.has(ref.activity) || !desktops.has(ref.desktop)) {
			registry.surfaces.delete(key);
			removed.push(key);
		}
	}
	return removed;
}
