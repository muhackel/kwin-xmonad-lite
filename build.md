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

## Testen / Checks

```bash
nix flake check      # Paketbau (inkl. Typprüfung und Unit-Tests), Lint,
                     # Skripte, Snapshot-Grenze, Home-Manager-Modul
                     # ein- und ausgeschaltet
```

`checks.snapshot-boundary` erzwingt die weiter unten beschriebene Grenze als
Derivation. Das Grep-Paar ist dasselbe; der Check wirft zusätzlich die vier
erlaubten Dateien weg und scheitert mit der Trefferzeile, wenn etwas übrig
bleibt. Vorher war die Grenze nur Prosa — `tsc` beanstandet einen
`workspace`-Zugriff in `core/` oder `state/` nicht, ein neuer Globalzugriff
wäre also grün durchgelaufen.

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
grep -rn 'workspace\.\|KWin\.\|new QTimer\|options\.\|registerUserActionsMenu\|registerShortcut\|readConfig' src \
  | grep -vE '(globals\.d\.ts|:[0-9]+:[[:space:]]*(\*|//|/\*))'
# darf nur Zeilen aus boot.ts, dev.ts, read.ts und adapter.ts zeigen
```

Dasselbe Musterpaar steckt in `checks.snapshot-boundary` und läuft mit
`nix flake check` mit; die beiden Stellen sind deckungsgleich zu halten.

Der `grep` läuft rekursiv über ganz `src`, nicht nur über `src/*.ts` und
`src/kwin/*.ts`: `tsc` beanstandet einen `workspace`-Zugriff in `core` oder
`state` nicht, weil `globals.d.ts` für den ganzen Baum gilt.

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

**Testmatrix 23** — Reload und Sitzungsneustart. Nach `nix run .#reload` darf
**keine einzige** `apply`-Zeile erscheinen, keine doppelte Registrierung im
Journal, kein zusätzlicher Eintrag in `kglobalshortcutsrc`; die zwölf Aktionen
bleiben wirksam. Gemessen: über zehn Minuten danach kein `nachbessern`, kein
`aufgegeben`, kein `extern`. Die Konfiguration fällt erwartungsgemäß auf die
konfigurierten Startwerte zurück.

### Abnahme Matrix 24–24e: deklarative Installation

Auf HAL9000 nach `nixos-rebuild switch --sudo` und Neuanmeldung.
**Noch nicht abgenommen** — die Fälle stehen hier als Abnahmevorschrift.

| # | Fall | Erwartung |
|---|---|---|
| 24 | Aktivierung | `isScriptLoaded kwin-xmonad-lite` meldet `true`, das Skript läuft aus dem Store, `nix run` bricht dort mit der Meldung aus `require_no_production` ab |
| 24a | `Meta+L` und `Meta+T` per Tastendruck | Master vergrößern bzw. wieder kacheln; die Sitzung sperrt **nicht**, „Kachelung bearbeiten" öffnet **nicht**. `Ctrl+Alt+L` sperrt weiterhin |
| 24b | Konfliktausgang nach der Umlegung | in `kglobalshortcutsrc` prüfen, dass `Lock Session` auf `Screensaver` und `Ctrl+Alt+L` steht und `Edit Tiles` leer ist; im Journal muss die `befehl expand`- bzw. `befehl sink`-Zeile erscheinen |
| 24c | `settings` ändern, `switch`, neu anmelden | die neuen Werte stehen in `kwinrc` und in der `config …`-Zeile |
| 24d | Schlüssel in Nix **entfernen**, `switch`, neu anmelden | der dokumentierte Vorgabewert steht in `kwinrc`, nicht der alte Wert — der Beleg für „immer alle sechs Schlüssel schreiben" |
| 24e | `kwinXmonadLite = false` (`plasmaManager` bleibt an), `switch`, neu anmelden | `kwin-xmonad-liteEnabled=false`, Skript nicht geladen, alle zwölf `xml-*`-Zeilen stehen auf `none`, `Lock Session` wieder auf `Screensaver\tMeta+L`, `Edit Tiles` auf `Meta+T`. **`Meta+L` sperrt per Tastendruck wieder**, `Ctrl+Alt+L` nicht mehr. Die zwölf Zeilen selbst bleiben stehen — es gibt kein `unregisterShortcut`; `none` gibt nur die Taste frei |

```bash
busctl --user call org.kde.KWin /Scripting \
  org.kde.kwin.Scripting isScriptLoaded s kwin-xmonad-lite
kreadconfig6 --file kwinrc --group Script-kwin-xmonad-lite --key gapOuter
grep -E '^(Lock Session|Edit Tiles)=' ~/.config/kglobalshortcutsrc
```

#### Rückbau nach der Reihe

Die Reihe endet **nicht** im Testzustand. Die nächste Abnahme soll wieder auf
einem nackten Gerät beginnen, und die Generationsnummer soll nicht mit jedem
Durchlauf davonlaufen.

**Vor** dem ersten `switch`:

```bash
sudo nix-env --list-generations --profile /nix/var/nix/profiles/system | tail -3
cp ~/.config/kwinrc              ~/kxl-abnahme-kwinrc.bak
cp ~/.config/kglobalshortcutsrc  ~/kxl-abnahme-kglobalshortcutsrc.bak
```

Nach dem letzten Fall — `<N>` ist die notierte Ausgangsgeneration, `<M> …` sind
die während der Reihe entstandenen:

```bash
sudo nixos-rebuild switch --rollback          # oder gezielt:
sudo /nix/var/nix/profiles/system-<N>-link/bin/switch-to-configuration switch
sudo nix-env --profile /nix/var/nix/profiles/system --delete-generations <M> <M+1>
sudo /run/current-system/bin/switch-to-configuration boot

cp ~/kxl-abnahme-kwinrc.bak              ~/.config/kwinrc
cp ~/kxl-abnahme-kglobalshortcutsrc.bak  ~/.config/kglobalshortcutsrc
```

Danach ab- und anmelden. Das Zurückspielen der beiden Dateien ist **kein**
Beiwerk: plasma-manager schreibt sie imperativ aus einem Aktivierungsskript,
und seine Schreibvorgänge überleben den Generationswechsel. Ein Rollback allein
lässt `kwinrc` und `kglobalshortcutsrc` im Testzustand zurück.

Zur **Feature-Probe:** `nix run .#probe -- --shortcuts` registriert drei
Aktionen und protokolliert nur die Rückgabewerte. Sie betätigt keine Taste und
liest keine wirksame Zuordnung aus; `registerShortcut` liefert ohnehin immer
`true`. Der Lauf bleibt als Nebenbefund nützlich, entscheidet aber keine
Kollisionsfrage — das tut nur der Tastendruck.

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
