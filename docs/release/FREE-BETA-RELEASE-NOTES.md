# Auxora 0.3.0-beta.1 Free Public Beta

Auxora 0.3.0-beta.1 is the adaptive Windows touch-display beta that succeeds XENEON Edge Host.

## Downloads

Use the Windows installer asset and matching SHA256 checksum:

- `Auxora-Setup-0.3.0-beta.1-<date>.exe`
- `Auxora-Setup-0.3.0-beta.1-<date>.exe.sha256`

## Important Notes

- This is free beta software. Do not pay for this build.
- This is independent software and is not an official CORSAIR product.
- The Windows installer is unsigned unless a signed asset is uploaded. Windows may show a SmartScreen warning.
- This public beta is Windows-only. The unfinished Mac scaffold is not published.
- Support is handled through GitHub Issues.
- Private security reports should use GitHub Security Advisories.
- Install and uninstall are meant to be hands-free after the Windows SmartScreen warning, if Windows shows one.

## What Is Included

- Native Windows host for landscape, ultrawide, and portrait touch displays.
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
- Clean install testing should still be repeated on a fresh Windows PC or VM before wider promotion.
- macOS packaging exists as a beta scaffold and needs real Mac testing before public promotion.
- Update checks can see GitHub Releases, but there is no silent auto-updater yet.
- Support is community/beta level through GitHub, not a paid support desk.
