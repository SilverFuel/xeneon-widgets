# Public Release Checklist

Use this before publishing a free beta, paid release, or public download.

## Automated Gate

- Run the gauntlet with `-InstallerPath` pointing to the exact candidate. Do not select a local installer by timestamp.
- For a disposable Windows VM or fresh Windows profile, run:

```powershell
powershell -File scripts\run-release-gauntlet.ps1 -InstallerPath app\dist\<installer>.exe -AllowGitHubSupportPath -AllowUnsignedBeta -RunInstallSmoke -RunUninstall -RemoveLocalData
```

- A publication-bound run must also supply `-ReleaseAssetsPath`, `-LifecycleReceiptPath`, `-FrigateQualificationReceiptPath`, and `-DisplayQualificationReceiptPath` together. The gauntlet rejects partial evidence.

## Free Public Beta Must Do

- Keep `support.html` and `refund-policy.html` bundled in the app and reachable through the documented support path; they are not extra release assets.
- Clearly label the release as a free public beta.
- Clearly say the Windows installer is unsigned if it has not been code-signed.
- Publish no macOS assets; the beta workflow is Windows-only.
- Clearly publish GitHub Issues and Security Advisories as the support path.
- Run `npm run release:ready-beta -- -InstallerPath .\app\dist\Auxora-Setup-<version>-<date>.exe` and resolve every blocker. The unsigned-beta gate requires Authenticode status exactly `NotSigned`; it rejects signed and invalidly signed files.
- Treat `npm run release:free-beta` as a verifier, not a local-build shortcut: pass the immutable release asset directory plus all exact-candidate receipt paths. It fails closed when any are missing.
- Create the GitHub `beta-publication` environment before dispatching publication. Require at least one reviewer other than the person starting the run, enable **Prevent self-review**, and disable administrator bypass. Confirm `scripts\Test-GitHubReleaseEnvironment.ps1 -Repository SilverFuel/xeneon-widgets` passes, then confirm the bypass setting in GitHub because the verifier cannot read it.
- Confirm the product name and legal disclaimer keep the app independent from CORSAIR.
- Require the exact manifest-bound installer to stay closed after install, pass deliberate launch, live `/api/health`, process restart, reboot with no autostart, injected failed-upgrade rollback, successful previous-beta upgrade, repair, normal uninstall, and remove-all-data on a disposable Windows VM. Require a passing schema-3 receipt.
- Confirm customer instructions show `Get-FileHash -Algorithm SHA256`, require exact filename/hash agreement, and tell users to stop on a mismatch or policy block without disabling Windows security.
- Require the same manifest-bound installer to pass `docs/release/FRIGATE-CERTIFICATION.md` against a physical Frigate server and real camera on the target LAN. Verify the secret-free receipt with `scripts/Test-FrigateQualificationReceipt.ps1`.
- Require the same manifest-bound installer to pass `docs/release/DISPLAY-CERTIFICATION.md` on a physical Windows machine and physical touch companion display. Verify the privacy-safe receipt with `scripts/Test-DisplayQualificationReceipt.ps1`.
- Confirm Reset all app data removes local settings and protected secrets for the current user.
- Confirm the Start Menu uninstall cleanup shortcut removes local app data when selected and does not ask extra questions.
- Confirm the in-app Updates panel can read the GitHub Releases feed and open the official Releases page for a newer beta. This unsigned beta must keep direct installer links hidden because Auxora has not downloaded and verified the installer bytes itself.
- Upload only the manifest allowlist: one Windows installer, its SHA256 file, install notes, release notes, and `release-manifest.json`.
- Never edit a release or replace bytes under an existing tag. Increment the beta version and create a new tag.
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

- Offer a "remove all local data" Start Menu uninstall shortcut, not only inside the app.
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
- Camera Detection has no verified exact-candidate receipt from a physical Frigate server and real camera.
- Companion-display behavior has no verified exact-candidate receipt covering primary-display exclusion, taskbar hiding, hot-plug recovery, role switching, scaling, touch, keyboard, and screen-reader behavior.
