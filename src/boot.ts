import type { Adapter } from "./kwin/adapter.ts";
import { createAdapter } from "./kwin/adapter.ts";
import { log } from "./kwin/log.ts";

export const VERSION = "0.0.0";

/** Solange kactivitymanagerd nicht geantwortet hat, meldet KWin diese UUID. */
const NULL_UUID = "00000000-0000-0000-0000-000000000000";
const RETRY_MS = 100;
const MAX_TRIES = 20;

function activitiesReady(): boolean {
	const list = workspace.activities;
	if (list.length === 0) {
		return false;
	}
	for (let i = 0; i < list.length; i++) {
		if (list[i] === NULL_UUID) {
			return false;
		}
	}
	return true;
}

export function boot(extend?: (adapter: Adapter) => void): void {
	// Der Timer bleibt in der Closure referenziert. Ein unreferenzierter Timer
	// feuerte in der Feature-Probe zwar auch, aber das war ein einzelner
	// Datenpunkt ohne erzwungenen GC-Lauf.
	const retry = new QTimer();
	let tries = 0;
	let started = false;

	function tryStart(): void {
		// Gemessen ist nur, dass `singleShot` existiert, nicht dass die Zuweisung
		// wirkt. Deshalb hält der Timer sich selbst an. Die Startsperre verhindert
		// doppelte Signalverbindungen.
		retry.stop();
		if (started) {
			return;
		}
		tries += 1;
		const ready = activitiesReady();

		if (!ready && tries < MAX_TRIES) {
			retry.start();
			return;
		}
		started = true;
		if (ready) {
			log(
				`bereit nach ${tries} Versuch(en), activities=${workspace.activities.length} ` +
					`outputs=${workspace.screens.length}`,
			);
		} else {
			// Lieber mit unvollständigen Activities anordnen als stumm bleiben:
			// ein Fehler in der Erkennung würde sonst das ganze Skript abschalten
			// (Idee Tessera `controller/index.ts:213-233`, MIT). Die Obergrenze
			// von 20 Versuchen à 100 ms steht in PLAN.md Abschnitt 4, Punkt 7.
			log(`Activities nach ${tries} Versuchen nicht bereit, starte trotzdem`);
		}
		const adapter = createAdapter();
		extend?.(adapter);
		adapter.start();
	}

	log(`geladen, Version ${VERSION}`);
	retry.singleShot = true;
	retry.interval = RETRY_MS;
	retry.timeout.connect(tryStart);
	tryStart();
}
