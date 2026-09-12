# Meilenstein 8: Grid und Activities auf HAL9000

Am 2026-09-12 bestehen zehn Geometriefälle und die Matrix 6–8 aus `PLAN.md`.
Geprüft wurde das gebaute Paket in einer echten Plasma-Wayland-Sitzung auf
HAL9000, KWin 6.7.4. Die persönliche Nutzerabnahme ist damit nicht erklärt.

## Aufbau und Prüfstand

- Branch: `feature/ms8-grid-activities`, Ausgangspunkt Meilenstein 7.2.
- Paket: `/nix/store/9qa98p3mfh5a9bsgsgll97h7nl5rgzkw-kwin-xmonad-lite-0.0.0`.
- Erfolgreicher Lauf: `kxl-ms8-20260912T131400Z-12686`.
- Ausgabe: DP-3, 1920 × 1080, Skalierung 1; unteres Panel 30 Pixel.
  Die Sollfläche 1920 × 1050 stammt aus KScreen und der Panelkonfiguration,
  unabhängig von Controller und Geometrieprobe: [Flächenquelle](area-source.txt).
- Zwei eigene Test-Activities A und B, zwei der vier vorhandenen Desktops.
  D1 ist der ursprüngliche Desktop 4, D2 der ursprüngliche Desktop 1;
  die IDs stehen in [baseline.txt](baseline.txt) und [cases.tsv](cases.tsv).
- Nur eigene KWrite-Fenster mit eindeutigem Laufpräfix. Vor dem Laden des
  Controllers wurde an jedem der drei anfänglichen Fenster eine angenommene
  Größe von 600 × 400 geprüft. Eine vorangehende unabhängige Größenprobe
  steht in [clientcheck.log](clientcheck.log).

Der Produktionscontroller erzeugt keine Activities oder Desktops. Diese
Testressourcen erzeugt und entfernt ausschließlich der [Live-Helfer](live.sh).
Der Controller wurde als Dev-Instanz geladen und vollständig entladen.

## Ergebnisse

Alle Geometriefälle des erfolgreichen Laufs bestanden beim ersten Messversuch.
Jeder Fall hat seine eigene unveränderte `.ndjson`-Datei und das zugehörige
`.journal`. Vorschriften samt Surface-IDs stehen maschinenlesbar in
[cases.tsv](cases.tsv); sie werden durch `checks.archiv-reauswertung` geprüft.

| Fall | Surface | Layout | Fenster | Ratio | Abstände außen/innen |
|---|---|---|---:|---:|---|
| grid-n3-gap0 | A/D1 | Grid | 3 | 0,65 | 0/0 |
| grid-n5-gap0 | A/D1 | Grid | 5 | 0,65 | 0/0 |
| activity-b-tall | B/D1 | Tall | 3 | 0,55 | 0/0 |
| activity-a-return | A/D1 | Grid | 5 | 0,70 | 0/0 |
| sticky-desktop | A/D2 | Tall | 1 | 0,65 | 0/0 |
| grid-n3-gap8-4 | A/D1 | Grid | 3 | 0,65 | 8/4 |
| matrix-a2-full | A/D2 | Full | 2 | 0,70 | 8/4 |
| matrix-b1-full | B/D1 | Full | 3 | 0,60 | 8/4 |
| matrix-b2-grid | B/D2 | Grid | 1 | 0,75 | 8/4 |
| after-gc-grid | A/D1 | Grid | 3 | 0,65 | 8/4 |

Vier Zustände behalten bei Rückkehr jeweils Layout, Ratio und Fensterreihenfolge.
Ein gemeinsames Fenster gehört A und B an und ist zugleich auf allen Desktops;
ein zweites Sticky-Fenster gehört nur A an. Nach Entfernen von B bleiben beide
A-Zustände und das gemeinsame Fenster erhalten. Die Ablaufschritte und
Vergleiche stehen in [live.log](live.log), die direkten Fensterabfragen in
[control.log](control.log), der GC-Auszug in [gc.log](gc.log).

Der [Journal-Auditor](auditor.out) besteht mit 58 Anordnungsläufen, davon
51 rein nutzerveranlasst, 63 Geometrieschreibvorgängen, keiner unzugeordneten
Schreiboperation und höchstens einer Wiederholung auf dasselbe Soll.
Die Grundlage ist [controller.log](controller.log). Dies ist die freie
Schleifenprüfung eines kurzen Testlaufs, keine neue Alltagsstunde.

Die Sollzellen für Grid wurden zusätzlich vorab fest ausgeschrieben:
[grid-expected.txt](grid-expected.txt). Orakel und Controller verwenden denselben
Layoutkern; der unabhängige Algorithmusnachweis liegt deshalb in den festen
Rechtecken der Unit-Tests und dieser Vorschrift, nicht allein im Orakelergebnis.

## Verworfene Vorläufe

Die drei Vorläufe bleiben mit Rohdaten erhalten und müssen im Flake-Check
weiterhin als „nicht bestanden“ bewertet werden:

| Fall | Lauf | Grund |
|---|---|---|
| vorlauf-desktopwechsel | 20260912T130230Z-7067 | Ein Lauf mit `windowActivated,desktopChanged` während der Messung |
| vorlauf-ausgabewechsel | 20260912T130547Z-9177 | Vier Läufe mit `screensChanged` und dessen Nachläufen während der Messung |
| vorlauf-client | 20260912T130841Z-11601 | KWrite nahm die Sollgrößen nicht an; begrenzte Korrekturen und korrektes Aufgeben |

Beim Client-Vorlauf entlastet das Orakel den Controller, nimmt die Geometrie
aber ausdrücklich nicht ab. Die Ursache der Größenverweigerung wurde nicht
bestimmt. Danach wurde die Eignung der Clients separat und im erfolgreichen
Lauf vor dem Controllerstart geprüft. Übergangsmessungen dürfen im Helfer
nach Wartezeit höchstens zweimal wiederholt werden; andere Fehler brechen ab.

## Rückbau

Der logische Rückbau bestand: alle eigenen Fenster und Activities entfernt,
Ausgangsmengen und aktuelle Activity-/Desktop-ID wiederhergestellt, Dev-Skript
und Probe entladen, eigene Shortcuts entfernt. [result.txt](result.txt) weist
`exit_before_cleanup=0` und `cleanup_failures=0` aus.

Vor dem ersten Lauf wurden zwölf Pfade unter `/home/muhackel` gesichert,
einschließlich ActivityManager-Verzeichnis mit SQLite/WAL/SHM, Plasma-Containments
und RecentDocuments. Die Sicherung liegt auf HAL9000 unter
`/home/muhackel/kxl-ms8-live/backup-20260912` und bleibt erhalten.
Alle zwölf Pfade waren ursprünglich vorhanden.

Der Dateirückbau ist abgeschlossen: Beide Sicherungsarchive stimmen mit den
restaurierten Pfaden überein, alle 24 enthaltenen Dateiinhalte sind
SHA-256-identisch. KWin, Plasmashell und ActivityManager waren dabei gestoppt;
das [Rückbauprotokoll](restore.log) enthält die vollständige Prüfung.

Der erste Stoppauftrag wurde abgebrochen, danach war HAL9000 vorübergehend
nicht erreichbar und wurde neu gestartet. Beim folgenden Rückbau startete
während der Abschlussprüfung erneut eine Plasma-Sitzung. Deshalb wurde der
Dateirückbau vollständig wiederholt und unmittelbar gegen Archive, Hashes und
Dienstzustände geprüft. Der letzte Auftrag endete mit Exit 0. Der Fehlerstatus
der beim Stoppen beendeten Plasmashell wurde anschließend zurückgesetzt.
SDDM- und NixOS-Konfiguration wurden nicht verändert.

## Wiederholung

`nix flake check` besteht mit 432 Tests und allen zehn Projektchecks. Es wertet
alle dreizehn Geometriebelege sowie das Journal erneut aus. Für einen einzelnen
positiven Fall, vom Projektverzeichnis aus:

```bash
nix develop -c node dev/probe/expect-geometry-cli.ts \
  docs/ms8-2026-09-12-hal9000/grid-n3-gap0.ndjson \
  docs/ms8-2026-09-12-hal9000/grid-n3-gap0.journal \
  layout=grid n=3 ratio=0.65 gaps=0/0 fläche=1920x1050+0+0 \
  'surface=88c0ac20-c3c9-40dd-8540-c9d99266ea76|eb859906-5dd5-4314-92bc-4f3cc1582e4f|DP-3'
```

Eine neue Live-Reihe braucht die vorbereitete Nix-Umgebung und Dateisicherung
aus [build.md](../../build.md). `live.sh --help` beschreibt die benötigten
Storeprogramme und das Testverzeichnis. Der Helfer ist auf den hier
dokumentierten HAL9000-Aufbau begrenzt und übernimmt keinen Dateirückbau.

## Umsetzung und Review

Implementierung und unabhängige Teilaufgaben liefen zunächst parallel über
Codex-Agenten. Der unabhängige Evaluator bewertete die Implementierung mit
PASS; er prüfte zusätzlich 100.000 erzeugte Fälle und erkannte zwölf Mutationen.
Sein anschließender automatischer Abgleich scheiterte an der Claude-Anmeldung.
Auf Nutzerauftrag wurden keine weiteren Claude-Aufrufe versucht; der Hauptagent
übernahm Live-Prüfung und Abschluss. Die lokale Philharmonie-Mission bleibt
pausiert und stellt keine automatische Nutzerabnahme dar.

Optionale Persistenz, KCM und Umverteilung bei Größenschranken sind weiterhin
Folgearbeit. Die festgelegte Grid-Stufe erfordert keinen dieser Zusatzumfänge.
