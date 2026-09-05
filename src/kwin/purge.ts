import type { WindowId } from "../core/stack.ts";
import type { SurfaceKey } from "../core/surface.ts";
import type { Registry } from "../state/registry.ts";
import { purgeSurfaces, purgeWindows } from "../state/registry.ts";
import type { Snapshot } from "./types.ts";

export interface PurgeResult {
	windows: WindowId[];
	surfaces: SurfaceKey[];
	/**
	 * Der Surface-Teil wurde ausgelassen, weil der Snapshot keine gültigen
	 * Activities oder Desktops meldete. Der Adapter schreibt das ins Journal:
	 * stillschweigend nichts zu tun wäre von "nichts zu tun" nicht zu
	 * unterscheiden.
	 */
	skippedSurfaces: boolean;
}

/**
 * Registry-GC als reiner Schritt hinter der Snapshot-Grenze. Der Adapter ruft
 * nur diese eine Funktion; damit steht der ganze Ghost-Purge unter
 * `node --test`, statt in der einen ungetesteten Datei zu verschwinden.
 *
 * Die Ist-Mengen entstehen **explizit** als `Set<string>` aus den
 * Snapshot-Arrays -- `purgeSurfaces` erwartet Mengen, und ein durchgereichtes
 * Array würde dort still zu "nichts ist gültig" und alles löschen.
 *
 * Ausgaben werden bewusst **nicht** geprüft: der Zustand eines abgesteckten
 * Bildschirms überlebt am Namen bis zum Sitzungsende (PLAN.md Abschnitt 4,
 * Testmatrix 9).
 */
export function purgeFromSnapshot(registry: Registry, snapshot: Snapshot): PurgeResult {
	const live = new Set<WindowId>();
	for (const info of snapshot.windows) {
		live.add(info.id);
	}
	const windows = purgeWindows(registry, live);

	const activities = new Set<string>();
	for (const id of snapshot.activities) {
		activities.add(id);
	}
	const desktops = new Set<string>();
	for (const id of snapshot.desktops) {
		desktops.add(id);
	}

	// KWin hat immer mindestens eine Activity und einen Desktop. Eine leere
	// Menge ist deshalb kein gültiger Zustand, sondern ein misslungener
	// Lesedurchgang -- und würde hier jede gespeicherte Surface löschen.
	if (activities.size === 0 || desktops.size === 0) {
		return { windows, surfaces: [], skippedSurfaces: true };
	}

	return {
		windows,
		surfaces: purgeSurfaces(registry, activities, desktops),
		skippedSurfaces: false,
	};
}
