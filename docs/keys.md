# Tastenkürzel und Konfiguration

Verbindliche Übersicht der zwölf Aktionen, ihrer objectNames und der sechs
Konfigurationsschlüssel. Die Werte in diesem Dokument sind gegen den Quelltext
(`src/kwin/command.ts`, `src/kwin/config.ts`, `nix/home-module.nix`) und gegen
den Abnahmelauf vom 2026-09-06 auf SPIELKISTE gehalten
([`shortcuts-2026-09-06-spielkiste.log`](shortcuts-2026-09-06-spielkiste.log)).

## 1. Tastenbelegung

| Funktion | Taste | objectName | Wirkung |
|---|---|---|---|
| Fokus vor | `Meta+J` | `xml-focus-next` | Fokus zum nächsten Mitglied der Surface |
| Fokus zurück | `Meta+K` | `xml-focus-prev` | Fokus zum vorigen Mitglied |
| Fenster nach hinten tauschen | `Meta+Shift+J` | `xml-swap-next` | tauscht das fokussierte Fenster mit dem nächsten |
| Fenster nach vorn tauschen | `Meta+Shift+K` | `xml-swap-prev` | tauscht mit dem vorigen |
| Master fokussieren | `Meta+M` | `xml-focus-master` | Fokus auf das erste Fenster der Reihenfolge |
| Zum Master machen | `Meta+Return` | `xml-promote` | zieht das fokussierte Fenster an den Anfang der Reihenfolge |
| Master verkleinern | `Meta+H` | `xml-shrink` | Masteranteil um 0,05, untere Grenze 0,1 |
| Master vergrößern | `Meta+L` | `xml-expand` | Masteranteil um 0,05, obere Grenze 0,9 |
| Wieder kacheln | `Meta+T` | `xml-sink` | nimmt die Float-Markierung vom aktiven Fenster |
| Float umschalten | `Meta+Shift+T` | `xml-toggle-float` | schaltet die Float-Markierung des aktiven Fensters um |
| Layout wechseln | `Meta+Space` | `xml-next-layout` | zyklisch durch `LAYOUTS` (`tall`, `full`) |
| Layout zurücksetzen | `Meta+Shift+Space` | `xml-reset-layout` | Layout und Masteranteil der Surface auf die konfigurierten Startwerte |

Fokus, Tausch, Promote, Ratio und Layout wirken auf der **gewählten Surface**;
Float und Sink wirken auf dem **aktiven Fenster**, weil die Float-Markierung
eine globale Fenstereigenschaft ist und das Modell des Nutzers „das Fenster,
das ich sehe" lautet. Die Surface wird dreistufig gewählt und die Stufe steht
als `via=` in der Journalzeile: `aktiv` (das aktive Fenster ist Mitglied),
`ausgabe` (das aktive Fenster ist Nichtmitglied wie krunner — es gewinnt die
Surface seiner Ausgabe), `erste` (kein aktives Fenster).

### Die Tasten sind nur eine Erstinstallations-Vorgabe

`registerShortcut` ruft `KGlobalAccel::setShortcut` **ohne** `NoAutoloading`.
Steht die Aktion bereits in `~/.config/kglobalshortcutsrc`, gewinnt der Eintrag
dort — die im Quelltext angegebene Taste wirkt dann nicht mehr. Eine spätere
Änderung von `keys` in `src/kwin/command.ts` erreicht deshalb keine Maschine,
die das Skript schon einmal geladen hat; dort ist die Taste über
`programs.plasma.shortcuts.kwin.<objectName>` oder die Systemeinstellungen zu
ändern.

**Auf einer deklarativ verwalteten Maschine gilt trotzdem die Nix-Tabelle.**
Genau weil die Erstbelegung dort nicht mehr ankommt, schreibt das
Home-Manager-Modul alle zwölf Tasten in jeder Generation — die nicht in
`shortcuts` gesetzten mit der Vorgabe aus dem Skript. Der Preis: eine in den
Systemeinstellungen umgelegte `xml-*`-Taste ist beim nächsten `switch` wieder
weg. Wer sie behalten will, schreibt sie ins Modul.

Die **objectNames sind ab dem ersten Release unwiderruflich.** Es gibt kein
`unregisterShortcut`; jede Umbenennung hinterlässt eine tote Zeile in
`kglobalshortcutsrc`, die die Taste weiter reserviert. In der Datei auf
SPIELKISTE stehen aus demselben Grund bereits 35 `Krohnkite*`- und 20
`Polonium*`-Leichen. Das gilt auch für das Deaktivieren: nach dem Abschalten
des Skripts bleiben die zwölf `xml-*`-Zeilen stehen. Das Modul setzt sie im
Aus-Zweig deshalb auf `none` — die Zeile bleibt, aber die Taste ist frei.

### Konfliktlage `Meta+L` und `Meta+T`

Zwei der zwölf Tasten sind in einer Plasma-Standardinstallation belegt:

| Taste | Fremde Aktion | Auflösung |
|---|---|---|
| `Meta+L` | `[ksmserver] Lock Session` | `Lock Session` auf `Screensaver` und `Ctrl+Alt+L` umlegen |
| `Meta+T` | `[kwin] Edit Tiles` | `Edit Tiles` auf keine Taste setzen |

**Livebefund vom 2026-09-06 (SPIELKISTE, KWin 6.7.4):** nach dem Laden standen
`Lock Session=Screensaver\tMeta+L` und `xml-expand=Meta+L` **gleichzeitig** in
`kglobalshortcutsrc`, ebenso `Edit Tiles=Meta+T` und `xml-sink=Meta+T`. Beim
Tastendruck gewann in **beiden** Fällen der vorhandene Eintrag: `Meta+L`
sperrte die Sitzung, `Meta+T` öffnete den Kachel-Editor. Die zehn
konfliktfreien Tasten wirkten im selben Lauf alle wie vorgesehen.
`registerShortcut` meldete die Kollision nicht — es liefert immer `true`.

Damit ist die Umlegung **Voraussetzung**, nicht Absicherung: ohne sie bekommen
`xml-expand` und `xml-sink` ihre Taste nie. Beide Aktionen bleiben so lange nur
über `invokeShortcut` erreichbar (siehe `build.md`, Fall 18).

Das Projektmodul verändert von sich aus **keine** fremden KDE-Kürzel. Die
Umlegung gehört in die Host-Konfiguration; in `nixosconfig` steht sie in
`modules/user/muhackel/kwin-xmonad-lite.nix` und gilt nur dort, wo das
Feature-Flag gesetzt ist. Das Projektmodul bietet mit
`programs.kwin-xmonad-lite.relocateKdeShortcuts` (Vorgabe `false`) denselben
Eingriff als Notausgang an.

Unangetastet bleiben `Meta+1..4`, `Meta+!@#$`, `Meta+Gravis` (Yakuake),
`Meta+Tab` und `Meta+Shift+Tab`.

## 2. Konfiguration

### Gruppe in `kwinrc`

`readConfig` liest aus `kwinrc` in der Gruppe `[Script-<pluginName>]`. Der
Pluginname unterscheidet sich zwischen Produktion und Entwicklungsinstanz:

| Instanz | Geladen über | Gruppe |
|---|---|---|
| Produktion | KPackage-Autostart, `Plugins.kwin-xmonad-liteEnabled` | `[Script-kwin-xmonad-lite]` |
| Entwicklung | `nix run` / `nix run .#reload` (`scripts/dev-load.sh`) | `[Script-kwin-xmonad-lite-dev]` |

Wer beim Erproben in die Produktionsgruppe schreibt, sieht keine Wirkung. Das
Dev-Bundle mit Fenstermenü (`nix run . -- --menu`) lädt unter demselben
Dev-Namen und liest deshalb aus derselben Gruppe.

### Schlüssel

Ein Schlüssel, der **nicht gesetzt** ist, erzeugt keine Notiz; eine gesetzte,
aber unbrauchbare Eingabe schon. Geworfen wird nie, geklemmt immer.

| Schlüssel | Rohform | Vorgabe | Prüfung und Klemmung |
|---|---|---|---|
| `gapOuter` | Zahl als Text | `0` | `Number` → endlich → `Math.round` → `[0, 200]` |
| `gapInner` | Zahl als Text | `0` | wie oben |
| `excludes` | Liste, mit `,` getrennt | die sieben Vorgabeklassen | normalisiert, Leereinträge fallen weg, sortiert; **leerer Wert heißt leere Liste** |
| `masterRatio` | Zahl als Text | `0.65` | `clampRatio` auf `[0.1, 0.9]`, danach auf zwei Nachkommastellen |
| `defaultLayout` | Text | `tall` | gegen `LAYOUTS` aufgelöst (`tall`, `full`), Groß-/Kleinschreibung egal; unbekannt → `tall` |
| `debug` | `true` / `false` | `false` | alles andere → `false` |

Die sieben Vorgabeklassen von `excludes` sind `krunner`, `yakuake`, `kded6`,
`polkit-kde-authentication-agent-1`, `plasmashell`, `xwaylandvideobridge` und
`steam_app_default`. Der Vergleich läuft auf normalisiertem `resourceClass` mit
**Vollmatch**, nicht als Teilzeichenkette.

Die Obergrenze 200 für die Abstände fängt den Tippfehler ab, nicht den
Geschmack. Ganzzahlig müssen sie sein, weil `tall` und `full` ganzzahlige
Zellen liefern; eine gebrochene Kante erzeugte in jeder Epoche eine Abweichung
zwischen Soll und Rücklesen.

`masterRatio` und `defaultLayout` wirken auf **neu angelegte Surfaces** und als
Ziel von `xml-reset-layout`. Eine bestehende Surface behält ihre per `Meta+H`,
`Meta+L` und `Meta+Space` gemachten Anpassungen — sonst nähme der nächste
Anordnungslauf sie zurück. Über einen Reload hinweg ist das nicht zu
beobachten: ein Reload erzeugt einen neuen Adapter mit leerer Registry, danach
gelten überall wieder die konfigurierten Startwerte. Zustandspersistenz ist
Stufe 2.

### Beispiel `kwinrc`

```ini
[Script-kwin-xmonad-lite]
gapOuter=8
gapInner=4
masterRatio=0.6
defaultLayout=tall
debug=false
excludes=krunner,yakuake,kded6,polkit-kde-authentication-agent-1,plasmashell,xwaylandvideobridge,steam_app_default
```

Von Hand gesetzt wird das mit `kwriteconfig6`:

```bash
kwriteconfig6 --file kwinrc --group Script-kwin-xmonad-lite-dev --key gapOuter 8
```

### Beispiel Nix (Home Manager)

```nix
{
  inputs.kwin-xmonad-lite = {
    url = "github:muhackel/kwin-xmonad-lite";
    inputs.nixpkgs.follows = "nixpkgs";
    inputs.home-manager.follows = "home-manager";
    inputs.plasma-manager.follows = "plasma-manager";
  };
}
```

```nix
# in der Home-Manager-Konfiguration, zusammen mit
# plasma-manager.homeModules.plasma-manager und
# kwin-xmonad-lite.homeModules.default
programs.kwin-xmonad-lite = {
  enable = true;
  settings = {
    gapOuter = 8;
    gapInner = 4;
    masterRatio = 0.6;
    defaultLayout = "tall";
    debug = false;
  };
  # Optional: eigene Tastenbelegung statt der Erstinstallations-Vorgabe.
  shortcuts."xml-focus-next" = "Meta+J";
};
```

Das Modul schreibt **immer alle sechs Schlüssel** nach
`[Script-kwin-xmonad-lite]`, auch die unveränderten, und ebenso **alle zwölf
Tasten** nach `kglobalshortcutsrc`. plasma-manager läuft mit
`overrideConfig = false` und löscht nicht mehr deklarierte Schlüssel nicht;
ohne das vollständige Schreiben bliebe nach dem Entfernen von
`settings.gapOuter = 8` weiterhin `8` in `kwinrc` stehen.

`shortcuts` nimmt nur die zwölf bekannten `objectName`s an. Ein Tippfehler wie
`xml-focus-nex` ist ein Auswertungsfehler und keine wirkungslose Zeile, die
dauerhaft in `kglobalshortcutsrc` stehen bliebe.

### Abschalten

`enable = false` nimmt Plugin-Aktivierung und Tasten zurück:
`kwin-xmonad-liteEnabled` wird `false`, und die zwölf Tasten bekommen `none`.
Steuern lässt sich das über `cleanupWhenDisabled` (Vorgabe `true`) — auf einer
Maschine, deren Entwicklungsinstanz dieselben objectNames lädt, nähme der
Aus-Zweig ihr sonst genau die Tasten, mit denen sie erprobt werden soll.

Die Gruppe `[Script-kwin-xmonad-lite]` bleibt mit ihren zuletzt geschriebenen
Werten in `kwinrc` stehen. Sie ist bei abgeschaltetem Plugin wirkungslos; beim
erneuten Aktivieren überschreibt das Modul wieder alle sechs Werte.

**Der Aus-Zweig wirkt nur, wenn plasma-manager unabhängig vom Controller
läuft.** Sein gesamter Schreibvorgang hängt an `mkIf programs.plasma.enable`;
setzt nur der Ein-Zweig diese Option, verschwindet mit dem Abschalten der
Schreiber selbst, und der alte Stand bleibt für immer stehen. In `nixosconfig`
hängt plasma-manager deshalb am eigenen Flag `local.features.plasmaManager`.

Die Konfliktauflösung der beiden KDE-Kürzel gehört **nicht** hierher, sondern
in die Host-Konfiguration (siehe Abschnitt 1).

## 3. Wirksamkeit: zweistufig

Die Konfiguration wird **einmal gelesen**, am Anfang von `start()`. Das ist
keine Bequemlichkeit: `readConfig` reicht den Wert aus dem Speicher heraus, und
`Workspace::reconfigure()` startet für das Neueinlesen nur
`reconfigureTimer.start(200)` (`docs/research.md` Abschnitt 2.7). Weder ein
Reload noch ein `switch` allein genügt deshalb.

### Entwicklungsinstanz

```bash
kwriteconfig6 --file kwinrc --group Script-kwin-xmonad-lite-dev --key gapOuter 8
busctl --user call org.kde.KWin /KWin org.kde.KWin reconfigure
sleep 1
nix run .#reload
```

Ohne den `reconfigure`-Aufruf liest das neu geladene Skript die **alten** Werte
— `scripts/reload.sh` ruft `reconfigure` nicht selbst. Die Sekunde Wartezeit
deckt den 200-ms-Timer mit Reserve ab.

### Produktion

`nixos-rebuild switch` schreibt `kwinrc`, startet den laufenden Controller aber
nicht neu, und KWin lädt eine bereits geladene Plugin-Id nicht erneut. Wirksam
wird die Änderung erst **nach Ab- und Anmeldung**. Wer das umgehen will, ruft
von Hand `reconfigure` und danach `unloadScript`/`loadScript` über den
Scripting-D-Bus.

## 4. Was im Journal steht

```
kwin-xmonad-lite: config gaps=8/4 ratio=0.5 layout=1 excludes=3 debug=true
kwin-xmonad-lite: config excludes=krunner,plasmashell,yakuake
kwin-xmonad-lite: shortcuts n=12
kwin-xmonad-lite: befehl focusNext surface=<activity>|<desktop>|DP-1 via=aktiv fokus={911cbadb-…}
kwin-xmonad-lite: arrange #7 grund=windowActivated,shortcut:focusNext surfaces=3 …
```

Die `config`-Zeile fasst den wirksamen Stand zusammen; `layout=` ist der Index
in `LAYOUTS` (0 = `tall`, 1 = `full`). Davor steht je Korrektur eine eigene
Zeile, zum Beispiel:

```
kwin-xmonad-lite: config gapOuter=abc unlesbar, verwende 0
kwin-xmonad-lite: config gapInner=-5 unzulässig, verwende 0
kwin-xmonad-lite: config excludes leer: kein Fenster wird ausgeschlossen
kwin-xmonad-lite: config masterRatio=1.5 geklemmt auf 0.9
kwin-xmonad-lite: config defaultLayout=grid unbekannt, verwende tall
kwin-xmonad-lite: config debug=ja unlesbar, verwende false
```

Die zweite Zeile oben (`config excludes=…`) ist eine `debugLog`-Zeile und
erscheint nur bei `debug=true`. Sie läuft bewusst über denselben Präfix wie
alle anderen, sonst griffe der Journalfilter in `scripts/logs.sh` nicht und die
Zeile wäre bei `nix run .#logs` unsichtbar.

Jeder Tastendruck erzeugt **genau eine** `befehl …`-Zeile. Ein danach
angemeldeter Anordnungslauf trägt `shortcut:<name>` in seinem Grund; mehrere
Tastendrücke innerhalb des 20-ms-Fensters landen in **einem** Lauf, dessen
Grund dann alle Quellen sammelt.

## 5. Abnahme und offene Punkte

Die deklarative Aktivierung auf HAL9000 ist mit den Fällen 24 bis 24e
bestanden: Laden aus dem Store, alle zwölf Tasten per `/dev/uinput`, Ändern
und Entfernen von `settings` sowie Abschalten des Feature-Flags. Die Reihe lief
gegen den Pin `8f287d9`; Rohdaten stehen in
[`hal9000-abnahme-2026-09-06.log`](hal9000-abnahme-2026-09-06.log).

- Das Verhalten bei einem **modalen Dialog** als Fokusziel ist nicht gemessen
  (Fall 20b). Die Vorschrift dafür steht in `build.md`; gezählt wird nicht die
  `befehl`-Zeile, sondern die Zahl der `aktiviere <id>`-Zeilen. Dass es
  strukturell nie mehr als eine je Befehl sein kann, hält
  `checks.activate-once` fest: genau ein Schreibzugriff auf
  `workspace.activeWindow` im ganzen Baum, in `src/kwin/adapter.ts`.
- Der Fall „Fokusziel zwischen Tastendruck und Lauf geschlossen" (Fall 20c) ist
  nicht reproduzierbar herstellbar und bleibt unbelegt; der Pfad
  `aktivieren fehlgeschlagen für …` existiert im Adapter.

## 6. Diagnosezeilen bei `debug=true`

Reihenfolge, Layout-Teilnahme und Float-Markierung stehen in der Registry, nicht
am KWin-Fenster. Eine lesende Probe kann sie deshalb nicht messen; für die
Abnahme gibt es seit Meilenstein 7 zwei zusätzliche Zeilen, beide nur bei
`debug=true`:

```
kwin-xmonad-lite: diagnose <surface> order=<id,id,id> teilnehmer=<id,id> float=<id>
kwin-xmonad-lite: aktiviere <id>
```

Die erste steht je Surface in jedem Anordnungslauf, unmittelbar nach der
`surface`-Zeile. Ohne sie sind der Zustandsverlust über einen Reload (Fall 16),
getrennte Stapelreihenfolgen je Ausgabe (Fall 26) und die Zuordnung Fenster zu
Zelle nicht belegbar, sondern nur plausibel.

Die zweite steht im Aktivierungspfad und ist der einzige **live zählbare**
Aktivierungsversuch. Die `befehl`-Zeile sagt nur, dass ein Befehl lief.

In der Produktion schweigen beide, solange `debug` nicht gesetzt ist — je
Surface und Lauf eine ganze Fensterliste ins Journal zu schreiben, wäre sonst
der Normalzustand.
