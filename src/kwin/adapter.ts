import type { Rect } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import type { Registry } from "../state/registry.ts";
import { createRegistry, getWindow } from "../state/registry.ts";
import type { GeometryHooks, GeometryPort } from "./apply.ts";
import { createGeometryController } from "./apply.ts";
import { runEpoch } from "./epoch.ts";
import { DEFAULT_EXCLUDES, makeExcludes, participates } from "./filter.ts";
import { log } from "./log.ts";
import { NO_GAPS } from "./plan.ts";
import { purgeFromSnapshot } from "./purge.ts";
import {
	readFrameGeometry,
	readSnapshot,
	readWindow,
	windowId,
	writeFrameGeometry,
} from "./read.ts";
import { createDebouncer, createFollowUps, DEBOUNCE_MS, FOLLOW_UP_MS } from "./timer.ts";

export interface Adapter {
	start(): void;
	schedule(reason: string): void;
}

/**
 * Verdrahtet KWin mit dem Kern. Zusammen mit `read.ts` die einzige Datei, die
 * eine KWin-Global anfassen darf — alles Übrige ist reine Rechnung und läuft
 * unter `node --test`. Die Geometrieerwartung samt Nachbesserung liegt in
 * `apply.ts` und bekommt ihren Fensterzugriff von hier als Port.
 */
export function createAdapter(): Adapter {
	const registry: Registry = createRegistry();
	const excludes = makeExcludes(DEFAULT_EXCLUDES);
	const connections = new Map<WindowId, () => void>();
	/**
	 * Die einzige Stelle, über die ein KWin-Fensterobjekt nach dem Lesedurchgang
	 * noch **gelesen oder beschrieben** wird. Ein Eintrag verschwindet mit
	 * `closed` und mit dem nächsten Abgleich; danach meldet der Port das Fenster
	 * als fort, statt an einem toten Objekt zu lesen. Die Trennfunktionen in
	 * `connections` halten das Objekt zwar auch in ihrer Closure, rufen daran
	 * aber nur `disconnect` — und fangen den Wurf am toten Objekt ab.
	 */
	const handles = new Map<WindowId, KwinWindow>();
	/** Wer beim letzten Lauf ein Layoutrechteck bekommen hat. */
	let lastParticipants = new Set<WindowId>();
	let epoch = 0;

	const debouncer = createDebouncer(() => new QTimer(), DEBOUNCE_MS, runArrange);
	/**
	 * Nach einer Ausgabenänderung ist `clientArea` noch nicht fertig
	 * (docs/research.md Abschnitt 3.3); nach einer reinen Panelhöhenänderung
	 * war sie dagegen schon im entprellten Lauf neu, dort sichert der Nachlauf
	 * nur ab. Er meldet immer nur beim Entpreller an -- nie `runArrange`
	 * direkt, sonst liefe er an der Koaleszierung vorbei.
	 *
	 * Der Grund trägt die Quellen mit: fünf verschiedene Auslöser starten
	 * dieselben zwei Timer (dockGeometrie, dockEntfernt, dockHinzugefügt,
	 * screensChanged, screenGeometry), und ohne sie wäre im Journal nicht zu
	 * sehen, welcher es war.
	 */
	const followUps = createFollowUps(
		() => new QTimer(),
		FOLLOW_UP_MS,
		(delay, quellen) => {
			debouncer.schedule(`nachlauf${delay}:${quellen.join("+")}`);
		},
	);

	const port: GeometryPort = {
		read(id: WindowId): Rect | null {
			const window = handles.get(id);
			return window === undefined ? null : readFrameGeometry(window);
		},
		write(id: WindowId, rect: Rect): boolean {
			const window = handles.get(id);
			if (window === undefined) {
				return false;
			}
			writeFrameGeometry(window, rect);
			return true;
		},
		dragging(id: WindowId): boolean {
			const window = handles.get(id);
			return window !== undefined && (window.move || window.resize);
		},
		blocked(id: WindowId): boolean {
			const window = handles.get(id);
			if (window === undefined) {
				return true;
			}
			return !participates(readWindow(window), getWindow(registry, id).floating);
		},
	};

	const hooks: GeometryHooks = {
		external(id: WindowId): void {
			// Nur ein zuletzt bekannter Layout-Teilnehmer ist einen Lauf wert.
			// Ausgeschlossene und nicht teilnehmende Fenster fallen still durch.
			// Ein Dock kommt hier ohnehin nie an: es steht weder in `handles`
			// noch in der Registry und hängt an einem eigenen Signalsatz.
			if (!lastParticipants.has(id)) {
				return;
			}
			log(`extern ${id}`);
			debouncer.schedule("geometrieExtern");
		},
		log,
	};

	const geometry = createGeometryController(registry, port, () => new QTimer(), hooks);

	function disconnectWindow(id: WindowId): void {
		const cut = connections.get(id);
		connections.delete(id);
		handles.delete(id);
		geometry.forget(id);
		if (cut === undefined) {
			return;
		}
		try {
			cut();
		} catch (error) {
			// Das Objekt kann Qt-seitig schon fort sein. Der Eintrag ist raus,
			// mehr ist hier nicht zu retten.
			log(`Trennen fehlgeschlagen für ${id}: ${String(error)}`);
		}
	}

	/**
	 * Ein Dock bekommt einen eigenen, schmalen Signalsatz. Es ist gemessen
	 * `managed` und liefe sonst durch `connectWindow` in den vollen Satz --
	 * sein `frameGeometryChanged` landete in `geometry.notifyChanged` und
	 * versandete dort mangels Registry-Eintrag, statt eine Anordnung
	 * auszulösen. Es kommt auch **nicht** in `handles`: der Geometrieport soll
	 * es gar nicht erreichen können.
	 */
	function connectDock(window: KwinWindow, id: WindowId): void {
		const onDockChanged = (): void => {
			log(`dockGeometrie ${id}`);
			debouncer.schedule("dockGeometrie");
			followUps.trigger("dockGeometrie");
		};
		const onDockClosed = (): void => {
			// Wie bei den verwalteten Fenstern: die Id kommt aus dieser
			// Closure, das sterbende Objekt wird nicht angefasst. Ein Panel
			// kehrt nach einem Hotplug als **neues** Fenster zurück
			// (docs/research.md Abschnitt 3.4), `windowAdded` verbindet es.
			log(`dockEntfernt ${id}`);
			disconnectWindow(id);
			debouncer.schedule("dockEntfernt");
			followUps.trigger("dockEntfernt");
		};

		window.frameGeometryChanged.connect(onDockChanged);
		window.outputChanged.connect(onDockChanged);
		window.closed.connect(onDockClosed);

		connections.set(id, () => {
			window.frameGeometryChanged.disconnect(onDockChanged);
			window.outputChanged.disconnect(onDockChanged);
			window.closed.disconnect(onDockClosed);
		});
	}

	function connectWindow(window: KwinWindow): void {
		if (!window.managed || window.deleted) {
			return;
		}
		const id = windowId(window);
		if (window.dock) {
			if (!connections.has(id)) {
				connectDock(window, id);
			}
			return;
		}
		handles.set(id, window);
		if (connections.has(id)) {
			return;
		}

		const onGeometry = (): void => {
			geometry.notifyChanged(id);
		};
		const onChanged = (): void => {
			debouncer.schedule("fensterzustand");
		};
		const onDragFinished = (): void => {
			debouncer.schedule("moveResizeFinished");
		};
		const onClosed = (): void => {
			// Keine Eigenschaft des sterbenden Objekts lesen — die Id steht
			// in dieser Closure (Tessera `driver.ts:239-258`, MIT).
			disconnectWindow(id);
			debouncer.schedule("closed");
		};

		window.frameGeometryChanged.connect(onGeometry);
		window.outputChanged.connect(onChanged);
		window.desktopsChanged.connect(onChanged);
		window.activitiesChanged.connect(onChanged);
		window.minimizedChanged.connect(onChanged);
		window.fullScreenChanged.connect(onChanged);
		window.maximizedChanged.connect(onChanged);
		window.interactiveMoveResizeFinished.connect(onDragFinished);
		window.closed.connect(onClosed);

		connections.set(id, () => {
			window.frameGeometryChanged.disconnect(onGeometry);
			window.outputChanged.disconnect(onChanged);
			window.desktopsChanged.disconnect(onChanged);
			window.activitiesChanged.disconnect(onChanged);
			window.minimizedChanged.disconnect(onChanged);
			window.fullScreenChanged.disconnect(onChanged);
			window.maximizedChanged.disconnect(onChanged);
			window.interactiveMoveResizeFinished.disconnect(onDragFinished);
			window.closed.disconnect(onClosed);
		});
	}

	/** Verbindungen und Handles zu Fenstern kappen, die nicht mehr da sind. */
	function pruneConnections(live: Set<WindowId>): void {
		for (const id of Array.from(connections.keys())) {
			if (!live.has(id)) {
				disconnectWindow(id);
			}
		}
		for (const id of Array.from(handles.keys())) {
			if (!live.has(id)) {
				handles.delete(id);
				geometry.forget(id);
			}
		}
	}

	function runArrange(reasons: string[]): void {
		epoch += 1;
		const reading = readSnapshot();

		const live = new Set<WindowId>();
		for (const info of reading.snapshot.windows) {
			live.add(info.id);
		}
		// Die Epoche steht mit in der Zeile: der GC läuft vor der
		// `arrange`-Zeile, sonst wäre im Journal nicht zu sehen, zu welchem
		// Lauf er gehört.
		const purged = purgeFromSnapshot(registry, reading.snapshot);
		if (purged.skippedSurfaces) {
			log(`gc #${epoch} übersprungen: Snapshot ohne gültige Activities oder Desktops`);
		}
		if (purged.windows.length > 0 || purged.surfaces.length > 0) {
			log(`gc #${epoch} fenster=${purged.windows.length} surfaces=${purged.surfaces.length}`);
			for (const key of purged.surfaces) {
				log(`surface entfernt ${key}`);
			}
		}
		pruneConnections(live);
		for (const info of reading.snapshot.windows) {
			if (info.dock) {
				continue;
			}
			const window = reading.handles.get(info.id);
			if (window !== undefined) {
				handles.set(info.id, window);
			}
		}

		const result = runEpoch(
			epoch,
			reasons,
			reading.snapshot,
			registry,
			geometry,
			NO_GAPS,
			excludes,
			lastParticipants,
			{
				raise(id: WindowId): void {
					const window = handles.get(id);
					if (window !== undefined) {
						workspace.raiseWindow(window);
					}
				},
				log,
			},
		);
		lastParticipants = result.participants;
	}

	function start(): void {
		workspace.windowAdded.connect((window) => {
			if (window !== null) {
				connectWindow(window);
				// Ein Panel erscheint beim Login nach dem Controller und ändert
				// die Arbeitsfläche, ohne dass zwingend ein Geometriesignal
				// folgt. Der Abbau hing schon an `onDockClosed`, der Aufbau
				// fehlte. Die eigene Zeile ist der einzige Weg, diesen Zweig
				// im Journal von `dockGeometrie` zu unterscheiden.
				if (window.dock) {
					log(`dockHinzugefügt ${windowId(window)}`);
					followUps.trigger("dockHinzugefügt");
				}
			}
			debouncer.schedule("windowAdded");
		});
		workspace.windowRemoved.connect(() => {
			// Nichts am toten Objekt lesen; das Trennen erledigen `closed` und
			// `pruneConnections` im nächsten Durchlauf.
			debouncer.schedule("windowRemoved");
		});
		workspace.windowActivated.connect(() => {
			debouncer.schedule("windowActivated");
		});
		workspace.currentDesktopChanged.connect(() => {
			debouncer.schedule("desktopChanged");
		});
		workspace.currentActivityChanged.connect(() => {
			debouncer.schedule("activityChanged");
		});
		// Anlegen und Entfernen, nicht der Wechsel (docs/research.md 3.1).
		// Ohne diese beiden liefe der Registry-GC erst beim nächsten
		// Fensterereignis.
		workspace.activitiesChanged.connect(() => {
			debouncer.schedule("activitiesChanged");
		});
		workspace.desktopsChanged.connect(() => {
			debouncer.schedule("desktopsChanged");
		});
		// `screensChanged` kommt in der Hotplug-Folge zuletzt, die Flächen
		// sind zu dem Zeitpunkt aber noch nicht fertig -- deshalb die
		// Nachläufe.
		workspace.screensChanged.connect(() => {
			debouncer.schedule("screensChanged");
			followUps.trigger("screensChanged");
		});
		workspace.virtualScreenGeometryChanged.connect(() => {
			debouncer.schedule("screenGeometry");
			followUps.trigger("screenGeometry");
		});

		const list = workspace.windowList();
		for (let i = 0; i < list.length; i++) {
			const window = list[i];
			if (window !== undefined) {
				connectWindow(window);
			}
		}

		// Steuert kein Verhalten -- `currentDesktopForScreen` mit Fallback deckt
		// beide Fälle ab --, aber ohne die Zeile ist ein Journalauszug später
		// nicht deutbar.
		log(`bereit perOutputDesktops=${String(options.perOutputVirtualDesktops)}`);
		runArrange(["start"]);
	}

	return { start, schedule: debouncer.schedule };
}
