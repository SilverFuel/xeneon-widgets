# Auxora

## Free Public Beta

Auxora is the adaptive successor to XENEON Edge Host. Version 0.3.x remains a free public beta. The free-beta Windows installer is unsigned; signed commercial candidates require the gated workflow and completed certification evidence. Do not charge for this build yet.

- the published free-beta Windows installer is unsigned
- Windows may show a SmartScreen warning on first install
- the macOS host is still a beta scaffold and should not be advertised as a finished Mac product
- support is handled through GitHub Issues and GitHub Security Advisories for now
- this is independent software, not an official CORSAIR product

Auxora is a native Windows companion dashboard for landscape, ultrawide, and portrait touch displays. It combines adaptive Modes, system telemetry, network stats, audio routing, media controls, weather, calendar, lighting, recent apps, optional Frigate camera detection, and home-lab panels.

The primary product is the native Windows host in `app`. Legacy browser bridge files are isolated in `bridge` for compatibility testing only. A macOS beta host lives in `desktop/electron` because the Windows app uses WinUI 3 and WebView2, which do not run on macOS.

Auxora is independent software. It is not an official product of CORSAIR or any integration provider unless a separate written agreement says otherwise.

The first Auxora upgrade preserves existing XENEON settings and Windows-protected secrets. The legacy internal executable name remains temporarily for rollback compatibility while public shortcuts, storage, UI, and installer assets transition to Auxora.

## Install And Uninstall Without Setup Questions

For beta users, use the Windows setup EXE from GitHub Releases instead of the source code ZIP:

1. Download `Auxora-Setup-<version>-<date>.exe`.
2. Run it.
3. Auxora installs for the current Windows user, creates one clear Auxora Start Menu/Desktop shortcut, registers auto-start, and launches itself.

After install, the normal app to click is:

- Desktop > `Auxora`
- Start Menu > `Auxora` > `Auxora`

Use `Auxora Recovery (Safe Mode)` only when the dashboard is stuck on the wrong display or you need to repair a broken startup. Do not launch files from `publish`, `app\bin`, `bridge`, or `desktop\electron` for normal use.

The installer is meant to be hands-free. It does not ask the user to choose folders, services, setup steps, or uninstall behavior. The free beta may still show a Windows SmartScreen warning until the installer is signed, but Auxora itself does not add extra setup questions.

On first launch, Auxora scans the PC and prepares the normal dashboard automatically:

- starts the local dashboard service
- detects system, GPU, network, audio, media, Steam, local UniFi consoles, and clipboard capabilities where Windows exposes them
- builds the recent-app dock from safe Start Menu shortcuts, Steam games, and live app activity
- marks the core dashboard ready without asking the user to finish setup manually

Only permission-based extras still need user input: Weather needs an API key, Calendar needs an ICS feed or account permission, Philips Hue needs the bridge link button, UniFi needs local console credentials if you want client and AP detail, and Camera Detection needs the address of a Frigate server on the local/private network.

Uninstall is also meant to be hands-free:

- Windows Settings > Apps > Installed apps > Auxora removes the app, shortcuts, auto-start, and uninstall entry.
- Start Menu > Auxora > Uninstall Auxora does the same thing.
- Start Menu > Auxora > Remove Auxora and Local Data also removes `%APPDATA%\Auxora`, `%LOCALAPPDATA%\Auxora`, and legacy XENEON data left for rollback.
- Start Menu > Auxora > Auxora Recovery (Safe Mode) disables auto-start, ignores saved display placement, and opens only on an active companion display. If no companion display is active, Auxora remains tray-only.
- Start Menu > Auxora > Repair Auxora restores shortcuts, startup registration, uninstall registration, and runtime checks without touching local app data.

Plain-language install/uninstall notes live in [docs/release/WINDOWS-INSTALL-UNINSTALL.md](docs/release/WINDOWS-INSTALL-UNINSTALL.md).

## Product Layer

Auxora now includes:

- automatic first-run provisioning with diagnostics and repair
- normal setup that hides advanced connector plumbing
- adaptive Work, Gaming, Media, and Home Modes with manual and automatic switching; Night remains a separate display variant
- Home, Modes, Apps & Controls, and Settings navigation
- responsive compact, standard, ultrawide, and portrait layouts
- Smart Glance briefing and meaningful local alerts
- an explicit Phone Remote unavailable state; this beta opens no phone-control listener
- Companion-only DDC/CI monitor controls when supported; the Windows primary display is excluded from discovery and commands
- safe one-tap action chains and per-display Mode assignments
- inspection-only signed manifest checks with declared permissions; third-party loading is disabled
- credential-free Mode and presentation backup/restore
- privacy-first media controls with optional local titles, artwork, and audio application labels
- Theme Studio with accent, opacity, and animation controls
- drag-and-drop layout ordering
- release channel and local-hosted GitHub release checks
- local-only OBS reachability and streaming-layout preview; this beta sends no OBS commands
- Game Mode profile and launcher handoff
- built-in widget packs for local dashboard layouts
- directly discoverable, optional local Frigate object detections and event snapshots with an in-panel setup path
- installer readiness panel
- local-first privacy and trust screen
- app data reset from setup/privacy and from the uninstall cleanup shortcut

The update and streaming panels remain beta foundations. Streaming accepts only loopback OBS WebSocket addresses and checks reachability; it does not authenticate to OBS or send commands. Signed manifest inspection is implemented, but third-party code loading and execution are disabled in this beta even if a manifest passes inspection. Phone Remote is also not included. Before charging customers, sign the Windows release, complete authenticated OBS commands, and test the installer on clean hardware.

Privacy & Backup exports Modes plus portable presentation settings such as theme, readability, layout order, pinned and hidden panels, card sizes, per-Mode layouts, and built-in pack selection. Credentials, integration and OBS endpoints, weather location, launcher paths, display identifiers, and logs remain excluded. Restore validates the browser-side presentation fields before changing native configuration and keeps the newest user-action result visible when diagnostics refresh in the background.

## Install From Source

1. Open PowerShell in `app`.
2. Run `powershell -File publish.ps1`.
3. Launch `..\Open Auxora.cmd`.
4. Optional: run `powershell -File install.ps1` from the `app` folder to register auto-start at login.

For a real Windows install/uninstall cycle from source, build the setup EXE with `powershell -File app\build-installer.ps1` and install from `app\dist`. The setup EXE performs the full per-user install, Start Menu/Desktop shortcut creation, auto-start registration, Apps & Features registration, and packaged uninstall flow without asking setup questions.

The native host:

- runs full-screen on the selected Windows display
- serves the dashboard locally on `http://127.0.0.1:8976/`
- owns system, network, UniFi detection, Frigate events and snapshots, audio, calendar, media, weather, and Hue APIs directly
- stores Weather, Hue, UniFi, and Frigate secrets with Windows per-user protection instead of plain dashboard config
- does not require Node.js for the normal app path

## Camera Detection

Camera Detection is optional but remains visible as Setup in Apps & Controls before configuration. Open the panel and choose **Set up Camera Detection** to reveal its Diagnostics form, scroll it into view, and focus the Frigate address field. Enter the base address of a Frigate server on the local/private network and, optionally, a camera name such as `driveway`. For Frigate's authenticated port `8971`, use an HTTPS address and enter a Frigate username and password; Auxora logs in through `/api/login`, keeps the issued token in memory, retries authentication once after an HTTP 401, and protects the saved password with Windows DPAPI. Authenticated non-loopback HTTP is rejected so credentials cannot cross the LAN in plaintext. Leave both credential fields blank when using a trusted internal unauthenticated endpoint such as port `5000`. HTTPS certificates must already be trusted by Windows—Auxora never disables certificate validation.

Auxora reads recent object events and displays the latest available event snapshot through its localhost API. It independently enforces the configured camera and one-hour event window even if the upstream server ignores those query filters, and it only proxies snapshots belonging to the current filtered results. Public destinations, redirects, proxy routing, credentials embedded in URLs, invalid or out-of-filter event identifiers, incomplete or empty-token authentication, and untrusted TLS certificates are rejected.

Saving Camera Detection from Diagnostics immediately tests the configured event API. Auxora reports **Ready** only after Frigate accepts the request, keeps saved settings when the server is temporarily unavailable, and reports **Needs Setup** with a retryable connection message when authentication or connectivity fails.

Local endpoints:

```text
http://127.0.0.1:8976/api/frigate
http://127.0.0.1:8976/api/frigate/snapshot?id=<event-id>
```

## Network And UniFi

The Network page combines normal PC network health and optional UniFi detail. It works immediately with local Windows network telemetry:

- download and upload throughput
- ping
- adapter type and link speed
- PC IP, gateway, and DNS
- Game Mode network readiness

If Xenon sees a local UniFi console, the Network page shows a `Connect UniFi` card. This follows the same local-first shape as Home Assistant: use a local UniFi console user, not cloud scraping or hidden system setup. Xenon stores the UniFi password with Windows per-user protection and keeps it out of plain config files.

Local endpoint:

```text
http://127.0.0.1:8976/api/unifi/network
```

Link endpoint:

```text
http://127.0.0.1:8976/api/unifi/network/link
```

When linked, Xenon reads local UniFi Network client and AP stats from the controller and folds them into the Network page and the compact Game Mode network strip. If UniFi is not linked, Network Monitor still remains useful from native Windows metrics.

## GPU Power In System Monitor

The System Monitor includes a GPU Power section for RTX 50-series and other modern GPUs. It does not hardcode an Astral-only path; it discovers connector, rail, current, voltage, power, and protection sensors from local public sources when they are exposed.

The native endpoint is:

```text
http://127.0.0.1:8976/api/gpu-power
```

Built-in sources:

- embedded LibreHardwareMonitor CPU/GPU temperature sensors, with LibreHardwareMonitor or OpenHardwareMonitor WMI fallback
- HWiNFO sensor CSV logs when available

For HWiNFO CSV logs, either place a recent HWiNFO/sensor CSV in Documents, Desktop, Downloads, `Documents\HWiNFO`, or `Documents\HWiNFO64`, or set one of these environment variables before launching Xenon:

```powershell
$env:XENON_HWINFO_LOG="C:\path\to\HWiNFO-log.csv"
$env:XENON_HWINFO_LOG_DIR="C:\path\to\folder"
```

Per-pin readings appear only when the GPU and the sensor tool expose them. Otherwise the widget still shows available GPU rail, power draw, and temperature readings.

## Build The Installer

The easiest packaging path is:

```text
Build Auxora Installer.cmd
```

Or from a terminal:

```powershell
powershell -File app\build-installer.ps1
```

That creates:

- `app\dist\Auxora-Setup-<version>-<date>.exe`
- `app\dist\Auxora-Setup-<version>-<date>.exe.sha256`
- `app\dist\README-install.txt`

The installer installs per-user to `%LOCALAPPDATA%\Programs\Auxora`, creates Start Menu and Desktop shortcuts, registers auto-start, launches the app, and adds an Apps & Features uninstall entry. Reinstalling upgrades in-place through a staged copy so a failed file copy does not leave the app half-installed. The normal installer and uninstaller paths are hands-free.

Uninstall paths:

- Windows Settings > Apps > Installed apps > Auxora
- Start Menu > Auxora > Uninstall Auxora
- Start Menu > Auxora > Remove Auxora and Local Data
- `powershell -File "$env:LOCALAPPDATA\Programs\Auxora\Remove-XenonEdgeHost.ps1" -Quiet -RemoveLocalData`

Recovery paths:

- Start Menu > Auxora > Auxora Recovery (Safe Mode)
- Start Menu > Auxora > Repair Auxora
- `powershell -File "$env:LOCALAPPDATA\Programs\Auxora\Launch-XenonSafeMode.ps1" -Quiet`
- `powershell -File "$env:LOCALAPPDATA\Programs\Auxora\repair.ps1" -Quiet`

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
powershell -File scripts\test-windows-install.ps1 -InstallerPath app\dist\<installer>.exe -RunInstall -QuietInstall -RunUninstall
```

Run the release gate separately before uploading if needed:

```powershell
npm run release:ready
```

Run the full non-destructive release gauntlet against the latest installer:

```powershell
npm run release:gauntlet
```

For a disposable Windows VM or fresh Windows profile, run the destructive install/uninstall smoke:

```powershell
powershell -File scripts\run-release-gauntlet.ps1 -InstallerPath app\dist\<installer>.exe -AllowGitHubSupportPath -AllowUnsignedBeta -RunInstallSmoke -RunUninstall
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
- `Audio & Media` renders live devices, app audio, and transport state
- `Calendar` appears after you add an ICS feed in Diagnostics
- `Weather` appears after you add an OpenWeather key
- tray icon appears on the primary display
- setup EXE registers Apps & Features uninstall and Start Menu cleanup shortcuts

## Cleanup

Generated build folders and local logs are ignored by Git. To clean the working folder after a build, use:

```powershell
powershell -File scripts\clean-workspace.ps1
```
