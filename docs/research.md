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
| nixpkgs-Derivationen polonium/krohnkite/karousel, `nixos/tests/plasma6.nix` | Pin `8a37cfb9` | MIT | Packaging-Muster |
| `develop.kde.org/docs/plasma/kwin/` und `…/api/` | dokumentiert KWin **6.0** | – | nur Installationskommandos; `…/packaging/` ist 404 |

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
`Symbol.iterator`, `**`, `Object.entries`/`values`, benannte Regex-Gruppen,
Optional Chaining `?.`, Nullish Coalescing `??`, numerische Trennzeichen.

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
`active`, `timeout` und `restart` sind vorhanden; `QTimer.singleShot` als
statische Funktion gibt es nicht.

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
