# nix run .#audit -- prüft einen Journalauszug auf Geometrie-Schleifen.
#
# Ohne Argument liest es die letzten 60 Minuten aus dem laufenden Boot und
# wertet sie als Alltagsstunde (Fall 27); mit einem Dateinamen wertet es einen
# bereits gesicherten Auszug aus.
#
# Der Auszug trägt Zeitstempel (`-o short-iso`) und enthält die Marken der
# Abnahme: `-u` und `-t` verknüpft journalctl mit UND, die Marken kämen sonst
# nicht mit durch. Das `+` ist die ODER-Verknüpfung.
#
# Aufruf:
#   nix run .#audit                       # letzte 60 min, mit Belegschwelle
#   nix run .#audit -- --seit "-30 min"   # anderer Zeitraum, ohne Schwelle
#   nix run .#audit -- datei.log          # gesicherter Auszug, mit Schwelle

AUDIT="${XML_AUDIT:?XML_AUDIT ist nicht gesetzt}"
UNIT="${XML_KWIN_UNIT:-plasma-kwin_wayland}"
MARKE="${XML_ABNAHME_TAG:-kxl-abnahme}"
OUT_DIR="${XML_PROBE_OUT:-$PWD}"

seit="-60 min"
stunde="--stunde"
datei=""

case "${1:-}" in
	--seit)
		seit="${2:?--seit braucht einen Zeitraum}"
		stunde=""
		;;
	"")
		;;
	-*)
		log_err "Unbekanntes Argument: $1"
		exit 2
		;;
	*)
		datei="$1"
		;;
esac

if [ -n "$datei" ]; then
	if [ ! -r "$datei" ]; then
		log_err "Auszug nicht lesbar: $datei"
		exit 1
	fi
	log_info "Werte $datei aus."
	node "$AUDIT" "$datei" $stunde
	exit $?
fi

require_kwin

auszug="$OUT_DIR/journal-$(date +%Y%m%d-%H%M%S).log"
journalctl --user -b -o short-iso --since "$seit" \
	"_SYSTEMD_USER_UNIT=$UNIT.service" + "SYSLOG_IDENTIFIER=$MARKE" >"$auszug" || true
log_ok "$(wc -l <"$auszug") Zeilen nach $auszug geschrieben."

node "$AUDIT" "$auszug" $stunde
