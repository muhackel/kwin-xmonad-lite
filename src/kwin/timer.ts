import { log } from "./log.ts";

/**
 * Der von `createDebouncer` benoetigte Ausschnitt eines `QTimer`. Der Timer
 * kommt als Fabrik herein: im Adapter ist das `() => new QTimer()`, im Test
 * ein Objekt, dessen Ausloesen der Test selbst in der Hand hat. Damit ist die
 * Koaleszierung geprueft, obwohl es unter `node` keinen `QTimer` gibt.
 */
export interface Timer {
	interval: number;
	singleShot: boolean;
	readonly active: boolean;
	readonly timeout: { connect(handler: () => void): void };
	start(): void;
	stop(): void;
}

export type TimerFactory = () => Timer;

export interface Debouncer {
	schedule(reason: string): void;
	pending(): boolean;
}

/** Gemessen: ein Einmal-Timer mit 20 ms feuerte nach 21 ms. */
export const DEBOUNCE_MS = 20;

/**
 * Koalesziert Ausloeser zu einem Lauf (Idee Polonium
 * `src/controller/event.ts:200-269`, MIT).
 *
 * Zwei Regeln, auf die es ankommt:
 *
 * - Ein zweiter Ausloeser innerhalb des offenen Fensters startet den Timer
 *   **nicht** neu. Das erste Ereignis oeffnet das Fenster, alle weiteren
 *   steigen zu. Ein Neustart je Ereignis wuerde die Anordnung waehrend eines
 *   Ereignisstroms — etwa einer Fensterreihe beim Sitzungsstart — beliebig
 *   lange verschieben. (`restart()` gibt es ohnehin nicht, gemessen abwesend.)
 * - Ein Ausloeser **waehrend** des Laufs wird nicht verworfen, sondern zieht
 *   genau einen weiteren Lauf nach (Anti-Pattern Polonium `index.ts:69-70`,
 *   Krohnkite `kwindriver.ts:342`).
 */
export function createDebouncer(
	makeTimer: TimerFactory,
	delayMs: number,
	run: (reasons: string[]) => void,
): Debouncer {
	const timer = makeTimer();
	const reasons = new Set<string>();
	let running = false;
	let dirty = false;

	timer.singleShot = true;
	timer.interval = delayMs;
	timer.timeout.connect(fire);

	function fire(): void {
		// Gemessen ist nur, dass `singleShot` existiert und `false` meldet —
		// nicht, dass die Zuweisung durchschlaegt. Das explizite `stop()` macht
		// die Annahme ueberfluessig.
		timer.stop();
		const batch = Array.from(reasons);
		reasons.clear();
		running = true;
		try {
			run(batch);
		} catch (error) {
			log(`Anordnung fehlgeschlagen: ${String(error)}`);
		}
		running = false;
		if (dirty) {
			dirty = false;
			timer.start();
		}
	}

	function schedule(reason: string): void {
		reasons.add(reason);
		if (running) {
			dirty = true;
			return;
		}
		if (!timer.active) {
			timer.start();
		}
	}

	return {
		schedule,
		pending: () => timer.active || dirty,
	};
}
