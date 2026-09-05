import type { Rect } from "../core/rect.ts";
import { equals } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import type { Registry, WindowState } from "../state/registry.ts";
import { clearExpectation, getWindow } from "../state/registry.ts";
import { judgeRecheck, judgeSignal } from "./geometry.ts";
import type { TimerFactory } from "./timer.ts";

/**
 * Zugriff auf ein einzelnes Fenster, so schmal wie moeglich. Der Adapter legt
 * die KWin-Handles dahinter, der Test eine Tabelle -- damit ist die ganze
 * Signalfolge aus Write, Ruecklesen und Nachbesserung unter `node --test`
 * pruefbar, obwohl sie im Betrieb nur an echten KWin-Objekten laeuft.
 *
 * `read` und `write` melden ein fehlendes Handle selbst. Das ist die einzige
 * Tuer zum Fenster, und sie ist verschlossen, sobald `closed` das Handle aus
 * der Tabelle geworfen hat: zwischen dem Schliessen und einem verzoegerten
 * Timerlauf kann also kein Zugriff auf ein totes Objekt mehr stattfinden.
 */
export interface GeometryPort {
	/** `null`, wenn das Handle fort ist. */
	read(id: WindowId): Rect | null;
	/** `false` heisst: Handle fort, nichts geschrieben. */
	write(id: WindowId, rect: Rect): boolean;
	/** `window.move || window.resize`. */
	dragging(id: WindowId): boolean;
}

export interface GeometryHooks {
	/**
	 * Die Geometrie hat sich ohne eigenes Zutun geaendert. Ob daraus ein
	 * Anordnungslauf wird, entscheidet der Adapter -- nur er weiss, wer zuletzt
	 * Layout-Teilnehmer war.
	 */
	external(id: WindowId): void;
	log(message: string): void;
}

export interface GeometryController {
	/** Neuer Zielwert: ersetzt die Erwartung und oeffnet eine Schreibgeneration. */
	apply(id: WindowId, target: Rect): void;
	/** Aus `frameGeometryChanged`. Schreibt niemals. */
	notifyChanged(id: WindowId): void;
	/** Fenster fort oder Layout-Teilnahme verlassen: Erwartung und Nachpruefung. */
	forget(id: WindowId): void;
	/** Nur fuer Tests und Journalzeilen: wie viele Nachpruefungen anstehen. */
	pendingCount(): number;
}

/**
 * Abstand bis zur Nachpruefung. Gewaehlt, nicht gemessen: ein
 * xdg-configure-Umlauf braucht mindestens einen Bildwechsel. Der Wert ist
 * unkritisch -- eine frueher eintreffende Bestaetigung schliesst den Fall
 * ueber den Signalpfad, und die Zahl der Nachbesserungen ist ohnehin gedeckelt.
 */
export const RECHECK_MS = 50;

function fmt(rect: Rect): string {
	return `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
}

/**
 * Haelt die Geometrieerwartung je Fenster und bringt sie zur Ruhe. Zwei Regeln
 * tragen die ganze Konstruktion:
 *
 * - **Der Signalpfad schreibt nie.** `notifyChanged` darf lesen, beruhigen,
 *   eine Nachpruefung einplanen und eine fremde Aenderung melden. Ein Write
 *   innerhalb von `frameGeometryChanged` waere ein verschachtelter Write.
 * - **Nachgebessert wird ausschliesslich im Timerlauf**, und dort hoechstens
 *   einmal je Fenster und Durchlauf. Bis zum Aufgeben braucht es deshalb drei
 *   Laeufe; kein Eintrag rennt rekursiv durch.
 */
export function createGeometryController(
	registry: Registry,
	port: GeometryPort,
	makeTimer: TimerFactory,
	hooks: GeometryHooks,
): GeometryController {
	/**
	 * Fenster, an denen gerade geschrieben wird. Eine Menge, kein einzelnes
	 * Feld: das synchrone Signal eines **anderen** Fensters soll waehrenddessen
	 * ausdruecklich durchkommen.
	 */
	const writing = new Set<WindowId>();
	/** Fenster -> Schreibgeneration, fuer die eine Nachpruefung ansteht. */
	const pending = new Map<WindowId, number>();

	const timer = makeTimer();
	timer.singleShot = true;
	timer.interval = RECHECK_MS;
	timer.timeout.connect(onRecheck);

	/**
	 * Nimmt ein Fenster aus der Nachpruefung. Bleibt danach nichts mehr zu tun,
	 * haelt der Timer sofort an, statt noch einmal ins Leere zu feuern; sind
	 * andere Fenster eingeplant, laeuft er weiter.
	 */
	function cancelRecheck(id: WindowId): void {
		pending.delete(id);
		if (pending.size === 0 && timer.active) {
			timer.stop();
		}
	}

	function settle(id: WindowId, state: WindowState, actual: Rect): void {
		cancelRecheck(id);
		state.expectedRect = null;
		state.applyAttempts = 0;
		state.tiledRect = actual;
		state.lastObservedRect = actual;
	}

	function planRecheck(id: WindowId, generation: number): void {
		pending.set(id, generation);
		if (!timer.active) {
			timer.start();
		}
	}

	function forget(id: WindowId): void {
		cancelRecheck(id);
		clearExpectation(registry, id);
	}

	/**
	 * Die einzige Stelle, die schreibt. Die Bestaetigung holt sie sich gleich
	 * selbst: eine reine Verschiebung ist auf Wayland synchron und waere sonst
	 * nur ueber das eigene, gerade gesperrte Signal zu erfahren. Weicht das
	 * Ruecklesen ab, wird eine Nachpruefung eingeplant -- sich auf ein spaeteres
	 * Signal zu verlassen, koennte ins Leere laufen, weil es waehrend des
	 * Schreibens schon gefeuert und dabei verworfen worden sein kann.
	 */
	function writeAndProbe(id: WindowId, state: WindowState, target: Rect): void {
		writing.add(id);
		let written: boolean;
		try {
			written = port.write(id, target);
		} finally {
			writing.delete(id);
		}
		if (!written) {
			forget(id);
			return;
		}
		const actual = port.read(id);
		if (actual === null) {
			forget(id);
			return;
		}
		if (equals(actual, target)) {
			settle(id, state, actual);
			return;
		}
		planRecheck(id, state.writeGeneration);
	}

	function apply(id: WindowId, target: Rect): void {
		const state = getWindow(registry, id);
		state.expectedRect = target;
		state.applyAttempts = 0;
		state.writeGeneration += 1;
		hooks.log(`apply ${id} soll=${fmt(target)}`);
		writeAndProbe(id, state, target);
	}

	function notifyChanged(id: WindowId): void {
		if (writing.has(id)) {
			return;
		}
		if (port.dragging(id)) {
			return;
		}
		const state = registry.windows.get(id);
		if (state === undefined) {
			return;
		}
		const actual = port.read(id);
		if (actual === null) {
			return;
		}

		if (state.expectedRect !== null) {
			if (judgeSignal(state, actual) === "settled") {
				settle(id, state, actual);
			} else {
				planRecheck(id, state.writeGeneration);
			}
			return;
		}

		// Keine Erwartung offen: entweder der eigene Nachhall -- eine verspaetete
		// Bestaetigung des Werts, den der Controller bereits akzeptiert hat --
		// oder eine wirklich fremde Aenderung. Massgeblich ist allein der
		// zuletzt beobachtete Istwert: nach einem Giveup ist `tiledRect`
		// absichtlich das nie erreichte Soll, und eine fremde Verschiebung genau
		// dorthin waere sonst verschluckt.
		if (state.lastObservedRect !== null && equals(actual, state.lastObservedRect)) {
			return;
		}
		hooks.external(id);
	}

	/**
	 * Ein Durchlauf, ein Versuch je Fenster. `pending` wird **vor** der
	 * Verarbeitung geleert, ein Retry hinterlaesst hoechstens einen neuen
	 * Eintrag fuer den naechsten Lauf.
	 */
	function onRecheck(): void {
		// Gemessen ist nur, dass `singleShot` existiert und `false` meldet --
		// nicht, dass die Zuweisung durchschlaegt. Das explizite `stop()` macht
		// die Annahme ueberfluessig (wie in `timer.ts`).
		timer.stop();
		const batch = Array.from(pending.keys());
		const generations = new Map<WindowId, number>();
		for (const id of batch) {
			const generation = pending.get(id);
			if (generation !== undefined) {
				generations.set(id, generation);
			}
		}
		pending.clear();

		for (const id of batch) {
			const generation = generations.get(id);
			if (generation !== undefined) {
				recheckOne(id, generation);
			}
		}

		// Eine Nachbesserung hat den Timer ueber `planRecheck` schon gestartet;
		// ohne den Waechter kaeme hier ein zweiter, das Intervall neu setzender
		// Start hinterher.
		if (pending.size > 0 && !timer.active) {
			timer.start();
		}
	}

	function recheckOne(id: WindowId, generation: number): void {
		const state = registry.windows.get(id);
		if (state === undefined) {
			return;
		}
		if (state.writeGeneration !== generation) {
			// Netz: seit `settle` und `forget` den Eintrag selbst abraeumen, ist
			// dieser Zweig praktisch unerreichbar -- ein neuer Write ueberschreibt
			// den Eintrag, statt ihn veralten zu lassen. `judgeRecheck` prueft
			// "stale" weiterhin.
			return;
		}
		if (port.dragging(id)) {
			// Der Nutzer zieht gerade; `interactiveMoveResizeFinished` ordnet
			// danach ohnehin neu an. Die Erwartung faellt dabei: bliebe sie
			// offen, schoebe das erste Signal nach dem Loslassen das Fenster
			// ueber den Signalpfad zurueck, statt die Verschiebung zu melden.
			forget(id);
			return;
		}
		const actual = port.read(id);
		if (actual === null) {
			forget(id);
			return;
		}

		const verdict = judgeRecheck(state, generation, actual);
		if (verdict === "settled") {
			settle(id, state, actual);
			return;
		}
		if (verdict === "giveup") {
			hooks.log(`aufgegeben ${id} nach ${state.applyAttempts} Versuchen, ist=${fmt(actual)}`);
			cancelRecheck(id);
			state.expectedRect = null;
			state.applyAttempts = 0;
			// Der zuletzt beobachtete Istwert gilt ab jetzt als akzeptiert. Ohne
			// ihn liefe eine verspaetete Meldung derselben Geometrie als fremde
			// Aenderung in einen neuen Anordnungs- und Nachbesserungszyklus.
			state.lastObservedRect = actual;
			return;
		}
		if (verdict !== "retry") {
			return;
		}
		const target = state.expectedRect;
		if (target === null) {
			return;
		}
		state.applyAttempts += 1;
		hooks.log(
			`nachbessern ${id} versuch=${state.applyAttempts} ist=${fmt(actual)} soll=${fmt(target)}`,
		);
		writeAndProbe(id, state, target);
	}

	return {
		apply,
		notifyChanged,
		forget,
		pendingCount: () => pending.size,
	};
}
