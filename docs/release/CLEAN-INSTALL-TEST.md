# Clean Install Test

Run this before every public Windows release. Use a fresh Windows user profile or a fresh Windows VM.

## Install

1. Download the signed installer from GitHub Releases.
2. Run the installer from a normal user account.
3. Confirm the app installs to `%LOCALAPPDATA%\Programs\XenonEdgeHost`.
4. Confirm the Start Menu shortcut appears.
5. Confirm the Desktop shortcut appears if enabled.
6. Confirm Windows Settings > Apps includes `XENEON Edge Host`.
7. Confirm the Start Menu includes Launch Xenon Safe Mode, Repair XENEON Edge Host, Uninstall, and Remove Local Data.
8. Open XENEON Edge Host from the Start Menu.
9. Confirm the dashboard opens at `http://127.0.0.1:8976/`.
10. Finish setup without configuring optional integrations.

The installer should not ask setup questions. A Windows SmartScreen warning is acceptable for an unsigned beta, but Xenon should not ask for a folder, service choice, or install mode.

## First Launch

1. Confirm System Monitor renders.
2. Confirm Network Monitor renders.
3. Confirm Audio renders on Windows with playback devices.
4. Confirm Setup says the essentials are ready.
5. Confirm Privacy opens and says the app is independent software.
6. Confirm Updates can check the GitHub Releases feed.
7. Confirm Support opens `support.html`.

## Reset Data

1. Open Privacy.
2. Click Reset all app data.
3. Click Confirm reset.
4. Confirm setup returns to the first-run state.
5. Confirm Weather and Hue secrets are removed from protected storage.
6. Reconfigure one harmless setting, then use the Start Menu cleanup uninstall shortcut and confirm local data is removed.

## Restart

1. Restart Windows.
2. Confirm the app starts if auto-start is enabled.
3. Confirm the dashboard still opens from the Start Menu.

## Recovery

1. Launch `Repair XENEON Edge Host` from the Start Menu.
2. Confirm shortcuts, Windows Apps entry, and startup registration still exist.
3. Launch `Launch Xenon Safe Mode` from the Start Menu.
4. Confirm auto-start is disabled and Xenon opens on the primary monitor without changing saved local app data.

## Uninstall

1. Uninstall from Windows Apps and Features.
2. Confirm the Start Menu shortcut is removed.
3. Confirm the Desktop shortcut is removed.
4. Confirm the auto-start entry is removed.
5. Confirm the app executable is removed from `%LOCALAPPDATA%\Programs\XenonEdgeHost`.
6. Reinstall, then use Start Menu > XENEON Edge Host > Uninstall and Remove Local Data.
7. Confirm `%APPDATA%\XenonEdgeHost` and `%LOCALAPPDATA%\XenonEdgeHost` are removed.

The uninstaller should not ask cleanup questions. The normal uninstall removes the app. The cleanup shortcut removes the app plus local data.

Do not publish a public release if any item above fails.
