import type { SurfaceState, WindowId } from "../core/stack.ts";
import { insert, remove, setFocus } from "../core/stack.ts";

export interface ReconcileResult {
	state: SurfaceState;
	added: WindowId[];
	removed: WindowId[];
}

/**
 * Gleicht die gespeicherte Reihenfolge gegen die Ist-Mitgliedermenge ab:
 * verschwundene entfernen, neue oberhalb des fokussierten Fensters einfuegen
 * (XMonads `insertUp`). Aendert sich nichts, kommt der Eingabezustand
 * unveraendert zurueck — daran erkennt der Adapter, dass nichts anzuordnen ist.
 *
 * `members` darf Doppelte enthalten und in beliebiger Reihenfolge kommen.
 * `activeId` ist das aktive Fenster von KWin; ist es Mitglied dieser Surface,
 * gewinnt es beim Fokus.
 */
export function reconcile(
	state: SurfaceState,
	members: WindowId[],
	activeId: WindowId | null,
): ReconcileResult {
	const live = new Set<WindowId>();
	const unique: WindowId[] = [];
	for (const id of members) {
		if (!live.has(id)) {
			live.add(id);
			unique.push(id);
		}
	}

	const removed: WindowId[] = [];
	for (const id of state.order) {
		if (!live.has(id)) {
			removed.push(id);
		}
	}

	let next = state;
	for (const id of removed) {
		next = remove(next, id);
	}
	const focusAfterRemove = next.focus;

	const added: WindowId[] = [];
	for (const id of unique) {
		if (next.order.indexOf(id) < 0) {
			added.push(id);
			next = insert(next, id);
		}
	}

	// `insert` fokussiert das neue Fenster wie XMonad. In einer Surface, die
	// gerade nicht die aktive ist, waere das Fokusdiebstahl — deshalb hat das
	// aktive Fenster Vorrang, danach der bisherige Fokus.
	let wanted: WindowId | null;
	if (activeId !== null && live.has(activeId)) {
		wanted = activeId;
	} else if (focusAfterRemove !== null) {
		wanted = focusAfterRemove;
	} else {
		wanted = next.focus;
	}
	next = setFocus(next, wanted);

	return { state: next, added, removed };
}
