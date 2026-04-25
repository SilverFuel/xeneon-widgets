# GitHub Release Upload

Use GitHub Releases as the public download shelf.

## Release Assets

Upload:

- `app\dist\XenonEdgeHost-Setup-<version>-<date>.exe`
- `app\dist\XenonEdgeHost-Setup-<version>-<date>.exe.sha256`
- `desktop/electron/dist\*.dmg`
- `desktop/electron/dist\*.zip`
- release notes copied from `CHANGELOG.md`

The `Release Artifacts` GitHub Actions workflow builds Windows and macOS artifacts on `v*.*.*` tags and creates a draft GitHub Release. Keep it as a draft until signing and notarization are complete.

## Naming

Use tags like:

```text
v0.2.0
```

Use release titles like:

```text
XENEON Edge Host 0.2.0
```

## Before Upload

- `npm run release:ready` passes.
- Windows installer is signed.
- macOS package is signed and notarized.
- SHA256 files match the uploaded files.
- `support.html` and `refund-policy.html` are included in the app package.
- GitHub Issues and Security Advisories are enabled, or monitored support/security inboxes are published.
- The in-app Updates panel can see this release and expose installer links.
- Release notes list known limitations plainly.
