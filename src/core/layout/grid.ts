import type { Rect } from "../rect.ts";
import { clampGap, shrink, splitWeighted } from "../rect.ts";
import type { LayoutParams } from "./types.ts";

const TARGET_ASPECT = 16 / 9;

function equalWeights(count: number): number[] {
	const weights: number[] = [];
	for (let i = 0; i < count; i++) {
		weights.push(1);
	}
	return weights;
}

/**
 * Grid nach der Spaltenwahl von XMonad.Layout.Grid: das Zielformat einer
 * Zelle ist 16:9, die Fenster laufen spaltenweise von links oben nach unten.
 * Sind nicht alle Spalten gleich lang, erhalten die rechten je ein Fenster
 * mehr. Abstände und Restpixel folgen den gemeinsamen Projektregeln.
 */
export function grid(area: Rect, count: number, params: LayoutParams): Rect[] {
	if (count <= 0) {
		return [];
	}

	const inner = shrink(area, params.gapOuter);
	if (count === 1) {
		return [inner];
	}

	let columns = 1;
	if (inner.width > 0 && inner.height > 0) {
		columns = Math.round(Math.sqrt((count * inner.width) / (inner.height * TARGET_ASPECT)));
		columns = Math.max(1, Math.min(count, columns));
	}

	const columnGap = clampGap(params.gapInner, inner.width, columns);
	const widths = splitWeighted(inner.width, equalWeights(columns), params.gapInner);
	const baseRows = Math.floor(count / columns);
	const extraColumns = count % columns;
	const rects: Rect[] = [];
	let x = inner.x;

	for (let column = 0; column < columns; column++) {
		const width = widths[column] ?? 0;
		const rows = baseRows + (column >= columns - extraColumns ? 1 : 0);
		const rowGap = clampGap(params.gapInner, inner.height, rows);
		const heights = splitWeighted(inner.height, equalWeights(rows), params.gapInner);
		let y = inner.y;
		for (let row = 0; row < rows; row++) {
			const height = heights[row] ?? 0;
			rects.push({ x, y, width, height });
			y += height + rowGap;
		}
		x += width + columnGap;
	}

	return rects;
}
