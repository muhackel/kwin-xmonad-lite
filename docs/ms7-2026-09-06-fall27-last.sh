#!/usr/bin/env bash
# Skriptgesteuerte Last fuer Fall 27 der MS7-Abnahme.
# Loest in unregelmaessigen Abstaenden Fenster- und Controllerereignisse aus.
# Strikt ueber D-Bus und Prozesssteuerung; keine Geometrie wird selbst gesetzt.
set -uo pipefail

export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
export WAYLAND_DISPLAY=wayland-0
export QT_QPA_PLATFORM=wayland

DAUER="${1:-3900}"
ENDE=$(( $(date +%s) + DAUER ))
ZAEHLER=0

kurz() {
	busctl --user call org.kde.kglobalaccel /component/kwin \
		org.kde.kglobalaccel.Component invokeShortcut s "$1" >/dev/null 2>&1
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
)

while [ "$(date +%s)" -lt "$ENDE" ]; do
	i=$(( RANDOM % ${#AKTIONEN[@]} ))
	aktion="${AKTIONEN[$i]}"

	if [ "$aktion" = "fenster_auf" ]; then
		[ "$(offene_fenster)" -lt 7 ] && fenster_auf
	elif [ "$aktion" = "fenster_zu" ]; then
		[ "$(offene_fenster)" -gt 2 ] && fenster_zu
	else
		eval "$aktion"
	fi

	ZAEHLER=$(( ZAEHLER + 1 ))
	sleep $(( 15 + RANDOM % 70 ))
done

systemd-cat -t kxl-abnahme echo "== Fall 27 Last beendet, $ZAEHLER Aktionen =="
