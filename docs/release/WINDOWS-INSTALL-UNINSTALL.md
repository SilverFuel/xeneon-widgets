# Windows Install And Uninstall

This app should not make normal users answer setup questions.

## Install

Download the Windows setup EXE from GitHub Releases and run it.

Xenon installs itself for the current Windows user. It does not need admin rights for the normal install path, and it does not ask the user to pick folders or configure services.

The installer handles this automatically:

- copies the app to `%LOCALAPPDATA%\Programs\XenonEdgeHost`
- creates Start Menu shortcuts
- creates a Desktop shortcut
- registers the app to start when the user logs in
- adds `XENEON Edge Host` to Windows Settings > Apps
- launches the app

The Start Menu folder also includes two recovery shortcuts:

- `Launch Xenon Safe Mode` stops any running Xenon process, disables auto-start, ignores saved display placement, and opens on the primary monitor.
- `Repair XENEON Edge Host` restores Start Menu/Desktop shortcuts, startup registration, uninstall registration, and runtime checks without touching local app data.

The free beta installer may show a Windows SmartScreen warning until the app is signed. That warning is from Windows. After the user chooses to run the beta installer, Xenon should not ask more setup questions.

## Uninstall

Use either normal Windows path:

- Windows Settings > Apps > Installed apps > XENEON Edge Host
- Start Menu > XENEON Edge Host > Uninstall XENEON Edge Host

Uninstall is hands-free. It removes:

- the running app process
- the app files in `%LOCALAPPDATA%\Programs\XenonEdgeHost`
- Start Menu shortcuts
- Desktop shortcuts
- the auto-start entry
- the Windows Apps uninstall entry

## Remove Local Data Too

Use:

```text
Start Menu > XENEON Edge Host > Uninstall and Remove Local Data
```

That removes the app and also removes local Xenon data from:

- `%APPDATA%\XenonEdgeHost`
- `%LOCALAPPDATA%\XenonEdgeHost`

Use this when the user wants a clean reset or is done with the app completely.

## What Should Never Happen

- No folder picker during normal install.
- No manual service setup.
- No copied command lines for normal users.
- No uninstall confirmation prompts from Xenon scripts.
- No leftover Start Menu or Desktop shortcuts after uninstall.
- No half-installed app if reinstalling fails during file copy.
- No Safe Mode launch that reuses a stale saved display target.
- No repair flow that removes `%APPDATA%\XenonEdgeHost` or `%LOCALAPPDATA%\XenonEdgeHost`.

If any of those happen, the installer flow is broken and should be fixed before publishing.
