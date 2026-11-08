# Windows Install And Uninstall

This app should not make normal users answer setup questions.

## System Requirements

- 64-bit Windows 10 version 1809 (build 17763) or newer, including Windows 11
- An x64 PC; this beta does not include ARM64 or 32-bit Windows builds
- Microsoft Edge WebView2 Evergreen Runtime installed

This beta does not bundle a fixed WebView2 runtime. Before replacing an existing Auxora installation, Setup asks its shipped official WebView2 loader API to prove that Evergreen is usable; a stale registry version string is not accepted. Repair repeats the same proof and stops if the runtime is unavailable.

## Install

Download the Windows setup EXE from GitHub Releases and run it.

For the beta, use only the installer named in `release-manifest.json`. In PowerShell, run:

```powershell
(Get-FileHash -Algorithm SHA256 '.\Auxora-Setup-<version>-<date>.exe').Hash
```

Confirm the 64-character result exactly matches the manifest's SHA-256 value and the first hash field in the `.sha256` sidecar. Confirm the filename matches both the manifest and the sidecar's filename field. If either differs, do not run the installer; delete the files and download them again from the official GitHub Release. Published assets under an existing tag are immutable.

Auxora installs itself for the current Windows user. It does not need admin rights for the normal install path, and it does not ask the user to pick folders or configure services.

The installer handles this automatically:

- migrates a legacy install when present, then copies the app to `%LOCALAPPDATA%\Programs\Auxora`
- creates `Auxora` in the Start Menu
- creates an `Auxora` Desktop shortcut
- adds `Auxora` to Windows Settings > Apps
- leaves Auxora closed and automatic startup disabled until the user deliberately opens it

The Start Menu folder also includes clearly labeled recovery shortcuts:

- `Auxora Recovery (Safe Mode)` stops any running host process, disables auto-start, ignores saved display placement, and opens only on an active non-primary companion display. If none is active, it remains tray-only.
- `Repair Auxora` restores Start Menu/Desktop shortcuts, uninstall registration, and runtime checks without touching local app data or enabling automatic startup.

Before publication, the exact manifest-bound installer must complete the schema-3 disposable-VM lifecycle receipt: manifest schema 2 must first match the installed `XenonEdgeHost.exe` hash/ProductName/ProductVersion/commit, then the test must cover install while staying closed, deliberate launch, live `/api/health`, process restart, reboot with no autostart, injected failed-upgrade rollback, successful previous-beta upgrade, repair, normal uninstall, and remove-all-data.

This free beta installer is unsigned, so Windows may show a SmartScreen warning or organization policy may block it. Verify the official source, exact filename, and SHA-256 first. Never disable SmartScreen, Smart App Control, antivirus, or organization policy. If Windows or policy blocks the installer, stop. After Windows permits the verified installer, Auxora should not ask more setup questions.

If setup does not finish, troubleshooting details are in `%LOCALAPPDATA%\Auxora\InstallerLogs\install.log`. Setup does not launch Auxora or add automatic startup. The log identifies any older startup entry that could not be removed; report it instead of repeatedly retrying the installer.

## Uninstall

Use either normal Windows path:

- Windows Settings > Apps > Installed apps > Auxora
- Start Menu > Auxora > Uninstall Auxora

Uninstall is hands-free. It removes:

- the running app process
- the app files in `%LOCALAPPDATA%\Programs\Auxora`
- Start Menu shortcuts
- Desktop shortcuts
- the auto-start entry
- the Windows Apps uninstall entry

## Remove Local Data Too

Use:

```text
Start Menu > Auxora > Remove Auxora and Local Data
```

That removes the app and also removes local Auxora and retained legacy data from:

- `%APPDATA%\Auxora`
- `%LOCALAPPDATA%\Auxora`
- `%APPDATA%\XenonEdgeHost`
- `%LOCALAPPDATA%\XenonEdgeHost`

Use this when the user wants a clean reset or is done with the app completely.

## What Should Never Happen

- No folder picker during normal install.
- No manual service setup.
- No copied command lines for normal users.
- No uninstall confirmation prompts from Auxora scripts.
- No leftover Start Menu or Desktop shortcuts after uninstall.
- No half-installed app if reinstalling fails during file copy.
- No Safe Mode launch that reuses a stale saved display target.
- No repair flow that removes Auxora or legacy local data.

If any of those happen, the installer flow is broken and should be fixed before publishing.
