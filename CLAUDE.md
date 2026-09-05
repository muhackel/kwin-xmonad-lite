# CLAUDE.md — kwin-xmonad-lite

Schlanker Layout-Controller als KWin-Skript für Plasma 6 auf Wayland. Holt
einen Teil des alten XMonad-Arbeitsgefühls zurück: Tall- und Full-Layout,
Tastensteuerung für Fokus, Reihenfolge und Master-Anteil.

Der vollständige Entwurf steht in [`PLAN.md`](PLAN.md), die belegten Quellen
und Messwerte in [`docs/research.md`](docs/research.md). **Stand: Meilenstein 2
abgeschlossen** — Gerüst, Build- und Testkette, Feature-Probe, Layoutkern
(`rect`, `tall`, `full`) sowie Fensterstapel, Registry und Reconcile. Der
KWin-Adapter folgt ab Meilenstein 3; das geladene Skript ordnet bis dahin
nichts an.

## Ursprung & Zweck

Ersatz für die frühere XMonad-Konfiguration (`nixosconfig/sources/xmonad/`)
unter KDE. Polonium und Krohnkite wurden ausprobiert und verworfen. Das Skript
ist bewusst **kein** Fenstermanager: Activity-, Desktop- und Bildschirm-
zuordnung bleiben bei KWin und seinen Fensterregeln, dieses Skript ordnet nur
an, was KWin ohnehin anzeigt. Es erstellt, löscht und startet keine
Activities und verwaltet nicht die Zahl der Desktops.

## Grundentscheidungen

- **JavaScript-Modus**, nicht QML. `QTimer` steht auch dort direkt zur
  Verfügung, ein QML-Rahmen ist unnötig.
- **Eigene Geometrieberechnung** über `frameGeometry`, nicht die KWin-Tile-API:
  Tiles kennen keine Activity-Dimension, haben eine 15-%-Mindestgröße und
  können Monocle nicht abbilden.
- **Keine dauerhaften Fenstereigenschaften** ändern (kein `keepAbove`, keine
  Desktop- oder Activity-Umsetzung). Es gibt keinen Unload-Hook; so bleibt beim
  Entladen nichts zurückzurollen.
- **Maximierte und Vollbildfenster verlassen das Layout** und werden vom
  Controller nie selbst zurückgesetzt.
- Neue Fenster kommen **oberhalb des fokussierten** hinzu (XMonads `insertUp`),
  Master-Anzahl bleibt fest 1.
- Zustand je **Surface** = Activity × Desktop × Ausgabe.
- Fenster auf allen Desktops oder in mehreren Activities werden **in jeder
  Surface mitgekachelt**.
- Kein KCM-Dialog im MVP; Konfiguration über `kwinrc` und das Nix-Modul.

## Architektur (Kurz)

- `src/core/` → Layoutberechnung und Fensterstapel, reine Funktionen, ohne
  KWin-Abhängigkeit, per `node --test` prüfbar. `core/layout/index.ts` ist der
  gemeinsame Einstieg: Typen, Ratio-Konstanten und die Layoutliste `LAYOUTS`,
  deren Reihenfolge der Zyklus von `Meta+Space` ist.
- `src/state/` → Registry je Surface, Abgleich der Ist-Fenstermenge gegen die
  gespeicherte Reihenfolge.
- `src/kwin/` → Adapter: Fensterfilter, Signalverdrahtung, Entprellung über
  `QTimer`, Geometrieanwendung mit Wächtern.
- `package/` → KPackage-Wurzel; der Build legt `contents/code/main.js` hinein.
- `dev/probe/` → Feature-Probe, misst die Skriptumgebung (siehe unten).
- `nix/`, `scripts/` → Paket, Entwicklungsumgebung, Lade- und Reload-Werkzeuge.

## Fallstricke / Merker

### Sprachumgebung (an KWin 6.7.4 / Qt 6.11.2 gemessen)

- **ES-Zielstufe ist `es2016`**, nicht 2017. Am Parser scheitern `async`/
  `await`, Objekt-Spread `{...o}`, Objekt-Rest, `catch {}` ohne Bindung, die
  logischen Zuweisungen `??=`/`||=`/`&&=` sowie sämtliche Klassenfelder und
  statischen Blöcke. `?.` und `??` funktionieren dagegen.
- esbuild liefert **keine Polyfills**. `Object.fromEntries`, `Object.hasOwn`,
  `Array.prototype.flat`/`flatMap`/`at`/`findLast`/`toSorted`,
  `String.prototype.replaceAll`/`trimStart`/`matchAll`/`at`,
  `Promise.allSettled`/`any` und `globalThis` fehlen zur Laufzeit und dürfen
  im Quelltext nicht vorkommen.
- Kein `setTimeout`. Jede Verzögerung läuft über `new QTimer()`. Ein Einmal-
  Timer mit 20 ms feuerte nach 21 ms — das Entprellfenster trägt.
- **Vorhanden und gemessen**, damit nicht aus Vorsicht darauf verzichtet wird:
  `Map`, `Set`, `WeakMap`, `Symbol`, `Proxy`, `Reflect`, `Promise`, `for…of`,
  Destrukturierung, Array-Spread, `class` (ohne Felder), `Array.from`,
  `Array.isArray`, `Object.entries`, `Object.values`, `Number.isInteger`,
  `print()`.

### KWin-Objekte

- `workspace.windowList()` ist **kein echtes Array** (`Array.isArray` ist
  `false`), ebenso `window.desktops` und `window.activities`. Manuell über
  `length` iterieren, nicht `map`/`filter` verwenden.
- `Object.keys` funktioniert auf `workspace`, `Window` und `Output` (122 / 160
  / 18 Einträge), **nicht** auf `KWin` — dort müssen Namen bekannt sein.
- Die `ClientAreaOption`-Werte liegen flach als Zahlen auf `KWin`
  (`KWin.MaximizeArea === 2`). `KWin.MaximizeMode`, `KWin.WindowType` und
  `KWin.Layer` existieren nicht; numerisch vergleichen.
- `clientArea` liefert ganzzahlige Rechtecke.
- `window.internalId` ist ein Objekt; als Zeichenkette trägt es geschweifte
  Klammern (`{uuid}`). `maxSize` meldet für „unbegrenzt" `2147483647`.
- Eine Ausgabe hat `name`, `manufacturer`, `model`, `serialNumber`,
  `geometry`, `devicePixelRatio` — kein `uuid`, `enabled` oder `scale`.

### Layoutkern

- **Abstände werden geklemmt, nie erzwungen.** `shrink` nimmt höchstens
  `floor((Kante - 1) / 2)`, `clampGap` höchstens `floor((Gesamtlänge - n) /
  (n - 1))`. Damit behält jede Zelle mindestens 1 px, und keine Kombination aus
  kleiner Fläche und großem Abstand erzeugt negative Rechtecke. Wer eine zweite,
  abweichende Regel im Adapter einführt, bekommt Ränder, die sich widersprechen.
- `gapInner` wirkt **einheitlich** — einmal zwischen Master- und Stapelspalte
  und zwischen allen Stapelzeilen. Die Testinvariante ist deshalb „Zellen +
  Abstände zerlegen die Fläche exakt", nicht „lückenlos".
- Ist die Fläche zu schmal für zwei Spalten, liefert `tall` einen reinen
  senkrechten Stapel statt einer Masterspalte, die aus der Fläche ragt.
- **Überlappungstests brauchen die Max/Min-Form.** Das kurze
  `a.x < b.x + b.width && …` meldet für ein Rechteck der Breite 0 fälschlich
  eine Überlappung; `max(links) < min(rechts)` nicht.
- `ratio` bleibt Fließkomma, jede Pixelgröße geht durch `Math.round`/
  `Math.floor`. Für die Schrittweite in Meilenstein 2 gilt: `0.65 + 0.05` ergibt
  `0.7000000000000001` — beim Schalten runden, sonst sammeln sich die
  Nachkommastellen im gespeicherten Zustand.

### Zustandsschicht

- **Reducer sind rein.** `core/stack` gibt bei jeder Änderung einen neuen
  `SurfaceState` zurück und bei Wirkungslosigkeit **dasselbe Objekt**. Der
  Adapter darf deshalb `state === vorher` als „nichts zu tun" lesen — und
  niemals `state.order.push(…)` schreiben, das vergiftete die Registry
  unbemerkt. `order` wird bei jeder Ableitung kopiert.
- Der Registry-Behälter ist dagegen veränderlich: `putSurface` hängt das
  Ergebnis eines Reducers ein, `WindowState` wird an Ort und Stelle
  fortgeschrieben.
- **Fokus ist eine Fenster-ID, kein Index.** Ein Index verrutscht bei jedem
  Entfernen. `PLAN.md` Abschnitt 3 sagte ursprünglich „Fokusindex" und
  widersprach damit Abschnitt 4; korrigiert.
- Beim Reconcile gewinnt das aktive Fenster von KWin. Ohne aktives Fenster
  behält die Surface ihren bisherigen Fokus — sonst stiehlt ein Sticky-Fenster
  einer inaktiven Surface den Fokus, weil `insert` XMonad-treu fokussiert.
- Die Bereinigung prüft Activity und Desktop, **nicht** die Ausgabe: der
  Zustand eines abgesteckten Bildschirms überlebt am Namen bis zum
  Sitzungsende.

### Offene Konflikte im Entwurf

- **`moveable`/`resizeable` taugen nicht als Mitgliedschaftskriterium.** Ein
  Fenster im Vollbild meldet beides als `false`. `PLAN.md` Abschnitt 7 führt
  sie im dauerhaften Filter, Abschnitt 4 verlangt aber, dass ein Vollbild-
  fenster Surface-Mitglied bleibt. Beides zusammen geht nicht. Vor Meilenstein
  3 entscheiden: entweder aus dem Mitgliedschaftsfilter herausnehmen oder nur
  bei der Layout-Teilnahme prüfen.

### D-Bus und Konfiguration

- `loadScript(pfad, name)` nimmt eine einzelne `.js`-Datei; ein KPackage
  braucht nur der über `kwinrc` gesteuerte Autostart. Rückgabe ist die
  Script-ID und damit der Objektpfad `/Scripting/Script<N>`; **`-1` heißt
  „Name bereits geladen"**.
- `unloadScript` ruft `deleteLater()`. Der Eintrag verschwindet erst im
  nächsten Ereignisschleifendurchlauf — vor einem erneuten `loadScript` mit
  demselben Namen auf `isScriptLoaded == false` warten.
- `readConfig` liest `kwinrc [Script-<pluginName>]`, ohne KPackage und ohne
  `main.xml`. Der Rückgabetyp folgt dem Vorgabewert. **Neu geschriebene Werte
  brauchen ~200 ms**: `Workspace::reconfigure()` startet nur
  `reconfigureTimer.start(200)`.
- `registerShortcut` ruft `KGlobalAccel::setShortcut` **ohne** `NoAutoloading`
  und liefert immer `true`. Ein vorhandener Eintrag in `kglobalshortcutsrc`
  überschreibt damit die im Code angegebene Taste, und tote Einträge
  reservieren Tasten weiter (dort stehen 35 `Krohnkite*`- und 20
  `Polonium*`-Leichen). `objectName`s sind ab dem ersten Release stabil zu
  halten.

### Werkzeugkette

- `node --test tests/` schlägt fehl — Node deutet das Verzeichnis als
  Modulpfad. Immer `node --test tests/*.test.ts`. Generatoren und
  Prüfhilfen liegen deshalb unter `tests/support/`: das Glob sammelt sie nicht
  als Testdateien ein.
- Die Eigenschaftsprüfung kommt ohne Bibliothek aus (Gittersweep plus eigener
  LCG-Fuzzer mit festem Seed in `tests/support/gen.ts`).
  `noUncheckedIndexedAccess` macht jeden Indexzugriff `T | undefined`, und das
  selbstgeschriebene `assert.ok` engt nicht ein — dafür gibt es `must()` in
  `tests/support/props.ts`.
- Kein npm, kein `package.json`. `@types/node` gibt es im Pin nicht
  (`nodePackages` wurde aus nixpkgs entfernt); die nötigen Deklarationen
  stehen in `src/kwin/globals.d.ts` und `tests/node-globals.d.ts`.
- Biome 2.5.11 kennt **kein** `ci`-Unterkommando, nur `check`. In der
  Konfiguration heißt es `rules.preset`, nicht `rules.recommended`.
- Biome formatiert auch `biome.json` selbst; nach einer Änderung von Hand
  einmal `biome check --write biome.json` laufen lassen.

## Git & Arbeitsweise

- Eigenständiges Repo, öffentlich unter `github.com/muhackel/kwin-xmonad-lite`.
- **Kein Commit direkt auf `main`.** Jeder Meilenstein ist ein Feature-Branch,
  Merge ausschließlich mit `--no-ff`. Die Wurzel von `main` ist ein leerer
  Commit, damit auch der erste Merge nachvollziehbar bleibt.
- Commit-Betreff deutsch, ohne Präfix; im Rumpf benennen, was verifiziert
  wurde. Keine `Co-Authored-By`-Zeilen, keine KI-Banner.
- `CLAUDE.md`, `README.md` und `build.md` vor jedem Merge auf Aktualität
  prüfen.
- `result`/`result-*` und das gebaute `package/contents/code/main.js` sind
  Build-Artefakte und stehen in `.gitignore`.
- Alles in einer Nix-Umgebung ausführen (`nix develop`, `nix build`,
  `nix run`); die Shell ist zsh.
