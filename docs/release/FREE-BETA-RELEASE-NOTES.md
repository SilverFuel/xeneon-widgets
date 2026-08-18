# Auxora 0.3.0-beta.1 Free Public Beta

Auxora 0.3.0-beta.1 is the adaptive Windows touch-display beta that succeeds XENEON Edge Host.

## Downloads

Use the Windows installer asset and matching SHA256 checksum:

- `Auxora-Setup-0.3.0-beta.1-<date>.exe`
- `Auxora-Setup-0.3.0-beta.1-<date>.exe.sha256`

Download all five files named by `release-manifest.json` from the official GitHub Release. Before running the installer, open PowerShell in the download folder and run:

```powershell
(Get-FileHash -Algorithm SHA256 '.\Auxora-Setup-0.3.0-beta.1-<date>.exe').Hash
```

The 64-character result must exactly match the manifest's SHA-256 value and the first hash field in the `.sha256` sidecar. The filename must also match the manifest and the sidecar's filename field. If either differs, do not run the installer; delete the files and download them again from the official release.

## Important Notes

- This is free beta software. Do not pay for this build.
- This is independent software and is not an official CORSAIR product.
- This exact Windows beta candidate is unsigned. Windows may show a SmartScreen warning or organization policy may block it.
- This public beta is Windows-only. The unfinished Mac scaffold is not published.
- Support is handled through GitHub Issues.
- Private security reports should use GitHub Security Advisories.
- Verify the official source, exact filename, and SHA-256 before deciding whether to run it. Never disable SmartScreen, Smart App Control, antivirus, or organization policy. If Windows or policy blocks it, stop.
- Install and uninstall are hands-free after Windows permits the verified installer. Installation leaves Auxora closed and automatic startup disabled; open it deliberately from the Start Menu when the companion display is ready.
- If setup does not finish, troubleshooting details are in `%LOCALAPPDATA%\Auxora\InstallerLogs\install.log`. Setup does not add startup; the log identifies any older startup entry that could not be removed.

## What Is Included

- Native Windows host for landscape, ultrawide, and portrait touch displays.
- A simpler Layout Editor with numbered order, direct behavior and width choices, and a Home preview.
- Larger responsive now-playing artwork plus plain-language equalizer presets and guidance.
- Mixed-DPI placement and WebView2 startup fixes.
- Startup and display-placement fixes that do not change Windows resolution, display topology, gamma, HDR, or color profiles.
- Local dashboard served at `http://127.0.0.1:8976/`.
- System telemetry, network status, audio, media, weather, calendar, Hue, launcher, and home-lab panels.
- First-run setup and diagnostics.
- Hands-free Windows install and uninstall flow.
- Protected local storage for Weather and Hue secrets.
- Setup-free basic UniFi detection through the local host.
- Reset all app data from the setup/privacy screen.
- Start Menu cleanup shortcut for removing local data during uninstall.

## Known Limitations

- Unsigned Windows installers may trigger Windows warnings.
- Auxora intentionally remains closed when no user launches it and intentionally stays off the Windows primary display.
- Publication is blocked until this exact manifest-bound installer passes the schema-3 disposable-VM lifecycle, including an injected failed-upgrade rollback, plus the physical Frigate/camera and physical companion-display qualification gates.
- macOS packaging exists as a beta scaffold and needs real Mac testing before public promotion.
- Update checks can see GitHub Releases, but there is no silent auto-updater yet.
- Support is community/beta level through GitHub, not a paid support desk.
