import assert from "node:assert/strict";
import { test } from "node:test";
import type { SurfaceState } from "../src/core/stack.ts";
import { surfaceKey } from "../src/core/surface.ts";
import type { CommandName } from "../src/kwin/command.ts";
import { runCommand } from "../src/kwin/command.ts";
import { layoutIndexOf } from "../src/kwin/config.ts";
import type { EpochResult } from "../src/kwin/epoch.ts";
import { runEpoch } from "../src/kwin/epoch.ts";
import { planArrangement } from "../src/kwin/plan.ts";
import { purgeFromSnapshot } from "../src/kwin/purge.ts";
import type { Snapshot, SurfaceView, WindowInfo } from "../src/kwin/types.ts";
import type { EpochRig } from "./support/epochrig.ts";
import { epochRig } from "./support/epochrig.ts";
import { AREA, DESKTOP, OUTPUT, snapshotOf, view, windowInfo } from "./support/kwinfake.ts";

const ACTIVITY_A = "activity-a";
const ACTIVITY_B = "activity-b";
const ACTIVITY_C = "activity-c";
const DESKTOP_2 = "desktop-2";
const ACTIVITIES_AB = [ACTIVITY_A, ACTIVITY_B];
const DESKTOPS = [DESKTOP, DESKTOP_2];

function activityView(activity: string, desktop: string = DESKTOP): SurfaceView {
	return view(OUTPUT, desktop, activity, AREA);
}

function onActivities(info: WindowInfo, activities: string[]): WindowInfo {
	info.activityIds = activities.slice();
	return info;
}

function onDesktops(info: WindowInfo, desktops: string[]): WindowInfo {
	info.desktopIds = desktops.slice();
	info.onAllDesktops = desktops.length === 0;
	return info;
}

function state(rig: EpochRig, key: string): SurfaceState {
	const found = rig.registry.surfaces.get(key);
	if (found === undefined) {
		throw new Error(`Surface fehlt: ${key}`);
	}
	return found;
}

/**
 * Kleine Hülle um die echte Epoche, aber mit ausdrücklich vorgegebenem
 * Snapshot. `epochRig.run` nutzt absichtlich `snapshotFor`; für Activity-
 * Wechsel muss die weiterhin existierende, gerade unsichtbare Activity B
 * jedoch in der vollständigen Ist-Menge bleiben.
 */
function epochRunner(rig: EpochRig): (snapshot: Snapshot, reason: string) => EpochResult {
	let epoch = 0;
	let previous = new Set<string>();
	return (snapshot: Snapshot, reason: string): EpochResult => {
		for (const info of snapshot.windows) {
			const actual = rig.port.read(info.id);
			if (actual !== null) {
				info.frameGeometry = actual;
			}
		}
		epoch += 1;
		const result = runEpoch(
			epoch,
			[reason],
			snapshot,
			rig.registry,
			rig.geometry,
			rig.config.gaps,
			rig.config.excludes,
			previous,
			{
				raise(id: string): void {
					rig.raises.push(id);
				},
				log(message: string): void {
					rig.logs.push(message);
				},
				debug(message: string): void {
					rig.debugLogs.push(message);
				},
			},
			rig.config.masterRatio,
			rig.config.layoutIndex,
		);
		previous = result.participants;
		return result;
	};
}

function command(rig: EpochRig, name: CommandName, snapshot: Snapshot): void {
	const result = runCommand(name, snapshot, rig.registry, rig.geometry, rig.config);
	assert.equal(result.arrange, true, `${name} war wirkungslos: ${result.note}`);
}

test("Matrix 6: Activities behalten getrennte Reihenfolge, Ratio und Layout einschließlich Grid", () => {
	const rig = epochRig();
	const run = epochRunner(rig);
	const viewA = activityView(ACTIVITY_A);
	const viewB = activityView(ACTIVITY_B);
	const keyA = viewA.key;
	const keyB = viewB.key;
	const windows = [
		onActivities(windowInfo("a1"), [ACTIVITY_A]),
		onActivities(windowInfo("a2"), [ACTIVITY_A]),
		onActivities(windowInfo("b1"), [ACTIVITY_B]),
		onActivities(windowInfo("b2"), [ACTIVITY_B]),
		onActivities(windowInfo("geteilt"), [ACTIVITY_A, ACTIVITY_B]),
		onActivities(windowInfo("ueberall"), []),
	];
	for (const info of windows) {
		rig.port.place(info.id, info.frameGeometry);
	}

	const snapshotA = snapshotOf([viewA], windows, "a1", ACTIVITIES_AB, [DESKTOP]);
	run(snapshotA, "activity-a-start");
	command(rig, "nextLayout", snapshotA);
	command(rig, "nextLayout", snapshotA);
	command(rig, "expand", snapshotA);
	command(rig, "swapPrev", snapshotA);
	const planA = run(snapshotA, "activity-a-geaendert").plan.surfaces[0];
	assert.equal(planA?.layoutId, "grid");
	assert.equal(state(rig, keyA).layoutIndex, layoutIndexOf("grid"));
	assert.equal(state(rig, keyA).masterRatio, 0.7);
	assert.deepEqual(state(rig, keyA).order, ["ueberall", "geteilt", "a1", "a2"]);
	assert.equal(state(rig, keyA).focus, "a1");
	const aBefore = {
		order: state(rig, keyA).order.slice(),
		focus: state(rig, keyA).focus,
		layoutIndex: state(rig, keyA).layoutIndex,
		masterRatio: state(rig, keyA).masterRatio,
	};

	// B bleibt in der vollständigen Ist-Menge schon während A sichtbar ist und
	// umgekehrt. Nur im ausdrücklichen Löschtest unten verschwindet A daraus.
	const snapshotB = snapshotOf([viewB], windows, "b1", ACTIVITIES_AB, [DESKTOP]);
	run(snapshotB, "activity-b-start");
	command(rig, "nextLayout", snapshotB);
	command(rig, "shrink", snapshotB);
	command(rig, "promote", snapshotB);
	const planB = run(snapshotB, "activity-b-geaendert").plan.surfaces[0];
	assert.equal(planB?.layoutId, "full");
	assert.equal(state(rig, keyB).masterRatio, 0.6);
	assert.deepEqual(state(rig, keyB).order, ["b1", "ueberall", "geteilt", "b2"]);
	assert.deepEqual(
		{
			order: state(rig, keyA).order,
			focus: state(rig, keyA).focus,
			layoutIndex: state(rig, keyA).layoutIndex,
			masterRatio: state(rig, keyA).masterRatio,
		},
		aBefore,
		"der Wechsel zu B verändert A nicht",
	);

	// Das gemeinsame Fenster wird in B aktiv. Die inaktive Surface A darf
	// dessen Fokus trotzdem nicht übernehmen.
	const sharedActiveB = snapshotOf([viewB], windows, "geteilt", ACTIVITIES_AB, [DESKTOP]);
	run(sharedActiveB, "shared-in-b");
	assert.equal(state(rig, keyB).focus, "geteilt");
	assert.equal(state(rig, keyA).focus, "a1");

	const backToA = snapshotOf([viewA], windows, null, ACTIVITIES_AB, [DESKTOP]);
	const returned = run(backToA, "zurueck-zu-a").plan.surfaces[0];
	assert.equal(returned?.layoutId, "grid");
	assert.deepEqual(state(rig, keyA), aBefore);
});

test("Matrix 7 und 8: Sticky-Desktop, mehrere Activities und leere Activityliste", () => {
	const rig = epochRig();
	const views = [
		activityView(ACTIVITY_A),
		activityView(ACTIVITY_A, DESKTOP_2),
		activityView(ACTIVITY_B),
		activityView(ACTIVITY_C),
	];
	const stickyDesktop = onDesktops(onActivities(windowInfo("sticky-desktop"), [ACTIVITY_A]), []);
	const sharedAB = onActivities(windowInfo("shared-ab"), [ACTIVITY_A, ACTIVITY_B]);
	const everyActivity = onActivities(windowInfo("every-activity"), []);
	const windows = [stickyDesktop, sharedAB, everyActivity];

	const plan = planArrangement(
		snapshotOf(views, windows, null, [ACTIVITY_A, ACTIVITY_B, ACTIVITY_C], DESKTOPS),
		rig.registry,
		rig.config.gaps,
		rig.config.excludes,
	);
	const members = new Map(plan.surfaces.map((surface) => [surface.key, surface.members]));

	assert.deepEqual(members.get(activityView(ACTIVITY_A).key), [
		"every-activity",
		"shared-ab",
		"sticky-desktop",
	]);
	assert.deepEqual(members.get(activityView(ACTIVITY_A, DESKTOP_2).key), ["sticky-desktop"]);
	assert.deepEqual(members.get(activityView(ACTIVITY_B).key), ["every-activity", "shared-ab"]);
	assert.deepEqual(members.get(activityView(ACTIVITY_C).key), ["every-activity"]);
});

test("Activity-GC entfernt nur gelöschte Surfaces und schützt bei leerer Ist-Menge", () => {
	const rig = epochRig();
	const run = epochRunner(rig);
	const viewA = activityView(ACTIVITY_A);
	const viewB = activityView(ACTIVITY_B);
	const a = onActivities(windowInfo("a"), [ACTIVITY_A]);
	const b = onActivities(windowInfo("b"), [ACTIVITY_B]);
	for (const info of [a, b]) {
		rig.port.place(info.id, info.frameGeometry);
	}
	run(snapshotOf([viewA], [a, b], "a", ACTIVITIES_AB, [DESKTOP]), "a");
	run(snapshotOf([viewB], [a, b], "b", ACTIVITIES_AB, [DESKTOP]), "b");

	const removed = purgeFromSnapshot(
		rig.registry,
		snapshotOf([viewB], [a, b], "b", [ACTIVITY_B], [DESKTOP]),
	);
	assert.deepEqual(removed.surfaces, [viewA.key]);
	assert.equal(rig.registry.surfaces.has(viewA.key), false);
	assert.equal(rig.registry.surfaces.has(viewB.key), true);

	const protectedResult = purgeFromSnapshot(
		rig.registry,
		snapshotOf([viewB], [a, b], "b", [], [DESKTOP]),
	);
	assert.equal(protectedResult.skippedSurfaces, true);
	assert.deepEqual(protectedResult.surfaces, []);
	assert.equal(rig.registry.surfaces.has(viewB.key), true);
	assert.equal(surfaceKey({ activity: ACTIVITY_B, desktop: DESKTOP, output: OUTPUT }), viewB.key);
});
