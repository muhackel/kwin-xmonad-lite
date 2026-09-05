import assert from "node:assert/strict";
import { test } from "node:test";

import { createDebouncer } from "../src/kwin/timer.ts";
import { fakeTimer } from "./support/kwinfake.ts";

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
