/**
 * Kommandozeilenhülle des Geometrie-Orakels.
 *
 * Sie steht getrennt von der Logik, damit `tests/expect-geometry.test.ts` die
 * Prüfungen importieren kann, ohne dass beim Import etwas ausgeführt wird oder
 * ein `import.meta`-Kunstgriff nötig wäre.
 *
 *   node dev/probe/expect-geometry-cli.ts <ndjson> <journal> [layout=… n=… …]
 */

import { readFileSync } from "node:fs";
import { run } from "./expect-geometry.ts";

const [ndjsonPfad, journalPfad, ...erwartung] = process.argv.slice(2);

if (ndjsonPfad === undefined || journalPfad === undefined) {
	console.error(
		"Aufruf: expect-geometry-cli.ts <ndjson> <journal> [layout=tall n=3 ratio=0.65 gaps=0/0]",
	);
	process.exit(2);
}

const report = run(readFileSync(ndjsonPfad, "utf8"), readFileSync(journalPfad, "utf8"), erwartung);

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
