/**
 * Synthetische Messdaten für das Geometrie-Orakel.
 *
 * Sie ersetzen keinen Live-Lauf, sondern belegen, dass das Orakel einen
 * fehlerhaften Datensatz auch wirklich beanstandet. Ohne diese Fixtures wäre
 * ein stillschweigend bestehendes Orakel von einem funktionierenden nicht zu
 * unterscheiden.
 */

const AKTIVITAET = "a89f5ec2-ab8e-4108-8088-7118500a3aab";
const DESKTOP = "89539ae6-e06b-4c76-a057-95df959578a9";
export const OUTPUT = "DP-3";
export const KEY = `${AKTIVITAET}|${DESKTOP}|${OUTPUT}`;

export const FLAECHE = { x: 0, y: 0, w: 1920, h: 1050 };

/** Die Sollzellen von `tall(1920x1050, 3, {0.65, 0, 0})`. */
export const TALL3 = [
	{ x: 0, y: 0, w: 1248, h: 1050 },
	{ x: 1248, y: 0, w: 672, h: 525 },
	{ x: 1248, y: 525, w: 672, h: 525 },
];

export interface FensterVorgabe {
	id: string;
	geo: { x: number; y: number; w: number; h: number };
	extra?: Record<string, unknown>;
}

export interface ProbeVorgabe {
	fenster: FensterVorgabe[];
	/** Abweichende Fenstergeometrien im letzten Sample: nicht eingeschwungen. */
	letztesSampleAbweichend?: FensterVorgabe[];
	/** Fenster, die im letzten Sample fehlen. */
	fehltImLetztenSample?: string[];
	ohneEnd?: boolean;
	flaeche?: { x: number; y: number; w: number; h: number };
	samples?: number[];
}

function rect(value: { x: number; y: number; w: number; h: number }): Record<string, unknown> {
	return { x: value.x, y: value.y, w: value.w, h: value.h, exakt: true };
}

/**
 * Baut einen vollständigen NDJSON-Datensatz. Die Satznummern laufen wie in der
 * echten Probe lückenlos, damit die Qualitätsprüfung greift.
 */
export function ndjson(vorgabe: ProbeVorgabe): string {
	const samples = vorgabe.samples ?? [0, 500, 1500, 3000];
	const flaeche = vorgabe.flaeche ?? FLAECHE;
	const zeilen: string[] = [];
	let n = 0;
	const lauf = 1788700000000;

	function push(record: Record<string, unknown>): void {
		zeilen.push(JSON.stringify({ ...record, r: lauf, n: n, ms: n * 10 }));
		n += 1;
	}

	push({ k: "meta", tag: "KXLGEO1", start: lauf, outputs: 1, samples });

	for (let index = 0; index < samples.length; index++) {
		const letztes = index === samples.length - 1;
		push({
			k: "view",
			s: index,
			key: KEY,
			activity: AKTIVITAET,
			desktop: DESKTOP,
			output: OUTPUT,
			area: rect(flaeche),
		});
		push({ k: "active", s: index, activeId: vorgabe.fenster[0]?.id ?? null });

		const fenster =
			letztes && vorgabe.letztesSampleAbweichend !== undefined
				? vorgabe.letztesSampleAbweichend
				: vorgabe.fenster;
		for (const eintrag of fenster) {
			if (letztes && (vorgabe.fehltImLetztenSample ?? []).includes(eintrag.id)) {
				continue;
			}
			push({
				k: "win",
				s: index,
				id: eintrag.id,
				cls: "kwrite",
				caption: `kxl-${eintrag.id}`,
				output: OUTPUT,
				desktops: [DESKTOP],
				activities: [AKTIVITAET],
				geo: rect(eintrag.geo),
				normalWindow: true,
				managed: true,
				dock: false,
				modal: false,
				transientFor: null,
				...(eintrag.extra ?? {}),
			});
		}
	}

	if (vorgabe.ohneEnd !== true) {
		push({ k: "end", st: "ok", total: n + 1, samples: samples.length, fehler: 0, timer_aktiv: 0 });
	}

	return `${zeilen.join("\n")}\n`;
}

export interface JournalVorgabe {
	layout?: string;
	n?: number;
	ratio?: number;
	gaps?: string;
	debug?: boolean;
	teilnehmer?: string[];
	order?: string[];
	float?: string[];
	/** `apply`-Zeilen: Fenster-Id auf Sollrechteck in der `WxH+X+Y`-Form. */
	applies?: Array<[string, string]>;
	aufgegeben?: string[];
	ohneDiagnose?: boolean;
	ohneConfig?: boolean;
}

const PRAEFIX = "2026-09-06T16:03:41+02:00 HAL9000 kwin_wayland[2397]: kwin-xmonad-lite:";

/** Ein Journalauszug in genau der Form, die `journalctl -o short-iso` liefert. */
export function journal(vorgabe: JournalVorgabe = {}): string {
	const layout = vorgabe.layout ?? "tall";
	const teilnehmer = vorgabe.teilnehmer ?? ["a", "b", "c"];
	const zeilen: string[] = [`${PRAEFIX} geladen, Version 0.0.0`];

	if (vorgabe.ohneConfig !== true) {
		const gaps = vorgabe.gaps ?? "0/0";
		const ratio = vorgabe.ratio ?? 0.65;
		const debug = vorgabe.debug ?? true;
		zeilen.push(
			`${PRAEFIX} config gaps=${gaps} ratio=${ratio} layout=${layout === "full" ? 1 : 0} ` +
				`excludes=7 debug=${debug}`,
		);
	}
	zeilen.push(`${PRAEFIX} shortcuts n=12`);
	zeilen.push(
		`${PRAEFIX} surface ${KEY} layout=${layout} n=${vorgabe.n ?? teilnehmer.length} ` +
			`ratio=${vorgabe.ratio ?? 0.65} fläche=1920x1050+0+0`,
	);
	if (vorgabe.ohneDiagnose !== true) {
		zeilen.push(
			`${PRAEFIX} diagnose ${KEY} order=${(vorgabe.order ?? teilnehmer).join(",")} ` +
				`teilnehmer=${teilnehmer.join(",")} float=${(vorgabe.float ?? []).join(",")}`,
		);
	}
	for (const [id, soll] of vorgabe.applies ?? []) {
		zeilen.push(`${PRAEFIX} apply ${id} soll=${soll}`);
	}
	for (const id of vorgabe.aufgegeben ?? []) {
		zeilen.push(`${PRAEFIX} aufgegeben ${id} nach 3 Versuchen, ist=670x520+1248+0`);
	}
	return `${zeilen.join("\n")}\n`;
}
