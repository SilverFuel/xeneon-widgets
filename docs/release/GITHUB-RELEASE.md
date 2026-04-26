# GitHub Release Upload

Use GitHub Releases as the public download shelf.

## Free Beta Assets

For the first free public beta, upload:

- `app\dist\XenonEdgeHost-Setup-<version>-<date>.exe`
- `app\dist\XenonEdgeHost-Setup-<version>-<date>.exe.sha256`
- release notes from `docs\release\FREE-BETA-RELEASE-NOTES.md`

Mark the release as a pre-release. Do not attach a Mac package unless it was built and tested on an actual Mac and is clearly labeled beta.

## Paid/Stable Assets

Upload:

- `app\dist\XenonEdgeHost-Setup-<version>-<date>.exe`
- `app\dist\XenonEdgeHost-Setup-<version>-<date>.exe.sha256`
- `desktop/electron/dist\*.dmg`
- `desktop/electron/dist\*.zip`
- release notes copied from `CHANGELOG.md`

The `Release Artifacts` GitHub Actions workflow builds Windows and macOS artifacts on `v*.*.*` tags and creates a public GitHub pre-release using the free beta notes. Change it back to a draft workflow before using it for a paid/stable release.

## Naming

Use tags like:

```text
v0.2.0
```

Use release titles like:

```text
XENEON Edge Host 0.2.0 Free Public Beta
```

## Before Upload

- `npm run release:ready` passes.
- Free beta releases clearly say when the Windows installer is unsigned.
- Paid/stable Windows installers are signed.
- Paid/stable macOS packages are signed and notarized.
- SHA256 files match the uploaded files.
- `support.html` and `refund-policy.html` are included in the app package.
- GitHub Issues and Security Advisories are enabled, or monitored support/security inboxes are published.
- The in-app Updates panel can see this release and expose installer links.
- Release notes list known limitations plainly.
