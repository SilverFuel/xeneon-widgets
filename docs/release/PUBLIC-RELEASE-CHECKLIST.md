# Public Release Checklist

Use this before publishing a free beta, paid release, or public download.

## Free Public Beta Must Do

- Publish `support.html` and `refund-policy.html` with the release.
- Clearly label the release as a free public beta.
- Clearly say the Windows installer is unsigned if it has not been code-signed.
- Clearly say the macOS host is beta-only unless it was built and tested on a real Mac.
- Clearly publish GitHub Issues and Security Advisories as the support path.
- Run `npm run release:ready` and resolve every blocker.
- Confirm the product name and legal disclaimer keep the app independent from CORSAIR.
- Test install, launch, restart, auto-start, and uninstall on a clean Windows machine when possible.
- Confirm Reset all app data removes local settings and protected secrets for the current user.
- Confirm the Start Menu uninstall cleanup shortcut removes local app data when selected.
- Confirm the in-app Updates panel can read the GitHub Releases feed and expose the latest installer download.
- Upload release notes, installer, and SHA256 file to GitHub Releases.
- Keep the app described as independent from CORSAIR, Ubiquiti, Philips Hue, OpenWeather, Microsoft, and Apple unless permission exists.

## Paid/Stable Must Do

- Add monitored support and security inboxes.
- Confirm the product name and legal disclaimer are acceptable for selling.
- Sign the Windows installer and app executable.
- Build the macOS package on a Mac.
- Developer ID sign and notarize the macOS package.
- Test install, launch, quit, relaunch, and removal on a clean Mac.
- Add the refund and license policy to the website or checkout flow.

## Should Do

- Offer a "remove all local data" option from the installer uninstaller UI, not only inside the app.
- Run `scripts\test-windows-install.ps1` in a clean Windows profile or VM.
- Add a small beta group before taking payment from strangers.
- Create a rollback download for the previous version.

## Do Not Ship A Free Beta If

- The Windows installer is unsigned and the release notes do not say that clearly.
- The Mac app is included without beta wording.
- Any API key or integration token appears in plain config JSON.
- Setup requires JSON endpoint copying for normal users.
- The app cannot open from the Start Menu or Applications folder after reboot.
- The support, license, reset, or update paths are missing from the customer build.
