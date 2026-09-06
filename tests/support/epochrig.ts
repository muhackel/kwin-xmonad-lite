import type { WindowId } from "../../src/core/stack.ts";
import type { GeometryController } from "../../src/kwin/apply.ts";
import { createGeometryController } from "../../src/kwin/apply.ts";
import type { Config } from "../../src/kwin/config.ts";
import { defaultConfig } from "../../src/kwin/config.ts";
import type { EpochResult } from "../../src/kwin/epoch.ts";
import { runEpoch } from "../../src/kwin/epoch.ts";
import type { SurfaceView, WindowInfo } from "../../src/kwin/types.ts";
import type { Registry } from "../../src/state/registry.ts";
import { createRegistry } from "../../src/state/registry.ts";
import type { FakePort, FakeTimer } from "./kwinfake.ts";
import { fakePort, fakeTimer, snapshotFor } from "./kwinfake.ts";

export interface EpochRig {
	registry: Registry;
	port: FakePort;
	timer: FakeTimer;
	geometry: GeometryController;
	raises: WindowId[];
	logs: string[];
	/** Zeilen des `debug`-Ports: in der Produktion nur bei `debug=true`. */
	debugLogs: string[];
	externals: WindowId[];
	/**
	 * Die wirksame Konfiguration dieses Laufs. Veränderbar: ein Test setzt
	 * `rig.config.gaps` oder `rig.config.masterRatio` und ruft danach `run`.
	 */
	config: Config;
	run(windows: WindowInfo[], activeId: WindowId | null, views?: SurfaceView[]): EpochResult;
}

export function epochRig(): EpochRig {
	const registry = createRegistry();
	const config = defaultConfig();
	const port = fakePort();
	const timer = fakeTimer();
	const raises: WindowId[] = [];
	const logs: string[] = [];
	const debugLogs: string[] = [];
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
		debugLogs,
		externals,
		config,
		run(windows: WindowInfo[], activeId: WindowId | null, views?: SurfaceView[]): EpochResult {
			for (const info of windows) {
				const actual = port.read(info.id);
				if (actual !== null) {
					info.frameGeometry = actual;
				}
			}
			epoch += 1;
			const result = runEpoch(
				epoch,
				["test"],
				snapshotFor(windows, activeId, views),
				registry,
				geometry,
				config.gaps,
				config.excludes,
				previous,
				{
					raise(id: WindowId): void {
						raises.push(id);
					},
					log(message: string): void {
						logs.push(message);
					},
					debug(message: string): void {
						debugLogs.push(message);
					},
				},
				config.masterRatio,
				config.layoutIndex,
			);
			previous = result.participants;
			return result;
		},
	};
}
