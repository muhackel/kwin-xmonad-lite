import type { Rect } from "../core/rect.ts";
import type { Registry } from "../state/registry.ts";
import { getWindow, setFloating } from "../state/registry.ts";
import type { GeometryController } from "./apply.ts";
import { isMember } from "./filter.ts";
import { anchorInto } from "./geometry.ts";
import type { WindowInfo } from "./types.ts";

export type FloatOutcome = "gefloatet" | "wiederhergestellt" | "gekachelt" | "keinMitglied";

/** Schaltet den globalen Float-Zustand eines Fensters ohne KWin-Zugriff um. */
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
	geometry.forget(info.id);
	if (state.floating) {
		setFloating(registry, info.id, false, info.frameGeometry);
		return "gekachelt";
	}

	const remembered = state.floatRect;
	setFloating(registry, info.id, true, info.frameGeometry);
	if (remembered === null) {
		return "gefloatet";
	}
	geometry.place(info.id, area === null ? remembered : anchorInto(remembered, area));
	return "wiederhergestellt";
}
