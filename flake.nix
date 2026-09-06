{
  description = "Schlanker KWin-Layout-Controller im Stil von XMonads Tall- und Full-Layout für Plasma 6 auf Wayland";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable-small";

  outputs =
    { self, nixpkgs }:
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

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          tools = toolsFor system;
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

          # Baut die Entwicklungswerkzeuge und lässt damit shellcheck laufen.
          scripts = pkgs.symlinkJoin {
            name = "kwin-xmonad-lite-scripts";
            paths = builtins.attrValues tools;
          };
        }
      );
    };
}
