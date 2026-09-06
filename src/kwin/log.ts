const PREFIX = "kwin-xmonad-lite";

/**
 * Schalter der ausführlichen Ausgabe. Modulzustand, weil sonst jede Schicht
 * einen Kanal durchgereicht bekommen müsste, nur um eine Zeile zu schreiben;
 * gesetzt wird er genau einmal, vom Adapter aus der geladenen Konfiguration.
 * Bis dahin schweigt `debugLog` -- ein Skript, das seine Konfiguration noch
 * nicht kennt, soll das Journal nicht fluten.
 */
let debug = false;

export function format(message: string): string {
	return `${PREFIX}: ${message}`;
}

export function log(message: string): void {
	console.log(format(message));
}

export function setDebug(enabled: boolean): void {
	debug = enabled;
}

/**
 * Zusätzliche Zeile, die nur bei `debug=true` erscheint. Sie läuft bewusst
 * über `log` und damit über denselben Präfix: der Journalfilter in
 * `scripts/logs.sh` greift nach diesem Präfix, eine eigene Kennung machte die
 * Zeile bei `nix run .#logs` unsichtbar.
 */
export function debugLog(message: string): void {
	if (!debug) {
		return;
	}
	log(message);
}
