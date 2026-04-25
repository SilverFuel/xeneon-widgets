# macOS Release

The Windows app uses WinUI 3 and WebView2, so it cannot be copied directly to macOS. The Mac path is a separate Electron host that serves the same dashboard and exposes local endpoints where macOS support exists.

Apple requires Developer ID signing and notarization for Mac software distributed outside the Mac App Store. Apple also requires current notarization flows to use `notarytool` or Xcode 14 or later.

Useful docs:

- https://developer.apple.com/developer-id/
- https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- https://developer.apple.com/documentation/security/customizing-the-notarization-workflow

## Build On A Mac

From the repo root:

```bash
npm run mac:install
npm run mac:dist
```

The package appears in:

```text
desktop/electron/dist
```

## Notarize

After signing with a Developer ID certificate, submit the DMG or ZIP:

```bash
APPLE_ID="you@example.com" \
APPLE_TEAM_ID="TEAMID1234" \
APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
scripts/notarize-macos.sh desktop/electron/dist/XENEON\ Edge\ Host-0.2.0.dmg
```

## Current Mac Scope

The macOS host is a beta path. It opens the dashboard, serves local files, stores settings locally, protects secrets with Electron safe storage when available, and provides graceful "not available on macOS yet" responses for Windows-specific controls.

Before selling a Mac version, test it on a clean Intel Mac and Apple silicon Mac.
