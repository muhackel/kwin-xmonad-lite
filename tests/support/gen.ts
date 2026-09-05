import type { Rect } from "../../src/core/rect.ts";

/** Fester Seed: der Fuzz-Lauf ist reproduzierbar und CI-tauglich. */
export const FUZZ_SEED = 20260905;
export const FUZZ_COUNT = 500;

/** Linearer Kongruenzgenerator (Numerical Recipes), 32 Bit, ohne Abhängigkeit. */
export function makeRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

export interface LayoutCase {
	area: Rect;
	count: number;
	ratio: number;
	gapOuter: number;
	gapInner: number;
}

export function describeCase(testCase: LayoutCase): string {
	const area = testCase.area;
	return (
		`area=${area.x},${area.y},${area.width}x${area.height} ` +
		`count=${testCase.count} ratio=${testCase.ratio} ` +
		`gapOuter=${testCase.gapOuter} gapInner=${testCase.gapInner}`
	);
}

const GRID_AREAS: Rect[] = [
	{ x: 0, y: 0, width: 2560, height: 1440 },
	{ x: 2560, y: 0, width: 1920, height: 1080 },
	{ x: 0, y: 28, width: 1366, height: 740 },
	{ x: 7, y: 13, width: 101, height: 97 },
	{ x: 0, y: 0, width: 3, height: 3 },
];
const GRID_RATIOS = [0.1, 0.35, 0.5, 0.65, 0.9];
const GRID_GAPS = [0, 1, 8];

/** Erschöpfender Sweep über die kleinen Parameterräume. */
export function gridCases(): LayoutCase[] {
	const cases: LayoutCase[] = [];
	for (let a = 0; a < GRID_AREAS.length; a++) {
		const area = GRID_AREAS[a];
		if (area === undefined) {
			continue;
		}
		for (let count = 0; count <= 8; count++) {
			for (let r = 0; r < GRID_RATIOS.length; r++) {
				for (let o = 0; o < GRID_GAPS.length; o++) {
					for (let i = 0; i < GRID_GAPS.length; i++) {
						cases.push({
							area,
							count,
							ratio: GRID_RATIOS[r] ?? 0.65,
							gapOuter: GRID_GAPS[o] ?? 0,
							gapInner: GRID_GAPS[i] ?? 0,
						});
					}
				}
			}
		}
	}
	return cases;
}

/** Breite, krumme Werte — dort schlägt Rundung zu, nicht bei 1920x1080. */
export function fuzzCases(amount: number, seed: number): LayoutCase[] {
	const rng = makeRng(seed);
	const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
	const cases: LayoutCase[] = [];
	for (let i = 0; i < amount; i++) {
		cases.push({
			area: {
				x: int(-1200, 5120),
				y: int(-1200, 2160),
				width: int(40, 4000),
				height: int(40, 4000),
			},
			count: int(0, 12),
			ratio: 0.1 + rng() * 0.8,
			gapOuter: int(0, 40),
			gapInner: int(0, 40),
		});
	}
	return cases;
}

/** Gitter und Fuzz in einem Durchlauf. */
export function allCases(): LayoutCase[] {
	return gridCases().concat(fuzzCases(FUZZ_COUNT, FUZZ_SEED));
}
