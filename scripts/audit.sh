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
#   nix run .#audit                          # letzte 60 min, mit Belegschwelle
#   nix run .#audit -- --seit "-30 min"      # anderer Zeitraum, ohne Schwelle
#   nix run .#audit -- datei.log             # gesicherter Auszug, mit Schwelle
#   nix run .#audit -- --frei datei.log      # gesicherter Auszug, ohne Schwelle
#   nix run .#audit -- --provoziert '{id}' datei.log   # erwartetes Give-up
#
# Die Belegschwelle gehört zu Fall 27 (mindestens 60 Minuten in einem einzigen
# Skriptlauf, dazu die Mindestaktivität). Ein gesicherter Auszug, der einen
# anderen Fall belegt, ist damit regelmäßig kürzer und enthält mehrere
# Skriptläufe -- für ihn ist `--frei` richtig, sonst meldet der Auditor "nicht
# ausreichend belegt", obwohl nur die falsche Messlatte angelegt wurde.
#
# `--seit` gilt nur für den laufenden Auszug: dort wählt es den Zeitraum und
# nimmt zwangsläufig die Stundenschwelle mit weg. Zusammen mit einer Datei wäre
# es ein stilles Abschalten der Schwelle an einer Stelle, an der niemand danach
# sucht -- deshalb ein Fehler. Wer eine Datei ohne Schwelle prüfen will, sagt
# `--frei`.

AUDIT="${XML_AUDIT:?XML_AUDIT ist nicht gesetzt}"
UNIT="${XML_KWIN_UNIT:-plasma-kwin_wayland}"
MARKE="${XML_ABNAHME_TAG:-kxl-abnahme}"
OUT_DIR="${XML_PROBE_OUT:-$PWD}"

seit="-60 min"
stunde="--stunde"
datei=""
seit_gesetzt=0
provoziert=()

while [ "$#" -gt 0 ]; do
	case "$1" in
		--seit)
			seit="${2:?--seit braucht einen Zeitraum}"
			stunde=""
			seit_gesetzt=1
			shift 2
			;;
		--frei)
			stunde=""
			shift
			;;
		--provoziert)
			provoziert=("--provoziert" "${2:?--provoziert braucht eine Id-Liste}")
			shift 2
			;;
		-*)
			log_err "Unbekanntes Argument: $1"
			log_err "Aufruf: nix run .#audit [-- [--frei] [--seit <zeitraum>] [datei.log]]"
			exit 2
			;;
		*)
			if [ -n "$datei" ]; then
				log_err "Mehr als ein Auszug angegeben: $datei und $1"
				exit 2
			fi
			datei="$1"
			shift
			;;
	esac
done

if [ -n "$datei" ] && [ "$seit_gesetzt" -eq 1 ]; then
	log_err "--seit gilt nur für den laufenden Auszug, nicht für eine Datei: $datei"
	log_err "Für einen gesicherten Auszug ohne Belegschwelle: --frei"
	exit 2
fi

if [ -n "$datei" ]; then
	if [ ! -r "$datei" ]; then
		log_err "Auszug nicht lesbar: $datei"
		exit 1
	fi
	log_info "Werte $datei aus."
	node "$AUDIT" "$datei" $stunde ${provoziert[0]+"${provoziert[@]}"}
	exit $?
fi

require_kwin

auszug="$OUT_DIR/journal-$(date +%Y%m%d-%H%M%S).log"
journalctl --user -b -o short-iso --since "$seit" \
	"_SYSTEMD_USER_UNIT=$UNIT.service" + "SYSLOG_IDENTIFIER=$MARKE" >"$auszug" || true
log_ok "$(wc -l <"$auszug") Zeilen nach $auszug geschrieben."

node "$AUDIT" "$auszug" $stunde ${provoziert[0]+"${provoziert[@]}"}
