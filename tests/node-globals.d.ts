// Minimaldeklarationen für die von den Tests benutzten Node-Module.
// Das Projekt hat bewusst keine npm-Abhängigkeiten, @types/node ist im
// nixpkgs-Pin nicht verfügbar (nodePackages wurde aus nixpkgs entfernt).

declare module "node:test" {
	export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
	interface Assert {
		equal(actual: unknown, expected: unknown, message?: string): void;
		notEqual(actual: unknown, expected: unknown, message?: string): void;
		deepEqual(actual: unknown, expected: unknown, message?: string): void;
		ok(value: unknown, message?: string): void;
		throws(fn: () => unknown, message?: string): void;
	}
	const assert: Assert;
	export default assert;
}
