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
# Wechsel loest sie nicht aus.
#
# **Rueckbau:** jeder Eingriff ist reversibel, und der Rueckbau haengt nicht am
# Gutfall. Die Ausgangsmengen und die Traps stehen, bevor die Probe geladen
# wird; die Ruecknahme-Flags werden **vor** dem jeweiligen Eingriff
# scharfgestellt. Ein Abbruch mitten in einer Phase raeumt deshalb genauso auf
# wie ein regulaeres Ende. Am Schluss werden sechs Zustaende geprueft; jede
# Abweichung geht in den Exit-Code.

PROBE_JS="${XML_SIGNALS_JS:?XML_SIGNALS_JS ist nicht gesetzt}"
PROBE_NAME="${XML_SIGNALS_NAME:-kwin-xmonad-lite-signals}"
OUT_DIR="${XML_PROBE_OUT:-$PWD}"
# Desktop und Activity der Probe tragen diesen Namen. Nur was so heisst und
# nicht in der Ausgangsmenge stand, wird beim Rueckbau angefasst.
PROBE_LABEL="kxl-probe"

VDM_PATH=/VirtualDesktopManager
VDM_IFACE=org.kde.KWin.VirtualDesktopManager
ACT_SERVICE=org.kde.ActivityManager
ACT_PATH=/ActivityManager/Activities
ACT_IFACE=org.kde.ActivityManager.Activities

hotplug_output=""
if [ "${1:-}" = "--hotplug" ]; then
	hotplug_output="${2:?--hotplug braucht einen Ausgabenamen, etwa DP-9}"
fi

require_kwin

# --- Ablesen ----------------------------------------------------------------

# busctl gibt Zeichenketten als `s "wert"` aus. Ueber das Anfuehrungszeichen
# zu schneiden statt ueber das zweite Feld: Desktop- und Activitynamen duerfen
# Leerzeichen enthalten.
dbus_str() { cut -d'"' -f2; }

# Die Wertform der `desktops`-Eigenschaft ist `a(uss)` -- Position, UUID, Name;
# die Introspektion deklariert dagegen `a(iss)`. KWin widerspricht sich hier
# selbst (beides in KWin 6.7.4 gemessen); geparst wird die Wertform. Nicht
# "korrigieren", ohne vorher `busctl get-property` anzusehen.
desktop_pairs() {
	busctl --user get-property "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" desktops \
		| grep -oE '"[0-9a-f-]{36}" "[^"]*"'
}

desktop_ids() { desktop_pairs | cut -d'"' -f2 | sort; }

desktop_count() {
	busctl --user get-property "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" count \
		| awk '{ print $2 }'
}

current_desktop() {
	busctl --user get-property "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" current | dbus_str
}

set_current_desktop() {
	busctl --user set-property "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" current s "$1"
}

activity_ids() {
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" ListActivities \
		| grep -oE '"[0-9a-f-]{36}"' | tr -d '"' | sort
}

current_activity() {
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" CurrentActivity | dbus_str
}

activity_name() {
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" ActivityName s "$1" | dbus_str
}

# kscreen-doctor faerbt seine Ausgabe; ohne das Abstreifen passt kein
# Vergleich. Ein Block beginnt mit "Output: <n> <name> <uuid>", darin steht
# "enabled" oder "disabled" allein auf einer Zeile. Leere Ausgabe heisst:
# Ausgabe unbekannt.
#
# Das awk liest bis zum Ende, statt beim ersten Treffer auszusteigen: ein
# frueh beendeter Leser schickt `sed` ein SIGPIPE, und mit `pipefail` faellt
# die ganze Pipeline auf 141 -- unter `errexit` das stille Ende des Skripts.
output_state() {
	local ansi
	ansi="$(printf '\033')"
	kscreen-doctor -o 2>/dev/null \
		| sed -E "s/${ansi}\[[0-9;]*m//g" \
		| awk -v n="$1" '
			$1 == "Output:" { drin = ($3 == n); next }
			drin && zustand == "" && ($1 == "enabled" || $1 == "disabled") { zustand = $1 }
			END { if (zustand != "") print zustand }'
}

# Mengenpruefung ueber eine Hier-Zeichenkette statt ueber eine Pipe -- aus
# demselben Grund: `grep -q` steigt beim ersten Treffer aus.
enthaelt() {
	grep -qFx "$1" <<<"$2"
}

# --- Zustand, Rueckbau, Traps -----------------------------------------------
#
# Alles hier steht **vor** dem Laden der Probe und vor jedem Eingriff.

failures=0
probe_fail() {
	failures=$((failures + 1))
	log_err "$*"
}

probe_owned=0
desktop_armed=0
activity_armed=0
hotplug_disabled=""

desktops_before="$(desktop_ids)"
desktop_before="$(current_desktop)"
activities_before="$(activity_ids)"
activity_before="$(current_activity)"

# Entfernt, was diese Probe angelegt hat: der passende Name **und** die
# Abwesenheit in der Ausgangsmenge. `createDesktop` hat keinen Rueckgabewert,
# die Id ist also nur ueber diese Differenz sicher zu bekommen -- und sie wird
# hier neu ermittelt, nicht aus einer Variablen gelesen, die bei einem Abbruch
# zwischen Anlegen und Ablesen leer waere.
remove_probe_desktops() {
	local pairs pair id name
	pairs="$(desktop_pairs)"
	while IFS= read -r pair; do
		[ -n "$pair" ] || continue
		id="$(printf '%s' "$pair" | cut -d'"' -f2)"
		name="$(printf '%s' "$pair" | cut -d'"' -f4)"
		[ "$name" = "$PROBE_LABEL" ] || continue
		if enthaelt "$id" "$desktops_before"; then
			continue
		fi
		log_info "Entferne Probe-Desktop $id."
		busctl --user call "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" removeDesktop s "$id" \
			>/dev/null || probe_fail "removeDesktop $id fehlgeschlagen."
	done <<-EOF
		$pairs
	EOF
}

remove_probe_activities() {
	local ids id name
	ids="$(activity_ids)"
	while IFS= read -r id; do
		[ -n "$id" ] || continue
		if enthaelt "$id" "$activities_before"; then
			continue
		fi
		name="$(activity_name "$id")"
		[ "$name" = "$PROBE_LABEL" ] || continue
		log_info "Entferne Probe-Activity $id."
		busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" RemoveActivity s "$id" \
			>/dev/null || probe_fail "RemoveActivity $id fehlgeschlagen."
	done <<-EOF
		$ids
	EOF
}

# Laeuft genau einmal, aus `on_exit`. Die Reihenfolge ist Absicht: die Ausgabe
# zuerst, sonst siehst du vom Rest nichts.
cleanup() {
	if [ -n "$hotplug_disabled" ]; then
		log_warn "Schalte $hotplug_disabled wieder an."
		kscreen-doctor "output.$hotplug_disabled.enable" \
			|| probe_fail "Wiedereinschalten von $hotplug_disabled fehlgeschlagen."
		hotplug_disabled=""
	fi

	if [ "$activity_armed" -eq 1 ]; then
		# Erst zurueckwechseln, dann entfernen: eine aktive Activity laesst
		# sich nicht sauber loeschen.
		if [ -n "$activity_before" ] && [ "$(current_activity)" != "$activity_before" ]; then
			busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" \
				SetCurrentActivity s "$activity_before" >/dev/null \
				|| probe_fail "Zuruecksetzen der Activity fehlgeschlagen."
			sleep 2
		fi
		remove_probe_activities
		activity_armed=0
	fi

	if [ "$desktop_armed" -eq 1 ]; then
		remove_probe_desktops
		desktop_armed=0
	fi

	if [ "$probe_owned" -eq 1 ] && [ "$(script_loaded "$PROBE_NAME")" = "true" ]; then
		log_warn "Probe war noch geladen, entlade."
		script_unload "$PROBE_NAME"
		wait_unloaded "$PROBE_NAME"
		probe_owned=0
	fi

	# Der virtuelle Desktop zum Schluss: Phase 1 wechselt von Hand, der
	# Entlade-Nachweis ueber nextDesktop/previousDesktop, und am Rand der
	# Desktopreihe endet dieses Paar auf einem **anderen** Desktop. Deshalb
	# gezielt an der UUID zurueckstellen statt auf Symmetrie zu vertrauen.
	if [ -n "$desktop_before" ] && [ "$(current_desktop)" != "$desktop_before" ]; then
		log_info "Stelle den Ausgangsdesktop wieder her."
		set_current_desktop "$desktop_before" \
			|| probe_fail "Zuruecksetzen des Desktops fehlgeschlagen."
	fi
}

# INT und TERM beenden nur mit dem richtigen Status; aufgeraeumt wird
# ausschliesslich in `on_exit`, und zwar genau einmal.
on_exit() {
	local rc=$?
	trap - EXIT INT TERM
	set +e
	cleanup
	if [ "$rc" -eq 0 ] && [ "$failures" -gt 0 ]; then
		rc=1
	fi
	exit "$rc"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# --- Vorpruefungen ----------------------------------------------------------

if [ "$(script_loaded kwin-xmonad-lite)" = "true" ]; then
	log_warn "Der Layout-Controller ist geladen. Seine arrange-Zeilen laufen"
	log_warn "im selben Journal, stoeren die Messung aber nicht (eigener Tag)."
fi

if [ "$(script_loaded "$PROBE_NAME")" = "true" ]; then
	log_warn "Probe war noch geladen, entlade zuerst."
	script_unload "$PROBE_NAME"
	wait_unloaded "$PROBE_NAME"
fi

# Nur abschalten, was auch an ist -- und niemals etwas einschalten, das diese
# Probe nicht selbst abgeschaltet hat.
if [ -n "$hotplug_output" ]; then
	zustand="$(output_state "$hotplug_output")"
	if [ "$zustand" != "enabled" ]; then
		probe_fail "Ausgabe '$hotplug_output' ist nicht eingeschaltet (${zustand:-unbekannt}); Phase 6 bleibt Handarbeit."
		hotplug_output=""
	fi
fi

# --- Laden ------------------------------------------------------------------

t0="$(date +%s)"
log_info "Lade Signalprobe: $PROBE_JS"
probe_owned=1
id="$(script_load_and_run "$PROBE_JS" "$PROBE_NAME")"
log_ok "Gestartet als /Scripting/Script$id."

# --- Phasen -----------------------------------------------------------------

log_info "Phase 1 (20 s): Wechsle jetzt mehrfach den virtuellen Desktop."
sleep 20

log_info "Phase 2 (25 s): Aendere jetzt die Panelhoehe und LASS SIE STEHEN."
log_info "               (Rechtsklick auf das Panel, Anzeigeeinstellungen, Hoehe)"
sleep 25

log_info "Phase 3 (15 s): Setze die Panelhoehe wieder zurueck."
sleep 15

log_info "Phase 4 (20 s): Lege einen virtuellen Desktop an und entferne ihn wieder."
desktop_armed=1
busctl --user call "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" \
	createDesktop us "$(desktop_count)" "$PROBE_LABEL" \
	>/dev/null || probe_fail "createDesktop fehlgeschlagen."
sleep 8
remove_probe_desktops
# Nur entschaerfen, wenn wirklich nichts uebrig ist -- sonst raeumt `cleanup`
# nach.
if [ "$(desktop_ids)" = "$desktops_before" ]; then
	desktop_armed=0
fi
sleep 8

log_info "Phase 5 (25 s): Lege eine Activity an, wechsle hin und zurueck, entferne sie."
log_warn "               Waehrend des Wechsels sind kurz keine Fenster zu sehen."
activity_armed=1
act_new="$(busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" \
	AddActivity s "$PROBE_LABEL" | dbus_str)"
if [ -n "$act_new" ]; then
	sleep 6
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" \
		SetCurrentActivity s "$act_new" >/dev/null || true
	sleep 6
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" \
		SetCurrentActivity s "$activity_before" >/dev/null || true
	sleep 6
	remove_probe_activities
	if [ "$(activity_ids)" = "$activities_before" ]; then
		activity_armed=0
	fi
	sleep 7
else
	probe_fail "AddActivity fehlgeschlagen, Phase 5 uebersprungen."
	activity_armed=0
	sleep 25
fi

if [ -n "$hotplug_output" ]; then
	log_info "Phase 6 (40 s): Schalte $hotplug_output ab und wieder an."
	hotplug_disabled="$hotplug_output"
	kscreen-doctor "output.$hotplug_output.disable" || probe_fail "disable fehlgeschlagen."
	sleep 15
	kscreen-doctor "output.$hotplug_output.enable" || probe_fail "enable fehlgeschlagen."
	hotplug_disabled=""
	sleep 25
else
	log_info "Phase 6 (40 s): Stecke jetzt einen Bildschirm ab und wieder an,"
	log_info "               oder in einem zweiten Terminal:"
	log_info "               kscreen-doctor output.DP-9.disable && sleep 10 && kscreen-doctor output.DP-9.enable"
	sleep 40
fi

# --- Abschlusssatz ----------------------------------------------------------

# Gepollt statt `journalctl -f | grep -q -m1`: dort beendet sich `grep` beim
# ersten Treffer, `journalctl` bekommt ein SIGPIPE, und mit `pipefail` meldet
# die Bedingung genau dann einen Fehlschlag, wenn der Satz da war. `grep` ohne
# `-q` liest seine Eingabe zu Ende.
log_info "Warte auf den Abschlusssatz (max. 60 s)."
ende_gesehen=0
for _ in $(seq 1 60); do
	if journalctl --user -u plasma-kwin_wayland --since "@$t0" -o cat \
		| grep '"k":"end"' >/dev/null; then
		ende_gesehen=1
		break
	fi
	sleep 1
done
if [ "$ende_gesehen" -eq 1 ]; then
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
	probe_fail "Keine einzige Probe-Zeile im Journal."
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
probe_owned=0

t1="$(date +%s)"
log_info "Nachweis: loese nach dem Entladen noch einmal Signale aus."
busctl --user call "$KWIN_SERVICE" /KWin org.kde.KWin nextDesktop >/dev/null 2>&1 \
	|| log_warn "nextDesktop ueber D-Bus nicht verfuegbar -- Nachweis nur passiv"
sleep 3
busctl --user call "$KWIN_SERVICE" /KWin org.kde.KWin previousDesktop >/dev/null 2>&1 || true
sleep 3

after="$(journalctl --user -u plasma-kwin_wayland --since "@$t1" -o cat | grep -c 'KXLSIG1' || true)"
if [ "$after" -eq 0 ]; then
	log_ok "Nach dem Entladen keine einzige Probe-Zeile mehr."
else
	probe_fail "Nach dem Entladen noch $after Probe-Zeilen -- eine Verbindung hat ueberlebt."
fi

# Das Paar oben kann am Rand der Desktopreihe woanders enden; vor der Pruefung
# gezielt zurueckstellen.
if [ "$(current_desktop)" != "$desktop_before" ]; then
	set_current_desktop "$desktop_before" || true
	sleep 1
fi

# --- Endpruefung ------------------------------------------------------------
#
# Exakte Mengen und Zustaende, keine Zaehlwerte: eine gleich gebliebene Anzahl
# bei getauschten Ids waere kein sauberer Rueckbau.

check_same() {
	local was="$1" soll="$2" ist="$3"
	if [ "$soll" = "$ist" ]; then
		log_ok "$was unveraendert."
	else
		probe_fail "$was weicht ab: erwartet [$(printf '%s' "$soll" | tr '\n' ' ')], vorgefunden [$(printf '%s' "$ist" | tr '\n' ' ')]."
	fi
}

log_info "Endpruefung:"
check_same "Desktopmenge" "$desktops_before" "$(desktop_ids)"
check_same "aktueller Desktop" "$desktop_before" "$(current_desktop)"
check_same "Activitymenge" "$activities_before" "$(activity_ids)"
check_same "aktuelle Activity" "$activity_before" "$(current_activity)"
if [ -n "$hotplug_output" ]; then
	check_same "Zustand von $hotplug_output" "enabled" "$(output_state "$hotplug_output")"
fi
check_same "isScriptLoaded" "false" "$(script_loaded "$PROBE_NAME")"

if [ "$failures" -eq 0 ]; then
	log_ok "Probe beendet, keine Beanstandung."
else
	log_err "$failures Beanstandung(en) -- Exit-Code 1."
fi
