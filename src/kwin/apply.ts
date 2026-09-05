import type { Rect } from "../core/rect.ts";
import { equals } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import type { Registry, WindowState } from "../state/registry.ts";
import { clearExpectation, getWindow } from "../state/registry.ts";
import { judgeRecheck, judgeSignal } from "./geometry.ts";
import type { TimerFactory } from "./timer.ts";

/**
 * Zugriff auf ein einzelnes Fenster, so schmal wie möglich. Der Adapter legt
 * die KWin-Handles dahinter, der Test eine Tabelle -- damit ist die ganze
 * Signalfolge aus Write, Rücklesen und Nachbesserung unter `node --test`
 * prüfbar, obwohl sie im Betrieb nur an echten KWin-Objekten läuft.
 *
 * `read` und `write` melden ein fehlendes Handle selbst. Das ist die einzige
 * Tür zum Fenster, und sie ist verschlossen, sobald `closed` das Handle aus
 * der Tabelle geworfen hat: zwischen dem Schließen und einem verzögerten
 * Timerlauf kann also kein Zugriff auf ein totes Objekt mehr stattfinden.
 */
export interface GeometryPort {
	/** `null`, wenn das Handle fort ist. */
	read(id: WindowId): Rect | null;
	/** `false` heißt: Handle fort, nichts geschrieben. */
	write(id: WindowId, rect: Rect): boolean;
	/** `window.move || window.resize`. */
	dragging(id: WindowId): boolean;
	/** Handle fort oder das Fenster nimmt nicht mehr am Layout teil. */
	blocked(id: WindowId): boolean;
}

export interface GeometryHooks {
	/**
	 * Die Geometrie hat sich ohne eigenes Zutun geändert. Ob daraus ein
	 * Anordnungslauf wird, entscheidet der Adapter -- nur er weiß, wer zuletzt
	 * Layout-Teilnehmer war.
	 */
	external(id: WindowId): void;
	log(message: string): void;
}

export interface GeometryController {
	/** Neuer Zielwert: ersetzt die Erwartung und öffnet eine Schreibgeneration. */
	apply(id: WindowId, target: Rect): void;
	/** Float-Rechteck: einmal schreiben, ohne Erwartung oder Nachbesserung. */
	place(id: WindowId, target: Rect): void;
	/** Aus `frameGeometryChanged`. Schreibt niemals. */
	notifyChanged(id: WindowId): void;
	/**
	 * Das Fenster steht bereits auf dem neuen Zielwert (`judgeWrite` meldete
	 * `"unchanged"`). Eine noch offene Erwartung eines **älteren** Zielwerts
	 * gilt damit als erledigt, samt eingeplanter Nachprüfung — sonst schöbe der
	 * Nachprüfungslauf das Fenster auf das veraltete Soll zurück.
	 */
	accept(id: WindowId, actual: Rect): void;
	/** Fenster fort oder Layout-Teilnahme verlassen: Erwartung und Nachprüfung. */
	forget(id: WindowId): void;
	/** Nur für Tests und Journalzeilen: wie viele Nachprüfungen anstehen. */
	pendingCount(): number;
}

/**
 * Abstand bis zur Nachprüfung. Gewählt, nicht gemessen: ein
 * xdg-configure-Umlauf braucht mindestens einen Bildwechsel. Der Wert ist
 * unkritisch -- eine früher eintreffende Bestätigung schließt den Fall
 * über den Signalpfad, und die Zahl der Nachbesserungen ist ohnehin gedeckelt.
 */
export const RECHECK_MS = 50;

function fmt(rect: Rect): string {
	return `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
}

/**
 * Hält die Geometrieerwartung je Fenster und bringt sie zur Ruhe. Zwei Regeln
 * tragen die ganze Konstruktion:
 *
 * - **Der Signalpfad schreibt nie.** `notifyChanged` darf lesen, beruhigen,
 *   eine Nachprüfung einplanen und eine fremde Änderung melden. Ein Write
 *   innerhalb von `frameGeometryChanged` wäre ein verschachtelter Write.
 * - **Nachgebessert wird ausschließlich im Timerlauf**, und dort höchstens
 *   einmal je Fenster und Durchlauf. Bis zum Aufgeben braucht es deshalb drei
 *   Läufe; kein Eintrag rennt rekursiv durch.
 */
export function createGeometryController(
	registry: Registry,
	port: GeometryPort,
	makeTimer: TimerFactory,
	hooks: GeometryHooks,
): GeometryController {
	/**
	 * Fenster, an denen gerade geschrieben wird. Eine Menge, kein einzelnes
	 * Feld: das synchrone Signal eines **anderen** Fensters soll währenddessen
	 * ausdrücklich durchkommen.
	 */
	const writing = new Set<WindowId>();
	/** Fenster -> Schreibgeneration, für die eine Nachprüfung ansteht. */
	const pending = new Map<WindowId, number>();

	const timer = makeTimer();
	timer.singleShot = true;
	timer.interval = RECHECK_MS;
	timer.timeout.connect(onRecheck);

	/**
	 * Nimmt ein Fenster aus der Nachprüfung. Bleibt danach nichts mehr zu tun,
	 * hält der Timer sofort an, statt noch einmal ins Leere zu feuern; sind
	 * andere Fenster eingeplant, läuft er weiter.
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
	 * Die einzige Stelle, die schreibt. Die Bestätigung holt sie sich gleich
	 * selbst: eine reine Verschiebung ist auf Wayland synchron und wäre sonst
	 * nur über das eigene, gerade gesperrte Signal zu erfahren. Weicht das
	 * Rücklesen ab, wird eine Nachprüfung eingeplant -- sich auf ein späteres
	 * Signal zu verlassen, könnte ins Leere laufen, weil es während des
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

	function place(id: WindowId, target: Rect): void {
		const state = registry.windows.get(id);
		if (state === undefined) {
			return;
		}
		cancelRecheck(id);
		state.expectedRect = null;
		state.applyAttempts = 0;
		hooks.log(`float ${id} soll=${fmt(target)}`);

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
		state.lastObservedRect = actual;
	}

	function accept(id: WindowId, actual: Rect): void {
		const state = registry.windows.get(id);
		if (state === undefined) {
			return;
		}
		settle(id, state, actual);
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

		// Keine Erwartung offen: entweder der eigene Nachhall -- eine verspätete
		// Bestätigung des Werts, den der Controller bereits akzeptiert hat --
		// oder eine wirklich fremde Änderung. Maßgeblich ist allein der
		// zuletzt beobachtete Istwert: nach einem Giveup ist `tiledRect`
		// absichtlich das nie erreichte Soll, und eine fremde Verschiebung genau
		// dorthin wäre sonst verschluckt.
		if (state.lastObservedRect !== null && equals(actual, state.lastObservedRect)) {
			return;
		}
		hooks.external(id);
	}

	/**
	 * Ein Durchlauf, ein Versuch je Fenster. `pending` wird **vor** der
	 * Verarbeitung geleert, ein Retry hinterlässt höchstens einen neuen
	 * Eintrag für den nächsten Lauf.
	 */
	function onRecheck(): void {
		// Gemessen ist nur, dass `singleShot` existiert und `false` meldet --
		// nicht, dass die Zuweisung durchschlägt. Das explizite `stop()` macht
		// die Annahme überflüssig (wie in `timer.ts`).
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

		// Eine Nachbesserung hat den Timer über `planRecheck` schon gestartet;
		// ohne den Wächter käme hier ein zweiter, das Intervall neu setzender
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
			// Netz: seit `settle` und `forget` den Eintrag selbst abräumen, ist
			// dieser Zweig praktisch unerreichbar -- ein neuer Write überschreibt
			// den Eintrag, statt ihn veralten zu lassen. `judgeRecheck` prüft
			// "stale" weiterhin.
			return;
		}
		if (port.dragging(id)) {
			// Der Nutzer zieht gerade; `interactiveMoveResizeFinished` ordnet
			// danach ohnehin neu an. Die Erwartung fällt dabei: bliebe sie
			// offen, schöbe das erste Signal nach dem Loslassen das Fenster
			// über den Signalpfad zurück, statt die Verschiebung zu melden.
			forget(id);
			return;
		}
		if (port.blocked(id)) {
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
			// ihn liefe eine verspätete Meldung derselben Geometrie als fremde
			// Änderung in einen neuen Anordnungs- und Nachbesserungszyklus.
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
		place,
		notifyChanged,
		accept,
		forget,
		pendingCount: () => pending.size,
	};
}
