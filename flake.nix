{
  description = "Schlanker KWin-Layout-Controller im Stil von XMonads Tall- und Full-Layout für Plasma 6 auf Wayland";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable-small";

    # Home Manager und plasma-manager sind Inputs, weil das Home-Manager-Modul
    # ausschließlich plasma-manager-Optionen setzt und `checks.home-module` eine
    # vollständige Home-Manager-Auswertung baut. Beide folgen dem nixpkgs-Pin
    # dieses Flakes, plasma-manager zusätzlich dem Home-Manager-Pin — sonst
    # wertete der Check eine andere Version aus als der einbindende Host.
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
          ];
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
          unload = mkTool system {
            name = "unload";
            file = ./scripts/unload.sh;
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
          unload = appFor "Geladene Entwicklungsinstanz entladen" tools.unload;
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
          # in build.md deckungsgleich zu halten. Der zweite `grep` wirft
          # Kommentarzeilen weg -- `types.ts` und `timer.ts` erwähnen die
          # Globals in ihren Erklärungen, ohne sie zu benutzen.
          #
          # Jeder `grep` schreibt mit `|| true` in eine Datei, statt drei
          # Aufrufe in eine Bedingung zu ketten: stdenv setzt
          # `set -eu -o pipefail`, und ein `grep` ohne Treffer liefert 1 --
          # das risse den Build ausgerechnet im Erfolgsfall ab.
          snapshot-boundary = pkgs.runCommand "kwin-xmonad-lite-snapshot-boundary" { } ''
            cd ${self}

            grep -rn 'workspace\.\|KWin\.\|new QTimer\|options\.\|registerUserActionsMenu\|registerShortcut\|readConfig' src > "$TMPDIR/roh" || true
            grep -vE '(globals\.d\.ts|:[0-9]+:[[:space:]]*(\*|//|/\*))' "$TMPDIR/roh" > "$TMPDIR/treffer" || true
            grep -vE '^src/(boot|dev)\.ts:|^src/kwin/(read|adapter)\.ts:' "$TMPDIR/treffer" > "$TMPDIR/verstoesse" || true

            if [ -s "$TMPDIR/verstoesse" ]; then
              echo "Snapshot-Grenze verletzt: eine KWin-Global außerhalb von src/boot.ts, src/dev.ts, src/kwin/read.ts und src/kwin/adapter.ts" >&2
              cat "$TMPDIR/verstoesse" >&2
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
                  shortcuts."xml-focus-next" = "Meta+J";
                };
              };
            in
            pkgs.runCommand "kwin-xmonad-lite-home-module"
              {
                nativeBuildInputs = [ pkgs.jq ];
                activation = homeConfig.activationPackage;
              }
              ''
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

                # Die Nix-Tabelle gegen die TypeScript-Tabelle: `defaultShortcuts`
                # in nix/home-module.nix und `SHORTCUTS` in src/kwin/command.ts
                # sind sonst nur je für sich geprüft und könnten unbemerkt
                # auseinanderlaufen. plasma-manager schreibt den Wert als
                # `Meta+J,,` (Tasten, leere Vorgabeliste, leerer Anzeigename),
                # deshalb `startswith` statt Gleichheit.
                #
                # Die Schleife liest aus einer Datei, nicht aus einer Pipe:
                # `pruefe` beendet mit `exit 1`, und in der Subshell einer
                # Pipeline bliebe der Fehlschlag folgenlos.
                while IFS="$(printf '\t')" read -r objectName keys; do
                  pruefe "$shortcuts.kwin.\"$objectName\".value | startswith(\"$keys\")"
                done < "$TMPDIR/paare"

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
                programs.kwin-xmonad-lite.enable = false;
              };
            in
            pkgs.runCommand "kwin-xmonad-lite-home-module-disabled"
              {
                nativeBuildInputs = [ pkgs.jq ];
                activation = homeConfig.activationPackage;
              }
              ''
                ${findDataJson}

                kwinrc='."/home/pruefer/.config/kwinrc"'
                shortcuts='."/home/pruefer/.config/kglobalshortcutsrc"'

                pruefe "$kwinrc.Plugins.\"kwin-xmonad-liteEnabled\".value == false"

                ${extractShortcuts}

                # Freigegeben werden muss genau die Menge, die das Skript
                # registriert -- deshalb kommen die Namen auch hier aus dem
                # Quelltext und nicht aus einer zweiten Liste.
                while IFS="$(printf '\t')" read -r objectName keys; do
                  pruefe "$shortcuts.kwin.\"$objectName\".value | startswith(\"none\")"
                done < "$TMPDIR/paare"

                touch "$out"
              '';
        }
      );
    };
}
