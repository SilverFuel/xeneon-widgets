# GitHub Release Upload

Use GitHub Releases as the public download shelf.

## Free Beta Assets

For the first free public beta, upload:

- `app\dist\Auxora-Setup-<version>-<date>.exe`
- `app\dist\Auxora-Setup-<version>-<date>.exe.sha256`
- `release-manifest.json`
- release notes from `docs\release\FREE-BETA-RELEASE-NOTES.md`
- plain install/uninstall notes from `docs\release\WINDOWS-INSTALL-UNINSTALL.md`

Mark the release as a pre-release. The beta workflow is Windows-only and must not attach Mac assets.

## Paid/Stable Assets

Upload:

- `app\dist\Auxora-Setup-<version>-<date>.exe`
- `app\dist\Auxora-Setup-<version>-<date>.exe.sha256`
- `desktop/electron/dist\*.dmg`
- `desktop/electron/dist\*.zip`
- release notes copied from `CHANGELOG.md`

The `Windows Beta Candidate` workflow builds an immutable Windows candidate on an exact `v*.*.*-beta.*` tag. It does not publish on tag push. After the exact artifact passes the disposable-VM lifecycle, manually run the workflow with the successful candidate run id, the same tag, and the base64 lifecycle receipt. Publication fails if the release already exists; use a new version and tag instead of replacing bytes.

## Naming

Use tags like:

```text
v0.3.0-beta.1
```

Use release titles like:

```text
Auxora 0.3.0 Free Public Beta
```

## Before Upload

- `npm run release:ready` passes.
- Free beta releases clearly say when the Windows installer is unsigned.
- Release notes clearly say install and uninstall are hands-free after any Windows SmartScreen warning.
- Paid/stable Windows installers are signed.
- Paid/stable macOS packages are signed and notarized.
- SHA256 files match the uploaded files.
- The manifest binds the exact tag, project version, full commit SHA, installer filename, SHA-256, signature status, and five-file asset allowlist.
- A disposable-VM lifecycle receipt for that exact installer SHA passes `scripts\Test-BetaLifecycleReceipt.ps1`.
- `support.html` and `refund-policy.html` are included in the app package.
- GitHub Issues and Security Advisories are enabled, or monitored support/security inboxes are published.
- The in-app Updates panel can see this release and expose installer links.
- Release notes list known limitations plainly.
