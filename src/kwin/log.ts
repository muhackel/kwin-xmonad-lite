const PREFIX = "kwin-xmonad-lite";

export function format(message: string): string {
	return `${PREFIX}: ${message}`;
}

export function log(message: string): void {
	console.log(format(message));
}
