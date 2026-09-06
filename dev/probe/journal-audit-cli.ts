/**
 * Kommandozeilenhülle des Journal-Auditors.
 *
 * Getrennt von der Logik, damit `tests/journal-audit.test.ts` die Prüfungen
 * importieren kann, ohne dass beim Import etwas ausgeführt wird.
 *
 *   node dev/probe/journal-audit-cli.ts <journal> [--stunde]
 *
 * Ohne `--stunde` prüft er nur auf Schleifen; mit `--stunde` zusätzlich die
 * Belegschwelle aus Fall 27 (Dauer, ein einziger Skriptlauf).
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
const bericht = stunde ? pruefeAlltagsstunde(text) : pruefe(parseEreignisse(text));

for (const befund of bericht.befunde) {
	const marke = befund.level === "fehler" ? "  xx" : befund.level === "manuell" ? "  ??" : "  !!";
	console.log(`${marke} ${befund.text}`);
}

console.log(
	`  -- ${bericht.schreibvorgaenge} Schreibvorgänge, ${bericht.unklar} ohne Zuordnung, ` +
		`höchstens ${bericht.maxWiederholungen} auf dasselbe Soll ohne neuen Anlass`,
);

if (bericht.bestanden) {
	console.log("  ok Journal-Auditor: bestanden");
	process.exit(0);
}
console.error("  xx Journal-Auditor: nicht bestanden");
process.exit(1);
