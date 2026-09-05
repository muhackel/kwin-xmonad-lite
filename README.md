# kwin-xmonad-lite

Ein schlanker Layout-Controller als KWin-Skript für Plasma 6 auf Wayland. Er
holt einen kleinen Teil des alten XMonad-Arbeitsgefühls zurück: automatisches
Kacheln mit einem Master-Bereich, ein Vollbild-Layout und Tastensteuerung für
Fokus, Reihenfolge und Master-Anteil.

Er ist **kein** Fenstermanager und **kein** XMonad-Nachbau. Fenster-, Desktop-,
Activity- und Bildschirmzuordnung bleiben vollständig bei KWin und seinen
Fensterregeln; dieses Skript ordnet nur an, was KWin ohnehin anzeigt.

> **Status: in Entwicklung, Meilenstein 3.** Das Skript kachelt: es liest die
> Fenster aus KWin, ordnet sie den Bildschirmen zu und legt sie im
> Tall-Layout aus. Noch nicht dabei sind Tastenkürzel (Meilenstein 6) — damit
> ist bis dahin auch das Vollbild-Layout nicht erreichbar —, das Umschalten
> zwischen Bildschirmen und Desktops im laufenden Betrieb (Meilenstein 4) und
> die Sonderbehandlung von Float, Vollbild und Maximierung (Meilenstein 5).
> Der vollständige Plan steht in [`PLAN.md`](PLAN.md).

## Schnellstart

```bash
nix develop            # Entwicklungsumgebung
nix flake check        # Typprüfung, Unit-Tests, Lint, Paketbau
nix run                # Skript in die laufende KWin-Sitzung laden
nix run .#logs         # KWin-Journal verfolgen
```

`nix run` lädt das gebaute Skript **direkt aus dem Nix-Store**. Es entsteht
keine Kopie unter `~/.local/share/kwin/scripts`, die später ein deklarativ
installiertes Paket überschatten würde.

## Bedienung

Die Tastenbelegung folgt der alten XMonad-Konfiguration und wird ab
Meilenstein 6 registriert; die vorgesehene Tabelle steht bis dahin in
[`PLAN.md`](PLAN.md), Abschnitt 7. Zwei der vorgesehenen Tasten kollidieren mit
KDE-Vorgaben (`Meta+L` Sitzung sperren, `Meta+T` Kachelung bearbeiten); das
Projekt ändert von sich aus **keine** fremden Tastenkürzel, die Umlegung gehört
in die Host-Konfiguration.

## Technik

- Reines KWin-Skript, `X-Plasma-API: javascript`, gebündelt mit esbuild.
- Eigene Geometrieberechnung über `frameGeometry`. Die KWin-Tile-API wird
  bewusst nicht verwendet — sie kennt keine Activity-Dimension und kann
  Monocle nicht abbilden.
- Layoutberechnung, Fensterstapel und Zustandsverwaltung sind von KWin
  entkoppelt und ohne laufenden Compositor testbar (`node --test`).
- Der Controller ändert keine dauerhaften Fenstereigenschaften. Beim Entladen
  bleibt deshalb nichts zurückzurollen — ein Unload-Hook existiert im
  JavaScript-Modus nicht.

## Struktur

```
src/core/     Layoutberechnung und Fensterstapel, ohne KWin-Abhängigkeit
src/core/layout/  Tall und Full, gemeinsame Typen und Layoutliste
src/state/    Zustand je Activity × Desktop × Bildschirm, Abgleich gegen KWin
src/kwin/     Adapter: Filter, Anordnung, Geometrie, Entprellung, Signale
package/      KPackage-Wurzel (metadata.json, gebündeltes main.js)
dev/probe/    Feature-Probe: misst die KWin-Skript-Umgebung
nix/          Paket- und Entwicklungsumgebung
docs/         Entwurfsnotizen und Quellenverzeichnis
```

## Lizenz

MIT, siehe [`LICENSE`](LICENSE).
