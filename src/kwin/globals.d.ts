// Laufzeitumgebung eines KWin-Skripts mit "X-Plasma-API": "javascript".
// Die QJSEngine kennt weder DOM noch Node; die hier deklarierten Globals sind
// die, die KWin in scripting.cpp in den Skriptkontext injiziert.
// Wird mit jedem Meilenstein um die tatsaechlich benutzten Teile erweitert.

declare const console: {
	log(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
	assert(condition: unknown, message?: string): void;
};
