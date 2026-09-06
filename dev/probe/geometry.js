// Geometrie-Probe für kwin-xmonad-lite, Meilenstein 7.
//
// Zweck: die tatsächlich anliegenden Fenstergeometrien, die nutzbare
// Arbeitsfläche je Surface und das aktive Fenster aus dem Skriptkontext heraus
// als auswertbares JSON ins Journal schreiben. Der geometrische Nachweis der
// Abnahme kommt aus diesen Messdaten, nicht aus einem Screenshot.
//
// Vier Entwurfsregeln, jede mit Grund:
//
// 1. Der Rahmen ist ES5. Die Datei wird von QJSEngine::evaluate in einem Rutsch
//    geparst; ein Syntaxfehler irgendwo verhindert JEDE Ausgabe. Keine
//    Trailing-Kommas, kein `let`, keine Pfeilfunktionen.
// 2. Strikt lesend. Keine Geometrie-Writes, kein moveResize, kein raiseWindow,
//    kein Setzen von activeWindow, kein Zugriff auf rootTile. Die Probe darf
//    das Prüfergebnis nicht selbst herstellen -- deshalb erzwingt
//    `checks.probe-readonly` diese Regel, statt sie nur zu behaupten.
// 3. Kein KWin-Signal wird verbunden. Es gibt keinen Unload-Hook; eine
//    überlebende Verbindung würde später in eine zerstörte Engine feuern.
//    Verbunden wird ausschließlich `timeout` eigener QTimer, deren Lebensdauer
//    die Probe kontrolliert -- ohne das gäbe es keine zeitversetzten Samples.
// 4. Jedes gelesene Rechteck wird gerundet, genau wie in `src/kwin/read.ts`.
//    Gemessen ganzzahlig ist nur `clientArea`; ohne die Rundung wiche die Probe
//    bei gebrochener Skalierung systematisch vom Controller ab. Ob gerundet
//    werden musste, steht als eigenes Feld im Satz.

(function () {
	"use strict";

	var TAG = "KXLGEO1";
	var RUN = Date.now();
	var SEQ = 0;
	var ERRORS = 0;
	// Ein Fenstersatz trägt mehr Felder als die Sätze der beiden anderen
	// Proben; 900 Zeichen schnitten ihn regelmäßig ab.
	var MAXLEN = 1600;

	// Nur Fenster mit diesem Titelpräfix geben ihren Titel preis. Das löst
	// zwei Dinge auf einmal: die Testfenster sind im Rohdatensatz benennbar,
	// und fremde Fenstertitel stehen nicht in einer eingecheckten Datei.
	var TITLE_PREFIX = "kxl-";

	// Vier Messungen. Die ersten drei sind die Staffel der Signalprobe, die
	// vierte ist der Stabilitätsbeleg: erst wenn 1500 und 3000 dieselben
	// fachlichen Werte tragen, gilt die Anordnung als eingeschwungen.
	var SAMPLES = [0, 500, 1500, 3000];

	var TIMERS = [];
	var DONE = false;

	function emit(rec) {
		rec.r = RUN;
		rec.n = SEQ++;
		rec.ms = Date.now() - RUN;
		var text;
		try {
			text = JSON.stringify(rec);
		} catch (e) {
			text = '{"k":"error","d":"stringify fehlgeschlagen"}';
		}
		if (text.length > MAXLEN) {
			rec.trunc = true;
			if (typeof rec.caption === "string") {
				rec.caption = "<gekürzt>";
			}
			text = JSON.stringify(rec);
		}
		console.info(TAG + " " + text);
	}

	function fail(id, err) {
		ERRORS++;
		emit({ k: "error", id: id, d: String(err) });
	}

	function guard(name, fn) {
		try {
			fn();
		} catch (e) {
			fail(name, e);
		}
	}

	// Dieselbe Rundung wie an der Snapshot-Grenze des Controllers.
	function rect(r) {
		if (r === null || r === undefined) {
			return null;
		}
		var x = Math.round(r.x);
		var y = Math.round(r.y);
		var w = Math.round(r.width);
		var h = Math.round(r.height);
		return {
			x: x,
			y: y,
			w: w,
			h: h,
			exakt: x === r.x && y === r.y && w === r.width && h === r.height
		};
	}

	function idOf(window) {
		if (window === null || window === undefined) {
			return null;
		}
		return String(window.internalId);
	}

	function captionOf(window) {
		var caption;
		try {
			caption = String(window.caption);
		} catch (e) {
			return "<nicht lesbar>";
		}
		if (caption.indexOf(TITLE_PREFIX) === 0) {
			return caption;
		}
		return "<Titel entfernt>";
	}

	// `window.desktops` und `window.activities` sind array-artig, aber keine
	// echten Arrays -- `map` gibt es darauf nicht. Und sie tragen
	// **verschiedene** Inhalte: Desktops sind Objekte mit `id`, Activities
	// sind bereits Zeichenketten (src/kwin/read.ts:34-54).
	function desktopIds(list) {
		var out = [];
		if (list === null || list === undefined) {
			return out;
		}
		for (var i = 0; i < list.length; i++) {
			var entry = list[i];
			if (entry !== null && entry !== undefined) {
				out.push(String(entry.id));
			}
		}
		return out;
	}

	function activityIds(list) {
		var out = [];
		if (list === null || list === undefined) {
			return out;
		}
		for (var i = 0; i < list.length; i++) {
			var entry = list[i];
			if (entry !== null && entry !== undefined) {
				out.push(String(entry));
			}
		}
		return out;
	}

	function windowList() {
		var raw = workspace.windowList();
		var out = [];
		for (var i = 0; i < raw.length; i++) {
			out.push(raw[i]);
		}
		return out;
	}

	function screenList() {
		var raw = workspace.screens;
		var out = [];
		for (var i = 0; i < raw.length; i++) {
			out.push(raw[i]);
		}
		return out;
	}

	// Surface-Auflösung wie `readViews` in src/kwin/read.ts: je Ausgabe der
	// dort aktuelle Desktop, Fläche aus clientArea(MaximizeArea, ...). Eine
	// abweichende Auflösung machte jeden Vergleich mit dem Journal wertlos.
	function emitViews(sample) {
		var activity = String(workspace.currentActivity);
		var screens = screenList();
		for (var i = 0; i < screens.length; i++) {
			var output = screens[i];
			var desktop = workspace.currentDesktopForScreen(output);
			if (desktop === null || desktop === undefined) {
				desktop = workspace.currentDesktop;
			}
			if (desktop === null || desktop === undefined) {
				emit({ k: "view", s: sample, output: String(output.name), st: "kein Desktop" });
				continue;
			}
			var desktopId = String(desktop.id);
			emit({
				k: "view",
				s: sample,
				key: activity + "|" + desktopId + "|" + String(output.name),
				activity: activity,
				desktop: desktopId,
				output: String(output.name),
				area: rect(workspace.clientArea(KWin.MaximizeArea, output, desktop))
			});
		}
	}

	function emitActive(sample) {
		emit({ k: "active", s: sample, activeId: idOf(workspace.activeWindow) });
	}

	function emitWindows(sample) {
		var windows = windowList();
		for (var i = 0; i < windows.length; i++) {
			var w = windows[i];
			emit({
				k: "win",
				s: sample,
				id: idOf(w),
				cls: String(w.resourceClass),
				caption: captionOf(w),
				output: w.output === null ? "" : String(w.output.name),
				desktops: desktopIds(w.desktops),
				activities: activityIds(w.activities),
				onAllDesktops: w.onAllDesktops === true,
				geo: rect(w.frameGeometry),
				min: { w: w.minSize.width, h: w.minSize.height },
				max: { w: w.maxSize.width, h: w.maxSize.height },
				// Layout-Teilnahme
				fullScreen: w.fullScreen === true,
				minimized: w.minimized === true,
				maximizeMode: w.maximizeMode,
				moveable: w.moveable === true,
				resizeable: w.resizeable === true,
				move: w.move === true,
				resize: w.resize === true,
				// Mitgliedschaft
				managed: w.managed === true,
				deleted: w.deleted === true,
				normalWindow: w.normalWindow === true,
				specialWindow: w.specialWindow === true,
				popupWindow: w.popupWindow === true,
				dialog: w.dialog === true,
				utility: w.utility === true,
				splash: w.splash === true,
				dock: w.dock === true,
				transient: w.transient === true,
				// Fall 20b: die Modalität wird nachgewiesen, nicht angenommen.
				modal: w.modal === true,
				transientFor: idOf(w.transientFor)
			});
		}
	}

	function measure(sample) {
		guard("view:" + sample, function () {
			emitViews(sample);
		});
		guard("active:" + sample, function () {
			emitActive(sample);
		});
		guard("win:" + sample, function () {
			emitWindows(sample);
		});
	}

	function finish() {
		if (DONE) {
			return;
		}
		DONE = true;
		var running = 0;
		for (var i = 0; i < TIMERS.length; i++) {
			if (TIMERS[i].active) {
				running++;
			}
			TIMERS[i].stop();
		}
		emit({
			k: "end",
			st: ERRORS === 0 ? "ok" : "error",
			total: SEQ,
			samples: SAMPLES.length,
			fehler: ERRORS,
			timer_aktiv: running
		});
	}

	// `singleShot` ist auf dieser Engine gemessen vorhanden, seine Wirkung
	// nicht -- der Timer stoppt sich deshalb selbst.
	function later(ms, fn) {
		var t = new QTimer();
		TIMERS.push(t);
		t.singleShot = true;
		t.interval = ms;
		t.timeout.connect(function () {
			t.stop();
			if (DONE) {
				return;
			}
			fn();
		});
		t.start();
	}

	emit({
		k: "meta",
		tag: TAG,
		start: RUN,
		perOutputDesktops: options.perOutputVirtualDesktops === true,
		outputs: screenList().length,
		samples: SAMPLES,
		titlePrefix: TITLE_PREFIX
	});

	measure(0);

	(function () {
		var letzter = SAMPLES.length - 1;
		for (var i = 1; i < SAMPLES.length; i++) {
			(function (index) {
				later(SAMPLES[index], function () {
					measure(index);
					if (index === letzter) {
						finish();
					}
				});
			})(i);
		}
	})();
})();
