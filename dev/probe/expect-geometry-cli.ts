/**
 * Kommandozeilenhülle des Geometrie-Orakels.
 *
 * Sie steht getrennt von der Logik, damit `tests/expect-geometry.test.ts` die
 * Prüfungen importieren kann, ohne dass beim Import etwas ausgeführt wird oder
 * ein `import.meta`-Kunstgriff nötig wäre.
 *
 *   node dev/probe/expect-geometry-cli.ts <ndjson> <journal> [--kwin-pid N] \
 *       [layout=tall n=3 ratio=0.65 gaps=0/0 fläche=1920x1050+0+0 [surface=…]]
 *
 * `--kwin-pid` bindet den Auszug an eine KWin-Instanz. Ohne die Angabe weist
 * das Orakel einen Auszug mit mehreren Prozessen zurück -- nach einem
 * `replace` schreiben zwei Instanzen in dieselbe Unit, und welche gemeint ist,
 * kann der Auszug nicht selbst entscheiden.
 *
 * Wird eine Vorschrift angegeben, sind `layout`, `n`, `ratio`, `gaps` und
 * `fläche` Pflicht und jeder andere Schlüssel ein Fehler. Ohne Vorschrift
 * prüft das Orakel nur Datenqualität, Einschwingen und Journalhygiene. Die
 * gelesene Vorschrift steht als erste Ausgabezeile.
 */

import { readFileSync } from "node:fs";
import { run } from "./expect-geometry.ts";

const argumente = process.argv.slice(2);
const pidIndex = argumente.indexOf("--kwin-pid");
const pid = pidIndex >= 0 ? argumente[pidIndex + 1] : undefined;
if (pidIndex >= 0) {
	argumente.splice(pidIndex, 2);
}
const [ndjsonPfad, journalPfad, ...erwartung] = argumente;

if (ndjsonPfad === undefined || journalPfad === undefined) {
	console.error(
		"Aufruf: expect-geometry-cli.ts <ndjson> <journal> " +
			"[layout=tall n=3 ratio=0.65 gaps=0/0 fläche=1920x1050+0+0]",
	);
	process.exit(2);
}

const report = run(readFileSync(ndjsonPfad, "utf8"), readFileSync(journalPfad, "utf8"), erwartung, {
	pid,
});

if (report.erwartung !== null) {
	console.log(`  == ${report.erwartung}`);
}

for (const finding of report.findings) {
	const marke =
		finding.level === "fehler" ? "  xx" : finding.level === "nicht-abgenommen" ? "  ~~" : "  !!";
	console.log(`${marke} ${finding.text}`);
}

if (report.bestanden) {
	console.log("  ok Geometrie-Orakel: bestanden");
	process.exit(0);
}
if (report.findings.some((finding) => finding.level === "nicht-abgenommen")) {
	console.error("  ~~ Geometrie-Orakel: Controller entlastet, Fall nicht abgenommen");
	process.exit(1);
}
console.error("  xx Geometrie-Orakel: nicht bestanden");
process.exit(1);
