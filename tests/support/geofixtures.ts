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

/**
 * Gemeinsame Uhr für Probe und Journal. Beide Generatoren hingen früher an
 * eigenen, unverbundenen Zeitstempeln; sobald das Orakel sein Messfenster aus
 * `meta.start` bildet, verwirft es damit jede Journalzeile. Die Journalzeilen
 * laufen deshalb **vor** dem Messbeginn, so wie in einem echten Auszug: der
 * Skriptstart und seine `config`-Zeile liegen lange vor jedem Probelauf.
 */
export const UHR = 1788700000000;

/** ISO-Stempel in der Form, die `journalctl -o short-iso` schreibt. */
export function stempel(zeit: number): string {
	const iso = new Date(zeit + 2 * 3600 * 1000).toISOString();
	return `${iso.slice(0, 19)}+02:00`;
}

/** Hängt mehrere Auszüge aneinander, ohne Leerzeile dazwischen. */
export function verketten(...auszuege: string[]): string {
	return `${auszuege.map((text) => text.replace(/\n+$/, "")).join("\n")}\n`;
}

/**
 * Die Sollzellen von `tall(1920x1050, 2, {0.5, 0, 0})`. Master und Stapel sind
 * hier **gleich breit** -- der Fall, an dem eine Masterprüfung über die Breite
 * allein ein korrektes Layout ablehnt.
 */
export const TALL2_RATIO50 = [
	{ x: 0, y: 0, w: 960, h: 1050 },
	{ x: 960, y: 0, w: 960, h: 1050 },
];

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
	/**
	 * Was der `meta`-Satz **ankündigt**, wenn es von den tatsächlich
	 * geschriebenen Samples abweicht -- so sieht ein vorzeitig abgebrochener
	 * Lauf aus.
	 */
	angekuendigteSamples?: number[];
	/** Lässt `r` auf allen Sätzen weg. */
	ohneLaufstempel?: boolean;
	/** Lässt `n` auf allen Sätzen weg. */
	ohneSatznummer?: boolean;
	/** Eine zweite gemessene Surface auf einer anderen Ausgabe. */
	zweiteView?: boolean;
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
	const lauf = UHR;

	function push(record: Record<string, unknown>): void {
		const rahmen: Record<string, unknown> = { ms: n * 10 };
		if (vorgabe.ohneLaufstempel !== true) {
			rahmen.r = lauf;
		}
		if (vorgabe.ohneSatznummer !== true) {
			rahmen.n = n;
		}
		zeilen.push(JSON.stringify({ ...record, ...rahmen }));
		n += 1;
	}

	push({
		k: "meta",
		tag: "KXLGEO1",
		start: lauf,
		outputs: 1,
		samples: vorgabe.angekuendigteSamples ?? samples,
	});

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
		if (vorgabe.zweiteView === true) {
			push({
				k: "view",
				s: index,
				key: `${AKTIVITAET}|${DESKTOP}|eDP-1`,
				activity: AKTIVITAET,
				desktop: DESKTOP,
				output: "eDP-1",
				area: rect({ x: 1920, y: 0, w: 1920, h: 1080 }),
			});
		}
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
	/** `aufgegeben`-Zeilen: nur die Id, oder Id samt vermerktem Ist. */
	aufgegeben?: Array<string | [string, string]>;
	ohneDiagnose?: boolean;
	ohneConfig?: boolean;
	/**
	 * Stellt einen **vollständigen früheren Skriptlauf** voran. Der eigentliche
	 * Auszug beginnt dann mit einer zweiten `geladen`-Zeile -- so sieht ein
	 * Journalfenster aus, das eine ältere Instanz mitschneidet.
	 */
	vorlauf?: JournalVorgabe;
	/** Lässt jede Zeile nach `geladen` weg: ein Lauf, der nichts gemeldet hat. */
	nurGeladen?: boolean;
	/** Der Prozess, der die Zeilen schreibt. Zwei Läufe brauchen zwei PIDs. */
	pid?: string;
	/** Beginn der Zeilenfolge in Millisekunden; je Zeile eine Sekunde weiter. */
	beginnMs?: number;
	/** Nummer des Anordnungslaufs, der `apply`- und `diagnose`-Zeilen trägt. */
	epoche?: number;
	/** Setzt den Anordnungslauf **in** das Messfenster statt davor. */
	arrangeWaehrendMessung?: boolean;
	/** Die Arbeitsfläche, die die `surface`-Zeile meldet (`WxH+X+Y`). */
	flaeche?: string;
}

/** Vorgabe: der Skriptstart liegt eine Minute vor dem Messbeginn. */
const JOURNAL_BEGINN = UHR - 60_000;
const PID = "2397";

/** Ein Journalauszug in genau der Form, die `journalctl -o short-iso` liefert. */
export function journal(vorgabe: JournalVorgabe = {}): string {
	const layout = vorgabe.layout ?? "tall";
	const teilnehmer = vorgabe.teilnehmer ?? ["a", "b", "c"];
	const pid = vorgabe.pid ?? PID;
	let zeit = vorgabe.beginnMs ?? JOURNAL_BEGINN;
	const zeilen: string[] = [];

	function schreibe(text: string): void {
		zeilen.push(`${stempel(zeit)} HAL9000 kwin_wayland[${pid}]: kwin-xmonad-lite: ${text}`);
		zeit += 1000;
	}

	if (vorgabe.vorlauf !== undefined) {
		// Kein `trimEnd`: die Zielstufe ist ES2016, dort gibt es das nicht.
		zeilen.push(journal(vorgabe.vorlauf).replace(/\n+$/, ""));
	}
	schreibe("geladen, Version 0.0.0");

	if (vorgabe.nurGeladen === true) {
		return `${zeilen.join("\n")}\n`;
	}

	if (vorgabe.ohneConfig !== true) {
		const gaps = vorgabe.gaps ?? "0/0";
		const ratio = vorgabe.ratio ?? 0.65;
		const debug = vorgabe.debug ?? true;
		schreibe(
			`config gaps=${gaps} ratio=${ratio} layout=${layout === "full" ? 1 : 0} ` +
				`excludes=7 debug=${debug}`,
		);
	}
	schreibe("shortcuts n=12");

	// Der Anordnungslauf steht vor den Zeilen, die er erzeugt -- so wie im
	// echten Journal. Mit `arrangeWaehrendMessung` rutscht er in das
	// Probenzeitfenster: dann beschreibt der Auszug einen Übergang.
	if (vorgabe.arrangeWaehrendMessung === true) {
		zeit = UHR + 500;
	}
	schreibe(`arrange #${vorgabe.epoche ?? 1} grund=start surfaces=1 mitglieder=3 teilnehmer=3`);
	schreibe(
		`surface ${KEY} layout=${layout} n=${vorgabe.n ?? teilnehmer.length} ` +
			`ratio=${vorgabe.ratio ?? 0.65} fläche=${vorgabe.flaeche ?? "1920x1050+0+0"}`,
	);
	if (vorgabe.ohneDiagnose !== true) {
		schreibe(
			`diagnose ${KEY} order=${(vorgabe.order ?? teilnehmer).join(",")} ` +
				`teilnehmer=${teilnehmer.join(",")} float=${(vorgabe.float ?? []).join(",")}`,
		);
	}
	for (const [id, soll] of vorgabe.applies ?? []) {
		schreibe(`apply ${id} soll=${soll}`);
	}
	for (const eintrag of vorgabe.aufgegeben ?? []) {
		const id = typeof eintrag === "string" ? eintrag : eintrag[0];
		const ist = typeof eintrag === "string" ? "670x520+1248+0" : eintrag[1];
		schreibe(`aufgegeben ${id} nach 3 Versuchen, ist=${ist}`);
	}
	return `${zeilen.join("\n")}\n`;
}
