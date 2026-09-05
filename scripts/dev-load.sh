# nix run -- lädt das gebaute Skript direkt aus dem Nix-Store in die laufende
# KWin-Sitzung. Legt bewusst KEINE Kopie unter ~/.local/share/kwin/scripts an:
# eine solche Schattenkopie würde später das deklarativ installierte
# Store-Paket überlagern (PLAN.md Risiko 11).

MAIN_JS="${XML_MAIN_JS:?XML_MAIN_JS ist nicht gesetzt}"
DEV_MENU_JS="${XML_DEV_MENU_JS:?XML_DEV_MENU_JS ist nicht gesetzt}"
DEV_NAME="${XML_DEV_NAME:-kwin-xmonad-lite-dev}"
PROD_NAME="${XML_PROD_NAME:-kwin-xmonad-lite}"
SCRIPT_JS="$MAIN_JS"
MODE="ohne Fenstermenü"

case "${1:-}" in
	"") ;;
	--menu)
		SCRIPT_JS="$DEV_MENU_JS"
		MODE="mit Fenstermenü"
		shift
		;;
	*)
		log_err "Unbekannte Option: $1"
		log_err "Aufruf: nix run -- [--menu]"
		exit 2
		;;
esac
if [ "$#" -ne 0 ]; then
	log_err "Zu viele Argumente. Aufruf: nix run -- [--menu]"
	exit 2
fi

require_kwin
require_no_production "$PROD_NAME"

if [ "$(script_loaded "$DEV_NAME")" = "true" ]; then
	log_info "Entwicklungsinstanz läuft bereits, wird entladen."
	script_unload "$DEV_NAME"
	wait_unloaded "$DEV_NAME"
fi

log_info "Lade $SCRIPT_JS als '$DEV_NAME' $MODE."
id="$(script_load_and_run "$SCRIPT_JS" "$DEV_NAME")"
log_ok "Geladen als /Scripting/Script$id ($MODE)."
log_info "Journal ansehen mit: nix run .#logs"
