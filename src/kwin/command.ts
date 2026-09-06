import type { Rect } from "../core/rect.ts";
import type { SurfaceState, WindowId } from "../core/stack.ts";
import {
	currentLayout,
	focusMaster,
	focusNext,
	focusPrev,
	growMaster,
	nextLayout,
	promote,
	resetLayout,
	shrinkMaster,
	swapNext,
	swapPrev,
} from "../core/stack.ts";
import type { SurfaceKey } from "../core/surface.ts";
import { reconcile } from "../state/reconcile.ts";
import type { Registry } from "../state/registry.ts";
import { getSurface, putSurface } from "../state/registry.ts";
import type { GeometryController } from "./apply.ts";
import type { Config } from "./config.ts";
import { isMember, membersBySurface, surfaceKeysFor } from "./filter.ts";
import type { FloatOutcome, FloatTarget } from "./float.ts";
import { setFloat } from "./float.ts";
import type { Snapshot, SurfaceView, WindowInfo } from "./types.ts";

export type CommandName =
	| "focusNext"
	| "focusPrev"
	| "swapNext"
	| "swapPrev"
	| "focusMaster"
	| "promote"
	| "shrink"
	| "expand"
	| "sink"
	| "toggleFloat"
	| "nextLayout"
	| "resetLayout";

export interface ShortcutDef {
	name: CommandName;
	/**
	 * Ab dem ersten Release unwiderruflich. Es gibt kein
	 * `unregisterShortcut`, jede Umbenennung hinterlässt eine Leiche in
	 * `kglobalshortcutsrc` -- dort stehen bereits 35 `Krohnkite*`- und 20
	 * `Polonium*`-Zeilen.
	 */
	objectName: string;
	text: string;
	/**
	 * Nur die **Erstinstallations-Vorgabe**. `registerShortcut` ruft
	 * `KGlobalAccel::setShortcut` ohne `NoAutoloading`; ein vorhandener
	 * Eintrag in `kglobalshortcutsrc` überschreibt die hier angegebene Taste.
	 * Eine spätere Änderung wirkt auf keiner Maschine, die das Skript schon
	 * einmal geladen hat.
	 */
	keys: string;
}

/** Die zwölf Aktionen des Controllers (PLAN.md Abschnitt 7). */
export const SHORTCUTS: ShortcutDef[] = [
	{
		name: "focusNext",
		objectName: "xml-focus-next",
		text: "Fokus zum nächsten Fenster",
		keys: "Meta+J",
	},
	{
		name: "focusPrev",
		objectName: "xml-focus-prev",
		text: "Fokus zum vorigen Fenster",
		keys: "Meta+K",
	},
	{
		name: "swapNext",
		objectName: "xml-swap-next",
		text: "Fenster nach hinten tauschen",
		keys: "Meta+Shift+J",
	},
	{
		name: "swapPrev",
		objectName: "xml-swap-prev",
		text: "Fenster nach vorn tauschen",
		keys: "Meta+Shift+K",
	},
	{
		name: "focusMaster",
		objectName: "xml-focus-master",
		text: "Master fokussieren",
		keys: "Meta+M",
	},
	{
		name: "promote",
		objectName: "xml-promote",
		text: "Fenster zum Master machen",
		keys: "Meta+Return",
	},
	{
		name: "shrink",
		objectName: "xml-shrink",
		text: "Master verkleinern",
		keys: "Meta+H",
	},
	{
		name: "expand",
		objectName: "xml-expand",
		text: "Master vergrößern",
		keys: "Meta+L",
	},
	{
		name: "sink",
		objectName: "xml-sink",
		text: "Fenster wieder kacheln",
		keys: "Meta+T",
	},
	{
		name: "toggleFloat",
		objectName: "xml-toggle-float",
		text: "Fenster freistellen",
		keys: "Meta+Shift+T",
	},
	{
		name: "nextLayout",
		objectName: "xml-next-layout",
		text: "Layout wechseln",
		keys: "Meta+Space",
	},
	{
		name: "resetLayout",
		objectName: "xml-reset-layout",
		text: "Layout zurücksetzen",
		keys: "Meta+Shift+Space",
	},
];

/** Wie die Surface gefunden wurde -- steht in der Journalzeile. */
export type SurfaceVia = "aktiv" | "ausgabe" | "erste";

export interface SurfacePick {
	key: SurfaceKey;
	view: SurfaceView;
	via: SurfaceVia;
}

export interface CommandResult {
	/** Nicht-null heißt: der Adapter aktiviert dieses Fenster. */
	focus: WindowId | null;
	/** Der Adapter meldet den Entpreller an. */
	arrange: boolean;
	/** Genau eine Journalzeile, ohne Präfix. */
	note: string;
}

function windowById(snapshot: Snapshot, id: WindowId | null): WindowInfo | null {
	if (id === null) {
		return null;
	}
	for (const info of snapshot.windows) {
		if (info.id === id) {
			return info;
		}
	}
	return null;
}

function viewByKey(views: SurfaceView[], key: SurfaceKey): SurfaceView | null {
	for (const view of views) {
		if (view.key === key) {
			return view;
		}
	}
	return null;
}

/**
 * Welche Surface ein Tastendruck meint. Dreistufige Kaskade, damit ein Befehl
 * auch dann eine sinnvolle Surface trifft, wenn gerade krunner, ein Dialog
 * oder ein Panel den Fokus hält.
 *
 * Verifiziert: `readViews` baut genau **eine** View je Ausgabe, und
 * `surfaceKeysFor` filtert zuerst auf Ausgabengleichheit -- ein Fenster liegt
 * innerhalb eines Snapshots deshalb in höchstens **einer** sichtbaren
 * Surface, auch das Fenster auf allen Desktops. Der erste Schlüssel ist damit
 * der einzige.
 */
export function pickSurface(snapshot: Snapshot, excludes: Set<string>): SurfacePick | null {
	const active = windowById(snapshot, snapshot.activeId);
	if (active !== null) {
		if (isMember(active, excludes)) {
			const key = surfaceKeysFor(active, snapshot.views)[0];
			const view = key === undefined ? null : viewByKey(snapshot.views, key);
			if (key !== undefined && view !== null) {
				return { key, view, via: "aktiv" };
			}
		}
		// Nichtmitglied oder auf einem anderen Desktop: die Ausgabe des
		// aktiven Fensters ist trotzdem die, auf die der Nutzer schaut.
		for (const view of snapshot.views) {
			if (view.ref.output === active.outputName) {
				return { key: view.key, view, via: "ausgabe" };
			}
		}
	}

	const first = snapshot.views[0];
	if (first === undefined) {
		return null;
	}
	return { key: first.key, view: first, via: "erste" };
}

function isFocusCommand(name: CommandName): boolean {
	return name === "focusNext" || name === "focusPrev" || name === "focusMaster";
}

function isRatioCommand(name: CommandName): boolean {
	return name === "shrink" || name === "expand";
}

function isLayoutCommand(name: CommandName): boolean {
	return name === "nextLayout" || name === "resetLayout";
}

function reduce(name: CommandName, state: SurfaceState, config: Config): SurfaceState {
	switch (name) {
		case "focusNext":
			return focusNext(state);
		case "focusPrev":
			return focusPrev(state);
		case "focusMaster":
			return focusMaster(state);
		case "swapNext":
			return swapNext(state);
		case "swapPrev":
			return swapPrev(state);
		case "promote":
			return promote(state);
		case "shrink":
			return shrinkMaster(state);
		case "expand":
			return growMaster(state);
		case "nextLayout":
			return nextLayout(state);
		case "resetLayout":
			return resetLayout(state, config.masterRatio, config.layoutIndex);
		default:
			return state;
	}
}

/**
 * Die Arbeitsfläche für den Float-Schreibvorgang. Das aktive Fenster kann auf
 * einer anderen Ausgabe liegen als die gewählte Surface; verankert wird gegen
 * seine eigene.
 */
function areaFor(info: WindowInfo, pick: SurfacePick, views: SurfaceView[]): Rect | null {
	if (info.outputName === pick.view.ref.output) {
		return pick.view.area;
	}
	for (const view of views) {
		if (view.ref.output === info.outputName) {
			return view.area;
		}
	}
	return null;
}

/** Alles außer diesen drei Ausgängen hat den Zustand tatsächlich verändert. */
function floatChanged(outcome: FloatOutcome): boolean {
	return (
		outcome !== "keinMitglied" && outcome !== "bereitsGefloatet" && outcome !== "bereitsGekachelt"
	);
}

function head(name: CommandName, pick: SurfacePick): string {
	return `befehl ${name} surface=${pick.key} via=${pick.via}`;
}

function idle(name: CommandName, reason: string): CommandResult {
	return { focus: null, arrange: false, note: `befehl ${name} ohne Wirkung: ${reason}` };
}

/**
 * Float und Sink laufen auf dem **aktiven** Fenster, nicht auf `state.focus`:
 * die Float-Markierung ist eine globale Fenstereigenschaft, und das Modell des
 * Nutzers ist "das Fenster, das ich sehe".
 */
function runFloat(
	name: CommandName,
	snapshot: Snapshot,
	registry: Registry,
	geometry: GeometryController,
	config: Config,
	pick: SurfacePick,
): CommandResult {
	const info = windowById(snapshot, snapshot.activeId);
	if (info === null) {
		return idle(name, "kein aktives Fenster");
	}
	const target: FloatTarget = name === "sink" ? "tile" : "toggle";
	const area = areaFor(info, pick, snapshot.views);
	const outcome = setFloat(registry, geometry, info, area, config.excludes, target);
	return {
		focus: null,
		// Nicht über den `SurfaceState`: die Float-Markierung sitzt im
		// `WindowState`, `order` und `focus` bleiben unberührt. Ohne diese
		// zweite Quelle bliebe ein Fenster nach `Meta+T` bis zum nächsten
		// fremden Ereignis ungeordnet.
		arrange: floatChanged(outcome),
		note: `${head(name, pick)} fenster=${info.id} → ${outcome}`,
	};
}

/**
 * Führt einen Tastenbefehl auf der Registry aus. Rein: KWin-Objekte sieht die
 * Funktion nie, sie bekommt eine fertige Momentaufnahme und gibt zurück, was
 * der Adapter danach zu tun hat.
 */
export function runCommand(
	name: CommandName,
	snapshot: Snapshot,
	registry: Registry,
	geometry: GeometryController,
	config: Config,
): CommandResult {
	const pick = pickSurface(snapshot, config.excludes);
	if (pick === null) {
		return idle(name, "keine sichtbare Surface");
	}

	// Reconcile **vor** dem Reducer. Ein Tastendruck kann vor der entprellten
	// Epoche eintreffen; ohne den Abgleich fehlen neu erschienene Fenster im
	// gespeicherten Stapel, geschlossene stehen noch darin, und ein
	// Fokusbefehl landete auf einem Fenster, das gar nicht mehr in dieser
	// Surface ist. Der abgeglichene Zustand ist die Vergleichsbasis für
	// `arrange`.
	const members = membersBySurface(snapshot.windows, snapshot.views, config.excludes);
	const stored = getSurface(registry, pick.key, config.masterRatio, config.layoutIndex);
	const before = reconcile(stored, members.get(pick.key) ?? [], snapshot.activeId).state;
	putSurface(registry, pick.key, before);

	if (name === "sink" || name === "toggleFloat") {
		return runFloat(name, snapshot, registry, geometry, config, pick);
	}

	const next = reduce(name, before, config);
	// Auch bei Gleichstand einhängen -- dieselbe Begründung wie in `plan.ts`.
	putSurface(registry, pick.key, next);
	// Die Reducer geben bei Wirkungslosigkeit dasselbe Objekt zurück.
	const arrange = next !== before;

	let focus: WindowId | null = null;
	let detail: string;
	if (isFocusCommand(name)) {
		const wanted = next.focus;
		if (wanted === null) {
			detail = " ohne Fokusziel";
		} else if (windowById(snapshot, wanted) === null) {
			detail = ` ziel ${wanted} nicht mehr im Snapshot`;
		} else {
			focus = wanted;
			detail = ` fokus=${wanted}`;
		}
	} else if (isRatioCommand(name)) {
		detail = ` ratio=${next.masterRatio}`;
	} else if (isLayoutCommand(name)) {
		detail = ` layout=${currentLayout(next).id}`;
	} else {
		detail = ` master=${next.order[0] ?? "-"}`;
	}

	return {
		focus,
		arrange,
		note: `${head(name, pick)}${detail}${arrange ? "" : " unverändert"}`,
	};
}
