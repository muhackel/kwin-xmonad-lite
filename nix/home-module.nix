# Home-Manager-Modul für kwin-xmonad-lite (kein NixOS-Modul).
#
# Konfiguration schreibt es ausschließlich über Optionen von plasma-manager:
# `kwinrc` und `kglobalshortcutsrc` entstehen dort, nicht in diesem Modul.
# Selbst gesetzt wird nur `home.packages` — das KPackage muss im Profil liegen,
# damit KWin es überhaupt findet. Vorausgesetzt ist deshalb, dass
# `plasma-manager.homeModules.plasma-manager` in derselben
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

  # Die zwölf `objectName`s samt Erstbelegung, wörtlich gespiegelt aus
  # `SHORTCUTS` in `src/kwin/command.ts`. Diese Tabelle ist die einzige Quelle
  # für die Namen: aus ihr entstehen die Optionen von `shortcuts` (ein
  # Tippfehler ist damit ein Auswertungsfehler statt einer wirkungslosen Zeile
  # in `kglobalshortcutsrc`), die deklarativ geschriebene Belegung und die
  # Freigabeliste des Aus-Zweiges.
  #
  # Die beiden Tabellen laufen nur deshalb nicht auseinander, weil
  # `checks.home-module` die `objectName`/`keys`-Paare aus dem TypeScript zieht
  # und gegen das hier Geschriebene hält.
  defaultShortcuts = {
    "xml-focus-next" = "Meta+J";
    "xml-focus-prev" = "Meta+K";
    "xml-swap-next" = "Meta+Shift+J";
    "xml-swap-prev" = "Meta+Shift+K";
    "xml-focus-master" = "Meta+M";
    "xml-promote" = "Meta+Return";
    "xml-shrink" = "Meta+H";
    "xml-expand" = "Meta+L";
    "xml-sink" = "Meta+T";
    "xml-toggle-float" = "Meta+Shift+T";
    "xml-next-layout" = "Meta+Space";
    "xml-reset-layout" = "Meta+Shift+Space";
  };

  shortcutNames = builtins.attrNames defaultShortcuts;

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

  # Ein Submodul mit genau zwölf festen Optionen, nicht `attrsOf`. `attrsOf`
  # nähme jeden Namen an; ein Tippfehler wie `xml-focus-nex` erzeugte damit eine
  # Zeile in `kglobalshortcutsrc`, die keine Aktion je abholt — und die dort
  # dauerhaft stehen bliebe, weil plasma-manager mit `overrideConfig = false`
  # nichts löscht. Als Submodul-Option ist derselbe Tippfehler ein
  # Auswertungsfehler, der den Namen nennt.
  #
  # `null` heißt „nicht gesetzt" und lässt der Erstbelegung aus
  # `defaultShortcuts` den Vortritt. Ein Vorgabewert je Option wäre bei
  # `filterAttrs` von einer bewussten Angabe nicht mehr zu unterscheiden.
  shortcutsType = lib.types.submodule {
    options = lib.genAttrs shortcutNames (
      name:
      lib.mkOption {
        type = lib.types.nullOr (lib.types.either lib.types.str (lib.types.listOf lib.types.str));
        default = null;
        description = ''
          Taste für die Aktion `${name}`. `null` behält die Erstbelegung
          `${defaultShortcuts.${name}}`; eine leere Liste gibt die Taste frei.
        '';
      }
    );
  };

  # Was tatsächlich nach `kglobalshortcutsrc` geht: alle zwölf Aktionen, die
  # nicht gesetzten mit ihrer Erstbelegung.
  effectiveShortcuts = defaultShortcuts // lib.filterAttrs (_: value: value != null) cfg.shortcuts;

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
      type = shortcutsType;
      default = { };
      example = {
        "xml-focus-next" = "Meta+J";
        "xml-toggle-float" = [ "Meta+Shift+T" ];
      };
      description = ''
        Tastenkürzel für die `xml-*`-Aktionen, geschrieben nach
        `programs.plasma.shortcuts.kwin`. Erlaubt sind nur die zwölf
        `objectName`s des Controllers; jeder andere Name ist ein
        Auswertungsfehler.

        Geschrieben werden immer alle zwölf — die hier nicht gesetzten mit der
        Erstbelegung aus dem Skript. Der Grund ist derselbe wie bei den sechs
        `kwinrc`-Schlüsseln: `registerShortcut` erreicht eine Maschine, die das
        Skript schon einmal geladen hat, nicht mehr, und plasma-manager löscht
        mit `overrideConfig = false` nichts.
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

    cleanupWhenDisabled = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Schreibt bei `enable = false` das Gegenstück zum Ein-Zweig: das Plugin
        wird in `kwinrc` abgeschaltet und die zwölf `xml-*`-Aktionen bekommen
        `none`. Ohne das bliebe beim Ausschalten alles Alte stehen —
        plasma-manager löscht mit `overrideConfig = false` keinen Schlüssel,
        und `objectName`s lassen sich nicht abmelden: die Zeilen in
        `kglobalshortcutsrc` reservieren ihre Taste weiter.

        Standardmäßig an, aber bewusst abschaltbar: das Modul liegt über
        `home-manager.sharedModules` auf jedem Host. Auf einer
        Entwicklungsmaschine lädt die Dev-Instanz dieselben `xml-*`-Namen,
        obwohl das Produktionspaket dort aus ist — der Aus-Zweig nähme ihr
        genau die Tasten, mit denen sie erprobt werden soll.
      '';
    };
  };

  config = lib.mkMerge [
    (lib.mkIf cfg.enable {
      home.packages = installedPackages;

      # plasma-manager schreibt die Konfiguration nur, wenn es selbst aktiv ist.
      # `mkDefault`, damit eine Host-Konfiguration die Entscheidung behält.
      programs.plasma.enable = lib.mkDefault true;

      programs.plasma.configFile."kwinrc" = {
        Plugins."kwin-xmonad-liteEnabled" = true;
        "Script-kwin-xmonad-lite" = scriptGroup;
      };

      programs.plasma.shortcuts.kwin = effectiveShortcuts;
    })

    # Der Aus-Zweig kommt ohne `mkIf config.programs.plasma.enable` aus: läuft
    # plasma-manager nicht, wertet niemand diese Optionen aus. Die Bedingung
    # läse den Wert einer Option, die dieses Modul im Ein-Zweig selbst setzt —
    # das ist unnötig heikel.
    (lib.mkIf (!cfg.enable && cfg.cleanupWhenDisabled) {
      programs.plasma.configFile."kwinrc".Plugins."kwin-xmonad-liteEnabled" = false;

      # plasma-manager macht aus der leeren Liste `none` und gibt die Taste
      # damit frei (`mkGlobalShortcutFor` in modules/shortcuts.nix).
      programs.plasma.shortcuts.kwin = lib.genAttrs shortcutNames (_: [ ]);
    })

    # Die Umlegung hängt an `enable`, nicht nur an ihrem eigenen Schalter: sie
    # ergibt ohne laufenden Controller keinen Sinn, und ein Host, der im
    # Aus-Zustand die KDE-Vorgaben zurückschreibt, definierte sonst dieselben
    # beiden Optionen ein zweites Mal -- das ist kein "letzter gewinnt",
    # sondern ein Merge-Konflikt.
    (lib.mkIf (cfg.enable && cfg.relocateKdeShortcuts) {
      programs.plasma.shortcuts.ksmserver."Lock Session" = [
        "Screensaver"
        "Ctrl+Alt+L"
      ];
      programs.plasma.shortcuts.kwin."Edit Tiles" = [ ];
    })
  ];
}
