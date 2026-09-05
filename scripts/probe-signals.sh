# nix run .#probe-signals -- misst, welche KWin-Signale im Skriptkontext
# ankommen und was sie tragen. Grundlage fuer Meilenstein 4.
#
# Anders als die Feature-Probe verbindet diese Probe echte KWin-Signale. Sie
# trennt vor ihrem Abschlusssatz saemtliche Verbindungen und stoppt alle
# eigenen Timer und meldet beides im "end"-Satz; dieses Skript entlaedt danach
# und weist nach, dass nach dem Entladen keine weitere Zeile mehr kommt.
#
# Die Phasentabelle unten muss zu DURATION_MS in dev/probe/signals.js passen:
# Summe der Phasen < Laufzeit der Probe.
#
# Mit --hotplug <Ausgabe> schaltet das Skript die genannte Ausgabe in Phase 6
# selbst ab und wieder an (kscreen-doctor). Ohne das Argument fuehrt es nur
# durch den Handgriff.
#
# Zwei Phasen greifen selbst ein, weil sich `desktopsChanged` und
# `activitiesChanged` nur beim Anlegen und Entfernen zeigen -- ein blosser
# Wechsel loest sie nicht aus. Beide Eingriffe sind vollstaendig reversibel:
# der angelegte Desktop und die angelegte Activity werden im selben Lauf
# wieder entfernt, und das Skript prueft die Zahlen davor und danach.

PROBE_JS="${XML_SIGNALS_JS:?XML_SIGNALS_JS ist nicht gesetzt}"
PROBE_NAME="${XML_SIGNALS_NAME:-kwin-xmonad-lite-signals}"
OUT_DIR="${XML_PROBE_OUT:-$PWD}"

hotplug_output=""
if [ "${1:-}" = "--hotplug" ]; then
	hotplug_output="${2:?--hotplug braucht einen Ausgabenamen, etwa DP-9}"
fi

require_kwin

if [ "$(script_loaded kwin-xmonad-lite)" = "true" ]; then
	log_warn "Der Layout-Controller ist geladen. Seine arrange-Zeilen laufen"
	log_warn "im selben Journal, stoeren die Messung aber nicht (eigener Tag)."
fi

if [ "$(script_loaded "$PROBE_NAME")" = "true" ]; then
	log_warn "Probe war noch geladen, entlade zuerst."
	script_unload "$PROBE_NAME"
	wait_unloaded "$PROBE_NAME"
fi

# --- Laden ------------------------------------------------------------------

t0="$(date +%s)"
log_info "Lade Signalprobe: $PROBE_JS"
id="$(script_load_and_run "$PROBE_JS" "$PROBE_NAME")"
log_ok "Gestartet als /Scripting/Script$id."

# --- Phasen -----------------------------------------------------------------

VDM_PATH=/VirtualDesktopManager
VDM_IFACE=org.kde.KWin.VirtualDesktopManager
ACT_SERVICE=org.kde.ActivityManager
ACT_PATH=/ActivityManager/Activities
ACT_IFACE=org.kde.ActivityManager.Activities

dbus_str() {
	# busctl gibt Zeichenketten als `s "wert"` aus.
	awk '{ print $2 }' | tr -d '"'
}

desktop_count() {
	busctl --user get-property "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" count \
		| awk '{ print $2 }'
}

# Nur die UUIDs aus der `a(iss)`-Eigenschaft. Ueber den Namen zu gehen waere
# fragil: Desktopnamen duerfen Leerzeichen enthalten.
desktop_ids() {
	busctl --user get-property "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" desktops \
		| grep -oE '"[0-9a-f-]{36}"' | tr -d '"' | sort
}

log_info "Phase 1 (20 s): Wechsle jetzt mehrfach den virtuellen Desktop."
sleep 20

log_info "Phase 2 (25 s): Aendere jetzt die Panelhoehe und LASS SIE STEHEN."
log_info "               (Rechtsklick auf das Panel, Anzeigeeinstellungen, Hoehe)"
sleep 25

log_info "Phase 3 (15 s): Setze die Panelhoehe wieder zurueck."
sleep 15

log_info "Phase 4 (20 s): Lege einen virtuellen Desktop an und entferne ihn wieder."
vd_before="$(desktop_count)"
ids_before="$(desktop_ids)"
busctl --user call "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" createDesktop us "$vd_before" kxl-probe \
	>/dev/null || log_warn "createDesktop fehlgeschlagen"
sleep 8
vd_new="$(comm -13 <(printf '%s\n' "$ids_before") <(desktop_ids) | head -1)"
if [ -n "$vd_new" ]; then
	busctl --user call "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" removeDesktop s "$vd_new" \
		>/dev/null || log_warn "removeDesktop fehlgeschlagen"
else
	log_warn "Angelegten Desktop nicht wiedergefunden -- bitte von Hand pruefen."
fi
sleep 8
vd_after="$(desktop_count)"
if [ "$vd_before" = "$vd_after" ]; then
	log_ok "Desktopzahl wieder bei $vd_after."
else
	log_err "Desktopzahl vorher $vd_before, nachher $vd_after -- bitte nachsehen."
fi

log_info "Phase 5 (25 s): Lege eine Activity an, wechsle hin und zurueck, entferne sie."
log_warn "               Waehrend des Wechsels sind kurz keine Fenster zu sehen."
act_before="$(busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" CurrentActivity | dbus_str)"
act_new="$(busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" AddActivity s kxl-probe | dbus_str)"
if [ -n "$act_new" ]; then
	sleep 6
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" SetCurrentActivity s "$act_new" >/dev/null || true
	sleep 6
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" SetCurrentActivity s "$act_before" >/dev/null || true
	sleep 6
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" RemoveActivity s "$act_new" >/dev/null \
		|| log_warn "RemoveActivity fehlgeschlagen -- Activity kxl-probe bitte von Hand entfernen."
	sleep 7
else
	log_warn "AddActivity fehlgeschlagen, Phase 5 uebersprungen."
	sleep 25
fi

if [ -n "$hotplug_output" ]; then
	log_info "Phase 6 (40 s): Schalte $hotplug_output ab und wieder an."
	kscreen-doctor "output.$hotplug_output.disable" || log_warn "disable fehlgeschlagen"
	sleep 15
	kscreen-doctor "output.$hotplug_output.enable" || log_warn "enable fehlgeschlagen"
	sleep 25
else
	log_info "Phase 6 (40 s): Stecke jetzt einen Bildschirm ab und wieder an,"
	log_info "               oder in einem zweiten Terminal:"
	log_info "               kscreen-doctor output.DP-9.disable && sleep 10 && kscreen-doctor output.DP-9.enable"
	sleep 40
fi

# --- Abschlusssatz ----------------------------------------------------------

log_info "Warte auf den Abschlusssatz (max. 60 s)."
if timeout 60 journalctl --user -u plasma-kwin_wayland --since "@$t0" -o cat -f \
	| grep -q -m1 '"k":"end"'; then
	log_ok "Abschlusssatz erhalten."
else
	log_warn "Kein Abschlusssatz -- die Probe raeumt dann nicht selbst ab."
fi

# --- Auswerten --------------------------------------------------------------

result="$OUT_DIR/signals-$(date +%Y%m%d-%H%M%S).ndjson"
journalctl --user -u plasma-kwin_wayland --since "@$t0" -o cat \
	| grep -o 'KXLSIG1 {.*}' | cut -d' ' -f2- | awk '!seen[$0]++' >"$result" || true

lines="$(wc -l <"$result")"
if [ "$lines" -eq 0 ]; then
	log_err "Keine einzige Probe-Zeile im Journal."
	log_err "Wahrscheinlich ein Parsefehler; KWin meldet ihn als Dateiname:Zeile:"
	journalctl --user -u plasma-kwin_wayland --since "@$t0" -o cat | grep -i 'signals.js' | head -5 || true
else
	log_ok "$lines Saetze nach $result geschrieben."

	log_info "Nicht verbundene Signale:"
	grep '"k":"wire"' "$result" | grep -v '"st":"ok"' | sed 's/^/    /' || log_ok "keine"

	log_info "Beobachtete Signalsignaturen (Signal, Argumentzahl, Anzahl):"
	grep '"k":"sig"' "$result" \
		| grep -o '"id":"[^"]*","argc":[0-9]*' \
		| sort | uniq -c | sort -rn | sed 's/^/    /'

	log_info "Argumente je Signal, erstes Vorkommen:"
	grep '"k":"sig"' "$result" | awk '
		match($0, /"id":"[^"]*"/) {
			key = substr($0, RSTART + 6, RLENGTH - 7)
			if (!(key in seen)) { seen[key] = 1; print "    " key "  " $0 }
		}' | cut -c1-200

	log_info "Arbeitsflaeche rund um Dock-Ereignisse:"
	grep '"k":"area"' "$result" | sed 's/^/    /' | cut -c1-200 || log_ok "keine Dock-Ereignisse"

	log_info "Abschlusssatz:"
	grep '"k":"end"' "$result" | sed 's/^/    /' || log_warn "fehlt"
fi

# --- Rueckbau und Nachweis --------------------------------------------------

log_info "Entlade Probe."
script_unload "$PROBE_NAME"
wait_unloaded "$PROBE_NAME"

t1="$(date +%s)"
log_info "Nachweis: loese nach dem Entladen noch einmal Signale aus."
busctl --user call "$KWIN_SERVICE" /KWin org.kde.KWin nextDesktop >/dev/null 2>&1 \
	|| log_warn "nextDesktop ueber D-Bus nicht verfuegbar -- Nachweis nur passiv"
sleep 3
busctl --user call "$KWIN_SERVICE" /KWin org.kde.KWin previousDesktop >/dev/null 2>&1 || true
sleep 3

after="$(journalctl --user -u plasma-kwin_wayland --since "@$t1" -o cat | grep -c 'KXLSIG1' || true)"
printf '    isScriptLoaded   %s\n' "$(script_loaded "$PROBE_NAME")"
if [ "$after" -eq 0 ]; then
	log_ok "    Nach dem Entladen keine einzige Probe-Zeile mehr."
else
	log_err "    Nach dem Entladen noch $after Probe-Zeilen -- eine Verbindung hat ueberlebt."
fi
