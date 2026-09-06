# nix run .#logs -- folgt dem KWin-Journal.
# Ohne Argument gefiltert auf Ausgaben dieses Projekts, mit -a alles.

require_kwin

if [ "${1:-}" = "-a" ]; then
	log_info "Folge dem vollständigen KWin-Journal (Abbruch mit Strg+C)."
	exec journalctl --user -u plasma-kwin_wayland -f
fi

log_info "Folge dem KWin-Journal, gefiltert auf kwin-xmonad-lite und KXLPROBE/KXLSIG/KXLGEO (-a für alles)."
exec journalctl --user -u plasma-kwin_wayland -f -o cat --grep 'kwin-xmonad-lite|KXLPROBE|KXLSIG|KXLGEO'
