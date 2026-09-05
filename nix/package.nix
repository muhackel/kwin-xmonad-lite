{
  lib,
  stdenvNoCC,
  typescript,
  nodejs,
  esbuild,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "kwin-xmonad-lite";
  version = "0.0.0";

  src = lib.cleanSource ../.;

  nativeBuildInputs = [
    typescript
    nodejs
    esbuild
  ];

  # Typpruefung und Unit-Tests laufen im Build, damit `nix flake check` sie
  # zwangslaeufig mitnimmt. Das ES-Target ist die Arbeitsannahme aus PLAN.md
  # Abschnitt 2 Punkt 8 und wird nach der Feature-Probe festgezurrt.
  buildPhase = ''
    runHook preBuild

    tsc --noEmit
    node --test tests/*.test.ts
    esbuild src/main.ts \
      --bundle \
      --format=iife \
      --target=es2016 \
      --outfile=package/contents/code/main.js

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    scriptDir="$out/share/kwin/scripts/${finalAttrs.pname}"
    install -d "$scriptDir"
    cp -r package/contents "$scriptDir/"
    install -Dm644 -t "$scriptDir" package/metadata.json LICENSE README.md

    runHook postInstall
  '';

  meta = {
    description = "Schlanker KWin-Layout-Controller im Stil von XMonads Tall- und Full-Layout";
    homepage = "https://github.com/muhackel/kwin-xmonad-lite";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
  };
})
