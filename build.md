# build.md — kwin-xmonad-lite

## Voraussetzungen

- Nix mit aktivierten Flakes (`experimental-features = nix-command flakes`).
- Für alles, was in KWin lädt: eine laufende Plasma-6-Sitzung auf Wayland.
  Die Skripte sprechen KWin über den Sitzungs-D-Bus an.

Sämtliche Werkzeuge kommen aus dem gepinnten nixpkgs. Es gibt **kein**
`package.json` und keine npm-Abhängigkeiten.

## Entwicklungsumgebung

```bash
nix develop
```

Enthält TypeScript, Node, esbuild, Biome, shellcheck, git sowie
`kpackagetool6`, `qdbus` sowie `kwriteconfig6` und `kreadconfig6`.

## Bauen & Starten

### Paket bauen

```bash
nix build
find result/ -type f
# result/share/kwin/scripts/kwin-xmonad-lite/{metadata.json,LICENSE,README.md,contents/code/main.js}
# result/share/kwin-xmonad-lite-dev/dev.js
```

### In die laufende Sitzung laden

```bash
nix run              # = nix run .#dev-load
nix run . -- --menu   # Dev-Bundle mit Float-Toggle im Fenstermenü
nix run .#reload     # nach einer Änderung
nix run .#unload     # Entwicklungsinstanz entladen
nix run .#logs       # Journal verfolgen, -a für ungefiltert
```

`dev-load` bricht ab, wenn die deklarativ aktivierte Produktionsinstanz geladen
ist — zwei Layout-Controller gleichzeitig wären fatal. `--menu` lädt das
getrennte Dev-Bundle unter demselben Namen wie die normale
Entwicklungsinstanz; beide können daher ebenfalls nicht nebeneinander laufen.

### Feature-Probe

```bash
nix run .#probe                # rein lesend
nix run .#probe -- --shortcuts # zusätzlich die Shortcut-Phase
```

Die Probe misst die KWin-Skript-Umgebung (ES-Sprachniveau, Globals, Enums,
Laufzeit-Oberflächen, QTimer-Verhalten), schreibt das Ergebnis als
`probe-<Zeitstempel>.ndjson` ins Arbeitsverzeichnis und räumt anschließend
restlos auf. Der Rückbau wird im selben Lauf nachgewiesen.

### Signalprobe

```bash
nix run .#probe-signals                    # führt durch die Handgriffe
nix run .#probe-signals -- --hotplug DP-9  # schaltet die Ausgabe selbst ab und an
```

Misst, welche KWin-Signale im Skriptkontext ankommen und was sie tragen:
Signaturen der Workspace-Signale, `workspace.desktops`, das Verhalten von
`clientArea` rund um Dock-Ereignisse (sofort, nach 500 und nach 1500 ms) und
die Reihenfolge beim Hotplug. Ergebnis als `signals-<Zeitstempel>.ndjson`,
Auswertung in `docs/research.md` Abschnitt 3.

Der Lauf dauert knapp drei Minuten und führt durch sechs Phasen. Zwei davon
verlangen einen Handgriff (Desktop wechseln, Panelhöhe ändern), die übrigen
erledigt das Skript: es legt einen virtuellen Desktop und eine Activity an und
entfernt beides wieder — anders zeigen sich `desktopsChanged` und
`activitiesChanged` nicht, denn sie melden nur Anlegen und Entfernen. Beide
Eingriffe werden im selben Lauf zurückgenommen und die Zahlen geprüft.

**Anders als die Feature-Probe verbindet diese Probe echte Signale.** Sie führt
deshalb über jede Verbindung Buch, trennt vor dem Abschlusssatz sämtliche
Verbindungen, stoppt alle eigenen Timer und meldet beides (`"offen":0`,
`"timer_aktiv":0`); das Shellskript entlädt danach und weist nach, dass keine
Zeile mehr kommt. Es gibt keinen Unload-Hook — eine überlebende Verbindung
würde später in eine zerstörte Engine feuern.

Das Skript **wertet diesen Abschlusssatz aus**: fehlt er, oder weicht `st`,
`offen`, `timer_aktiv` oder `cut_fehler` ab, geht das in den Exit-Code. Nur
`cut_tot` wird bloß berichtet — Trennungen an einem bereits gelöschten QObject
sind der Normalfall für Panels, die während des Laufs verschwinden, und ihre
Zahl hängt am Bedienablauf (`docs/research.md` Abschnitt 3.5). Am Ende prüft
das Skript sechs Zustände gegen die Ausgangslage (Desktopmenge, aktueller
Desktop, Activitymenge, aktuelle Activity, Zustand der Hotplug-Ausgabe,
`isScriptLoaded`). Jeder Eingriff wird zurückgenommen, auch bei einem Abbruch
mit Strg-C: der EXIT-Trap räumt genau einmal auf, und eine Ausgabe, die sich
nicht wieder einschalten ließ, wird dort erneut versucht.

### Geometrie-Probe

```bash
nix run .#probe-geometry                # nur Datenqualität und Invarianten
nix run .#probe-geometry -- --erwarte layout=tall n=3 ratio=0.65 gaps=0/0
```

Misst die anliegenden Fenstergeometrien, die nutzbare Arbeitsfläche je Surface
und das aktive Fenster aus dem Skriptkontext, viermal gestaffelt (0, 500, 1500
und 3000 ms), und schreibt sie als `geometry-<Zeitstempel>.ndjson` samt dem
zugehörigen Controller-Journalauszug. Danach läuft das Orakel darüber und
übernimmt dessen Exit-Code. Ohne `--erwarte` prüft es nur Datenqualität und
Einschwingen, mit `--erwarte` zusätzlich das Journal gegen die vorgegebenen
Werte und erst danach die Geometrie.

Die Probe ist strikt lesend und verbindet kein KWin-Signal — nur `timeout` an
eigenen Timern; `checks.probe-readonly` erzwingt das. Ausführlich im Abschnitt
„Abnahme Matrix 16–17, 20b und 25–27".

### Journal-Auditor

```bash
nix run .#audit                          # letzte 60 min als Alltagsstunde
nix run .#audit -- --seit "-10 min"      # kürzerer Blick, ohne Belegschwelle
nix run .#audit -- <datei>               # gesicherter Auszug
```

Sucht Geometrie-Schleifen: er zählt alle Schreibarten (`apply`, `float`,
`nachbessern`), ordnet Nachbesserungen der Schreibgeneration des Fensters zu
und lässt technische Gründe wie `geometrieExtern` oder `nachlauf*` nicht als
neuen Anlass gelten.

## Testen / Checks

```bash
nix flake check      # Paketbau (inkl. Typprüfung und Unit-Tests), Lint,
                     # Skripte, Snapshot-Grenze, Lesbarkeit der Geometrie-Probe,
                     # einziger Aktivierungspfad, Home-Manager-Modul
                     # ein- und ausgeschaltet
```

Acht Checks: `package`, `lint`, `scripts`, `snapshot-boundary`,
`probe-readonly`, `activate-once`, `home-module` und `home-module-disabled`.

`checks.snapshot-boundary` erzwingt die weiter unten beschriebene Grenze als
Derivation. Das Grep-Paar ist dasselbe; der Check wirft zusätzlich die vier
erlaubten Dateien weg und scheitert mit der Trefferzeile, wenn etwas übrig
bleibt. Vorher war die Grenze nur Prosa — `tsc` beanstandet einen
`workspace`-Zugriff in `core/` oder `state/` nicht, ein neuer Globalzugriff
wäre also grün durchgelaufen.

`checks.probe-readonly` hält fest, dass `dev/probe/geometry.js` strikt lesend
bleibt: keine Geometrie-Writes, kein `activeWindow`, kein `raiseWindow` und
keine Verbindung zu einem KWin-, Fenster- oder Output-Signal. Erlaubt bleibt
`timeout.connect` an eigenen QTimern — ohne das gäbe es keine zeitversetzten
Samples. Eine Probe, die selbst schreibt, könnte das Prüfergebnis herstellen,
das sie belegen soll.

`checks.activate-once` erzwingt, dass es genau **einen** Schreibzugriff auf
`workspace.activeWindow` gibt, und zwar in `src/kwin/adapter.ts`. Daran hängt
die Schleifenfreiheit: Aktivieren löst `windowActivated` aus, das eine Epoche
anmeldet, und die Epoche aktiviert nie selbst. Ein zweiter Schreibpfad wäre im
Journal nicht von einem einzelnen Versuch zu unterscheiden — genau das prüft
Fall 20b.

`checks.home-module` wertet das Home-Manager-Modul mit **aktiviertem** Zweig
aus: es baut ein `activationPackage` mit `programs.kwin-xmonad-lite.enable`,
sucht darin das von plasma-manager erzeugte `data.json` und prüft mit `jq` das
Plugin-Flag, alle sechs Schlüssel der Gruppe `[Script-kwin-xmonad-lite]` und
alle zwölf `xml-*`-Tasten. Die Paare zieht ein `awk` aus `SHORTCUTS` in
`src/kwin/command.ts` — damit ist zugleich geprüft, dass die Nix-Tabelle
`defaultShortcuts` und die TypeScript-Tabelle nicht auseinanderlaufen.
`kwinrc` selbst entsteht erst zur Aktivierungszeit auf der Maschine und ist in
einer Derivation nicht zu prüfen. `excludes` bleibt in der Prüfkonfiguration
bewusst ungesetzt — damit belegt der Check, dass auch ein nicht gesetzter
Schlüssel mit seinem Vorgabewert geschrieben wird. Ein bloßer Import prüfte nur
die Optionsdeklarationen.

`checks.home-module-disabled` ist das Gegenstück: dieselbe Auswertung mit
`enable = false`, aber ausdrücklich gesetztem `programs.plasma.enable`. Erwartet
werden `kwin-xmonad-liteEnabled = false` und zwölf Tasten auf `none`. Ohne
diesen Check fiele nicht auf, dass das Abschalten nichts zurücknimmt.

Einzeln in der Entwicklungsumgebung:

```bash
tsc --noEmit                 # Typprüfung
node --test tests/*.test.ts  # Unit-Tests, nativ mit Type-Stripping
biome check .                # Lint und Format
```

**In einem Agenten-Worktree unter `.claude/worktrees/` bricht `biome check .`
ab** („No files were processed in the specified paths"): das Ausschlussmuster
`!**/.claude` aus `biome.json` greift dort gegen den absoluten Pfad und schließt
damit den ganzen Baum aus. Dort ist `biome check src tests` das richtige
Kommando. Das Muster ersatzlos zu streichen hilft nicht — ohne es findet
`biome check .` im Hauptbaum die `biome.json` des Worktrees und bricht mit
„nested root configuration" ab.

Getestet werden `src/core/`, `src/state/` und der überwiegende Teil von
`src/kwin/`. Der Adapter ist an der **Snapshot-Grenze** geteilt: er liest die
KWin-Objekte einmal je Durchlauf in schlichte Datensätze aus. Fensterfilter,
Surface-Zuordnung, Anordnung, Geometrieklemmung, Nachbesserungswächter,
Float-Toggle und die vollständige Epoche sind reine Rechnung unter
`node --test`.

Auch die **Signalfolge** ist geprüft: `src/kwin/apply.ts` bekommt den
Fensterzugriff als `GeometryPort` und den Timer als Fabrik herein, und
`tests/kwin-apply.test.ts` stellt damit den ganzen Ablauf nach — synchroner
Rückstoß während des Schreibens, abweichendes Rücklesen, verspätete
Bestätigung, zwei Nachbesserungen, Aufgeben, der Nachhall danach, das Signal
eines zweiten Fensters mitten im Schreibvorgang, das zwischendurch geschlossene
Fenster und die Nachprüfung, die das Fenster im Ziehen antrifft. Auch der
Nachprüfungstimer selbst steht unter Test: einer, dessen `singleShot` nicht
durchschlägt, muss trotzdem zur Ruhe kommen.

**Was der Unit-Test nicht abdeckt, und zwar grundsätzlich:** welches
KWin-Signal an welchen Handler geht. Dass Docks am schmalen Satz hängen, dass
`activitiesChanged` und `desktopsChanged` am Entpreller hängen und die
Nachläufe an `screensChanged` — das steht ausschließlich in `adapter.ts` und
wird nur auf der Maschine abgenommen (Matrix 9 und 10). Der Dock-Filtertest in
`tests/kwin-filter.test.ts` belegt nur, dass ein Dock kein Layoutrechteck
bekommt, **nicht**, dass sein Signal ankommt.

Vier Dateien fassen eine KWin-Global an: die beiden Einstiege `src/boot.ts`
und `src/dev.ts` sowie — hinter der Snapshot-Grenze — `src/kwin/read.ts` und
`src/kwin/adapter.ts`. Alle vier werden auf der Maschine geprüft, nicht im
Unit-Test. Die Grenze ist nachprüfbar:

```bash
grep -rnE '(^|[^[:alnum:]_$])(workspace|KWin|QTimer|options|registerUserActionsMenu|registerShortcut|readConfig)([^[:alnum:]_$]|$)' src --include='*.ts' \
  | grep -vE '(globals\.d\.ts|:[0-9]+:[[:space:]]*(\*|//|/\*))'
# darf nur Zeilen aus boot.ts, dev.ts, read.ts und adapter.ts zeigen
```

Dasselbe Musterpaar steckt in `checks.snapshot-boundary` und läuft mit
`nix flake check` mit; die beiden Stellen sind deckungsgleich zu halten.

Der `grep` läuft rekursiv über ganz `src`, nicht nur über `src/*.ts` und
`src/kwin/*.ts`: `tsc` beanstandet einen `workspace`-Zugriff in `core` oder
`state` nicht, weil `globals.d.ts` für den ganzen Baum gilt. Die Suche gilt den
nackten Bezeichnern; damit fallen auch Klammerzugriffe, Aliase und
`new (QTimer)` auf.

Der zweite `grep` wirft Kommentarzeilen weg — `types.ts` und `timer.ts`
erwähnen die Globals in ihren Erklärungen, ohne sie zu benutzen. `boot.ts` und
`dev.ts` sind die beiden KWin-Einstiege; hinter der Snapshot-Grenze bleiben
weiterhin nur `read.ts` und `adapter.ts`.

`node --test tests/` funktioniert **nicht**: Node deutet das Verzeichnis als
Modulpfad. Immer die Dateien angeben. Aus demselben Grund liegen die
Testhilfen unter `tests/support/` — dort sammelt das Glob sie nicht ein.

### Abnahme auf der Maschine

Was der Unit-Test nicht abdeckt — Signalverdrahtung, Auslesen, das Verhalten
von KWin selbst —, wird in der laufenden Sitzung geprüft. Erst laden, dann in
einem zweiten Terminal das Journal verfolgen:

```bash
nix run
nix run .#logs
```

Der Adapter schreibt eine Zeile je Anordnungsepoche, eine je Surface und eine
je tatsächlich geschriebener Geometrie:

```
kwin-xmonad-lite: bereit perOutputDesktops=false
kwin-xmonad-lite: arrange #2 grund=windowActivated,windowAdded surfaces=3 mitglieder=8 teilnehmer=5
kwin-xmonad-lite: surface <activity>|<desktop>|DP-10 layout=tall n=3 ratio=0.65 fläche=2560x1410+0+0
kwin-xmonad-lite: apply {0fb083bd-…} soll=1664x1410+0+0
```

Dazu ab Meilenstein 4:

```
kwin-xmonad-lite: dockHinzugefügt {285a8fb6-…}    # Panel ist erschienen
kwin-xmonad-lite: dockGeometrie {285a8fb6-…}      # Panel hat sich bewegt
kwin-xmonad-lite: dockEntfernt {baff47ba-…}       # Panel ist verschwunden
kwin-xmonad-lite: gc #83 fenster=0 surfaces=3     # Registry-GC dieses Laufs
kwin-xmonad-lite: surface entfernt <activity>|<desktop>|DP-1
kwin-xmonad-lite: arrange #61 grund=nachlauf500:dockHinzugefügt+dockGeometrie
```

Und ab Meilenstein 6:

```
kwin-xmonad-lite: config gaps=8/4 ratio=0.5 layout=1 excludes=3 debug=true
kwin-xmonad-lite: config gapOuter=abc unlesbar, verwende 0   # je Korrektur eine
kwin-xmonad-lite: config excludes=krunner,plasmashell,…      # nur bei debug=true
kwin-xmonad-lite: shortcuts n=12
kwin-xmonad-lite: befehl focusNext surface=…|…|DP-1 via=aktiv fokus={911cbadb-…}
kwin-xmonad-lite: arrange #7 grund=windowActivated,shortcut:focusNext …
```

Die `config`-Zeilen stehen einmal beim Laden; `layout=` ist der Index in
`LAYOUTS` (0 = `tall`, 1 = `full`). `via=` nennt, wie die Surface gefunden
wurde: `aktiv`, `ausgabe` oder `erste`.

Der Nachlaufgrund trägt seine **Quellen** mit: `dockHinzugefügt`,
`dockGeometrie`, `dockEntfernt`, `screensChanged` und `screenGeometry` starten
dieselben zwei Timer. Sie werden über die ganze Runde gesammelt und erst vom
Nachlauf nach 1500 ms geleert — ein Nachlauf ist damit eindeutig zuzuordnen,
auch wenn zwischendurch noch etwas auslöst.

`perOutputDesktops` steuert kein Verhalten, macht einen Journalauszug aber
deutbar. Die `gc`-Zeile trägt die Epoche, weil sie **vor** der `arrange`-Zeile
desselben Laufs steht.

**Testmatrix 1** — ein Fenster allein auf einem Bildschirm bekommt die ganze
Arbeitsfläche. Auf SPIELKISTE ist das `2560x1410`, nicht `2560x1440`: der
Panelabzug muss sichtbar sein, sonst hat der Leser `FullScreenArea` statt
`MaximizeArea` erwischt.

**Testmatrix 2** — bei drei Fenstern und Verhältnis 0,65 muss der Master
`1664x1410` breit sein und die beiden Stapelzeilen je `896x705`. Dieselben
Zahlen stehen in `tests/kwin-plan.test.ts`; stimmen Journal und Test überein,
sind Adapter und Kern in Deckung. Weicht eine Stapelbreite nach oben ab, ist
das keine Abweichung, sondern die Klemmung an der Mindestbreite des Fensters —
solche Zellen bleiben am rechten Rand der Arbeitsfläche verankert.

**Kein Flattern.** Die schärfste Laufzeitprobe ist ein Reload: nach
`nix run .#reload` darf **keine einzige** `apply`-Zeile mehr erscheinen. Der
neue Durchlauf baut den Zustand aus der Ist-Menge neu auf und findet jedes
Fenster bereits am richtigen Platz. Das zeigt zweierlei: die Geometrien sind
angekommen, und es hängt keine Signalverbindung doppelt. Ein Beweis für **alle**
Signal- und Verbindungslebenszyklen ist es nicht — ob Qt beim `deleteLater()`
eines entladenen Skripts jede Verbindung trennt, bleibt unbelegt, und der
Reload prüft nur den ruhenden Zustand.

Im Leerlauf darf ohne Nutzeraktion gar nichts geschrieben werden:

```bash
journalctl --user -u plasma-kwin_wayland --since "-5 min" -o cat \
  | grep -c 'kwin-xmonad-lite: apply'      # erwartet: 0
```

Über eine Stunde normaler Arbeit gilt das Kriterium aus `PLAN.md`
Abschnitt 11 — kein Fenster mehr als dreimal ohne Nutzeraktion:

```bash
journalctl --user -u plasma-kwin_wayland --since "-60 min" -o cat \
  | grep 'kwin-xmonad-lite: apply' | awk '{print $3}' | sort | uniq -c | sort -rn | head
```

Zeilen mit `nachbessern` oder `aufgegeben` weisen auf ein Fenster hin, das die
geschriebene Größe nicht annimmt; bis zu zwei Nachbesserungen je
Schreibgeneration sind vorgesehen, danach ruht der Fall bis zum nächsten
äußeren Ereignis. Bleiben sie im Journal aus, ist das ein **positiver
Laufzeitbefund** — kein Nachweis, dass der Nachbesserungspfad funktioniert. Den
führt `tests/kwin-apply.test.ts`.

Eine `extern`-Zeile meldet, dass ein anderes Programm die Geometrie eines
Layout-Teilnehmers verändert hat; darauf folgt genau ein
`arrange grund=geometrieExtern`, der das Fenster zurückholt. Folgt darauf eine
zweite `extern`-Zeile für dasselbe Fenster, ist die Nachhall-Erkennung
kaputt.

**Testmatrix 3–5** — mehrere Ausgaben und Desktops. Jede sichtbare Ausgabe
bekommt eine eigene `surface`-Zeile mit eigener Reihenfolge, eigenem
Verhältnis und eigenem Layout. Eine fremde Verschiebung auf einer Ausgabe darf
auf den übrigen **keine** `apply`-Zeile erzeugen. Ein Desktopwechsel ergibt
genau einen Lauf — `currentDesktopChanged` feuert zwar einmal je Ausgabe, die
Entprellung fasst das zusammen — mit neuen Surface-Schlüsseln und ohne
`apply` für Fenster, die auf ihrem Desktop bleiben. Der Per-Output-Desktop-Fall
ist auf dieser Maschine **nicht** abnehmbar (`perOutputVirtualDesktops=false`);
er steht ausschließlich in `tests/kwin-plan.test.ts`.

**Testmatrix 9** — Bildschirm ab- und anstecken:

```bash
kscreen-doctor output.DP-10.disable
kscreen-doctor output.DP-10.enable
```

Beim Abstecken kommt genau ein Lauf mit Schreibvorgängen, danach die beiden
Nachläufe ohne. Beim **Anstecken** sind es mehrere: die Arbeitsfläche zieht bis
zu 1,5 s nach (`docs/research.md` Abschnitt 3.3), und jeder Zwischenstand wird
mitgeschrieben. Geprüft wird deshalb der **letzte** Lauf — er muss auf der
eingeschwungenen Fläche rechnen (auf SPIELKISTE `2560x1410`, nicht `1440`) —,
und dass nach dem 1500-ms-Nachlauf Ruhe ist. Der Zustand der abgesteckten
Ausgabe überlebt am Namen: nach dem Anstecken steht die alte Reihenfolge wieder
da.

Der Registry-GC lässt sich gezielt auslösen, ohne etwas zu hinterlassen:

```bash
busctl --user call org.kde.KWin /VirtualDesktopManager \
  org.kde.KWin.VirtualDesktopManager createDesktop us 4 kxl-gc
# auf den neuen Desktop wechseln und zurück, damit Surfaces entstehen
busctl --user call org.kde.KWin /VirtualDesktopManager \
  org.kde.KWin.VirtualDesktopManager removeDesktop s <uuid>
# erwartet: gc #N fenster=0 surfaces=3 plus drei "surface entfernt"-Zeilen
```

**Dock-Aufbau** — dass ein *erscheinendes* Panel die Nachläufe startet, ist nur
zu sehen, wenn beim Laden **kein** Dock existiert; sonst löst schon der Abbau
über `closed` dieselben Timer aus:

```bash
systemctl --user stop plasma-plasmashell.service   # Panels verschwinden
nix run .#dev-load                                 # Controller ohne jedes Dock
systemctl --user start plasma-plasmashell.service
```

Erwartet: je Panel eine Zeile `dockHinzugefügt {…}`, danach
`arrange … grund=nachlauf500:dockHinzugefügt` und `nachlauf1500:…` — und
**kein** `dockEntfernt`, weil beim Laden kein Dock verbunden war. Damit kann
der Nachlauf nur aus dem `windowAdded`-Zweig stammen. Gemessen auf SPIELKISTE:
der Startlauf rechnete noch mit `fläche=…x1440`, der Lauf nach dem letzten
`dockHinzugefügt` mit `1410`.

**Testmatrix 10** — Panelhöhe ändern. Erwartet: `dockGeometrie`, danach ein
Lauf mit bereits **neuer** Fläche (`fläche=2560x1404` statt `1410`) und die
zugehörigen `apply`-Zeilen. Anders als beim Hotplug ist `clientArea` hier
schon im entprellten Lauf aktuell; die Nachläufe finden nichts mehr zu tun. Während des Ziehens am
Höhenregler kommt je Zwischenschritt ein Lauf — das ist die laufende
Nutzeraktion, kein Flattern. Nach dem Loslassen muss es still sein.

### Abnahme Matrix 11–15

Die KWin-Aktionen lassen sich ohne neue Tastenbelegung über kglobalaccel
auslösen:

```bash
kxl_action() {
  busctl --user call org.kde.kglobalaccel /component/kwin \
    org.kde.kglobalaccel.Component invokeShortcut s "$1"
}
kxl_action "Window Fullscreen"            # Matrix 12
kxl_action "Window Maximize"              # Matrix 12a, Modus 3
kxl_action "Window Maximize Horizontal"   # Matrix 12a, Modus 2
kxl_action "Window Maximize Vertical"     # Matrix 12a, Modus 1
kxl_action "Window Minimize"              # Matrix 13
```

Die reproduzierbaren Testfenster starten so:

```bash
nix run .#size-window -- --min 1200x900 --title kxl-min
nix run .#size-window -- --max 800x500 --title kxl-max
nix run .#size-window -- --grid 20x10 --title kxl-raster
nix shell nixpkgs#foot -c foot -T kxl-stubborn
nix shell nixpkgs#kdePackages.kdialog -c kdialog --msgbox Hallo
# Transient: in kwrite Strg+O
```

**Testmatrix 11** — Dialog oder Transient über einem gekachelten Elternfenster
öffnen. Die Dialog-ID darf in keiner `apply`-Zeile stehen. Das Elternfenster
bleibt gekachelt, die Mitgliederzahl unverändert.

**Testmatrix 12** — bei mindestens drei Fenstern eines in echtes Vollbild und
zurück schalten. Im Vollbild stehen zwei Layout-Teilnehmer im Journal; der
Controller schreibt das Vollbildfenster nicht. Nach der Rückkehr erhält es
dieselbe Zelle wie vorher.

**Testmatrix 12a** — vollständige, horizontale und vertikale Maximierung
getrennt prüfen. Die Modi 3, 2 und 1 verlassen das Layout. Währenddessen gibt
es für die Fenster-ID weder `apply` noch `nachbessern`; nach Restore kehrt sie
an dieselbe Stelle zurück. Der Controller enthält keinen Aufruf von
`setFullScreen` oder `setMaximize`.

**Testmatrix 13** — das mittlere von mindestens drei Fenstern minimieren und
über die Taskleiste wiederherstellen. Die Surface meldet erst zwei, dann drei
Teilnehmer. Die Position in der Reihenfolge bleibt gleich; beim
Wiederherstellen schreibt der Controller nur, wenn KWin die Geometrie geändert
hat.

**Testmatrix 14** — mit `nix run . -- --menu` laden. Am Testfenster Alt+F3 →
Extensions → „Float umschalten (kxl-dev)" wählen, das Fenster verschieben,
wieder einkacheln und erneut floaten. Erwartete Folge: `gefloatet` ohne
`apply` an dieser ID, `gekachelt` mit einem `apply` auf die alte Zelle,
`wiederhergestellt` mit `float … soll=<gezogene Geometrie>` und ohne `apply`.
Der Menüeintrag ist im Float-Zustand angehakt. Danach `nix run .#unload`:
`isScriptLoaded` meldet `false` und „Extensions" ist fort.
`kglobalshortcutsrc` enthält danach genau die zwölf `xml-*`-Zeilen und keine
weiteren — ab Meilenstein 6 registriert jedes Laden diese Aktionen, und es gibt
kein `unregisterShortcut`, sie bleiben also auch nach dem Entladen stehen. Bis
Meilenstein 5 lautete das Kriterium hier „Datei unverändert"; das ist seitdem
falsch.

**Testmatrix 15** — `kxl-min` und `kxl-max` in Stapelzellen legen. Soll und Ist
müssen die geklemmte, in der Arbeitsfläche verankerte Geometrie zeigen. Nach
dem Einschwingen fünf Minuten lang kein `apply`, kein `aufgegeben` und keine
Ausnahme. `kxl-raster` belegt die X11-Größenhinweise, erzwingt unter KWin 6.7.4
aber keine Ablehnung: `frameGeometry` darf außerhalb des Rasters ankommen.
Den Give-up-Pfad deshalb mit dem nativen Wayland-Client `kxl-stubborn` prüfen:
höchstens drei Writes und genau ein `aufgegeben`. Ein anschließender
Fokuswechsel erzeugt eine neue Epoche, aber keinen weiteren Write auf dieselbe
ID. Ein neues Layoutziel oder eine fremde Verschiebung darf wieder einen
Versuch auslösen.

Zum Abschluss Reload und Grenzen prüfen:

```bash
nix run .#reload
sleep 2
journalctl --user -u plasma-kwin_wayland --since "-10 s" -o cat \
  | grep -c 'kwin-xmonad-lite: apply'   # erwartet: 0
nix run .#unload
busctl --user call org.kde.KWin /Scripting \
  org.kde.kwin.Scripting isScriptLoaded s kwin-xmonad-lite-dev
```

Nach dem Entladen darf innerhalb von 30 Sekunden keine neue Zeile mit
`kwin-xmonad-lite:` erscheinen. IDs von minimierten, maximierten,
Vollbild- und Float-Fenstern dürfen im jeweiligen Zustand keine `apply`-Zeile
haben.

### Abnahme Matrix 18–23: Tastenkürzel und Konfiguration

Auf der Entwicklungsinstanz (`nix run`). Die eigenen Aktionen lassen sich
genauso über kglobalaccel auslösen wie die von KWin — das ist der einzige Weg
für `Meta+L` und `Meta+T`, solange die KDE-Kürzel nicht umgelegt sind:

```bash
kxl_action() {
  busctl --user call org.kde.kglobalaccel /component/kwin \
    org.kde.kglobalaccel.Component invokeShortcut s "$1"
}
for a in xml-focus-next xml-focus-prev xml-swap-next xml-swap-prev \
         xml-focus-master xml-promote xml-shrink xml-expand \
         xml-sink xml-toggle-float xml-next-layout xml-reset-layout; do
  kxl_action "$a"
done
```

**Testmatrix 18** — alle zwölf Aktionen über D-Bus. Erwartet: je Aktion **genau
eine** `befehl …`-Zeile, danach höchstens ein Anordnungslauf, dessen Grund die
auslösenden Aktionen als `shortcut:<name>` trägt. Kein Flattern. Wirkungslose
Befehle (`unverändert`, `bereitsGekachelt`, `bereitsGefloatet`) melden **keinen**
Lauf an. Gemessen auf SPIELKISTE fasste die Entprellung die ganze Folge zu einem
Lauf zusammen (hier umbrochen, im Journal steht das auf einer Zeile):

```
arrange #2 grund=fensterzustand,windowActivated,shortcut:shrink,shortcut:expand,
shortcut:nextLayout,shortcut:resetLayout,shortcut:toggleFloat
```

Die Journalzeile `ziel … nicht mehr im Snapshot` ist über `runCommand`
**unerreichbar** — der Abgleich vor dem Reducer garantiert, dass die
gespeicherte Reihenfolge eine Teilmenge der Snapshot-Mitglieder ist. Sie darf
in der Abnahme nicht erwartet werden.

**Testmatrix 19** — die **zehn konfliktfreien** Tasten per Tastendruck; gleiche
Wirkung wie 18. `Meta+L` und `Meta+T` bleiben hier ausgespart, weil auf dieser
Maschine die KDE-Kürzel gelten (siehe 22).

**Testmatrix 20** — `Meta+J` auf mindestens drei Fenstern. `workspace.activeWindow`
folgt, ein voller Zyklus kehrt zum Ausgangsfenster zurück, jede Zeile meldet
`via=aktiv`. Im `full`-Layout wechselt dabei das sichtbare Fenster. Es darf
**kein** zweiter Aktivierungsversuch für dieselbe Id im Journal stehen — die
Epoche aktiviert nie selbst, daran hängt die Schleifenfreiheit.

**Testmatrix 20a** — Fokusziel ist **minimiert**. Gemessen: das Fenster bleibt
Mitglied und im Fokuszyklus, verliert aber die Teilnahme (`n=3` → `n=2`).
Landet `focusNext` darauf, stellt KWin es wieder her und die folgende
Surface-Zeile meldet wieder `n=3`. Verhalten dokumentieren, nicht erzwingen.

**Testmatrix 20b** — Fokusziel liegt hinter einem **modalen Dialog**. Erwartet
wird kein zweiter Aktivierungsversuch und keine Schleife im Journal.
**Noch nicht abgenommen.**

**Testmatrix 20c** — Fokusziel zwischen Tastendruck und Lauf **geschlossen**.
Der Fall ist **nicht herstellbar**: `readSnapshot` legt für jedes
Snapshot-Fenster ein Handle an, und zwischen dem Lesedurchgang und der
Zuweisung kehrt der Shortcut-Rückruf nicht in die Ereignisschleife zurück. Die
Zeile `aktivieren fehlgeschlagen für …` bleibt deshalb defensiv im Adapter
stehen und wird von keiner Abnahme erwartet — wie der Zweig
`ziel … nicht mehr im Snapshot`.

**Testmatrix 21** — Konfiguration. Die Entwicklungsinstanz liest aus der Gruppe
`[Script-kwin-xmonad-lite-dev]`, **nicht** aus `[Script-kwin-xmonad-lite]`:
`scripts/dev-load.sh` lädt unter dem Dev-Namen, und `readConfig` bildet die
Gruppe aus dem Pluginnamen. Wer beim Erproben in die Produktionsgruppe
schreibt, sieht keine Wirkung.

Wirksam wird eine Änderung nur **zweistufig**:

```bash
kwriteconfig6 --file kwinrc --group Script-kwin-xmonad-lite-dev --key gapOuter 8
kwriteconfig6 --file kwinrc --group Script-kwin-xmonad-lite-dev --key gapInner 4
kwriteconfig6 --file kwinrc --group Script-kwin-xmonad-lite-dev --key masterRatio 0.5
kwriteconfig6 --file kwinrc --group Script-kwin-xmonad-lite-dev --key defaultLayout full
kwriteconfig6 --file kwinrc --group Script-kwin-xmonad-lite-dev --key debug true
kwriteconfig6 --file kwinrc --group Script-kwin-xmonad-lite-dev \
  --key excludes krunner,yakuake,plasmashell
busctl --user call org.kde.KWin /KWin org.kde.KWin reconfigure
sleep 1
nix run .#reload
```

Ohne den `reconfigure`-Aufruf liest das neu geladene Skript die **alten** Werte
— `readConfig` reicht den Wert aus dem Speicher heraus, und
`Workspace::reconfigure()` startet dafür nur `reconfigureTimer.start(200)`
(`docs/research.md` Abschnitt 2.7). `scripts/reload.sh` ruft `reconfigure`
**nicht**. In der Produktion schreibt `nixos-rebuild switch` zwar `kwinrc`,
startet den laufenden Controller aber nicht neu, und KWin lädt eine bereits
geladene Plugin-Id nicht erneut — dort wirkt die Änderung erst nach Ab- und
Anmeldung.

Erwartet: **eine** `config …`-Zeile mit genau den gesetzten Werten, die
Abstände in den Geometrien sichtbar, `defaultLayout` für alle Surfaces dieser
frischen Instanz. Gemessen auf SPIELKISTE:

```
config gaps=8/4 ratio=0.5 layout=1 excludes=3 debug=true
config excludes=krunner,plasmashell,yakuake
apply {56a36406-…} soll=2544x1394+2568+8
```

Die zweite Zeile ist die `debugLog`-Zeile und erscheint nur bei `debug=true`.

**Testmatrix 21a** — Zustandserhalt **innerhalb einer Instanz**: `Meta+H`
ändert die Ratio, danach auf einen bis dahin unbenutzten virtuellen Desktop
wechseln. Die alte Surface behält ihren Wert, die neu angelegte startet mit
`masterRatio` und `defaultLayout`; `Meta+Shift+Space` zieht die alte auf die
konfigurierten Werte. Gemessen: `ratio=0.4` auf Desktop 1, `ratio=0.5` und
`layout=full` auf dem neuen. Über einen Reload hinweg ist das **nicht** zu
prüfen — ein Reload erzeugt einen neuen Adapter mit leerer Registry, danach
gelten überall die konfigurierten Startwerte.

**Testmatrix 21b** — unsinnige Werte:

Zu setzen sind `gapOuter=abc`, `gapInner=-5`, `masterRatio=1.5`,
`defaultLayout=grid`, `debug=ja` und ein leeres `excludes` in der Gruppe
`[Script-kwin-xmonad-lite-dev]`, danach wieder `reconfigure`, warten, `reload`.
Ob `kwriteconfig6` einen Wert mit führendem Bindestrich annimmt, ist nicht
geprüft; für `gapInner` ist die Zeile gegebenenfalls direkt in `kwinrc`
einzutragen.

Erwartet: je eine `config …`-Notiz, das Skript läuft weiter, keine Ausnahme.
Gemessen waren es sechs Notizen mit dem Wortlaut

```
config gapOuter=abc unlesbar, verwende 0
config gapInner=-5 unzulässig, verwende 0
config excludes leer: kein Fenster wird ausgeschlossen
config masterRatio=1.5 geklemmt auf 0.9
config defaultLayout=grid unbekannt, verwende tall
config debug=ja unlesbar, verwende false
```

Mit leerer Ausschlussliste blieb die Mitgliederzahl unverändert bei 7: Panels
sind schon über `!dock` im Mitgliedschaftsfilter draußen. Die Ausschlussliste
ist eine zweite Verteidigungslinie, nicht die einzige.

**Testmatrix 22** — fremde Shortcuts unverändert. Die Vergleichsbasis
unmittelbar vor dem Lauf erheben, nicht den Referenzwert aus
`docs/research.md` 5.2 verwenden:

```bash
cp ~/.config/kglobalshortcutsrc /tmp/kgs.vorher
nix run
sleep 3
diff /tmp/kgs.vorher ~/.config/kglobalshortcutsrc
grep -c '^xml-' ~/.config/kglobalshortcutsrc   # erwartet: 12
```

Erwartet: der `diff` zeigt **ausschließlich** zwölf hinzugefügte
`xml-*`-Zeilen, sonst nichts. Nach mehreren Ladevorgängen sind es weiterhin
genau zwölf, keine Dubletten. Format einer Zeile:
`xml-expand=Meta+L,none,Master vergrößern`.

Steht eine der Tasten bereits bei einer fremden Aktion, bleiben **beide**
Einträge in der Datei stehen und der **vorhandene gewinnt** beim Tastendruck
(gemessen für `Meta+L` und `Meta+T`, `docs/research.md` Abschnitt 6.1). Ein
Journaleintrag dazu entsteht nicht — `registerShortcut` liefert immer `true`.

**Testmatrix 23** — Reload. Nach `nix run .#reload` darf
**keine einzige** `apply`-Zeile erscheinen, keine doppelte Registrierung im
Journal, kein zusätzlicher Eintrag in `kglobalshortcutsrc`; die zwölf Aktionen
bleiben wirksam. Gemessen: über zehn Minuten danach kein `nachbessern`, kein
`aufgegeben`, kein `extern`. Die Konfiguration fällt erwartungsgemäß auf die
konfigurierten Startwerte zurück. Ein KWin-/Sitzungsneustart ist damit nicht
geprüft; der gehört zu den offenen Fällen 16–17 in Meilenstein 7.

### Abnahme Matrix 24–24e: deklarative Installation

Auf HAL9000 am 2026-09-06 gegen den Nix-Input `8f287d9` abgenommen. Alle sechs
Fälle bestanden. Die folgenden Befehle bleiben als wiederholbare
Abnahmevorschrift stehen; nach jedem `switch` muss die Sitzung ab- und wieder
angemeldet werden.

| # | Fall | Erwartung |
|---|---|---|
| 24 | Aktivierung | `isScriptLoaded kwin-xmonad-lite` meldet `true`, das Skript läuft aus dem Store, es gibt keine Schattenkopie unter `~/.local/share`, `nix run` bricht mit der Meldung aus `require_no_production` ab |
| 24a | `Meta+L` und `Meta+T` per Tastendruck | Master vergrößern bzw. wieder kacheln; die Sitzung sperrt **nicht**, „Kachelung bearbeiten" öffnet **nicht**. `Ctrl+Alt+L` sperrt weiterhin |
| 24b | Konfliktausgang nach der Umlegung | in `kglobalshortcutsrc` prüfen, dass `Lock Session` auf `Screensaver` und `Ctrl+Alt+L` steht und `Edit Tiles` leer ist; im Journal muss die `befehl expand`- bzw. `befehl sink`-Zeile erscheinen |
| 24c | `settings` ändern, `switch`, neu anmelden | die neuen Werte stehen in `kwinrc` und in der `config …`-Zeile |
| 24d | Schlüssel in Nix **entfernen**, `switch`, neu anmelden | der dokumentierte Vorgabewert steht in `kwinrc`, nicht der alte Wert — der Beleg für „immer alle sechs Schlüssel schreiben" |
| 24e | `kwinXmonadLite = false` (`plasmaManager` bleibt an), `switch`, neu anmelden | `kwin-xmonad-liteEnabled=false`, Skript nicht geladen, alle zwölf `xml-*`-Zeilen stehen auf `none`, `Lock Session` wieder auf `Screensaver\tMeta+L`, `Edit Tiles` auf `Meta+T`. **`Meta+L` sperrt per Tastendruck wieder**, `Ctrl+Alt+L` nicht mehr. Die zwölf Zeilen selbst bleiben stehen — es gibt kein `unregisterShortcut`; `none` gibt nur die Taste frei |

#### Ergebnis vom 2026-09-06

Die Reihe lief über vier Boots. Das eingecheckte
[`docs/hal9000-abnahme-2026-09-06.log`](docs/hal9000-abnahme-2026-09-06.log)
enthält 550 Controllerzeilen aus den drei Boots mit aktiviertem Plugin. Beim
vierten Boot, Fall 24e, entstand keine Controllerzeile. Das Artefakt enthält
keine Boot-Trennmarke für diesen leeren Abschnitt und belegt die Abwesenheit
daher nicht für sich allein.

| # | Ausgeführtes Ergebnis | Belegart |
|---|---|---|
| 24 | `isScriptLoaded` meldete `true`, `main.js` kam aus dem Store und `nix run` brach an `require_no_production` ab. | Shell- und Dateiprüfung; das Journal enthält `geladen`, die Vorgabekonfiguration und `shortcuts n=12`. |
| 24a | Alle zwölf Kürzel wurden als echte Tastendrücke über `/dev/uinput` ausgelöst. `Meta+L` erzeugte `befehl expand … ratio=0.7` und sperrte nicht; `Meta+T` löste `sink` statt des Kachel-Editors aus. | Die `befehl`-Zeilen stehen im Journal. Dass `/dev/uinput` die Quelle war und die unerwünschten Aktionen ausblieben, ist eine Live-Beobachtung. |
| 24b | `Lock Session=Screensaver\tCtrl+Alt+L`, `Edit Tiles=none` und `LockedHint=no` blieben über die Reihe erhalten. `Ctrl+Alt+L` sperrte im eingeschalteten Zustand. | Konfigurationsauszug und Tastendruck; nicht im Journalartefakt enthalten. |
| 24c | `gapOuter=8`, `gapInner=4`, `masterRatio=0.5`, `defaultLayout=full` und `debug=true` kamen an. Das Journal meldet `config gaps=8/4 ratio=0.5 layout=1 excludes=7 debug=true`, `layout=full` sowie `soll=1904x1034+8+8`. | Direkt im Journalartefakt belegt; die Werte in `kwinrc` wurden getrennt gelesen. |
| 24d | Nur `gapOuter` wurde aus Nix entfernt. Danach stand `gapOuter=0` in `kwinrc`, während `gapInner=4` erhalten blieb; das Journal meldet `config gaps=0/4 ratio=0.5 layout=1 excludes=7 debug=true`. | Die wirksame Konfiguration steht im Journal. Das Entfernen aus Nix und der `kwinrc`-Auszug sind getrennte Config-Belege. |
| 24e | Das Plugin war aus und nicht geladen, alle zwölf `xml-*`-Aktionen standen auf `none`. `Lock Session=Screensaver\tMeta+L` und `Edit Tiles=Meta+T` waren wiederhergestellt. `Meta+L` sperrte per Tastendruck, `Ctrl+Alt+L` nicht mehr. | D-Bus-, Konfigurations- und Tastaturprüfung. Der protokollierte Lauf hatte keine Controllerzeile; das Rohartefakt allein beweist den leeren Abschnitt nicht. |

Der Abschaltzweig entfernt die Gruppe `[Script-kwin-xmonad-lite]` nicht aus
`kwinrc`. Ihre alten Werte bleiben stehen, sind bei
`kwin-xmonad-liteEnabled=false` aber wirkungslos. Der Rückstand ist beim
Bewerten von Vorher-/Nachher-Diffs zu erwarten.

#### Vorbereitung und Fall 24

Vor dem ersten `switch` im unveränderten `nixosconfig`-Branch:

```bash
cd /home/muhackel/nixosconfig
test "$(git branch --show-current)" = feature/kwin-xmonad-lite
test -z "$(git status --porcelain)"
test ! -e "$HOME/kxl-abnahme-generation"
test ! -e "$HOME/kxl-abnahme-kwinrc.bak"
test ! -e "$HOME/kxl-abnahme-kglobalshortcutsrc.bak"

KXL_START_GENERATION="$(readlink /nix/var/nix/profiles/system \
  | sed -n 's/.*system-\([0-9][0-9]*\)-link$/\1/p')"
test -n "$KXL_START_GENERATION"
printf '%s\n' "$KXL_START_GENERATION" > "$HOME/kxl-abnahme-generation"
cp "$HOME/.config/kwinrc" "$HOME/kxl-abnahme-kwinrc.bak"
cp "$HOME/.config/kglobalshortcutsrc" \
  "$HOME/kxl-abnahme-kglobalshortcutsrc.bak"

nix flake check                 # vier Checks: drei Hosts und Aus-Zustand
nixos-rebuild switch --sudo --flake .#HAL9000
```

Nach der Neuanmeldung prüft dieser Block Plugin, Store-Pfad, fehlende
Schattenkopie, alle sechs Vorgabewerte, genau zwölf eigene Tasten und die beiden
umgelegten KDE-Kürzel:

```bash
bash <<'BASH'
set -euo pipefail

KXL_MAIN=/etc/profiles/per-user/muhackel/share/kwin/scripts/kwin-xmonad-lite/contents/code/main.js
test -e "$KXL_MAIN"
case "$(readlink -f "$KXL_MAIN")" in
  /nix/store/*) ;;
  *) printf 'kein Store-Pfad: %s\n' "$(readlink -f "$KXL_MAIN")" >&2; exit 1 ;;
esac
test ! -e "$HOME/.local/share/kwin/scripts/kwin-xmonad-lite"

KXL_LOADED="$(busctl --user call org.kde.KWin /Scripting \
  org.kde.kwin.Scripting isScriptLoaded s kwin-xmonad-lite)"
test "$KXL_LOADED" = 'b true'

kxl_config() {
  kreadconfig6 --file kwinrc --group Script-kwin-xmonad-lite --key "$1"
}
test "$(kreadconfig6 --file kwinrc --group Plugins \
  --key kwin-xmonad-liteEnabled)" = true
test "$(kxl_config gapOuter)" = 0
test "$(kxl_config gapInner)" = 0
test "$(kxl_config excludes)" = \
  'krunner,yakuake,kded6,polkit-kde-authentication-agent-1,plasmashell,xwaylandvideobridge,steam_app_default'
test "$(kxl_config masterRatio)" = 0.65
test "$(kxl_config defaultLayout)" = tall
test "$(kxl_config debug)" = false

test "$(grep -c '^xml-' "$HOME/.config/kglobalshortcutsrc")" -eq 12
kxl_shortcut() {
  local value
  value="$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$1")"
  printf '%s\n' "${value%%,*}"
}
while read -r name expected; do
  test "$(kxl_shortcut "$name")" = "$expected"
done <<'SHORTCUTS'
xml-focus-next Meta+J
xml-focus-prev Meta+K
xml-swap-next Meta+Shift+J
xml-swap-prev Meta+Shift+K
xml-focus-master Meta+M
xml-promote Meta+Return
xml-shrink Meta+H
xml-expand Meta+L
xml-sink Meta+T
xml-toggle-float Meta+Shift+T
xml-next-layout Meta+Space
xml-reset-layout Meta+Shift+Space
SHORTCUTS

KXL_LOCK="$(kreadconfig6 --file kglobalshortcutsrc --group ksmserver \
  --key 'Lock Session')"
KXL_TILES="$(kreadconfig6 --file kglobalshortcutsrc --group kwin \
  --key 'Edit Tiles')"
test "${KXL_LOCK%%,*}" = 'Screensaver\tCtrl+Alt+L'
test "${KXL_TILES%%,*}" = none

cd /home/muhackel/nixosconfig
KXL_SOURCE="$(nix eval --impure --raw --expr \
  '(builtins.getFlake (toString ./.)).inputs.kwin-xmonad-lite.outPath')"
if KXL_RUN_OUTPUT="$(nix run "$KXL_SOURCE" 2>&1)"; then
  printf 'nix run startete trotz Produktionsinstanz\n' >&2
  exit 1
fi
grep -F "Die Produktionsinstanz 'kwin-xmonad-lite' ist geladen." \
  <<<"$KXL_RUN_OUTPUT" >/dev/null
BASH
```

Für 24a und 24b mindestens drei gewöhnliche Fenster auf derselben Surface
öffnen. Das aktive Fenster zuerst mit `Meta+Shift+T` floaten, dann `Meta+L`,
`Meta+T` und `Ctrl+Alt+L` tatsächlich drücken. In einem zweiten Terminal läuft
der gepinnte Journal-Wrapper:

```bash
cd /home/muhackel/nixosconfig
KXL_SOURCE="$(nix eval --impure --raw --expr \
  '(builtins.getFlake (toString ./.)).inputs.kwin-xmonad-lite.outPath')"
nix run "${KXL_SOURCE}#logs"
```

`Meta+L` muss `befehl expand`, `Meta+T` `befehl sink` erzeugen;
`Ctrl+Alt+L` muss die Sitzung sperren.

#### Fall 24c: geänderte Einstellungen

Die sechs Werte werden gemeinsam geändert, damit jede Zeile nachweisbar vom
Vorgabewert abweicht:

```bash
cd /home/muhackel/nixosconfig
tee /tmp/kxl-settings.patch >/dev/null <<'PATCH'
diff --git a/modules/user/muhackel/kwin-xmonad-lite.nix b/modules/user/muhackel/kwin-xmonad-lite.nix
--- a/modules/user/muhackel/kwin-xmonad-lite.nix
+++ b/modules/user/muhackel/kwin-xmonad-lite.nix
@@ -63,6 +63,12 @@ lib.mkMerge [
   (lib.mkIf (features.plasma6 && features.plasmaManager && features.kwinXmonadLite) {
     programs.kwin-xmonad-lite = {
       enable = true;
-      # `settings` bleibt bei den Vorgabewerten des Projektmoduls; es schreibt
-      # ohnehin immer alle sechs Schlüssel nach [Script-kwin-xmonad-lite].
+      settings = {
+        gapOuter = 8;
+        gapInner = 4;
+        excludes = [ "krunner" "yakuake" "plasmashell" ];
+        masterRatio = 0.5;
+        defaultLayout = "full";
+        debug = true;
+      };
     };
PATCH
git apply --check /tmp/kxl-settings.patch
git apply /tmp/kxl-settings.patch
nixos-rebuild switch --sudo --flake .#HAL9000
```

Nach der Neuanmeldung:

```bash
bash <<'BASH'
set -euo pipefail
kxl_config() {
  kreadconfig6 --file kwinrc --group Script-kwin-xmonad-lite --key "$1"
}
test "$(kxl_config gapOuter)" = 8
test "$(kxl_config gapInner)" = 4
test "$(kxl_config excludes)" = 'krunner,yakuake,plasmashell'
test "$(kxl_config masterRatio)" = 0.5
test "$(kxl_config defaultLayout)" = full
test "$(kxl_config debug)" = true
journalctl --user -u plasma-kwin_wayland -b --no-pager \
  | grep -F 'kwin-xmonad-lite: config gaps=8/4 ratio=0.5 layout=1 excludes=3 debug=true' \
  >/dev/null
BASH
```

#### Fall 24d: entfernte Einstellungen

**Ausgeführt wurde ein Einzelschlüssel, nicht der ganze Block.** Die Vorschrift
sah ursprünglich vor, den gesamten `settings`-Block zurückzunehmen und danach
alle sechs Vorgaben zu erwarten. Gelaufen und belegt ist am 2026-09-06 nur das
Entfernen von `gapOuter`. Der Unterschied ist keine Formalie: was damit belegt
ist, ist der **Rückfall eines entfernten Schlüssels auf seinen Vorgabewert bei
gleichzeitigem Erhalt der übrigen** — nicht, dass ein leerer `settings`-Block
alle sechs Schlüssel auf die Vorgaben setzt. Wer Letzteres braucht, führt den
Fall in der zweiten Fassung unten aus.

Ausgeführte Fassung — nur `gapOuter` aus dem `settings`-Block streichen:

```bash
cd /home/muhackel/nixosconfig
$EDITOR modules/user/muhackel/kwin-xmonad-lite.nix   # Zeile settings.gapOuter entfernen
nixos-rebuild switch --sudo --flake .#HAL9000
```

Nach der Neuanmeldung die Startzeile im Journal prüfen — `gapOuter` steht auf
der Vorgabe `0`, `gapInner` behält den gesetzten Wert:

```bash
journalctl --user -u plasma-kwin_wayland -b --no-pager \
  | grep -F 'kwin-xmonad-lite: config gaps=0/4 ratio=0.5 layout=1 excludes=7 debug=true'
```

Vollständige Fassung — den ganzen `settings`-Block zurücknehmen (**nicht
ausgeführt**, hier nur als Vorschrift):

```bash
cd /home/muhackel/nixosconfig
git apply --check --reverse /tmp/kxl-settings.patch
git apply --reverse /tmp/kxl-settings.patch
nixos-rebuild switch --sudo --flake .#HAL9000
```

```bash
journalctl --user -u plasma-kwin_wayland -b --no-pager \
  | grep -F 'kwin-xmonad-lite: config gaps=0/0 ratio=0.65 layout=0 excludes=7 debug=false'
```

#### Fall 24e: Controller aus

```bash
cd /home/muhackel/nixosconfig
tee /tmp/kxl-disable.patch >/dev/null <<'PATCH'
diff --git a/flake.nix b/flake.nix
--- a/flake.nix
+++ b/flake.nix
@@ -87,6 +87,6 @@
           features   = commonFeatures // {
             thinkpadBattery = true;
             plasmaManager   = true;
-            kwinXmonadLite  = true;
+            kwinXmonadLite  = false;
           };
         };
PATCH
git apply --check /tmp/kxl-disable.patch
git apply /tmp/kxl-disable.patch
nixos-rebuild switch --sudo --flake .#HAL9000
```

Nach der Neuanmeldung:

```bash
bash <<'BASH'
set -euo pipefail
KXL_MAIN=/etc/profiles/per-user/muhackel/share/kwin/scripts/kwin-xmonad-lite/contents/code/main.js
test ! -e "$KXL_MAIN"
test "$(busctl --user call org.kde.KWin /Scripting \
  org.kde.kwin.Scripting isScriptLoaded s kwin-xmonad-lite)" = 'b false'
test "$(kreadconfig6 --file kwinrc --group Plugins \
  --key kwin-xmonad-liteEnabled)" = false
test "$(grep -c '^xml-' "$HOME/.config/kglobalshortcutsrc")" -eq 12
while read -r name; do
  value="$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$name")"
  test "${value%%,*}" = none
done <<'SHORTCUTS'
xml-focus-next
xml-focus-prev
xml-swap-next
xml-swap-prev
xml-focus-master
xml-promote
xml-shrink
xml-expand
xml-sink
xml-toggle-float
xml-next-layout
xml-reset-layout
SHORTCUTS

KXL_LOCK="$(kreadconfig6 --file kglobalshortcutsrc --group ksmserver \
  --key 'Lock Session')"
KXL_TILES="$(kreadconfig6 --file kglobalshortcutsrc --group kwin \
  --key 'Edit Tiles')"
test "${KXL_LOCK%%,*}" = 'Screensaver\tMeta+L'
test "${KXL_TILES%%,*}" = Meta+T
BASH
```

Danach `Meta+L` und `Ctrl+Alt+L` drücken: `Meta+L` muss sperren,
`Ctrl+Alt+L` darf nicht mehr sperren. `Meta+T` muss wieder „Kachelung
bearbeiten" öffnen.

#### Rückbau nach der Reihe

Die Reihe endet **nicht** im Testzustand. Die nächste Abnahme soll wieder auf
einem nackten Gerät beginnen, und die Generationsnummer soll nicht mit jedem
Durchlauf davonlaufen.

Nach dem letzten Fall zuerst den Quellbaum auf den unveränderten Branchstand
zurückbringen. Danach die gespeicherte Ausgangsgeneration gezielt als
Systemprofil wählen und aktivieren. Ein pauschales `nixos-rebuild
switch --rollback` reicht nach mehreren Switches nicht; es ginge nur eine
Generation zurück.

```bash
bash <<'BASH'
set -euo pipefail
cd /home/muhackel/nixosconfig
if git apply --check --reverse /tmp/kxl-disable.patch 2>/dev/null; then
  git apply --reverse /tmp/kxl-disable.patch
fi
if git apply --check --reverse /tmp/kxl-settings.patch 2>/dev/null; then
  git apply --reverse /tmp/kxl-settings.patch
fi
test -z "$(git status --porcelain)"

KXL_START_GENERATION="$(cat "$HOME/kxl-abnahme-generation")"
sudo nix-env --profile /nix/var/nix/profiles/system \
  --switch-generation "$KXL_START_GENERATION"
sudo "/nix/var/nix/profiles/system-${KXL_START_GENERATION}-link/bin/switch-to-configuration" switch

mapfile -t KXL_TEST_GENERATIONS < <(
  sudo nix-env --list-generations --profile /nix/var/nix/profiles/system \
    | awk -v start="$KXL_START_GENERATION" '$1 > start { print $1 }'
)
if ((${#KXL_TEST_GENERATIONS[@]} > 0)); then
  sudo nix-env --profile /nix/var/nix/profiles/system \
    --delete-generations "${KXL_TEST_GENERATIONS[@]}"
fi
sudo /run/current-system/bin/switch-to-configuration boot

cp "$HOME/kxl-abnahme-kwinrc.bak" "$HOME/.config/kwinrc"
cp "$HOME/kxl-abnahme-kglobalshortcutsrc.bak" \
  "$HOME/.config/kglobalshortcutsrc"
BASH
```

Danach ab- und anmelden. Das Zurückspielen der beiden Dateien ist **kein**
Beiwerk: plasma-manager schreibt sie imperativ aus einem Aktivierungsskript,
und seine Schreibvorgänge überleben den Generationswechsel. Ein Rollback allein
lässt `kwinrc` und `kglobalshortcutsrc` im Testzustand zurück.

#### Ausgeführter Rückbau

HAL9000 steht wieder auf Generation 584. Die Testgenerationen 585 bis 588
wurden gelöscht, die Booteinträge nachgezogen und `/run/current-system` zeigt
wieder auf das Toplevel von Generation 584. Autologin ist damit ebenfalls
entfernt.

Die gesicherten Fassungen von `kwinrc` und `kglobalshortcutsrc` wurden nach dem
Neustart und vor der ersten Anmeldung zurückgespielt. Das war für
`kglobalshortcutsrc` notwendig: `kglobalaccel` schreibt seinen gespeicherten
Zustand beim Sitzungsende zurück und hätte eine Wiederherstellung in der
laufenden Sitzung wieder überschrieben. Im Ausgangszustand fehlt der
Plugin-Eintrag in `kwinrc`; `kglobalshortcutsrc` enthält keine `xml-*`-Zeile,
`Lock Session=Screensaver` und `Edit Tiles=Meta+T`.

Zur **Feature-Probe:** `nix run .#probe -- --shortcuts` registriert drei
Aktionen und protokolliert nur die Rückgabewerte. Sie betätigt keine Taste und
liest keine wirksame Zuordnung aus; `registerShortcut` liefert ohnehin immer
`true`. Der Lauf bleibt als Nebenbefund nützlich, entscheidet aber keine
Kollisionsfrage — das tut nur der Tastendruck.

### Abnahme Matrix 16–17, 20b und 25–27: Meilenstein 7

Diese Reihe schließt die Verhaltensprüfungen ab. Sie ist am **2026-09-06
ausgeführt** und in zwei Protokollen belegt; der Abschnitt bleibt als
Vorschrift stehen, damit sie wiederholbar ist:

- [`docs/ms7-2026-09-06-hal9000.md`](docs/ms7-2026-09-06-hal9000.md) —
  Produktionsinstanz gegen Projekt-Commit `abdffa2`: Fälle 25–25c, 20b,
  16/16b/16c, 17a/17b.
- [`docs/ms7-2026-09-06-hal9000-ap7.md`](docs/ms7-2026-09-06-hal9000-ap7.md) —
  Entwicklungsinstanz gegen `0c903cb`: Fälle 26/26a/26b/26c und 27.

Die Wayland-Smoke-VM ist nicht mehr Teil der MVP-Abnahme. HAL9000 liefert die
Live-Nachweise in einer echten Sitzung; eine automatisiert wiederholbare
VM-Prüfung ist auf Stufe 2 verschoben.

**Zwei Abweichungen gegenüber dieser Vorschrift sind in den Protokollen
begründet** und beim Wiederholen zu beachten: der Abschlusslauf 26–27 lief auf
HAL9000 mit zwei Ausgaben statt auf SPIELKISTE mit dreien, und Fall 27 lief mit
skriptgesteuerter Last
([`docs/ms7-2026-09-06-fall27-last.sh`](docs/ms7-2026-09-06-fall27-last.sh))
statt mit normaler Arbeit.

#### Instanztrennung

Die beiden Instanzen registrieren dieselben zwölf `xml-*`-objectNames und
dürfen nie gleichzeitig laufen. Deshalb ist die Zuordnung fest:

| Host | Instanz | Gruppe in `kwinrc` | `Meta+L` / `Meta+T` |
|---|---|---|---|
| HAL9000 | Produktion aus dem Store, Feature-Flag an | `[Script-kwin-xmonad-lite]` | Controller-Tasten (KDE-Kürzel umgelegt) |
| SPIELKISTE | Entwicklung über `nix run` | `[Script-kwin-xmonad-lite-dev]` | KDE-Aktionen; die beiden Befehle laufen über `invokeShortcut` |

`scripts/dev-load.sh` und `reload.sh` brechen über `require_no_production` ab,
sobald die Produktion geladen ist. Auf HAL9000 ist das erwünscht und in Fall 24
belegt; ein Reload der Produktionsinstanz läuft dort über D-Bus von Hand
(Fall 16).

#### Journal ziehen: Marken und Controllerzeilen in einem Auszug

`journalctl` verknüpft `-u` und `-t` mit UND — eine Schrittmarke aus
`systemd-cat` käme mit dem Unit-Filter allein **nicht** durch. Das `+` ist die
ODER-Verknüpfung und liefert beides; es fängt zugleich die Zeilen von
`kwin_wayland_wrapper` mit ein, die Fall 17a braucht:

```bash
systemd-cat -t kxl-abnahme echo "== Fall 25b Anfang =="
# ... Fall ausführen ...
systemd-cat -t kxl-abnahme echo "== Fall 25b Ende =="

journalctl --user -b -o short-iso --since "@$t0" \
  _SYSTEMD_USER_UNIT=plasma-kwin_wayland.service + SYSLOG_IDENTIFIER=kxl-abnahme
```

Ohne `-o short-iso` fehlen die Zeitstempel. Genau daran scheiterte die
Beleglage von Meilenstein 6: die zehn ruhigen Minuten aus Fall 23 sind im
Artefakt nicht nachweisbar.

Ein Abschnitt **ohne** Controllerzeile — wie Fall 24e — ist nur über die Marken
abgrenzbar. Deshalb bekommt jeder Fall Anfang und Ende.

#### Protokollkopf

Jeder Fall wird mit diesem Kopf protokolliert. Fehlt eine Zeile, gilt der Fall
als **nicht belegt**:

```
Fall:            25b
Projekt-Commit:  <sha des MS7-Branches>
Host-Pin:        nixosconfig <sha>, kwin-xmonad-lite <sha>
Host:            HAL9000
Boot-ID:         <aus journalctl --list-boots>
KWin-PID:        <aus kwin_wayland[<pid>]>
Skriptlauf:      <Zeitstempel der "geladen"-Zeile dieser Instanz>
Instanz:         Produktion (Store) | Entwicklung (nix run)
Fall-Anfang:     <iso, Markerzeile>
Fall-Ende:       <iso, Markerzeile>
Artefakt:        docs/<datei>
```

Boot-Id, KWin-PID und Skriptlauf sind drei verschiedene Dinge, und die Fälle
16, 17a und 17b unterscheiden sich genau daran:

| Verfahren | Boot-Id | KWin-PID | Skriptlauf |
|---|---|---|---|
| Script-Reload (16) | bleibt | bleibt | neu |
| KWin-Neustart (17a) | bleibt | neu | neu |
| Sitzungsneustart (17b) | bleibt | neu | neu |
| Systemneustart | neu | neu | neu |

17a und 17b unterscheiden sich im Journal nicht an diesen drei Werten, sondern
daran, ob die Clients überlebt haben und ob eine Anmeldung dazwischenlag.

#### Werkzeuge

```bash
nix run .#probe-geometry                                        # nur Datenqualität
nix run .#probe-geometry -- --erwarte layout=tall n=3 ratio=0.65 gaps=0/0
nix run .#probe-geometry -- --erwarte layout=full n=3 ratio=0.65 gaps=0/0 "surface=<key>"
nix run .#audit                                                 # letzte 60 min, Fall 27
nix run .#audit -- --seit "-10 min"                             # kürzerer Blick, ohne Schwelle
nix run .#audit -- docs/ms7-2026-09-06-hal9000-fall27.log        # gesicherter Auszug, mit Schwelle
nix run .#audit -- --frei docs/ms7-2026-09-06-hal9000-ap7.log    # gesicherter Auszug, ohne Schwelle
```

**`surface=<key>` ist die Wahl für Fall 26.** Ohne den Filter prüft das Orakel
die zuletzt gemeldete Surface; bei mehreren Ausgaben mit **verschiedenen**
Layouts braucht jede ihren eigenen Lauf mit ihrer eigenen Erwartung. Der
Schlüssel ist `<activity>|<desktop>|<output>`, genau so, wie er in der
`surface`-Zeile steht.

**`--frei` schaltet die Belegschwelle ab.** Sie gehört zu Fall 27 — mindestens
60 Minuten in **einem** Skriptlauf — und ist für jeden anderen Auszug die
falsche Messlatte: ohne den Schalter meldet der Auditor dort „nicht ausreichend
belegt", obwohl mit dem Auszug alles in Ordnung ist.

Die Geometrie-Probe ist strikt lesend: sie schreibt keine Geometrie, setzt kein
`activeWindow`, hebt nichts und verbindet kein KWin-Signal — nur `timeout` an
eigenen Timern. `checks.probe-readonly` erzwingt das. Sie kann das
Prüfergebnis also nicht selbst herstellen.

**Die Erwartung kommt aus dieser Vorschrift, nicht aus dem Journal.** Das
Orakel prüft in drei Stufen: Datenqualität und Einschwingen, dann das Journal
gegen die vorgegebenen Werte, dann die Geometrie. Ohne die zweite Stufe
bestünde ein Fall, dessen Anordnung sauber zu einem falschen Masteranteil passt.

**Testclients.** Für exakte Zellen **kwrite** (`kwrite /tmp/kxl-g1.txt`; die
Caption trägt damit den Präfix `kxl-`, den die Probe für die Titelausgabe
verlangt). In Meilenstein 6 nahm kwrite die berechneten Zellen exakt an
(`1664x1410`, zweimal `896x705`, `docs/research.md` 6.4). **foot ist dafür
ungeeignet**: es quittierte ein Soll von `896x235` als `894x223`
(`docs/research.md` 5.2) und bleibt dem Give-up-Fall vorbehalten. Nimmt ein
Client nicht exakt an, meldet das Orakel einen **Hinweis** statt eines Fehlers,
sofern das Soll stimmt und der Controller aufgegeben hat; der Fall wird dann am
anderen Client wiederholt und die Eignung protokolliert.

**Gegenprobe ohne Skriptkontext:** für mindestens ein Fenster je Fall

```bash
busctl --user call org.kde.KWin /KWin org.kde.KWin getWindowInfo s '{<uuid>}'
```

Es liefert `x`, `y`, `width`, `height`, `caption`, `uuid` und
`hasTransientParent` (`src/dbusinterface.cpp:118-152`) und damit dieselbe
Geometrie über einen zweiten, vom Skript unabhängigen Pfad. Weichen Probe und
D-Bus voneinander ab, ist die Probe falsch, nicht der Controller.

#### Fälle 25 bis 25c: Geometrie auf HAL9000

Ein Output DP-3, Vollfläche `1920x1080`, Arbeitsfläche mit Panel `1920x1050`.
`debug=true` ist Voraussetzung: Reihenfolge, Layout-Teilnahme und
Float-Markierung stehen in der Registry und sind von außen nicht messbar. Sie
kommen aus der Diagnosezeile

```
kwin-xmonad-lite: diagnose <key> order=<id,id,id> teilnehmer=<id,id> float=<id>
```

| # | Fall | Vorbereitung | Aktion | Erwartung | Beleg | Abbruch |
|---|---|---|---|---|---|---|
| 25 | Selbsttest der Probe | Controller geladen, keine Testfenster | `nix run .#probe-geometry` | ndjson mit `st:"ok"`, jede `view` hat eine `area`, ein `active`-Satz je Sample, Rückbau nachgewiesen; `getWindowInfo` und Probe stimmen für ein Fenster überein | ndjson, Rückbaublock, D-Bus-Ausgabe | Gegenprobe weicht ab oder `end` fehlt → **Reihe abbrechen** und zurückbauen |
| 25a | Ein Fenster | `kxl-g1` als einziger Teilnehmer, Vorgabekonfiguration | `nix run .#probe-geometry -- --erwarte layout=tall n=1 ratio=0.65 gaps=0/0` | `fläche=1920x1050+0+0`, Ist gleich der ganzen Arbeitsfläche | ndjson + Journal | Fläche meldet `1920x1080` → `FullScreenArea` statt `MaximizeArea` |
| 25b | Tall mit drei Fenstern | `kxl-g1..g3` | `… --erwarte layout=tall n=3 ratio=0.65 gaps=0/0` | Master `1248x1050+0+0`, Stapel `672x525+1248+0` und `672x525+1248+525`; überlappungsfrei, exakte Zerlegung; Diagnosezeile zeigt drei Teilnehmer, `float=` leer | ndjson + Journal + Orakelbericht | Soll weicht von der Vorgabe ab (Controller-Fehler); weicht nur das Ist ab, gilt die Client-Regel oben |
| 25c | Abstände, Ratio und Full | `settings` auf `gapOuter=8`, `gapInner=4`, `debug=true`; `switch`, neu anmelden | zweimal `Meta+H` (→ `ratio=0.55`), messen; dann `Meta+Space` (→ `full`), messen | erst Tall aus `tall(area, 3, {0.55, 8, 4})`, danach dreimal dasselbe Rechteck `1904x1034+8+8`; `config gaps=8/4` | zwei ndjson + Journal | `ratio` im Journal ungleich 0,55 — dann ist der Tastendruck nicht angekommen, auch wenn die Geometrie zum Journal passt |

Screenshots dürfen ergänzen; der geometrische Nachweis kommt aus der ndjson.

#### Fall 20b: Fokusziel hinter einem modalen Dialog

Drei Fenster `kxl-m1..m3`, über `kxl-m2` ein **echt modaler** Dialog.
Kandidaten in dieser Reihenfolge, bis die Probe `modal:true` **und** ein
gesetztes `transientFor` meldet: kwrite „Speichern unter" (`Strg+Umschalt+S`),
`kdialog --attach <winid> --msgbox`, ein Qt-Dialog mit `setModal(true)`. Ohne
diesen Nachweis ist der Fall nicht durchgeführt; `getWindowInfo` liefert
`hasTransientParent` als Gegenprobe.

Zwei Durchgänge: über `invokeShortcut` und über einen echten Tastendruck. Fokus
auf `kxl-m3` legen, dann die Aktion auslösen, deren Ziel `kxl-m2` ist.

Erwartet:

- **genau eine** `befehl`-Zeile je Auslösung, und ihr Name passt zur Aktion
  (`befehl focusMaster` bei `xml-focus-master`, `befehl focusNext` bei
  `xml-focus-next`), mit `fokus={id von kxl-m2}`;
- **höchstens eine** `aktiviere <id>`-Zeile je Befehl. Die `befehl`-Zeile allein
  zählt keine Aktivierungsversuche; die Diagnosezeile tut es. Dass es
  strukturell nie mehr als einer sein kann, hält `checks.activate-once` fest —
  genau ein Schreibzugriff auf `workspace.activeWindow` im ganzen Baum, in
  `src/kwin/adapter.ts`;
- **keine Schleife**: keine sich wiederholende Folge aus `windowActivated` und
  neuem Anordnungslauf ohne weitere Nutzeraktion;
- das tatsächliche Fokusziel danach steht im `active`-Satz der Probe und wird
  **dokumentiert, nicht erzwungen** — KWin darf auf den Dialog umleiten.

Die Zeile `aktivieren fehlgeschlagen für …` wird nicht erwartet; ihr Auftreten
ist zu protokollieren. Abbruch: mehr als eine `aktiviere`-Zeile je Befehl oder
mehr als zwei Anordnungsläufe ohne neue Nutzeraktion.

#### Fälle 16 bis 16c: Script-Reload

**Was Fall 23 bereits belegt:** nach einem Reload bleiben die Shortcuts
wirksam, es entsteht keine doppelte Registrierung und keine zusätzliche Zeile
in `kglobalshortcutsrc`, und bei **unverändertem** Zustand erscheint keine
`apply`-Zeile.

**Was Fall 16 hinzufügt:** den Nachweis über einen bewusst veränderten
Ausgangszustand. „Null `apply`" ist hier das falsche Kriterium — der Reload
verliert den flüchtigen Zustand und **muss** deshalb schreiben.

Ausgangszustand herstellen (vier Fenster `kxl-r1..r4`):

```bash
kxl_action xml-next-layout      # -> full
kxl_action xml-shrink; kxl_action xml-shrink   # -> ratio 0.55
kxl_action xml-toggle-float     # ein Fenster floatet, dann verschieben
kxl_action xml-promote          # Reihenfolge ändern
```

Zustand über Diagnosezeile und Probe festhalten: `teilnehmer` zählt jetzt
**drei**, `float=` trägt eine Id.

Reload der Produktionsinstanz (`nix run .#reload` bricht auf HAL9000
absichtlich ab):

```bash
KXL_MAIN=/etc/profiles/per-user/muhackel/share/kwin/scripts/kwin-xmonad-lite/contents/code/main.js
busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting \
  unloadScript s kwin-xmonad-lite
until [ "$(busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting \
  isScriptLoaded s kwin-xmonad-lite | awk '{print $2}')" = "false" ]; do sleep 0.2; done
id="$(busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting \
  loadScript ss "$KXL_MAIN" kwin-xmonad-lite | awk '{print $2}')"
busctl --user call org.kde.KWin "/Scripting/Script$id" org.kde.kwin.Script run
```

| # | Erwartung | Beleg | Abbruch |
|---|---|---|---|
| 16 | genau eine neue Folge `geladen` / `config` / `shortcuts n=12`; `mitglieder=4` wie vorher, aber `teilnehmer` steigt von **3 auf 4** — die Float-Markierung ist fort; `diagnose … float=` ist leer; Layout und Ratio stehen wieder auf den konfigurierten Startwerten; für die betroffenen Fenster erscheinen `apply`-Zeilen; `grep -c '^xml-' ~/.config/kglobalshortcutsrc` bleibt 12 | Journal mit Zeitstempeln, Probe und Diagnosezeile vor und nach dem Reload | zweite `bereit`-Zeile ohne vorheriges Entladen, Dubletten in `kglobalshortcutsrc`, ein Fenster fehlt im Stapel, oder die Teilnehmerzahl bleibt bei 3 |
| 16b | fünf Minuten ohne Nutzeraktion: keine `apply`-, `float`-, `nachbessern`-, `aufgegeben`- oder `extern`-Zeile | `nix run .#audit -- --seit "-5 min"` | irgendeine dieser Zeilen |
| 16c | siehe unten | `isScriptLoaded` vor und nach jedem Schritt | keins — der Fall dokumentiert Verhalten |

**Fall 16c — Re-Enable ohne Neuanmeldung.** Aus dem Quelltext folgt, dass es
gehen muss: `Scripting::start()` hängt an `Workspace::configChanged`
(`scripting.cpp:683-684`), `slotReconfigure()` emittiert das Signal
(`workspace.cpp:1017`), und `queryScriptsToLoad()` entlädt abgeschaltete und
lädt neu eingeschaltete Skripte (`scripting.cpp:746-793`). Belege in
`docs/research.md` 7.2. Gemessen wird, ob es auch eintritt:

```bash
kwriteconfig6 --file kwinrc --group Plugins --key kwin-xmonad-liteEnabled false
busctl --user call org.kde.KWin /KWin org.kde.KWin reconfigure
sleep 1
busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting \
  isScriptLoaded s kwin-xmonad-lite        # erwartet: false

kwriteconfig6 --file kwinrc --group Plugins --key kwin-xmonad-liteEnabled true
busctl --user call org.kde.KWin /KWin org.kde.KWin reconfigure
sleep 1
busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting \
  isScriptLoaded s kwin-xmonad-lite        # erwartet: true, plus eine neue "geladen"-Zeile
```

Wird im ersten Schritt **nicht** `false` erreicht, ist das der Befund
(„`reconfigure` entlädt nicht"), und der zweite Teil entfällt ersatzlos — eine
Reaktivierung lässt sich dann nicht belegen. `PLAN.md` Risiko 8 wird mit dem
gemessenen Ergebnis geschlossen. Am Ende muss das Flag wieder dem Nix-Stand
entsprechen.

#### Fälle 17a und 17b: KWin- und Sitzungsneustart

Beide beginnen mit demselben veränderten Ausgangszustand wie Fall 16 und mit
einer Bestandsaufnahme:

```bash
pgrep -a kwin_wayland > /tmp/kxl-vorher-kwin.txt
pgrep -a kwrite       > /tmp/kxl-vorher-clients.txt
```

**17a, KWin-Neustart in der laufenden Sitzung:**

```bash
busctl --user call org.kde.KWin /KWin org.kde.KWin replace
```

`replace` beendet KWin mit Exit 133; `kwin_wayland_wrapper` wertet das
ausdrücklich **nicht** als Absturz, setzt den Zähler zurück und startet KWin
mit demselben Wayland-Socket neu (`docs/research.md` 7.1). Erwartet:

- eine neue `kwin_wayland`-PID in **derselben** Boot-Id;
- das Skript startet über den KPackage-Autostart selbst: `geladen`,
  `bereit nach N Versuch(en)`, `config …`, `shortcuts n=12`;
- der Zustand wird aus der Ist-Menge neu gebaut, wie in Fall 16;
- **welche Clients überlebt haben, wird gezählt**, nicht angenommen: `pgrep`
  vorher gegen nachher. Ob eine Client-Verbindung den Prozesswechsel übersteht,
  ist nicht belegt und entscheidet der Client.

Startet KWin nicht neu, ist die Sitzung über `loginctl` oder SDDM
wiederherzustellen und der Fall als nicht durchführbar zu protokollieren.

**17b, Sitzungsneustart:** ab- und anmelden. Erwartet wie 17a, zusätzlich die
`config`-Zeile mit den deklarierten Werten und genau zwölf `xml-*`-Zeilen in
`kglobalshortcutsrc`.

Die drei Verfahren bleiben getrennt protokolliert. Keine Aussage über eines
wird auf ein anderes übertragen.

#### Fälle 26 bis 27: Abschlusslauf

Entwicklungsinstanz. Vorgesehen war SPIELKISTE mit drei Ausgaben
DP-1/DP-9/DP-10 à 2560×1440, Arbeitsfläche `2560x1410`, vier Desktops, eine
Activity, `perOutputVirtualDesktops=false`; `Meta+L` und `Meta+T` laufen dort
über `invokeShortcut`.

**Ausgeführt wurde die Reihe auf HAL9000 mit zwei Ausgaben** (DP-3 `1920x1080`
mit Panel, Arbeitsfläche `1920x1050`; eDP-1 `1920x1080` ohne Panel). Das
Kriterium verlangt mindestens zwei Ausgaben, insofern ist der Lauf gültig — was
er **nicht** belegt, ist das Verhalten bei drei und mehr Ausgaben, bei
unterschiedlichen Auflösungen und bei gebrochener Skalierung.

Zwei Handgriffe waren dafür nötig und gehören in die Vorschrift, wenn die Reihe
auf einem Notebook läuft:

```bash
# eDP-1 steht bei zugeklapptem Deckel auf disabled; Deckel öffnen genügt nicht.
# kscreen-doctor braucht die Wayland-Umgebung, sonst bricht es mit SIGABRT ab.
export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
export WAYLAND_DISPLAY=wayland-0
cp -a ~/.local/share/kscreen ~/kxl-ap7-kscreen.bak
kscreen-doctor output.eDP-1.enable output.eDP-1.position.1920,0
```

Zum Verteilen der Fenster auf die Ausgaben **`Window One Screen to the Right`**
verwenden, nicht `Window to Next Screen`: die zweite Aktion reagiert über
`invokeShortcut` nicht (`docs/research.md` 8.9).

Die Fälle 3 bis 5 wurden in Meilenstein 4 gegen einen Stand **ohne** Befehls-
und Konfigurationsschicht geprüft. Neu ist, dass je Ausgabe Layout,
Masteranteil **und Stapelreihenfolge** unterschiedlich gesetzt und über
Desktopwechsel hinweg getrennt gehalten werden.

| # | Fall | Aktion | Erwartung | Beleg |
|---|---|---|---|---|
| 26 | Multi-Output mit getrennten Zuständen | je drei Fenster auf DP-1, DP-9, DP-10; auf DP-1 `xml-promote`, auf DP-9 `xml-next-layout` (→ `full`), auf DP-10 zweimal `xml-shrink` und `xml-swap-next` | drei `surface`-Zeilen je Lauf mit eigenem `layout=` und `ratio=`, drei `diagnose`-Zeilen mit **verschiedener** `order=`; eine Aktion auf einer Ausgabe erzeugt keine Schreibzeile auf den anderen | Journal + Geometrie-Probe je Surface |
| 26a | alle vier Desktops (Fall 4) | auf jedem Desktop einen anderen Zustand herstellen, dann reihum durchschalten | vier Zustandssätze je Ausgabe; im Journal nur UUIDs, keine Desktopnamen; nach dem Durchlauf stehen alle Zustände unverändert | Journal + Diagnosezeilen |
| 26b | Desktopwechsel (Fall 5) | `Meta+2`, zurück `Meta+1` | genau **ein** Lauf, obwohl `desktopChanged` je Ausgabe feuert; neue Surface-Schlüssel; keine Schreibzeile für Fenster, die auf ihrem Desktop bleiben | Journal + Probe vor/nach |
| 26c | Fenster auf allen Desktops (Fall 7) | ein Fenster per Fensterregel auf alle Desktops | in jeder Surface mitgekachelt; keine Fokusübernahme durch eine inaktive Surface | Journal + Diagnosezeilen |
| 27 | Alltagsstunde | mindestens 60 Minuten normale Arbeit mit geladener Dev-Instanz | `nix run .#audit` meldet: keine Schleife, keine Rückkopplung, kein unerwartetes `aufgegeben`, Anteil „manuell zu prüfen" höchstens 5 %, Laufzeit mindestens 60 min und **ein** Skriptlauf | Journalartefakt und Auditorbericht, beide eingecheckt |

**Ergebnis vom 2026-09-06** (Protokoll
[`docs/ms7-2026-09-06-hal9000-ap7.md`](docs/ms7-2026-09-06-hal9000-ap7.md)):
alle fünf Fälle bestanden. 26 mit zwei Ausgaben (DP-3 `tall`/0.55, eDP-1
`full`/0.65, null `apply` für die unbeteiligte Ausgabe); 26a mit vier
Zustandssätzen; 26b mit **einem** `arrange` je Wechsel und null Schreibzeilen;
26c mit derselben Fenster-Id als Teilnehmer in allen vier Surfaces und **keiner**
`aktiviere`-Zeile; 27 mit 64,5 min in einem Skriptlauf, 37 Schreibvorgängen,
0 ohne Zuordnung und höchstens 2 auf dasselbe Soll.

Zwei Abweichungen: Fall 26c setzte das Fenster über den KDE-Shortcut
`Window On All Desktops` sticky statt über eine Fensterregel — für den
Controller ist beides derselbe Zustandswechsel. Und Fall 27 lief mit
skriptgesteuerter Last statt normaler Arbeit, weil auf HAL9000 niemand
arbeitet; belegt ist damit Schleifenfreiheit unter **dichter Ereignislast**,
nicht unter Alltagsbedingungen.

Das Kriterium aus `PLAN.md` Abschnitt 11 ist im Auditor operationalisiert: er
zählt **alle** Schreibarten (`apply`, `float`, `nachbessern`), rechnet
Nachbesserungen der Schreibgeneration des Fensters zu und erkennt technische
Gründe — `geometrieExtern`, `dock*`, `screensChanged`, `screenGeometry`,
`nachlauf*`, `closed` — **nicht** als neuen Anlass an. Sonst hielte sich eine
Rückkopplung `extern → arrange → apply → extern` selbst am Leben und wiese
formal immer einen frischen Grund vor. Ein zu kurzer Auszug, eine Lücke oder
ein zweiter Skriptlauf führen zu „nicht ausreichend belegt" — nicht zu
„bestanden".

#### Rückbau nach der MS7-Reihe auf HAL9000

Wie in der 24er-Reihe, mit einer geschärften Reihenfolge. **Der Sitzungszustand
entscheidet mit:** plasma-manager schreibt `kwinrc` und `kglobalshortcutsrc`
imperativ aus einem Aktivierungsskript, und `kglobalaccel` schreibt seinen
gespeicherten Zustand beim Sitzungsende zurück. Eine Wiederherstellung in der
laufenden Sitzung wird deshalb wieder überschrieben.

1. **Autologin abschalten**, solange die Testkonfiguration noch aktiv ist —
   sonst startet nach dem Neustart sofort wieder eine Sitzung.
2. Auf die notierte Startgeneration zurückschalten und
   `switch-to-configuration switch` aus dem `system-<N>-link` ausführen.
3. Testgenerationen löschen, `switch-to-configuration boot` für die
   Booteinträge.
4. Patches im `nixosconfig`-Baum mit `git apply --reverse` zurücknehmen;
   `git status --porcelain` muss leer sein.
5. Neu starten und **nicht anmelden**. Die Wiederherstellung läuft am
   Anmeldebildschirm über TTY oder SSH.
6. `kwinrc` und `kglobalshortcutsrc` aus den Sicherungen zurückspielen.
7. Erst danach anmelden.
8. Nachweis: `diff` gegen die beiden `.bak`-Dateien ist leer. Geprüft wird
   gegen die **gesicherte Ausgangslage**, nicht gegen Werte aus früheren
   Protokollen.

**Nach einem Lauf mit der Entwicklungsinstanz** (kein `switch`, kein
Generationswechsel) entfallen die Schritte 1 bis 5, und es braucht keinen
Neustart:

```bash
nix run .#unload                     # isScriptLoaded meldet false
# 30 s lang darf keine Controllerzeile mehr kommen:
t=$(date +%s); sleep 32
journalctl --user -b --since "@$t" _SYSTEMD_USER_UNIT=plasma-kwin_wayland.service \
  | grep -c "kwin-xmonad-lite:"     # muss 0 sein

# Die zwölf Registrierungen einzeln lösen -- sonst schreibt kglobalaccel
# seinen Speicherstand beim Sitzungsende wieder in die Datei:
for a in xml-expand xml-focus-master xml-focus-next xml-focus-prev \
         xml-next-layout xml-promote xml-reset-layout xml-shrink \
         xml-sink xml-swap-next xml-swap-prev xml-toggle-float; do
  busctl --user call org.kde.kglobalaccel /kglobalaccel \
    org.kde.KGlobalAccel unregister ss kwin "$a"
done
grep -c '^xml-' ~/.config/kglobalshortcutsrc     # muss 0 sein

cp ~/kxl-ap7-kwinrc.bak ~/.config/kwinrc         # Gruppe [Script-…-dev] mit entfernen
busctl --user call org.kde.KWin /KWin org.kde.KWin reconfigure
diff ~/kxl-ap7-kwinrc.bak ~/.config/kwinrc                     # leer
diff ~/kxl-ap7-kglobalshortcutsrc.bak ~/.config/kglobalshortcutsrc   # leer
```

Zusätzlich, falls für Fall 26 eine Ausgabe zugeschaltet wurde:
`kscreen-doctor output.eDP-1.disable` und die gesicherte
`~/.local/share/kscreen` zurückspielen.

**Der `unregister`-Schritt ist der Unterschied zur früheren Vorschrift.** Dort
stand, die zwölf `xml-*`-Zeilen blieben zwangsläufig stehen, weil es kein
`unregisterShortcut` gibt. Das gilt nur für die KWin-Skript-API; kglobalaccel
selbst nimmt die Registrierung restlos zurück (`docs/research.md` 8.8). Für das
**deklarative** Abschalten bleibt der `none`-Weg des Home-Manager-Moduls
richtig — der D-Bus-Aufruf ist ein imperativer Eingriff und gehört in Abnahme
und Aufräumarbeit.

### Eigenschaftsprüfung des Layoutkerns

`tests/layout-*.test.ts` prüfen nicht nur Beispiele, sondern Invarianten über
2025 Fälle eines erschöpfenden Gittersweeps und 500 Zufallsfälle. Der Zufall
kommt aus einem eigenen LCG in `tests/support/gen.ts` mit **festem Seed**
(`FUZZ_SEED`); jede Fehlermeldung enthält Seed und Fallparameter, ein
Fehlschlag ist also ohne Suche reproduzierbar. Es gibt keine Testbibliothek.

Wer den Layoutkern ändert, prüft die Wirksamkeit der Tests am schnellsten mit
einer Mutationsprobe: eine Größe im Layout um 1 px verfälschen und prüfen, dass
`node --test` das meldet.

## Projektspezifisches

### KWin-Skripte über D-Bus

```bash
busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s <name>
busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript ss <pfad.js> <name>
busctl --user call org.kde.KWin /Scripting/Script<N> org.kde.kwin.Script run
busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s <name>
```

`loadScript` nimmt eine einzelne `.js`-Datei; ein KPackage-Verzeichnis ist nur
für den über `kwinrc` gesteuerten Autostart nötig. Der Rückgabewert ist die
Script-ID und damit der D-Bus-Objektpfad — `-1` bedeutet, dass der Plugin-Name
bereits belegt ist. Nach `unloadScript` muss man warten, bis `isScriptLoaded`
`false` meldet, bevor derselbe Name erneut geladen werden kann.

### Journal lesen

```bash
journalctl --user -u plasma-kwin_wayland -f
```

### nixpkgs aktualisieren

Der Input zeigt auf den Branch `nixos-unstable-small`, die `flake.lock` steht
zunächst auf demselben Commit wie die NixOS-Konfiguration dieser Maschine
(`8a37cfb9`), damit die geprüften Werkzeugversionen reproduzierbar bleiben.

```bash
nix flake update nixpkgs   # folgt dem Branch
nix flake metadata         # gelockten Commit kontrollieren
```

Nach einem Update prüfen, ob KWin dort weiterhin 6.7.4 ist — die im Projekt
dokumentierten API-Befunde sind an diese Version gebunden.
