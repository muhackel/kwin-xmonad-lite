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
`kpackagetool6`, `qdbus` und `kwriteconfig6`.

## Bauen & Starten

### Paket bauen

```bash
nix build
find result/ -type f
# result/share/kwin/scripts/kwin-xmonad-lite/{metadata.json,LICENSE,README.md,contents/code/main.js}
```

### In die laufende Sitzung laden

```bash
nix run              # = nix run .#dev-load
nix run .#reload     # nach einer Änderung
nix run .#logs       # Journal verfolgen, -a für ungefiltert
```

`dev-load` bricht ab, wenn die deklarativ aktivierte Produktionsinstanz geladen
ist — zwei Layout-Controller gleichzeitig wären fatal.

### Feature-Probe

```bash
nix run .#probe                # rein lesend
nix run .#probe -- --shortcuts # zusätzlich die Shortcut-Phase
```

Die Probe misst die KWin-Skript-Umgebung (ES-Sprachniveau, Globals, Enums,
Laufzeit-Oberflächen, QTimer-Verhalten), schreibt das Ergebnis als
`probe-<Zeitstempel>.ndjson` ins Arbeitsverzeichnis und räumt anschließend
restlos auf. Der Rückbau wird im selben Lauf nachgewiesen.

## Testen / Checks

```bash
nix flake check      # Paketbau (inkl. Typprüfung und Unit-Tests), Lint, Skripte
```

Einzeln in der Entwicklungsumgebung:

```bash
tsc --noEmit                 # Typprüfung
node --test tests/*.test.ts  # Unit-Tests, nativ mit Type-Stripping
biome check .                # Lint und Format
```

Getestet werden `src/core/`, `src/state/` und der überwiegende Teil von
`src/kwin/`. Der Adapter ist an der **Snapshot-Grenze** geteilt: er liest die
KWin-Objekte einmal je Durchlauf in schlichte Datensätze aus, und alles, was
danach kommt — Fensterfilter, Surface-Zuordnung, die vollständige Anordnung,
die Geometrieklemmung und der Nachbesserungswächter —, ist reine Rechnung und
läuft unter `node --test`.

Nur `src/kwin/read.ts` und `src/kwin/adapter.ts` fassen eine KWin-Global an;
diese beiden werden auf der Maschine geprüft, nicht im Unit-Test. Die Grenze
ist nachprüfbar:

```bash
grep -n 'workspace\.\|KWin\.\|new QTimer' src/kwin/*.ts \
  | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)'
# darf nur Zeilen aus read.ts und adapter.ts zeigen
```

Der zweite `grep` wirft Kommentarzeilen weg — `types.ts` und `timer.ts`
erwähnen die Globals in ihren Erklärungen, ohne sie zu benutzen.

`node --test tests/` funktioniert **nicht**: Node deutet das Verzeichnis als
Modulpfad. Immer die Dateien angeben. Aus demselben Grund liegen die
Testhilfen unter `tests/support/` — dort sammelt das Glob sie nicht ein.

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
