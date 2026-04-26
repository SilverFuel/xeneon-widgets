# XENEON Edge Host 0.2.0 Free Public Beta

This is the first free public beta for XENEON Edge Host.

## Downloads

Use the Windows installer asset and matching SHA256 checksum:

- `XenonEdgeHost-Setup-0.2.0-<date>.exe`
- `XenonEdgeHost-Setup-0.2.0-<date>.exe.sha256`

## Important Notes

- This is free beta software. Do not pay for this build.
- This is independent software and is not an official CORSAIR product.
- The Windows installer is unsigned unless a signed asset is uploaded. Windows may show a SmartScreen warning.
- The Mac host is still beta-only and should not be treated as a finished Mac product.
- Support is handled through GitHub Issues.
- Private security reports should use GitHub Security Advisories.

## What Is Included

- Native Windows host for the XENEON EDGE display.
- Local dashboard served at `http://127.0.0.1:8976/`.
- System telemetry, network status, audio, media, weather, calendar, Hue, launcher, and home-lab panels.
- First-run setup and diagnostics.
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
