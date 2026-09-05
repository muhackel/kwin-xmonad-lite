import type { Rect } from "../rect.ts";

/** Nur Zahlen — der Layoutkern kennt weder Fenster noch KWin. */
export interface LayoutParams {
	/** Anteil der Masterspalte an der nutzbaren Breite, 0,1 bis 0,9. */
	ratio: number;
	/** Abstand zum Rand der Arbeitsflaeche. */
	gapOuter: number;
	/** Abstand zwischen benachbarten Zellen, waagerecht wie senkrecht. */
	gapInner: number;
}

export type LayoutFn = (area: Rect, count: number, params: LayoutParams) => Rect[];

export interface LayoutDef {
	id: string;
	label: string;
	apply: LayoutFn;
}
