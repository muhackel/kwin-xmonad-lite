# Quellen und Messergebnisse

Fortgeschriebenes Verzeichnis aller Quellen, aus denen technische Aussagen im
Projekt stammen, sowie der auf der Maschine gemessenen Ergebnisse. Modellwissen
ist keine Quelle: was hier nicht steht, ist nicht belegt.

## 1. Quellen (Abruf 2026-09-05)

| Quelle | Stand | Lizenz | Verwendet für |
|---|---|---|---|
| KWin-Quellcode `kdePackages.kwin.src` aus dem nixpkgs-Pin | 6.7.4 (Qt 6.11.2) | GPL-2.0-or-later | Scripting-API, Geometriepfad, Activities, Per-Output-Desktops, Reload-Zyklus |
| kglobalacceld-Quellcode aus dem Pin | 6.7.4 | GPL-2.0-or-later | Konfliktverhalten bei Tastenkürzeln |
| `~/.config/{kglobalshortcutsrc,kwinrc,kactivitymanagerdrc}` auf SPIELKISTE | 2026-09-05 | – | Konfliktprüfung, Altlasten, Desktop- und Ausgabezahl |
| `nixosconfig/sources/xmonad/xmonad.hs` | vorliegend | – | Ratio 65 %, Schritt 5 %, Layoutreihenfolge, Tastenbelegung |
| `~/Desktop/{xmonad,kde}-bindings.md` | vorliegend | – | Belegung, persönliche Abweichungen |
| Polonium `github.com/zeroxoneafour/polonium` `afc713f6` | 2026-07-31 | MIT | Event-Dedup, Schlüsselbildung |
| Tessera `github.com/IamAndelib/Tessera` `d66fbad4` | 2026-09-03 | MIT | Float-Restore, Init-Retry, ES-Target-Begründung |
| Aerogel `codeberg.org/bovfbovf/aerogel` `29d16d1c` | 2026-05-26 | GPL-3.0-or-later | nur Ideen, kein Code |
| Krohnkite `codeberg.org/anametologin/Krohnkite` 0.9.9.2 `1d7fd742` | 2025-07-25 | MIT | Tall-Split, Surface-Schlüssel |
| Karousel `github.com/peterfajdiga/karousel` v0.17 `d14c8fbd` | 2026-06-07 | GPL-3.0 | nur Ideen, kein Code |
| nixpkgs-Derivationen polonium/krohnkite/karousel/kzones/dynamic-workspaces, `nixos/tests/plasma6.nix`, `nixos/tests/cardwire.nix`, Test-Driver | Pin `8a37cfb9` | MIT | Packaging-Muster, Test-VM (X11-Bindung von `wait_for_window`, zwei Outputs über `virtio-gpu`) |
| `nixosconfig/{CLAUDE.md,flake.nix,flake.lock,modules/user/muhackel/home.nix}` | vorliegend | – | Konventionen, Pin-Abgleich, Einbindung über Home Manager |
| plasma-manager `github.com/nix-community/plasma-manager` `a19a2a02` (`modules/kwin.nix`, `shortcuts.nix`, `files.nix`) | trunk | – | Aktivierung und Shortcuts im Home-Manager-Modul (Meilenstein 6) |
| `develop.kde.org/docs/plasma/kwin/` und `…/api/` | dokumentiert KWin **6.0** | – | nur Installationskommandos; `…/packaging/` ist 404 |
| `kde.org/announcements/plasma/6/6.7.0/`, `community.kde.org/Plasma/Plasma_6` | 2026-06-16 | – | Per-Screen-Desktops bestätigt, ohne technische Details |
| `docs.kde.org` Plasma-Handbuch, Activities-Seite | Plasma 5.20 | – | inhaltlich unergiebig; Activity-Semantik deshalb aus dem KWin-Code |

Die vollständige Zuordnung „welche Idee stammt aus welcher Quelle" steht im
Anhang von [`../PLAN.md`](../PLAN.md).

## 2. Feature-Probe, Meilenstein 0

Gemessen am 2026-09-05 auf SPIELKISTE, KWin 6.7.4 auf Wayland, drei Ausgaben.
Rohdaten: [`probe-2026-09-05-spielkiste.ndjson`](probe-2026-09-05-spielkiste.ndjson)
(682 Sätze), erzeugt mit `nix run .#probe`. Vor der Veröffentlichung wurden
darin drei Zeichenkettenwerte maskiert: `window.caption`,
`window.captionNormal` und `output.serialNumber`. Alles Übrige ist unverändert.

### 2.1 Sprachniveau der QJSEngine

**Ergebnis: `es2016`.** Das ist die höchste Stufe, auf der kein Prüfling
scheitert. Die Plan-Annahme `es2017` ist damit widerlegt.

Am Parser gescheitert (`SyntaxError`):

| Konstrukt | Stufe |
|---|---|
| `async` / `await` | ES2017 |
| Objekt-Spread `{...o}` und Objekt-Rest `{a, ...r}` | ES2018 |
| Optional Catch Binding `catch {}` | ES2019 |
| Logische Zuweisung `??=`, `\|\|=`, `&&=` | ES2021 |
| Klassenfelder (öffentlich, statisch, privat), statische Blöcke | ES2022 |

Vorhanden und nutzbar: `let`/`const`, Pfeilfunktionen, Template Literals,
Destrukturierung samt Vorgaben, Rest- und Spread-Parameter, Array-Spread,
Kurzschreibweise, berechnete Schlüssel, `for...of`, Klassen mit Methoden,
Gettern, Settern, statischen Methoden und `extends`, Generatoren,
`Symbol.iterator`, `**`, `Object.entries`/`values`,
Optional Chaining `?.`, Nullish Coalescing `??`, numerische Trennzeichen.

**Nachtrag Meilenstein 3, korrigiert:** *Benannte Regex-Gruppen* standen hier
zunächst unter „vorhanden". Die Messung sagt etwas anderes — Satz `n=68` meldet
`st: "runtime"` mit `TypeError: Cannot read property 'y' of undefined`. Der
Ausdruck `/(?<y>\d+)/` **parst**, aber `match.groups` bleibt `undefined`.
Konsequent führt der `es-summary`-Satz `regex-named-groups` in seiner
`failed`-Liste. `.groups` darf im Quelltext nicht vorkommen.

Bemerkenswert: `?.` und `??` funktionieren, die zugehörigen
Zuweisungsoperatoren `??=` und `||=` nicht.

**Fehlende Bibliotheksfunktionen** — esbuild transpiliert Syntax, liefert aber
keine Polyfills. Diese Namen dürfen im Quelltext nicht vorkommen:
`globalThis`, `Object.fromEntries`, `Object.hasOwn`, `Array.prototype.flat`,
`flatMap`, `at`, `findLast`, `toSorted`, `String.prototype.replaceAll`,
`trimStart`, `matchAll`, `at`, `Promise.allSettled`, `Promise.any`.

Vorhanden: `Map`, `Set`, `WeakMap`, `WeakSet`, `Symbol`, `Proxy`, `Reflect`,
`Promise`, `JSON`, `Array.from`, `Array.isArray`, `Number.isInteger`,
`Math.trunc`, `Date.now`, `String.raw`.

### 2.2 Globals

Vorhanden: `console`, **`print`**, `readConfig`, `registerShortcut`,
`callDBus`, `registerScreenEdge`, `unregisterScreenEdge`,
`registerTouchScreenEdge`, `unregisterTouchScreenEdge`,
`registerUserActionsMenu`, `options`, `KWin`, `workspace`, `QTimer`,
`assert`, `assertTrue`, `assertFalse`, `assertEquals`, `assertNull`,
`Function`, `eval`.

`console` bietet `log`, `debug`, `info`, `warn`, `error`, `assert`, `count`,
`time`, `timeEnd`, `trace` — nicht `dir`.

Nicht vorhanden: `setTimeout`, `setInterval`, `requestAnimationFrame`, `Qt`,
`gc`, `XMLHttpRequest`, `globalThis`.

`print` existiert also doch — die KWin-Anleitung hatte recht, der Quelltext
belegte es an der untersuchten Stelle nur nicht. Das Projekt verwendet
trotzdem `console.log`, weil es im Journal mit Kategorie erscheint.

### 2.3 `KWin`-Enums

`KWin` ist eine Funktion (Metaobject-Wrapper). `Object.keys(KWin)` und
`for...in` liefern **nichts** — Reflexion ist hier nicht möglich, Namen müssen
bekannt sein.

Die `ClientAreaOption`-Werte liegen **flach** auf `KWin` und sind Zahlen:

| Name | Wert |
|---|---|
| `KWin.PlacementArea` | 0 |
| `KWin.MovementArea` | 1 |
| `KWin.MaximizeArea` | 2 |
| `KWin.MaximizeFullArea` | 3 |
| `KWin.FullScreenArea` | 4 |
| `KWin.WorkArea` | 5 |
| `KWin.FullArea` | 6 |
| `KWin.ScreenArea` | 7 |

Ein geschachteltes `KWin.ClientAreaOption` gibt es nicht. `KWin.MaximizeMode`,
`KWin.WindowType` und `KWin.Layer` existieren ebenfalls nicht — diese Werte
sind numerisch zu vergleichen, wie im Plan vorgesehen.

### 2.4 `workspace`

`Object.keys(workspace)` liefert 122 Einträge, Reflexion funktioniert hier
also. Gemessene Rückgaben:

- `windowList()` ist **kein echtes Array** (`Array.isArray` ist `false`),
  sondern array-artig mit `length` und Indexzugriff. Dasselbe gilt für
  `desktops` und `activities` eines Fensters. Ein `.map`/`.filter` darauf
  schlägt fehl; es ist manuell zu iterieren.
- `screens` und `screenOrder` haben je drei Einträge. Die Objektidentität
  eines Ausgabeobjekts ist über getrennte Property-Zugriffe hinweg **stabil**
  (`screens[0] === screens[0]` erneut gelesen).
- `currentDesktopForScreen(output)` existiert und liefert je Ausgabe ein
  `VirtualDesktop` mit `id` (UUID ohne Klammern) und `x11DesktopNumber`.
- `options.perOutputVirtualDesktops` ist `false` (Voreinstellung), alle
  Ausgaben melden denselben Desktop.
- `clientArea` liefert **ganzzahlige** Rechtecke. `core/rect` darf also mit
  Ganzzahlen rechnen. Der Panelabzug ist sichtbar: `MaximizeArea` (2) ergibt
  2560×1410, `FullScreenArea` (4) dagegen 2560×1440.

### 2.5 Fenster und Ausgaben

`Object.keys` liefert für ein Fenster 160, für eine Ausgabe 18 Einträge.
Signale sind Funktionen mit `.connect`/`.disconnect`, keine eigenen Objekte.

- `internalId` ist ein Objekt; seine Zeichenkettenform trägt geschweifte
  Klammern: `{551b13a0-8e8f-4ea7-8a1b-aabef935b185}`. Das ist der
  Registry-Schlüssel.
- `maxSize` meldet für „unbegrenzt" `2147483647` in beiden Richtungen.
- `output` ist ein `KWin::LogicalOutput`, `tile` war `null`.
- Eine Ausgabe bietet `name` (`DP-1`), `manufacturer`, `model`,
  `serialNumber`, `geometry`, `devicePixelRatio`, `mapToGlobal`,
  `mapFromGlobal`. **Nicht** vorhanden: `uuid`, `enabled`, `scale`,
  `refreshRate`, `transform`, `dpmsMode` — wie im Plan vermutet.
  `serialNumber` wäre ein portstabilerer Schlüssel als `name`; zu prüfen in
  Meilenstein 4.
- Das untersuchte Fenster war im Vollbild und meldete dabei
  `moveable = false` und `resizeable = false`. Siehe die Folgerung in
  [`../CLAUDE.md`](../CLAUDE.md).

### 2.6 `QTimer`

Konstruierbar mit `new QTimer()`. `singleShot`, `interval`, `start`, `stop`,
`active`, `timeout` und `remainingTime` (anfangs `-1`) sind vorhanden.

**Nicht vorhanden:** `restart` (Satz `n=674`, `st: "absent"`) und
`QTimer.singleShot` als statische Funktion. Diese Zeile führte `restart`
zunächst fälschlich unter den vorhandenen Methoden; in Meilenstein 3 an den
Rohdaten korrigiert. Zum Neustarten also `stop()` und `start()`.

Gemessen: ein Einmal-Timer mit `interval = 20` feuerte nach **21 ms** — das im
Plan vorgesehene Koaleszierungsfenster ist tragfähig. Ein Wiederholtimer mit
30 ms lieferte drei Ticks und stand nach `stop()` (`active === false`). Ein
Timer ohne gehaltene Referenz feuerte ebenfalls; Referenzen zu halten bleibt
trotzdem die sichere Variante.

### 2.7 `readConfig`

Liest `kwinApp()->config()->group("Script-" + pluginName)` und funktioniert
**ohne** installiertes KPackage und ohne `contents/config/main.xml`. Der
Rückgabetyp folgt dem Typ des Vorgabewerts (String, Zahl, Boolean). Ohne
Vorgabewert kommt `undefined`.

**Fallstrick:** Neu geschriebene Werte werden erst nach dem Neueinlesen
sichtbar, und `Workspace::reconfigure()` startet dafür nur
`reconfigureTimer.start(200)` (`workspace.cpp:1000`). Zwischen dem D-Bus-Aufruf
`reconfigure` und dem Laden des Skripts muss also gewartet werden. Im ersten
Probelauf fehlte diese Wartezeit, und `readConfig` lieferte ausschließlich die
Vorgabewerte; mit einer Sekunde Wartezeit kamen die gesetzten Werte an.

### 2.8 `callDBus`

Funktioniert; der Callback wurde mit einem Argument aufgerufen
(`org.freedesktop.DBus.GetId`).

### 2.9 Nicht gemessen

Die Shortcut-Phase (`nix run .#probe -- --shortcuts`) lief in diesem Durchgang
nicht. Aus dem Quelltext steht fest: `registerShortcut` liefert `true`, solange
der Rückruf aufrufbar ist, und ruft `KGlobalAccel::setShortcut` **ohne**
`NoAutoloading` auf — ein vorhandener Eintrag in `kglobalshortcutsrc`
überschreibt damit die im Code angegebene Taste. Empirisch offen bleibt die
Reihenfolge bei zwei Aktionen auf derselben Taste. Zu klären in Meilenstein 6.

## 3. Signalprobe, Meilenstein 4

Gemessen am 2026-09-05 auf SPIELKISTE (KWin 6.7.4, drei Ausgaben DP-1, DP-9,
DP-10, vier virtuelle Desktops, eine Activity) mit `nix run .#probe-signals`.
Rohdaten: `docs/signals-2026-09-05-spielkiste-1.ndjson` (Handgriffe an der
Panelhöhe, Hotplug) und `-2.ndjson` (Desktop und Activity anlegen und
entfernen, Hotplug), beide mit der Probe aus Meilenstein 4; dazu `-3.ndjson`,
der Vollauf mit `--hotplug` aus der Abnahme von Meilenstein 4.1.1 (Exit 0,
zehn Prüfungen), dessen `end`-Satz bereits `cut_tot` und `cut_fehler` trägt.
Die Probe verbindet echte KWin-Signale und weist im `end`-Satz nach, dass sie
vor dem Ende **jede** Verbindung getrennt und jeden eigenen Timer gestoppt hat
(`offen: 0`, `timer_aktiv: 0`); das Skript wertet diesen Satz aus und lässt
jede Abweichung in seinen Exit-Code laufen, und es weist zusätzlich nach, dass
nach dem Entladen keine Zeile mehr kommt.

### 3.1 Signaturen der Workspace-Signale

| Signal | Argumente | Bemerkung |
|---|---|---|
| `currentDesktopChanged` | **3**: `(prev, cur, output)` | `prev`/`cur` sind `VirtualDesktop`, `output` ein `LogicalOutput` |
| `currentActivityChanged` | **1**: die neue Activity-UUID als String | |
| `activitiesChanged` | **1**: die hinzugefügte bzw. entfernte UUID | feuert **nicht** beim Wechseln |
| `desktopsChanged` | **0** | feuert **nicht** beim Wechseln |
| `screensChanged` | 0 | |
| `screenOrderChanged` | 0 | |
| `virtualScreenGeometryChanged` | 0 | |
| `windowAdded` / `windowRemoved` | 1: das Fenster | bei `windowRemoved` nicht anfassen |

Zwei Befunde, die den Bau bestimmen:

- **`currentDesktopChanged` feuert einmal je Ausgabe**, auch bei
  `options.perOutputVirtualDesktops = false`. Ein einziger Desktopwechsel
  erzeugte auf drei Ausgaben drei Signale (48 Signale bei 16 Wechseln). Die
  Entprellung fasst sie zu einem Lauf zusammen.
- **Während der Signalfolge ist `workspace.currentDesktop` noch nicht
  umgestellt.** Beim ersten der drei Signale meldete `currentDesktopForScreen`
  bereits den neuen Desktop für die betroffene Ausgabe, `currentDesktop` aber
  noch den alten. Wer im Signal-Callback liest, liest einen Zwischenstand —
  ein weiterer Grund, dort nur zu entprellen und erst im Lauf zu lesen.

`activitiesChanged` und `desktopsChanged` sind **nur** Anlege- und
Entfernensignale. Für den Registry-GC ist genau das der richtige Auslöser; ein
Wechsel ändert die Menge gültiger Activities und Desktops nicht.

### 3.2 `workspace.desktops`

Vorhanden und array-artig, vier Einträge mit `id` (UUID **ohne** Klammern) und
`x11DesktopNumber`. Damit lässt sich die Ist-Menge für `purgeSurfaces` bauen.

### 3.3 Panel und `clientArea`

Ein Dock **feuert** `frameGeometryChanged`, wenn die Panelhöhe geändert wird:
beim Ziehen des Höhenreglers kamen acht Signale (30 → 32 → 34 → 32 → 30 px).

Entscheidend ist der zweite Teil: **`clientArea` ist im Moment des Signals noch
die alte.** Beim Wiederanstecken von DP-10 (in beiden Läufen gleich) meldete
sie

| Zeitpunkt | Messung |
|---|---|
| sofort im Signal | `DP-1=2560x1410+0+0 DP-9=…+2560+0 DP-10=2560x1440+0+0` — alte Versätze, kein Panelabzug auf DP-10 |
| nach 500 ms | Versätze richtig, aber `DP-9=2560x1440` — noch ein Zwischenstand |
| nach 1500 ms | alles richtig: dreimal `2560x1410` mit den neuen Versätzen |

Ein Lauf allein auf das Signal hin rechnet also mit falschen Flächen. Die
verzögerten Nachläufe bei 500 **und** 1500 ms sind beide nötig — 500 ms allein
traf einen Zwischenstand. Sie hängen deshalb nicht nur an `screensChanged`,
sondern auch an den Dock-Signalen.

**Der reine Panelhöhenwechsel verhält sich anders** — nachgetragen aus der
Abnahme von Testmatrix 10 (SPIELKISTE, drei Ausgaben): auf `dockGeometrie`
folgte ein Lauf mit `fläche=2560x1404` statt der vorherigen `1410`, die Fläche
war dort also bereits neu. Gemessen ist damit der **entprellte Lauf** rund
20 ms nach dem Signal, nicht der Moment des Signals selbst — dieser Zeitpunkt
bleibt für den Panelfall unbelegt. Für die Nachläufe genügt das: sie sind hier
nur Absicherung, während sie nach einer Ausgabenänderung tragen.

### 3.4 Reihenfolge beim Hotplug

Beobachtet beim Abschalten und Wiederanschalten von DP-10 über
`kscreen-doctor`, in beiden Läufen identisch. Alles innerhalb weniger
Millisekunden:

1. `screenOrderChanged`
2. `windowRemoved` der Docks der verschwindenden Ausgabe, dazu deren `closed`
3. `frameGeometryChanged` der verbleibenden Docks
4. `outputChanged` der einzelnen Fenster
5. `virtualScreenGeometryChanged`
6. **`screensChanged` zuletzt**

Ein `outputAdded` oder `outputRemoved` gibt es auf `workspace` nicht;
`screensChanged` ist das einzige Signal über die Menge der Ausgaben. Es kommt
am Ende der Folge — wer darauf entprellt anordnet, sieht eine vollständige
Ausgabenliste. Die Flächen sind zu diesem Zeitpunkt trotzdem noch nicht fertig,
siehe 3.3.

Nach dem Wiederanschalten kamen die Panels als **neue** Fenster
(`windowAdded`), die alten wurden mit `closed` beendet. Ein Dock ist also kein
langlebiges Objekt; seine Beobachtung muss über `windowAdded` mitwachsen und
über `closed` mit der Id aus der Closure abbauen.

### 3.5 `disconnect` an einem gelöschten QObject

In jedem vollständigen Lauf endeten einige Trennungen im Abschluss der Probe
mit `Error: Function.prototype.disconnect: cannot disconnect from deleted
QObject` (vier im Lauf `docs/signals-2026-09-05-spielkiste-3.ndjson`, dort als
`cut`-Sätze mitgeschrieben und im `end`-Satz als `cut_tot: 4` gezählt; fünf und
dreizehn in den Läufen `-1` und `-2`). Betroffen sind die
Fensterverbindungen von Panels, die während der Laufzeit verschwanden — beim
Ändern der Panelhöhe und beim Hotplug.

Das ist kein Fehler: mit dem QObject stirbt auch die Verbindung, es gibt nichts
mehr zu trennen. Die Zahl ist aber **kein fester Wert** — sie hängt daran, wie
viele Panels während des Laufs sterben, also am Bedienablauf. Wer Trennungen
zählt, muss deshalb zwei Fälle unterscheiden: das tote QObject (gilt als
getrennt, rein informativ) und jeden anderen Wurf (die Verbindung bleibt offen
und ist eine Beanstandung). `runCut` in `dev/probe/signals.js` tut genau das
und meldet beide Zahlen im `end`-Satz als `cut_tot` und `cut_fehler`.

## 4. Quelltextbefunde, Meilenstein 5

Geprüft am 2026-09-05 im Quelltext von KWin 6.7.4 aus dem nixpkgs-Pin
(`/nix/store/hi0chbrrdrl3wbixs262qjw5snjyn51n-kwin-6.7.4.tar.xz`).

### 4.1 Fenstermenü für den Entwicklungs-Toggle

`registerUserActionsMenu(callback)` ruft den Callback bei jedem Öffnen des
Fenstermenüs mit dem betroffenen `Window` auf (`scripting.cpp:461-497`). Der
Callback liefert einen Eintrag `{text, triggered}` oder ein Untermenü über
`items`; `checkable` und `checked` werden ebenfalls gelesen. `triggered`
erhält die `QAction`, nicht das Fenster. Der Callback muss das Fenster daher in
seiner Closure halten.

KWin baut das Untermenü „Extensions" bei jedem Öffnen aus den gerade geladenen
Skripten neu (`useractions.cpp:350-363`, `scripting.cpp:893-902`). Nach
`unloadScript` bleibt kein Menüeintrag zurück.

### 4.2 Teilweise Maximierung

`XdgToplevelWindow::updateMaximizeMode` emittiert `maximizedChanged()` bei
jedem Wechsel des Modus (`xdgshellwindow.cpp:1484-1492`). Das umfasst die
numerischen Modi 1 (vertikal), 2 (horizontal) und 3 (vollständig).

### 4.3 Geometrieschreiben kennt keinen Zustandswächter

`Window::moveResize` prüft vor dem Schreiben nur `isDeleted()`
(`window.cpp:3412-3420`). Die Methode schützt nicht vor einem Write in ein
maximiertes oder Vollbildfenster. Deshalb prüfen sowohl die Epoche als auch der
Nachprüfungspfad die Layout-Teilnahme vor dem Schreiben.

### 4.4 Reproduzierbare Fensteraktionen

In `~/.config/kglobalshortcutsrc` unter `[kwin]` existieren die Aktionen
`Window Fullscreen`, `Window Maximize`, `Window Maximize Horizontal`,
`Window Maximize Vertical` und `Window Minimize`. Die D-Bus-Introspektion von
`org.kde.kglobalaccel /component/kwin` weist dafür `invokeShortcut s` aus. Die
Live-Abnahme kann diese Zustände damit ohne neue Tastenbelegung auslösen.

## 5. Livebefunde, Meilenstein 5

Gemessen am 2026-09-06 auf SPIELKISTE mit KWin 6.7.4.

Der Tk-Testclient mit `wm_grid(0, 0, 20, 10)` veröffentlichte laut `xprop`
einen Rasterabstand von `20x10` und eine Basisgröße von `111x69`. KWin nahm
die direkte `frameGeometry`-Zuweisung trotzdem exakt an; die X11-Clientgröße
`896x254` liegt in beiden Achsen fünf Pixel neben diesem Raster. Das Raster
eignet sich daher nicht als reproduzierbarer Give-up-Auslöser.

Der native Wayland-Client foot quittierte dagegen ein Soll von `896x235` als
`894x223`. Der Controller schrieb einmal und besserte zweimal nach, danach
folgte genau ein `aufgegeben`. Vor dem MS-5-Nachschlag startete jede spätere
Epoche denselben Zyklus neu. Mit dem Sperrmerkmal aus Soll, Ist und
`MAX_CORRECTIONS` blieb ein anschließender Fokuslauf ohne weiteren Write.
