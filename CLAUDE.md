# CLAUDE.md — kwin-xmonad-lite

Schlanker Layout-Controller als KWin-Skript für Plasma 6 auf Wayland. Holt
einen Teil des alten XMonad-Arbeitsgefühls zurück: Tall- und Full-Layout,
Tastensteuerung für Fokus, Reihenfolge und Master-Anteil.

Der vollständige Entwurf steht in [`PLAN.md`](PLAN.md), die belegten Quellen
und Messwerte in [`docs/research.md`](docs/research.md), Tasten und
Konfiguration in [`docs/keys.md`](docs/keys.md). **Stand: Meilenstein 6 ist
abgeschlossen; Matrix 18–23 sind live geprüft (299 Tests, `nix flake check`
grün über die vier Checks).** Die Meilensteine 0 bis 5 samt 5.1 und den Audits
sind ebenfalls abgeschlossen. Der Controller kachelt auf allen Ausgaben,
Zustandsübergänge, Float, Dialogfilter und Größenschranken liegen hinter der
Snapshot-Grenze, und seit Meilenstein 6 ist er bedienbar: zwölf `xml-*`-Aktionen,
sechs Konfigurationsschlüssel aus `kwinrc` und ein Home-Manager-Modul auf
plasma-manager-Basis. `Full` ist damit erstmals erreichbar. **Offen:** die
deklarative Abnahme auf HAL9000 (Fälle 24–24e), der modale Dialog als Fokusziel
(20b) und der Wayland-Smoke-Test in einer VM (Meilenstein 7). Fall 20c ist
nicht offen, sondern **nicht herstellbar** (siehe `docs/research.md` 6.7).

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
  gespeicherte Reihenfolge. Der Ghost-Purge steht hier, gerufen wird er über
  `kwin/purge.ts`.
- `src/kwin/` → Adapter. Geteilt an der **Snapshot-Grenze**: `types` (die
  Datensätze), `filter` (Mitgliedschaft, Layout-Teilnahme, Surface-Zuordnung),
  `plan` (die ganze Anordnung), `geometry` (Klemmung und die beiden Urteile),
  `apply` (Geometrieerwartung und Nachbesserung), `epoch` (Anordnungslauf),
  `float` (Float-Zielzustand), `timer` (Entprellung und Nachläufe), `purge`
  (Registry-GC), `command` (die zwölf Tastenaktionen samt Surface-Wahl) und
  `config` (Umwandlung, Prüfung und Klemmung der sechs Schlüssel) sind reine
  Rechnung und mit `node --test` prüfbar. Nur `read` und `adapter` fassen dort
  eine KWin-Global an. `apply` bekommt seinen Fensterzugriff als `GeometryPort`
  und seinen Timer als Fabrik, `config` seinen Leser als `ConfigReader`.
- `boot.ts` trägt den gemeinsamen Init-Retry. `main.ts` startet das
  Produktions-Bundle; `dev.ts` ergänzt nur dort den Float-Toggle im
  Fenstermenü.
- `package/` → KPackage-Wurzel; der Build legt `contents/code/main.js` hinein.
  Das Dev-Bundle liegt getrennt unter `share/kwin-xmonad-lite-dev/dev.js`.
- `dev/probe/` → zwei Proben: `probe.js` misst die Skriptumgebung,
  `signals.js` misst, welche Signale im Betrieb ankommen und was sie tragen
  (siehe unten).
- `nix/` → `package.nix`, `devshell.nix` und `home-module.nix`. Das
  Home-Manager-Modul setzt ausschließlich plasma-manager-Optionen; es hängt als
  `homeModules.default` am Flake (`homeManagerModules.default` ist derselbe
  Wert unter dem älteren Namen). `scripts/` → Lade-, Reload- und
  Journalwerkzeuge.
- `docs/keys.md` → Tastentabelle, objectNames, Konfliktlage, Schlüsseltabelle
  und das zweistufige Wirksamkeitsverfahren. Erste Anlaufstelle für alles, was
  Bedienung oder Konfiguration betrifft.

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
  Timer mit 20 ms feuerte nach 21 ms — das Entprellfenster trägt. **`restart()`
  gibt es nicht** (gemessen abwesend); zum Neustarten `stop()` und `start()`.
  Vorhanden ist dafür `remainingTime`.
- **Benannte Regex-Gruppen parsen, funktionieren aber nicht.** `match.groups`
  bleibt `undefined`. Kein `.groups` im Quelltext.
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
- **`currentDesktopChanged` feuert einmal je Ausgabe**, auch bei
  `perOutputVirtualDesktops = false`, und trägt `(prev, cur, output)`. Während
  der Folge ist `workspace.currentDesktop` noch nicht umgestellt — im Callback
  nur entprellen, gelesen wird erst im Lauf.
- **`activitiesChanged` und `desktopsChanged` melden nur Anlegen und
  Entfernen**, nicht den Wechsel. Für den Registry-GC ist das genau richtig;
  wer damit einen Wechsel abfangen will, wartet vergebens. `activitiesChanged`
  trägt eine UUID, `desktopsChanged` nichts.
- **Ein `outputAdded`/`outputRemoved` gibt es auf `workspace` nicht.**
  `screensChanged` ist das einzige Signal über die Menge der Ausgaben und kommt
  in der Hotplug-Folge **zuletzt** — wer darauf entprellt anordnet, sieht eine
  vollständige Liste. Die Flächen sind dann trotzdem noch nicht fertig.
- **`maximizedChanged` feuert bei jedem Moduswechsel**, auch bei den teilweisen
  Modi 1 und 2 (`xdgshellwindow.cpp:1484-1492`).

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

### Adapter

- **Die Snapshot-Grenze ist die Testgrenze.** Hinter ihr dürfen nur
  `kwin/read.ts` und `kwin/adapter.ts` eine KWin-Global (`workspace`, `KWin`,
  `QTimer`) anfassen; davor tun es die beiden Einstiege `boot.ts` und `dev.ts`.
  Alles andere in `kwin/` rechnet auf `WindowInfo` und läuft unter
  `node --test`. Die Regel ist prüfbar (das Kommando steht in `build.md` und
  läuft rekursiv über ganz `src`, weil `globals.d.ts` auch für `core/` und
  `state/` gilt; Kommentarzeilen müssen herausgefiltert werden, sonst melden
  `types.ts` und `timer.ts` falsch positiv). Wer Logik in den Adapter zieht,
  verliert sie aus den Tests.
- **Kommentare gehören auf eigene Zeilen, nie hinter Code.** Der Grenz-Grep
  wirft nur Zeilen weg, die **vollständig** als Kommentar beginnen. Ein
  nachgestelltes `// workspace.activeWindow` in `command.ts` meldete die Datei
  sofort als Grenzverletzung, obwohl sie keine Global anfasst.
- **`runEpoch` ist die Anordnungsepoche.** `adapter.runArrange` liest den
  Snapshot, bereinigt Registry und Verbindungen und ruft sie. Änderungen am
  Ablauf aus Plan, Teilnehmerwechsel, Writes und Raise gehören in `epoch.ts`.
- **Masteranteil und Layoutindex stehen in `runEpoch` hinter `ports`**, nicht
  davor. Sie kamen in Meilenstein 6 als Default-Parameter ans Ende der
  Signaturen von `createSurface`, `resetLayout`, `getSurface`,
  `planArrangement` und `runEpoch`. Ein eingeschobener Parameter bräche
  `tests/support/epochrig.ts` und jeden bestehenden Aufruf — deshalb hinten
  anhängen, nie einsortieren. Die Namen unterscheiden sich je Schicht:
  `ratio`/`layoutIndex` in `core/stack` und `state/registry`,
  `defaultRatio`/`defaultLayoutIndex` in `kwin/plan` und `kwin/epoch`.
- **`activate` ist der einzige Schreibpfad auf `workspace.activeWindow`** im
  ganzen Baum, und er läuft ausschließlich aus einem Shortcut-Rückruf. Daran
  hängt die Schleifenfreiheit: Aktivieren löst `windowActivated` aus, das eine
  Epoche anmeldet, und **die Epoche aktiviert nie selbst** — sie hebt höchstens
  mit `raiseWindow`. Die Invariante lautet **nicht** „derselbe Fokus kommt
  zurück": KWin darf die Aktivierung ablehnen, an einen modalen Dialog umleiten
  oder ein minimiertes Fenster wiederherstellen (gemessen: es stellt wieder
  her). Der nächste Befehl rechnet dann auf dem Stand, der danach gilt. Wer eine
  Aktivierung in den Anordnungslauf einbaut, baut die Schleife.
- **Ein Tastendruck liest den Snapshot selbst.** `runShortcut` ruft
  `readSnapshot()`, obwohl die entprellte Epoche 20 ms später ohnehin liest —
  dafür gibt es nur einen Lesepfad, und der Befehl prüft sein Fokusziel gegen
  dieselbe Ist-Menge, die er gesehen hat. Die frischen Handles gewinnen vor
  `handles`, werden aber **nicht** übernommen: ein hier eingeschleuster Eintrag
  käme am GC in `runArrange` vorbei.
- **`arrange` hat bei Float und Sink eine andere Quelle als beim Stapel.** Für
  Fokus, Tausch, Layout und Ratio ist es der Objektvergleich gegen den
  abgeglichenen Stand (die Reducer geben bei Wirkungslosigkeit dasselbe Objekt
  zurück). Für Float und Sink nicht: die Markierung sitzt im `WindowState`,
  `order` und `focus` bleiben unberührt — dort entscheidet der `FloatOutcome`.
  Ohne diese zweite Quelle bliebe ein Fenster nach `Meta+T` bis zum nächsten
  fremden Ereignis ungeordnet.
- **Vor dem Reducer wird die gewählte Surface abgeglichen.** Ein Tastendruck
  kann vor der entprellten Epoche eintreffen; ohne den `reconcile` fehlten neu
  erschienene Fenster im Stapel, geschlossene stünden noch darin, und ein
  Fokusbefehl könnte über `activeWindow` sogar einen Desktopwechsel auslösen.
  Derselbe Abgleich macht den Zweig „Ziel nicht mehr im Snapshot" in
  `command.ts` unerreichbar — er bleibt defensiv stehen, aber keine Abnahme
  darf diese Journalzeile erwarten.
- **`moveable`/`resizeable` gehören in die Layout-Teilnahme, nicht in die
  Mitgliedschaft.** Ein Vollbildfenster meldet beide als `false`, ebenso das
  Panel — als Mitgliedschaftskriterium taugen sie für nichts. Entschieden in
  Meilenstein 3, begründet in `PLAN.md` Abschnitt 7.
- **Der Signal-Callback schreibt nie.** `frameGeometryChanged` darf lesen, bei
  Übereinstimmung die Erwartung beruhigen, sonst eine Nachprüfung einplanen —
  mehr nicht. Ein Write innerhalb des Signals wäre ein verschachtelter Write.
  Nachgebessert wird ausschließlich im Recheck-Timer, dort höchstens einmal je
  Fenster und Durchlauf; bis zum Aufgeben braucht es deshalb drei Läufe.
- **Der eigene Schreibvorgang feuert das Signal synchron.** Auf Wayland ist
  eine reine Verschiebung sofort wirksam, `frameGeometryChanged` kommt also
  mitten im Schreiben zurück. Die Sperre dagegen ist ein `Set` der gerade
  beschriebenen Fenster, **kein** globales Flag: das synchrone Signal eines
  anderen Fensters soll währenddessen ausdrücklich durchkommen.
- **Weicht schon das Rücklesen ab, muss die Nachprüfung eingeplant werden.**
  Sich auf ein späteres `frameGeometryChanged` zu verlassen, läuft ins Leere:
  das Signal kann während des eigenen Schreibens gefeuert und dabei verworfen
  worden sein. Ein Fenster mit Größenraster bekäme sonst nie eine Nachbesserung.
- **`place` schreibt Float-Rechtecke.** Die Schreibart setzt keine Erwartung,
  plant keinen Recheck, lässt `tiledRect` unverändert und übernimmt das
  Rücklesen als `lastObservedRect`. Im Journal heißt der Vorgang `float`, nie
  `apply`.
- **`place` ist der dritte Schreibpfad und braucht `judgePlace`.** `judgeWrite`
  schützt die Epoche, `port.blocked` den Recheck — der Float-Toggle hängt an
  keinem von beiden, denn die Float-Markierung folgt der Mitgliedschaft, und
  die kennt weder Vollbild noch Maximierung. Ohne das Urteil schriebe ein
  Toggle am maximierten Fenster dessen `frameGeometry` (`moveResize` prüft den
  Modus nicht). Dasselbe Urteil entscheidet über das **Einfangen**: in einem
  Sonderzustand trägt `frameGeometry` die Vollbildfläche, und die taugt nicht
  als `floatRect` — `anchorInto` verschiebt beim Wiederherstellen nur, es
  verkleinert nicht, das Fenster überdeckte danach das Panel. Der
  Zustandswechsel selbst gilt trotzdem immer; das Journal meldet ihn dann als
  `gefloatetOhneWiederherstellung`. Eine vorhandene `floatRect` setzt dabei
  `floatRestorePending`; die erste Epoche nach Ende des Sonderzustands
  vollzieht `place` genau einmal.
- **Der Recheck prüft `port.blocked` vor jedem Write.** `judgeWrite` schützt nur
  die Epoche; ein bereits geplanter Recheck könnte sonst ein inzwischen
  maximiertes, minimiertes, vollbildiges oder floatendes Fenster beschreiben.
- **`raise` ist eine geordnete Liste.** Der letzte Eintrag liegt oben. Nur das
  Full-Layout hebt Float-Fenster, und zwar in jeder Epoche nach dem gekachelten
  Fenster.
- **Die Schreibgeneration gehört zum Fenster, nicht zur Anordnungsepoche.** In
  Meilenstein 3 hing sie an der globalen Epoche; damit machte schon der nächste
  Lauf eines beliebigen anderen Fensters die offene Erwartung `stale`, und sie
  blieb es für immer. Nur ein neuer Zielwert erhöht sie.
- **Nach dem Aufgeben gilt der beobachtete Istwert als akzeptiert**
  (`lastObservedRect`). Ohne ihn liefe eine verspätete Meldung derselben
  Geometrie als fremde Änderung in einen neuen Anordnungs- und
  Nachbesserungszyklus. Das nicht erreichte Soll bleibt in `tiledRect`, der
  Zähler auf `MAX_CORRECTIONS`. `judgeWrite` meldet `abandoned`, solange eine
  spätere Epoche genau dasselbe Soll und denselben Istwert sieht. Ein anderes
  Ziel oder ein anderer Istwert öffnet einen neuen Versuch; `forget` räumt das
  Sperrmerkmal bei einem Zustandswechsel ab. Der Signalnachhall hängt trotzdem
  allein an `lastObservedRect`, damit eine fremde Verschiebung auf das Soll
  nicht verschluckt wird.
- **Eine fremde Geometrieänderung löst genau einen Lauf aus**, und nur für ein
  Fenster, das zuletzt Layout-Teilnehmer war. Wer das Layout verlässt, verliert
  Erwartung **und** eingeplante Nachprüfung — `clearExpectation` allein räumt
  nur die Registry, deshalb ruft der Adapter zusätzlich `forget`. Dasselbe gilt,
  wenn eine Nachprüfung das Fenster im Ziehen antrifft: die Erwartung fällt,
  sonst schöbe der Signalpfad es nach dem Loslassen ohne Anordnungslauf zurück.
- **Auch der Nachprüfungstimer verlässt sich nicht auf `singleShot`.** Gemessen
  ist nur, dass die Eigenschaft existiert und `false` meldet, nicht dass die
  Zuweisung wirkt — also stoppt `onRecheck` sich selbst zuerst, und wer ein
  Fenster aus der Nachprüfung nimmt, hält den Timer an, sobald nichts mehr
  ansteht. Ein leer feuernder Timer wäre im Journal unsichtbar; nachweisen kann
  ihn nur der Test mit einem Timer, dessen `singleShot` nicht durchschlägt.
- **Die eigentliche Flatterbremse ist `judgeWrite` mit `"unchanged"`.** Eine
  Epoche ohne Änderung schreibt gar nichts, also feuert auch kein Signal. Der
  Versuchszähler ist nur das Netz darunter. Bei `"unchanged"` ruft der Adapter
  `geometry.accept`: eine noch offene Erwartung eines **älteren** Zielwerts ist
  damit erledigt, sonst schöbe der Nachprüfungslauf das Fenster auf das
  veraltete Soll zurück.
- **Jedes gelesene Rechteck ist gerundet.** `kwin/read.ts` schickt
  `frameGeometry` und `clientArea` durch `core/rect.rounded`; gemessen
  ganzzahlig ist nur `clientArea`. Ohne die Rundung meldete `equals` bei
  gebrochener Skalierung in jeder Epoche eine Abweichung, und jeder Lauf
  schriebe erneut.
- **Auch der Init-Retry in `boot.ts` baut nicht auf `singleShot`.** `tryStart`
  stoppt den Timer zuerst und sperrt einen zweiten Start des Adapters — der
  verdrahtete sonst jedes Signal doppelt.
- **Nicht bei jedem Auslöser den Timer neu starten.** Das erste Ereignis
  öffnet das 20-ms-Fenster, alle weiteren steigen zu; ein Neustart je Ereignis
  würde die Anordnung während eines Ereignisstroms beliebig lange verschieben.
- **Zwei verschiedene Id-Normalisierungen.** `window.internalId` ist ein
  Objekt, dessen Zeichenkettenform geschweifte Klammern trägt; `desktop.id`
  ist ein echter String **ohne** Klammern. Nicht dieselbe Behandlung anwenden.
- **`insertUp` dreht bei Mehrfacheinfügung die Reihenfolge um.** Kommen beim
  ersten Abgleich drei Fenster auf einmal, steht das zuletzt eingefügte vorn.
  Im laufenden Betrieb kommt immer nur eines hinzu, dort ist es genau richtig.
- **Nichts an einem toten Fenster lesen.** Die Id wird beim Verbinden einmal
  berechnet und in der Closure gehalten; `windowRemoved` löst nur einen
  Durchlauf aus. `disconnect` braucht dieselbe Funktionsreferenz wie
  `connect`, deshalb liegt je Fenster eine Trennfunktion in der Tabelle.
  **Auch das Trennen selbst wirft an einem toten Fenster** — gemessen
  `Function.prototype.disconnect: cannot disconnect from deleted QObject`.
  Das ist kein Fehler, sondern der Normalfall für ein Fenster, das während
  der Laufzeit verschwand: die Verbindung stirbt mit dem Objekt. Wer
  Trennungen zählt, muss diesen Fall von einem echten Fehler unterscheiden,
  sonst ist der Zähler entweder dauerhaft rot oder wertlos
  (`dev/probe/signals.js`, `runCut`).
- **`clientArea` zieht nach einer Ausgabenänderung nach.** Im Signal ist sie
  noch die alte, nach 500 ms teils noch ein Zwischenstand; erst nach 1500 ms
  stimmte sie (zweimal gemessen). Deshalb **zwei** Nachläufe, nicht einer. Nach
  einer reinen Panelhöhenänderung war sie dagegen schon im entprellten Lauf
  neu (der Moment des Signals ist für diesen Fall nicht gemessen) — der
  Nachlauf ist dort nur Absicherung. Folge für Testmatrix 9: die Zwischenstände werden
  mitgeschrieben, „genau ein Lauf mit Schreibvorgängen" ist beim
  Wiederanstecken nicht zu halten. Geprüft wird der **letzte** Lauf.
- **Ein Nachlauf ruft nie `runArrange` direkt**, immer `debouncer.schedule`.
  Sonst liefe er an der Koaleszierung vorbei und könnte mitten in einen
  laufenden Durchgang schlagen.
- **Docks hängen an einem eigenen, schmalen Signalsatz** und stehen **nicht**
  in `handles`. Sie sind gemessen `managed` und liefen sonst in den vollen
  Satz, wo ihr `frameGeometryChanged` in `geometry.notifyChanged` mangels
  Registry-Eintrag versandet. Die Id für `closed` kommt aus der Closure. Nach
  einem Hotplug kehrt ein Panel als **neues** Fenster zurück — `windowAdded`
  verbindet es, ein einmaliges Verbinden beim Start genügt nicht.
- **Der Dock-Aufbau hängt an `windowAdded`, der Abbau an `closed`** — und
  beide starten die Nachläufe. Ein Panel, das beim Login nach dem Controller
  erscheint, ändert die Arbeitsfläche, ohne dass zwingend ein Geometriesignal
  folgt; ohne den Nachlauf bliebe eine verspätet aktualisierte `clientArea`
  ungelesen. `start()` löst dagegen bewusst **keinen** Nachlauf aus, damit das
  Laden ein einziger Lauf bleibt.
- **Der Nachlauf trägt seine Quellen im Grund** (`nachlauf500:dockHinzugefügt`).
  Fünf Auslöser starten dieselben zwei Timer; ohne die Quelle ist im Journal
  nicht zu sehen, welcher es war, und der Dock-Zweig wäre nicht abnehmbar. Die
  Quellen werden **gesammelt**, nicht überschrieben: bei „letzter gewinnt"
  verschwände die gesuchte Quelle, sobald danach noch etwas auslöst. Geleert
  wird der Satz vom letzten Nachlauf einer Runde und von `cancel()`.
- **Der Registry-GC ist ein reiner Schritt** (`kwin/purge.ts`), kein
  Adaptercode. Die Snapshot-Listen werden dort **explizit** zu `Set<string>`:
  ein durchgereichtes Array wäre für `purgeSurfaces` still „nichts ist gültig"
  und löschte jede Surface. Eine leere Liste gilt als misslungener
  Lesedurchgang und löscht **keine Surfaces** — KWin hat immer mindestens eine
  Activity und einen Desktop. Die **Fensterzustände** werden davor regulär
  bereinigt; der Schutz greift nur für den Surface-Teil.
- **Jede Ausgabe läuft durch `log()`**, sonst greift der Journalfilter in
  `scripts/logs.sh` nicht und die Zeile ist bei `nix run .#logs` unsichtbar.

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
- **KConfig ersetzt bei typisiertem Vorgabewert selbst — deshalb Rohstring plus
  Sentinel.** `readConfig` reicht an `KConfigGroup::readEntry(key, default)`
  durch, und ein nicht konvertierbarer Eintrag kommt dort schon als Vorgabewert
  heraus. Mit `Number(readConfig("gapOuter", 0))` wäre `gapOuter=abc` von „nicht
  gesetzt" nicht zu unterscheiden und die versprochene Korrekturnotiz nie zu
  erzeugen. Der Adapter liest deshalb gegen `RAW_UNSET` und gibt Rohzeichen-
  ketten weiter; die ganze Prüfung liegt in `kwin/config.ts` hinter der
  Snapshot-Grenze. Aus demselben Grund gilt reiner Leerraum als **unlesbar**,
  nicht als `0` — `Number("")` ist `0` und damit endlich.
- **Die Konfiguration wird genau einmal gelesen**, am Anfang von `start()`. Ein
  Lesen je Epoche hinge an veränderlichem Außenzustand, ohne je einen anderen
  Wert zu sehen. Folge: eine Änderung ist **zweistufig** — `kwriteconfig6`,
  dann `reconfigure` über D-Bus, dann eine Sekunde warten, dann `nix run
  .#reload`; `scripts/reload.sh` ruft `reconfigure` **nicht**. In der Produktion
  wirkt sie erst nach Ab- und Anmeldung.
- **Zwei Gruppen, je nach Instanz.** Die Entwicklungsinstanz lädt unter dem
  Namen `kwin-xmonad-lite-dev` und liest deshalb aus
  `[Script-kwin-xmonad-lite-dev]`, die Produktion aus
  `[Script-kwin-xmonad-lite]`. Wer beim Erproben in die Produktionsgruppe
  schreibt, sieht keine Wirkung und sucht den Fehler im Code.
- `registerShortcut` ruft `KGlobalAccel::setShortcut` **ohne** `NoAutoloading`
  und liefert **immer** `true`, auch bei einer Kollision. Der Rückgabewert ist
  deshalb wertlos und wird nicht geprüft. Ein vorhandener Eintrag in
  `kglobalshortcutsrc` überschreibt die im Code angegebene Taste, und tote
  Einträge reservieren Tasten weiter (dort stehen 35 `Krohnkite*`- und 20
  `Polonium*`-Leichen).
- **Gemessen am 2026-09-06, nicht mehr nur aus dem Quelltext geschlossen:** nach
  der Registrierung stehen **beide** Aktionen gleichzeitig in
  `kglobalshortcutsrc`, und beim Tastendruck gewinnt der **vorhandene** Eintrag
  — `Meta+L` sperrte die Sitzung, `Meta+T` öffnete den Kachel-Editor. Die
  Umlegung der KDE-Kürzel in der Host-Konfiguration ist damit **Voraussetzung**,
  nicht Absicherung.
- **`objectName`s sind unwiderruflich.** Es gibt kein `unregisterShortcut`;
  jede Umbenennung hinterlässt eine Leiche, die die Taste weiter reserviert.
  Auch nach dem Abschalten des Skripts bleiben die zwölf `xml-*`-Zeilen stehen
  — das ist erwartet, kein Rückstand. Die im Code stehenden Tasten sind nur die
  **Erstinstallations-Vorgabe**; eine spätere Änderung erreicht keine Maschine,
  die das Skript schon geladen hat.
- `registerUserActionsMenu` ruft den Callback bei jedem Öffnen mit dem
  betroffenen Fenster auf. `triggered` bekommt die QAction, deshalb kommt das
  Fenster aus der äußeren Closure (`scripting.cpp:461-530`). Das Projekt nutzt
  die Funktion nur im Dev-Bundle.

### Werkzeugkette

- **In den Entwicklungsskripten ist jeder früh endende Leser einer Pipeline
  eine Falle.** `writeShellApplication` setzt `pipefail` **und** `errexit`:
  `awk … exit`, `grep -q` und `grep -m1` beenden sich beim ersten Treffer, die
  Vorstufe bekommt SIGPIPE, die Pipeline meldet 141 — und das Skript endet
  wortlos, oft noch vor der ersten Ausgabezeile. Deshalb liest `awk` bis `END`,
  Mengenprüfungen laufen über `<<<` statt über eine Pipe, und auf eine
  Journalzeile wird mit `grep … >/dev/null` gepollt statt mit
  `journalctl -f | grep -q -m1` gewartet. Letzteres meldete einen Fehlschlag
  genau dann, wenn die Zeile da war.
- **Ein laufendes Shellskript nie überschreiben.** bash liest die Datei
  byteweise nach; ein Überschreiben mitten im Lauf führt zu
  `syntax error near unexpected token` an einer Stelle, die im Quelltext gar
  nicht existiert. Für eine geänderte Fassung eine neue Datei anlegen.
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
- **`biome check .` bricht in einem Agenten-Worktree unter `.claude/worktrees/`
  ab** — „No files were processed in the specified paths". Das Ausschlussmuster
  `!**/.claude` aus `biome.json` greift dort gegen den absoluten Pfad und
  schließt damit den ganzen Baum aus. Dort ist `biome check src tests` das
  richtige Kommando. Das Muster ersatzlos zu streichen hilft nicht: ohne es
  findet `biome check .` im Hauptbaum die `biome.json` des Worktrees und bricht
  mit „nested root configuration" ab.
- `nix run .#size-window` startet den Xwayland-Testclient für Mindest-, Höchst-
  und Rastergrößen. Der nackte `pkgs.python3` enthält im Pin kein `_tkinter`;
  der App-Wrapper braucht `python3Packages.tkinter`.

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
