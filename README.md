# kwin-xmonad-lite

Ein schlanker Layout-Controller als KWin-Skript für Plasma 6 auf Wayland. Er
holt einen kleinen Teil des alten XMonad-Arbeitsgefühls zurück: automatisches
Kacheln mit einem Master-Bereich, ein Vollbild-Layout und Tastensteuerung für
Fokus, Reihenfolge und Master-Anteil.

Er ist **kein** Fenstermanager und **kein** XMonad-Nachbau. Fenster-, Desktop-,
Activity- und Bildschirmzuordnung bleiben vollständig bei KWin und seinen
Fensterregeln; dieses Skript ordnet nur an, was KWin ohnehin anzeigt.

> **Status: MVP abgenommen, Meilenstein 7 und Zwischenschritt 7.1
> abgeschlossen (2026-09-06).**
> Die Abnahme war zwischenzeitlich ausgesetzt: ein externes Audit fand
> Defekte in den **Prüfwerkzeugen** — nicht im Controller. Orakel und Auditor
> ließen auch ungültige Nachweise durch. Ein zweites Audit (7.1) fand die
> berichtigten Prüfer noch stumpf: der Auditor konnte in der Alltagsstunde
> nach Konstruktion keine Schleife finden, das Orakel prüfte Mengen statt
> Zuordnung. Beide sind geschärft, jeder archivierte Nachweis wurde erneut
> ausgewertet und besteht; die Neuauswertung ist als Flake-Check verankert und
> deckt jedes Artefakt ab. Die Fälle waren richtig, nur ihre Prüfung war zu
> lasch — zweimal.
>
> Das Skript kachelt auf allen Bildschirmen; jeder virtuelle Desktop und jede
> Activity führt je Bildschirm einen eigenen Stapel. Vollbild, Maximierung und
> Minimierung verlassen das Layout, ohne ihre Stapelposition zu verlieren.
> Dialoge und Fenster mit fester Größe bleiben unberührt, Mindest- und
> Höchstgrößen werden berücksichtigt. Seit Meilenstein 6 ist der Controller
> bedienbar: zwölf eigene Tastenkürzel, sechs Konfigurationsschlüssel in
> `kwinrc` und ein Home-Manager-Modul für die deklarative Installation. Damit
> ist auch das Full-Layout erreichbar. Der Stand hat 405 Tests und zehn
> Flake-Checks.
>
> Meilenstein 7 hat das Verhalten live geprüft, in vier Reihen auf HAL9000 mit
> vollständigem Rückbau: die deklarative Installation samt Aus-Zweig
> (Testmatrix 24–24e), dann die Geometrie gegen eine unabhängig vorgegebene
> Erwartung (25–25c), der modale Dialog als Fokusziel (20b), Reload und
> KWin-/Sitzungsneustart (16–17b), der Multi-Output-Lauf mit einer Stunde unter
> Last (26–27) und zuletzt die Reihe AP8 (26d, 27b) gegen die zwei offenen
> Beleggrenzen. Zwei Ergebnisse sind erwähnenswert: einen KWin-Neustart über
> `org.kde.KWin.replace` überlebt **kein** Wayland-Client, und von 59
> Anordnungsläufen in der Laststunde schrieben nur 16 überhaupt etwas — die
> übrigen stellten fest, dass alles am Platz ist.
>
> AP8 (2026-09-12) hat die zwei Einschränkungen des ersten Multi-Output-Laufs
> nachgeholt: eine **skalierte** zweite Ausgabe (1,25) und eine Laststunde mit
> **technischer** Last (Hotplug, Panelhöhe, Ziehen). Der Controller lief
> schleifenfrei; die Laststunde deckte dabei einen dritten Defekt im **Auditor**
> auf (die Wiederholungsregel war für technische Last zu streng), der geschärft
> wurde — nicht im Controller. Offen bleiben drei oder mehr Ausgaben und eine
> Last durch echtes menschliches Arbeiten. Alles steht in den Protokollen unter
> [`docs/`](docs/) und in [`PLAN.md`](PLAN.md) Abschnitt 9. Eine Test-VM ist nicht vorgesehen:
> gegen zwei echte Maschinen gewinnt sie nichts. `checks.bundle-runtime` prüft
> das gebaute Bundle per Grep auf Funktionen, die QJSEngine nicht hat, und die
> esbuild-Zielstufe — ein **Ladeversuch ist er nicht**. Nicht herstellbar und
> deshalb unbelegt bleibt Fall 20c.

## Schnellstart

```bash
nix develop            # Entwicklungsumgebung
nix flake check        # Typprüfung, Unit-Tests, Lint, Paketbau, Home-Modul
nix run                # Skript in die laufende KWin-Sitzung laden
nix run .#logs         # KWin-Journal verfolgen
```

`nix run` lädt das gebaute Skript **direkt aus dem Nix-Store**. Es entsteht
keine Kopie unter `~/.local/share/kwin/scripts`, die später ein deklarativ
installiertes Paket überschatten würde.

## Bedienung

| Funktion | Taste | objectName |
|---|---|---|
| Fokus vor / zurück | `Meta+J` / `Meta+K` | `xml-focus-next` / `xml-focus-prev` |
| Fenster tauschen | `Meta+Shift+J` / `Meta+Shift+K` | `xml-swap-next` / `xml-swap-prev` |
| Master fokussieren | `Meta+M` | `xml-focus-master` |
| Zum Master machen | `Meta+Return` | `xml-promote` |
| Master verkleinern / vergrößern | `Meta+H` / `Meta+L` | `xml-shrink` / `xml-expand` |
| Wieder kacheln | `Meta+T` | `xml-sink` |
| Float umschalten | `Meta+Shift+T` | `xml-toggle-float` |
| Layout wechseln | `Meta+Space` | `xml-next-layout` |
| Layout zurücksetzen | `Meta+Shift+Space` | `xml-reset-layout` |

Die Tasten sind nur die **Erstinstallations-Vorgabe**: `registerShortcut` läuft
ohne `NoAutoloading`, ein vorhandener Eintrag in `kglobalshortcutsrc` gewinnt.
Genau deshalb schreibt das Home-Manager-Modul alle zwölf Belegungen bei jeder
Generation selbst — auf einer deklarativ verwalteten Maschine ist die
Nix-Konfiguration maßgeblich, und eine in den Systemeinstellungen umgelegte
`xml-*`-Taste ist beim nächsten `switch` wieder weg.

Zwei Tasten kollidieren mit KDE-Vorgaben — `Meta+L` sperrt die Sitzung,
`Meta+T` öffnet die Kachelbearbeitung. Gemessen gewinnt in beiden Fällen der
vorhandene Eintrag; die Umlegung in der Host-Konfiguration ist damit
**Voraussetzung**, nicht Absicherung. Das Projekt ändert von sich aus **keine**
fremden Tastenkürzel. Einzelheiten in [`docs/keys.md`](docs/keys.md).

## Installation

Deklarativ über das mitgelieferte Home-Manager-Modul. Konfiguration schreibt
es ausschließlich über plasma-manager-Optionen, keine Datei selbst; direkt
gesetzt wird nur `home.packages`, damit das KPackage im Profil liegt.

> **Live geprüft auf HAL9000.** Die Reihe 24–24e hat Installation,
> Konfiguration, Kürzelumlegung und Abschalten gegen den Pin `8f287d9`
> bestätigt. Danach wurde HAL9000 vollständig auf Generation 584 und die
> gesicherten Konfigurationsdateien zurückgebaut. Rohdaten:
> [`docs/hal9000-abnahme-2026-09-06.log`](docs/hal9000-abnahme-2026-09-06.log).

```nix
# flake.nix des Hosts
inputs.kwin-xmonad-lite = {
  url = "github:muhackel/kwin-xmonad-lite";
  inputs.nixpkgs.follows = "nixpkgs";
  inputs.home-manager.follows = "home-manager";
  inputs.plasma-manager.follows = "plasma-manager";
};
```

```nix
# beide Module in dieselbe Home-Manager-Konfiguration, z. B. über
# home-manager.sharedModules
home-manager.sharedModules = [
  plasma-manager.homeModules.plasma-manager
  kwin-xmonad-lite.homeModules.default
];
```

```nix
# in der Home-Manager-Konfiguration
programs.kwin-xmonad-lite.enable = true;
```

Der Output heißt `homeModules.default`; `homeManagerModules.default` ist
derselbe Wert unter dem älteren Namen. Das Modul installiert das Paket, setzt
`Plugins.kwin-xmonad-liteEnabled` in `kwinrc`, schreibt die Gruppe
`[Script-kwin-xmonad-lite]` und alle zwölf Tastenbelegungen.

`enable = false` nimmt das wieder zurück: das Plugin wird abgeschaltet und die
zwölf Tasten bekommen `none`, was die Taste freigibt — die Zeilen selbst
bleiben stehen, ein `unregisterShortcut` gibt es nicht. Der Aus-Zweig ist über
`cleanupWhenDisabled` abschaltbar, für Maschinen, auf denen die
Entwicklungsinstanz dieselben objectNames lädt. **Er wirkt nur, wenn
plasma-manager unabhängig vom Controller läuft** — sonst schreibt nach dem
Abschalten niemand mehr, und mit `overrideConfig = false` bliebe der alte Stand
stehen. Die Gruppe `[Script-kwin-xmonad-lite]` bleibt beim Abschalten mit den
zuletzt geschriebenen Werten in `kwinrc`; sie ist bei ausgeschaltetem Plugin
wirkungslos. Der Aus-Zweig bereinigt nur Plugin-Flag und Tastenkürzel.

In `nixosconfig` hängt plasma-manager deshalb am eigenen Feature-Flag
`local.features.plasmaManager` und der Controller an
`local.features.kwinXmonadLite`; dort steht auch die Umlegung der beiden
kollidierenden KDE-Kürzel und ihre Rückstellung, sobald der Controller aus
ist.

Für die Entwicklung genügt `nix run` — das lädt die Entwicklungsinstanz unter
einem eigenen Namen und bricht ab, wenn die deklarative Produktionsinstanz
bereits läuft.

## Konfiguration

Gelesen wird `kwinrc`, Gruppe `[Script-kwin-xmonad-lite]` (Produktion) bzw.
`[Script-kwin-xmonad-lite-dev]` (Entwicklungsinstanz).

| Schlüssel | Vorgabe | Bedeutung |
|---|---|---|
| `gapOuter` | `0` | Abstand zum Rand der Arbeitsfläche, `0`–`200` |
| `gapInner` | `0` | Abstand zwischen den Zellen, `0`–`200` |
| `excludes` | sieben Klassen | nicht zu kachelnde `resourceClass`-Werte, mit `,` getrennt |
| `masterRatio` | `0.65` | Anteil der Masterspalte, `0.1`–`0.9` |
| `defaultLayout` | `tall` | Startlayout neuer Surfaces: `tall` oder `full` |
| `debug` | `false` | ausführlichere Journalzeilen |

Unsinnige Werte werfen nie — sie werden geklemmt oder auf die Vorgabe
zurückgesetzt, und jede Korrektur bekommt eine Zeile im Journal.
`masterRatio` und `defaultLayout` wirken auf **neu angelegte** Surfaces und als
Ziel von `Meta+Shift+Space`; eine bestehende Surface behält ihre Anpassungen.

Die Konfiguration wird **einmal beim Laden** gelesen. Eine Änderung wird
deshalb zweistufig wirksam: in der Entwicklung
`kwriteconfig6` → `reconfigure` über D-Bus → 1 s warten → `nix run .#reload`;
in der Produktion nach `nixos-rebuild switch` erst mit der nächsten Anmeldung.
Das vollständige Verfahren steht in [`docs/keys.md`](docs/keys.md).

## Technik

- Reines KWin-Skript, `X-Plasma-API: javascript`, gebündelt mit esbuild.
- Eigene Geometrieberechnung über `frameGeometry`. Die KWin-Tile-API wird
  bewusst nicht verwendet — sie kennt keine Activity-Dimension und kann
  Monocle nicht abbilden.
- Layoutberechnung, Fensterstapel, Zustandsverwaltung, Befehls- und
  Konfigurationsschicht sind von KWin entkoppelt und ohne laufenden Compositor
  testbar (`node --test`).
- Der Controller ändert keine dauerhaften Fenstereigenschaften. Beim Entladen
  bleibt deshalb nichts zurückzurollen — ein Unload-Hook existiert im
  JavaScript-Modus nicht.

## Struktur

```
src/core/     Layoutberechnung und Fensterstapel, ohne KWin-Abhängigkeit
src/core/layout/  Tall und Full, gemeinsame Typen und Layoutliste
src/state/    Zustand je Activity × Desktop × Bildschirm, Abgleich gegen KWin
src/kwin/     Adapter: Filter, Anordnung, Geometrie, Befehle, Konfiguration
tests/        node --test bis zur Snapshot-Grenze, Hilfen unter support/
package/      KPackage-Wurzel (metadata.json, gebündeltes main.js)
dev/probe/    Zwei Proben: Skriptumgebung (probe.js) und Signale (signals.js)
scripts/      Lade-, Reload-, Journal- und Probe-Werkzeuge für `nix run`
nix/          Paket, Entwicklungsumgebung und home-module.nix
docs/         Quellenverzeichnis, Messwerte, Rohdaten und keys.md
```

## Lizenz

MIT, siehe [`LICENSE`](LICENSE).
