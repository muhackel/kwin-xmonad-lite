import type { Rect } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import { currentLayout } from "../core/stack.ts";
import type { SurfaceKey } from "../core/surface.ts";
import { reconcile } from "../state/reconcile.ts";
import type { Registry } from "../state/registry.ts";
import { clearExpectation, getSurface, getWindow, putSurface } from "../state/registry.ts";
import { membersBySurface, participates } from "./filter.ts";
import { fitToCell } from "./geometry.ts";
import type { Snapshot, WindowInfo } from "./types.ts";

/** Aussen- und Innenabstand. Ab Meilenstein 6 aus `readConfig`, bis dahin 0. */
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
	/** Im Layout `full` das fokussierte Fenster, sonst `null`. */
	raise: WindowId | null;
}

export interface ArrangePlan {
	surfaces: SurfacePlan[];
}

/**
 * Wen `full` obenauf legt. Der fokussierte Eintrag kann minimiert, floatend
 * oder im Vollbild sein — dann ist er kein Layout-Teilnehmer und darf nicht
 * ueber die gekachelten gehoben werden. Ersatz ist der Master: im Monocle
 * liegen die uebrigen ohnehin deckungsgleich darunter.
 */
function raiseFor(focus: WindowId | null, participants: WindowId[]): WindowId | null {
	if (focus !== null && participants.indexOf(focus) >= 0) {
		return focus;
	}
	return participants[0] ?? null;
}

function byId(windows: WindowInfo[]): Map<WindowId, WindowInfo> {
	const map = new Map<WindowId, WindowInfo>();
	for (const info of windows) {
		map.set(info.id, info);
	}
	return map;
}

/**
 * Rechnet aus einer Momentaufnahme die vollstaendige Anordnung. Die einzige
 * Stelle des Planungspfads, die den Registry-Behaelter anfasst: sie haengt das
 * Ergebnis von `reconcile` ein und loescht die Geometrieerwartung jedes
 * Mitglieds, das gerade nicht teilnimmt (PLAN.md Abschnitt 4). Die
 * `SurfaceState`-Objekte werden dabei **ersetzt**, nie veraendert.
 *
 * Weil `Registry` ohne KWin laeuft, ist die ganze Funktion unter `node --test`
 * pruefbar — samt der Zahlen, die spaeter im Journal auftauchen.
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
		// Auch bei Gleichstand einhaengen: `putSurface` ist billig, und eine
		// Sonderbehandlung waere die erste Stelle, an der jemand versucht ist,
		// bei `result.state === before` die Layoutrechnung zu ueberspringen.
		// Das waere falsch — eine geaenderte `clientArea` bei unveraenderter
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
				// Sonst kachelt eine verspaetete Wayland-Bestaetigung das
				// Fenster zurueck, nachdem es das Layout verlassen hat.
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
			raise: layout.id === "full" ? raiseFor(state.focus, participants) : null,
		});
	}

	return { surfaces };
}
