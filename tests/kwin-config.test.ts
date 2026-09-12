import assert from "node:assert/strict";
import { test } from "node:test";

import {
	clampRatio,
	LAYOUTS,
	RATIO_DEFAULT,
	RATIO_MAX,
	RATIO_MIN,
} from "../src/core/layout/index.ts";
import type { Config } from "../src/kwin/config.ts";
import {
	defaultConfig,
	EXCLUDE_SEPARATOR,
	GAP_MAX,
	layoutIndexOf,
	loadConfig,
	sortedList,
} from "../src/kwin/config.ts";
import { DEFAULT_EXCLUDES, isMember, normalizeClass } from "../src/kwin/filter.ts";
import { debugLog, format, log, setDebug } from "../src/kwin/log.ts";
import { fakeReader } from "./support/configfake.ts";
import { epochRig } from "./support/epochrig.ts";
import { FUZZ_COUNT, FUZZ_SEED, makeRng } from "./support/gen.ts";
import { AREA, windowInfo } from "./support/kwinfake.ts";
import { assertCommon, must } from "./support/props.ts";

/** Die sechs Schlüssel in derselben Reihenfolge, in der `loadConfig` liest. */
const KEYS = ["gapOuter", "gapInner", "excludes", "masterRatio", "defaultLayout", "debug"];

function withRaw(entries: Record<string, string>): Config {
	const reader = fakeReader();
	for (const key of Object.keys(entries)) {
		reader.set(key, must(entries[key], `${key} fehlt im Fall`));
	}
	return loadConfig(reader);
}

function onlyNote(config: Config): string {
	assert.equal(
		config.notes.length,
		1,
		`genau eine Notiz erwartet, war ${config.notes.join(" | ")}`,
	);
	return must(config.notes[0], "Notiz fehlt");
}

// --- Vorgaben ---------------------------------------------------------------

test("ein leerer Leser liefert genau die Vorgaben und keine Notiz", () => {
	const config = loadConfig(fakeReader());
	const expected = defaultConfig();

	assert.deepEqual(config.notes, []);
	assert.deepEqual(config.gaps, expected.gaps);
	assert.deepEqual(config.excludeList, expected.excludeList);
	assert.deepEqual(Array.from(config.excludes).sort(), Array.from(expected.excludes).sort());
	assert.equal(config.masterRatio, RATIO_DEFAULT);
	assert.equal(config.layoutIndex, 0);
	assert.equal(config.debug, false);
	assert.deepEqual(config, expected);
});

test("die Ausschlussvorgabe kommt vollständig durch", () => {
	const config = loadConfig(fakeReader());
	for (const entry of DEFAULT_EXCLUDES) {
		assert.ok(config.excludes.has(normalizeClass(entry)), `${entry} fehlt`);
	}
	assert.deepEqual(config.excludeList, sortedList(DEFAULT_EXCLUDES));
});

// --- Abstände ---------------------------------------------------------------

test("gapOuter wird gerundet, geklemmt und bei Unsinn verworfen", () => {
	assert.equal(withRaw({ gapOuter: "7.4" }).gaps.outer, 7);
	assert.equal(withRaw({ gapOuter: "8" }).gaps.outer, 8);
	assert.equal(withRaw({ gapOuter: "-5" }).gaps.outer, 0);
	assert.equal(withRaw({ gapOuter: "100000" }).gaps.outer, GAP_MAX);
	assert.equal(withRaw({ gapOuter: "abc" }).gaps.outer, 0);

	assert.deepEqual(withRaw({ gapOuter: "8" }).notes, []);
	assert.equal(onlyNote(withRaw({ gapOuter: "-5" })), "config gapOuter=-5 unzulässig, verwende 0");
	assert.equal(
		onlyNote(withRaw({ gapOuter: "100000" })),
		`config gapOuter=100000 geklemmt auf ${GAP_MAX}`,
	);
	assert.equal(onlyNote(withRaw({ gapOuter: "7.4" })), "config gapOuter=7.4 gerundet auf 7");
});

test("gapOuter=abc ist unlesbar -- der Fall, den erst der Rohstring sichtbar macht", () => {
	// Mit einem numerischen Vorgabewert hätte KConfig die 0 selbst geliefert,
	// ununterscheidbar von "nicht gesetzt", und diese Notiz wäre unmöglich.
	const config = withRaw({ gapOuter: "abc" });
	assert.equal(config.gaps.outer, 0);
	assert.equal(onlyNote(config), "config gapOuter=abc unlesbar, verwende 0");
});

test("gapInner läuft durch dieselbe Prüfung wie gapOuter", () => {
	assert.equal(withRaw({ gapInner: "4.6" }).gaps.inner, 5);
	assert.equal(withRaw({ gapInner: "-1" }).gaps.inner, 0);
	assert.equal(withRaw({ gapInner: "100000" }).gaps.inner, GAP_MAX);
	assert.equal(withRaw({ gapInner: "abc" }).gaps.inner, 0);
	assert.equal(onlyNote(withRaw({ gapInner: "abc" })), "config gapInner=abc unlesbar, verwende 0");
});

test("beide Abstände bleiben ganzzahlig", () => {
	const config = withRaw({ gapOuter: "12.5", gapInner: "3.49" });
	assert.ok(Number.isInteger(config.gaps.outer));
	assert.ok(Number.isInteger(config.gaps.inner));
	assert.equal(config.notes.length, 2, "je Schlüssel eine Zeile");
});

// --- Masteranteil -----------------------------------------------------------

test("masterRatio wird geklemmt, gerundet und bei Unsinn verworfen", () => {
	assert.equal(withRaw({ masterRatio: "0.05" }).masterRatio, RATIO_MIN);
	assert.equal(withRaw({ masterRatio: "1.5" }).masterRatio, RATIO_MAX);
	assert.equal(withRaw({ masterRatio: "0.6666" }).masterRatio, 0.67);
	assert.equal(withRaw({ masterRatio: "abc" }).masterRatio, RATIO_DEFAULT);
	assert.equal(withRaw({ masterRatio: "0.7" }).masterRatio, 0.7);
	assert.deepEqual(withRaw({ masterRatio: "0.7" }).notes, []);

	assert.equal(
		onlyNote(withRaw({ masterRatio: "0.05" })),
		`config masterRatio=0.05 geklemmt auf ${RATIO_MIN}`,
	);
	assert.equal(
		onlyNote(withRaw({ masterRatio: "1.5" })),
		`config masterRatio=1.5 geklemmt auf ${RATIO_MAX}`,
	);
	assert.equal(
		onlyNote(withRaw({ masterRatio: "0.6666" })),
		"config masterRatio=0.6666 gerundet auf 0.67",
	);
	assert.equal(
		onlyNote(withRaw({ masterRatio: "abc" })),
		`config masterRatio=abc unlesbar, verwende ${RATIO_DEFAULT}`,
	);
});

test("ein konfigurierter Masteranteil liegt auf demselben Raster wie stepRatio", () => {
	// Sonst träfe Meta+H den konfigurierten Wert nie und resetLayout ebenso
	// wenig; zwei Nachkommastellen sind das Raster von RATIO_STEP.
	for (const raw of ["0.6666", "0.123456", "0.888", "0.5000001"]) {
		const value = withRaw({ masterRatio: raw }).masterRatio;
		assert.equal(Math.round(value * 100) / 100, value, `${raw} rastert nicht`);
	}
});

// --- Layout -----------------------------------------------------------------

test("Layoutliste ist exakt tall, full, grid mit stabilen alten Indizes", () => {
	assert.deepEqual(
		LAYOUTS.map((layout) => layout.id),
		["tall", "full", "grid"],
	);
});

test("defaultLayout wird gegen LAYOUTS aufgelöst", () => {
	assert.equal(withRaw({ defaultLayout: "tall" }).layoutIndex, 0);
	assert.equal(withRaw({ defaultLayout: "full" }).layoutIndex, 1);
	assert.equal(withRaw({ defaultLayout: "grid" }).layoutIndex, 2);
	assert.deepEqual(withRaw({ defaultLayout: "full" }).notes, []);
	assert.deepEqual(withRaw({ defaultLayout: "grid" }).notes, []);
});

test("defaultLayout toleriert Groß- und Kleinschreibung", () => {
	// Bewusst tolerant: der Wert kommt aus einem von Hand gepflegten kwinrc
	// oder aus einer Nix-Zeichenkette, und alle Einträge in LAYOUTS sind
	// kleingeschrieben -- zwei Layoutnamen können deshalb nicht kollidieren.
	assert.equal(withRaw({ defaultLayout: "TALL" }).layoutIndex, 0);
	assert.equal(withRaw({ defaultLayout: " Full " }).layoutIndex, 1);
	assert.equal(withRaw({ defaultLayout: " GRID " }).layoutIndex, 2);
	assert.deepEqual(withRaw({ defaultLayout: "TALL" }).notes, []);
});

test("ein unbekanntes Layout fällt auf das erste zurück", () => {
	const config = withRaw({ defaultLayout: "spiral" });
	assert.equal(config.layoutIndex, 0);
	assert.equal(onlyNote(config), "config defaultLayout=spiral unbekannt, verwende tall");
});

// --- Debug ------------------------------------------------------------------

test("debug nimmt nur true und false", () => {
	assert.equal(withRaw({ debug: "true" }).debug, true);
	assert.equal(withRaw({ debug: "TRUE" }).debug, true);
	assert.equal(withRaw({ debug: "false" }).debug, false);
	assert.deepEqual(withRaw({ debug: "true" }).notes, []);
	assert.deepEqual(withRaw({ debug: "false" }).notes, []);

	const config = withRaw({ debug: "ja" });
	assert.equal(config.debug, false);
	assert.equal(onlyNote(config), "config debug=ja unlesbar, verwende false");
});

// --- "nicht gesetzt" gegen "leer gesetzt" ------------------------------------

test("ein nicht gesetzter Schlüssel erzeugt keine Notiz, ein leer gesetzter schon", () => {
	const reader = fakeReader();
	assert.equal(reader.raw("gapOuter"), null, "nicht gesetzt heißt null");
	assert.deepEqual(loadConfig(reader).notes, []);

	reader.set("gapOuter", "");
	assert.equal(reader.raw("gapOuter"), "", "leer gesetzt heißt leerer String");
	const config = loadConfig(reader);
	assert.equal(config.gaps.outer, 0);
	assert.equal(onlyNote(config), "config gapOuter= unlesbar, verwende 0");
});

test("auch reiner Leerraum gilt als unlesbar, nicht als Null", () => {
	// Number(" ") ist 0 und damit endlich -- ohne eigene Sperre verschwände
	// der Unterschied zu "nicht gesetzt" spurlos.
	assert.equal(withRaw({ gapInner: "   " }).notes.length, 1);
	assert.equal(withRaw({ masterRatio: " " }).masterRatio, RATIO_DEFAULT);
	assert.equal(withRaw({ masterRatio: " " }).notes.length, 1);
});

// --- Ausschlussliste --------------------------------------------------------

test("eine leer gesetzte Ausschlussliste schließt nichts aus", () => {
	const config = withRaw({ excludes: "" });
	assert.equal(config.excludes.size, 0);
	assert.deepEqual(config.excludeList, []);
	assert.equal(onlyNote(config), "config excludes leer: kein Fenster wird ausgeschlossen");

	// "Nichts ausschließen" muss erreichbar bleiben, sonst wäre plasmashell
	// nicht mitzukacheln.
	const krunner = windowInfo("k");
	krunner.resourceClass = "krunner";
	assert.equal(isMember(krunner, config.excludes), true);
	assert.equal(isMember(krunner, defaultConfig().excludes), false, "Gegenprobe zur Vorgabe");
});

test("eine Liste aus Trennern allein ist ebenfalls leer", () => {
	const config = withRaw({ excludes: " , ,, " });
	assert.equal(config.excludes.size, 0);
	assert.equal(config.notes.length, 1);
});

test("die Ausschlussliste wird normalisiert, entdoppelt und sortiert", () => {
	const config = withRaw({ excludes: " KRunner , yakuake ,, " });
	assert.deepEqual(config.excludeList, ["krunner", "yakuake"]);
	assert.deepEqual(Array.from(config.excludes).sort(), ["krunner", "yakuake"]);
	assert.deepEqual(config.notes, []);

	const doubled = withRaw({ excludes: "Yakuake,yakuake, YAKUAKE " });
	assert.deepEqual(doubled.excludeList, ["yakuake"]);
});

test("eine gesetzte Ausschlussliste ersetzt die Vorgabe, sie ergänzt sie nicht", () => {
	const config = withRaw({ excludes: `krunner${EXCLUDE_SEPARATOR}yakuake` });
	assert.equal(config.excludes.has("plasmashell"), false);
});

// --- Alles zusammen ---------------------------------------------------------

test("mehrere Fehleingaben erzeugen je eine Zeile, in Schlüsselreihenfolge", () => {
	const config = withRaw({
		gapOuter: "abc",
		masterRatio: "1.5",
		defaultLayout: "spiral",
		debug: "ja",
	});
	assert.deepEqual(config.notes, [
		"config gapOuter=abc unlesbar, verwende 0",
		`config masterRatio=1.5 geklemmt auf ${RATIO_MAX}`,
		"config defaultLayout=spiral unbekannt, verwende tall",
		"config debug=ja unlesbar, verwende false",
	]);
	assert.equal(config.gaps.outer, 0);
	assert.equal(config.masterRatio, RATIO_MAX);
	assert.equal(config.layoutIndex, 0);
	assert.equal(config.debug, false);
});

// --- Fuzz -------------------------------------------------------------------

/**
 * Rohwerte, wie sie aus einem verkorksten `kwinrc` kommen können. Die
 * Zahlenfallen stehen bewusst drin: `Number("")` und `Number(" ")` sind 0,
 * `Number("1e400")` ist Infinity, `Number("0x10")` ist 16.
 */
const RAW_POOL = [
	"",
	" ",
	"\t\n",
	"0",
	"1",
	"7",
	"7.4",
	"-0",
	"-0.4",
	"-5",
	"200",
	"201",
	"100000",
	"1e3",
	"1e400",
	"0x10",
	"Infinity",
	"-Infinity",
	"NaN",
	"abc",
	"12abc",
	"  8  ",
	"0.05",
	"0.5",
	"0.6666",
	"0.9",
	"1.5",
	"tall",
	"full",
	"TALL",
	" Full ",
	"grid",
	"spiral",
	"true",
	"false",
	"TRUE",
	"ja",
	"krunner,yakuake",
	" KRunner , yakuake ,, ",
	",,",
	"plasmashell",
	"ä,ö,ü",
	"!§$%&/()=",
];

/**
 * Werte, die unverändert durchgehen. Ohne sie träfe der Fuzz bei sechs
 * Schlüsseln praktisch nie einen Lauf ganz ohne Korrektur -- und die eine
 * Richtung der Invariante ("keine Notiz, wenn nichts zu korrigieren war")
 * bliebe ungeprüft.
 */
const VALID_POOL: Record<string, string[]> = {
	gapOuter: ["0", "4", "8", "200"],
	gapInner: ["0", "1", "12", "200"],
	excludes: ["krunner,yakuake", "plasmashell", "ä,ö,ü"],
	masterRatio: ["0.1", "0.5", "0.65", "0.7", "0.9"],
	defaultLayout: ["tall", "full", "grid", "TALL", " Full ", " GRID "],
	debug: ["true", "false", "TRUE"],
};

const JUNK_CHARS = " ,.-_0123456789abcxyzäöüßTRUE!§$%&/()";

function randomJunk(rng: () => number): string {
	const length = Math.floor(rng() * 12);
	let out = "";
	for (let i = 0; i < length; i++) {
		out += JUNK_CHARS.charAt(Math.floor(rng() * JUNK_CHARS.length));
	}
	return out;
}

/**
 * Wurde dieser Rohwert unverändert übernommen? Der Orakelteil beschränkt sich
 * auf die **Entscheidung**, nicht auf die Rechnung: nur so bleibt der Test
 * eine Prüfung und wird keine zweite Fassung von `loadConfig`.
 */
function gapAccepted(raw: string | null): boolean {
	if (raw === null) {
		return true;
	}
	if (raw.trim().length === 0) {
		return false;
	}
	const value = Number(raw);
	return Number.isFinite(value) && Math.round(value) === value && value >= 0 && value <= GAP_MAX;
}

function ratioAccepted(raw: string | null): boolean {
	if (raw === null) {
		return true;
	}
	if (raw.trim().length === 0) {
		return false;
	}
	const value = Number(raw);
	if (!Number.isFinite(value)) {
		return false;
	}
	return clampRatio(value) === value && Math.round(value * 100) / 100 === value;
}

function layoutAccepted(raw: string | null): boolean {
	return raw === null || layoutIndexOf(normalizeClass(raw)) >= 0;
}

function debugAccepted(raw: string | null): boolean {
	if (raw === null) {
		return true;
	}
	const value = normalizeClass(raw);
	return value === "true" || value === "false";
}

function excludesAccepted(raw: string | null): boolean {
	return raw === null || sortedList(raw.split(EXCLUDE_SEPARATOR)).length > 0;
}

function expectedNotes(raws: Map<string, string | null>): number {
	const accepted = [
		gapAccepted(raws.get("gapOuter") ?? null),
		gapAccepted(raws.get("gapInner") ?? null),
		excludesAccepted(raws.get("excludes") ?? null),
		ratioAccepted(raws.get("masterRatio") ?? null),
		layoutAccepted(raws.get("defaultLayout") ?? null),
		debugAccepted(raws.get("debug") ?? null),
	];
	let count = 0;
	for (const ok of accepted) {
		if (!ok) {
			count += 1;
		}
	}
	return count;
}

function describeRaws(run: number, raws: Map<string, string | null>): string {
	const parts: string[] = [];
	for (const key of KEYS) {
		const raw = raws.get(key) ?? null;
		parts.push(`${key}=${raw === null ? "<nicht gesetzt>" : JSON.stringify(raw)}`);
	}
	return `Lauf ${run} (Seed ${FUZZ_SEED}): ${parts.join(" ")}`;
}

test("Fuzz: loadConfig wirft nie und liefert immer verwendbare Werte", () => {
	const rng = makeRng(FUZZ_SEED);
	let corrected = 0;
	let clean = 0;

	for (let run = 0; run < FUZZ_COUNT; run++) {
		const raws = new Map<string, string | null>();
		const reader = fakeReader();
		const sane = rng() < 0.25;
		for (const key of KEYS) {
			let raw: string | null = null;
			if (rng() >= 0.15) {
				const pool = sane ? must(VALID_POOL[key], `kein gültiger Pool für ${key}`) : RAW_POOL;
				raw =
					!sane && rng() < 0.25
						? randomJunk(rng)
						: must(pool[Math.floor(rng() * pool.length)], "Pool leer");
				reader.set(key, raw);
			}
			raws.set(key, raw);
		}
		const where = describeRaws(run, raws);
		const config = loadConfig(reader);

		assert.ok(Number.isInteger(config.gaps.outer), `gapOuter nicht ganzzahlig -- ${where}`);
		assert.ok(Number.isInteger(config.gaps.inner), `gapInner nicht ganzzahlig -- ${where}`);
		assert.ok(
			config.gaps.outer >= 0 && config.gaps.outer <= GAP_MAX,
			`gapOuter außerhalb [0, ${GAP_MAX}] -- ${where}`,
		);
		assert.ok(
			config.gaps.inner >= 0 && config.gaps.inner <= GAP_MAX,
			`gapInner außerhalb [0, ${GAP_MAX}] -- ${where}`,
		);
		assert.ok(
			config.masterRatio >= RATIO_MIN && config.masterRatio <= RATIO_MAX,
			`masterRatio außerhalb der Grenzen -- ${where}`,
		);
		assert.ok(
			Number.isInteger(config.layoutIndex) &&
				config.layoutIndex >= 0 &&
				config.layoutIndex < LAYOUTS.length,
			`layoutIndex zeigt an keinem Layout -- ${where}`,
		);
		assert.equal(typeof config.debug, "boolean", `debug ist kein Boolean -- ${where}`);

		for (const entry of config.excludes) {
			assert.equal(entry, normalizeClass(entry), `Ausschluss nicht normalisiert -- ${where}`);
			assert.ok(entry.length > 0, `leerer Ausschluss -- ${where}`);
		}
		assert.deepEqual(
			config.excludeList,
			sortedList(config.excludeList),
			`Liste unsortiert -- ${where}`,
		);
		assert.equal(
			config.excludeList.length,
			config.excludes.size,
			`Liste und Menge weichen ab -- ${where}`,
		);

		assert.equal(
			config.notes.length,
			expectedNotes(raws),
			`Notizen: ${config.notes.join(" | ")} -- ${where}`,
		);
		if (config.notes.length > 0) {
			corrected += 1;
		} else {
			clean += 1;
		}
	}

	// Ohne diese beiden Zeilen bliebe unbemerkt, dass ein verstellter Pool nur
	// noch eine Seite der Invariante trifft und der Fuzz leerläuft.
	assert.ok(corrected > 0, `kein Lauf wurde korrigiert (Seed ${FUZZ_SEED})`);
	assert.ok(clean > 0, `kein Lauf blieb ohne Notiz (Seed ${FUZZ_SEED})`);
});

// --- Ende zu Ende -----------------------------------------------------------

test("konfigurierte Abstände tragen durch die ganze Epoche", () => {
	const config = withRaw({ gapOuter: "8", gapInner: "4" });
	assert.deepEqual(config.notes, []);

	const rig = epochRig();
	rig.config.gaps = config.gaps;
	const windows = [windowInfo("a"), windowInfo("b"), windowInfo("c")];
	for (const info of windows) {
		rig.port.place(info.id, info.frameGeometry);
	}

	const surface = must(rig.run(windows, "a").plan.surfaces[0], "keine Surface");
	assertCommon(
		surface.placements.map((placement) => placement.rect),
		{
			area: AREA,
			count: windows.length,
			ratio: config.masterRatio,
			gapOuter: config.gaps.outer,
			gapInner: config.gaps.inner,
		},
		"Epoche mit konfigurierten Abständen",
	);
});

// --- Journalausgabe ---------------------------------------------------------

function captureLog(fn: () => void): string[] {
	const lines: string[] = [];
	const original = console.log;
	console.log = (...args: unknown[]): void => {
		lines.push(args.join(" "));
	};
	try {
		fn();
	} finally {
		console.log = original;
	}
	return lines;
}

test("debugLog schweigt ohne Schalter", () => {
	setDebug(false);
	assert.deepEqual(
		captureLog(() => {
			debugLog("still");
		}),
		[],
	);
});

test("debugLog spricht mit Schalter und trägt denselben Präfix wie log", () => {
	setDebug(true);
	const lines = captureLog(() => {
		log("gewöhnlich");
		debugLog("ausführlich");
	});
	setDebug(false);

	assert.deepEqual(lines, [format("gewöhnlich"), format("ausführlich")]);
	assert.equal(must(lines[1], "Debugzeile fehlt").indexOf("kwin-xmonad-lite: "), 0);
});

test("der Schalter lässt sich wieder abstellen", () => {
	setDebug(true);
	setDebug(false);
	assert.deepEqual(
		captureLog(() => {
			debugLog("nach dem Abschalten");
		}),
		[],
	);
});
