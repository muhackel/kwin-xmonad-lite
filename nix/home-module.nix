# Home-Manager-Modul für kwin-xmonad-lite (kein NixOS-Modul).
#
# Es setzt ausschließlich Optionen von plasma-manager; die Datei `kwinrc` wird
# also von plasma-manager geschrieben, nicht von diesem Modul. Vorausgesetzt ist
# deshalb, dass `plasma-manager.homeModules.plasma-manager` in derselben
# Home-Manager-Konfiguration liegt (in `nixosconfig` über
# `home-manager.sharedModules`).
#
# Die äußere Funktion nimmt das Flake dieses Projekts (`self`) entgegen, damit
# der Vorgabewert von `package` auf das mitgelieferte Paket zeigen kann:
# `flake.nix` bindet sie als
# `homeModules.default = import ./nix/home-module.nix { inherit self; }` ein;
# `homeManagerModules.default` ist derselbe Wert unter dem älteren Namen. Ein Modul bekommt die Flake-Inputs nicht von selbst durchgereicht, und
# ein Overlay griffe in die Paketmenge des Nutzers ein — die Teilanwendung ist
# die in nixpkgs und Home Manager übliche Form für genau diesen Fall.
{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.kwin-xmonad-lite;

  # Ausschlussliste auf `resourceClass`. Diese Fenster sollen nie gekachelt
  # werden; die Liste entspricht `DEFAULT_EXCLUDES` im Skript.
  defaultExcludes = [
    "krunner"
    "yakuake"
    "kded6"
    "polkit-kde-authentication-agent-1"
    "plasmashell"
    "xwaylandvideobridge"
    "steam_app_default"
  ];

  installedPackages = [ cfg.package ];

  settingsType = lib.types.submodule {
    options = {
      gapOuter = lib.mkOption {
        type = lib.types.ints.between 0 200;
        default = 0;
        description = "Abstand zum Rand der Arbeitsfläche in Pixeln.";
      };

      gapInner = lib.mkOption {
        type = lib.types.ints.between 0 200;
        default = 0;
        description = "Abstand zwischen den Zellen in Pixeln.";
      };

      excludes = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = defaultExcludes;
        description = ''
          Fensterklassen (`resourceClass`), die nicht gekachelt werden. Die
          Liste wird als kommagetrennte Zeichenkette nach `kwinrc` geschrieben.
          Eine leere Liste heißt „nichts ausschließen".
        '';
      };

      masterRatio = lib.mkOption {
        type = lib.types.numbers.between 0.1 0.9;
        default = 0.65;
        description = ''
          Anteil der Masterspalte an der Arbeitsfläche. Wirkt auf neu angelegte
          Surfaces und als Ziel von `xml-reset-layout`.
        '';
      };

      defaultLayout = lib.mkOption {
        type = lib.types.enum [
          "tall"
          "full"
        ];
        default = "tall";
        description = "Layout, mit dem eine neu angelegte Surface startet.";
      };

      debug = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Ausführlichere Journalzeilen des Controllers.";
      };
    };
  };

  # Die Gruppe [Script-kwin-xmonad-lite] in `kwinrc`, aus der das Skript per
  # `readConfig` liest.
  #
  # Bewusst werden **alle sechs** Schlüssel geschrieben, auch die unveränderten:
  # plasma-manager läuft mit `overrideConfig = false` und löscht nicht mehr
  # deklarierte Schlüssel nicht. Ohne das vollständige Schreiben bliebe nach dem
  # Entfernen eines `settings`-Wertes aus der Nix-Konfiguration der alte Wert in
  # `kwinrc` stehen und wäre nur von Hand wieder loszuwerden.
  # `overrideConfig = true` scheidet als Gegenmittel aus — das setzte fremde
  # Plasma-Konfiguration zurück.
  scriptGroup = {
    inherit (cfg.settings)
      gapOuter
      gapInner
      masterRatio
      defaultLayout
      debug
      ;
    excludes = lib.concatStringsSep "," cfg.settings.excludes;
  };
in
{
  options.programs.kwin-xmonad-lite = {
    enable = lib.mkEnableOption "den Layout-Controller kwin-xmonad-lite als KWin-Skript";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.kwin-xmonad-lite;
      defaultText = lib.literalExpression "kwin-xmonad-lite.packages.\${system}.kwin-xmonad-lite";
      description = "Das Paket, das das KPackage bereitstellt.";
    };

    settings = lib.mkOption {
      type = settingsType;
      default = { };
      example = {
        gapOuter = 8;
        gapInner = 4;
        masterRatio = 0.6;
      };
      description = ''
        Werte für die Gruppe `[Script-kwin-xmonad-lite]` in `kwinrc`. Sie werden
        beim Laden des Skripts gelesen; eine Änderung wird erst nach erneuter
        Anmeldung wirksam.
      '';
    };

    shortcuts = lib.mkOption {
      type = lib.types.attrsOf (lib.types.either lib.types.str (lib.types.listOf lib.types.str));
      default = { };
      example = {
        "xml-focus-next" = "Meta+J";
        "xml-toggle-float" = [ "Meta+Shift+T" ];
      };
      description = ''
        Tastenkürzel für die `xml-*`-Aktionen, geschrieben nach
        `programs.plasma.shortcuts.kwin`. Bleibt die Menge leer, gelten die vom
        Skript selbst registrierten Erstbelegungen.
      '';
    };

    # `mkEnableOption` klammert sein Argument in "Whether to enable X." --
    # deshalb hier nur die Kurzform, der Rest über `description`.
    relocateKdeShortcuts = lib.mkEnableOption "das Umlegen der kollidierenden KDE-Kürzel" // {
      description = ''
        Legt „Sitzung sperren" auf `Ctrl+Alt+L` und nimmt „Kachelung
        bearbeiten" die Taste, damit `xml-expand` (`Meta+L`) und `xml-sink`
        (`Meta+T`) ihre Belegung überhaupt bekommen.

        Standardmäßig aus: die Shortcut-Politik gehört in die
        Host-Konfiguration und nicht in dieses Modul.
      '';
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      home.packages = installedPackages;

      # plasma-manager schreibt die Konfiguration nur, wenn es selbst aktiv ist.
      # `mkDefault`, damit eine Host-Konfiguration die Entscheidung behält.
      programs.plasma.enable = lib.mkDefault true;

      programs.plasma.configFile."kwinrc" = {
        Plugins."kwin-xmonad-liteEnabled" = true;
        "Script-kwin-xmonad-lite" = scriptGroup;
      };

      programs.plasma.shortcuts.kwin = cfg.shortcuts;
    }

    (lib.mkIf cfg.relocateKdeShortcuts {
      programs.plasma.shortcuts.ksmserver."Lock Session" = [
        "Screensaver"
        "Ctrl+Alt+L"
      ];
      programs.plasma.shortcuts.kwin."Edit Tiles" = [ ];
    })
  ]);
}
