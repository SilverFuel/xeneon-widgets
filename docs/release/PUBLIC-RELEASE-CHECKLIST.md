# Public Release Checklist

Use this before publishing a paid or public download.

## Must Do

- Replace `support@example.com` and `security@example.com` with real inboxes.
- Confirm the product name and legal disclaimer are acceptable for selling.
- Sign the Windows installer and app executable.
- Build the macOS package on a Mac.
- Developer ID sign and notarize the macOS package.
- Test install, launch, restart, auto-start, and uninstall on a clean Windows machine.
- Test install, launch, quit, relaunch, and removal on a clean Mac.
- Upload release notes, installer, SHA256 file, and Mac package to GitHub Releases.
- Keep the app described as independent from CORSAIR, Ubiquiti, Philips Hue, OpenWeather, Microsoft, and Apple unless permission exists.

## Should Do

- Add a simple customer license page to the website or checkout flow.
- Add a "remove all local data" uninstall option.
- Add one clean support article: install, open dashboard, reset settings, send diagnostics.
- Add a small beta group before taking payment from strangers.
- Create a rollback download for the previous version.

## Do Not Ship If

- The Windows installer is unsigned.
- The Mac app is not notarized.
- Any API key or integration token appears in plain config JSON.
- Setup requires JSON endpoint copying for normal users.
- The app cannot open from the Start Menu or Applications folder after reboot.
