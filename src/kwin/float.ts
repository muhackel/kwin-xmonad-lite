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
	| "bereitsGefloatet"
	| "bereitsGekachelt"
	| "keinMitglied";

/**
 * Der gewünschte Zielzustand. `Meta+T` will kacheln, `Meta+Shift+T` will
 * umschalten -- eine Taste, die stur toggelt, kachelt ein gekacheltes Fenster
 * versehentlich wieder aus.
 */
export type FloatTarget = "float" | "tile" | "toggle";

/** Der frühere Toggle, unveränderte Signatur. */
export function toggleFloat(
	registry: Registry,
	geometry: GeometryController,
	info: WindowInfo,
	area: Rect | null,
	excludes: Set<string>,
): FloatOutcome {
	return setFloat(registry, geometry, info, area, excludes, "toggle");
}

/**
 * Setzt den globalen Float-Zustand eines Fensters ohne KWin-Zugriff.
 *
 * Der Zustandswechsel selbst gilt immer -- Vollbild, Maximierung und
 * Minimierung sind keine Mitgliedschaftskriterien (Abschnitt 7). Nur das
 * Schreiben und das Einfangen einer Geometrie hängen an `judgePlace`: in
 * einem Sonderzustand trägt `frameGeometry` die Vollbild- oder
 * Maximierungsfläche, und die ist weder als Ziel noch als Erinnerung
 * brauchbar. Die zuletzt gemerkte `floatRect` bleibt dann stehen und greift,
 * sobald das Fenster in den Restore-Zustand zurückkehrt.
 */
export function setFloat(
	registry: Registry,
	geometry: GeometryController,
	info: WindowInfo,
	area: Rect | null,
	excludes: Set<string>,
	target: FloatTarget,
): FloatOutcome {
	if (!isMember(info, excludes)) {
		return "keinMitglied";
	}

	const state = getWindow(registry, info.id);
	// Der Frühausstieg steht **vor** `geometry.forget`: `Meta+T` auf einem
	// bereits gekachelten Fenster darf keine laufende Erwartung samt
	// eingeplanter Nachprüfung wegwerfen, sonst bliebe ein gerade
	// nachgebessertes Fenster auf halber Strecke stehen.
	const wanted = target === "toggle" ? !state.floating : target === "float";
	if (wanted === state.floating) {
		return state.floating ? "bereitsGefloatet" : "bereitsGekachelt";
	}

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
	const restore = area === null ? remembered : anchorInto(remembered, area);
	state.floatRestorePending = !geometry.place(info.id, restore);
	return "wiederhergestellt";
}
