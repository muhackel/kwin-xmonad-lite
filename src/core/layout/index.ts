import { full } from "./full.ts";
import { grid } from "./grid.ts";
import { RATIO_DEFAULT, tall } from "./tall.ts";
import type { LayoutDef, LayoutParams } from "./types.ts";

export { full } from "./full.ts";
export { grid } from "./grid.ts";
export {
	clampRatio,
	RATIO_DEFAULT,
	RATIO_MAX,
	RATIO_MIN,
	RATIO_STEP,
	stepRatio,
	tall,
} from "./tall.ts";
export type { LayoutDef, LayoutFn, LayoutParams } from "./types.ts";

export const DEFAULT_PARAMS: LayoutParams = {
	ratio: RATIO_DEFAULT,
	gapOuter: 0,
	gapInner: 0,
};

/** Reihenfolge des Layoutzyklus (`Meta+Space`); alte Indizes bleiben stabil. */
export const LAYOUTS: LayoutDef[] = [
	{ id: "tall", label: "Tall", apply: tall },
	{ id: "full", label: "Full", apply: full },
	{ id: "grid", label: "Grid", apply: grid },
];
