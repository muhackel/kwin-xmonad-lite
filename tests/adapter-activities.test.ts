import assert from "node:assert/strict";
import { test } from "node:test";

import { surfaceKey } from "../src/core/surface.ts";
import { adapterRig, rigFenster } from "./support/adapterrig.ts";
import { ACTIVITY, DESKTOP, OUTPUT } from "./support/kwinfake.ts";

const ACTIVITY_B = "activity-b";

function key(activity: string): string {
	return surfaceKey({ activity, desktop: DESKTOP, output: OUTPUT });
}

function arrangeCount(logs: string[]): number {
	return logs.filter((line) => line.includes("arrange #")).length;
}

function lastDiagnosis(logs: string[], activity: string): string {
	const prefix = `diagnose ${key(activity)} `;
	for (let i = logs.length - 1; i >= 0; i--) {
		const line = logs[i];
		if (line?.includes(prefix)) {
			return line;
		}
	}
	throw new Error(`keine Diagnose für ${activity}`);
}

test("currentActivityChanged wird entprellt und liest danach die aktuelle Activity", () => {
	const rig = adapterRig({
		fenster: [
			rigFenster("a", undefined, { activities: [ACTIVITY] }),
			rigFenster("b", undefined, { activities: [ACTIVITY_B] }),
			rigFenster("geteilt", undefined, { activities: [ACTIVITY, ACTIVITY_B] }),
		],
		config: { debug: "true", defaultLayout: "grid" },
	});
	try {
		rig.activityMenge([ACTIVITY, ACTIVITY_B]);
		rig.start();
		const beforeSignal = arrangeCount(rig.logs);

		rig.activity(ACTIVITY_B);
		rig.activitySignal("currentActivityChanged");
		assert.equal(arrangeCount(rig.logs), beforeSignal, "Signal ordnete ohne Entprellung an");
		rig.beruhigen();

		assert.equal(arrangeCount(rig.logs), beforeSignal + 1);
		const diagnosis = lastDiagnosis(rig.logs, ACTIVITY_B);
		assert.ok(diagnosis.includes("teilnehmer={geteilt},{b}"), diagnosis);
		assert.equal(diagnosis.includes("{a}"), false, diagnosis);
		assert.deepEqual(rig.aktivierungen, []);

		const writesAtRest = rig.geometrieWrites.length;
		rig.activitySignal("currentActivityChanged");
		rig.beruhigen();
		assert.equal(
			rig.geometrieWrites.length,
			writesAtRest,
			"ruhige Epoche schrieb Geometrie erneut",
		);
		assert.deepEqual(rig.aktivierungen, []);
	} finally {
		rig.dispose();
	}
});

test("window.activitiesChanged aktualisiert die Teilnehmermenge über den echten Adapter", () => {
	const rig = adapterRig({
		fenster: [
			rigFenster("anker", undefined, { activities: [ACTIVITY] }),
			rigFenster("wechsel", undefined, { activities: [ACTIVITY_B] }),
		],
		config: { debug: "true" },
	});
	try {
		rig.activityMenge([ACTIVITY, ACTIVITY_B]);
		rig.start();
		assert.ok(lastDiagnosis(rig.logs, ACTIVITY).includes("teilnehmer={anker}"));
		const beforeSignal = arrangeCount(rig.logs);

		rig.fensterActivities("wechsel", [ACTIVITY]);
		assert.equal(arrangeCount(rig.logs), beforeSignal, "Fenstersignal umging den Entpreller");
		rig.beruhigen();
		assert.ok(
			lastDiagnosis(rig.logs, ACTIVITY).includes("teilnehmer={wechsel},{anker}"),
			lastDiagnosis(rig.logs, ACTIVITY),
		);

		rig.fensterActivities("wechsel", [ACTIVITY_B]);
		rig.beruhigen();
		const afterLeaving = lastDiagnosis(rig.logs, ACTIVITY);
		assert.ok(afterLeaving.includes("teilnehmer={anker}"), afterLeaving);
		assert.equal(afterLeaving.includes("{wechsel}"), false, afterLeaving);
		assert.deepEqual(rig.aktivierungen, []);
	} finally {
		rig.dispose();
	}
});

test("workspace.activitiesChanged bereinigt nur entfernte Activities und schützt leere Listen", () => {
	const rig = adapterRig({
		fenster: [
			rigFenster("a", undefined, { activities: [ACTIVITY] }),
			rigFenster("b", undefined, { activities: [ACTIVITY_B] }),
		],
		config: { debug: "true" },
	});
	try {
		rig.activityMenge([ACTIVITY, ACTIVITY_B]);
		rig.start();
		rig.activity(ACTIVITY_B);
		rig.activitySignal("currentActivityChanged");
		rig.beruhigen();
		rig.taste("xml-next-layout");
		rig.beruhigen();
		assert.ok(rig.logs.some((line) => line.includes(`surface ${key(ACTIVITY_B)} layout=full`)));

		const removalStart = rig.logs.length;
		rig.activityMenge([ACTIVITY_B]);
		rig.activitySignal("activitiesChanged");
		rig.beruhigen();
		const removalLogs = rig.logs.slice(removalStart);
		assert.ok(removalLogs.some((line) => line.includes(`surface entfernt ${key(ACTIVITY)}`)));
		assert.equal(
			removalLogs.some((line) => line.includes(`surface entfernt ${key(ACTIVITY_B)}`)),
			false,
		);

		const emptyStart = rig.logs.length;
		rig.activityMenge([]);
		rig.activitySignal("activitiesChanged");
		rig.beruhigen();
		const emptyLogs = rig.logs.slice(emptyStart);
		assert.ok(emptyLogs.some((line) => line.includes("übersprungen")));
		assert.equal(
			emptyLogs.some((line) => line.includes("surface entfernt")),
			false,
		);

		// Nach Wiederherstellung der Ist-Menge ist der zuvor per Befehl gesetzte
		// Full-Zustand noch vorhanden: der leere Snapshot hat ihn nicht gelöscht.
		const restoreStart = rig.logs.length;
		rig.activityMenge([ACTIVITY_B]);
		rig.activitySignal("currentActivityChanged");
		rig.beruhigen();
		assert.ok(lastDiagnosis(rig.logs, ACTIVITY_B).includes("teilnehmer={b}"));
		assert.ok(
			rig.logs
				.slice(restoreStart)
				.some((line) => line.includes(`surface ${key(ACTIVITY_B)} layout=full`)),
		);

		const writesAtRest = rig.geometrieWrites.length;
		rig.activitySignal("currentActivityChanged");
		rig.beruhigen();
		assert.equal(rig.geometrieWrites.length, writesAtRest);
		assert.deepEqual(rig.aktivierungen, []);
	} finally {
		rig.dispose();
	}
});
