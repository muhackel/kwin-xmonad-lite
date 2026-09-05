import type { Rect } from "../rect.ts";
import { shrink } from "../rect.ts";
import type { LayoutParams } from "./types.ts";

/**
 * Monocle: jede Zelle ist die ganze um den Außenabstand verkleinerte Fläche.
 * Welches Fenster obenauf liegt, entscheidet der Adapter über `raiseWindow`.
 */
export function full(area: Rect, count: number, params: LayoutParams): Rect[] {
	if (count <= 0) {
		return [];
	}
	const inner = shrink(area, params.gapOuter);
	const rects: Rect[] = [];
	for (let i = 0; i < count; i++) {
		// Eigenes Objekt je Zelle: der Adapter weist sie unterschiedlichen
		// Fenstern zu, ein geteiltes Objekt wäre eine stille Falle.
		rects.push({ x: inner.x, y: inner.y, width: inner.width, height: inner.height });
	}
	return rects;
}
