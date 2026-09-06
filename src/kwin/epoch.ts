import type { Rect } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import type { Registry } from "../state/registry.ts";
import { getWindow } from "../state/registry.ts";
import type { GeometryController } from "./apply.ts";
import { anchorInto, judgePlace, judgeWrite } from "./geometry.ts";
import type { ArrangePlan, Gaps, Placement, SurfacePlan } from "./plan.ts";
import { planArrangement } from "./plan.ts";
import type { Snapshot, WindowInfo } from "./types.ts";

export interface EpochPorts {
	raise(id: WindowId): void;
	log(message: string): void;
	/**
	 * Zeile, die nur bei `debug=true` erscheint. Sie ist ein eigener Port und
	 * nicht `log`, weil die Diagnose je Surface sonst das Journal jeder
	 * Produktionsinstanz mit ganzen Fensterlisten füllte.
	 */
	debug(message: string): void;
}

export interface EpochResult {
	plan: ArrangePlan;
	participants: Set<WindowId>;
}

function fmt(rect: Rect): string {
	return `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
}

function participantsOf(plan: ArrangePlan): Set<WindowId> {
	const participants = new Set<WindowId>();
	for (const surface of plan.surfaces) {
		for (const id of surface.participants) {
			participants.add(id);
		}
	}
	return participants;
}

function applyPlacement(
	placement: Placement,
	infos: Map<WindowId, WindowInfo>,
	registry: Registry,
	geometry: GeometryController,
): void {
	const info = infos.get(placement.id);
	if (info === undefined) {
		return;
	}
	const verdict = judgeWrite(info, placement.rect, getWindow(registry, placement.id));
	if (verdict === "unchanged") {
		geometry.accept(placement.id, info.frameGeometry);
		return;
	}
	if (verdict === "write") {
		geometry.apply(placement.id, placement.rect);
	}
}

/**
 * Reihenfolge, Layout-Teilnahme und Float-Markierung einer Surface.
 *
 * Diese drei Angaben stehen in der Registry, nicht am KWin-Fenster: eine
 * lesende Probe kann sie nicht messen, und ohne sie sind der Zustandsverlust
 * über einen Reload, getrennte Stapelreihenfolgen je Ausgabe und die
 * Zuordnung Fenster zu Zelle nur plausibel, nicht belegt.
 */
function logDiagnosis(surface: SurfacePlan, registry: Registry, ports: EpochPorts): void {
	const floating: WindowId[] = [];
	for (const id of surface.members) {
		if (registry.windows.get(id)?.floating === true) {
			floating.push(id);
		}
	}
	ports.debug(
		`diagnose ${surface.key} order=${surface.members.join(",")} ` +
			`teilnehmer=${surface.participants.join(",")} float=${floating.join(",")}`,
	);
}

/** Vollzieht eine Float-Wiederherstellung, sobald der Sonderzustand beendet ist. */
function restorePendingFloats(
	surface: SurfacePlan,
	infos: Map<WindowId, WindowInfo>,
	registry: Registry,
	geometry: GeometryController,
): void {
	for (const id of surface.members) {
		const info = infos.get(id);
		const state = registry.windows.get(id);
		if (
			info === undefined ||
			state?.floating !== true ||
			!state.floatRestorePending ||
			state.floatRect === null ||
			judgePlace(info) !== "place"
		) {
			continue;
		}
		if (geometry.place(id, anchorInto(state.floatRect, surface.area))) {
			state.floatRestorePending = false;
		}
	}
}

/**
 * Rechnet und vollzieht einen Anordnungslauf auf einer fertigen Momentaufnahme.
 * KWin-Objekte bleiben hinter den übergebenen Ports im Adapter.
 */
export function runEpoch(
	epoch: number,
	reasons: string[],
	snapshot: Snapshot,
	registry: Registry,
	geometry: GeometryController,
	gaps: Gaps,
	excludes: Set<string>,
	previousParticipants: Set<WindowId>,
	ports: EpochPorts,
	// Die beiden Vorgabewerte stehen hinter `ports`, nicht davor: ein
	// eingeschobener Parameter bräche jeden bestehenden Aufruf, auch den im
	// Testrig.
	defaultRatio?: number,
	defaultLayoutIndex?: number,
): EpochResult {
	const plan = planArrangement(
		snapshot,
		registry,
		gaps,
		excludes,
		defaultRatio,
		defaultLayoutIndex,
	);
	const participants = participantsOf(plan);
	for (const id of previousParticipants) {
		if (!participants.has(id)) {
			geometry.forget(id);
		}
	}

	let memberCount = 0;
	let participantCount = 0;
	for (const surface of plan.surfaces) {
		memberCount += surface.members.length;
		participantCount += surface.participants.length;
	}
	ports.log(
		`arrange #${epoch} grund=${reasons.join(",")} surfaces=${plan.surfaces.length} ` +
			`mitglieder=${memberCount} teilnehmer=${participantCount}`,
	);

	const infos = new Map<WindowId, WindowInfo>();
	for (const info of snapshot.windows) {
		infos.set(info.id, info);
	}

	for (const surface of plan.surfaces) {
		if (surface.members.length === 0) {
			continue;
		}
		ports.log(
			`surface ${surface.key} layout=${surface.layoutId} ` +
				`n=${surface.participants.length} ratio=${surface.ratio} ` +
				`fläche=${fmt(surface.area)}`,
		);
		logDiagnosis(surface, registry, ports);
		restorePendingFloats(surface, infos, registry, geometry);
		for (const placement of surface.placements) {
			applyPlacement(placement, infos, registry, geometry);
		}
		for (const id of surface.raise) {
			ports.raise(id);
		}
	}

	return { plan, participants };
}
