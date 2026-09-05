import type { Rect } from "../core/rect.ts";
import type { SurfaceState, WindowId } from "../core/stack.ts";
import { currentLayout } from "../core/stack.ts";
import type { SurfaceKey } from "../core/surface.ts";
import { reconcile } from "../state/reconcile.ts";
import type { Registry } from "../state/registry.ts";
import { clearExpectation, getSurface, getWindow, putSurface } from "../state/registry.ts";
import { membersBySurface, participates } from "./filter.ts";
import { fitToCell } from "./geometry.ts";
import type { Snapshot, WindowInfo } from "./types.ts";

/** Außen- und Innenabstand. Ab Meilenstein 6 aus `readConfig`, bis dahin 0. */
export interface Gaps {
	outer: number;
	inner: number;
}

export const NO_GAPS: Gaps = { outer: 0, inner: 0 };

export interface Placement {
	id: WindowId;
	rect: Rect;
}

export interface SurfacePlan {
	key: SurfaceKey;
	layoutId: string;
	area: Rect;
	ratio: number;
	/** Alle Mitglieder in Anordnungsreihenfolge, auch die ohne Rechteck. */
	members: WindowId[];
	participants: WindowId[];
	placements: Placement[];
	/** Im Layout `full` die Reihenfolge der Hebevorgänge, letzter Eintrag oben. */
	raise: WindowId[];
}

export interface ArrangePlan {
	surfaces: SurfacePlan[];
}

/**
 * Wählt das gekachelte Fenster für `full`. Ist der Fokus kein Teilnehmer,
 * übernimmt der Master; Float-Fenster ergänzt anschließend `raiseOrder`.
 */
function raiseFor(focus: WindowId | null, participants: WindowId[]): WindowId | null {
	if (focus !== null && participants.indexOf(focus) >= 0) {
		return focus;
	}
	return participants[0] ?? null;
}

function visibleFloat(id: WindowId, infos: Map<WindowId, WindowInfo>, registry: Registry): boolean {
	const info = infos.get(id);
	const state = registry.windows.get(id);
	return (
		info !== undefined &&
		state?.floating === true &&
		!info.minimized &&
		!info.fullScreen &&
		info.maximizeMode === 0
	);
}

/**
 * Hebereihenfolge für `full`: zuerst das gekachelte Fenster, danach sichtbare
 * Floats in Surface-Reihenfolge. Ein fokussiertes Float-Fenster kommt zuletzt.
 */
export function raiseOrder(
	layoutId: string,
	state: SurfaceState,
	participants: WindowId[],
	infos: Map<WindowId, WindowInfo>,
	registry: Registry,
): WindowId[] {
	if (layoutId !== "full") {
		return [];
	}

	const order: WindowId[] = [];
	const tiled = raiseFor(state.focus, participants);
	if (tiled !== null) {
		order.push(tiled);
	}

	for (const id of state.order) {
		if (id !== state.focus && visibleFloat(id, infos, registry)) {
			order.push(id);
		}
	}
	if (state.focus !== null && visibleFloat(state.focus, infos, registry)) {
		order.push(state.focus);
	}
	return order;
}

function byId(windows: WindowInfo[]): Map<WindowId, WindowInfo> {
	const map = new Map<WindowId, WindowInfo>();
	for (const info of windows) {
		map.set(info.id, info);
	}
	return map;
}

/**
 * Rechnet aus einer Momentaufnahme die vollständige Anordnung. Die einzige
 * Stelle des Planungspfads, die den Registry-Behälter anfasst: sie hängt das
 * Ergebnis von `reconcile` ein und löscht die Geometrieerwartung jedes
 * Mitglieds, das gerade nicht teilnimmt (PLAN.md Abschnitt 4). Die
 * `SurfaceState`-Objekte werden dabei **ersetzt**, nie verändert.
 *
 * Weil `Registry` ohne KWin läuft, ist die ganze Funktion unter `node --test`
 * prüfbar — samt der Zahlen, die später im Journal auftauchen.
 */
export function planArrangement(
	snapshot: Snapshot,
	registry: Registry,
	gaps: Gaps,
	excludes: Set<string>,
): ArrangePlan {
	const infos = byId(snapshot.windows);
	const membersPerSurface = membersBySurface(snapshot.windows, snapshot.views, excludes);
	const surfaces: SurfacePlan[] = [];

	for (const view of snapshot.views) {
		const members = membersPerSurface.get(view.key) ?? [];
		const before = getSurface(registry, view.key);
		const result = reconcile(before, members, snapshot.activeId);
		// Auch bei Gleichstand einhängen: `putSurface` ist billig, und eine
		// Sonderbehandlung wäre die erste Stelle, an der jemand versucht ist,
		// bei `result.state === before` die Layoutrechnung zu überspringen.
		// Das wäre falsch — eine geänderte `clientArea` bei unveränderter
		// Fenstermenge muss trotzdem neue Rechtecke ergeben.
		putSurface(registry, view.key, result.state);
		const state = result.state;

		const participants: WindowId[] = [];
		for (const id of state.order) {
			const info = infos.get(id);
			if (info === undefined) {
				continue;
			}
			if (participates(info, getWindow(registry, id).floating)) {
				participants.push(id);
			} else {
				// Sonst kachelt eine verspätete Wayland-Bestätigung das
				// Fenster zurück, nachdem es das Layout verlassen hat.
				clearExpectation(registry, id);
			}
		}

		const layout = currentLayout(state);
		const cells = layout.apply(view.area, participants.length, {
			ratio: state.masterRatio,
			gapOuter: gaps.outer,
			gapInner: gaps.inner,
		});

		const placements: Placement[] = [];
		for (let i = 0; i < participants.length; i++) {
			const id = participants[i];
			const cell = cells[i];
			const info = id === undefined ? undefined : infos.get(id);
			if (id === undefined || cell === undefined || info === undefined) {
				continue;
			}
			placements.push({ id, rect: fitToCell(cell, info, view.area) });
		}

		surfaces.push({
			key: view.key,
			layoutId: layout.id,
			area: view.area,
			ratio: state.masterRatio,
			members: state.order.slice(),
			participants,
			placements,
			raise: raiseOrder(layout.id, state, participants, infos, registry),
		});
	}

	return { surfaces };
}
