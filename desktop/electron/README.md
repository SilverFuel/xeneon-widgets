# XENEON Edge Host Desktop

This is the macOS beta host. It wraps the shared dashboard in Electron and serves local dashboard files from `127.0.0.1`.

The Windows product remains the WinUI 3 app in `app/`. This folder exists because WinUI 3 and WebView2 are Windows-only.

## Run On A Mac

```bash
npm run mac:install
npm run mac:start
```

## Build On A Mac

```bash
npm run mac:dist
```

Public Mac releases still need Developer ID signing and notarization. See `docs/release/MACOS-RELEASE.md`.
