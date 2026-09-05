import type { Rect } from "../rect.ts";
import { clampGap, divideVertical, shrink } from "../rect.ts";
import type { LayoutParams } from "./types.ts";

export const RATIO_DEFAULT = 0.65;
export const RATIO_MIN = 0.1;
export const RATIO_MAX = 0.9;
export const RATIO_STEP = 0.05;

/**
 * Gleiche Gewichte fuer den Stapel. Der gewichtete Split traegt eine spaetere
 * Groessenaenderung einzelner Stapelfenster ohne neuen Algorithmus.
 */
function equalWeights(count: number): number[] {
	const weights: number[] = [];
	for (let i = 0; i < count; i++) {
		weights.push(1);
	}
	return weights;
}

export function clampRatio(ratio: number): number {
	if (!Number.isFinite(ratio)) {
		return RATIO_DEFAULT;
	}
	if (ratio < RATIO_MIN) {
		return RATIO_MIN;
	}
	if (ratio > RATIO_MAX) {
		return RATIO_MAX;
	}
	return ratio;
}

/**
 * XMonads `Tall 1 delta ratio`: eine Masterzelle links, der Rest als Stapel
 * rechts. Masteranzahl ist fest 1. Zellen und Abstaende zerlegen die um den
 * Aussenabstand verkleinerte Flaeche exakt; alle Werte sind ganzzahlig.
 */
export function tall(area: Rect, count: number, params: LayoutParams): Rect[] {
	if (count <= 0) {
		return [];
	}
	const inner = shrink(area, params.gapOuter);
	if (count === 1) {
		return [inner];
	}

	const columnGap = clampGap(params.gapInner, inner.width, 2);
	const available = inner.width - columnGap;
	if (available < 2) {
		// Randfall: zu schmal fuer zwei Spalten. Dann bleibt nur ein senkrechter
		// Stapel — lieber das als eine Masterspalte, die aus der Flaeche ragt.
		return divideVertical(inner, equalWeights(count), params.gapInner);
	}
	const upper = available - 1;
	let masterWidth = Math.round(available * clampRatio(params.ratio));
	if (masterWidth < 1) {
		masterWidth = 1;
	}
	if (masterWidth > upper) {
		masterWidth = upper;
	}
	const stackWidth = available - masterWidth;

	const master: Rect = {
		x: inner.x,
		y: inner.y,
		width: masterWidth,
		height: inner.height,
	};
	const stackArea: Rect = {
		x: inner.x + masterWidth + columnGap,
		y: inner.y,
		width: stackWidth,
		height: inner.height,
	};

	return [master].concat(divideVertical(stackArea, equalWeights(count - 1), params.gapInner));
}
