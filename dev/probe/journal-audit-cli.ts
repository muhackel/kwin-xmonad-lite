/**
 * Kommandozeilenhülle des Journal-Auditors.
 *
 * Getrennt von der Logik, damit `tests/journal-audit.test.ts` die Prüfungen
 * importieren kann, ohne dass beim Import etwas ausgeführt wird.
 *
 *   node dev/probe/journal-audit-cli.ts <journal> [--stunde] [--provoziert id,id]
 *
 * Ohne `--stunde` prüft er nur auf Schleifen; mit `--stunde` zusätzlich die
 * Belegschwelle aus Fall 27 (Dauer, ein einziger Skriptlauf, kein Give-up,
 * Mindestaktivität).
 *
 * `--provoziert` nennt die Fenster, für die die Vorschrift ein `aufgegeben`
 * ausdrücklich vorsieht. Die Ausnahme steht damit in der Kommandozeile und im
 * Protokoll -- nicht als stille Milde im Werkzeug.
 */

import { readFileSync } from "node:fs";
import { parseEreignisse, pruefe, pruefeAlltagsstunde } from "./journal-audit.ts";

const [pfad, ...rest] = process.argv.slice(2);

if (pfad === undefined) {
	console.error("Aufruf: journal-audit-cli.ts <journal> [--stunde]");
	process.exit(2);
}

const text = readFileSync(pfad, "utf8");
const stunde = rest.includes("--stunde");
const index = rest.indexOf("--provoziert");
const provoziert =
	index >= 0 && rest[index + 1] !== undefined ? (rest[index + 1] as string).split(",") : [];
const bericht = stunde
	? pruefeAlltagsstunde(text, { provoziert })
	: pruefe(parseEreignisse(text), { provoziert });

for (const befund of bericht.befunde) {
	const marke = befund.level === "fehler" ? "  xx" : befund.level === "manuell" ? "  ??" : "  !!";
	console.log(`${marke} ${befund.text}`);
}

console.log(
	`  -- ${bericht.laeufe} Läufe, davon ${bericht.nutzerlaeufe} rein nutzerveranlasst, ` +
		`${bericht.schreibvorgaenge} Schreibvorgänge, ${bericht.unklar} ohne Zuordnung, ` +
		`höchstens ${bericht.maxWiederholungen} auf dasselbe Soll ohne freigebenden Lauf`,
);

if (bericht.bestanden) {
	console.log("  ok Journal-Auditor: bestanden");
	process.exit(0);
}
console.error("  xx Journal-Auditor: nicht bestanden");
process.exit(1);
