# Gemeinsame Helfer der Entwicklungsskripte.
#
# Wird von den Nix-Wrappern (writeShellApplication) vor das jeweilige Skript
# gesetzt, deshalb ohne Shebang und ohne eigenes `set` -- der Wrapper setzt
# bereits `set -o errexit -o nounset -o pipefail` und laesst shellcheck laufen.

KWIN_SERVICE="org.kde.KWin"
KWIN_SCRIPTING_IFACE="org.kde.kwin.Scripting"
KWIN_SCRIPT_IFACE="org.kde.kwin.Script"

if [ -t 1 ]; then
	C_RESET=$'\033[0m'
	C_INFO=$'\033[1;34m'
	C_OK=$'\033[1;32m'
	C_WARN=$'\033[1;33m'
	C_ERR=$'\033[1;31m'
else
	C_RESET=""
	C_INFO=""
	C_OK=""
	C_WARN=""
	C_ERR=""
fi

log_info() { printf '%s==>%s %s\n' "$C_INFO" "$C_RESET" "$*"; }
log_ok() { printf '%s  ok%s %s\n' "$C_OK" "$C_RESET" "$*"; }
log_warn() { printf '%s  !!%s %s\n' "$C_WARN" "$C_RESET" "$*" >&2; }
log_err() { printf '%s  xx%s %s\n' "$C_ERR" "$C_RESET" "$*" >&2; }

require_kwin() {
	if ! busctl --user status "$KWIN_SERVICE" >/dev/null 2>&1; then
		log_err "KWin ist ueber D-Bus nicht erreichbar ($KWIN_SERVICE)."
		log_err "Laeuft eine Plasma-Sitzung in dieser Umgebung?"
		exit 1
	fi
}

# Zwei Layout-Controller gleichzeitig waeren fatal: beide schrieben in
# derselben Sitzung Geometrien und ueberschrieben sich gegenseitig.
require_no_production() {
	local name="${1:-kwin-xmonad-lite}"
	if [ "$(script_loaded "$name")" = "true" ]; then
		log_err "Die Produktionsinstanz '$name' ist geladen."
		log_err "Erst ueber kwinrc [Plugins] ${name}Enabled=false deaktivieren,"
		log_err "sonst laufen zwei Layout-Controller gleichzeitig."
		exit 1
	fi
}

# Gibt "true" oder "false" aus.
script_loaded() {
	busctl --user call "$KWIN_SERVICE" /Scripting "$KWIN_SCRIPTING_IFACE" \
		isScriptLoaded s "$1" | awk '{ print $2 }'
}

# Gibt die Script-ID aus, -1 wenn der Plugin-Name schon belegt ist.
script_load() {
	busctl --user call "$KWIN_SERVICE" /Scripting "$KWIN_SCRIPTING_IFACE" \
		loadScript ss "$1" "$2" | awk '{ print $2 }'
}

script_run() {
	busctl --user call "$KWIN_SERVICE" "/Scripting/Script$1" "$KWIN_SCRIPT_IFACE" run
}

script_unload() {
	busctl --user call "$KWIN_SERVICE" /Scripting "$KWIN_SCRIPTING_IFACE" \
		unloadScript s "$1" >/dev/null
}

# unloadScript ruft deleteLater(); der Eintrag verschwindet erst im naechsten
# Ereignisschleifendurchlauf (KWin 6.7.4, scripting.cpp:835-845). Ein sofort
# folgendes loadScript mit demselben Plugin-Namen liefert deshalb -1.
wait_unloaded() {
	local name="$1"
	for _ in $(seq 1 50); do
		if [ "$(script_loaded "$name")" = "false" ]; then
			return 0
		fi
		sleep 0.1
	done
	log_err "Skript '$name' war nach 5 s immer noch geladen."
	return 1
}

# Laedt eine .js-Datei und startet sie. Gibt die Script-ID auf stdout aus.
script_load_and_run() {
	local path="$1" name="$2" id
	id="$(script_load "$path" "$name")"
	if [ "$id" = "-1" ]; then
		log_err "loadScript lieferte -1: Plugin-Name '$name' ist bereits geladen."
		return 1
	fi
	script_run "$id" >/dev/null
	printf '%s\n' "$id"
}
