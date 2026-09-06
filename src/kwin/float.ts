import type { Rect } from "../core/rect.ts";
import type { Registry } from "../state/registry.ts";
import { getWindow, setFloating } from "../state/registry.ts";
import type { GeometryController } from "./apply.ts";
import { isMember } from "./filter.ts";
import { anchorInto, judgePlace } from "./geometry.ts";
import type { WindowInfo } from "./types.ts";

export type FloatOutcome =
	| "gefloatet"
	| "gefloatetOhneWiederherstellung"
	| "wiederhergestellt"
	| "gekachelt"
	| "keinMitglied";

/**
 * Schaltet den globalen Float-Zustand eines Fensters ohne KWin-Zugriff um.
 *
 * Der Zustandswechsel selbst gilt immer -- Vollbild, Maximierung und
 * Minimierung sind keine Mitgliedschaftskriterien (Abschnitt 7). Nur das
 * Schreiben und das Einfangen einer Geometrie hängen an `judgePlace`: in
 * einem Sonderzustand trägt `frameGeometry` die Vollbild- oder
 * Maximierungsfläche, und die ist weder als Ziel noch als Erinnerung
 * brauchbar. Die zuletzt gemerkte `floatRect` bleibt dann stehen und greift,
 * sobald das Fenster in den Restore-Zustand zurückkehrt.
 */
export function toggleFloat(
	registry: Registry,
	geometry: GeometryController,
	info: WindowInfo,
	area: Rect | null,
	excludes: Set<string>,
): FloatOutcome {
	if (!isMember(info, excludes)) {
		return "keinMitglied";
	}

	const state = getWindow(registry, info.id);
	const placeable = judgePlace(info) === "place";
	const capture = placeable ? info.frameGeometry : null;
	geometry.forget(info.id);
	if (state.floating) {
		setFloating(registry, info.id, false, capture);
		return "gekachelt";
	}

	const remembered = state.floatRect;
	setFloating(registry, info.id, true, capture);
	if (!placeable) {
		state.floatRestorePending = remembered !== null;
		return "gefloatetOhneWiederherstellung";
	}
	if (remembered === null) {
		return "gefloatet";
	}
	const target = area === null ? remembered : anchorInto(remembered, area);
	state.floatRestorePending = !geometry.place(info.id, target);
	return "wiederhergestellt";
}
