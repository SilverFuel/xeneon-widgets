# Windows Install And Uninstall

This app should not make normal users answer setup questions.

## Install

Download the Windows setup EXE from GitHub Releases and run it.

For the beta, use only the installer named in `release-manifest.json` and confirm its SHA-256 matches both the manifest and sidecar. Published assets under an existing tag are immutable.

Auxora installs itself for the current Windows user. It does not need admin rights for the normal install path, and it does not ask the user to pick folders or configure services.

The installer handles this automatically:

- migrates a legacy install when present, then copies the app to `%LOCALAPPDATA%\Programs\Auxora`
- creates `Auxora` in the Start Menu
- creates an `Auxora` Desktop shortcut
- registers the app to start when the user logs in
- adds `Auxora` to Windows Settings > Apps
- launches the app

The Start Menu folder also includes clearly labeled recovery shortcuts:

- `Auxora Recovery (Safe Mode)` stops any running host process, disables auto-start, ignores saved display placement, and opens only on an active non-primary companion display. If none is active, it remains tray-only.
- `Repair Auxora` restores Start Menu/Desktop shortcuts, startup registration, uninstall registration, and runtime checks without touching local app data.

Before publication, the exact manifest-bound installer must complete the disposable-VM lifecycle receipt: install, live `/api/health`, process restart, reboot/autostart, previous-beta upgrade, repair, normal uninstall, and remove-all-data.

The free beta installer may show a Windows SmartScreen warning until the app is signed. That warning is from Windows. After the user chooses to run the beta installer, Auxora should not ask more setup questions.

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
