export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function equals(a: Rect, b: Rect): boolean {
	return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Rundet alle vier Werte auf ganze Pixel. Der Layoutkern liefert ohnehin nur
 * ganze Zahlen; ein gelesenes `frameGeometry` kann auf Wayland bei gebrochener
 * Skalierung Nachkommastellen tragen. Ohne die Rundung meldete `equals` dann in
 * jeder Epoche eine Abweichung, und jeder Lauf schriebe erneut.
 */
export function rounded(rect: Rect): Rect {
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
	};
}

export function contains(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

/** Echte Schnittfläche. Leere Rechtecke überlappen nie, Berührung zählt nicht. */
export function overlaps(a: Rect, b: Rect): boolean {
	const left = Math.max(a.x, b.x);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const top = Math.max(a.y, b.y);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	return left < right && top < bottom;
}

/**
 * Größter Abstand, der zwischen `count` Zellen der Gesamtlänge `total` noch
 * Platz lässt, ohne eine Zelle unter 1 px zu drücken. Reicht der Platz nicht,
 * fällt der Abstand auf 0 zurück.
 */
export function clampGap(gap: number, total: number, count: number): number {
	if (count < 2 || !Number.isFinite(gap) || gap <= 0) {
		return 0;
	}
	const room = Math.floor((total - count) / (count - 1));
	if (room <= 0) {
		return 0;
	}
	return Math.min(Math.floor(gap), room);
}

/**
 * Zieht den Außenabstand allseitig ab. Der Abstand wird so weit verkleinert,
 * dass mindestens 1 px Fläche übrig bleibt; eine bereits leere Fläche bleibt
 * leer.
 */
export function shrink(area: Rect, gap: number): Rect {
	let g = Number.isFinite(gap) ? Math.floor(gap) : 0;
	const limitX = Math.floor((area.width - 1) / 2);
	const limitY = Math.floor((area.height - 1) / 2);
	if (g > limitX) {
		g = limitX;
	}
	if (g > limitY) {
		g = limitY;
	}
	if (g < 0) {
		g = 0;
	}
	return {
		x: area.x + g,
		y: area.y + g,
		width: area.width - 2 * g,
		height: area.height - 2 * g,
	};
}

/**
 * Verteilt `inner` px gewichtet auf `weights.length` Zellen. Jede Zelle bekommt
 * zuerst 1 px, der Rest wird anteilig mit `Math.floor` verteilt und der
 * verbliebene Rest pixelweise von vorne nachgereicht. Die Summe ist exakt
 * `inner` (Idee: Krohnkite `layoututils.ts:29-56`, MIT).
 */
function distribute(inner: number, weights: number[]): number[] {
	const count = weights.length;
	const sizes: number[] = [];
	if (count === 0) {
		return sizes;
	}
	if (inner <= count) {
		for (let i = 0; i < count; i++) {
			sizes.push(i < inner ? 1 : 0);
		}
		return sizes;
	}

	const norm: number[] = [];
	let sum = 0;
	for (let i = 0; i < count; i++) {
		const w = weights[i];
		const value = w !== undefined && Number.isFinite(w) && w > 0 ? w : 0;
		norm.push(value);
		sum += value;
	}
	if (sum <= 0) {
		for (let i = 0; i < count; i++) {
			norm[i] = 1;
		}
		sum = count;
	}

	const spare = inner - count;
	let used = 0;
	for (let i = 0; i < count; i++) {
		const share = Math.floor((spare * (norm[i] ?? 0)) / sum);
		sizes.push(1 + share);
		used += share;
	}
	const rest = spare - used;
	for (let i = 0; i < rest; i++) {
		sizes[i] = (sizes[i] ?? 0) + 1;
	}
	return sizes;
}

/**
 * Zellenlängen für einen gewichteten Split von `total` mit `gap` zwischen den
 * Zellen. Summe der Rückgabewerte plus `gap * (n - 1)` ergibt exakt `total`,
 * sofern `total >= n` ist.
 */
export function splitWeighted(total: number, weights: number[], gap: number): number[] {
	const effectiveGap = clampGap(gap, total, weights.length);
	return distribute(total - effectiveGap * (weights.length - 1), weights);
}

/** Zerlegt `area` waagerecht in übereinanderliegende Streifen. */
export function divideVertical(area: Rect, weights: number[], gap: number): Rect[] {
	const heights = splitWeighted(area.height, weights, gap);
	const effectiveGap = clampGap(gap, area.height, weights.length);
	const rects: Rect[] = [];
	let y = area.y;
	for (let i = 0; i < heights.length; i++) {
		const height = heights[i] ?? 0;
		rects.push({ x: area.x, y, width: area.width, height });
		y += height + effectiveGap;
	}
	return rects;
}
