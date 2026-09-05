import type { LayoutDef } from "./layout/index.ts";
import { LAYOUTS, RATIO_DEFAULT, RATIO_STEP, stepRatio } from "./layout/index.ts";

/** `window.internalId` als Zeichenkette, siehe PLAN.md Abschnitt 4. */
export type WindowId = string;

export interface SurfaceState {
	/** Alle Surface-Mitglieder in Anordnungsreihenfolge, Position 0 ist Master. */
	order: WindowId[];
	focus: WindowId | null;
	layoutIndex: number;
	masterRatio: number;
}

export function createSurface(): SurfaceState {
	return { order: [], focus: null, layoutIndex: 0, masterRatio: RATIO_DEFAULT };
}

export function currentLayout(state: SurfaceState): LayoutDef {
	const index = ((state.layoutIndex % LAYOUTS.length) + LAYOUTS.length) % LAYOUTS.length;
	const layout = LAYOUTS[index];
	if (layout === undefined) {
		throw new Error("Layoutliste ist leer");
	}
	return layout;
}

// --- Kopierhilfen. Objekt-Spread scheitert am Parser, siehe CLAUDE.md. -------

function derive(state: SurfaceState, order: WindowId[], focus: WindowId | null): SurfaceState {
	return {
		order,
		focus,
		layoutIndex: state.layoutIndex,
		masterRatio: state.masterRatio,
	};
}

function withFocus(state: SurfaceState, focus: WindowId | null): SurfaceState {
	if (focus === state.focus) {
		return state;
	}
	return derive(state, state.order.slice(), focus);
}

function withLayout(state: SurfaceState, layoutIndex: number, ratio: number): SurfaceState {
	if (layoutIndex === state.layoutIndex && ratio === state.masterRatio) {
		return state;
	}
	return {
		order: state.order.slice(),
		focus: state.focus,
		layoutIndex,
		masterRatio: ratio,
	};
}

function focusIndex(state: SurfaceState): number {
	return state.focus === null ? -1 : state.order.indexOf(state.focus);
}

// --- Fokus ------------------------------------------------------------------

/** Nichtmitglieder werden ignoriert; `null` loescht den Fokus. */
export function setFocus(state: SurfaceState, id: WindowId | null): SurfaceState {
	if (id !== null && state.order.indexOf(id) < 0) {
		return state;
	}
	return withFocus(state, id);
}

function cycleFocus(state: SurfaceState, delta: number): SurfaceState {
	const size = state.order.length;
	if (size === 0) {
		return state;
	}
	const index = focusIndex(state);
	if (index < 0) {
		return withFocus(state, state.order[0] ?? null);
	}
	return withFocus(state, state.order[(index + delta + size) % size] ?? null);
}

/** Zyklisch ueber alle Mitglieder, auch floatende und minimierte. */
export function focusNext(state: SurfaceState): SurfaceState {
	return cycleFocus(state, 1);
}

export function focusPrev(state: SurfaceState): SurfaceState {
	return cycleFocus(state, -1);
}

export function focusMaster(state: SurfaceState): SurfaceState {
	return withFocus(state, state.order[0] ?? null);
}

// --- Reihenfolge ------------------------------------------------------------

function swap(state: SurfaceState, delta: number): SurfaceState {
	const size = state.order.length;
	const index = focusIndex(state);
	if (size < 2 || index < 0) {
		return state;
	}
	const target = (index + delta + size) % size;
	const a = state.order[index];
	const b = state.order[target];
	if (index === target || a === undefined || b === undefined) {
		return state;
	}
	const order = state.order.slice();
	order[index] = b;
	order[target] = a;
	return derive(state, order, state.focus);
}

/** Der Fokus bleibt am Fenster, nicht an der Position. */
export function swapNext(state: SurfaceState): SurfaceState {
	return swap(state, 1);
}

export function swapPrev(state: SurfaceState): SurfaceState {
	return swap(state, -1);
}

/**
 * XMonads `swapMaster`: das fokussierte Fenster wandert an Position 0, alle
 * uebrigen behalten ihre relative Reihenfolge.
 */
export function promote(state: SurfaceState): SurfaceState {
	const index = focusIndex(state);
	if (index <= 0) {
		return state;
	}
	const order = state.order.slice();
	const focused = order.splice(index, 1)[0];
	if (focused === undefined) {
		return state;
	}
	order.unshift(focused);
	return derive(state, order, state.focus);
}

/**
 * XMonads `insertUp`: das neue Fenster nimmt den Platz des fokussierten ein,
 * das bisher fokussierte rutscht nach unten, der Fokus wandert mit. Beim
 * Reconcile entscheidet anschliessend das aktive Fenster ueber den Fokus.
 */
export function insert(state: SurfaceState, id: WindowId): SurfaceState {
	if (state.order.indexOf(id) >= 0) {
		return state;
	}
	const order = state.order.slice();
	const index = focusIndex(state);
	if (index < 0) {
		order.unshift(id);
	} else {
		order.splice(index, 0, id);
	}
	return derive(state, order, id);
}

/** Der Fokus wandert auf den Nachfolger, sonst auf das letzte Fenster. */
export function remove(state: SurfaceState, id: WindowId): SurfaceState {
	const index = state.order.indexOf(id);
	if (index < 0) {
		return state;
	}
	const order = state.order.slice();
	order.splice(index, 1);
	let focus = state.focus;
	if (focus === id) {
		focus = order[index] ?? order[order.length - 1] ?? null;
	}
	return derive(state, order, focus);
}

// --- Layout und Masteranteil ------------------------------------------------

export function nextLayout(state: SurfaceState): SurfaceState {
	if (LAYOUTS.length < 2) {
		return state;
	}
	return withLayout(state, (state.layoutIndex + 1) % LAYOUTS.length, state.masterRatio);
}

export function resetLayout(state: SurfaceState): SurfaceState {
	return withLayout(state, 0, RATIO_DEFAULT);
}

export function growMaster(state: SurfaceState): SurfaceState {
	return withLayout(state, state.layoutIndex, stepRatio(state.masterRatio, RATIO_STEP));
}

export function shrinkMaster(state: SurfaceState): SurfaceState {
	return withLayout(state, state.layoutIndex, stepRatio(state.masterRatio, -RATIO_STEP));
}
