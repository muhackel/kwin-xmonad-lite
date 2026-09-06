// Minimaldeklarationen für die Werkzeuge unter dev/probe/.
// Wie tests/node-globals.d.ts: das Projekt hat bewusst keine
// npm-Abhängigkeiten, @types/node ist im nixpkgs-Pin nicht verfügbar.

declare module "node:fs" {
	export function readFileSync(path: string, encoding: "utf8"): string;
}

declare const process: {
	argv: string[];
	exit(code: number): never;
};

declare const console: {
	log(...args: unknown[]): void;
	error(...args: unknown[]): void;
};
