/**
 * Testrig für `src/kwin/adapter.ts`.
 *
 * Der Adapter liegt hinter der Snapshot-Grenze: er fasst `workspace`, `KWin`,
 * `QTimer`, `options`, `registerShortcut` und `readConfig` direkt an. Bis
 * hierher kam deshalb kein Test -- die Grenze, die den Rest des Baums prüfbar
 * macht, hat ausgerechnet den Aktivierungspfad ausgespart.
 *
 * Der Ausweg braucht **keine** Änderung am Controller: `createAdapter()`
 * erzeugt jedes Objekt erst in seinem Rumpf, auf Modulebene wird keine Global
 * berührt. Wer die Globals vorher auf `globalThis` legt, bekommt einen
 * vollständig verdrahteten Adapter gegen Attrappen.
 *
 * Der eigentliche Zweck ist `aktivierungen`: ein **zählender** Setter auf
 * `workspace.activeWindow`. Fall 20b verlangt „höchstens ein Aktivierungsversuch
 * je Befehl", und live zählbar ist nur die `aktiviere`-Journalzeile -- also das,
 * was der Controller über sich selbst sagt. Hier wird der Schreibzugriff selbst
 * gezählt.
 */

import type { Rect } from "../../src/core/rect.ts";
// Der Import ist unbedenklich: weder `adapter.ts` noch eines seiner Module
// fasst auf Modulebene eine KWin-Global an. Erst `createAdapter()` tut es, und
// das ruft der Rig, nachdem er die Attrappen gesetzt hat.
import { createAdapter } from "../../src/kwin/adapter.ts";
import { ACTIVITY, AREA, DESKTOP, OUTPUT } from "./kwinfake.ts";

export interface RigFenster {
	id: string;
	geometry: Rect;
	minimized: boolean;
	fullScreen: boolean;
	maximizeMode: number;
	move: boolean;
	resize: boolean;
	moveable: boolean;
	resizeable: boolean;
	normalWindow: boolean;
	managed: boolean;
	dock: boolean;
	modal: boolean;
	transientFor: unknown;
	caption: string;
	resourceClass: string;
	output: { name: string };
	desktops: Array<{ id: string }>;
	activities: string[];
	onAllDesktops: boolean;
	minSize: { width: number; height: number };
	maxSize: { width: number; height: number };
	internalId: string;
	frameGeometry: Rect;
	[signal: string]: unknown;
}

type Rueckruf = (...args: unknown[]) => void;

function signal(): { connect: (h: Rueckruf) => void; disconnect: (h: Rueckruf) => void } & {
	feuern: (...args: unknown[]) => void;
} {
	const handler: Rueckruf[] = [];
	const s = {
		connect(h: Rueckruf): void {
			handler.push(h);
		},
		disconnect(h: Rueckruf): void {
			const index = handler.indexOf(h);
			if (index >= 0) {
				handler.splice(index, 1);
			}
		},
		feuern(...args: unknown[]): void {
			for (const h of handler.slice()) {
				h(...args);
			}
		},
	};
	return s;
}

export function rigFenster(
	id: string,
	geometry: Rect = { x: 0, y: 0, width: 800, height: 600 },
): RigFenster {
	const fenster: RigFenster = {
		id,
		geometry,
		frameGeometry: { ...geometry },
		minimized: false,
		fullScreen: false,
		maximizeMode: 0,
		move: false,
		resize: false,
		moveable: true,
		resizeable: true,
		normalWindow: true,
		managed: true,
		dock: false,
		modal: false,
		transientFor: null,
		caption: `kxl-${id}`,
		resourceClass: "kwrite",
		output: { name: OUTPUT },
		desktops: [{ id: DESKTOP }],
		activities: [ACTIVITY],
		onAllDesktops: false,
		minSize: { width: 1, height: 1 },
		maxSize: { width: 2147483647, height: 2147483647 },
		internalId: `{${id}}`,
		frameGeometryChanged: signal(),
		closed: signal(),
		outputChanged: signal(),
		desktopsChanged: signal(),
		activitiesChanged: signal(),
		minimizedChanged: signal(),
		maximizedChanged: signal(),
		fullScreenChanged: signal(),
		interactiveMoveResizeFinished: signal(),
	};
	return fenster;
}

export interface AdapterRig {
	/** Jeder Schreibzugriff auf `workspace.activeWindow`, in Reihenfolge. */
	aktivierungen: string[];
	/** Jede Journalzeile, die der Controller geschrieben hat. */
	logs: string[];
	/** Löst den Rückruf aus, den `registerShortcut` für diesen Namen bekam. */
	taste(objectName: string): void;
	/** Die Namen, unter denen Kürzel registriert wurden. */
	tasten(): string[];
	/** Lässt alle laufenden Timer feuern, bis nichts mehr aussteht. */
	beruhigen(): void;
	/** Setzt das aktive Fenster, ohne den Zähler zu erhöhen. */
	fokus(id: string | null): void;
	/** KWin leitet jede Aktivierung auf dieses Fenster um (Fall 20b). */
	umleitenAuf(id: string | null): void;
	fenster: RigFenster[];
	workspace: Record<string, unknown>;
	start(): void;
}

export interface RigOptionen {
	fenster?: RigFenster[];
	/** Werte der Gruppe `[Script-…]`, wie `readConfig` sie liefert. */
	config?: Record<string, string>;
}

/**
 * Legt die KWin-Globals auf `globalThis`, baut den Adapter und gibt die
 * Steuerung zurück. Der Aufrufer ruft `start()` selbst -- so lässt sich der
 * Zustand vor dem Start noch einstellen.
 */
export function adapterRig(optionen: RigOptionen = {}): AdapterRig {
	const fenster = optionen.fenster ?? [];
	const aktivierungen: string[] = [];
	const logs: string[] = [];
	const tastenTabelle = new Map<string, Rueckruf>();
	let aktiv: RigFenster | null = null;
	let umleitung: string | null = null;

	const workspaceSignale = {
		windowAdded: signal(),
		windowRemoved: signal(),
		windowActivated: signal(),
		currentDesktopChanged: signal(),
		currentActivityChanged: signal(),
		activitiesChanged: signal(),
		desktopsChanged: signal(),
		screensChanged: signal(),
		virtualScreenGeometryChanged: signal(),
	};

	const workspace: Record<string, unknown> = {
		...workspaceSignale,
		currentActivity: ACTIVITY,
		currentDesktop: { id: DESKTOP },
		activities: [ACTIVITY],
		desktops: [{ id: DESKTOP }],
		screens: [{ name: OUTPUT }],
		currentDesktopForScreen(): { id: string } {
			return { id: DESKTOP };
		},
		clientArea(): Rect {
			return AREA;
		},
		windowList(): RigFenster[] {
			return fenster;
		},
		raiseWindow(): void {
			// Der Rig zählt nur Aktivierungen; das Heben ist hier ohne Belang.
		},
	};

	// Der zählende Setter: **das** ist der Nachweis, den Fall 20b braucht.
	// Die Umleitung bildet nach, was KWin bei einem modalen Dialog tut -- es
	// nimmt die Aktivierung an, gibt den Fokus aber einem anderen Fenster.
	Object.defineProperty(workspace, "activeWindow", {
		get(): RigFenster | null {
			return aktiv;
		},
		set(value: RigFenster | null): void {
			aktivierungen.push(value === null ? "null" : value.id);
			if (umleitung !== null) {
				aktiv = fenster.find((eintrag) => eintrag.id === umleitung) ?? null;
			} else {
				aktiv = value;
			}
			workspaceSignale.windowActivated.feuern(aktiv);
		},
		configurable: true,
	});

	class FakeQTimer {
		interval = 0;
		singleShot = false;
		private laufend = false;
		private readonly signalObjekt = signal();
		get timeout(): ReturnType<typeof signal> {
			return this.signalObjekt;
		}
		start(): void {
			this.laufend = true;
		}
		stop(): void {
			this.laufend = false;
		}
		get running(): boolean {
			return this.laufend;
		}
		auslösen(): void {
			if (this.laufend) {
				this.laufend = false;
				this.signalObjekt.feuern();
			}
		}
	}

	const timerListe: FakeQTimer[] = [];
	const welt = globalThis as unknown as Record<string, unknown>;
	welt.workspace = workspace;
	welt.KWin = { MaximizeArea: 2 };
	welt.options = { perOutputVirtualDesktops: false };
	welt.QTimer = function QTimerFabrik(this: FakeQTimer): FakeQTimer {
		const t = new FakeQTimer();
		timerListe.push(t);
		return t;
	} as unknown as new () => FakeQTimer;
	welt.registerShortcut = (
		objectName: string,
		_text: string,
		_key: string,
		callback: Rueckruf,
	): boolean => {
		tastenTabelle.set(objectName, callback);
		return true;
	};
	welt.readConfig = (key: string, vorgabe: unknown): unknown => {
		const werte = optionen.config ?? {};
		return key in werte ? werte[key] : vorgabe;
	};
	welt.print = (...args: unknown[]): void => {
		logs.push(args.map(String).join(" "));
	};
	welt.console = {
		log(...args: unknown[]): void {
			logs.push(args.map(String).join(" "));
		},
		info(...args: unknown[]): void {
			logs.push(args.map(String).join(" "));
		},
		warn(...args: unknown[]): void {
			logs.push(args.map(String).join(" "));
		},
		error(...args: unknown[]): void {
			logs.push(args.map(String).join(" "));
		},
		assert(): void {
			// nicht benutzt
		},
	};

	// Erst hier, mit gesetzten Globals.
	const adapter = createAdapter();

	return {
		aktivierungen,
		logs,
		fenster,
		workspace,
		start(): void {
			adapter.start();
		},
		taste(objectName: string): void {
			const callback = tastenTabelle.get(objectName);
			if (callback === undefined) {
				throw new Error(`kein Kürzel registriert: ${objectName}`);
			}
			callback();
		},
		tasten(): string[] {
			return Array.from(tastenTabelle.keys());
		},
		beruhigen(): void {
			for (let runde = 0; runde < 20; runde++) {
				const laufende = timerListe.filter((t) => t.running);
				if (laufende.length === 0) {
					return;
				}
				for (const t of laufende) {
					t.auslösen();
				}
			}
		},
		fokus(id: string | null): void {
			aktiv = id === null ? null : (fenster.find((eintrag) => eintrag.id === id) ?? null);
		},
		umleitenAuf(id: string | null): void {
			umleitung = id;
		},
	};
}
