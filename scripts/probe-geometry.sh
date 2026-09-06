# nix run .#probe-geometry -- misst die anliegenden Fenstergeometrien einmalig
# aus dem KWin-Skriptkontext, schreibt sie als NDJSON und wertet sie mit dem
# Orakel aus.
#
# Die Probe ist strikt lesend: keine Geometrie-Writes, kein raiseWindow, kein
# Setzen von activeWindow, kein Zugriff auf rootTile und keine Verbindung zu
# einem KWin-Signal. Verbunden wird nur `timeout` eigener QTimer -- ohne das
# gäbe es keine zeitversetzten Samples. `checks.probe-readonly` erzwingt das.
#
# Anders als probe.sh und probe-signals.sh greift dieses Werkzeug **nicht** in
# die Konfiguration ein: es schreibt keine kwinrc-Schlüssel und registriert
# keine Shortcuts. Zurückzubauen ist deshalb nur das geladene Skript selbst.
#
# Aufruf:
#   nix run .#probe-geometry
#   nix run .#probe-geometry -- --erwarte layout=tall n=3 ratio=0.65 gaps=0/0
#
# Ohne --erwarte prüft das Orakel nur Datenqualität und die modellfreien
# Invarianten; mit --erwarte zusätzlich Journal und Geometrie gegen die
# vorgegebenen Werte. Die Erwartung kommt aus der Fallvorschrift, nie aus dem
# geprüften Controller.

PROBE_JS="${XML_GEOMETRY_JS:?XML_GEOMETRY_JS ist nicht gesetzt}"
EXPECT_JS="${XML_GEOMETRY_EXPECT:?XML_GEOMETRY_EXPECT ist nicht gesetzt}"
PROBE_NAME="${XML_GEOMETRY_NAME:-kwin-xmonad-lite-geometry}"
OUT_DIR="${XML_PROBE_OUT:-$PWD}"
UNIT="${XML_KWIN_UNIT:-plasma-kwin_wayland}"

expectation=()
if [ "${1:-}" = "--erwarte" ]; then
	shift
	expectation=("$@")
elif [ "$#" -gt 0 ]; then
	log_err "Unbekanntes Argument: $1"
	log_err "Aufruf: nix run .#probe-geometry [-- --erwarte layout=tall n=3 ratio=0.65 gaps=0/0]"
	exit 2
fi

require_kwin

if [ "$(script_loaded "$PROBE_NAME")" = "true" ]; then
	log_warn "Probe war noch geladen, entlade zuerst."
	script_unload "$PROBE_NAME"
	wait_unloaded "$PROBE_NAME"
fi

# --- Laden und messen -------------------------------------------------------

t0="$(date +%s)"
log_info "Lade Geometrie-Probe: $PROBE_JS"
id="$(script_load_and_run "$PROBE_JS" "$PROBE_NAME")"
log_ok "Gestartet als /Scripting/Script$id."

# Gepollt statt `journalctl -f | grep -q -m1`: dort beendet sich `grep` beim
# ersten Treffer, `journalctl` bekommt SIGPIPE, und mit `pipefail` meldet die
# Bedingung genau dann einen Fehlschlag, wenn der Satz da war.
log_info "Warte auf den Abschlusssatz (max. 30 s; die Samplestaffel läuft 3 s)."
ende_gesehen=0
for _ in $(seq 1 30); do
	if journalctl --user -u "$UNIT" --since "@$t0" -o cat \
		| grep '"k":"end"' >/dev/null; then
		ende_gesehen=1
		break
	fi
	sleep 1
done
if [ "$ende_gesehen" -eq 1 ]; then
	log_ok "Abschlusssatz erhalten."
else
	log_warn "Kein Abschlusssatz binnen 30 s -- Lauf gilt als unvollständig."
fi

# --- Rohdaten sichern -------------------------------------------------------

stamp="$(date +%Y%m%d-%H%M%S)"
result="$OUT_DIR/geometry-$stamp.ndjson"
journalctl --user -u "$UNIT" --since "@$t0" -o cat \
	| grep -o 'KXLGEO1 {.*}' | cut -d' ' -f2- | awk '!seen[$0]++' >"$result" || true

lines="$(wc -l <"$result")"
if [ "$lines" -eq 0 ]; then
	log_err "Keine einzige Probe-Zeile im Journal."
	log_err "Wahrscheinlich ein Parsefehler; KWin meldet ihn als Dateiname:Zeile:"
	journalctl --user -u "$UNIT" --since "@$t0" -o cat | grep -i 'geometry.js' | head -5 || true
else
	log_ok "$lines Sätze nach $result geschrieben."
fi

# Der Controller-Journalauszug ist die zweite Quelle des Orakels. Er reicht
# absichtlich weiter zurück als die Probe: die `config`-Zeile steht beim
# Skriptstart und liegt regelmäßig außerhalb des Probenzeitfensters.
journal="$OUT_DIR/geometry-$stamp.journal"
# An die KWin-Instanz gebunden: nach einem `replace` schreiben zwei Prozesse in
# dieselbe Unit, und der Auszug reicht bootweit zurueck. Ohne die Bindung
# koennte er Zeilen einer Instanz enthalten, die es nicht mehr gibt.
kwin_pid="$(busctl --user call org.freedesktop.DBus /org/freedesktop/DBus \
	org.freedesktop.DBus GetConnectionUnixProcessID s org.kde.KWin 2>/dev/null \
	| awk '{ print $2 }')"
journalctl --user -b _SYSTEMD_USER_UNIT="$UNIT.service" _PID="$kwin_pid" -o short-iso \
	| grep 'kwin-xmonad-lite:' >"$journal" || true
log_ok "$(wc -l <"$journal") Controllerzeilen nach $journal geschrieben."

# --- Rückbau ---------------------------------------------------------------

log_info "Entlade Probe."
script_unload "$PROBE_NAME"
wait_unloaded "$PROBE_NAME"
printf '    isScriptLoaded  %s\n' "$(script_loaded "$PROBE_NAME")"
if grep -q "\[Script-$PROBE_NAME\]" ~/.config/kwinrc 2>/dev/null; then
	log_warn "    kwinrc enthält eine Gruppe [Script-$PROBE_NAME] -- diese Probe legt keine an"
else
	printf '    kwinrc          keine Gruppe der Probe\n'
fi

# --- Auswerten --------------------------------------------------------------

log_info "Werte aus."
node "$EXPECT_JS" "$result" "$journal" --kwin-pid "$kwin_pid" "${expectation[@]+"${expectation[@]}"}"
