{
  mkShell,
  typescript,
  nodejs,
  esbuild,
  biome,
  shellcheck,
  git,
  kdePackages,
}:

mkShell {
  packages = [
    typescript
    nodejs
    esbuild
    biome
    shellcheck
    git
    kdePackages.kpackage # kpackagetool6
    kdePackages.qttools # qdbus
    kdePackages.kconfig # kwriteconfig6, kreadconfig6
  ];
}
