{
  description = "Schlanker KWin-Layout-Controller im Stil von XMonads Tall- und Full-Layout für Plasma 6 auf Wayland";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable-small";

    # Home Manager und plasma-manager sind Inputs, weil das Home-Manager-Modul
    # neben `home.packages` plasma-manager-Optionen setzt und
    # `checks.home-module` eine vollständige Home-Manager-Auswertung baut. Beide
    # folgen dem nixpkgs-Pin dieses Flakes, plasma-manager zusätzlich dem
    # Home-Manager-Pin — sonst wertete der Check eine andere Version aus als der
    # einbindende Host.
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    plasma-manager = {
      url = "github:nix-community/plasma-manager";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.home-manager.follows = "home-manager";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      plasma-manager,
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};

      packageFor = system: (pkgsFor system).callPackage ./nix/package.nix { };

      # Die Entwicklungswerkzeuge bestehen aus scripts/lib.sh plus dem
      # jeweiligen Skript. writeShellApplication setzt errexit/nounset/pipefail
      # und lässt shellcheck über das Ergebnis laufen.
      mkTool =
        system:
        {
          name,
          file,
          env ? "",
          # Nur die Werkzeuge, die den NDJSON-Auswerter starten, brauchen Node.
          extraInputs ? [ ],
        }:
        let
          pkgs = pkgsFor system;
        in
        pkgs.writeShellApplication {
          name = "kwin-xmonad-lite-${name}";
          runtimeInputs = [
            pkgs.coreutils
            pkgs.diffutils
            pkgs.gawk
            pkgs.gnugrep
            pkgs.gnused
            pkgs.systemd # busctl, journalctl
            pkgs.kdePackages.kconfig # kwriteconfig6
            pkgs.kdePackages.libkscreen # kscreen-doctor
          ]
          ++ extraInputs;
          text = ''
            ${env}
            ${builtins.readFile ./scripts/lib.sh}
            ${builtins.readFile file}
          '';
        };

      toolsFor =
        system:
        let
          package = packageFor system;
          mainJs = "${package}/share/kwin/scripts/kwin-xmonad-lite/contents/code/main.js";
          devMenuJs = "${package}/share/kwin-xmonad-lite-dev/dev.js";
          pkgs = pkgsFor system;
          sizeWindowPython = pkgs.python3.withPackages (pythonPackages: [ pythonPackages.tkinter ]);
        in
        {
          dev-load = mkTool system {
            name = "dev-load";
            file = ./scripts/dev-load.sh;
            env = ''
              XML_MAIN_JS="${mainJs}"
              XML_DEV_MENU_JS="${devMenuJs}"
            '';
          };
          reload = mkTool system {
            name = "reload";
            file = ./scripts/reload.sh;
            env = ''XML_MAIN_JS="${mainJs}"'';
          };
          logs = mkTool system {
            name = "logs";
            file = ./scripts/logs.sh;
          };
          probe = mkTool system {
            name = "probe";
            file = ./scripts/probe.sh;
            env = ''XML_PROBE_JS="${./dev/probe/probe.js}"'';
          };
          probe-signals = mkTool system {
            name = "probe-signals";
            file = ./scripts/probe-signals.sh;
            env = ''XML_SIGNALS_JS="${./dev/probe/signals.js}"'';
          };
          # Der Auswerter importiert den Layoutkern aus `src`, deshalb zeigt
          # sein Pfad in den Quellbaum und nicht auf die einzelne Datei.
          probe-geometry = mkTool system {
            name = "probe-geometry";
            file = ./scripts/probe-geometry.sh;
            extraInputs = [ pkgs.nodejs ];
            env = ''
              XML_GEOMETRY_JS="${./dev/probe/geometry.js}"
              XML_GEOMETRY_EXPECT="${self}/dev/probe/expect-geometry-cli.ts"
            '';
          };
          unload = mkTool system {
            name = "unload";
            file = ./scripts/unload.sh;
          };
          audit = mkTool system {
            name = "audit";
            file = ./scripts/audit.sh;
            extraInputs = [ pkgs.nodejs ];
            env = ''XML_AUDIT="${self}/dev/probe/journal-audit-cli.ts"'';
          };
          size-window = pkgs.writeShellApplication {
            name = "kwin-xmonad-lite-size-window";
            runtimeInputs = [ sizeWindowPython ];
            text = ''
              exec python3 ${./dev/size-window.py} "$@"
            '';
          };
        };

      # Ohne meta.description beanstandet `nix flake check` jede App.
      appFor = description: tool: {
        type = "app";
        program = nixpkgs.lib.getExe tool;
        meta.description = description;
      };
    in
    {
      packages = forAllSystems (
        system: rec {
          default = kwin-xmonad-lite;
          kwin-xmonad-lite = packageFor system;
        }
      );

      apps = forAllSystems (
        system:
        let
          tools = toolsFor system;
          loadDescription = "Skript über KWins Scripting-D-Bus laden (--menu für das Dev-Bundle)";
        in
        {
          default = appFor loadDescription tools.dev-load;
          dev-load = appFor loadDescription tools.dev-load;
          reload = appFor "Entwicklungsinstanz aus dem aktuellen Store-Pfad neu laden" tools.reload;
          logs = appFor "Journal von KWin, auf die Zeilen des Controllers gefiltert" tools.logs;
          probe = appFor "Feature-Probe der Skriptumgebung ausführen" tools.probe;
          probe-signals = appFor "Signalprobe: welche Signale im Betrieb ankommen" tools.probe-signals;
          probe-geometry =
            appFor "Geometrie-Probe: anliegende Fenstergeometrien messen und auswerten"
              tools.probe-geometry;
          unload = appFor "Geladene Entwicklungsinstanz entladen" tools.unload;
          audit = appFor "Journal auf Geometrie-Schleifen prüfen (--stunde für Fall 27)" tools.audit;
          size-window =
            appFor "Xwayland-Testclient für Mindest-, Höchst- und Rastergrößen"
              tools.size-window;
        }
      );

      devShells = forAllSystems (system: {
        default = (pkgsFor system).callPackage ./nix/devshell.nix { };
      });

      # Systemunabhängig, deshalb ohne `forAllSystems`: das Modul löst sein
      # Paket erst in der Home-Manager-Auswertung über deren `pkgs` auf. `self`
      # bekommt es dabei fest mitgegeben, siehe Kommentar in nix/home-module.nix.
      #
      # `homeModules` ist der Name, den Nix 2.34 als Flake-Output kennt;
      # `homeManagerModules` ist derselbe Wert unter dem älteren Namen, weil
      # `nixosconfig` ihn so einbindet. Für den älteren Namen meldet
      # `nix flake check` eine Warnung ("unknown flake output"), keinen Fehler —
      # Home Manager und plasma-manager haben ihn ebenfalls schon umbenannt.
      homeModules.default = import ./nix/home-module.nix { inherit self; };
      homeManagerModules.default = self.homeModules.default;

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          tools = toolsFor system;

          # Eindeutige Paket-Derivation für die Modulprüfung. Ein bloßer Test
          # auf den Vorgabepfad könnte nicht unterscheiden, ob das Modul
          # `cfg.package` oder versehentlich ein fest verdrahtetes Paket nutzt.
          homeModuleTestPackage = pkgs.writeTextDir "share/kwin-xmonad-lite-check/paket" "Paketprüfung";

          hasHomeModuleTestPackage = homeConfig: builtins.elem (toString homeModuleTestPackage) (
            builtins.map toString homeConfig.config.home.packages
          );

          # Beide Home-Manager-Checks werten dieselbe Grundkonfiguration aus
          # und unterscheiden sich nur im Prüfmodul. Ohne den gemeinsamen
          # Aufbau liefe der Aus-Zweig Gefahr, versehentlich gegen eine andere
          # plasma-manager-Fassung geprüft zu werden als der Ein-Zweig.
          mkHomeConfig =
            pruefmodul:
            home-manager.lib.homeManagerConfiguration {
              inherit pkgs;
              modules = [
                plasma-manager.homeModules.plasma-manager
                self.homeModules.default
                {
                  home = {
                    username = "pruefer";
                    homeDirectory = "/home/pruefer";
                    stateVersion = "25.05";
                  };
                }
                pruefmodul
              ];
            };

          # Findet die `data.json` im Aktivierungspaket und stellt `pruefe`
          # bereit. `pruefe` beendet mit `exit 1`; es darf deshalb nie in einer
          # Subshell (Pipe, Kommandosubstitution) aufgerufen werden, dort bliebe
          # der Fehlschlag folgenlos.
          findDataJson = ''
            plasmaScript="$(grep -om1 '/nix/store/[0-9a-z]\{32\}-plasma-config' "$activation/activate")"
            if [ -z "$plasmaScript" ]; then
              echo "kein plasma-config-Skript im Aktivierungspaket gefunden" >&2
              exit 1
            fi

            data="$(grep -om1 '/nix/store/[0-9a-z]\{32\}-data.json' "$plasmaScript")"
            if [ -z "$data" ]; then
              echo "keine data.json in $plasmaScript gefunden" >&2
              exit 1
            fi

            pruefe() {
              if ! jq -e "$1" "$data" > /dev/null; then
                echo "Erwartung nicht erfüllt: $1" >&2
                exit 1
              fi
            }
          '';

          # Zieht die `objectName`/`keys`-Paare aus `SHORTCUTS` in
          # `src/kwin/command.ts` nach `$TMPDIR/paare`, tabgetrennt, eine Zeile
          # je Aktion. Der Quelltext ist die maßgebliche Tabelle; die
          # Nix-Fassung in `nix/home-module.nix` wird gegen ihn gehalten.
          extractShortcuts = ''
            awk '
              /objectName: "/ { obj = $0; sub(/.*objectName: "/, "", obj); sub(/".*/, "", obj); next }
              /keys: "/ && obj != "" { k = $0; sub(/.*keys: "/, "", k); sub(/".*/, "", k); print obj "\t" k; obj = "" }
            ' ${self}/src/kwin/command.ts > "$TMPDIR/paare"

            anzahl="$(wc -l < "$TMPDIR/paare")"
            if [ "$anzahl" -ne 12 ]; then
              echo "SHORTCUTS in src/kwin/command.ts liefert $anzahl Paare, erwartet sind zwölf" >&2
              exit 1
            fi
          '';
        in
        {
          # Typprüfung, Unit-Tests und Bundle stecken in der buildPhase.
          package = packageFor system;

          lint = pkgs.runCommand "kwin-xmonad-lite-lint" { nativeBuildInputs = [ pkgs.biome ]; } ''
            export HOME="$TMPDIR"
            cd ${self}
            biome check .
            touch "$out"
          '';

          # Die Snapshot-Grenze als Check statt nur als Hand-Grep in build.md.
          # Eine KWin-Global außerhalb der vier erlaubten Dateien zieht Logik
          # aus den Unit-Tests heraus, ohne dass ein Typfehler entstünde:
          # `globals.d.ts` gilt für den ganzen Baum, `tsc` beanstandet einen
          # `workspace`-Zugriff in `core/` oder `state/` also nicht.
          #
          # Das Musterpaar ist mit dem Abschnitt „Die Grenze ist nachprüfbar"
          # in build.md deckungsgleich zu halten. Gesucht werden die nackten
          # Bezeichner statt nur Punktzugriffe: damit fallen auch Klammerzugriffe,
          # Aliase und `new (QTimer)` auf. Der zweite `grep` wirft die
          # Typdeklaration und Kommentarzeilen weg -- `types.ts` und `timer.ts`
          # erwähnen die Globals in ihren Erklärungen, ohne sie zu benutzen.
          #
          # Jeder `grep` schreibt mit `|| true` in eine Datei, statt drei
          # Aufrufe in eine Bedingung zu ketten: stdenv setzt
          # `set -eu -o pipefail`, und ein `grep` ohne Treffer liefert 1 --
          # das risse den Build ausgerechnet im Erfolgsfall ab.
          snapshot-boundary = pkgs.runCommand "kwin-xmonad-lite-snapshot-boundary" { } ''
            cd ${self}

            grep -rnE '(^|[^[:alnum:]_$])(workspace|KWin|QTimer|options|registerUserActionsMenu|registerShortcut|readConfig)([^[:alnum:]_$]|$)' src --include='*.ts' > "$TMPDIR/roh" || true
            grep -vE '(globals\.d\.ts|:[0-9]+:[[:space:]]*(\*|//|/\*))' "$TMPDIR/roh" > "$TMPDIR/treffer" || true
            grep -vE '^src/(boot|dev)\.ts:|^src/kwin/(read|adapter)\.ts:' "$TMPDIR/treffer" > "$TMPDIR/verstoesse" || true

            if [ -s "$TMPDIR/verstoesse" ]; then
              echo "Snapshot-Grenze verletzt: eine KWin-Global außerhalb von src/boot.ts, src/dev.ts, src/kwin/read.ts und src/kwin/adapter.ts" >&2
              cat "$TMPDIR/verstoesse" >&2
              exit 1
            fi

            touch "$out"
          '';

          # Die Geometrie-Probe darf das Prüfergebnis nicht selbst herstellen.
          # Verboten sind Schreibpfade und jede Verbindung zu einem KWin-,
          # Fenster- oder Output-Signal; erlaubt ist `timeout.connect` an
          # eigenen QTimern -- ohne das gäbe es keine zeitversetzten Samples.
          probe-readonly = pkgs.runCommand "kwin-xmonad-lite-probe-readonly" { } ''
            cd ${self}

            grep -nE '(frameGeometry[[:space:]]*=|moveResize|activeWindow[[:space:]]*=|raiseWindow|setMaximize|setFullScreen|rootTile)' \
              dev/probe/geometry.js > "$TMPDIR/schreibt" || true
            grep -nE '\.connect\(' dev/probe/geometry.js > "$TMPDIR/verbindet.roh" || true
            grep -vE 'timeout\.connect\(' "$TMPDIR/verbindet.roh" > "$TMPDIR/verbindet" || true
            grep -nE '(frameGeometryChanged|windowAdded|windowRemoved|windowActivated|outputChanged|screensChanged|screenOrderChanged|virtualScreenGeometryChanged|desktopsChanged|activitiesChanged|currentDesktopChanged|currentActivityChanged|interactiveMoveResize|\bclosed\b)' \
              dev/probe/geometry.js > "$TMPDIR/signale" || true

            # Kommentarzeilen zaehlen nicht: die Datei begruendet ihre Regeln
            # im Kopf und nennt die verbotenen Namen dabei.
            for datei in schreibt verbindet signale; do
              grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)' "$TMPDIR/$datei" > "$TMPDIR/$datei.echt" || true
            done

            if [ -s "$TMPDIR/schreibt.echt" ] || [ -s "$TMPDIR/verbindet.echt" ] || [ -s "$TMPDIR/signale.echt" ]; then
              echo "dev/probe/geometry.js ist nicht mehr strikt lesend:" >&2
              cat "$TMPDIR/schreibt.echt" "$TMPDIR/verbindet.echt" "$TMPDIR/signale.echt" >&2
              exit 1
            fi

            touch "$out"
          '';

          # `activate` ist der einzige Schreibpfad auf `workspace.activeWindow`.
          # Daran haengt die Schleifenfreiheit: Aktivieren loest
          # `windowActivated` aus, das eine Epoche anmeldet, und die Epoche
          # aktiviert nie selbst. Ein zweiter Schreibpfad baute die Schleife --
          # und waere im Journal nicht von einem einzelnen Versuch zu
          # unterscheiden (Fall 20b).
          activate-once = pkgs.runCommand "kwin-xmonad-lite-activate-once" { } ''
            cd ${self}

            grep -rn 'activeWindow[[:space:]]*=' src --include='*.ts' > "$TMPDIR/roh" || true
            grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)' "$TMPDIR/roh" > "$TMPDIR/treffer" || true

            anzahl="$(wc -l < "$TMPDIR/treffer")"
            if [ "$anzahl" != "1" ]; then
              echo "erwartet genau einen Schreibzugriff auf workspace.activeWindow, gefunden $anzahl:" >&2
              cat "$TMPDIR/treffer" >&2
              exit 1
            fi
            if ! grep -q '^src/kwin/adapter\.ts:' "$TMPDIR/treffer"; then
              echo "der Schreibzugriff steht nicht in src/kwin/adapter.ts:" >&2
              cat "$TMPDIR/treffer" >&2
              exit 1
            fi

            touch "$out"
          '';

          # QJSEngine ist kein Node: esbuild liefert **keine Polyfills**, und die
          # Zielstufe ist `es2016`. Ein Aufruf von `Object.fromEntries` oder
          # `String.prototype.replaceAll` übersteht jeden Typcheck und jeden
          # Unit-Test unter Node -- und wirft erst in KWin, zur Laufzeit, wo ihn
          # niemand sieht außer im Journal. Genau diese Lücke schließt der
          # Check: er greift das **gebaute** Bundle an, nicht den Quelltext,
          # denn erst dort steht, was KWin wirklich ausführt (auch das, was aus
          # einer Abhängigkeit oder einem esbuild-Helfer stammt).
          #
          # Die Liste ist die aus `CLAUDE.md`, Abschnitt „Sprachumgebung",
          # gemessen an KWin 6.7.4 / Qt 6.11.2. `await` steht dabei für etwas
          # anderes als die übrigen Muster: esbuild wandelt `async`/`await` bei
          # `--target=es2016` selbst um, ein übrig gebliebenes `await` im Bundle
          # bedeutet also, dass die Zielstufe verstellt wurde. Deshalb wird sie
          # zusätzlich direkt in `nix/package.nix` geprüft.
          #
          # **Grenze des Checks:** Grep sieht Namen, keine Syntax. Klassenfelder,
          # statische Blöcke und Objekt-Spread lassen sich damit nicht sicher
          # erkennen, ohne bei legitimem Code Fehlalarm zu schlagen; sie bleiben
          # ungeprüft. Der Check ersetzt deshalb keinen Ladeversuch in einer
          # echten KWin-Instanz, er fängt nur die Klasse von Fehlern, die dort
          # am teuersten auffällt.
          bundle-runtime = pkgs.runCommand "kwin-xmonad-lite-bundle-runtime" { } ''
            paket=${self.packages.${system}.default}
            haupt="$paket/share/kwin/scripts/kwin-xmonad-lite/contents/code/main.js"
            dev="$paket/share/kwin-xmonad-lite-dev/dev.js"

            for datei in "$haupt" "$dev"; do
              if [ ! -f "$datei" ]; then
                echo "Bundle fehlt: $datei" >&2
                exit 1
              fi
            done

            # Fehlen zur Laufzeit ersatzlos; esbuild polyfillt nichts.
            fehlend='Object\.fromEntries|Object\.hasOwn|Promise\.allSettled|Promise\.any\(|globalThis'
            fehlend="$fehlend"'|\.flatMap\(|\.findLast\(|\.findLastIndex\(|\.toSorted\(|\.toReversed\(|\.flat\(|\.at\('
            fehlend="$fehlend"'|\.replaceAll\(|\.trimStart\(|\.trimEnd\(|\.matchAll\('
            # Existieren in QJSEngine nicht: kein Timer-Global, kein
            # QTimer.restart, und `match.groups` bleibt undefined.
            fehlend="$fehlend"'|[^[:alnum:]_$]setTimeout\(|[^[:alnum:]_$]setInterval\(|\.restart\(|\.groups'
            # Zeugt von verstellter Zielstufe.
            fehlend="$fehlend"'|[^[:alnum:]_$]await[[:space:]]'

            grep -nE "$fehlend" "$haupt" > "$TMPDIR/treffer" || true
            grep -nE "$fehlend" "$dev" >> "$TMPDIR/treffer" || true

            if [ -s "$TMPDIR/treffer" ]; then
              echo "Das gebaute Bundle benutzt etwas, das QJSEngine nicht hat:" >&2
              cat "$TMPDIR/treffer" >&2
              echo "Siehe CLAUDE.md, Abschnitt Sprachumgebung." >&2
              exit 1
            fi

            anzahl="$(grep -c -- '--target=es2016' ${self}/nix/package.nix || true)"
            if [ "$anzahl" != "2" ]; then
              echo "erwartet zweimal --target=es2016 in nix/package.nix, gefunden $anzahl" >&2
              exit 1
            fi

            touch "$out"
          '';

          # Baut die Entwicklungswerkzeuge und lässt damit shellcheck laufen.
          scripts = pkgs.symlinkJoin {
            name = "kwin-xmonad-lite-scripts";
            paths = builtins.attrValues tools;
          };

          # Wertet das Home-Manager-Modul mit **aktiviertem** Zweig aus und baut
          # das Aktivierungspaket. Ein bloßer Import prüfte nur die
          # Optionsdeklarationen, nicht das, was unter `mkIf cfg.enable` steht.
          #
          # Geprüft wird die JSON-Beschreibung, die plasma-manager erzeugt:
          # `kwinrc` selbst entsteht erst zur Aktivierungszeit auf der Maschine
          # (modules/files.nix hängt ein Skript in `home.activation`, das
          # script/write_config.py mit einer `data.json` aufruft). Statisch im
          # Store liegt deshalb genau diese `data.json` — sie trägt jeden
          # Schlüssel mit seinem Wert und ist die einzige belastbare Quelle
          # innerhalb einer Derivation. Der Weg dorthin führt über das
          # `activate`-Skript, das den Pfad des `plasma-config`-Skripts nennt,
          # und von dort auf die `data.json`.
          home-module =
            let
              homeConfig = mkHomeConfig {
                programs.kwin-xmonad-lite = {
                  enable = true;
                  package = homeModuleTestPackage;
                  relocateKdeShortcuts = true;
                  # `excludes` bleibt bewusst ungesetzt: der Check weist
                  # damit nach, dass auch ein nicht gesetzter Schlüssel mit
                  # seinem Default geschrieben wird.
                  settings = {
                    gapOuter = 8;
                    gapInner = 4;
                    masterRatio = 0.5;
                    defaultLayout = "full";
                    debug = true;
                  };
                };
              };

              # Eigene Auswertung, damit der Standardfall alle zwölf
              # Erstbelegungen unmaskiert gegen TypeScript prüfen kann.
              overrideConfig = mkHomeConfig {
                programs.kwin-xmonad-lite = {
                  enable = true;
                  package = homeModuleTestPackage;
                  shortcuts."xml-focus-next" = "Meta+Y";
                };
              };
            in
            pkgs.runCommand "kwin-xmonad-lite-home-module"
              {
                nativeBuildInputs = [ pkgs.jq ];
                activation = homeConfig.activationPackage;
                overrideActivation = overrideConfig.activationPackage;
                packagePresent =
                  if hasHomeModuleTestPackage homeConfig then
                    "true"
                  else
                    throw "checks.home-module: das konfigurierte Paket fehlt in home.packages";
              }
              ''
                test "$packagePresent" = true

                ${findDataJson}

                kwinrc='."/home/pruefer/.config/kwinrc"'
                gruppe="$kwinrc.\"Script-kwin-xmonad-lite\""
                shortcuts='."/home/pruefer/.config/kglobalshortcutsrc"'

                pruefe "$kwinrc.Plugins.\"kwin-xmonad-liteEnabled\".value == true"

                pruefe "$gruppe.gapOuter.value == 8"
                pruefe "$gruppe.gapInner.value == 4"
                pruefe "$gruppe.masterRatio.value == 0.5"
                pruefe "$gruppe.defaultLayout.value == \"full\""
                pruefe "$gruppe.debug.value == true"
                pruefe "$gruppe.excludes.value == \"krunner,yakuake,kded6,polkit-kde-authentication-agent-1,plasmashell,xwaylandvideobridge,steam_app_default\""

                ${extractShortcuts}

                pruefe "[$shortcuts.kwin | keys[] | select(startswith(\"xml-\"))] | length == 12"

                # Die Nix-Tabelle gegen die TypeScript-Tabelle: `defaultShortcuts`
                # in nix/home-module.nix und `SHORTCUTS` in src/kwin/command.ts
                # sind sonst nur je für sich geprüft und könnten unbemerkt
                # auseinanderlaufen. Der Standardfall enthält bewusst keinen
                # `shortcuts`-Override. plasma-manager hängt an jede Taste die
                # leere Vorgabeliste und den leeren Anzeigenamen an.
                #
                # Die Schleife liest aus einer Datei, nicht aus einer Pipe:
                # `pruefe` beendet mit `exit 1`, und in der Subshell einer
                # Pipeline bliebe der Fehlschlag folgenlos.
                while IFS="$(printf '\t')" read -r objectName keys; do
                  pruefe "$shortcuts.kwin.\"$objectName\".value == \"$keys,,\""
                done < "$TMPDIR/paare"

                pruefe "$shortcuts.kwin.\"Edit Tiles\".value == \"none,,\""
                pruefe "$shortcuts.ksmserver.\"Lock Session\".value == \"Screensaver\\tCtrl+Alt+L,,\""

                # Ein abweichender, ausdrücklich gesetzter Wert muss den
                # Erstinstallationswert ersetzen. Dafür wird ein zweites
                # Aktivierungspaket ausgewertet, damit der Default-Abgleich oben
                # vollständig bleibt.
                activation="$overrideActivation"
                ${findDataJson}
                shortcuts='."/home/pruefer/.config/kglobalshortcutsrc"'
                pruefe "$shortcuts.kwin.\"xml-focus-next\".value == \"Meta+Y,,\""

                touch "$out"
              '';

          # Die Regressionsprüfung zum Aus-Zweig. Ohne sie fiel nicht auf, dass
          # `enable = false` nichts zurücknimmt: plasma-manager läuft mit
          # `overrideConfig = false` und löscht keinen Schlüssel, und
          # `objectName`s lassen sich nicht abmelden -- ohne ein geschriebenes
          # `none` behalten die zwölf `xml-*`-Zeilen ihre Taste.
          home-module-disabled =
            let
              homeConfig = mkHomeConfig {
                # plasma-manager muss hier ausdrücklich an sein: der Aus-Zweig
                # schaltet es nicht selbst ein (das täte nur der Ein-Zweig),
                # und ohne plasma-manager entstünde gar keine `data.json` --
                # der Check prüfte dann Leere und wäre wertlos.
                programs.plasma.enable = true;
                programs.kwin-xmonad-lite = {
                  enable = false;
                  package = homeModuleTestPackage;
                  # Muss im Aus-Zustand wirkungslos bleiben. Ein Rückfall auf
                  # die bloße Schalterbedingung kollidiert mit den beiden
                  # Host-Rückbelegungen darunter.
                  relocateKdeShortcuts = true;
                };
                programs.plasma.shortcuts.ksmserver."Lock Session" = [
                  "Screensaver"
                  "Meta+L"
                ];
                programs.plasma.shortcuts.kwin."Edit Tiles" = [ "Meta+T" ];
              };
            in
            pkgs.runCommand "kwin-xmonad-lite-home-module-disabled"
              {
                nativeBuildInputs = [ pkgs.jq ];
                activation = homeConfig.activationPackage;
                packageAbsent =
                  if !hasHomeModuleTestPackage homeConfig then
                    "true"
                  else
                    throw "checks.home-module-disabled: das konfigurierte Paket steht trotz Aus-Zustand in home.packages";
              }
              ''
                test "$packageAbsent" = true

                ${findDataJson}

                kwinrc='."/home/pruefer/.config/kwinrc"'
                shortcuts='."/home/pruefer/.config/kglobalshortcutsrc"'

                pruefe "$kwinrc.Plugins.\"kwin-xmonad-liteEnabled\".value == false"

                ${extractShortcuts}

                pruefe "[$shortcuts.kwin | keys[] | select(startswith(\"xml-\"))] | length == 12"

                # Freigegeben werden muss genau die Menge, die das Skript
                # registriert -- deshalb kommen die Namen auch hier aus dem
                # Quelltext und nicht aus einer zweiten Liste.
                while IFS="$(printf '\t')" read -r objectName keys; do
                  pruefe "$shortcuts.kwin.\"$objectName\".value == \"none,,\""
                done < "$TMPDIR/paare"

                pruefe "$shortcuts.kwin.\"Edit Tiles\".value == \"Meta+T,,\""
                pruefe "$shortcuts.ksmserver.\"Lock Session\".value == \"Screensaver\\tMeta+L,,\""

                touch "$out"
              '';
        }
      );
    };
}
