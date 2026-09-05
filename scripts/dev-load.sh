# nix run -- lädt das gebaute Skript direkt aus dem Nix-Store in die laufende
# KWin-Sitzung. Legt bewusst KEINE Kopie unter ~/.local/share/kwin/scripts an:
# eine solche Schattenkopie würde später das deklarativ installierte
# Store-Paket überlagern (PLAN.md Risiko 11).

MAIN_JS="${XML_MAIN_JS:?XML_MAIN_JS ist nicht gesetzt}"
DEV_NAME="${XML_DEV_NAME:-kwin-xmonad-lite-dev}"
PROD_NAME="${XML_PROD_NAME:-kwin-xmonad-lite}"

require_kwin
require_no_production "$PROD_NAME"

if [ "$(script_loaded "$DEV_NAME")" = "true" ]; then
	log_info "Entwicklungsinstanz läuft bereits, wird entladen."
	script_unload "$DEV_NAME"
	wait_unloaded "$DEV_NAME"
fi

log_info "Lade $MAIN_JS als '$DEV_NAME'."
id="$(script_load_and_run "$MAIN_JS" "$DEV_NAME")"
log_ok "Geladen als /Scripting/Script$id."
log_info "Journal ansehen mit: nix run .#logs"
