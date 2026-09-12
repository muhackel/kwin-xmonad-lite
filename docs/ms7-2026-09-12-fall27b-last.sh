#!/usr/bin/env bash
# Skriptgesteuerte Last für Fall 27b der Abnahmereihe AP8 (2026-09-12).
# Wie das Lastskript von Fall 27 (docs/ms7-2026-09-06-fall27-last.sh), aber um
# die drei technischen Anlässe erweitert, die dort fehlten: Hotplug einer
# Ausgabe, Änderung der Panelhöhe und Ziehen eines Fensters (Meta+Maus über
# /dev/uinput sowie Tastaturverschieben über "Window Move"). Der Zähler zählt
# nur ausgeführte Aktionen, und jede Aktion steht als kxl-last-Zeile im Journal.
# Strikt über D-Bus, kscreen-doctor, plasmashell-Skript und uinput; keine
# Geometrie wird selbst gesetzt.
set -uo pipefail

export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
export WAYLAND_DISPLAY=wayland-0
export QT_QPA_PLATFORM=wayland
export YDOTOOL_SOCKET=/tmp/ydotool.sock

YDOTOOL="${YDOTOOL:-ydotool}"
DAUER="${1:-3900}"
MAUS_OK="${MAUS_OK:-1}"
TASTEN_OK="${TASTEN_OK:-1}"
ENDE=$(( $(date +%s) + DAUER ))
AUSGEFUEHRT=0
UEBERSPRUNGEN=0
declare -A ZAEHLER

melde() {
	systemd-cat -t kxl-last echo "$*"
}

kurz() {
	busctl --user call org.kde.kglobalaccel /component/kwin \
		org.kde.kglobalaccel.Component invokeShortcut s "$1" >/dev/null 2>&1
}

taste() {
	"$YDOTOOL" key -d 40 "$@" >/dev/null 2>&1
}

offene_fenster() {
	ps -u muhackel -o args= | grep -c "^kwrite /tmp/kxl-last" || true
}

fenster_auf() {
	local n="$RANDOM"
	touch "/tmp/kxl-last-$n.txt"
	setsid kwrite "/tmp/kxl-last-$n.txt" >/dev/null 2>&1 < /dev/null &
}

fenster_zu() {
	local pid
	pid=$(ps -u muhackel -o pid=,args= | grep "kxl-last" | grep -v grep | shuf -n1 | awk '{print $1}')
	[ -n "$pid" ] && kill "$pid" 2>/dev/null
}

edp_an() {
	kscreen-doctor output.eDP-1.enable output.eDP-1.position.1920,0 >/dev/null 2>&1
}

edp_aus() {
	kscreen-doctor output.eDP-1.disable >/dev/null 2>&1
}

edp_aktiv() {
	kscreen-doctor -o 2>/dev/null | grep -A3 "eDP-1" | grep -q "enabled"
}

hotplug() {
	if edp_aktiv; then
		melde "hotplug: eDP-1 aus"
		edp_aus
	else
		melde "hotplug: eDP-1 an"
		edp_an
	fi
}

PANEL_HOCH=0
panelhoehe() {
	local h
	if [ "$PANEL_HOCH" = 1 ]; then h=30; PANEL_HOCH=0; else h=48; PANEL_HOCH=1; fi
	melde "panelhöhe: $h"
	busctl --user call org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell \
		evaluateScript s "var ps = panels(); for (var i = 0; i < ps.length; i++) { ps[i].height = $h; }" >/dev/null 2>&1
}

# Meta+Maus: Zeiger in die linke obere Ecke drücken, dann auf einen Punkt in
# der Masterzelle von DP-3 fahren, Meta halten, ziehen, loslassen.
ziehen_maus() {
	local dx=$(( 120 + RANDOM % 400 )) dy=$(( 80 + RANDOM % 300 ))
	melde "ziehen maus: +$dx+$dy"
	"$YDOTOOL" mousemove -x -5000 -y -5000 >/dev/null 2>&1
	"$YDOTOOL" mousemove -x 500 -y 400 >/dev/null 2>&1
	taste 125:1
	"$YDOTOOL" click 0x40 >/dev/null 2>&1
	sleep 0.2
	"$YDOTOOL" mousemove -x "$dx" -y "$dy" >/dev/null 2>&1
	sleep 0.2
	"$YDOTOOL" mousemove -x 30 -y 20 >/dev/null 2>&1
	sleep 0.2
	"$YDOTOOL" click 0x80 >/dev/null 2>&1
	taste 125:0
}

# Tastaturverschieben: "Window Move" versetzt das aktive Fenster in den
# Verschiebemodus, Pfeiltasten bewegen es, Enter beendet.
ziehen_tastatur() {
	local n=$(( 3 + RANDOM % 6 )) i
	melde "ziehen tastatur: ${n}x rechts+unten"
	kurz "Window Move"
	sleep 0.3
	for (( i = 0; i < n; i++ )); do
		taste 106:1 106:0
		taste 108:1 108:0
	done
	taste 28:1 28:0
}

AKTIONEN=(
	"kurz xml-next-layout"
	"kurz xml-shrink"
	"kurz xml-expand"
	"kurz xml-promote"
	"kurz xml-swap-next"
	"kurz xml-swap-prev"
	"kurz xml-focus-next"
	"kurz xml-focus-prev"
	"kurz xml-focus-master"
	"kurz xml-toggle-float"
	"kurz xml-sink"
	"kurz xml-reset-layout"
	"kurz 'Switch to Desktop 1'"
	"kurz 'Switch to Desktop 2'"
	"kurz 'Switch to Desktop 3'"
	"kurz 'Switch to Desktop 4'"
	"kurz 'Window Maximize'"
	"kurz 'Window Minimize'"
	"kurz 'Window One Screen to the Right'"
	"kurz 'Window One Screen to the Left'"
	"fenster_auf"
	"fenster_zu"
	"hotplug"
	"hotplug"
	"panelhoehe"
	"panelhoehe"
	"ziehen_maus"
	"ziehen_maus"
	"ziehen_tastatur"
	"ziehen_tastatur"
)

melde "== Fall 27b Last beginnt, Dauer ${DAUER}s, maus=$MAUS_OK tasten=$TASTEN_OK =="

while [ "$(date +%s)" -lt "$ENDE" ]; do
	i=$(( RANDOM % ${#AKTIONEN[@]} ))
	aktion="${AKTIONEN[$i]}"
	ausgefuehrt=1

	case "$aktion" in
		fenster_auf)
			if [ "$(offene_fenster)" -lt 7 ]; then fenster_auf; else ausgefuehrt=0; fi ;;
		fenster_zu)
			if [ "$(offene_fenster)" -gt 2 ]; then fenster_zu; else ausgefuehrt=0; fi ;;
		ziehen_maus)
			if [ "$MAUS_OK" = 1 ]; then ziehen_maus; else ausgefuehrt=0; fi ;;
		ziehen_tastatur)
			if [ "$TASTEN_OK" = 1 ]; then ziehen_tastatur; else ausgefuehrt=0; fi ;;
		hotplug|panelhoehe)
			"$aktion" ;;
		*)
			eval "$aktion" ;;
	esac

	if [ "$ausgefuehrt" = 1 ]; then
		AUSGEFUEHRT=$(( AUSGEFUEHRT + 1 ))
		ZAEHLER["$aktion"]=$(( ${ZAEHLER["$aktion"]:-0} + 1 ))
		case "$aktion" in
			hotplug|panelhoehe|ziehen_*) ;;
			*) melde "aktion: $aktion" ;;
		esac
	else
		UEBERSPRUNGEN=$(( UEBERSPRUNGEN + 1 ))
	fi

	sleep $(( 10 + RANDOM % 60 ))
done

# Ausgangslage der technischen Anlässe wiederherstellen
[ "$PANEL_HOCH" = 1 ] && panelhoehe
edp_aktiv || { melde "hotplug: eDP-1 an (Abschluss)"; edp_an; }

melde "== Fall 27b Last beendet, $AUSGEFUEHRT Aktionen ausgeführt, $UEBERSPRUNGEN übersprungen =="
for k in "${!ZAEHLER[@]}"; do
	melde "zähler: $k = ${ZAEHLER[$k]}"
done
