import assert from "node:assert/strict";
import type { Rect } from "../../src/core/rect.ts";
import { contains, overlaps, shrink } from "../../src/core/rect.ts";
import type { LayoutCase } from "./gen.ts";
import { describeCase, FUZZ_SEED } from "./gen.ts";

/** Ersetzt die fehlende Einengung von `assert.ok` bei `noUncheckedIndexedAccess`. */
export function must<T>(value: T | undefined, message: string): T {
	if (value === undefined) {
		throw new Error(message);
	}
	return value;
}

export function label(testCase: LayoutCase): string {
	return `${describeCase(testCase)} (Seed ${FUZZ_SEED})`;
}

export function innerArea(testCase: LayoutCase): Rect {
	return shrink(testCase.area, testCase.gapOuter);
}

/**
 * Eigenschaften, die für jedes Layout gelten: richtige Anzahl, ganzzahlige
 * nichtnegative Werte, vollständig innerhalb der inneren Fläche. Die
 * Überlappungsfreiheit steht bewusst nicht hier — `full` legt alle Zellen
 * absichtlich übereinander.
 */
export function assertCommon(rects: Rect[], testCase: LayoutCase, note: string): void {
	const inner = innerArea(testCase);
	assert.equal(rects.length, testCase.count, `Anzahl: ${note} ${label(testCase)}`);

	for (let i = 0; i < rects.length; i++) {
		const where = `Zelle ${i}: ${note} ${label(testCase)}`;
		const r = must(rects[i], `fehlt, ${where}`);
		assert.ok(Number.isInteger(r.x), `x nicht ganzzahlig, ${where}`);
		assert.ok(Number.isInteger(r.y), `y nicht ganzzahlig, ${where}`);
		assert.ok(Number.isInteger(r.width), `width nicht ganzzahlig, ${where}`);
		assert.ok(Number.isInteger(r.height), `height nicht ganzzahlig, ${where}`);
		assert.ok(r.width >= 0 && r.height >= 0, `negative Größe, ${where}`);
		assert.ok(contains(inner, r), `ragt aus der Fläche, ${where}`);
	}
}

/** Paarweise Überlappungsfreiheit — gilt für `tall`, nicht für `full`. */
export function assertDisjoint(rects: Rect[], testCase: LayoutCase, note: string): void {
	for (let i = 0; i < rects.length; i++) {
		for (let j = i + 1; j < rects.length; j++) {
			const a = must(rects[i], `fehlt: ${note}`);
			const b = must(rects[j], `fehlt: ${note}`);
			assert.ok(!overlaps(a, b), `Zellen ${i} und ${j} überlappen: ${note} ${label(testCase)}`);
		}
	}
}

/** Abstand zwischen zwei senkrecht benachbarten Zellen. */
export function gapBelow(upper: Rect, lower: Rect): number {
	return lower.y - (upper.y + upper.height);
}
