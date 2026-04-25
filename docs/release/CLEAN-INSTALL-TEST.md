# Clean Install Test

Run this before every public Windows release. Use a fresh Windows user profile or a fresh Windows VM.

## Install

1. Download the signed installer from GitHub Releases.
2. Run the installer from a normal user account.
3. Confirm the Start Menu shortcut appears.
4. Confirm the Desktop shortcut appears if enabled.
5. Open XENEON Edge Host from the Start Menu.
6. Confirm the dashboard opens at `http://127.0.0.1:8976/`.
7. Finish setup without configuring optional integrations.

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

## Restart

1. Restart Windows.
2. Confirm the app starts if auto-start is enabled.
3. Confirm the dashboard still opens from the Start Menu.

## Uninstall

1. Uninstall from Windows Apps and Features.
2. Confirm the Start Menu shortcut is removed.
3. Confirm the auto-start entry is removed.
4. Confirm the app executable is removed from `%LOCALAPPDATA%\Programs\XenonEdgeHost`.
5. Confirm local user data can be removed with the in-app reset before uninstall.

Do not publish a public release if any item above fails.
