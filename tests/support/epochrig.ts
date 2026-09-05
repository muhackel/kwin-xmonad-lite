import type { WindowId } from "../../src/core/stack.ts";
import type { GeometryController } from "../../src/kwin/apply.ts";
import { createGeometryController } from "../../src/kwin/apply.ts";
import type { EpochResult } from "../../src/kwin/epoch.ts";
import { runEpoch } from "../../src/kwin/epoch.ts";
import { DEFAULT_EXCLUDES, makeExcludes } from "../../src/kwin/filter.ts";
import { NO_GAPS } from "../../src/kwin/plan.ts";
import type { SurfaceView, WindowInfo } from "../../src/kwin/types.ts";
import type { Registry } from "../../src/state/registry.ts";
import { createRegistry } from "../../src/state/registry.ts";
import type { FakePort, FakeTimer } from "./kwinfake.ts";
import { fakePort, fakeTimer, singleView, snapshotOf } from "./kwinfake.ts";

export interface EpochRig {
	registry: Registry;
	port: FakePort;
	timer: FakeTimer;
	geometry: GeometryController;
	raises: WindowId[];
	logs: string[];
	externals: WindowId[];
	run(windows: WindowInfo[], activeId: WindowId | null, views?: SurfaceView[]): EpochResult;
}

function unique(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (!seen.has(value)) {
			seen.add(value);
			result.push(value);
		}
	}
	return result;
}

export function epochRig(): EpochRig {
	const registry = createRegistry();
	const port = fakePort();
	const timer = fakeTimer();
	const raises: WindowId[] = [];
	const logs: string[] = [];
	const externals: WindowId[] = [];
	let previous = new Set<WindowId>();
	let epoch = 0;
	const geometry = createGeometryController(registry, port, () => timer, {
		external(id: WindowId): void {
			if (previous.has(id)) {
				externals.push(id);
			}
		},
		log(message: string): void {
			logs.push(message);
		},
	});

	return {
		registry,
		port,
		timer,
		geometry,
		raises,
		logs,
		externals,
		run(
			windows: WindowInfo[],
			activeId: WindowId | null,
			views: SurfaceView[] = [singleView()],
		): EpochResult {
			for (const info of windows) {
				const actual = port.read(info.id);
				if (actual !== null) {
					info.frameGeometry = actual;
				}
			}
			const activities: string[] = [];
			const desktops: string[] = [];
			for (const view of views) {
				activities.push(view.ref.activity);
				desktops.push(view.ref.desktop);
			}
			epoch += 1;
			const result = runEpoch(
				epoch,
				["test"],
				snapshotOf(views, windows, activeId, unique(activities), unique(desktops)),
				registry,
				geometry,
				NO_GAPS,
				makeExcludes(DEFAULT_EXCLUDES),
				previous,
				{
					raise(id: WindowId): void {
						raises.push(id);
					},
					log(message: string): void {
						logs.push(message);
					},
				},
			);
			previous = result.participants;
			return result;
		},
	};
}
