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

export interface FollowUps {
	/** Alle Nachlaeufe neu starten; laufende werden zurueckgesetzt. */
	trigger(): void;
	/** Alle anhalten. */
	cancel(): void;
	/** Nur fuer Tests und Journalzeilen: wie viele gerade laufen. */
	running(): number;
}

/**
 * Gemessen (docs/research.md Abschnitt 3.3): nach einer Ausgaben- oder
 * Panelaenderung ist `clientArea` im Signal noch die alte, und nach 500 ms war
 * sie noch ein Zwischenstand. Erst nach 1500 ms stimmte sie. Deshalb zwei
 * Nachlaeufe, nicht einer.
 */
export const FOLLOW_UP_MS = [500, 1500];

/**
 * Verzoegerte Nachlaeufe nach einer Aenderung, deren Wirkung erst spaeter
 * vollstaendig ist (Muster Karousel `World.ts:34-40`, Krohnkite-Issue #35).
 *
 * `run` ordnet **nie** selbst an, sondern meldet nur beim Entpreller an: ein
 * Nachlauf, der direkt anordnete, liefe an der Koaleszierung vorbei und
 * koennte mitten in einen laufenden Durchgang schlagen.
 */
export function createFollowUps(
	makeTimer: TimerFactory,
	delays: number[],
	run: (delayMs: number) => void,
): FollowUps {
	const timers: Timer[] = [];

	for (const delay of delays) {
		const timer = makeTimer();
		timer.singleShot = true;
		timer.interval = delay;
		timer.timeout.connect(() => {
			// Wie im Entpreller: `singleShot` ist gemessen vorhanden, seine
			// Wirkung nicht.
			timer.stop();
			try {
				run(delay);
			} catch (error) {
				log(`Nachlauf nach ${delay} ms fehlgeschlagen: ${String(error)}`);
			}
		});
		timers.push(timer);
	}

	return {
		trigger(): void {
			for (const timer of timers) {
				// `restart()` gibt es nicht (gemessen abwesend).
				timer.stop();
				timer.start();
			}
		},
		cancel(): void {
			for (const timer of timers) {
				timer.stop();
			}
		},
		running(): number {
			let n = 0;
			for (const timer of timers) {
				if (timer.active) {
					n += 1;
				}
			}
			return n;
		},
	};
}
