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
| XMonad-Contrib [`XMonad/Layout/Grid.hs`](https://raw.githubusercontent.com/xmonad/xmonad-contrib/a60c385b92bf3ab54e08d6b22c6602f8fee3b9b7/XMonad/Layout/Grid.hs) | Pin `a60c385b92bf3ab54e08d6b22c6602f8fee3b9b7`, gelesen 2026-09-12 | BSD-3-Clause | Grid-Zielverhältnis 16:9, Spaltenwahl und spaltenweise Reihenfolge als mathematische Idee |
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

**Folge für den Entwurf (Meilenstein 6): der Adapter liest Rohzeichenketten.**
Weil der Rückgabetyp dem Typ des Vorgabewerts folgt, reicht `readConfig` an
`KConfigGroup::readEntry(key, default)` durch — und KConfig ersetzt einen nicht
konvertierbaren Eintrag **bereits selbst** durch den Vorgabewert. Mit
`Number(readConfig("gapOuter", 0))` käme für `gapOuter=abc` schlicht `0` an,
ununterscheidbar von „nicht gesetzt"; die versprochene Korrekturnotiz wäre nie
zu erzeugen. Der Adapter liest deshalb gegen einen **Sentinel-Vorgabewert**
(`RAW_UNSET = "<kxl-unset>"` in `src/kwin/config.ts`): jede Eingabe kommt
unverfälscht durch, „nicht gesetzt" ist am Sentinel erkennbar, und die gesamte
Umwandlung, Prüfung und Klemmung liegt hinter der Snapshot-Grenze unter
`node --test`. Aus demselben Grund gilt ein Rohwert aus reinem Leerraum als
unlesbar und nicht als `0` — `Number("")` ist `0` und damit endlich.

Gelesen wird **einmal**, am Anfang von `start()`. Eine Epoche, die ihre Werte
je Lauf neu holte, hinge an veränderlichem Außenzustand, ohne je einen anderen
Wert zu sehen. Das zweistufige Wirksamkeitsverfahren, das daraus folgt, steht
in [`keys.md`](keys.md) Abschnitt 3.

### 2.8 `callDBus`

Funktioniert; der Callback wurde mit einem Argument aufgerufen
(`org.freedesktop.DBus.GetId`).

### 2.9 Shortcut-Konflikte — in Meilenstein 6 aufgelöst

Die Shortcut-Phase (`nix run .#probe -- --shortcuts`) lief in diesem Durchgang
nicht. Aus dem Quelltext stand fest: `registerShortcut` liefert `true`, solange
der Rückruf aufrufbar ist, und ruft `KGlobalAccel::setShortcut` **ohne**
`NoAutoloading` auf — ein vorhandener Eintrag in `kglobalshortcutsrc`
überschreibt damit die im Code angegebene Taste. Empirisch offen blieb die
Reihenfolge bei zwei Aktionen auf derselben Taste.

**Gemessen am 2026-09-06** (Abschnitt 6.1): beide Aktionen stehen danach
gleichzeitig in der Datei, und beim Tastendruck gewinnt der **vorhandene**
Eintrag. Die Frage ist damit beantwortet; die Konsequenz — die Umlegung der
beiden KDE-Kürzel ist Voraussetzung, nicht Absicherung — steht in
[`keys.md`](keys.md) Abschnitt 1.

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
`cut`-Sätze mitgeschrieben und im `end`-Satz als `cut_tot: 4` gezählt;
dreizehn im Lauf `-1` und fünf im Lauf `-2`, dort jeweils an den `cut`-Sätzen
abzuzählen, weil beide `end`-Sätze die Zähler noch nicht trugen). Betroffen sind die
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

### 5.1 Zustandsübergänge und Float

Ein kontrollierter transienter Dialog blieb außerhalb von Mitgliedschaft und
Placements; sein gekacheltes Elternfenster wurde beim Öffnen nicht erneut
geschrieben (Matrix 11). Vollbild sowie die Maximierungsmodi 3, 2 und 1 nahmen
das Testfenster jeweils aus den Layout-Teilnehmern. Nach dem Zurückschalten kam
es in dieselbe Stapelzelle zurück; während des Sonderzustands gab es für seine
ID weder `apply` noch `nachbessern` (Matrix 12 und 12a). Dasselbe galt für
Minimieren und Wiederherstellen (Matrix 13).

Matrix 14 wurde mit dem Dev-Fenstermenü und einem manuellen Ziehvorgang
abgenommen. Das Testfenster `{72a350c5-08b0-4bdb-956a-d52eabad2d35}` kehrte
beim Einkacheln nach `896x705+4224+705` zurück. Das nächste Umschalten meldete
`float … soll=896x705+3649+368` und `→ wiederhergestellt`, ohne `apply` auf
diese ID. Der Menüeintrag war im Float-Zustand angehakt.

### 5.2 Größenschranken und Werkzeugrückbau

Die Clients `kxl-min` und `kxl-max` wurden mit `1200x900+3920+353` und
`800x353+4224+0` innerhalb der Arbeitsfläche verankert; Mindestgrößen durften
die Zelle überdecken, Höchstgrößen ließen die dokumentierte Freifläche. In
einem Lauf von fünf Minuten gab es bei sieben
echten Anordnungsepochen keinen weiteren Write, kein `aufgegeben` und keine
Ausnahme (Matrix 15). Der anschließende Reload ordnete sechs Mitglieder und
vier Teilnehmer an, ohne eine Geometrie zu schreiben.

Nach `nix run .#unload` meldete `isScriptLoaded` `false`. In den folgenden
30 Sekunden erschien keine weitere Controller-Zeile. Der SHA-256-Wert von
`~/.config/kglobalshortcutsrc` blieb vor und nach dem Dev-Menü
`f4d9cdb30108d892d3272778667841b5bb7d0475a4e4dccc8af6755a052c20f5`.

## 6. Livebefunde, Meilenstein 6

Gemessen am 2026-09-06 auf SPIELKISTE (KWin 6.7.4 auf Wayland, drei Ausgaben
DP-1, DP-9, DP-10, vier virtuelle Desktops, eine Activity) mit der
Entwicklungsinstanz aus `nix run`. Rohdaten:
[`shortcuts-2026-09-06-spielkiste.log`](shortcuts-2026-09-06-spielkiste.log)
(210 Journalzeilen aus mehreren Ladevorgängen). Die Datei enthält keine
Fenstertitel und keine Pfade.

Die folgenden Befunde sind manuelle Beobachtungen. Das eingecheckte Artefakt
belegt die Journalausgaben und Geometrien, enthält aber keine Zeitstempel,
Schrittmarken oder Vorher-/Nachher-Abzüge von `kglobalshortcutsrc`. Es kann daher
weder die Herkunft einer Auslösung (D-Bus oder Tastendruck) noch die Dauer der
Ruhephase oder den Dateidiff selbst nachweisen. Bei der nächsten Live-Abnahme
werden Zeitstempel, Schrittmarken und die relevanten Konfigurationsauszüge mit
erfasst.

### 6.1 Registrierung und Konfliktausgang

Manuell festgehalten: Der `diff` von `~/.config/kglobalshortcutsrc` unmittelbar
vor und nach dem ersten Laden zeigt **ausschließlich zwölf hinzugefügte
`xml-*`-Zeilen**, sonst nichts — keine fremde Zeile wurde verändert. Nach fünf
weiteren Ladevorgängen stehen weiterhin genau zwölf; es entstehen keine
Dubletten. Format einer Zeile:

```
xml-expand=Meta+L,none,Master vergrößern
```

Zur **Kollision** (offene Frage aus Abschnitt 2.9), ebenfalls manuell geprüft:
Nach der Registrierung
standen `Lock Session=Screensaver\tMeta+L` und `xml-expand=Meta+L`
**gleichzeitig** in der Datei, ebenso `Edit Tiles=Meta+T` und
`xml-sink=Meta+T`. Beim Tastendruck gewann in **beiden** Fällen der vorhandene
Eintrag: `Meta+L` sperrte die Sitzung, `Meta+T` öffnete den Kachel-Editor. Die
zehn konfliktfreien Tasten wirkten alle wie vorgesehen. `registerShortcut`
meldete nichts — es liefert immer `true`.

Folge: die Umlegung der beiden KDE-Kürzel in der Host-Konfiguration ist
**Voraussetzung** dafür, dass `xml-expand` und `xml-sink` ihre Taste bekommen,
nicht bloß eine Absicherung gegen Doppelbelegung.

### 6.2 Auslösung über D-Bus und Entprellung

Alle zwölf Aktionen wurden über `invokeShortcut` an
`org.kde.kglobalaccel /component/kwin` ausgelöst. Jede erzeugte **genau eine**
`befehl …`-Zeile, und die Entprellung fasste die ganze Folge zu **einem**
Anordnungslauf zusammen (hier umbrochen, im Journal eine Zeile):

```
arrange #2 grund=fensterzustand,windowActivated,shortcut:shrink,shortcut:expand,
shortcut:nextLayout,shortcut:resetLayout,shortcut:toggleFloat
```

Nur die fünf Befehle, die wirklich etwas geändert haben, stehen im Grund; die
wirkungslosen (`unverändert`) melden keinen Lauf an. `sink` auf einem
gekachelten Fenster meldete `bereitsGekachelt` ohne Lauf, `toggleFloat` auf
demselben Fenster `gefloatetOhneWiederherstellung`.

### 6.3 Fokuszyklus und minimierte Fenster

Vier `focusNext` über vier Mitglieder kehrten zum Ausgangsfenster zurück, jedes
Mal mit `via=aktiv` — KWin hat die Aktivierung also jedes Mal angenommen und
`windowActivated` gemeldet. Ein zweiter Aktivierungsversuch trat nie auf; die
Epoche aktiviert nie selbst.

**Minimierte Fenster** (bisher unbelegt): ein minimiertes Fenster bleibt
Surface-Mitglied und im Fokuszyklus, verliert aber die Layout-Teilnahme — die
Surface-Zeile ging von `n=3` auf `n=2`. Landet `focusNext` darauf, **stellt
KWin es wieder her**; die folgende Surface-Zeile meldet wieder `n=3`. Der
Controller erzwingt das nicht, er nimmt es hin.

### 6.4 Layoutwechsel und Promote

Bei drei kwrite-Fenstern auf DP-1 bekam der Master `1664x1410` und die beiden
Stapelzeilen je `896x705` — dieselben Zahlen wie in `tests/kwin-plan.test.ts`.
`xml-promote` zog das fokussierte Fenster in die Masterzelle und schrieb genau
die beiden betroffenen Geometrien. Nach `xml-next-layout` bekamen alle drei
`2560x1410`: das Full-Layout ist mit Meilenstein 6 zum ersten Mal überhaupt
erreichbar.

### 6.5 Konfiguration

Mit `gapOuter=8 gapInner=4 masterRatio=0.5 defaultLayout=full debug=true
excludes=krunner,yakuake,plasmashell` in der Gruppe
`[Script-kwin-xmonad-lite-dev]` meldete das Journal

```
config gaps=8/4 ratio=0.5 layout=1 excludes=3 debug=true
config excludes=krunner,plasmashell,yakuake
```

und die Fenster bekamen `2544x1394+2568+8` — Außen- und Innenabstand sind in
der Geometrie sichtbar. Die zweite Zeile ist die `debugLog`-Zeile; sie erschien
nur bei `debug=true`.

**Zustandserhalt innerhalb einer Instanz:** zweimal `Meta+H` auf Desktop 1
brachte die Surface auf `ratio=0.4`. Nach dem Wechsel auf einen bis dahin
unbenutzten virtuellen Desktop startete die **neue** Surface mit `ratio=0.5`
und `layout=full`, also mit den konfigurierten Werten, während die alte beim
Zurückwechseln weiterhin `ratio=0.4` meldete. Über einen Reload hinweg ist das
nicht zu beobachten — ein Reload erzeugt einen neuen Adapter mit leerer
Registry, danach gelten überall wieder die konfigurierten Startwerte.

**Fehleingaben:** `gapOuter=abc`, `gapInner=-5`, `masterRatio=1.5`,
`defaultLayout=grid`, `debug=ja` und ein leer gesetztes `excludes` erzeugten
sechs Korrekturnotizen und keinen Absturz:

```
config gapOuter=abc unlesbar, verwende 0
config gapInner=-5 unzulässig, verwende 0
config excludes leer: kein Fenster wird ausgeschlossen
config masterRatio=1.5 geklemmt auf 0.9
config defaultLayout=grid unbekannt, verwende tall
config debug=ja unlesbar, verwende false
config gaps=0/0 ratio=0.9 layout=0 excludes=0 debug=false
```

**Nebenbefund zur leeren Ausschlussliste:** mit `excludes=` blieb die
Mitgliederzahl unverändert bei 7. Panels sind schon über `!dock` im
Mitgliedschaftsfilter draußen; die Ausschlussliste ist also eine zweite
Verteidigungslinie, nicht die einzige. „Nichts ausschließen" bedeutet demnach
nicht „das Panel wird gekachelt".

### 6.6 Ruhe nach dem Reload

Nach `nix run .#reload` erschien **keine einzige** `apply`-Zeile. In der manuell
gemessenen Ruhephase von zehn Minuten kam kein `nachbessern`, kein `aufgegeben`
und kein `extern`; das Logartefakt selbst trägt keine Zeitstempel. Die
zwölf Aktionen blieben über den Reload hinweg wirksam, ohne zweite
Registrierung im Journal und ohne zusätzliche Zeile in `kglobalshortcutsrc`.

### 6.7 Deklarative Abnahme auf HAL9000

Gemessen am 2026-09-06 auf HAL9000 gegen den Nix-Input `8f287d9`. Die Fälle
24 bis 24e bestanden. Rohdaten:
[`hal9000-abnahme-2026-09-06.log`](hal9000-abnahme-2026-09-06.log), 550
Controllerzeilen aus einer Reihe mit vier Boots. Das Plugin lief in drei
Boots; im vierten war es für Fall 24e abgeschaltet.

Das Journalartefakt belegt für die aktiven Boots das Laden, die Registrierung
von zwölf Kürzeln und die wirksamen Konfigurationen. Im Ausgangszustand meldet
es `config gaps=0/0 ratio=0.65 layout=0 excludes=7 debug=false`. Fall 24c
meldet `config gaps=8/4 ratio=0.5 layout=1 excludes=7 debug=true`,
`layout=full` und die Zielgeometrie `1904x1034+8+8`. In Fall 24d wurde nur
`gapOuter` aus Nix entfernt. Danach meldet das Journal
`config gaps=0/4 ratio=0.5 layout=1 excludes=7 debug=true`; `gapInner=4` blieb
also erhalten.

Alle zwölf Kürzel wurden über `/dev/uinput` als echte Tastendrücke geprüft.
Das Journal enthält die zugehörigen `befehl`-Zeilen, darunter
`befehl expand … ratio=0.7` für `Meta+L` und `befehl sink` für `Meta+T`. Es
zeichnet die Herkunft eines Befehls jedoch nicht auf. Die Eingabe über
`/dev/uinput` und das Ausbleiben der konkurrierenden KDE-Aktion sind daher
manuelle Live-Beobachtungen. Dasselbe gilt für die Konfigurationsauszüge:
`Lock Session=Screensaver\tCtrl+Alt+L`, `Edit Tiles=none` und `LockedHint=no`
blieben im eingeschalteten Zustand erhalten. `Meta+L` vergrößerte den Master,
statt die Sitzung zu sperren; `Ctrl+Alt+L` sperrte weiterhin.

In Fall 24e meldeten D-Bus und Konfigurationsprüfung ein abgeschaltetes,
nicht geladenes Plugin. Alle zwölf `xml-*`-Aktionen standen auf `none`,
`Lock Session=Screensaver\tMeta+L` und `Edit Tiles=Meta+T` waren
wiederhergestellt. `Meta+L` sperrte per Tastendruck, `Ctrl+Alt+L` nicht mehr.
Während dieses Boots entstand keine Controllerzeile. Da das Rohartefakt keine
Trennmarke für den leeren vierten Abschnitt enthält, belegt es diese
Abwesenheit nicht selbst; sie stammt aus der protokollierten Live-Prüfung.

Beim Abschalten bleibt `[Script-kwin-xmonad-lite]` mit seinen alten Werten in
`kwinrc` stehen. Der Abschaltzweig setzt das Plugin-Flag und gibt die zwölf
Tasten mit `none` frei, entfernt aber die Settings-Gruppe nicht. Die Werte
sind bei `kwin-xmonad-liteEnabled=false` wirkungslos.

Der Rückbau stellte Generation 584 wieder her, löschte die Testgenerationen
585 bis 588 und zog die Booteinträge nach. Nach dem Neustart und vor der ersten
Anmeldung wurden die gesicherten Fassungen von `kwinrc` und
`kglobalshortcutsrc` zurückgespielt. `kglobalaccel` hätte seinen gespeicherten
Zustand beim Sitzungsende sonst erneut geschrieben. Danach fehlte der
Plugin-Eintrag in `kwinrc`; `kglobalshortcutsrc` enthielt keine `xml-*`-Zeile,
`Lock Session=Screensaver` und `Edit Tiles=Meta+T` entsprachen wieder dem
Ausgangsstand. `/run/current-system` zeigte auf das Toplevel von Generation
584, Autologin war entfernt.

### 6.8 Nicht gemessen

- ~~**Fokusziel hinter einem modalen Dialog** (Fall 20b).~~ **In Meilenstein 7
  gemessen**, siehe Abschnitt 8.4: KWin leitet den Fokus tatsächlich auf den
  Dialog um, und der Controller aktiviert kein zweites Mal.
- ~~**KWin-/Sitzungsneustart** (Fälle 16–17, Meilenstein 7). Fall 23 belegt nur
  das Neuladen der Entwicklungsinstanz per `nix run .#reload`; eine Ab- und
  Anmeldung oder ein KWin-Neustart fand in dieser Abnahme nicht statt.~~ **In
  Meilenstein 7 gemessen**, siehe Abschnitte 8.2 und 8.5. Die drei Verfahren
  bleiben getrennt: Reload (KWin läuft weiter), KWin-Neustart (Sitzung läuft
  weiter, aber die Clients sterben) und Sitzungsneustart.
- **Fokusziel zwischen Tastendruck und Lauf geschlossen** (Fall 20c). Der Pfad
  `aktivieren fehlgeschlagen für …` in `src/kwin/adapter.ts` ist genauso
  **unerreichbar** wie der Zweig unten: `result.focus` ist nur dann
  nicht-null, wenn das Fenster im Snapshot steht, `readSnapshot` legt für
  jedes Snapshot-Fenster ein Handle an, und zwischen dem Lesedurchgang und
  der Zuweisung kehrt der Rückruf nicht in die Ereignisschleife zurück. Die
  Zeile bleibt defensiv stehen; eine Abnahme darf sie nicht erwarten.
- Der Zweig „`ziel … nicht mehr im Snapshot`" in `src/kwin/command.ts` ist über
  `runCommand` **unerreichbar**: der Abgleich vor dem Reducer garantiert, dass
  die gespeicherte Reihenfolge eine Teilmenge der Snapshot-Mitglieder ist. Die
  Prüfung bleibt defensiv im Code stehen; eine Abnahme darf diese Journalzeile
  nicht erwarten.

## 7. Quelltextbefunde, Meilenstein 7

Gelesen am 2026-09-06 aus dem gepinnten Tarball
`kwin-6.7.4.tar.xz` im Nix-Store (`kdePackages.kwin.src`), ergänzt um zwei
Live-Gegenproben auf SPIELKISTE. Modellwissen wurde nicht verwendet.

### 7.1 Neustartverfahren unter Wayland

Es gibt **zwei** Verfahren, und sie sind verschieden weitreichend.

**KWin-Neustart in der laufenden Sitzung.** `kwin_wayland --replace` schickt nur
eine D-Bus-Nachricht und beendet sich selbst
(`src/main_wayland.cpp:377-379` und `:450-456`); die Arbeit macht die Methode
`org.kde.KWin.replace` im laufenden Prozess:

```cpp
void DBusInterface::replace()
{
    QCoreApplication::exit(133);
}
```
(`src/dbusinterface.cpp:110-113`)

Den Neustart besorgt `kwin_wayland_wrapper`. Er hält den Wayland-Socket und
startet KWin bei jedem Exit ungleich 0 erneut, wobei er den Socket-Dateideskriptor
jedes Mal frisch übergibt (`src/helpers/wayland_wrapper/kwin_wrapper.cpp:113-114`).
Der Exit-Code entscheidet über die Bewertung:

| Exit | Wirkung im Wrapper |
|---|---|
| 0 | `qApp->quit()` — der Wrapper endet mit, das ist das Sitzungsende |
| 133 (`replace`) | `m_crashCount = 0`, Neustart — ausdrücklich **kein** Absturz |
| sonst | `m_crashCount++`, Neustart; ab dem elften Mal endet der Wrapper |

(`kwin_wrapper.cpp:136-154`)

**Live gegengeprüft** auf SPIELKISTE: `.replace` steht in der Schnittstelle
unter `org.kde.KWin /KWin`, der Wrapper läuft als eigener Prozess mit
`--wayland-fd 7 --socket wayland-0`, und seine Journalzeilen liegen unter
derselben User-Unit wie die von KWin (`plasma-kwin_wayland`). Ein Auszug mit
`_SYSTEMD_USER_UNIT=plasma-kwin_wayland.service` erfasst den Wrapper also mit.

> **Nicht belegt:** ob bestehende Wayland-Clients den Prozesswechsel
> überstehen. Der Socket überlebt, die Verbindungen zum alten Prozess nicht;
> ob ein Client den Abbruch übersteht, entscheidet der Client. Das ist in
> Fall 17a zu **messen**, nicht anzunehmen.

**Sitzungsneustart.** Ab- und Anmelden. KWin endet mit Exit 0, der Wrapper
endet mit, alles wird neu aufgebaut. Boot-Id, KWin-PID und Skriptlauf wechseln
gemeinsam; beim KWin-Neustart bleibt die Boot-Id.

### 7.2 Wann KWin Skripte lädt und entlädt

`Scripting::start()` hängt an zwei Signalen des Workspace:

```cpp
connect(Workspace::self(), &Workspace::configChanged, this, &Scripting::start);
connect(Workspace::self(), &Workspace::workspaceInitialized, this, &Scripting::start);
```
(`src/scripting/scripting.cpp:683-684`)

`Workspace::slotReconfigure()` emittiert `configChanged()`
(`src/workspace.cpp:1017`). Damit läuft nach **jedem** `reconfigure` die
Abfrage `queryScriptsToLoad()`, und die liest `[Plugins]` neu ein und wertet
je Paket das Flag `<pluginId>Enabled` aus (`scripting.cpp:746-793`):

- Flag `false` und Skript geladen → `unloadScript(pluginId)`.
- Flag `true` und Skript nicht geladen → laden und starten.

Daraus folgt für die offene Frage aus `PLAN.md` Risiko 8: ein **Re-Enable ohne
Neuanmeldung** ist im JS-Modus quelltextseitig vorgesehen. Der Weg ist
`kwriteconfig6` auf `kwinrc [Plugins] kwin-xmonad-liteEnabled` und danach
`reconfigure` über D-Bus. **Fall 16c hat es am 2026-09-06 gemessen und
bestätigt** — die Messung steht in Abschnitt 8.3, `PLAN.md` Risiko 8 ist damit
geschlossen.

Die bisherige Formulierung „`reconfigure` lädt laufende Skripte nicht neu" ist
zu schärfen: **ein bereits geladenes Skript** wird nicht neu geladen, weil
`loadScript` bei bekanntem Pluginnamen sofort `-1` liefert
(`scripting.cpp:861-866`). Abgeschaltete werden trotzdem entladen und neu
eingeschaltete geladen.

**Entwarnung zum Nebeneffekt:** `Scripting::start()` ruft am Ende `runScripts()`
über **alle** Skripte, also auch über bereits laufende. Ein zweiter Start
entsteht daraus nicht — `Script::run()` steigt bei `running() || m_starting`
sofort aus (`scripting.cpp:166-170`). Ein `reconfigure`, wie es jede beliebige
Änderung in den Systemeinstellungen auslöst, verdrahtet den Controller also
nicht ein zweites Mal.

## 8. Livebefunde, Meilenstein 7

Zwei Reihen auf HAL9000 am 2026-09-06, beide mit KWin 6.7.4 auf Wayland, eine
Activity, vier Desktops. Die erste lief in der **Produktionsinstanz** gegen
Projekt-Commit `abdffa2` (Protokoll `ms7-2026-09-06-hal9000.md`), die zweite in
der **Entwicklungsinstanz** gegen `0c903cb` (Protokoll
`ms7-2026-09-06-hal9000-ap7.md`). Aus der einen wird keine Aussage über die
andere abgeleitet.

### 8.1 Panelabzug und Zellenrechnung

Die Arbeitsfläche kommt aus `clientArea(KWin.MaximizeArea, output, desktop)` und
zieht das Plasma-Panel ab: bei einer Ausgabe `1920x1080` meldet die
`surface`-Zeile `fläche=1920x1050+0+0`, das Panel selbst steht mit
`1920x30+0+1050` daneben. Die Gegenprobe über `getWindowInfo` lieferte für das
Panel deckungsgleich `0,1050,1920,30`.

Die berechneten Zellen kommen bei kwrite **auf das Pixel** an. Gemessen, jeweils
Soll aus `apply` und Ist aus der Probe:

| Vorgabe | Master | Stapel |
|---|---|---|
| `n=1`, `tall`, 0.65, `gaps=0/0` | `1920x1050+0+0` | — |
| `n=3`, `tall`, 0.65, `gaps=0/0` | `1248x1050+0+0` | `672x525+1248+0`, `672x525+1248+525` |
| `n=3`, `tall`, 0.55, `gaps=0/0` | `1056x1050+0+0` | `864x525+1056+0`, `864x525+1056+525` |
| `n=3`, `tall`, 0.55, `gaps=8/4` | `1045x1034+8+8` | `855x515+1057+8`, `855x515+1057+527` |
| `n=3`, `full`, `gaps=8/4` | dreimal `1904x1034+8+8` | — |

Die letzte Zeile ist der Beleg für die Sonderregel des Orakels: in `full` sind
deckungsgleiche Rechtecke das **erwartete** Ergebnis, Überlappungs- und
Zerlegungsprüfung entfallen dort.

### 8.2 Clients überleben einen KWin-Neustart nicht

`org.kde.KWin.replace` startet KWin neu, ohne die Sitzung zu beenden: neue PID
im selben Boot (49086 → 53902), derselbe `kwin_wayland_wrapper` mit demselben
`--wayland-fd 7`, und das Skript startet über den KPackage-Autostart selbst
(`geladen`, `bereit nach 1 Versuch(en)`).

**Von vier offenen kwrite-Fenstern überlebte keines.** Der Wrapper hält zwar den
Wayland-Socket, aber die bestehenden Client-Verbindungen sterben mit dem
Prozess. `mitglieder=0` nach dem Neustart ist deshalb die richtige Beobachtung
und kein Controllerfehler. Nebenbefund: auch `ksmserver`, `kaccess` und
`gmenudbusmenuproxy` überlebten nicht, sie endeten mit `status=1/FAILURE` — das
Abmelden über das Plasma-Menü war danach nicht mehr möglich.

Damit ist die offene Frage aus der Vorbereitung beantwortet, und zwar gemessen,
nicht geschlossen: der Mechanismus (`DBusInterface::replace()` →
`QCoreApplication::exit(133)`, Neustartschleife im Wrapper) sagt nichts über die
Client-Verbindungen aus.

### 8.3 Re-Enable ohne Neuanmeldung funktioniert

Abschnitt 7.2 sagte es aus dem Quelltext voraus, Fall 16c hat es gemessen:

| Schritt | `isScriptLoaded` |
|---|---|
| Ausgangslage | `true` |
| `kwin-xmonad-liteEnabled=false` + `reconfigure` + 1 s | **`false`** |
| `kwin-xmonad-liteEnabled=true` + `reconfigure` + 1 s | **`true`**, mit vollständiger Startfolge |

`reconfigure` entlädt also **und** lädt. `PLAN.md` Risiko 8 ist damit
geschlossen. Die Kurzfassung „`reconfigure` lädt Skripte nicht neu" gilt nur für
ein bereits geladenes Skript.

### 8.4 Fokusumleitung am modalen Dialog

Modalität zuerst belegt, sonst prüft der Fall nichts: kwrite „Speichern unter"
(`Strg+Umschalt+S`) meldet in der Probe `modal:true` und `transientFor` auf das
Elternfenster, `getWindowInfo` bestätigt `hasTransientParent=True`.

Beim Fokusbefehl auf das Elternfenster leitet KWin die Aktivierung auf den
Dialog um. Entscheidend ist, was der Controller **nicht** tut: je Auslösung
genau **eine** `befehl`- und **eine** `aktiviere`-Zeile, kein zweiter Versuch,
und danach **null** Anordnungsläufe. Gemessen in beiden Auslösewegen — über
`invokeShortcut` und über einen echten Tastendruck via `/dev/uinput`. Der
Dialog selbst bleibt außerhalb der Mitgliedschaft, er wird also nicht gekachelt.

### 8.5 Was ein Reload verliert

Vier Fenster, `full`, `ratio=0.55`, eines gefloatet und verschoben, Reihenfolge
per `promote` verändert. Nach `unloadScript` + `loadScript` + `run`:

- `mitglieder=4` — die Ist-Menge wird neu aufgebaut;
- `teilnehmer` steigt von **3 auf 4**, weil die Float-Markierung verloren geht,
  und `float=` ist leer;
- Layout und Ratio stehen wieder auf `defaultLayout`/`masterRatio`;
- die `promote`-Reihenfolge ist weg;
- vier `apply`-Zeilen, zwölf `xml-*`-Zeilen unverändert, keine Dublette.

Danach **5 min 40 s ohne eine einzige Controllerzeile** (Fall 16b) — der Reload
hinterlässt keinen Nachlauf.

### 8.6 Getrennte Zustände je Ausgabe

Zwei Ausgaben, je drei Fenster. Sechs Befehle auf der einen (`promote`, zweimal
`shrink`, `swap-next`) und einer auf der anderen (`next-layout`):

| | DP-3 | eDP-1 |
|---|---|---|
| Layout | `tall` | `full` |
| Ratio | 0.65 → 0.6 → 0.55 | 0.65 |
| Arbeitsfläche | `1920x1050+0+0` (Panel) | `1920x1080+1920+0` (kein Panel) |
| Reihenfolge | zweimal umgeordnet | unverändert |

Während der sechs Befehle auf DP-3 entstand **keine** `apply`-Zeile für ein
eDP-1-Fenster, und dessen `diagnose`-Zeile stand in jedem Lauf unverändert da.
Die verschiedenen Arbeitsflächen sind dabei ein eigener Beleg: die Auflösung
rechnet je Ausgabe, nicht global.

Beim Desktopwechsel entsteht **genau ein** Anordnungslauf, obwohl
`currentDesktopChanged` bei zwei Ausgaben zweimal feuert, und für Fenster, die
auf ihrem Desktop bleiben, keine einzige Schreibzeile.

### 8.7 Eine Stunde unter Last

64,5 Minuten in **einem** Skriptlauf, 75 skriptgesteuerte Aktionen (Fenster
öffnen und schließen, Desktopwechsel, alle zwölf Controllerbefehle,
Maximieren, Minimieren, Verschieben zwischen den Ausgaben), daneben Element,
Ferdium und Signal:

| Art | Anzahl |
|---|---|
| `arrange` | 59 |
| `apply` | 36 |
| `aktiviere` | 9 |
| `extern` | 3 |
| `gc` | 2 |
| `nachbessern` | 1 |
| `aufgegeben` | 0 |

**Von 59 Anordnungsläufen schrieben nur 16 überhaupt etwas.** Das ist die
Flatterbremse aus `judgeWrite` im Regelbetrieb: die Mehrheit der Läufe stellt
fest, dass alles am Platz ist, schreibt nichts und feuert deshalb auch kein
Geometriesignal. Der Versuchszähler ist nur das Netz darunter.

Die eine Nachbesserung ging beim ersten Versuch durch
(`versuch=1 ist=864x350+1056+350 soll=864x525+1056+0`), ohne Folgeversuch und
ohne `aufgegeben` — der Pfad war bis dahin nur mit `foot` im Give-up-Fall
belegt. Die drei `extern`-Zeilen betreffen drei verschiedene Ids, also keine
Rückkopplungskette.

Ein Randfall, den keine Fallvorschrift vorsah: eine Surface, deren einziges
Fenster gefloatet ist, meldet `teilnehmer=` leer bei gesetztem `float=` — der
Controller schreibt dort nichts und läuft nicht leer.

**Beleggrenze, gefunden im Audit 7.1:** Von den 59 Läufen trug keiner einen
rein technischen Grund. Der Auditor wertete damals einen Sammelgrund wie
`geometrieExtern,fensterzustand` als Nutzeranlass und setzte bei jedem
solchen Lauf alle Zähler zurück; „höchstens 2 auf dasselbe Soll" war deshalb
arithmetisch erzwungen, nicht gemessen. Seit 7.1 zählt ein Sammelgrund nur bei
durchgehend nutzerveranlassten Teilen, und ein Nutzerlauf gibt nur die Fenster
frei, die er selbst beschreibt. Unter dieser Regel hat die Stunde 8 technische
Läufe (3 × `geometrieExtern,fensterzustand`, 5 × `closed,…`), in denen der
Zähler stehen bleibt, und besteht weiterhin mit höchstens 2. Was die Stunde
nicht belegt: Schleifenfreiheit unter Hotplug, Panelhöhenänderung oder Ziehen
— die Last erzeugte keinen dieser Anlässe. Eine Wiederholung mit technischer
Last steht als eigener Live-Termin aus.

**Nachgeholt in AP8 (2026-09-12), siehe 8.10.** Die Wiederholung mit technischer
Last ist gelaufen und hat die Grenze geschlossen — und dabei einen dritten
Defekt im Auditor aufgedeckt.

### 8.8 Shortcut-Registrierungen sind rücknehmbar

Die KWin-Skript-API hat kein `unregisterShortcut`; daraus wurde bisher
geschlossen, eine einmal registrierte `xml-*`-Aktion reserviere ihre Taste
dauerhaft. Für die Maschine stimmt das nicht:

```bash
busctl --user call org.kde.kglobalaccel /kglobalaccel \
  org.kde.KGlobalAccel unregister ss kwin xml-expand
```

Zwölf Aufrufe, zwölfmal `true`, danach null `xml-*`-Zeilen in
`kglobalshortcutsrc` und ein leerer `diff` gegen die Sicherung — in laufender
Sitzung, ohne Neuanmeldung. Das ist der saubere Rückbauweg nach einem Lauf mit
der Entwicklungsinstanz und wäre auch der Weg, die 35 `Krohnkite*`- und 20
`Polonium*`-Leichen zu entfernen.

### 8.9 Werkzeugbefunde am Rand

- **`Window to Next Screen` reagiert über `invokeShortcut` nicht**, während
  `Window One Screen to the Right` sofort greift. Beide stehen in der
  Shortcut-Liste der Komponente `kwin`. Für den Aufbau eines
  Multi-Output-Falls ist die zweite Aktion zu nehmen.
- **`kscreen-doctor` bricht ohne Wayland-Umgebung mit SIGABRT ab.** Für
  Fernaufrufe müssen `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS` und
  `WAYLAND_DISPLAY` gesetzt sein.
- **`/VirtualOutputs` existiert in einer regulären KWin-Instanz nicht.** Ein
  virtueller zweiter Output als Ersatz für Hardware ist damit kein Weg; der
  Objektpfad kommt nur mit dem virtuellen Backend.

### 8.10 AP8: die zwei Beleggrenzen geschlossen, ein dritter Auditordefekt

Vierte HAL9000-Reihe (Protokoll `docs/ms7-2026-09-12-hal9000-ap8.md`), gegen den
gemergten Stand `68c9ba8` in der Produktionsinstanz.

**Multi-Output mit gebrochener Skalierung (Fall 26d).** Eine zweite Ausgabe mit
`1600x900` bei Skalierung 1,25 ergibt die logische Fläche `1280x720`. Der Master
belegt `832x720` (`0,65 × 1280`, ohne Rest), der Stapel zweimal `448x360`. Alle
Zellen wurden als `exakt` gemessen, und das Journal trägt keinen zweiten `apply`
auf dasselbe Soll. Die Rundung jedes gelesenen Rechtecks in `kwin/read.ts` trägt
damit auch bei gebrochener Skalierung: ohne sie meldete `equals` in jeder Epoche
eine Abweichung. Belegt ist das für **zwei** Ausgaben und für einen Modus, dessen
logische Größe ganzzahlig aufgeht; drei Ausgaben und eine Skalierung mit
gebrochener Arbeitsfläche bleiben offen.

**Alltagsstunde mit technischer Last (Fall 27b).** 65 Minuten skriptgesteuerte
Last, diesmal mit Hotplug (7×), Panelhöhenwechsel (6×) und Ziehen (20×, Maus per
`/dev/uinput` und Tastatur per `Window Move`). Der Controller lief schleifenfrei:
die längste `extern`-Kette eines Fensters blieb unter der Schwelle, kein
`aufgegeben`, kein `aktivieren fehlgeschlagen`, und von 136 Anordnungsläufen
schrieben nur 49 überhaupt. Die beiden verzögerten Nachläufe nach Hotplug
(`nachlauf500/1500:screenGeometry+screensChanged`) und nach Panelhöhenwechsel
(`…:dockGeometrie`) sind unter Last echt durchlaufen; die Sollfläche von DP-3
wechselte messbar mit der Panelhöhe (`1920x1050` bei 30 px, `1920x1032` bei
48 px).

**Der dritte Auditordefekt.** Der 7.1-Auditor meldete Fall 27b trotzdem als
durchgefallen: ein Fenster wurde viermal auf dasselbe Soll geschrieben, jeder
Schreibvorgang an einem eigenen realen Anlass (Fenster auf, Ziehen samt
Schließen, Nachhall des Ziehens, Hotplug) über drei Minuten. Die `extern`-Kette
dieses Fensters erreichte nur 2. Die Regel „höchstens 3 auf dasselbe Soll ohne
rein nutzerveranlasste Freigabe" war an Fall 27 kalibriert, dessen Last keinen
dieser Anlässe erzeugte — unter technischer Last ist sie zu streng, weil die
berichtigenden Läufe per Konstruktion technisch sind. Die dritte Schärfung der
Prüfwerkzeuge (Zwischenschritt 7.2, Entscheidung des Nutzers): eine eigene
`extern`-Meldung eines Fensters setzt seinen Soll-Wiederholungszähler zurück.
Der Schleifennachweis liegt damit allein an der `extern`-Kette — dem
aussagekräftigeren Indikator —, der Soll-Zähler bleibt das Netz für den
Give-up-Fall ohne `extern`. Nach der Schärfung besteht Fall 27b mit höchstens 2,
alle archivierten Nachweise bestehen weiter. Dieselbe Lehre wie in 7.1: ein
Prüfwerkzeug ohne echten Lastfall hat blinde Flecken, die erst der Lastfall
zeigt.

## 9. Grid-Quellenbefund und Stand von Meilenstein 8

Die frühere Konfiguration importiert normales `XMonad.Layout.Grid` und nutzt
`smartBorders Grid`, keine eigene `GridRatio`-Instanz. Der am 2026-09-12
gelesene, exakt gepinnte Originalquelltext setzt `defaultRatio = 16/9`. Seine
Spaltenzahl beruht auf der gerundeten Quadratwurzel von
`n × Breite / (Höhe × 16/9)`, geklemmt auf mindestens eine und höchstens
`n` Spalten. Fenster werden spaltenweise angeordnet; die überzähligen Fenster
liegen in den rechten Spalten. Das Projekt übernimmt diese Aufteilungsregel als
mathematische Idee, nicht als wörtlichen Code, und behauptet keine
Pixelgleichheit mit der Haskell-Implementierung.

Zwei Unterschiede sind absichtlich sichtbar. JavaScripts `Math.round` rundet
positive Halbwerte auf, während Haskells `round` zur geraden Zahl rundet. Für
die Pixelgrößen nutzt das Projekt außerdem seine vorhandene Funktion
`distribute`: Nach dem gewichteten Floor werden Restpixel von vorn verteilt;
XMonads `chop` wird nicht nachgebaut. Außen- und Innenabstände folgen der
bereits für Tall belegten Projektklemmung.

Meilenstein 8 ist implementiert und automatisch geprüft: Grid ist das dritte
Layout, das Orakel akzeptiert eine externe Grid-Vorschrift und feste
synthetische Tests decken korrekte Geometrie, Zuordnung, Flächenabweichung und
Überlappung ab. Activity A/B, Sticky-Desktops, Mehrfach-Activity-Fenster,
Fokuserhalt in inaktiven Surfaces und Activity-GC laufen durch reale Planungs-
und Adapterpfade der Tests. Diese Befunde sind **keine Live-Abnahme**. Grid und
Matrix 6–8 müssen anschließend auf HAL9000 nach der Vorschrift in `build.md`
laufen. Persistenz, KCM und die Umverteilung bei Größenbeschränkungen bleiben
optionale Folgearbeit.
