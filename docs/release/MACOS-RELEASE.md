# macOS Release

The Windows app uses WinUI 3 and WebView2, so it cannot be copied directly to macOS. The Mac path is a separate Electron host that serves the same dashboard and exposes local endpoints where macOS support exists.

Apple requires Developer ID signing and notarization for Mac software distributed outside the Mac App Store. Apple also requires current notarization flows to use `notarytool` or Xcode 14 or later.

Useful docs:

- https://developer.apple.com/developer-id/
- https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- https://developer.apple.com/documentation/security/customizing-the-notarization-workflow

## Build On A Mac

Use Node.js 22.12.0 or newer. CI installs the Electron dependency tree with
install scripts disabled and tests its download/proxy integration without
launching Electron. A Mac build still needs the normal install below to download
the Electron runtime.

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

The macOS host is a beta path. It opens the dashboard, serves local files, stores settings locally, protects secrets with Electron safe storage when available, serves the support and refund pages, checks GitHub Releases through the local host, and provides graceful "not available on macOS yet" responses for Windows-specific controls.

Before selling a Mac version, test it on a clean Intel Mac and Apple silicon Mac.

## Dependency Maintenance

The `global-agent@3.0.0` override selects `roarr@3.3.0` to remove the unpatched
`sprintf-js` dependency (GHSA-hp3w-g68c-fv3c). It preserves the proxy agent and
the logger's CommonJS default export and child/context API. Do not replace the
builder's `@electron/get` with version 5: the builder uses its Got-specific
proxy and timeout options. Remove the override once the builder's dependency
tree no longer needs it, and rerun `npm --prefix desktop/electron run check`
and `npm run audit:deps` after dependency changes.

Electron 41.10.7 closes the reported advisories within the existing major
version, but Electron 41 is end-of-support. A supported-major upgrade and the
Intel/Apple silicon tests above remain required before a Mac release. See the
[upstream release notice](https://github.com/electron/electron/releases/tag/v41.10.7).
