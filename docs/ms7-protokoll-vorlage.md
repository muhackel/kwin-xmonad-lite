---
Vorlage für die Protokolle der Meilenstein-7-Abnahme. Je Fall ein Block; die
ausgefüllten Fassungen kommen nach dem Lauf als `docs/ms7-<datum>-<host>.md`
ins Repo, die Rohdaten daneben.
---

# Abnahmeprotokoll Meilenstein 7

## Reihenkopf

| Feld | Wert |
|---|---|
| Datum | |
| Projekt-Commit | |
| Host-Pin `nixosconfig` | |
| Host-Pin `kwin-xmonad-lite` | |
| Host | HAL9000 / SPIELKISTE |
| Instanz | Produktion (Store) / Entwicklung (`nix run`) |
| Startgeneration (nur HAL9000) | |
| Sicherungen angelegt | `kwinrc`, `kglobalshortcutsrc` — ja/nein |
| Outputs, Desktops, Activities | |

Die Reihe 24–24e lief gegen den Pin `8f287d9`. Aus ihren Ergebnissen wird
**keine** Aussage über diesen Stand abgeleitet.

## Fallblock

Für jeden Fall vollständig ausfüllen. Fehlt eine Zeile im Kopf, gilt der Fall
als **nicht belegt** — auch wenn die Beobachtung stimmte.

```
Fall:            <25 | 25a | 25b | 25c | 20b | 16 | 16b | 16c | 17a | 17b | 26 | 26a | 26b | 26c | 27>
Projekt-Commit:  <sha>
Host-Pin:        nixosconfig <sha>, kwin-xmonad-lite <sha>
Host:            <HAL9000 | SPIELKISTE>
Boot-ID:         <journalctl --list-boots>
KWin-PID:        <kwin_wayland[<pid>]>
Skriptlauf:      <Zeitstempel der "geladen"-Zeile dieser Instanz>
Instanz:         <Produktion | Entwicklung>
Fall-Anfang:     <iso, Markerzeile kxl-abnahme>
Fall-Ende:       <iso, Markerzeile kxl-abnahme>
Artefakt:        <docs/…>
Ergebnis:        <bestanden | nicht bestanden | nicht durchführbar>
```

**Vorbereitung:**

**Aktion:**

**Beobachtung:** (was tatsächlich geschah, einschließlich dessen, was der
Controller *nicht* erzwungen hat)

**Belege:** (Journalzeilen, Orakel-/Auditorbericht, Konfigurationsauszüge;
Screenshots nur ergänzend)

**Beleggrenzen:** (was das Artefakt aus sich heraus *nicht* zeigt — etwa die
Herkunft einer Auslösung oder die Abwesenheit einer Zeile ohne Marken)

**Abweichungen von der Vorschrift:**

## Marken setzen

```bash
systemd-cat -t kxl-abnahme echo "== Fall <n> Anfang =="
# ... Fall ausführen ...
systemd-cat -t kxl-abnahme echo "== Fall <n> Ende =="
```

## Auszug ziehen

```bash
journalctl --user -b -o short-iso --since "<iso>" --until "<iso>" \
  _SYSTEMD_USER_UNIT=plasma-kwin_wayland.service + SYSLOG_IDENTIFIER=kxl-abnahme \
  > docs/ms7-<datum>-<host>.log
```

Das `+` ist die ODER-Verknüpfung: `-u` und `-t` allein würde journalctl mit UND
verbinden und die Marken herausfiltern. Der Auszug enthält damit auch die
Zeilen von `kwin_wayland_wrapper`, die Fall 17a braucht.

## Rückbau (nur HAL9000)

| Schritt | Erledigt | Nachweis |
|---|---|---|
| Autologin abgeschaltet, solange die Testkonfiguration aktiv war | | |
| Auf Startgeneration zurückgeschaltet | | `readlink /nix/var/nix/profiles/system` |
| Testgenerationen gelöscht, Booteinträge nachgezogen | | `nix-env --list-generations` |
| Patches im `nixosconfig`-Baum zurückgenommen | | `git status --porcelain` leer |
| Neu gestartet, **ohne** Anmeldung | | |
| `kwinrc` und `kglobalshortcutsrc` zurückgespielt | | `diff` gegen die `.bak` leer |
| Danach angemeldet | | |

Geprüft wird gegen die **gesicherte Ausgangslage**, nicht gegen Werte aus
früheren Protokollen. Die Wiederherstellung muss vor der ersten Anmeldung
laufen: plasma-manager schreibt beide Dateien imperativ aus einem
Aktivierungsskript, und `kglobalaccel` schreibt seinen Stand beim Sitzungsende
zurück.
