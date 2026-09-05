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

  # Typprüfung und Unit-Tests laufen im Build, damit `nix flake check` sie
  # zwangsläufig mitnimmt. Das ES-Target ist in Meilenstein 0 an der laufenden
  # QJSEngine gemessen, siehe docs/research.md.
  buildPhase = ''
    runHook preBuild

    tsc --noEmit
    node --test tests/*.test.ts
    esbuild src/main.ts \
      --bundle \
      --format=iife \
      --target=es2016 \
      --outfile=package/contents/code/main.js
    mkdir -p build
    esbuild src/dev.ts \
      --bundle \
      --format=iife \
      --target=es2016 \
      --outfile=build/dev.js

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    scriptDir="$out/share/kwin/scripts/${finalAttrs.pname}"
    install -d "$scriptDir"
    cp -r package/contents "$scriptDir/"
    install -Dm644 -t "$scriptDir" package/metadata.json LICENSE README.md
    install -Dm644 build/dev.js "$out/share/kwin-xmonad-lite-dev/dev.js"

    runHook postInstall
  '';

  meta = {
    description = "Schlanker KWin-Layout-Controller im Stil von XMonads Tall- und Full-Layout";
    homepage = "https://github.com/muhackel/kwin-xmonad-lite";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
  };
})
