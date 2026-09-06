import type { ConfigReader } from "../../src/kwin/config.ts";

/**
 * Buchführung ohne Verhalten, Formvorbild sind `fakePort` und `fakeTimer`.
 * Ein gesetzter Wert darf ausdrücklich Unsinn tragen -- genau so kommt er aus
 * einem von Hand verkorksten `kwinrc` beim Leser an.
 */
export interface FakeReader extends ConfigReader {
	set(key: string, value: string): void;
}

export function fakeReader(): FakeReader {
	const values = new Map<string, string>();

	return {
		set(key: string, value: string): void {
			values.set(key, value);
		},
		raw(key: string): string | null {
			return values.get(key) ?? null;
		},
	};
}
