// Feature-Probe fuer kwin-xmonad-lite, Meilenstein 0.
//
// Zweck: die in PLAN.md Abschnitt 10 als unbelegt markierten Punkte auf der
// laufenden Maschine messen statt sie anzunehmen -- ES-Sprachniveau der
// QJSEngine, verfuegbare Globals, KWin-Enums, Laufzeit-Oberflaeche von
// workspace/Window/Output, QTimer-Semantik.
//
// Drei Entwurfsregeln, jede mit Grund:
//
// 1. Der Rahmen ist bewusst ES5. Die Datei wird von QJSEngine::evaluate in
//    einem Rutsch geparst; ein Syntaxfehler irgendwo verhindert JEDE Ausgabe.
//    Die zu pruefenden Sprachkonstrukte stehen deshalb als Strings hier und
//    werden einzeln ueber new Function() kompiliert -- so wird ein
//    SyntaxError zu einer fangbaren Ausnahme.
// 2. Strikt lesend. Keine Geometrie-Writes, kein raiseWindow, kein Setzen von
//    activeWindow oder options.*, kein Zugriff auf rootTile (Tile-API mit
//    dokumentiertem SIGSEGV, PLAN.md Abschnitt 2 Punkt 7).
// 3. Kein KWin-Signal wird verbunden. Es gibt keinen Unload-Hook; eine
//    ueberlebende Verbindung wuerde spaeter in eine zerstoerte Engine feuern.
//    Signale werden nur klassifiziert. Einzige Ausnahme sind eigene QTimer,
//    deren Lebensdauer die Probe kontrolliert.

(function () {
	"use strict";

	var TAG = "KXLPROBE1";
	var RUN = Date.now();
	var SEQ = 0;
	var ERRORS = 0;
	var MAXLEN = 900;
	var MAXDESC = 600;

	function say(line) {
		console.info(line);
	}

	function sayLoud(line) {
		console.warn(line);
	}

	// Ein Satz je Zeile. Nummerierung lueckenlos, damit ein Abbruch mittendrin
	// vom Fall "gar nichts gelaufen" unterscheidbar bleibt.
	function emit(rec, loud) {
		rec.r = RUN;
		rec.n = SEQ++;
		var text;
		try {
			text = JSON.stringify(rec);
		} catch (e) {
			text = '{"k":"error","d":"stringify fehlgeschlagen"}';
		}
		if (text.length > MAXLEN && typeof rec.d === "string") {
			rec.d = rec.d.substring(0, MAXDESC);
			rec.trunc = true;
			text = JSON.stringify(rec);
		}
		var line = TAG + " " + text;
		say(line);
		if (loud) {
			sayLoud(line);
		}
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

	// Kurzform eines Wertes, ohne ihn aufzurufen. QObject-Wrapper liefern ueber
	// String() ihren Typnamen, das ist genau die gesuchte Information.
	function brief(v) {
		var t = typeof v;
		if (v === null) {
			return "null";
		}
		if (t === "undefined" || t === "number" || t === "boolean") {
			return String(v);
		}
		if (t === "string") {
			return v.length > 120 ? v.substring(0, 120) + "..." : v;
		}
		if (t === "function") {
			return "function";
		}
		try {
			if (Object.prototype.toString.call(v) === "[object Array]") {
				return "array[" + v.length + "] first=" + (v.length ? String(v[0]) : "-");
			}
			if (typeof v.connect === "function" && typeof v.disconnect === "function") {
				return "signal";
			}
			if (typeof v.width === "number" && typeof v.x === "number") {
				return "rect x=" + v.x + " y=" + v.y + " w=" + v.width + " h=" + v.height;
			}
			if (typeof v.width === "number") {
				return "size w=" + v.width + " h=" + v.height;
			}
			return String(v);
		} catch (e) {
			return "unlesbar: " + String(e);
		}
	}

	function classify(v) {
		var t = typeof v;
		if (t === "function") {
			// Signale sind in der QJSEngine Funktionen mit .connect, keine
			// eigenen Objekte -- erst pruefen, dann als Methode einstufen.
			try {
				if (typeof v.connect === "function" && typeof v.disconnect === "function") {
					return "signal";
				}
			} catch (e) {
				return "method";
			}
			return "method";
		}
		if (v && t === "object") {
			try {
				if (typeof v.connect === "function" && typeof v.disconnect === "function") {
					return "signal";
				}
				if (Object.prototype.toString.call(v) === "[object Array]") {
					return "array";
				}
				if (typeof v.x === "number" && typeof v.width === "number") {
					return "rect";
				}
				if (typeof v.width === "number") {
					return "size";
				}
			} catch (e) {
				return "object";
			}
			return "object";
		}
		return t;
	}

	// ---------------------------------------------------------------- Harness

	var COMPILE = null; // "function" | "eval" | null

	function chooseHarness() {
		var ok = false;
		try {
			ok = typeof Function === "function" && new Function("return 1")() === 1;
		} catch (e) {
			ok = false;
		}
		if (ok) {
			COMPILE = "function";
		} else {
			try {
				if (typeof eval === "function" && eval("1+1") === 2) {
					COMPILE = "eval";
				}
			} catch (e2) {
				COMPILE = null;
			}
		}
		emit({ k: "meta", id: "harness", st: COMPILE ? "ok" : "absent", d: String(COMPILE) });
	}

	function compileBody(src) {
		if (COMPILE === "function") {
			return new Function(src);
		}
		if (COMPILE === "eval") {
			return eval("(function(){" + src + "})");
		}
		throw new Error("kein Harness verfuegbar");
	}

	// Dreistufiges Ergebnis: syntax (Parser kennt es nicht) / runtime (parst,
	// wirft beim Ausfuehren) / value (laeuft, liefert Falsches) / ok.
	// Jeder Pruefling wird auch aufgerufen, weil manche Engines Funktionskoerper
	// verzoegert kompilieren.
	function esTest(level, id, src) {
		var fn;
		try {
			fn = compileBody(src);
		} catch (e) {
			emit({ k: "es", lvl: level, id: id, st: "syntax", d: String(e) });
			return false;
		}
		var v;
		try {
			v = fn();
		} catch (e2) {
			emit({ k: "es", lvl: level, id: id, st: "runtime", d: String(e2) });
			return false;
		}
		var good = v === true;
		emit({ k: "es", lvl: level, id: id, st: good ? "ok" : "value", d: brief(v) });
		return good;
	}

	var ES_TESTS = [
		[2015, "let-const", "let a = 1; const b = 2; return a + b === 3;"],
		[2015, "arrow", "var f = (x) => x * 2; return f(2) === 4;"],
		[2015, "template", "var x = 5; return `v${x}` === 'v5';"],
		[2015, "destr-array", "var [a, b] = [1, 2]; return a === 1 && b === 2;"],
		[2015, "destr-obj", "var {a, b} = {a: 1, b: 2}; return a === 1 && b === 2;"],
		[2015, "destr-default", "var {a = 7} = {}; return a === 7;"],
		[2015, "param-default", "function f(a = 3) { return a; } return f() === 3;"],
		[2015, "rest-param", "function f(...r) { return r.length; } return f(1, 2) === 2;"],
		[2015, "spread-call", "function f(a, b) { return a + b; } return f(...[1, 2]) === 3;"],
		[2015, "spread-array", "var a = [1, 2]; return [...a, 3].length === 3;"],
		[2015, "shorthand", "var a = 1; var o = {a}; return o.a === 1;"],
		[2015, "computed-key", "var k = 'x'; var o = {[k]: 1}; return o.x === 1;"],
		[2015, "for-of", "var s = 0; for (const x of [1, 2]) { s += x; } return s === 3;"],
		[2015, "class", "class A { constructor() { this.x = 1; } } return new A().x === 1;"],
		[2015, "class-method", "class A { m() { return 1; } } return new A().m() === 1;"],
		[2015, "class-getter", "class A { get v() { return 2; } } return new A().v === 2;"],
		[2015, "class-static", "class A { static m() { return 3; } } return A.m() === 3;"],
		[2015, "class-extends", "class A { m() { return 1; } } class B extends A {} return new B().m() === 1;"],
		[2015, "generator", "function* g() { yield 1; } return g().next().value === 1;"],
		[2015, "symbol-iterator", "var o = {}; o[Symbol.iterator] = function* () { yield 1; }; return [...o][0] === 1;"],
		[2016, "exponent", "return 2 ** 3 === 8;"],
		[2017, "async-await", "var f = async function () { return 1; }; return typeof f().then === 'function';"],
		[2017, "trailing-comma-params", "function f(a, b,) { return a + b; } return f(1, 2,) === 3;"],
		[2017, "object-entries", "return Object.entries({a: 1})[0][1] === 1;"],
		[2017, "object-values", "return Object.values({a: 1})[0] === 1;"],
		[2018, "spread-object", "var o = {a: 1}; var p = {...o, b: 2}; return p.a === 1 && p.b === 2;"],
		[2018, "rest-object", "var {a, ...r} = {a: 1, b: 2}; return r.b === 2;"],
		[2018, "regex-named-groups", "var m = /(?<y>\\d+)/.exec('42'); return m.groups.y === '42';"],
		[2019, "object-fromentries", "return Object.fromEntries([['a', 1]]).a === 1;"],
		[2019, "optional-catch-binding", "try { throw 1; } catch { return true; }"],
		[2019, "array-flat", "return [1, [2]].flat().length === 2;"],
		[2019, "array-flatmap", "return [1].flatMap(function (x) { return [x, x]; }).length === 2;"],
		[2019, "string-trimstart", "return ' a'.trimStart() === 'a';"],
		[2020, "optional-chaining", "var o = {a: {b: 1}}; return o?.a?.b === 1 && o?.x?.y === undefined;"],
		[2020, "optional-call", "var o = {}; return o.f?.() === undefined;"],
		[2020, "nullish", "var a = null; return (a ?? 5) === 5;"],
		[2020, "globalthis", "return typeof globalThis === 'object';"],
		[2020, "string-matchall", "return typeof ''.matchAll === 'function';"],
		[2020, "promise-allsettled", "return typeof Promise.allSettled === 'function';"],
		[2021, "logical-assign-nullish", "var a = null; a ??= 5; return a === 5;"],
		[2021, "logical-assign-or", "var a = 0; a ||= 5; return a === 5;"],
		[2021, "logical-assign-and", "var a = 1; a &&= 5; return a === 5;"],
		[2021, "string-replaceall", "return 'aa'.replaceAll('a', 'b') === 'bb';"],
		[2021, "numeric-separator", "return 1_000 === 1000;"],
		[2021, "promise-any", "return typeof Promise.any === 'function';"],
		[2022, "class-field-public", "class A { x = 1; } return new A().x === 1;"],
		[2022, "class-field-static", "class A { static x = 1; } return A.x === 1;"],
		[2022, "class-field-private", "class A { #x = 1; get v() { return this.#x; } } return new A().v === 1;"],
		[2022, "class-static-block", "class A { static x; static { A.x = 1; } } return A.x === 1;"],
		[2022, "array-at", "return [1, 2].at(-1) === 2;"],
		[2022, "string-at", "return 'ab'.at(-1) === 'b';"],
		[2022, "object-hasown", "return Object.hasOwn({a: 1}, 'a');"],
		[2023, "array-findlast", "return [1, 2].findLast(function (x) { return x < 3; }) === 2;"],
		[2023, "array-tosorted", "return [2, 1].toSorted()[0] === 1;"],
	];

	function phaseEs() {
		if (!COMPILE) {
			emit({ k: "es-summary", st: "absent", d: "kein Harness, Sprachtests uebersprungen" });
			return;
		}
		var passed = {};
		var failed = [];
		var i;
		for (i = 0; i < ES_TESTS.length; i++) {
			var t = ES_TESTS[i];
			if (esTest(t[0], t[1], t[2])) {
				passed[t[0]] = (passed[t[0]] || 0) + 1;
			} else {
				failed.push(t[1]);
				passed[t[0]] = passed[t[0]] || 0;
			}
		}
		// Hoechstes Niveau, auf dem KEIN Test scheitert -- daran wird das
		// esbuild-Target festgemacht.
		var levels = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023];
		var total = {};
		for (i = 0; i < ES_TESTS.length; i++) {
			total[ES_TESTS[i][0]] = (total[ES_TESTS[i][0]] || 0) + 1;
		}
		var best = 5;
		for (i = 0; i < levels.length; i++) {
			var lv = levels[i];
			if (total[lv] && passed[lv] === total[lv]) {
				best = lv;
			} else if (total[lv]) {
				break;
			}
		}
		emit({ k: "es-summary", st: "ok", id: "target", d: "es" + best, failed: failed.join(",") }, true);
	}

	// ---------------------------------------------------------------- Globals

	var GLOBAL_NAMES = [
		"console", "print", "readConfig", "registerShortcut", "callDBus",
		"registerScreenEdge", "unregisterScreenEdge", "registerTouchScreenEdge",
		"unregisterTouchScreenEdge", "registerUserActionsMenu",
		"options", "KWin", "workspace", "QTimer",
		"assert", "assertTrue", "assertFalse", "assertEquals", "assertNull",
		"setTimeout", "setInterval", "requestAnimationFrame", "Qt", "gc",
		"XMLHttpRequest", "globalThis", "Function", "eval",
	];

	var CONSOLE_METHODS = ["log", "debug", "info", "warn", "error", "assert", "count", "time", "timeEnd", "trace", "dir"];

	var LIB_NAMES = ["Map", "Set", "WeakMap", "WeakSet", "Symbol", "Proxy", "Reflect", "Promise", "JSON", "Date", "Math", "RegExp"];

	function typeOfGlobal(name) {
		// typeof auf einen nicht deklarierten Bezeichner wirft nicht.
		try {
			return compileBody("return typeof " + name + ";")();
		} catch (e) {
			return "unbekannt";
		}
	}

	function phaseGlobals() {
		var i;
		for (i = 0; i < GLOBAL_NAMES.length; i++) {
			var n = GLOBAL_NAMES[i];
			var t = COMPILE ? typeOfGlobal(n) : "ungeprueft";
			emit({ k: "globals", id: n, st: t === "undefined" ? "absent" : "ok", d: t });
		}
		for (i = 0; i < CONSOLE_METHODS.length; i++) {
			var m = CONSOLE_METHODS[i];
			var tt = "absent";
			try {
				tt = typeof console[m];
			} catch (e) {
				tt = "wirft";
			}
			emit({ k: "globals", id: "console." + m, st: tt === "undefined" ? "absent" : "ok", d: tt });
		}
	}

	function phaseLib() {
		var checks = [
			["Map", "var m = new Map([[1, 2]]); return m.get(1) === 2 && m.size === 1;"],
			["Set", "var s = new Set([1, 1, 2]); return s.size === 2 && s.has(1);"],
			["WeakMap", "var k = {}; var m = new WeakMap(); m.set(k, 1); return m.get(k) === 1;"],
			["Symbol", "return typeof Symbol('x') === 'symbol';"],
			["Proxy", "var p = new Proxy({}, {}); return typeof p === 'object';"],
			["Reflect", "return Reflect.has({a: 1}, 'a');"],
			["Promise", "return typeof Promise.resolve().then === 'function';"],
			["JSON", "return JSON.parse(JSON.stringify({a: 1})).a === 1;"],
			["Array.from", "return Array.from([1, 2]).length === 2;"],
			["Array.isArray", "return Array.isArray([]);"],
			["Number.isInteger", "return Number.isInteger(1) && !Number.isInteger(1.5);"],
			["Math.trunc", "return Math.trunc(1.7) === 1;"],
			["Date.now", "return typeof Date.now() === 'number';"],
			["String.raw", "return String.raw`a\\nb`.length === 4;"],
		];
		var i;
		for (i = 0; i < LIB_NAMES.length; i++) {
			emit({ k: "lib", id: "typeof " + LIB_NAMES[i], d: COMPILE ? typeOfGlobal(LIB_NAMES[i]) : "ungeprueft" });
		}
		if (!COMPILE) {
			return;
		}
		for (i = 0; i < checks.length; i++) {
			esTest(0, checks[i][0], checks[i][1]);
		}
	}

	// ------------------------------------------------------------------ Enums

	var ENUM_NAMES = [
		"ClientAreaOption", "ElectricBorder", "MaximizeMode", "WindowType", "Layer", "TabBoxMode",
		"PlacementArea", "MovementArea", "MaximizeArea", "MaximizeFullArea", "FullScreenArea",
		"WorkArea", "FullArea", "ScreenArea",
		"MaximizeRestore", "MaximizeVertical", "MaximizeHorizontal", "MaximizeFull",
		"NormalWindow", "DesktopWindow", "DockWindow", "DialogWindow",
	];

	function phaseEnums() {
		if (typeof KWin === "undefined") {
			emit({ k: "enum", id: "KWin", st: "absent" });
			return;
		}
		var listed = [];
		try {
			var kk;
			for (kk in KWin) {
				listed.push(kk);
			}
		} catch (e) {
			listed = ["<for-in wirft>"];
		}
		emit({ k: "enum", id: "for-in", d: listed.join(",") });
		try {
			emit({ k: "enum", id: "Object.keys", d: Object.keys(KWin).join(",") });
		} catch (e2) {
			emit({ k: "enum", id: "Object.keys", st: "error", d: String(e2) });
		}
		var i;
		for (i = 0; i < ENUM_NAMES.length; i++) {
			var n = ENUM_NAMES[i];
			var v;
			try {
				v = KWin[n];
			} catch (e3) {
				emit({ k: "enum", id: "KWin." + n, st: "error", d: String(e3) });
				continue;
			}
			var st = typeof v === "undefined" ? "absent" : "ok";
			var rec = { k: "enum", id: "KWin." + n, st: st, t: typeof v, d: brief(v) };
			if (v && typeof v === "object") {
				try {
					rec.keys = Object.keys(v).join(",");
				} catch (e4) {
					rec.keys = "?";
				}
			}
			emit(rec);
		}
	}

	// ------------------------------------------------- Oberflaechen-Enumeration

	function tryList(fn) {
		try {
			var r = fn();
			return r || [];
		} catch (e) {
			return [];
		}
	}

	function union() {
		var seen = {};
		var out = [];
		var i, j;
		for (i = 0; i < arguments.length; i++) {
			var arr = arguments[i] || [];
			for (j = 0; j < arr.length; j++) {
				var k = arr[j];
				if (typeof k === "string" && !seen[k] && k.charAt(0) !== "_") {
					seen[k] = true;
					out.push(k);
				}
			}
		}
		out.sort();
		return out;
	}

	// Liest nur, ruft nie auf. Kennzeichnet, ob der Name aufgezaehlt war oder
	// aus der Quelltext-Namensliste stammt -- das beantwortet nebenbei, ob sich
	// der spaetere Adapter auf Reflexion stuetzen darf.
	function describe(label, name, obj, fromEnum) {
		var v;
		try {
			v = obj[name];
		} catch (e) {
			emit({ k: "obj", o: label, id: name, st: "error", d: String(e) });
			return;
		}
		if (typeof v === "undefined") {
			if (!fromEnum) {
				emit({ k: "obj", o: label, id: name, st: "absent", src: "list" });
			}
			return;
		}
		var rec = {
			k: "obj",
			o: label,
			id: name,
			st: "ok",
			cls: classify(v),
			t: typeof v,
			d: brief(v),
			src: fromEnum ? "enum" : "list",
		};
		if (rec.cls === "rect") {
			try {
				rec.int = Number.isInteger(v.x) && Number.isInteger(v.y) && Number.isInteger(v.width) && Number.isInteger(v.height);
			} catch (e2) {
				rec.int = "?";
			}
		}
		emit(rec);
	}

	function surface(label, obj, names) {
		if (obj === null || typeof obj === "undefined") {
			emit({ k: "obj", o: label, id: "<objekt>", st: "absent" });
			return;
		}
		var viaIn = [];
		try {
			var kk;
			for (kk in obj) {
				viaIn.push(kk);
			}
		} catch (e) {
			viaIn = [];
		}
		var viaKeys = tryList(function () {
			return Object.keys(obj);
		});
		var viaOwn = tryList(function () {
			return Object.getOwnPropertyNames(obj);
		});
		var viaProto = tryList(function () {
			var p = Object.getPrototypeOf(obj);
			return p ? Object.getOwnPropertyNames(p) : [];
		});
		emit({
			k: "obj",
			o: label,
			id: "enum-mechanism",
			d: "forIn=" + viaIn.length + " keys=" + viaKeys.length + " own=" + viaOwn.length + " proto=" + viaProto.length,
		});
		var enumerated = union(viaIn, viaKeys, viaOwn, viaProto);
		var seen = {};
		var i;
		for (i = 0; i < enumerated.length; i++) {
			seen[enumerated[i]] = true;
			describe(label, enumerated[i], obj, true);
		}
		for (i = 0; i < names.length; i++) {
			if (!seen[names[i]]) {
				describe(label, names[i], obj, false);
			}
		}
	}

	var WORKSPACE_NAMES = [
		"desktops", "currentDesktop", "currentDesktopForScreen", "setCurrentDesktopForScreen",
		"activities", "currentActivity", "screens", "screenOrder", "activeScreen", "activeWindow",
		"windowList", "stackingOrder", "clientArea", "raiseWindow", "sendClientToScreen",
		"screenAt", "windowAt", "cursorPos", "virtualScreenSize", "virtualScreenGeometry",
		"workspaceSize", "desktopGridSize", "desktopGridWidth", "desktopGridHeight",
		"virtualDesktopNavigationWrapsAround", "rootTile", "tilingForScreen", "supportInformation",
		"createDesktop", "removeDesktop", "constrain", "isEffectActive", "showOutline", "hideOutline",
		"windowAdded", "windowRemoved", "windowActivated", "desktopsChanged", "screensChanged",
		"screenOrderChanged", "currentDesktopChanged", "currentDesktopChanging", "currentActivityChanged",
		"activitiesChanged", "activityAdded", "activityRemoved", "virtualScreenSizeChanged",
		"virtualScreenGeometryChanged", "cursorPosChanged", "desktopLayoutChanged",
	];

	var WINDOW_NAMES = [
		"frameGeometry", "clientGeometry", "bufferGeometry", "output", "minSize", "maxSize",
		"fullScreen", "fullScreenable", "minimized", "minimizable", "maximizeMode", "maximizable",
		"windowType", "normalWindow", "dialog", "dock", "splash", "utility", "popupWindow",
		"specialWindow", "desktopWindow", "toolbar", "menu", "notification", "criticalNotification",
		"onScreenDisplay", "transient", "transientFor", "modal", "managed", "deleted", "closeable",
		"resizeable", "moveable", "resourceClass", "resourceName", "desktopFileName", "caption",
		"internalId", "desktops", "activities", "onAllDesktops", "skipTaskbar", "skipPager",
		"skipSwitcher", "keepAbove", "keepBelow", "noBorder", "active", "move", "resize", "tile",
		"layer", "opacity", "shaded", "pid", "windowRole", "colorScheme", "hidden", "unresponsive",
		"providesContextHelp", "wantsInput", "tag", "description", "excludeFromCapture", "x11Window",
		"frameGeometryChanged", "outputChanged", "fullScreenChanged", "minimizedChanged",
		"maximizedChanged", "desktopsChanged", "activitiesChanged", "closed", "captionChanged",
		"windowClassChanged", "keepAboveChanged", "tileChanged", "skipTaskbarChanged",
		"interactiveMoveResizeStarted", "interactiveMoveResizeStepped", "interactiveMoveResizeFinished",
	];

	var OUTPUT_NAMES = [
		"name", "manufacturer", "model", "serialNumber", "geometry", "devicePixelRatio",
		"uuid", "enabled", "scale", "refreshRate", "transform", "dpmsMode", "geometryChanged",
	];

	var DESKTOP_NAMES = ["id", "name", "x11DesktopNumber", "nameChanged", "aboutToBeDestroyed"];

	// -------------------------------------------------------------- Workspace

	function phaseWorkspace() {
		if (typeof workspace === "undefined") {
			emit({ k: "ws", id: "workspace", st: "absent" }, true);
			return;
		}
		surface("workspace", workspace, WORKSPACE_NAMES);

		// Vier gutartige Aufrufe, an denen konkrete Entwurfsentscheidungen haengen.
		guard("ws.windowList", function () {
			var l = workspace.windowList();
			emit({
				k: "ws",
				id: "windowList()",
				st: "ok",
				d: "isArray=" + (Object.prototype.toString.call(l) === "[object Array]") +
					" len=" + l.length + " first=" + (l.length ? String(l[0]) : "-"),
			});
		});

		guard("ws.screens", function () {
			var s = workspace.screens;
			var o = workspace.screenOrder;
			emit({
				k: "ws",
				id: "screens",
				st: "ok",
				d: "screens=" + (s ? s.length : "-") + " order=" + (o ? o.length : "-"),
			});
			// Objektidentitaet ueber zwei getrennte Property-Zugriffe hinweg:
			// entscheidet, ob Map<Output, ...> ueberhaupt moeglich waere oder ob
			// output.name zwingend Schluessel bleibt (PLAN.md Abschnitt 2 Punkt 5).
			var again = workspace.screens;
			emit({
				k: "ws",
				id: "screen-identity",
				st: "ok",
				d: "same=" + (s && again && s[0] === again[0]),
			});
			var i;
			for (i = 0; s && i < s.length; i++) {
				emit({ k: "ws", id: "screen[" + i + "]", st: "ok", d: brief(s[i]) + " name=" + s[i].name });
			}
		});

		guard("ws.desktopForScreen", function () {
			emit({
				k: "ws",
				id: "perOutputVirtualDesktops",
				st: typeof options === "undefined" ? "absent" : "ok",
				d: typeof options === "undefined" ? "-" : String(options.perOutputVirtualDesktops),
			});
			var has = typeof workspace.currentDesktopForScreen === "function";
			emit({ k: "ws", id: "currentDesktopForScreen", st: has ? "ok" : "absent" });
			if (!has) {
				return;
			}
			var s = workspace.screens;
			var i;
			for (i = 0; s && i < s.length; i++) {
				var d = workspace.currentDesktopForScreen(s[i]);
				emit({
					k: "ws",
					id: "desktopForScreen[" + i + "]",
					st: "ok",
					d: "out=" + s[i].name + " id=" + (d ? d.id : "-") + " nr=" + (d ? d.x11DesktopNumber : "-"),
				});
			}
		});

		// clientArea numerisch ueber alle ClientAreaOption-Werte. Die Rects und
		// ihre Ganzzahligkeit entscheiden, ob core/rect mit Ganzzahlen arbeiten
		// darf oder runden muss (QRectF!).
		guard("ws.clientArea", function () {
			var s = workspace.screens;
			if (!s || !s.length) {
				return;
			}
			var d = workspace.currentDesktop;
			var opt;
			for (opt = 0; opt <= 7; opt++) {
				try {
					var r = workspace.clientArea(opt, s[0], d);
					emit({
						k: "ws",
						id: "clientArea(" + opt + ")",
						st: "ok",
						d: brief(r),
						int: Number.isInteger(r.x) && Number.isInteger(r.width),
					});
				} catch (e) {
					emit({ k: "ws", id: "clientArea(" + opt + ")", st: "error", d: String(e) });
				}
			}
		});
	}

	// ----------------------------------------------------------- Einzelobjekte

	function phaseObjects() {
		if (typeof workspace === "undefined") {
			return;
		}
		var list = [];
		guard("obj.list", function () {
			list = workspace.windowList() || [];
		});

		var normal = null;
		var dockWin = null;
		var i;
		for (i = 0; i < list.length; i++) {
			try {
				if (!normal && list[i].normalWindow) {
					normal = list[i];
				}
				if (!dockWin && list[i].dock) {
					dockWin = list[i];
				}
			} catch (e) {
				// Fenster kann zwischenzeitlich verschwunden sein.
			}
		}

		guard("obj.window", function () {
			surface("window", normal, WINDOW_NAMES);
		});
		guard("obj.dock", function () {
			if (dockWin) {
				surface("dock", dockWin, WINDOW_NAMES);
			} else {
				emit({ k: "obj", o: "dock", id: "<objekt>", st: "absent", d: "kein dock in windowList()" });
			}
		});
		guard("obj.active", function () {
			var a = workspace.activeWindow;
			emit({ k: "obj", o: "activeWindow", id: "<objekt>", st: a ? "ok" : "absent", d: brief(a) });
		});
		guard("obj.output", function () {
			var s = workspace.screens;
			surface("output", s && s.length ? s[0] : null, OUTPUT_NAMES);
		});
		guard("obj.desktop", function () {
			surface("desktop", workspace.currentDesktop, DESKTOP_NAMES);
		});
		guard("obj.options", function () {
			if (typeof options === "undefined") {
				return;
			}
			var interesting = [
				"perOutputVirtualDesktops", "focusPolicy", "placement", "borderSnapZone",
				"windowSnapZone", "centerSnapZone", "electricBorderMaximize", "activeMouseScreen",
				"rollOverDesktops", "condensedTitle",
			];
			for (i = 0; i < interesting.length; i++) {
				describe("options", interesting[i], options, false);
			}
		});
	}

	// ------------------------------------------------------------ readConfig

	function phaseConfig() {
		if (typeof readConfig !== "function") {
			emit({ k: "cfg", id: "readConfig", st: "absent" });
			return;
		}
		var cases = [
			["probeStr", "vorgabe"],
			["probeInt", 42],
			["probeBool", true],
			["probeList", "a,b,c"],
			["probeFehlt", "unberuehrt"],
		];
		var i;
		for (i = 0; i < cases.length; i++) {
			try {
				var v = readConfig(cases[i][0], cases[i][1]);
				emit({ k: "cfg", id: cases[i][0], st: "ok", t: typeof v, d: brief(v) });
			} catch (e) {
				emit({ k: "cfg", id: cases[i][0], st: "error", d: String(e) });
			}
		}
		try {
			var w = readConfig("probeOhneDefault");
			emit({ k: "cfg", id: "ohne-default", st: "ok", t: typeof w, d: brief(w) });
		} catch (e2) {
			emit({ k: "cfg", id: "ohne-default", st: "error", d: String(e2) });
		}
	}

	// ------------------------------------------------------------- callDBus

	function phaseDBus() {
		if (typeof callDBus !== "function") {
			emit({ k: "dbus", id: "callDBus", st: "absent" });
			return;
		}
		try {
			callDBus("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetId",
				function () {
					emit({ k: "dbus", id: "GetId-callback", st: "ok", d: "argc=" + arguments.length + " a0=" + brief(arguments[0]) });
				});
			emit({ k: "dbus", id: "GetId-aufruf", st: "ok", d: "abgesetzt, Antwort asynchron" });
		} catch (e) {
			emit({ k: "dbus", id: "GetId-aufruf", st: "error", d: String(e) });
		}
	}

	// ------------------------------------------------------------ Shortcuts

	// Standardmaessig aus. Grund: registerShortcut ruft KGlobalAccel::setShortcut
	// OHNE NoAutoloading -- ein Eintrag in kglobalshortcutsrc bleibt nach dem
	// Entladen bestehen und reserviert die Taste weiter (genau das Muster der
	// toten Krohnkite-Zeilen). Aktivieren mit
	//   kwriteconfig6 --file kwinrc --group Script-kwin-xmonad-lite-probe \
	//     --key probeShortcuts true
	// und danach zwingend den Rueckbau aus scripts/probe.sh fahren.
	function phaseShortcuts() {
		var wanted = false;
		try {
			wanted = readConfig("probeShortcuts", false) === true || readConfig("probeShortcuts", false) === "true";
		} catch (e) {
			wanted = false;
		}
		if (!wanted) {
			emit({ k: "shortcut", id: "phase", st: "absent", d: "probeShortcuts nicht gesetzt" });
			return;
		}
		if (typeof registerShortcut !== "function") {
			emit({ k: "shortcut", id: "registerShortcut", st: "absent" });
			return;
		}
		function cb(name) {
			return function () {
				emit({ k: "shortcut", id: "ausgeloest:" + name, st: "ok" }, true);
			};
		}
		// Nur Wegwerf-Namen im eigenen Namensraum auf Tasten, die kein KDE-Default
		// belegt. Reale Bindungen (Meta+L, Meta+T) werden nicht angefasst.
		var r1 = registerShortcut("kxlprobe-a", "kxlprobe A", "Meta+Alt+Shift+F9", cb("a"));
		emit({ k: "shortcut", id: "register-a", st: "ok", d: "rc=" + String(r1) });
		var r2 = registerShortcut("kxlprobe-a", "kxlprobe A zweitens", "Meta+Alt+Shift+F10", cb("a2"));
		emit({ k: "shortcut", id: "register-a-doppelt", st: "ok", d: "rc=" + String(r2) });
		var r3 = registerShortcut("kxlprobe-b", "kxlprobe B", "Meta+Alt+Shift+F9", cb("b"));
		emit({ k: "shortcut", id: "register-b-kollision", st: "ok", d: "rc=" + String(r3) }, true);
	}

	// ---------------------------------------------------------------- QTimer

	function finish() {
		emit({ k: "end", st: "ok", total: SEQ, errors: ERRORS }, true);
	}

	var TIMERS = []; // Referenzen halten: JavaScriptOwnership, sonst drohte GC.

	function phaseTimer() {
		if (typeof QTimer === "undefined") {
			emit({ k: "timer", id: "QTimer", st: "absent" }, true);
			finish();
			return;
		}
		var t;
		try {
			t = new QTimer();
		} catch (e) {
			emit({ k: "timer", id: "new QTimer", st: "error", d: String(e) }, true);
			finish();
			return;
		}
		TIMERS.push(t);
		var names = ["start", "stop", "interval", "singleShot", "active", "timeout", "restart", "remainingTime"];
		var i;
		for (i = 0; i < names.length; i++) {
			describe("qtimer", names[i], t, false);
		}
		emit({ k: "timer", id: "QTimer.singleShot-statisch", d: typeof QTimer.singleShot });

		var t0 = new QTimer(); // absichtlich ohne Referenz in TIMERS
		var t0Fired = false;
		try {
			t0.singleShot = true;
			t0.interval = 40;
			t0.timeout.connect(function () {
				t0Fired = true;
			});
			t0.start();
		} catch (e2) {
			emit({ k: "timer", id: "t0-setup", st: "error", d: String(e2) });
		}

		var started = Date.now();
		var ticks = 0;
		var repeater = new QTimer();
		TIMERS.push(repeater);

		try {
			t.singleShot = true;
			t.interval = 20;
			t.timeout.connect(function () {
				emit({
					k: "timer",
					id: "singleshot-20ms",
					st: "ok",
					d: "latenz=" + (Date.now() - started) + "ms",
				});
				// Zweite Stufe: Wiederholtimer, drei Ticks, dann stop().
				repeater.singleShot = false;
				repeater.interval = 30;
				repeater.timeout.connect(function () {
					ticks++;
					if (ticks === 3) {
						repeater.stop();
						emit({ k: "timer", id: "repeat-30ms", st: "ok", d: "ticks=" + ticks + " active=" + String(repeater.active) });
						var closer = new QTimer();
						TIMERS.push(closer);
						closer.singleShot = true;
						closer.interval = 300;
						closer.timeout.connect(function () {
							emit({
								k: "timer",
								id: "nach-stop",
								st: ticks === 3 ? "ok" : "value",
								d: "ticks=" + ticks + " unreferenzierter-timer-feuerte=" + String(t0Fired),
							});
							var j;
							for (j = 0; j < TIMERS.length; j++) {
								try {
									TIMERS[j].stop();
								} catch (e5) {
									// egal, wir gehen ohnehin
								}
							}
							TIMERS.length = 0;
							finish();
						});
						closer.start();
					}
				});
				repeater.start();
			});
			t.start();
		} catch (e3) {
			emit({ k: "timer", id: "timer-kette", st: "error", d: String(e3) }, true);
			finish();
		}
	}

	// ------------------------------------------------------------------ Start

	emit({ k: "meta", id: "start", st: "ok", d: "kwin-xmonad-lite Feature-Probe" }, true);
	chooseHarness();
	guard("globals", phaseGlobals);
	guard("es", phaseEs);
	guard("lib", phaseLib);
	guard("enum", phaseEnums);
	guard("ws", phaseWorkspace);
	guard("obj", phaseObjects);
	guard("cfg", phaseConfig);
	guard("dbus", phaseDBus);
	guard("shortcut", phaseShortcuts);
	guard("timer", phaseTimer);
})();
