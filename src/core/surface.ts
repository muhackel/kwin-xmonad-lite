/**
 * Schlüssel einer Surface: Activity x Desktop x Ausgabe. Aktivitäts-UUID und
 * Desktop-Id kommen von KWin, der Ausgabename ist der DRM-Connector (`DP-1`).
 */
export type SurfaceKey = string;

export interface SurfaceRef {
	activity: string;
	desktop: string;
	output: string;
}

const SEPARATOR = "|";

export function surfaceKey(ref: SurfaceRef): SurfaceKey {
	assertClean(ref.activity, "activity");
	assertClean(ref.desktop, "desktop");
	assertClean(ref.output, "output");
	return ref.activity + SEPARATOR + ref.desktop + SEPARATOR + ref.output;
}

/** `null`, wenn der Schlüssel nicht aus genau drei Teilen besteht. */
export function parseSurfaceKey(key: SurfaceKey): SurfaceRef | null {
	const parts = key.split(SEPARATOR);
	if (parts.length !== 3) {
		return null;
	}
	const activity = parts[0];
	const desktop = parts[1];
	const output = parts[2];
	if (activity === undefined || desktop === undefined || output === undefined) {
		return null;
	}
	return { activity, desktop, output };
}

/**
 * Ein Trenner in einer Komponente ließe zwei verschiedene Surfaces auf
 * denselben Schlüssel fallen. Lieber laut scheitern als still vermischen.
 */
function assertClean(value: string, field: string): void {
	if (value.indexOf(SEPARATOR) >= 0) {
		throw new Error(`Surface-Schlüssel: '${field}' enthält den Trenner '${SEPARATOR}'`);
	}
}
