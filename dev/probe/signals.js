// Signalprobe für kwin-xmonad-lite, Meilenstein 4.
//
// Zweck: die vier Punkte messen, auf denen der Umbau zu Multi-Output,
// Desktopwechsel, Hotplug und Panelbeobachtung aufsitzt und die aus dem
// KWin-Quelltext nur zu vermuten waren:
//
//   1. Welche Argumente tragen `currentDesktopChanged`, `activitiesChanged`,
//      `desktopsChanged`, `currentActivityChanged` und `screensChanged` im
//      Skriptkontext? Der Quelltext kennt `(prev, cur)`; ob der Wrapper das
//      weiterreicht, ist offen.
//   2. Was steht in `workspace.desktops`, und lässt sich daraus die Liste
//      gültiger Desktop-Ids für `purgeSurfaces` bauen?
//   3. Feuert ein Dock `frameGeometryChanged`, wenn sich die Panelhöhe
//      ändert -- und ist `clientArea` in diesem Moment schon neu? Davon
//      hängt ab, ob die verzögerten Nachläufe am Dock-Signal hängen
//      müssen oder nur an `screensChanged`.
//   4. In welcher Reihenfolge kommen beim Hotplug `screensChanged`,
//      `screenOrderChanged` und die `outputChanged` der einzelnen Fenster an?
//
// Anders als die Feature-Probe aus Meilenstein 0 **verbindet** diese Probe
// KWin-Signale -- ohne das lässt sich keine der vier Fragen beantworten.
// Deshalb die harte Gegenregel: sie führt über jede Verbindung Buch und
// trennt vor ihrem Abschlusssatz **sämtliche** Verbindungen und stoppt alle
// eigenen Timer. Es gibt keinen Unload-Hook; eine überlebende Verbindung
// würde später in eine zerstörte Engine feuern.
//
// Strikt lesend: keine Geometrie-Writes, kein raiseWindow, kein Setzen von
// options.*, kein Zugriff auf rootTile.
//
// Der Rahmen ist bewusst ES5 -- die Datei wird in einem Rutsch geparst, ein
// Syntaxfehler irgendwo verhindert JEDE Ausgabe.

(function () {
	"use strict";

	var TAG = "KXLSIG1";
	var RUN = Date.now();
	var SEQ = 0;
	var MAXLEN = 900;

	// Gesamtlaufzeit. **Muss zur Phasentabelle in scripts/probe-signals.sh
	// passen**: das Skript führt in dieser Zeit durch die Handgriffe, danach
	// räumt die Probe ab. Summe der Phasen dort < DURATION_MS hier.
	var DURATION_MS = 175000;

	/** Eigene QTimer. Referenzen halten, sonst holt sie die GC. */
	var TIMERS = [];
	/** Je aufgebauter Verbindung eine Trennfunktion in einer Box. */
	var CUTS = [];
	var DONE = false;
	/** Trennungen an einem bereits gelöschten QObject -- erwartet, informativ. */
	var CUT_TOT = 0;
	/** Jeder andere Fehler beim Trennen -- die Verbindung bleibt offen. */
	var CUT_FEHLER = 0;

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
			if (typeof rec.d === "string") {
				rec.d = rec.d.substring(0, 500);
			}
			text = JSON.stringify(rec);
		}
		console.info(TAG + " " + text);
	}

	// --------------------------------------------------------------- Helfer

	function brief(v) {
		var t = typeof v;
		if (v === null) {
			return "null";
		}
		if (t === "undefined" || t === "number" || t === "boolean") {
			return t + ":" + String(v);
		}
		if (t === "string") {
			return "string:" + (v.length > 80 ? v.substring(0, 80) + "..." : v);
		}
		if (t === "function") {
			return "function";
		}
		try {
			if (typeof v.id === "string" && typeof v.x11DesktopNumber === "number") {
				return "desktop:" + v.id + "#" + v.x11DesktopNumber;
			}
			if (typeof v.name === "string" && typeof v.geometry === "object") {
				return "output:" + v.name;
			}
			if (typeof v.internalId !== "undefined") {
				return "window:" + shortId(v);
			}
			if (typeof v.width === "number" && typeof v.x === "number") {
				return "rect:" + fmtRect(v);
			}
			return "object:" + String(v);
		} catch (e) {
			return "unlesbar: " + String(e);
		}
	}

	function args(a) {
		var out = [];
		for (var i = 0; i < a.length; i++) {
			out.push(brief(a[i]));
		}
		return out;
	}

	function fmtRect(r) {
		return r.width + "x" + r.height + "+" + r.x + "+" + r.y;
	}

	/** Kurzform der Fenster-Id: die letzten sechs Zeichen der UUID. */
	function shortId(window) {
		var s;
		try {
			s = String(window.internalId);
		} catch (e) {
			return "?";
		}
		return s.length > 8 ? s.substring(s.length - 7, s.length - 1) : s;
	}

	/**
	 * Die Arbeitsfläche aller Ausgaben, so wie `read.ts` sie liest. Genau
	 * dieser Wert entscheidet Frage 3: steht hier direkt nach dem Dock-Signal
	 * schon die neue Höhe, brauchen die Nachläufe das Dock nicht.
	 */
	function areas() {
		var out = [];
		var screens = workspace.screens;
		for (var i = 0; i < screens.length; i++) {
			var o = screens[i];
			if (!o) {
				continue;
			}
			var d = workspace.currentDesktopForScreen(o) || workspace.currentDesktop;
			var a;
			try {
				a = fmtRect(workspace.clientArea(KWin.MaximizeArea, o, d));
			} catch (e) {
				a = "fehler:" + String(e);
			}
			out.push(o.name + "=" + a);
		}
		return out.join(" ");
	}

	function desktopList() {
		var out = [];
		try {
			var ds = workspace.desktops;
			if (!ds) {
				return "absent";
			}
			for (var i = 0; i < ds.length; i++) {
				var d = ds[i];
				if (d) {
					out.push(String(d.id) + "#" + String(d.x11DesktopNumber));
				}
			}
		} catch (e) {
			return "fehler:" + String(e);
		}
		return out.join(",");
	}

	function activityList() {
		var out = [];
		try {
			var as = workspace.activities;
			for (var i = 0; i < as.length; i++) {
				out.push(String(as[i]));
			}
		} catch (e) {
			return "fehler:" + String(e);
		}
		return out.join(",");
	}

	function screenList() {
		var out = [];
		try {
			var s = workspace.screens;
			for (var i = 0; i < s.length; i++) {
				if (s[i]) {
					out.push(s[i].name);
				}
			}
		} catch (e) {
			return "fehler:" + String(e);
		}
		return out.join(",");
	}

	// --------------------------------------------------- Verbindungsbuchhaltung

	function addCut(fn) {
		var box = { fn: fn };
		CUTS.push(box);
		return box;
	}

	function runCut(box) {
		if (box.fn === null) {
			return;
		}
		var fn = box.fn;
		try {
			fn();
			box.fn = null;
		} catch (e) {
			var text = String(e);
			// Ein gelöschtes QObject nimmt seine Verbindungen mit ins Grab: das
			// gilt als getrennt, wird aber gezählt. In jedem sauberen Lauf
			// sterben Panels weg, ihre `disconnect`-Aufrufe werfen also
			// zwangsläufig. Jeder andere Fehler lässt die Verbindung offen und
			// schlägt damit auf `offen` durch.
			if (text.indexOf("deleted QObject") >= 0) {
				CUT_TOT++;
				box.fn = null;
			} else {
				CUT_FEHLER++;
			}
			emit({ k: "cut", st: "error", d: text });
		}
	}

	/**
	 * Verbindet ein Signal und legt die Trennfunktion ab. Fehlt das Signal,
	 * ist das selbst ein Messergebnis und kein Fehler.
	 */
	function watch(owner, name, id, handler) {
		var sig;
		try {
			sig = owner[name];
		} catch (e) {
			emit({ k: "wire", id: id, st: "error", d: String(e) });
			return null;
		}
		if (!sig || typeof sig.connect !== "function") {
			emit({ k: "wire", id: id, st: "absent" });
			return null;
		}
		try {
			sig.connect(handler);
		} catch (e2) {
			emit({ k: "wire", id: id, st: "error", d: String(e2) });
			return null;
		}
		emit({ k: "wire", id: id, st: "ok" });
		return addCut(function () {
			sig.disconnect(handler);
		});
	}

	function later(ms, fn) {
		var t = new QTimer();
		TIMERS.push(t);
		t.singleShot = true;
		t.interval = ms;
		t.timeout.connect(function () {
			// `singleShot` ist gemessen vorhanden, seine Wirkung nicht.
			t.stop();
			if (DONE) {
				return;
			}
			fn();
		});
		t.start();
	}

	// ------------------------------------------------------------ Aufzeichnung

	/** Ein Signalereignis mit Argumentzahl und -typen. */
	function record(id, extra) {
		return function () {
			if (DONE) {
				return;
			}
			var rec = { k: "sig", id: id, argc: arguments.length, a: args(arguments) };
			if (extra) {
				try {
					extra(rec);
				} catch (e) {
					rec.d = "extra fehlgeschlagen: " + String(e);
				}
			}
			emit(rec);
		};
	}

	/**
	 * Frage 3: die Arbeitsfläche dreimal messen -- sofort, nach 500 und nach
	 * 1500 ms. Nur so ist zu sehen, ob `clientArea` beim Signal schon neu ist
	 * oder erst später nachzieht.
	 */
	function sampleAreas(id) {
		emit({ k: "area", id: id, phase: "sofort", d: areas() });
		later(500, function () {
			emit({ k: "area", id: id, phase: "500ms", d: areas() });
		});
		later(1500, function () {
			emit({ k: "area", id: id, phase: "1500ms", d: areas() });
		});
	}

	// ------------------------------------------------------- Fensterverbindungen

	var docks = 0;
	var plain = 0;

	function connectDock(window) {
		var id = shortId(window);
		docks++;
		emit({ k: "dock", id: id, st: "verbunden", d: "class=" + String(window.resourceClass) });

		var onGeometry = function () {
			if (DONE) {
				return;
			}
			var rect;
			try {
				rect = fmtRect(window.frameGeometry);
			} catch (e) {
				rect = "unlesbar";
			}
			emit({ k: "sig", id: "dock.frameGeometryChanged", dock: id, d: rect });
			sampleAreas("dock.frameGeometryChanged " + id);
		};
		var onOutput = record("dock.outputChanged", function (rec) {
			rec.dock = id;
		});
		var boxGeometry = watch(window, "frameGeometryChanged", "dock:" + id + ".frameGeometryChanged", onGeometry);
		var boxOutput = watch(window, "outputChanged", "dock:" + id + ".outputChanged", onOutput);

		var onClosed = function () {
			// Nichts am sterbenden Objekt lesen: die Id steht in dieser Closure.
			emit({ k: "dock", id: id, st: "closed" });
			if (boxGeometry) {
				runCut(boxGeometry);
			}
			if (boxOutput) {
				runCut(boxOutput);
			}
			if (!DONE) {
				sampleAreas("dock.closed " + id);
			}
		};
		// Die `closed`-Verbindung selbst räumt der Abschluss über CUTS ab;
		// ein Trennen im eigenen Handler ist nicht nötig.
		watch(window, "closed", "dock:" + id + ".closed", onClosed);
	}

	/**
	 * Gewöhnliche Fenster nur an `outputChanged`: für Frage 4 zählt die
	 * Reihenfolge gegenüber `screensChanged`, nicht der Fensterzustand.
	 */
	function connectPlain(window) {
		var id = shortId(window);
		plain++;
		var onOutput = function () {
			if (DONE) {
				return;
			}
			var name;
			try {
				name = window.output ? window.output.name : "null";
			} catch (e) {
				name = "unlesbar";
			}
			emit({ k: "sig", id: "window.outputChanged", win: id, d: name });
		};
		watch(window, "outputChanged", "win:" + id + ".outputChanged", onOutput);
	}

	function connectWindow(window) {
		if (!window) {
			return;
		}
		var isDock = false;
		try {
			isDock = window.dock === true;
		} catch (e) {
			return;
		}
		if (isDock) {
			connectDock(window);
		} else {
			connectPlain(window);
		}
	}

	// ------------------------------------------------------------- Abschluss

	function finish() {
		if (DONE) {
			return;
		}
		DONE = true;

		var i;
		for (i = 0; i < CUTS.length; i++) {
			runCut(CUTS[i]);
		}
		for (i = 0; i < TIMERS.length; i++) {
			try {
				TIMERS[i].stop();
			} catch (e) {
				// Wir gehen ohnehin; ein nicht stoppbarer Timer wäre im
				// nächsten Satz ohnehin nicht mehr zu retten.
			}
		}
		var open = 0;
		for (i = 0; i < CUTS.length; i++) {
			if (CUTS[i].fn !== null) {
				open++;
			}
		}
		var running = 0;
		for (i = 0; i < TIMERS.length; i++) {
			try {
				if (TIMERS[i].active) {
					running++;
				}
			} catch (e2) {
				running++;
			}
		}
		TIMERS.length = 0;

		emit({
			k: "end",
			st: open === 0 && running === 0 && CUT_FEHLER === 0 ? "ok" : "value",
			total: SEQ,
			verbindungen: CUTS.length,
			offen: open,
			timer_aktiv: running,
			cut_tot: CUT_TOT,
			cut_fehler: CUT_FEHLER,
		});
	}

	// ------------------------------------------------------------------ Start

	emit({ k: "meta", id: "start", st: "ok", d: "kwin-xmonad-lite Signalprobe" });

	emit({ k: "state", id: "desktops", d: desktopList() });
	emit({ k: "state", id: "activities", d: activityList() });
	emit({ k: "state", id: "screens", d: screenList() });
	emit({ k: "state", id: "areas", d: areas() });
	emit({
		k: "state",
		id: "perOutputVirtualDesktops",
		d: String(typeof options === "undefined" ? "options fehlt" : options.perOutputVirtualDesktops),
	});

	// --- Frage 1 und 2: die Workspace-Signale -------------------------------

	watch(
		workspace,
		"currentDesktopChanged",
		"workspace.currentDesktopChanged",
		record("workspace.currentDesktopChanged", function (rec) {
			rec.d =
				"current=" +
				String(workspace.currentDesktop ? workspace.currentDesktop.id : "null") +
				" proScreen=" +
				screenDesktops();
		}),
	);
	watch(
		workspace,
		"currentActivityChanged",
		"workspace.currentActivityChanged",
		record("workspace.currentActivityChanged", function (rec) {
			rec.d = "current=" + String(workspace.currentActivity);
		}),
	);
	watch(
		workspace,
		"desktopsChanged",
		"workspace.desktopsChanged",
		record("workspace.desktopsChanged", function (rec) {
			rec.d = desktopList();
		}),
	);
	watch(
		workspace,
		"activitiesChanged",
		"workspace.activitiesChanged",
		record("workspace.activitiesChanged", function (rec) {
			rec.d = activityList();
		}),
	);

	function screenDesktops() {
		var out = [];
		var screens = workspace.screens;
		for (var i = 0; i < screens.length; i++) {
			var o = screens[i];
			if (!o) {
				continue;
			}
			var d = workspace.currentDesktopForScreen(o);
			out.push(o.name + "=" + String(d ? d.x11DesktopNumber : "null"));
		}
		return out.join(",");
	}

	// --- Frage 4: Hotplug ---------------------------------------------------

	watch(
		workspace,
		"screensChanged",
		"workspace.screensChanged",
		record("workspace.screensChanged", function (rec) {
			rec.d = screenList() + " | " + areas();
		}),
	);
	watch(
		workspace,
		"screenOrderChanged",
		"workspace.screenOrderChanged",
		record("workspace.screenOrderChanged", function (rec) {
			rec.d = screenList();
		}),
	);
	watch(
		workspace,
		"virtualScreenGeometryChanged",
		"workspace.virtualScreenGeometryChanged",
		record("workspace.virtualScreenGeometryChanged", function (rec) {
			rec.d = areas();
		}),
	);

	// --- Frage 3: Docks -----------------------------------------------------

	// `windowAdded` braucht einen eigenen Handler statt `record`: ein neu
	// erscheinendes Dock muss noch während des Laufs verbunden werden.
	var onAdded = function (window) {
		if (DONE) {
			return;
		}
		emit({ k: "sig", id: "workspace.windowAdded", argc: arguments.length, a: args(arguments) });
		connectWindow(window);
	};
	watch(workspace, "windowAdded", "workspace.windowAdded", onAdded);
	// Eigener Handler statt `record`: das übergebene Fenster darf **nicht**
	// gelesen werden, es kann bereits tot sein. Nur die Argumentzahl zählt.
	var onRemoved = function () {
		if (DONE) {
			return;
		}
		emit({ k: "sig", id: "workspace.windowRemoved", argc: arguments.length, a: ["(nicht gelesen)"] });
	};
	watch(workspace, "windowRemoved", "workspace.windowRemoved", onRemoved);

	var list = workspace.windowList();
	for (var i = 0; i < list.length; i++) {
		connectWindow(list[i]);
	}
	emit({ k: "state", id: "verbunden", d: "docks=" + docks + " fenster=" + plain });

	later(DURATION_MS, finish);
	emit({ k: "meta", id: "laufzeit", st: "ok", d: "ms=" + DURATION_MS });
})();
