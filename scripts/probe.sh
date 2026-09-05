# nix run .#probe -- laedt die Feature-Probe einmalig in die laufende
# KWin-Sitzung, wertet das Journal aus und raeumt restlos auf.
#
# Die Probe ist strikt lesend: keine Geometrie-Writes, kein raiseWindow, kein
# Zugriff auf rootTile, und sie verbindet kein einziges KWin-Signal (es gibt
# keinen Unload-Hook, eine ueberlebende Verbindung wuerde spaeter in eine
# zerstoerte Engine feuern). Nur eigene QTimer, die vor dem Abschlusssatz
# gestoppt werden.
#
# Mit --shortcuts laeuft zusaetzlich die Shortcut-Phase. Die hat eine
# Nebenwirkung: registerShortcut ruft KGlobalAccel::setShortcut ohne
# NoAutoloading, der Eintrag in kglobalshortcutsrc ueberlebt das Entladen.
# Dieses Skript baut ihn danach ueber KGlobalAccel.unregister wieder ab und
# prueft das nach.

PROBE_JS="${XML_PROBE_JS:?XML_PROBE_JS ist nicht gesetzt}"
PROBE_NAME="${XML_PROBE_NAME:-kwin-xmonad-lite-probe}"
OUT_DIR="${XML_PROBE_OUT:-$PWD}"
CONF_GROUP="Script-$PROBE_NAME"
SHORTCUT_ACTIONS="kxlprobe-a kxlprobe-b"

want_shortcuts=false
if [ "${1:-}" = "--shortcuts" ]; then
	want_shortcuts=true
fi

require_kwin

# --- Vorbedingungen ---------------------------------------------------------

if [ "$(script_loaded "$PROBE_NAME")" = "true" ]; then
	log_warn "Probe war noch geladen, entlade zuerst."
	script_unload "$PROBE_NAME"
	wait_unloaded "$PROBE_NAME"
fi

shortcuts_before="$(mktemp)"
cp ~/.config/kglobalshortcutsrc "$shortcuts_before" 2>/dev/null || : >"$shortcuts_before"

# --- Konfigurationswerte fuer die cfg-Phase ---------------------------------

log_info "Setze Testwerte in kwinrc [$CONF_GROUP]."
kwriteconfig6 --file kwinrc --group "$CONF_GROUP" --key probeStr "aus-kwinrc"
kwriteconfig6 --file kwinrc --group "$CONF_GROUP" --key probeInt 7
kwriteconfig6 --file kwinrc --group "$CONF_GROUP" --key probeBool true
kwriteconfig6 --file kwinrc --group "$CONF_GROUP" --key probeList "a,b,c"
kwriteconfig6 --file kwinrc --group "$CONF_GROUP" --key probeShortcuts "$want_shortcuts"

# readConfig liest kwinApp()->config()->group("Script-<name>"). Die Datei muss
# vorher neu eingelesen werden, und Workspace::reconfigure() startet dafuer nur
# reconfigureTimer.start(200) (KWin 6.7.4, workspace.cpp:1000) -- der Reparse
# passiert also erst 200 ms spaeter. Ohne diese Wartezeit liefert readConfig
# ausschliesslich die Vorgabewerte.
busctl --user call "$KWIN_SERVICE" /KWin org.kde.KWin reconfigure
sleep 1

# --- Laden und ausloesen ----------------------------------------------------

t0="$(date +%s)"
log_info "Lade Probe: $PROBE_JS"
id="$(script_load_and_run "$PROBE_JS" "$PROBE_NAME")"
log_ok "Gestartet als /Scripting/Script$id."

log_info "Warte auf den Abschlusssatz (max. 30 s)."
if timeout 30 journalctl --user -u plasma-kwin_wayland --since "@$t0" -o cat -f \
	| grep -q -m1 '"k":"end"'; then
	log_ok "Abschlusssatz erhalten."
else
	log_warn "Kein Abschlusssatz binnen 30 s -- Lauf gilt als unvollstaendig."
fi

# --- Auswerten --------------------------------------------------------------

result="$OUT_DIR/probe-$(date +%Y%m%d-%H%M%S).ndjson"
journalctl --user -u plasma-kwin_wayland --since "@$t0" -o cat \
	| grep -o 'KXLPROBE1 {.*}' | cut -d' ' -f2- | awk '!seen[$0]++' >"$result" || true

lines="$(wc -l <"$result")"
if [ "$lines" -eq 0 ]; then
	log_err "Keine einzige Probe-Zeile im Journal."
	log_err "Wahrscheinlich ein Parsefehler; KWin meldet ihn als Dateiname:Zeile:"
	journalctl --user -u plasma-kwin_wayland --since "@$t0" -o cat | grep -i 'probe.js' | head -5 || true
else
	log_ok "$lines Saetze nach $result geschrieben."
	log_info "Kurzauswertung:"
	grep -o '"k":"[a-z-]*"' "$result" | sort | uniq -c | sort -rn | sed 's/^/    /'
	log_info "Ermitteltes ES-Target:"
	grep '"k":"es-summary"' "$result" | sed 's/^/    /' || log_warn "kein es-summary-Satz"
	log_info "Nicht unterstuetzte Sprachkonstrukte:"
	grep '"st":"syntax"' "$result" | grep -o '"id":"[^"]*"' | sed 's/^/    /' || log_ok "keine"
fi

# --- Rueckbau ---------------------------------------------------------------

log_info "Entlade Probe."
script_unload "$PROBE_NAME"
wait_unloaded "$PROBE_NAME"

log_info "Entferne die Testwerte aus kwinrc."
for key in probeStr probeInt probeBool probeList probeShortcuts; do
	kwriteconfig6 --file kwinrc --group "$CONF_GROUP" --key "$key" --delete
done
busctl --user call "$KWIN_SERVICE" /KWin org.kde.KWin reconfigure

if [ "$want_shortcuts" = "true" ]; then
	log_info "Baue die Probe-Shortcuts ab."
	for action in $SHORTCUT_ACTIONS; do
		busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel \
			unregister ss kwin "$action" >/dev/null 2>&1 || log_warn "unregister $action fehlgeschlagen"
	done
	sleep 5 # scheduleWriteSettings ist entprellt
fi

# --- Nachweis ---------------------------------------------------------------

log_info "Nachweis des Rueckbaus:"
printf '    isScriptLoaded  %s\n' "$(script_loaded "$PROBE_NAME")"
if grep -q "\[$CONF_GROUP\]" ~/.config/kwinrc 2>/dev/null; then
	log_warn "    kwinrc enthaelt noch die leere Gruppe [$CONF_GROUP] -- unschaedlich, von Hand entfernbar"
else
	printf '    kwinrc-Gruppe   entfernt\n'
fi
if grep -q 'kxlprobe' ~/.config/kglobalshortcutsrc 2>/dev/null; then
	log_err "    kglobalshortcutsrc enthaelt noch kxlprobe-Zeilen:"
	grep -n 'kxlprobe' ~/.config/kglobalshortcutsrc | sed 's/^/      /'
else
	printf '    kglobalshortcutsrc  keine kxlprobe-Zeilen\n'
fi
if diff -q "$shortcuts_before" ~/.config/kglobalshortcutsrc >/dev/null 2>&1; then
	printf '    kglobalshortcutsrc  unveraendert gegenueber dem Stand vor dem Lauf\n'
else
	log_warn "    kglobalshortcutsrc weicht vom Stand vor dem Lauf ab:"
	diff "$shortcuts_before" ~/.config/kglobalshortcutsrc | head -20 | sed 's/^/      /' || true
fi
rm -f "$shortcuts_before"
