#!/usr/bin/env bash
set -euo pipefail

# Live-Testhelfer für kwin-xmonad-lite, Meilenstein 8.
# Er läuft als Benutzer in einer bereits vorbereiteten Plasma-Sitzung.

if [[ -t 1 ]]; then
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

usage() {
	cat <<'EOF'
Aufruf:
  kxl-ms8-live.sh \
    --loader /nix/store/.../bin/kwin-xmonad-lite-dev-load \
    --unloader /nix/store/.../bin/kwin-xmonad-lite-unload \
    --probe /nix/store/.../bin/kwin-xmonad-lite-probe-geometry \
    --test-dir /absoluter/pfad

Der Aufrufer stellt die Nix-Umgebung, die Storepfade, eine laufende
Plasma-Wayland-Sitzung und eine externe Dateisicherung bereit.
EOF
}

LOADER=""
UNLOADER=""
PROBE=""
TEST_DIR=""

while (($# > 0)); do
	case "$1" in
		--loader)
			LOADER="${2:-}"
			shift 2
			;;
		--unloader)
			UNLOADER="${2:-}"
			shift 2
			;;
		--probe)
			PROBE="${2:-}"
			shift 2
			;;
		--test-dir)
			TEST_DIR="${2:-}"
			shift 2
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			log_err "Unbekanntes Argument: $1"
			usage >&2
			exit 2
			;;
	esac
done

require_store_program() {
	local label="$1" path="$2"
	if [[ -z "$path" ]]; then
		log_err "$label fehlt."
		exit 2
	fi
	if [[ "$path" != /nix/store/*/bin/* ]] || [[ ! -x "$path" ]]; then
		log_err "$label ist kein ausführbares Storeprogramm: $path"
		exit 2
	fi
}

require_store_program "--loader" "$LOADER"
require_store_program "--unloader" "$UNLOADER"
require_store_program "--probe" "$PROBE"

if [[ -z "$TEST_DIR" ]] || [[ "$TEST_DIR" != /* ]] || [[ "$TEST_DIR" == "/" ]]; then
	log_err "--test-dir muss ein vorhandenes absolutes Verzeichnis unterhalb von / sein."
	exit 2
fi
if [[ ! -d "$TEST_DIR" ]] || [[ ! -w "$TEST_DIR" ]]; then
	log_err "Testverzeichnis fehlt oder ist nicht schreibbar: $TEST_DIR"
	exit 2
fi

for command_name in awk busctl cat cut date grep id journalctl kreadconfig6 \
	kscreen-doctor kwrite kwriteconfig6 mkdir sed seq sleep sort systemd-cat \
	systemd-run tail tee tr wc; do
	if ! command -v "$command_name" >/dev/null 2>&1; then
		log_err "Benötigtes Programm fehlt in der Aufrufumgebung: $command_name"
		exit 2
	fi
done

RUN_TOKEN="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$TEST_DIR/kxl-ms8-$RUN_TOKEN"
if [[ -e "$RUN_DIR" ]]; then
	log_err "Run-Verzeichnis existiert bereits: $RUN_DIR"
	exit 2
fi
mkdir -- "$RUN_DIR"
RUN_LOG="$RUN_DIR/live.log"
exec > >(tee -a "$RUN_LOG") 2>&1

KWIN_SERVICE="org.kde.KWin"
KWIN_SCRIPTING_IFACE="org.kde.kwin.Scripting"
KWIN_SCRIPT_IFACE="org.kde.kwin.Script"
DEV_NAME="kwin-xmonad-lite-dev"
PROD_NAME="kwin-xmonad-lite"
GEOMETRY_NAME="kwin-xmonad-lite-geometry"
CONTROL_PREFIX="kwin-xmonad-lite-ms8-control-$RUN_TOKEN"
VDM_PATH="/VirtualDesktopManager"
VDM_IFACE="org.kde.KWin.VirtualDesktopManager"
ACT_SERVICE="org.kde.ActivityManager"
ACT_PATH="/ActivityManager/Activities"
ACT_IFACE="org.kde.ActivityManager.Activities"
ACTIVITY_A_NAME="kxl-ms8-a-$RUN_TOKEN"
ACTIVITY_B_NAME="kxl-ms8-b-$RUN_TOKEN"
WINDOW_PREFIX="kxl-ms8-$RUN_TOKEN"
RUN_START_EPOCH="$(date +%s)"

CURRENT_CONTROL_NAME=""
DEV_OWNED=0
CLEANUP_DONE=0
CLEANUP_FAILURES=0
CONTROL_COUNTER=0
LAST_CONTROL_OUTPUT=""
SHORTCUT_CLEANUP_ARMED=0
ACTIVITY_CLEANUP_ARMED=0
WINDOW_CLEANUP_ARMED=0
SESSION_POSITION_ARMED=0
ACTIVITY_A=""
ACTIVITY_B=""
ACTIVITIES_BEFORE=""
DESKTOPS_BEFORE=""
ACTIVITY_BEFORE=""
DESKTOP_BEFORE=""
DESKTOP_OTHER=""
OUTPUT_NAME=""
AREA=""

dbus_string() { cut -d'"' -f2; }

script_loaded() {
	busctl --user call "$KWIN_SERVICE" /Scripting "$KWIN_SCRIPTING_IFACE" \
		isScriptLoaded s "$1" | awk '{ print $2 }'
}

wait_unloaded() {
	local name="$1"
	local _
	for _ in $(seq 1 50); do
		if [[ "$(script_loaded "$name" 2>/dev/null)" == "false" ]]; then
			return 0
		fi
		sleep 0.1
	done
	return 1
}

activity_ids() {
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" ListActivities \
		| grep -oE '"[0-9a-f-]{36}"' | tr -d '"' | sort
}

activity_name() {
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" ActivityName s "$1" \
		| dbus_string
}

current_activity() {
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" CurrentActivity \
		| dbus_string
}

desktop_pairs() {
	busctl --user get-property "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" desktops \
		| grep -oE '"[0-9a-f-]{36}" "[^"]*"'
}

desktop_ids() { desktop_pairs | cut -d'"' -f2; }

current_desktop() {
	busctl --user get-property "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" current \
		| dbus_string
}

in_lines() {
	local needle="$1" lines="$2"
	grep -qFx "$needle" <<<"$lines"
}

set_activity() {
	local wanted="$1"
	local _
	busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" \
		SetCurrentActivity s "$wanted" >/dev/null
	for _ in $(seq 1 50); do
		if [[ "$(current_activity)" == "$wanted" ]]; then
			sleep 0.5
			return 0
		fi
		sleep 0.2
	done
	log_err "Activity-Wechsel nach $wanted kam nicht an."
	return 1
}

set_desktop() {
	local wanted="$1"
	local _
	busctl --user set-property "$KWIN_SERVICE" "$VDM_PATH" "$VDM_IFACE" \
		current s "$wanted"
	for _ in $(seq 1 50); do
		if [[ "$(current_desktop)" == "$wanted" ]]; then
			sleep 0.5
			return 0
		fi
		sleep 0.2
	done
	log_err "Desktop-Wechsel nach $wanted kam nicht an."
	return 1
}

controller_action() {
	local action="$1"
	busctl --user call org.kde.kglobalaccel /component/kwin \
		org.kde.kglobalaccel.Component invokeShortcut s "$action" >/dev/null
	sleep 0.5
}

write_control_script() {
	local path="$1" tag="$2" op="$3" label="$4"
	local activity_a="$5" activity_b="$6" desktop_id="$7"
	cat >"$path" <<EOF
(function () {
    "use strict";
    var tag = "$tag";
    var op = "$op";
    var label = "$label";
    var prefix = "$WINDOW_PREFIX";
    var activityA = "$activity_a";
    var activityB = "$activity_b";
    var desktopId = "$desktop_id";

    function out(status, message) {
        console.log("KXLMS8CTRL " + tag + " st=" + status + " " + message);
    }
    function toIds(values) {
        var ids = [];
        var i;
        for (i = 0; i < values.length; i++) {
            ids.push(String(values[i].id === undefined ? values[i] : values[i].id));
        }
        ids.sort();
        return ids;
    }
    function same(a, b) {
        var i;
        if (a.length !== b.length) {
            return false;
        }
        for (i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    }
    function ownWindow(w, needle) {
        var caption = String(w.caption);
        var cls = String(w.resourceClass).toLowerCase();
        return caption.indexOf(needle) >= 0 &&
            (cls === "org.kde.kwrite" || cls === "kwrite");
    }

    var windows = workspace.windowList();
    var matches = [];
    var i;
    for (i = 0; i < windows.length; i++) {
        if (ownWindow(windows[i], op === "close-all" || op === "count-all" ? prefix : label)) {
            matches.push(windows[i]);
        }
    }

    if (op === "count-all") {
        out("ok", "op=count-all count=" + matches.length);
        return;
    }
    if (op === "close-all") {
        for (i = 0; i < matches.length; i++) {
            matches[i].closeWindow();
        }
        out("ok", "op=close-all count=" + matches.length);
        return;
    }

    if (matches.length !== 1) {
        out("error", "op=" + op + " label=" + label + " count=" + matches.length);
        return;
    }

    var w = matches[0];
    var desktops = workspace.desktops;
    var desktop = null;
    for (i = 0; i < desktops.length; i++) {
        if (String(desktops[i].id) === desktopId) {
            desktop = desktops[i];
            break;
        }
    }

    if (op === "place-a" || op === "place-b") {
        if (desktop === null) {
            out("error", "op=" + op + " desktop-not-found=" + desktopId);
            return;
        }
        var wantedActivity = op === "place-a" ? activityA : activityB;
        w.activities = [wantedActivity];
        w.desktops = [desktop];
        w.setMaximize(false, false);
        w.fullScreen = false;
        w.minimized = false;
        if (!same(toIds(w.activities), [wantedActivity]) ||
            !same(toIds(w.desktops), [desktopId])) {
            out("error", "op=" + op + " assignment-rejected");
            return;
        }
    } else if (op === "share") {
        var wanted = [activityA, activityB];
        wanted.sort();
        w.activities = [activityA, activityB];
        if (!same(toIds(w.activities), wanted)) {
            out("error", "op=share assignment-rejected");
            return;
        }
    } else if (op === "sticky") {
        w.desktops = [];
        if (w.desktops.length !== 0 || !w.onAllDesktops) {
            out("error", "op=sticky assignment-rejected");
            return;
        }
    } else if (op === "activate") {
        workspace.activeWindow = w;
        if (!workspace.activeWindow ||
            String(workspace.activeWindow.internalId) !== String(w.internalId)) {
            out("error", "op=activate redirected");
            return;
        }
    } else if (op === "resize-ready") {
        w.frameGeometry = {x: 37, y: 41, width: 600, height: 400};
    } else if (op === "inspect") {
        // Nur lesen.
    } else if (op === "close") {
        w.closeWindow();
        out("ok", "op=close label=" + label);
        return;
    } else {
        out("error", "unknown-op=" + op);
        return;
    }

    out("ok", "op=" + op + " label=" + label +
        " id=" + String(w.internalId) +
        " activities=" + toIds(w.activities).join(",") +
        " desktops=" + toIds(w.desktops).join(",") +
        " allDesktops=" + String(w.onAllDesktops) +
        " geometry=" + w.frameGeometry.width + "x" + w.frameGeometry.height +
        "+" + w.frameGeometry.x + "+" + w.frameGeometry.y);
}());
EOF
}

run_control() {
	local op="$1" label="$2"
	local js_path tag control_name script_id start output
	CONTROL_COUNTER=$((CONTROL_COUNTER + 1))
	tag="$RUN_TOKEN-$CONTROL_COUNTER-$op"
	control_name="$CONTROL_PREFIX-$CONTROL_COUNTER"
	js_path="$RUN_DIR/control-$CONTROL_COUNTER-$op.js"
	write_control_script "$js_path" "$tag" "$op" "$label" \
		"$ACTIVITY_A" "$ACTIVITY_B" "$DESKTOP_BEFORE"
	if [[ "$(script_loaded "$control_name")" != "false" ]]; then
		log_err "Control-Name ist vor dem Laden bereits belegt: $control_name"
		return 1
	fi
	start="$(date +%s)"
	script_id="$(busctl --user call "$KWIN_SERVICE" /Scripting "$KWIN_SCRIPTING_IFACE" \
		loadScript ss "$js_path" "$control_name" | awk '{ print $2 }')"
	if [[ "$script_id" == "-1" ]] || [[ ! "$script_id" =~ ^[0-9]+$ ]]; then
		log_err "Control-Skript wurde nicht mit eigener ID geladen: $control_name ($script_id)"
		return 1
	fi
	CURRENT_CONTROL_NAME="$control_name"
	busctl --user call "$KWIN_SERVICE" "/Scripting/Script$script_id" \
		"$KWIN_SCRIPT_IFACE" run >/dev/null

	output=""
	for _ in $(seq 1 30); do
		output="$(journalctl --user -u plasma-kwin_wayland --since "@$start" -o cat \
			| grep -F "KXLMS8CTRL $tag " || true)"
		if [[ -n "$output" ]]; then
			break
		fi
		sleep 0.1
	done
	busctl --user call "$KWIN_SERVICE" /Scripting "$KWIN_SCRIPTING_IFACE" \
		unloadScript s "$control_name" >/dev/null || true
	if ! wait_unloaded "$control_name"; then
		log_err "Control-Skript blieb geladen: $control_name"
		return 1
	fi
	CURRENT_CONTROL_NAME=""
	LAST_CONTROL_OUTPUT="$output"
	printf '%s\n' "$output" | tee -a "$RUN_DIR/control.log"
	if ! grep -F ' st=ok ' <<<"$output" >/dev/null; then
		log_err "Control-Skript meldete keinen Erfolg: $tag"
		return 1
	fi
}

window_label() { printf '%s-%s.txt\n' "$WINDOW_PREFIX" "$1"; }

create_window() {
	local short="$1" activity_side="$2"
	local label file unit
	label="$(window_label "$short")"
	file="$RUN_DIR/$label"
	: >"$file"
	unit="kxl-ms8-$RUN_TOKEN-$short"
	WINDOW_CLEANUP_ARMED=1
	systemd-run --user --collect --unit "$unit" kwrite --tempfile "$file" >/dev/null

	local _ appeared=0
	for _ in $(seq 1 50); do
		if run_control inspect "$label" >/dev/null 2>&1; then
			appeared=1
			break
		fi
		sleep 0.2
	done
	if ((appeared == 0)); then
		log_err "KWrite-Fenster erschien nicht eindeutig: $label"
		return 1
	fi
	run_control inspect "$label"
	run_control "place-$activity_side" "$label"
	if ((DEV_OWNED == 0)); then
		run_control resize-ready "$label"
		local ready=0
		for _ in $(seq 1 20); do
			sleep 0.25
			run_control inspect "$label"
			if [[ "$LAST_CONTROL_OUTPUT" == *" geometry=600x400+37+41"* ]]; then
				ready=1
				break
			fi
			done
		((ready == 1)) || { log_err "Testfenster nimmt die Vorabgröße nicht an: $label"; return 1; }
	fi
	log_ok "Eigenes Testfenster bereit: $label"
}

close_window() {
	local short="$1"
	run_control close "$(window_label "$short")"
	sleep 0.5
}

set_dev_config() {
	local outer="$1" inner="$2"
	local group="Script-$DEV_NAME"
	kwriteconfig6 --file kwinrc --group "$group" --key gapOuter "$outer"
	kwriteconfig6 --file kwinrc --group "$group" --key gapInner "$inner"
	kwriteconfig6 --file kwinrc --group "$group" --key masterRatio 0.65
	kwriteconfig6 --file kwinrc --group "$group" --key defaultLayout tall
	kwriteconfig6 --file kwinrc --group "$group" --key debug true
	kwriteconfig6 --file kwinrc --group "$group" --key excludes \
		"krunner,yakuake,kded6,polkit-kde-authentication-agent-1,plasmashell,xwaylandvideobridge,steam_app_default"
	busctl --user call "$KWIN_SERVICE" /KWin org.kde.KWin reconfigure >/dev/null
	sleep 1
}

load_dev() {
	if [[ "$(script_loaded "$PROD_NAME")" != "false" ]]; then
		log_err "Produktionsinstanz ist geladen."
		return 1
	fi
	SHORTCUT_CLEANUP_ARMED=1
	DEV_OWNED=1
	"$LOADER"
	if [[ "$(script_loaded "$DEV_NAME")" != "true" ]]; then
		log_err "Loader meldete keinen geladenen Dev-Controller."
		return 1
	fi
	sleep 1
}

unload_dev() {
	if [[ "$(script_loaded "$DEV_NAME" 2>/dev/null || true)" == "true" ]]; then
		"$UNLOADER"
	fi
	if [[ "$(script_loaded "$DEV_NAME" 2>/dev/null || true)" != "false" ]]; then
		log_err "Dev-Controller ließ sich nicht entladen."
		return 1
	fi
	DEV_OWNED=0
}

run_probe() {
	local name="$1" layout="$2" count="$3" ratio="$4" gaps="$5" surface="$6"
	local attempt
	for attempt in 1 2 3; do
		sleep 3
		log_info "Probe $name, Versuch $attempt: layout=$layout n=$count ratio=$ratio gaps=$gaps fläche=$AREA surface=$surface"
		if (
			cd "$RUN_DIR"
			"$PROBE" --erwarte "layout=$layout" "n=$count" "ratio=$ratio" \
				"gaps=$gaps" "fläche=$AREA" "surface=$surface"
		) 2>&1 | tee "$RUN_DIR/$name.out" "$RUN_DIR/$name-attempt$attempt.out"; then
			return 0
		fi
		if ! grep -F 'während der Messung liefen' "$RUN_DIR/$name.out" >/dev/null; then
			return 1
		fi
		log_warn "Ein Übergang unterbrach die Messung; Rohdaten und Fehlbericht bleiben erhalten."
	done
	return 1
}

controller_journal() {
	journalctl --user -b --since "@$RUN_START_EPOCH" -o short-iso \
		_SYSTEMD_USER_UNIT=plasma-kwin_wayland.service
}

latest_surface_line() {
	local surface="$1"
	controller_journal | grep -F "kwin-xmonad-lite: surface $surface " | tail -1
}

latest_order() {
	local surface="$1"
	controller_journal | grep -F "kwin-xmonad-lite: diagnose $surface " \
		| tail -1 | sed -n 's/.* order=\([^ ]*\) teilnehmer=.*/\1/p'
}

latest_participants() {
	local surface="$1"
	controller_journal | grep -F "kwin-xmonad-lite: diagnose $surface " \
		| tail -1 | sed -n 's/.* teilnehmer=\([^ ]*\) float=.*/\1/p'
}

control_window_id() {
	printf '%s\n' "$LAST_CONTROL_OUTPUT" \
		| sed -n 's/.* id=\([^ ]*\) activities=.*/\1/p' | tail -1
}

require_participant() {
	local surface="$1" window_id="$2"
	local participants="" _
	for _ in $(seq 1 30); do
		participants="$(latest_participants "$surface" || true)"
		if [[ -n "$participants" ]] && tr ',' '\n' <<<"$participants" | grep -Fx "$window_id" >/dev/null; then
			log_ok "Fenster $window_id ist Teilnehmer von $surface."
			return 0
		fi
		sleep 0.1
	done
	if [[ -z "$participants" ]] || ! tr ',' '\n' <<<"$participants" | grep -Fx "$window_id" >/dev/null; then
		log_err "Fenster $window_id fehlt in den Teilnehmern von $surface: $participants"
		return 1
	fi
}

require_surface() {
	local surface="$1" layout="$2" count="$3" ratio="$4"
	local line="" _
	for _ in $(seq 1 30); do
		line="$(latest_surface_line "$surface" || true)"
		if [[ "$line" == *" layout=$layout n=$count ratio=$ratio fläche=$AREA"* ]]; then
			log_ok "Surface $surface: $layout n=$count ratio=$ratio"
			return 0
		fi
		sleep 0.1
	done
	if [[ "$line" != *" layout=$layout n=$count ratio=$ratio fläche=$AREA"* ]]; then
		log_err "Surface-Zustand weicht ab: $line"
		return 1
	fi
}

remove_own_activities() {
	local ids id name
	ids="$(activity_ids 2>/dev/null || true)"
	while IFS= read -r id; do
		[[ -n "$id" ]] || continue
		if in_lines "$id" "$ACTIVITIES_BEFORE"; then
			continue
		fi
		name="$(activity_name "$id" 2>/dev/null || true)"
		if [[ "$name" != "$ACTIVITY_A_NAME" && "$name" != "$ACTIVITY_B_NAME" ]]; then
			continue
		fi
		log_info "Entferne eigene Activity $name ($id)."
		if ! busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" \
			RemoveActivity s "$id" >/dev/null; then
			log_err "RemoveActivity schlug fehl: $id"
			CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
		fi
	done <<<"$ids"
}

unregister_dev_shortcuts() {
	local action
	for action in xml-expand xml-focus-master xml-focus-next xml-focus-prev \
		xml-next-layout xml-promote xml-reset-layout xml-shrink xml-sink \
		xml-swap-next xml-swap-prev xml-toggle-float; do
		busctl --user call org.kde.kglobalaccel /kglobalaccel \
			org.kde.KGlobalAccel unregister ss kwin "$action" >/dev/null 2>&1 || true
	done
	sleep 5
}

cleanup() {
	local rc=$?
	if ((CLEANUP_DONE == 1)); then
		return
	fi
	CLEANUP_DONE=1
	trap - EXIT INT TERM
	set +e
	log_info "Logischer Rückbau der eigenen Testressourcen."

	if busctl --user status "$KWIN_SERVICE" >/dev/null 2>&1; then
		if [[ -n "$CURRENT_CONTROL_NAME" ]] && \
			[[ "$(script_loaded "$CURRENT_CONTROL_NAME" 2>/dev/null)" == "true" ]]; then
			busctl --user call "$KWIN_SERVICE" /Scripting "$KWIN_SCRIPTING_IFACE" \
				unloadScript s "$CURRENT_CONTROL_NAME" >/dev/null
			wait_unloaded "$CURRENT_CONTROL_NAME" || CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
		fi
		if ((WINDOW_CLEANUP_ARMED == 1)); then
			run_control close-all "$WINDOW_PREFIX" || CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
			for cleanup_attempt in $(seq 1 20); do
				sleep 0.5
				run_control count-all "$WINDOW_PREFIX" || break
				[[ "$LAST_CONTROL_OUTPUT" == *" count=0"* ]] && break
				if ((cleanup_attempt == 10)); then
					run_control close-all "$WINDOW_PREFIX" || break
				fi
			done
			if [[ "$LAST_CONTROL_OUTPUT" != *" count=0"* ]]; then
				log_err "Eigene KWrite-Fenster waren nach der Schließfrist noch vorhanden."
				CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
			fi
		fi
		if ((DEV_OWNED == 1)); then
			unload_dev || CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
		fi
		if ((SESSION_POSITION_ARMED == 1)) && [[ -n "$ACTIVITY_BEFORE" ]]; then
			set_activity "$ACTIVITY_BEFORE" || CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
		fi
		if ((SESSION_POSITION_ARMED == 1)) && [[ -n "$DESKTOP_BEFORE" ]]; then
			set_desktop "$DESKTOP_BEFORE" || CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
		fi
		if ((SHORTCUT_CLEANUP_ARMED == 1)); then
			unregister_dev_shortcuts
			if grep -q '^xml-' "$HOME/.config/kglobalshortcutsrc" 2>/dev/null; then
				log_err "xml-*-Registrierungen blieben nach dem Rückbau bestehen."
				CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
			fi
		fi
		if ((ACTIVITY_CLEANUP_ARMED == 1)); then
			remove_own_activities
			sleep 2
		fi
	fi

	if [[ -n "$ACTIVITIES_BEFORE" ]] && [[ "$(activity_ids 2>/dev/null)" != "$ACTIVITIES_BEFORE" ]]; then
		log_err "Activitymenge entspricht nach dem Rückbau nicht der Ausgangsmenge."
		CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
	fi
	if [[ -n "$DESKTOPS_BEFORE" ]] && [[ "$(desktop_ids 2>/dev/null)" != "$DESKTOPS_BEFORE" ]]; then
		log_err "Desktopmenge entspricht nach dem Rückbau nicht der Ausgangsmenge."
		CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
	fi
	if ((SESSION_POSITION_ARMED == 1)) && [[ -n "$ACTIVITY_BEFORE" ]] && \
		[[ "$(current_activity 2>/dev/null)" != "$ACTIVITY_BEFORE" ]]; then
		log_err "Aktuelle Activity wurde nicht zurückgestellt."
		CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
	fi
	if ((SESSION_POSITION_ARMED == 1)) && [[ -n "$DESKTOP_BEFORE" ]] && \
		[[ "$(current_desktop 2>/dev/null)" != "$DESKTOP_BEFORE" ]]; then
		log_err "Aktueller Desktop wurde nicht zurückgestellt."
		CLEANUP_FAILURES=$((CLEANUP_FAILURES + 1))
	fi

	controller_journal >"$RUN_DIR/controller.journal" 2>/dev/null || true
	printf 'exit_before_cleanup=%s\ncleanup_failures=%s\n' "$rc" "$CLEANUP_FAILURES" \
		>"$RUN_DIR/result.txt"
	log_warn "Die externe Dateisicherung wird erst nach dem Abmelden zurückgespielt."
	if ((rc != 0 || CLEANUP_FAILURES != 0)); then
		exit 1
	fi
	log_ok "Live-Ablauf und logischer Rückbau beendet."
	exit 0
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log_info "Vorprüfung der vorbereiteten Plasma-Sitzung."
if [[ "${XDG_RUNTIME_DIR:-}" != "/run/user/$(id -u)" ]]; then
	log_err "XDG_RUNTIME_DIR ist nicht /run/user/$(id -u)."
	exit 1
fi
if [[ "${DBUS_SESSION_BUS_ADDRESS:-}" != "unix:path=$XDG_RUNTIME_DIR/bus" ]]; then
	log_err "DBUS_SESSION_BUS_ADDRESS zeigt nicht auf den eigenen Sitzungs-Bus."
	exit 1
fi
if [[ -z "${WAYLAND_DISPLAY:-}" ]] || [[ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then
	log_err "WAYLAND_DISPLAY fehlt oder sein Socket ist nicht vorhanden."
	exit 1
fi
if ! busctl --user status "$KWIN_SERVICE" >/dev/null 2>&1; then
	log_err "KWin ist über den Sitzungs-Bus nicht erreichbar."
	exit 1
fi
if ! busctl --user status "$ACT_SERVICE" >/dev/null 2>&1; then
	log_err "ActivityManager ist über den Sitzungs-Bus nicht erreichbar."
	exit 1
fi
for script_name in "$PROD_NAME" "$DEV_NAME" "$GEOMETRY_NAME"; do
	if [[ "$(script_loaded "$script_name")" != "false" ]]; then
		log_err "Skript ist vor dem Lauf bereits geladen: $script_name"
		exit 1
	fi
done
if grep -q '^xml-' "$HOME/.config/kglobalshortcutsrc" 2>/dev/null; then
	log_err "Es bestehen bereits xml-*-Registrierungen; vorbereitete Ausgangslage ist nicht sauber."
	exit 1
fi

ACTIVITIES_BEFORE="$(activity_ids)"
ACTIVITY_BEFORE="$(current_activity)"
DESKTOPS_BEFORE="$(desktop_ids)"
DESKTOP_BEFORE="$(current_desktop)"
if [[ -z "$ACTIVITIES_BEFORE" ]] || ! in_lines "$ACTIVITY_BEFORE" "$ACTIVITIES_BEFORE"; then
	log_err "Activity-Ausgangszustand ist unvollständig."
	exit 1
fi
if [[ "$(wc -l <<<"$DESKTOPS_BEFORE")" -ne 4 ]]; then
	log_err "Erwartet werden vier vorhandene virtuelle Desktops; es wird keiner angelegt."
	exit 1
fi
if ! in_lines "$DESKTOP_BEFORE" "$DESKTOPS_BEFORE"; then
	log_err "Aktueller Desktop fehlt in der Desktopliste."
	exit 1
fi
while IFS= read -r candidate; do
	if [[ "$candidate" != "$DESKTOP_BEFORE" ]]; then
		DESKTOP_OTHER="$candidate"
		break
	fi
done <<<"$DESKTOPS_BEFORE"
if [[ -z "$DESKTOP_OTHER" ]]; then
	log_err "Kein zweiter vorhandener Desktop gefunden."
	exit 1
fi


ACTIVITY_NAME_COLLISION=0
while IFS= read -r existing_activity; do
	existing_name="$(activity_name "$existing_activity")"
	if [[ "$existing_name" == "$ACTIVITY_A_NAME" || "$existing_name" == "$ACTIVITY_B_NAME" ]]; then
		ACTIVITY_NAME_COLLISION=1
		break
	fi
done <<<"$ACTIVITIES_BEFORE"
if ((ACTIVITY_NAME_COLLISION == 1)); then
	log_err "Ein eigener Activity-Name ist unerwartet schon vorhanden."
	exit 1
fi

log_info "Leite die Sollfläche aus KScreen und der Panelkonfiguration ab."
KSCREEN_RECORDS="$RUN_DIR/kscreen-records.tsv"
ansi="$(printf '\033')"
kscreen-doctor -o | sed -E "s/${ansi}\[[0-9;]*m//g" | awk '
	function emit() {
		if (have && enabled) {
			print name "\t" x "\t" y "\t" width "\t" height "\t" scale
		}
	}
	$1 == "Output:" {
		emit()
		have = 1; enabled = 0; name = $3
		x = ""; y = ""; width = ""; height = ""; scale = ""
		next
	}
	$1 == "enabled" { enabled = 1; next }
	$1 == "Geometry:" {
		split($2, p, ","); split($3, s, "x")
		x = p[1]; y = p[2]; width = s[1]; height = s[2]
		next
	}
	$1 == "Scale:" { scale = $2; next }
	END { emit() }
' >"$KSCREEN_RECORDS"
if [[ "$(wc -l <"$KSCREEN_RECORDS")" -ne 1 ]]; then
	log_err "Für diesen minimalen Lauf muss genau ein KScreen-Ausgang aktiv sein."
	exit 1
fi
IFS=$'\t' read -r OUTPUT_NAME OUTPUT_X OUTPUT_Y OUTPUT_W OUTPUT_H OUTPUT_SCALE <"$KSCREEN_RECORDS"
if [[ "$OUTPUT_X,$OUTPUT_Y,$OUTPUT_W,$OUTPUT_H,$OUTPUT_SCALE" != "0,0,1920,1080,1" ]]; then
	log_err "KScreen weicht von der unabhängigen Vorschrift ab: $OUTPUT_NAME ${OUTPUT_W}x${OUTPUT_H}+${OUTPUT_X}+${OUTPUT_Y} scale=$OUTPUT_SCALE"
	exit 1
fi

APPLETSRC="$HOME/.config/plasma-org.kde.plasma.desktop-appletsrc"
PLASMASHELLRC="$HOME/.config/plasmashellrc"
mapfile -t PANEL_IDS < <(sed -n 's/^\[Containments\]\[\([0-9][0-9]*\)\]$/\1/p' "$APPLETSRC" \
	| sort -n -u | while IFS= read -r id; do
		plugin="$(kreadconfig6 --file "$APPLETSRC" --group Containments --group "$id" --key plugin)"
		[[ "$plugin" == "org.kde.panel" ]] && printf '%s\n' "$id"
	done)
if ((${#PANEL_IDS[@]} != 1)); then
	log_err "Für die unabhängige Flächenrechnung wird genau ein Plasma-Panel erwartet."
	exit 1
fi
PANEL_ID="${PANEL_IDS[0]}"
PANEL_SCREEN="$(kreadconfig6 --file "$APPLETSRC" --group Containments --group "$PANEL_ID" --key lastScreen)"
PANEL_LOCATION="$(kreadconfig6 --file "$APPLETSRC" --group Containments --group "$PANEL_ID" --key location)"
PANEL_VISIBILITY="$(kreadconfig6 --file "$APPLETSRC" --group Containments --group "$PANEL_ID" --group General --key panelVisibility)"
PANEL_FLOATING="$(kreadconfig6 --file "$PLASMASHELLRC" --group PlasmaViews --group "Panel $PANEL_ID" --key floating)"
PANEL_THICKNESS="$(kreadconfig6 --file "$PLASMASHELLRC" --group PlasmaViews --group "Panel $PANEL_ID" --group Defaults --key thickness)"
if [[ "$PANEL_SCREEN,$PANEL_LOCATION,$PANEL_FLOATING,$PANEL_THICKNESS" != "0,4,0,30" ]]; then
	log_err "Panelkonfiguration weicht ab: screen=$PANEL_SCREEN location=$PANEL_LOCATION floating=$PANEL_FLOATING thickness=$PANEL_THICKNESS"
	exit 1
fi
if [[ -n "$PANEL_VISIBILITY" && "$PANEL_VISIBILITY" != "0" ]]; then
	log_err "Panel reserviert wegen panelVisibility=$PANEL_VISIBILITY nicht sicher 30 Pixel."
	exit 1
fi
AREA="1920x1050+0+0"
printf 'KScreen=%sx%s+%s+%s scale=%s output=%s\nPanel=%s bottom thickness=%s\nSollfläche=%s\n' \
	"$OUTPUT_W" "$OUTPUT_H" "$OUTPUT_X" "$OUTPUT_Y" "$OUTPUT_SCALE" "$OUTPUT_NAME" \
	"$PANEL_ID" "$PANEL_THICKNESS" "$AREA" >"$RUN_DIR/area-source.txt"
log_ok "Unabhängige Sollfläche: $AREA"

cat >"$RUN_DIR/grid-expected.txt" <<'EOF'
Grid n=3, gaps=0/0, area=1920x1050+0+0
1 960x1050+0+0
2 960x525+960+0
3 960x525+960+525

Grid n=5, gaps=0/0, area=1920x1050+0+0
1 960x525+0+0
2 960x525+0+525
3 960x350+960+0
4 960x350+960+350
5 960x350+960+700

Grid n=3, gaps=8/4, area=1920x1050+0+0
1 950x1034+8+8
2 950x515+962+8
3 950x515+962+527
EOF

printf 'activities_before=%s\nactivity_before=%s\ndesktops_before=%s\ndesktop_before=%s\ndesktop_other=%s\n' \
	"$(tr '\n' ',' <<<"$ACTIVITIES_BEFORE")" "$ACTIVITY_BEFORE" \
	"$(tr '\n' ',' <<<"$DESKTOPS_BEFORE")" "$DESKTOP_BEFORE" "$DESKTOP_OTHER" \
	>"$RUN_DIR/baseline.txt"

log_info "Lege die zwei eigenen Test-Activities an."
ACTIVITY_CLEANUP_ARMED=1
ACTIVITY_A="$(busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" \
	AddActivity s "$ACTIVITY_A_NAME" | dbus_string)"
ACTIVITY_B="$(busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" \
	AddActivity s "$ACTIVITY_B_NAME" | dbus_string)"
uuid_re='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
if [[ ! "$ACTIVITY_A" =~ $uuid_re ]] || [[ ! "$ACTIVITY_B" =~ $uuid_re ]] || \
	[[ "$ACTIVITY_A" == "$ACTIVITY_B" ]] || in_lines "$ACTIVITY_A" "$ACTIVITIES_BEFORE" || \
	in_lines "$ACTIVITY_B" "$ACTIVITIES_BEFORE"; then
	log_err "ActivityManager lieferte keine zwei neuen eindeutigen IDs."
	exit 1
fi
if [[ "$(activity_name "$ACTIVITY_A")" != "$ACTIVITY_A_NAME" ]] || \
	[[ "$(activity_name "$ACTIVITY_B")" != "$ACTIVITY_B_NAME" ]]; then
	log_err "Activity-Namen stimmen nach dem Anlegen nicht."
	exit 1
fi
sleep 2
SESSION_POSITION_ARMED=1
set_activity "$ACTIVITY_A"
set_desktop "$DESKTOP_BEFORE"

log_info "Grid n=3 ohne Abstände."
create_window g1 a
create_window g2 a
create_window g3 a
set_dev_config 0 0
load_dev
run_control activate "$(window_label g1)"
controller_action xml-next-layout
controller_action xml-next-layout
SURFACE_A="$ACTIVITY_A|$DESKTOP_BEFORE|$OUTPUT_NAME"
run_probe grid-n3-gap0 grid 3 0.65 0/0 "$SURFACE_A"

log_info "Grid n=5 ohne Abstände."
create_window g4 a
create_window g5 a
run_probe grid-n5-gap0 grid 5 0.65 0/0 "$SURFACE_A"

log_info "Getrennte Zustände und gemeinsames Activity-Fenster."
run_control activate "$(window_label g3)"
controller_action xml-expand
controller_action xml-promote
run_control share "$(window_label g1)"
G1_ID="$(control_window_id)"
[[ -n "$G1_ID" ]] || { log_err "Interne ID von g1 fehlt."; exit 1; }
require_surface "$SURFACE_A" grid 5 0.7
require_participant "$SURFACE_A" "$G1_ID"
A_ORDER="$(latest_order "$SURFACE_A")"
[[ -n "$A_ORDER" ]] || { log_err "A-Reihenfolge fehlt."; exit 1; }

set_activity "$ACTIVITY_B"
set_desktop "$DESKTOP_BEFORE"
create_window b1 b
create_window b2 b
run_control activate "$(window_label b2)"
controller_action xml-shrink
controller_action xml-shrink
controller_action xml-promote
SURFACE_B="$ACTIVITY_B|$DESKTOP_BEFORE|$OUTPUT_NAME"
require_surface "$SURFACE_B" tall 3 0.55
require_participant "$SURFACE_B" "$G1_ID"
B_ORDER="$(latest_order "$SURFACE_B")"
[[ -n "$B_ORDER" ]] || { log_err "B-Reihenfolge fehlt."; exit 1; }
run_probe activity-b-tall tall 3 0.55 0/0 "$SURFACE_B"

set_activity "$ACTIVITY_A"
set_desktop "$DESKTOP_BEFORE"
require_surface "$SURFACE_A" grid 5 0.7
if [[ "$(latest_order "$SURFACE_A")" != "$A_ORDER" ]]; then
	log_err "A-Reihenfolge änderte sich beim Activity-Wechsel."
	exit 1
fi
run_probe activity-a-return grid 5 0.7 0/0 "$SURFACE_A"

set_activity "$ACTIVITY_B"
set_desktop "$DESKTOP_BEFORE"
if [[ "$(latest_order "$SURFACE_B")" != "$B_ORDER" ]]; then
	log_err "B-Reihenfolge änderte sich beim Activity-Wechsel."
	exit 1
fi
set_activity "$ACTIVITY_A"
set_desktop "$DESKTOP_BEFORE"

log_info "Sticky-Fenster auf einem zweiten vorhandenen Desktop."
run_control sticky "$(window_label g2)"
run_control inspect "$(window_label g1)"
run_control inspect "$(window_label g2)"
G2_ID="$(control_window_id)"
[[ -n "$G2_ID" ]] || { log_err "Interne ID von g2 fehlt."; exit 1; }
require_participant "$SURFACE_A" "$G2_ID"
set_desktop "$DESKTOP_OTHER"
SURFACE_STICKY="$ACTIVITY_A|$DESKTOP_OTHER|$OUTPUT_NAME"
require_surface "$SURFACE_STICKY" tall 1 0.65
require_participant "$SURFACE_STICKY" "$G2_ID"
run_probe sticky-desktop tall 1 0.65 0/0 "$SURFACE_STICKY"
set_desktop "$DESKTOP_BEFORE"
require_surface "$SURFACE_A" grid 5 0.7
if [[ "$(latest_order "$SURFACE_A")" != "$A_ORDER" ]]; then
	log_err "A-Reihenfolge änderte sich durch die Sticky-Surface."
	exit 1
fi

log_info "Grid n=3 mit Außenabstand 8 und Innenabstand 4."
close_window g4
close_window g5
unload_dev
set_dev_config 8 4
load_dev
run_control activate "$(window_label g1)"
controller_action xml-next-layout
controller_action xml-next-layout
require_surface "$SURFACE_A" grid 3 0.65
run_probe grid-n3-gap8-4 grid 3 0.65 8/4 "$SURFACE_A"

log_info "Vier getrennte Zustände über zwei Activities und zwei Desktops."
run_control sticky "$(window_label g1)"
A1_ORDER="$(latest_order "$SURFACE_A")"
set_desktop "$DESKTOP_OTHER"
run_control activate "$(window_label g2)"
controller_action xml-next-layout
controller_action xml-expand
controller_action xml-promote
require_surface "$SURFACE_STICKY" full 2 0.7
require_participant "$SURFACE_STICKY" "$G1_ID"
A2_ORDER="$(latest_order "$SURFACE_STICKY")"
run_probe matrix-a2-full full 2 0.7 8/4 "$SURFACE_STICKY"

set_activity "$ACTIVITY_B"
set_desktop "$DESKTOP_BEFORE"
run_control activate "$(window_label b1)"
controller_action xml-next-layout
controller_action xml-shrink
controller_action xml-promote
require_surface "$SURFACE_B" full 3 0.6
B1_ORDER="$(latest_order "$SURFACE_B")"
run_probe matrix-b1-full full 3 0.6 8/4 "$SURFACE_B"

set_desktop "$DESKTOP_OTHER"
run_control activate "$(window_label g1)"
controller_action xml-next-layout
controller_action xml-next-layout
controller_action xml-expand
controller_action xml-expand
SURFACE_B2="$ACTIVITY_B|$DESKTOP_OTHER|$OUTPUT_NAME"
require_surface "$SURFACE_B2" grid 1 0.75
require_participant "$SURFACE_B2" "$G1_ID"
B2_ORDER="$(latest_order "$SURFACE_B2")"
run_probe matrix-b2-grid grid 1 0.75 8/4 "$SURFACE_B2"

set_activity "$ACTIVITY_A"
set_desktop "$DESKTOP_BEFORE"
require_surface "$SURFACE_A" grid 3 0.65
[[ "$(latest_order "$SURFACE_A")" == "$A1_ORDER" ]]
set_desktop "$DESKTOP_OTHER"
require_surface "$SURFACE_STICKY" full 2 0.7
[[ "$(latest_order "$SURFACE_STICKY")" == "$A2_ORDER" ]]
set_activity "$ACTIVITY_B"
set_desktop "$DESKTOP_BEFORE"
require_surface "$SURFACE_B" full 3 0.6
[[ "$(latest_order "$SURFACE_B")" == "$B1_ORDER" ]]
set_desktop "$DESKTOP_OTHER"
require_surface "$SURFACE_B2" grid 1 0.75
[[ "$(latest_order "$SURFACE_B2")" == "$B2_ORDER" ]]
log_ok "Alle vier gespeicherten Layouts, Ratios und Reihenfolgen erhalten."

log_info "Entfernung von Activity B bei weiterhin unveränderten A-Surfaces."
set_desktop "$DESKTOP_BEFORE"
close_window b1
close_window b2
require_surface "$SURFACE_B" full 1 0.6
set_activity "$ACTIVITY_A"
set_desktop "$DESKTOP_BEFORE"
GC_START="$(date +%s)"
busctl --user call "$ACT_SERVICE" "$ACT_PATH" "$ACT_IFACE" RemoveActivity s "$ACTIVITY_B" >/dev/null
sleep 2
if in_lines "$ACTIVITY_B" "$(activity_ids)"; then
	log_err "Activity B blieb nach RemoveActivity bestehen."
	exit 1
fi
journalctl --user -u plasma-kwin_wayland.service --since "@$GC_START" -o cat \
	| grep 'surface entfernt ' > "$RUN_DIR/gc.log"
grep -F "surface entfernt $ACTIVITY_B|" "$RUN_DIR/gc.log" >/dev/null
if grep -F "surface entfernt $ACTIVITY_A|" "$RUN_DIR/gc.log" >/dev/null; then
	log_err "GC entfernte auch eine A-Surface."
	exit 1
fi
require_surface "$SURFACE_A" grid 3 0.65
[[ "$(latest_order "$SURFACE_A")" == "$A1_ORDER" ]]
require_participant "$SURFACE_A" "$G1_ID"
run_probe after-gc-grid grid 3 0.65 8/4 "$SURFACE_A"
set_desktop "$DESKTOP_OTHER"
require_surface "$SURFACE_STICKY" full 2 0.7
[[ "$(latest_order "$SURFACE_STICKY")" == "$A2_ORDER" ]]
log_ok "GC entfernte B; beide A-Zustände und das gemeinsame Fenster sind erhalten."

log_info "Beobachte den Controller fünf Sekunden ohne weiteren Testreiz."
sleep 5
systemd-cat -t kxl-ms8-live echo "== MS8 Live-Helfer $RUN_TOKEN Ende der Prüfschritte =="
log_ok "Alle Prüfschritte sind durchgelaufen; der EXIT-Trap räumt logisch auf."
