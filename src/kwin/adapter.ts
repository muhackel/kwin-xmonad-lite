import type { Rect } from "../core/rect.ts";
import { equals } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import type { Registry, WindowState } from "../state/registry.ts";
import { createRegistry, getWindow, purgeWindows } from "../state/registry.ts";
import { DEFAULT_EXCLUDES, makeExcludes } from "./filter.ts";
import { judgeCorrection, judgeWrite } from "./geometry.ts";
import { log } from "./log.ts";
import type { ArrangePlan, Placement } from "./plan.ts";
import { NO_GAPS, planArrangement } from "./plan.ts";
import type { Reading } from "./read.ts";
import { readFrameGeometry, readSnapshot, windowId, writeFrameGeometry } from "./read.ts";
import { createDebouncer, DEBOUNCE_MS } from "./timer.ts";
import type { WindowInfo } from "./types.ts";

export interface Adapter {
	start(): void;
	schedule(reason: string): void;
}

function fmt(rect: Rect): string {
	return `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
}

/**
 * Verdrahtet KWin mit dem Kern. Zusammen mit `read.ts` die einzige Datei, die
 * eine KWin-Global anfassen darf — alles Uebrige ist reine Rechnung und laeuft
 * unter `node --test`.
 */
export function createAdapter(): Adapter {
	const registry: Registry = createRegistry();
	const excludes = makeExcludes(DEFAULT_EXCLUDES);
	const connections = new Map<WindowId, () => void>();
	let epoch = 0;
	/**
	 * Waehrend eines eigenen Schreibvorgangs. Auf Wayland ist eine reine
	 * Verschiebung synchron, `frameGeometryChanged` feuert also mitten im
	 * Schreiben; ohne dieses Flag liefe der Pruefpfad rekursiv an.
	 */
	let applying = false;

	const debouncer = createDebouncer(() => new QTimer(), DEBOUNCE_MS, runArrange);

	function settle(state: WindowState, actual: Rect): void {
		state.expectedRect = null;
		state.applyAttempts = 0;
		// Meilenstein 5 braucht die letzte gekachelte Geometrie fuer die
		// Rueckkehr aus dem Float; sie jetzt zu fuellen kostet nichts.
		state.tiledRect = actual;
	}

	/**
	 * Schreibt und holt sich die Bestaetigung gleich selbst: eine reine
	 * Verschiebung ist synchron und waere sonst nur ueber das eigene, gerade
	 * gesperrte Signal zu erfahren. Nur der asynchrone Fall — eine
	 * Groessenaenderung per xdg-configure — landet spaeter im Signalpfad.
	 */
	function write(id: WindowId, window: KwinWindow, target: Rect): void {
		applying = true;
		try {
			writeFrameGeometry(window, target);
		} finally {
			applying = false;
		}
		const actual = readFrameGeometry(window);
		if (equals(actual, target)) {
			settle(getWindow(registry, id), actual);
		}
	}

	function apply(id: WindowId, window: KwinWindow, target: Rect): void {
		const state = getWindow(registry, id);
		state.expectedRect = target;
		state.applyGeneration = epoch;
		state.applyAttempts = 0;
		log(`apply ${id} soll=${fmt(target)}`);
		write(id, window, target);
	}

	function onGeometryChanged(id: WindowId, window: KwinWindow): void {
		if (applying) {
			return;
		}
		if (window.move || window.resize) {
			return;
		}
		const state = getWindow(registry, id);
		const actual = readFrameGeometry(window);
		const verdict = judgeCorrection(state, epoch, actual);

		if (verdict === "settled") {
			settle(state, actual);
			return;
		}
		if (verdict === "giveup") {
			log(`aufgegeben ${id} nach ${state.applyAttempts} Versuchen, ist=${fmt(actual)}`);
			// Ohne das Loeschen beantwortet eine verspaetete Bestaetigung
			// Epochen spaeter noch diese Erwartung.
			state.expectedRect = null;
			state.applyAttempts = 0;
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
		log(`nachbessern ${id} versuch=${state.applyAttempts} ist=${fmt(actual)} soll=${fmt(target)}`);
		write(id, window, target);
	}

	function disconnectWindow(id: WindowId): void {
		const cut = connections.get(id);
		connections.delete(id);
		if (cut === undefined) {
			return;
		}
		try {
			cut();
		} catch (error) {
			// Das Objekt kann Qt-seitig schon fort sein. Der Eintrag ist raus,
			// mehr ist hier nicht zu retten.
			log(`Trennen fehlgeschlagen fuer ${id}: ${String(error)}`);
		}
	}

	function connectWindow(window: KwinWindow): void {
		if (!window.managed || window.deleted) {
			return;
		}
		const id = windowId(window);
		if (connections.has(id)) {
			return;
		}

		const onGeometry = (): void => {
			onGeometryChanged(id, window);
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

	/** Verbindungen zu Fenstern kappen, die nicht mehr in der Ist-Menge stehen. */
	function pruneConnections(live: Set<WindowId>): void {
		for (const id of Array.from(connections.keys())) {
			if (!live.has(id)) {
				disconnectWindow(id);
			}
		}
	}

	function applyPlan(plan: ArrangePlan, reading: Reading): void {
		const infos = new Map<WindowId, WindowInfo>();
		for (const info of reading.snapshot.windows) {
			infos.set(info.id, info);
		}

		for (const surface of plan.surfaces) {
			if (surface.members.length === 0) {
				continue;
			}
			log(
				`surface ${surface.key} layout=${surface.layoutId} ` +
					`n=${surface.participants.length} ratio=${surface.ratio} ` +
					`flaeche=${fmt(surface.area)}`,
			);

			for (const placement of surface.placements) {
				applyPlacement(placement, reading, infos);
			}

			if (surface.raise !== null) {
				const window = reading.handles.get(surface.raise);
				if (window !== undefined) {
					workspace.raiseWindow(window);
				}
			}
		}
	}

	function applyPlacement(
		placement: Placement,
		reading: Reading,
		infos: Map<WindowId, WindowInfo>,
	): void {
		const window = reading.handles.get(placement.id);
		const info = infos.get(placement.id);
		if (window === undefined || info === undefined) {
			return;
		}
		if (judgeWrite(info, placement.rect) !== "write") {
			return;
		}
		apply(placement.id, window, placement.rect);
	}

	function runArrange(reasons: string[]): void {
		epoch += 1;
		const reading = readSnapshot();

		const live = new Set<WindowId>();
		for (const info of reading.snapshot.windows) {
			live.add(info.id);
		}
		purgeWindows(registry, live);
		pruneConnections(live);

		const plan = planArrangement(reading.snapshot, registry, NO_GAPS, excludes);

		let members = 0;
		let participants = 0;
		for (const surface of plan.surfaces) {
			members += surface.members.length;
			participants += surface.participants.length;
		}
		log(
			`arrange #${epoch} grund=${reasons.join(",")} surfaces=${plan.surfaces.length} ` +
				`mitglieder=${members} teilnehmer=${participants}`,
		);

		applyPlan(plan, reading);
	}

	function start(): void {
		workspace.windowAdded.connect((window) => {
			if (window !== null) {
				connectWindow(window);
			}
			debouncer.schedule("windowAdded");
		});
		workspace.windowRemoved.connect(() => {
			// Nichts am toten Objekt lesen; das Trennen erledigen `closed` und
			// `pruneConnections` im naechsten Durchlauf.
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
		workspace.screensChanged.connect(() => {
			debouncer.schedule("screensChanged");
		});
		workspace.virtualScreenGeometryChanged.connect(() => {
			debouncer.schedule("screenGeometry");
		});

		const list = workspace.windowList();
		for (let i = 0; i < list.length; i++) {
			const window = list[i];
			if (window !== undefined) {
				connectWindow(window);
			}
		}

		runArrange(["start"]);
	}

	return { start, schedule: debouncer.schedule };
}
