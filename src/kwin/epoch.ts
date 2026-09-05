import type { Rect } from "../core/rect.ts";
import type { WindowId } from "../core/stack.ts";
import type { Registry } from "../state/registry.ts";
import { getWindow } from "../state/registry.ts";
import type { GeometryController } from "./apply.ts";
import { judgeWrite } from "./geometry.ts";
import type { ArrangePlan, Gaps, Placement } from "./plan.ts";
import { planArrangement } from "./plan.ts";
import type { Snapshot, WindowInfo } from "./types.ts";

export interface EpochPorts {
	raise(id: WindowId): void;
	log(message: string): void;
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
): EpochResult {
	const plan = planArrangement(snapshot, registry, gaps, excludes);
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
		for (const placement of surface.placements) {
			applyPlacement(placement, infos, registry, geometry);
		}
		for (const id of surface.raise) {
			ports.raise(id);
		}
	}

	return { plan, participants };
}
