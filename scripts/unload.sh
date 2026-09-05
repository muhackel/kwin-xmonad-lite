# nix run .#unload -- entlädt ausschließlich die Entwicklungsinstanz.

DEV_NAME="${XML_DEV_NAME:-kwin-xmonad-lite-dev}"

require_kwin

if [ "$(script_loaded "$DEV_NAME")" = "false" ]; then
	log_warn "'$DEV_NAME' ist nicht geladen."
	exit 0
fi

log_info "Entlade '$DEV_NAME'."
script_unload "$DEV_NAME"
wait_unloaded "$DEV_NAME"
log_ok "Entladen; isScriptLoaded=false."
