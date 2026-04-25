# Public Release Checklist

Use this before publishing a paid or public download.

## Must Do

- Publish `support.html` and `refund-policy.html` with the release.
- Add monitored support and security inboxes, or clearly publish GitHub Issues and Security Advisories as the support path.
- Confirm the product name and legal disclaimer are acceptable for selling.
- Sign the Windows installer and app executable.
- Build the macOS package on a Mac.
- Developer ID sign and notarize the macOS package.
- Test install, launch, restart, auto-start, and uninstall on a clean Windows machine.
- Test install, launch, quit, relaunch, and removal on a clean Mac.
- Confirm Reset all app data removes local settings and protected secrets for the current user.
- Confirm the in-app Updates panel can read the GitHub Releases feed and expose the latest installer download.
- Upload release notes, installer, SHA256 file, and Mac package to GitHub Releases.
- Keep the app described as independent from CORSAIR, Ubiquiti, Philips Hue, OpenWeather, Microsoft, and Apple unless permission exists.

## Should Do

- Add the refund and license policy to the website or checkout flow.
- Offer a "remove all local data" option from the installer uninstaller UI, not only inside the app.
- Run `scripts\test-windows-install.ps1` in a clean Windows profile or VM.
- Add a small beta group before taking payment from strangers.
- Create a rollback download for the previous version.

## Do Not Ship If

- The Windows installer is unsigned.
- The Mac app is not notarized.
- Any API key or integration token appears in plain config JSON.
- Setup requires JSON endpoint copying for normal users.
- The app cannot open from the Start Menu or Applications folder after reboot.
- The support, refund, reset, or update paths are missing from the customer build.
