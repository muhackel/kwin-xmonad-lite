// Laufzeitumgebung eines KWin-Skripts mit "X-Plasma-API": "javascript".
// Die QJSEngine kennt weder DOM noch Node; die hier deklarierten Globals sind
// die, die KWin in scripting.cpp in den Skriptkontext injiziert.
// Wird mit jedem Meilenstein um die tatsaechlich benutzten Teile erweitert.
//
// tsconfig hat "types": [] und "lib": ["ES2016"] -- was hier fehlt, existiert
// fuer den Typpruefer nicht. Alle Angaben sind an KWin 6.7.4 gemessen --
// die Objekte und Enums in Meilenstein 0, die Signalsignaturen in
// Meilenstein 4; siehe docs/research.md und die Rohdaten unter docs/.
//
// Die Datei hat bewusst weder Import noch Export: damit bleibt sie ein Skript
// und ihre Deklarationen global.

declare const console: {
	log(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
	assert(condition: unknown, message?: string): void;
};

/**
 * Qt-Rechteck. Feldgleich mit `Rect` aus `core/rect.ts`, aber ein eigener Typ:
 * ein KWin-Wrapperobjekt darf nie in die reinen Schichten wandern, `read.ts`
 * kopiert die vier Zahlen heraus. Beim Schreiben immer das ganze Objekt
 * zuweisen -- eine Teilzuweisung wirkt nicht (Tessera `driver.ts:447-450`).
 */
interface QRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface QSize {
	width: number;
	height: number;
}

/**
 * Signale sind Funktionen mit `connect`/`disconnect`, keine eigenen Objekte.
 * Q_INVOKABLE-Methoden tragen dieselben Eigenschaften; am Typ allein sind
 * Signal und Methode nicht zu unterscheiden.
 *
 * `Signal0` heisst hier **gemessen ohne Argumente**. Wo Argumente kommen, hat
 * das Signal einen eigenen Typ -- auch dann, wenn der Adapter sie nicht liest:
 * eine falsche Argumentzahl in der Deklaration faellt sonst niemandem auf.
 * Gemessen in Meilenstein 4 mit `nix run .#probe-signals`, siehe
 * `docs/research.md` Abschnitt 3.1.
 */
interface Signal0 {
	connect(handler: () => void): void;
	disconnect(handler: () => void): void;
}

interface SignalWindow {
	connect(handler: (window: KwinWindow | null) => void): void;
	disconnect(handler: (window: KwinWindow | null) => void): void;
}

/**
 * `currentDesktopChanged(prev, cur, output)`. Gemessen dreiargumentig -- und
 * es feuert **einmal je Ausgabe**, auch bei `perOutputVirtualDesktops = false`.
 * Waehrend der Folge ist `workspace.currentDesktop` noch nicht umgestellt;
 * im Callback wird deshalb nur entprellt, gelesen wird erst im Lauf.
 */
interface SignalDesktopChanged {
	connect(
		handler: (prev: KwinVirtualDesktop, cur: KwinVirtualDesktop, output: KwinOutput) => void,
	): void;
	disconnect(
		handler: (prev: KwinVirtualDesktop, cur: KwinVirtualDesktop, output: KwinOutput) => void,
	): void;
}

/**
 * `currentActivityChanged(id)` und `activitiesChanged(id)` tragen je eine
 * Activity-UUID. `activitiesChanged` meldet **nur** Anlegen und Entfernen,
 * nicht den Wechsel -- genau der Ausloeser, den der Registry-GC braucht.
 */
interface SignalActivity {
	connect(handler: (id: string) => void): void;
	disconnect(handler: (id: string) => void): void;
}

/** `LogicalOutput`. Kein `uuid`, kein `enabled`, kein `scale` -- gemessen. */
interface KwinOutput {
	/** DRM-Connector wie `DP-1`, portstabil. Schluesselbestandteil. */
	readonly name: string;
}

interface KwinVirtualDesktop {
	/** UUID **ohne** geschweifte Klammern, anders als `window.internalId`. */
	readonly id: string;
	/** Nur fuer lesbare Journalausgaben. */
	readonly x11DesktopNumber: number;
}

// Die array-artigen Listen sind als `ArrayLike<T>` deklariert, nicht als
// `Array<T>`: `Array.isArray` liefert darauf gemessen `false`, und `map`,
// `filter` sowie `for…of` gibt es nicht. `ArrayLike` erlaubt genau `length`
// und Indexzugriff -- der Typpruefer faengt einen `.map`-Griff damit ab,
// bevor er zur Laufzeit im Journal auffaellt.

interface KwinWindow {
	/** QUuid-Objekt, kein String. Nur ueber `String(...)` verwendbar. */
	readonly internalId: { toString(): string };
	readonly resourceClass: string;

	readonly managed: boolean;
	readonly deleted: boolean;
	readonly normalWindow: boolean;
	readonly specialWindow: boolean;
	readonly popupWindow: boolean;
	readonly dialog: boolean;
	readonly utility: boolean;
	readonly splash: boolean;
	readonly transient: boolean;
	readonly modal: boolean;
	readonly dock: boolean;

	readonly output: KwinOutput | null;
	/** Leere Liste heisst "alle Desktops" (an einem Dock gemessen). */
	readonly desktops: ArrayLike<KwinVirtualDesktop>;
	/** Leere Liste heisst "alle Activities". */
	readonly activities: ArrayLike<string>;
	readonly onAllDesktops: boolean;

	/** Schreiben heisst `moveResize` -- ohne Klemmung, ohne Maximiert-Pruefung. */
	frameGeometry: QRect;
	readonly minSize: QSize;
	/** Meldet fuer "unbegrenzt" 2147483647. */
	readonly maxSize: QSize;

	readonly fullScreen: boolean;
	readonly minimized: boolean;
	/** 0 Restore, 1 Vertical, 2 Horizontal, 3 Full. Kein Enum auf `KWin`. */
	readonly maximizeMode: number;
	readonly moveable: boolean;
	readonly resizeable: boolean;
	/** Laeuft gerade ein interaktives Verschieben bzw. Groessenaendern. */
	readonly move: boolean;
	readonly resize: boolean;

	readonly frameGeometryChanged: Signal0;
	readonly outputChanged: Signal0;
	readonly desktopsChanged: Signal0;
	readonly activitiesChanged: Signal0;
	readonly minimizedChanged: Signal0;
	readonly fullScreenChanged: Signal0;
	readonly maximizedChanged: Signal0;
	readonly interactiveMoveResizeFinished: Signal0;
	readonly closed: Signal0;
}

declare const workspace: {
	readonly screens: ArrayLike<KwinOutput>;
	readonly currentDesktop: KwinVirtualDesktop | null;
	/** Alle virtuellen Desktops. Ist-Menge fuer `purgeSurfaces`. */
	readonly desktops: ArrayLike<KwinVirtualDesktop>;
	readonly currentActivity: string;
	readonly activities: ArrayLike<string>;
	activeWindow: KwinWindow | null;

	windowList(): ArrayLike<KwinWindow>;
	/** Das Desktop-Argument ist in 6.7.4 wirkungslos, gehoert aber zur Signatur. */
	clientArea(option: number, output: KwinOutput, desktop: KwinVirtualDesktop): QRect;
	currentDesktopForScreen(output: KwinOutput): KwinVirtualDesktop | null;
	raiseWindow(window: KwinWindow): void;

	readonly windowAdded: SignalWindow;
	readonly windowRemoved: SignalWindow;
	readonly windowActivated: SignalWindow;
	readonly currentDesktopChanged: SignalDesktopChanged;
	readonly currentActivityChanged: SignalActivity;
	/** Anlegen und Entfernen einer Activity, nicht der Wechsel. */
	readonly activitiesChanged: SignalActivity;
	/** Anlegen und Entfernen eines Desktops, nicht der Wechsel. Ohne Argument. */
	readonly desktopsChanged: Signal0;
	/** Einziges Signal ueber die Menge der Ausgaben; kommt in der Folge zuletzt. */
	readonly screensChanged: Signal0;
	readonly virtualScreenGeometryChanged: Signal0;
};

/**
 * Nur der eine gelesene Wert. `perOutputVirtualDesktops` steuert kein
 * Verhalten -- `currentDesktopForScreen` mit Fallback deckt beide Faelle ab --,
 * aber ohne die Journalzeile ist ein spaeterer Auszug nicht deutbar.
 * Gemessen `false` auf SPIELKISTE.
 */
declare const options: {
	readonly perOutputVirtualDesktops: boolean;
};

/**
 * Die `ClientAreaOption`-Werte liegen flach als Zahlen auf `KWin`; ein
 * geschachteltes `KWin.ClientAreaOption` gibt es nicht, und `Object.keys(KWin)`
 * liefert nichts -- Namen muessen bekannt sein.
 */
declare const KWin: {
	/** 2. Zieht das Panel ab, im Gegensatz zu `FullScreenArea`. */
	readonly MaximizeArea: number;
};

/**
 * Der einzige Weg zu einer Verzoegerung: `setTimeout` gibt es nicht.
 * `restart()` ebenfalls nicht (gemessen abwesend) -- zum Neustarten `stop()`
 * und `start()`.
 */
interface QTimerInstance {
	interval: number;
	singleShot: boolean;
	readonly active: boolean;
	readonly timeout: Signal0;
	start(): void;
	stop(): void;
}

declare const QTimer: { new (): QTimerInstance };
