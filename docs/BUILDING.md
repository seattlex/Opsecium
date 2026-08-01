# Building

```sh
npm install
npm start                      # run it
npm test                       # unit tests, plain node
npm run smoke                  # integration check, boots electron
```

On a headless box the smoke check needs a display and, as root, a flag:

```sh
xvfb-run -a npm run smoke -- --no-sandbox
```

## Installers

Each target is built with electron-builder. Output lands in `dist/`.

```sh
npm run dist:linux    # AppImage, deb, tar.gz
npm run dist:win      # nsis installer + portable exe
npm run dist:mac      # dmg + zip
```

**Build each platform on that platform.** This is not fussiness:

- **Windows from Linux needs wine.** electron-builder shells out to a 32 bit
  `rcedit.exe` to stamp the icon and version information onto the binary, and
  NSIS runs the uninstaller stub to generate the uninstaller. Both go through
  wine, and wine64 alone will not do it - you need 32 bit support as well
  (`dpkg --add-architecture i386 && apt install wine32`). Without it the build
  stops partway and leaves a truncated exe behind.
- **macOS from anything else is not possible** if you want it signed or
  notarised.

If you only need something runnable on Windows and have no wine, the zip
target skips the parts that need it:

```sh
npx electron-builder --win zip -c.win.signAndEditExecutable=false
```

That produces `dist/Opsecium-<version>-win-x64.zip` - unpack it anywhere and
run `Opsecium.exe`. It works, but the exe carries Electron's default icon and
version strings rather than ours, which is why it is not what gets released.

## Releases

Tagging is the whole process:

```sh
npm version 0.2.0
git push --follow-tags
```

`.github/workflows/release.yml` then builds on `windows-latest`,
`macos-latest` and `ubuntu-latest` in parallel, so every installer is made
natively, and collects them into a draft release with a `SHA256SUMS.txt`.
Check the artifacts, write the notes, publish.

## Signing

Nothing is signed yet. Windows will show SmartScreen on first run and macOS
will refuse to open the app until it is allowed through Gatekeeper. Signing
certificates cost money and have to belong to a real identity, which is worth
thinking about for a browser sold on not being identifiable. If you want
signed builds of your own, electron-builder reads `CSC_LINK` and
`CSC_KEY_PASSWORD` from the environment.

## Icon

`build/icon.png` at 512x512 is the only source. electron-builder derives the
`.ico` and `.icns` from it, so there is nothing else to keep in sync.
