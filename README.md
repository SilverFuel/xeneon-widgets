# XENEON Edge Host

## Free Public Beta

XENEON Edge Host 0.2.0 is being released as a free public beta first. Do not charge for this build yet. Use GitHub Releases as the download page, mark the release as a pre-release/beta, and keep the limitations visible:

- the Windows installer is unsigned unless you add code signing
- Windows may show a SmartScreen warning on first install
- the macOS host is still a beta scaffold and should not be advertised as a finished Mac product
- support is handled through GitHub Issues and GitHub Security Advisories for now
- this is independent software, not an official CORSAIR product

XENEON Edge Host is a native Windows dashboard for the CORSAIR XENEON EDGE. It serves a 2560x720 local control surface with system telemetry, network stats, audio routing, media controls, weather, calendar, Hue lights, launchers, clipboard history, and optional home-lab panels.

The primary product is the native Windows host in `app`. Legacy browser bridge files are isolated in `bridge` for compatibility testing only. A macOS beta host lives in `desktop/electron` because the Windows app uses WinUI 3 and WebView2, which do not run on macOS.

XENEON Edge Host is an independent product. It is not an official CORSAIR app unless a separate written agreement says otherwise.

## Product Layer

The dashboard now includes the pieces that make it feel like an installable product:

- first-run diagnostics and setup
- normal setup that hides advanced connector plumbing
- dashboard profiles for command, gaming, streaming, home-lab, and minimal modes
- Theme Studio with accent, opacity, and animation controls
- drag-and-drop layout ordering
- release channel and local-hosted GitHub release checks
- OBS/streaming panel foundation
- Game Mode profile and launcher handoff
- marketplace-style widget packs
- installer readiness panel
- local-first privacy and trust screen
- app data reset from setup/privacy and from the uninstall cleanup shortcut

The update, streaming, and marketplace panels are product-ready foundations. Before charging customers for those specific features, wire them to a signed updater service, authenticated OBS commands, and hosted pack manifests.

## Install From Source

1. Open PowerShell in `app`.
2. Run `powershell -File publish.ps1`.
3. Launch `..\publish\XenonEdgeHost.exe`.
4. Optional: run `powershell -File install.ps1` from the `app` folder to register auto-start at login.

The native host:

- runs full-screen on the XENEON EDGE
- serves the dashboard locally on `http://127.0.0.1:8976/`
- owns system, network, UniFi detection, audio, calendar, media, weather, and Hue APIs directly
- stores Weather and Hue keys with Windows per-user protection instead of plain dashboard config
- does not require Node.js for the normal app path

## UniFi

Xenon includes a built-in UniFi detector now. The dashboard uses:

```text
http://127.0.0.1:8976/api/unifi/network
```

That endpoint auto-detects a local UniFi OS console, such as `https://192.168.0.1`, and gives the dashboard a setup-free UniFi state. Full client, AP, app, and camera stats can be added later with a local credential flow, but the basic UniFi panel no longer requires a separate helper service.

## Build The Installer

The easiest packaging path is:

```text
Build XENEON Installer.cmd
```

Or from a terminal:

```powershell
powershell -File app\build-installer.ps1
```

That creates:

- `app\dist\XenonEdgeHost-Setup-<version>-<date>.exe`
- `app\dist\XenonEdgeHost-Setup-<version>-<date>.exe.sha256`
- `app\dist\README-install.txt`

The installer installs per-user to `%LOCALAPPDATA%\Programs\XenonEdgeHost`, creates Start Menu and Desktop shortcuts, registers auto-start, and adds an Apps & Features uninstall entry.

Before selling a paid/stable version, treat these as release blockers:

- sign the installer and executable
- test first-run setup on a clean Windows machine
- add monitored support and security inboxes, or keep GitHub Issues and Security Advisories as the published support path
- avoid presenting the app as an official CORSAIR product unless you have permission

Release docs now live in `docs/release`.

## Windows Free Beta Release

Build the Windows free beta locally with:

```powershell
npm run release:free-beta
```

For the free beta, upload the installer only with clear "unsigned beta" wording and the SHA256 file. For a paid/stable release, sign the installer before public upload:

```powershell
powershell -File scripts\sign-windows.ps1 -Path app\dist\<installer>.exe -CertificatePath C:\path\to\certificate.pfx
```

See `docs/release/WINDOWS-SIGNING.md`.

Run the clean install smoke helper on a fresh Windows profile or VM:

```powershell
powershell -File scripts\test-windows-install.ps1 -InstallerPath app\dist\<installer>.exe -RunInstall -RunUninstall
```

Run the release gate separately before uploading if needed:

```powershell
npm run release:ready
```

For the beta release asset list and wording, see `docs/release/FREE-BETA-RELEASE-NOTES.md` and `docs/release/GITHUB-RELEASE.md`.

Use the in-app Privacy or Setup panel to reset local dashboard settings and protected integration secrets before uninstalling or handing a machine to someone else.

## macOS Beta

The Mac version is an Electron host around the same dashboard. Build it on a Mac:

```bash
npm run mac:install
npm run mac:dist
```

Before selling it or calling it a finished Mac product, sign with an Apple Developer ID certificate and notarize it:

```bash
scripts/notarize-macos.sh desktop/electron/dist/<package>.dmg
```

See `docs/release/MACOS-RELEASE.md`.

## Repository Map

- `app/` - native Windows host, installer scripts, and local APIs
- `app/Services/` - system, network, audio, weather, Hue, UniFi, and media services
- `app/Infrastructure/` - config, logging, embedded assets, secure secrets, and WebView helpers
- `app/Models/` - app configuration/request models
- `widgets/` - standalone dashboard panels embedded by the host
- `js/` and `css/` - shared dashboard runtime and styling
- `desktop/electron/` - macOS beta host and packaging scaffold
- `docs/` - planning, release, signing, privacy, and product notes
- `bridge/` - legacy browser/iCUE bridge kept out of the normal product path

## Release Paperwork

- `LICENSE.md` - free public beta license terms
- `PRIVACY.md` - local-first privacy notes
- `SECURITY.md` - supported versions and private vulnerability reporting path
- `SUPPORT.md` - customer support checklist and live GitHub support path
- `CHANGELOG.md` - release notes
- `support.html` - customer-facing support page served by the app
- `refund-policy.html` - free beta license page served by the app
- `docs/release/PUBLIC-RELEASE-CHECKLIST.md` - plain go/no-go checklist
- `scripts/assert-release-ready.ps1` - automated release gate for the obvious blockers

## First-Run Checklist

- `System Monitor` renders
- `Network Monitor` renders
- `Audio` renders with live devices
- `Media` renders and shows transport state
- `Calendar` appears after you add an ICS feed in Diagnostics
- `Weather` appears after you add an OpenWeather key
- tray icon appears on the primary display
- `install.ps1` creates the `XenonEdgeHost` logon task

## Cleanup

Generated build folders and local logs are ignored by Git. To clean the working folder after a build, use:

```powershell
powershell -File scripts\clean-workspace.ps1
```
