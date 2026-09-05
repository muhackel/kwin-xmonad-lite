# nix run .#reload -- laedt ausschliesslich die Entwicklungsinstanz neu.
# Die von loadScript gelieferte ID wird ausgewertet, nicht geraten: sie ist
# scripts.size() und verschiebt sich, sobald ein anderes Skript geladen ist.

MAIN_JS="${XML_MAIN_JS:?XML_MAIN_JS ist nicht gesetzt}"
DEV_NAME="${XML_DEV_NAME:-kwin-xmonad-lite-dev}"
PROD_NAME="${XML_PROD_NAME:-kwin-xmonad-lite}"

require_kwin
require_no_production "$PROD_NAME"

if [ "$(script_loaded "$DEV_NAME")" = "true" ]; then
	log_info "Entlade '$DEV_NAME'."
	script_unload "$DEV_NAME"
	wait_unloaded "$DEV_NAME"
	log_ok "Entladen."
else
	log_warn "'$DEV_NAME' war nicht geladen, lade nur neu."
fi

id="$(script_load_and_run "$MAIN_JS" "$DEV_NAME")"
log_ok "Neu geladen als /Scripting/Script$id."
