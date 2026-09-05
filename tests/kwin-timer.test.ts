import assert from "node:assert/strict";
import { test } from "node:test";

import { createDebouncer, createFollowUps } from "../src/kwin/timer.ts";
import type { FakeTimer } from "./support/kwinfake.ts";
import { fakeTimer } from "./support/kwinfake.ts";
import { must } from "./support/props.ts";

test("mehrere Ausloeser innerhalb des Fensters ergeben einen Lauf", () => {
	const timer = fakeTimer();
	let laeufe = 0;
	const debouncer = createDebouncer(
		() => timer,
		20,
		() => {
			laeufe += 1;
		},
	);

	debouncer.schedule("a");
	debouncer.schedule("b");
	debouncer.schedule("c");
	assert.equal(laeufe, 0, "vor dem Ablauf passiert nichts");

	timer.fire();
	assert.equal(laeufe, 1);
});

test("der Timer wird waehrend eines offenen Fensters nicht neu gestartet", () => {
	// Ein Neustart je Ereignis wuerde die Anordnung waehrend eines
	// Ereignisstroms beliebig lange verschieben.
	const timer = fakeTimer();
	const debouncer = createDebouncer(
		() => timer,
		20,
		() => {},
	);

	debouncer.schedule("a");
	debouncer.schedule("b");
	debouncer.schedule("c");
	assert.equal(timer.starts(), 1);
});

test("die Gruende werden gesammelt und entdoppelt", () => {
	const timer = fakeTimer();
	let gesehen: string[] = [];
	const debouncer = createDebouncer(
		() => timer,
		20,
		(reasons) => {
			gesehen = reasons;
		},
	);

	debouncer.schedule("windowAdded");
	debouncer.schedule("windowActivated");
	debouncer.schedule("windowAdded");
	timer.fire();

	assert.deepEqual(gesehen, ["windowAdded", "windowActivated"]);
});

test("ein Ausloeser waehrend des Laufs zieht genau einen zweiten Lauf nach", () => {
	// Ereignisse werden nicht verworfen, sondern als "dirty" nachgezogen.
	const timer = fakeTimer();
	let laeufe = 0;
	let debouncer = { schedule: (_: string) => {}, pending: () => false };
	debouncer = createDebouncer(
		() => timer,
		20,
		() => {
			laeufe += 1;
			if (laeufe === 1) {
				debouncer.schedule("waehrenddessen");
			}
		},
	);

	debouncer.schedule("start");
	timer.fire();
	assert.equal(laeufe, 1);
	assert.equal(timer.active, true, "der Nachlauf ist eingeplant");

	timer.fire();
	assert.equal(laeufe, 2);
	assert.equal(timer.active, false, "danach ist Ruhe");
});

test("der nachgezogene Lauf sieht den Grund von waehrend des Laufs", () => {
	const timer = fakeTimer();
	const batches: string[][] = [];
	let debouncer = { schedule: (_: string) => {}, pending: () => false };
	debouncer = createDebouncer(
		() => timer,
		20,
		(reasons) => {
			batches.push(reasons);
			if (batches.length === 1) {
				debouncer.schedule("spaet");
			}
		},
	);

	debouncer.schedule("frueh");
	timer.fire();
	timer.fire();

	assert.deepEqual(batches, [["frueh"], ["spaet"]]);
});

test("eine Ausnahme im Lauf blockiert den naechsten Lauf nicht", () => {
	const timer = fakeTimer();
	let laeufe = 0;
	const debouncer = createDebouncer(
		() => timer,
		20,
		() => {
			laeufe += 1;
			if (laeufe === 1) {
				throw new Error("Anordnung kaputt");
			}
		},
	);

	debouncer.schedule("a");
	timer.fire();
	assert.equal(laeufe, 1);

	debouncer.schedule("b");
	timer.fire();
	assert.equal(laeufe, 2, "das laufend-Flag haengt nicht");
});

test("der Debouncer stellt den Timer auf Einmalbetrieb ein", () => {
	const timer = fakeTimer();
	createDebouncer(
		() => timer,
		20,
		() => {},
	);
	assert.equal(timer.singleShot, true);
	assert.equal(timer.interval, 20);
});

test("pending meldet einen offenen Lauf", () => {
	const timer = fakeTimer();
	const debouncer = createDebouncer(
		() => timer,
		20,
		() => {},
	);
	assert.equal(debouncer.pending(), false);
	debouncer.schedule("a");
	assert.equal(debouncer.pending(), true);
	timer.fire();
	assert.equal(debouncer.pending(), false);
});

// --- Nachlaeufe ---------------------------------------------------------

/** Eine Fabrik, die der Reihe nach die uebergebenen Fake-Timer ausgibt. */
function reihe(timers: FakeTimer[]): () => FakeTimer {
	let i = 0;
	return () => {
		const timer = timers[i];
		i += 1;
		if (timer === undefined) {
			throw new Error("mehr Timer angefordert als bereitgestellt");
		}
		return timer;
	};
}

test("ein Ausloeser startet jeden Nachlauf", () => {
	const timers = [fakeTimer(), fakeTimer()];
	const followUps = createFollowUps(reihe(timers), [500, 1500], () => {});

	assert.equal(followUps.running(), 0);
	followUps.trigger("screensChanged");

	assert.equal(followUps.running(), 2);
	assert.deepEqual(
		timers.map((t) => t.interval),
		[500, 1500],
	);
});

test("ein zweiter Ausloeser setzt die Nachlaeufe zurueck statt sie zu verdoppeln", () => {
	// Anders als beim Entpreller ist der Neustart hier gewollt: nach einem
	// zweiten Ereignis zaehlt die Frist ab dem zweiten. `restart()` gibt es
	// nicht, deshalb muss auf jeden Start ein `stop()` gefolgt sein.
	const timers = [fakeTimer(), fakeTimer()];
	const followUps = createFollowUps(reihe(timers), [500, 1500], () => {});

	followUps.trigger("screensChanged");
	followUps.trigger("screenGeometry");

	assert.equal(followUps.running(), 2);
	assert.deepEqual(
		timers.map((t) => t.starts()),
		[2, 2],
	);
});

test("cancel haelt alle Nachlaeufe an", () => {
	const timers = [fakeTimer(), fakeTimer()];
	const followUps = createFollowUps(reihe(timers), [500, 1500], () => {});

	followUps.trigger("screensChanged");
	followUps.cancel();

	assert.equal(followUps.running(), 0);
});

test("jeder Nachlauf haelt seinen Timer selbst an", () => {
	// Gemessen ist nur, dass `singleShot` existiert und `false` meldet -- nicht,
	// dass die Zuweisung durchschlaegt. Ein Timer, bei dem sie es nicht tut,
	// muss trotzdem zur Ruhe kommen.
	const timers = [fakeTimer(), fakeTimer()];
	for (const timer of timers) {
		timer.setRepeating(true);
	}
	const followUps = createFollowUps(reihe(timers), [500, 1500], () => {});

	followUps.trigger("screensChanged");
	const erster = must(timers[0], "erster Timer");
	erster.fire();

	assert.equal(erster.active, false);
	assert.equal(followUps.running(), 1, "der zweite laeuft weiter");
});

test("ein Nachlauf meldet beim Entpreller an, statt selbst anzuordnen", () => {
	// Ein Nachlauf, der direkt anordnete, liefe an der Koaleszierung vorbei.
	const nachlaeufe = [fakeTimer(), fakeTimer()];
	const entpreller = fakeTimer();
	let laeufe = 0;
	let gruende: string[] = [];
	const debouncer = createDebouncer(
		() => entpreller,
		20,
		(reasons) => {
			laeufe += 1;
			gruende = reasons;
		},
	);
	const followUps = createFollowUps(reihe(nachlaeufe), [500, 1500], (delay, quellen) => {
		debouncer.schedule(`nachlauf${delay}:${quellen.join("+")}`);
	});

	followUps.trigger("dockGeometrie");
	must(nachlaeufe[0], "erster Nachlauf").fire();
	must(nachlaeufe[1], "zweiter Nachlauf").fire();

	assert.equal(laeufe, 0, "vor dem Entprellfenster passiert nichts");
	entpreller.fire();
	assert.equal(laeufe, 1, "beide Nachlaeufe ergeben einen Lauf");
	assert.deepEqual(gruende, ["nachlauf500:dockGeometrie", "nachlauf1500:dockGeometrie"]);
});

test("ein Fehler im Nachlauf reisst den zweiten nicht mit", () => {
	const timers = [fakeTimer(), fakeTimer()];
	let zweiter = 0;
	const followUps = createFollowUps(reihe(timers), [500, 1500], (delay) => {
		if (delay === 500) {
			throw new Error("Nachlauf kaputt");
		}
		zweiter += 1;
	});

	followUps.trigger("screensChanged");
	must(timers[0], "erster Timer").fire();
	must(timers[1], "zweiter Timer").fire();

	assert.equal(zweiter, 1);
});

test("die Quellen mehrerer Auslöser werden gesammelt, nicht ersetzt", () => {
	// „Letzter Auslöser gewinnt" hätte die Abnahme unbrauchbar gemacht: folgt
	// auf `dockHinzugefügt` noch ein `dockGeometrie`, wäre die gesuchte Quelle
	// aus dem Journal verschwunden.
	const timers = [fakeTimer(), fakeTimer()];
	const gesehen: string[][] = [];
	const followUps = createFollowUps(reihe(timers), [500, 1500], (_delay, quellen) => {
		gesehen.push(quellen);
	});

	followUps.trigger("dockHinzugefügt");
	followUps.trigger("dockGeometrie");
	must(timers[0], "erster Timer").fire();
	must(timers[1], "zweiter Timer").fire();

	assert.deepEqual(gesehen, [
		["dockHinzugefügt", "dockGeometrie"],
		["dockHinzugefügt", "dockGeometrie"],
	]);
});

test("der letzte Nachlauf leert den Quellensatz", () => {
	// Sonst schleppte eine Runde ihre Quellen in die nächste und der Grund im
	// Journal wüchse endlos.
	const timers = [fakeTimer(), fakeTimer()];
	const gesehen: string[][] = [];
	const followUps = createFollowUps(reihe(timers), [500, 1500], (_delay, quellen) => {
		gesehen.push(quellen);
	});

	followUps.trigger("dockHinzugefügt");
	must(timers[0], "erster Timer").fire();
	must(timers[1], "zweiter Timer").fire();

	followUps.trigger("screensChanged");
	must(timers[0], "erster Timer").fire();

	assert.deepEqual(gesehen, [["dockHinzugefügt"], ["dockHinzugefügt"], ["screensChanged"]]);
});

test("cancel leert den Quellensatz mit", () => {
	const timers = [fakeTimer(), fakeTimer()];
	const gesehen: string[][] = [];
	const followUps = createFollowUps(reihe(timers), [500, 1500], (_delay, quellen) => {
		gesehen.push(quellen);
	});

	followUps.trigger("dockEntfernt");
	followUps.cancel();
	followUps.trigger("screenGeometry");
	must(timers[0], "erster Timer").fire();

	assert.deepEqual(gesehen, [["screenGeometry"]]);
});
