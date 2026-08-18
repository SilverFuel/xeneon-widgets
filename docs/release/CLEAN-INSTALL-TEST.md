# Clean Install Test

Run every pass below against the same manifest-bound candidate in a disposable Windows VM. Record the exact tag, commit SHA, installer filename, and SHA-256. Verify the official GitHub source, filename, manifest value, and first hash field in the `.sha256` sidecar before running anything. Never disable Windows or organization security policy.

## Clean Install And Closed-by-Default Pass

1. Start from a VM snapshot with no Auxora or XENEON installation, process, scheduled task, Run-key value, or local data.
2. Run the exact candidate installer from a normal user account. A SmartScreen warning is acceptable for this unsigned beta only after checksum verification.
3. Confirm setup asks for no folder, service, startup, or launch choices.
4. Confirm the installer exits successfully and installs to `%LOCALAPPDATA%\Programs\Auxora`.
5. Confirm Start Menu > Auxora contains `Auxora`, `Auxora Recovery (Safe Mode)`, `Repair Auxora`, `Uninstall Auxora`, and `Remove Auxora and Local Data`.
6. Confirm the Desktop shortcut is named `Auxora` and Windows Settings > Apps includes `Auxora`.
7. For at least 30 seconds, confirm no `XenonEdgeHost` process starts and no `XenonEdgeHost` or `XeneonBridge` scheduled task or Run-key value exists. This is `staysClosedAfterInstall=true`.
8. Open `Auxora` deliberately from the Start Menu. Confirm System Monitor, Network Monitor, Audio, Privacy, Updates, and Support render without a fatal state.
9. Run `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8976/api/health` and confirm HTTP 200 plus the expected Auxora version. This proves `launch=true` and `health=true`.

## Process Restart Pass

1. Close Auxora and confirm `XenonEdgeHost` exits. If it does not, end only that process in Task Manager and record the failure.
2. Open Auxora again from the Start Menu.
3. Repeat the `/api/health` check and confirm the same candidate version. This is `processRestart=true`.

## Windows Reboot Pass

1. Restart Windows normally.
2. Wait at least 30 seconds after sign-in.
3. Confirm Auxora remains closed and both Auxora and legacy bridge startup tasks/Run-key values remain absent. This is `noAutoStartAfterReboot=true`.
4. Open Auxora deliberately and repeat the `/api/health` check.

## Repair Pass

1. Delete one non-data shortcut, then launch `Repair Auxora` from the Start Menu.
2. Confirm the shortcut and Windows Apps entry are restored.
3. Confirm Repair does not launch Auxora, enable either startup path, or change local app data.
4. Open Auxora deliberately and repeat the `/api/health` check. This is `repair=true`.
5. Launch `Auxora Recovery (Safe Mode)` and confirm automatic startup remains disabled. On an active non-primary companion display, confirm Auxora opens there; with none active, confirm it remains tray-only.

## Normal Uninstall Pass

1. Uninstall from Windows Settings > Apps.
2. Confirm the process, `%LOCALAPPDATA%\Programs\Auxora`, Start Menu folder, Desktop shortcut, Windows Apps entry, and both current and legacy startup paths are absent.
3. Confirm normal uninstall leaves local Auxora data intact. This is `normalUninstall=true`.

## Failed Upgrade Rollback And Successful Upgrade Pass

Use the installer test seam only inside the disposable VM. Do not set it on a normal workstation.

1. Restore the clean VM snapshot.
2. Install the immediately previous verified beta. Open it, save one harmless, identifiable local setting, and then close it.
3. Record the previous executable identity and uninstall registration. Confirm the previous Start Menu/Desktop shortcuts are present. Keep these values for comparison after the injected failure:

   ```powershell
   $previousExe = "$env:LOCALAPPDATA\Programs\Auxora\XenonEdgeHost.exe"
   $previousProductVersion = (Get-Item -LiteralPath $previousExe).VersionInfo.ProductVersion
   $previousSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $previousExe).Hash
   $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Auxora'
   $previousUninstall = Get-ItemProperty -LiteralPath $uninstallKey |
     Select-Object DisplayVersion, InstallLocation, UninstallString, QuietUninstallString
   $startShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Auxora\Auxora.lnk'
   $desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Auxora.lnk'
   if (-not (Test-Path -LiteralPath $startShortcut) -or -not (Test-Path -LiteralPath $desktopShortcut)) {
     throw 'The previous beta shortcuts are incomplete before the rollback test.'
   }
   ```
4. Open PowerShell in the folder containing the exact manifest-bound candidate and run this exact failure-injection sequence, replacing the filename placeholder:

   ```powershell
   $candidate = (Resolve-Path '.\Auxora-Setup-0.3.0-beta.1-<date>.exe').Path
   $qualificationCommit = '<40-character manifest commit>'
   $qualificationMarker = Join-Path ([IO.Path]::GetTempPath()) `
     ("Auxora-ReleaseQualification-{0}.marker" -f [guid]::NewGuid().ToString('N'))
   Set-Content -LiteralPath $qualificationMarker `
     -Value "Auxora:$qualificationCommit`:after-registration" -Encoding ASCII
   $env:AUXORA_RELEASE_QUALIFICATION_COMMIT = $qualificationCommit
   $env:AUXORA_RELEASE_QUALIFICATION_MARKER = $qualificationMarker
   $env:AUXORA_INSTALLER_TEST_FAILURE = 'after-registration'
   try {
     $attempt = Start-Process -FilePath $candidate -Wait -PassThru
     if ($null -eq $attempt.ExitCode -or $attempt.ExitCode -eq 0) {
       throw 'The injected upgrade did not report the expected failure.'
     }
   }
   finally {
     Remove-Item Env:\AUXORA_INSTALLER_TEST_FAILURE -ErrorAction SilentlyContinue
     Remove-Item Env:\AUXORA_RELEASE_QUALIFICATION_COMMIT -ErrorAction SilentlyContinue
     Remove-Item Env:\AUXORA_RELEASE_QUALIFICATION_MARKER -ErrorAction SilentlyContinue
     Remove-Item -LiteralPath $qualificationMarker -Force -ErrorAction SilentlyContinue
   }
   ```

5. Confirm setup reports the injected failure. Confirm `Test-Path Env:\AUXORA_INSTALLER_TEST_FAILURE`, `Test-Path Env:\AUXORA_RELEASE_QUALIFICATION_COMMIT`, `Test-Path Env:\AUXORA_RELEASE_QUALIFICATION_MARKER`, and `Test-Path -LiteralPath $qualificationMarker` all return `False` before continuing.
6. Verify the rollback restored the previous executable, shortcuts, and uninstall metadata exactly:

   ```powershell
   if ((Get-Item -LiteralPath $previousExe).VersionInfo.ProductVersion -cne $previousProductVersion) {
     throw 'The previous ProductVersion was not restored.'
   }
   if ((Get-FileHash -Algorithm SHA256 -LiteralPath $previousExe).Hash -cne $previousSha256) {
     throw 'The previous executable SHA-256 was not restored.'
   }
   if (-not (Test-Path -LiteralPath $startShortcut) -or -not (Test-Path -LiteralPath $desktopShortcut)) {
     throw 'The previous shortcuts were not restored.'
   }
   $restoredUninstall = Get-ItemProperty -LiteralPath $uninstallKey |
     Select-Object DisplayVersion, InstallLocation, UninstallString, QuietUninstallString
   $metadataDifference = Compare-Object @($previousUninstall) @($restoredUninstall) `
     -Property DisplayVersion, InstallLocation, UninstallString, QuietUninstallString
   if ($metadataDifference) {
     throw 'The previous uninstall registration was not restored.'
   }
   ```

   Open the previous beta deliberately from the restored shortcut, confirm the harmless setting is unchanged, and close it again.
7. Confirm these searches return no items:

   ```powershell
   Get-ChildItem "$env:LOCALAPPDATA\Programs" -Force -Filter 'Auxora.installing-*'
   Get-ChildItem "$env:LOCALAPPDATA\Programs" -Force -Filter 'Auxora.backup-*'
   Get-ChildItem "$env:TEMP" -Force -Filter 'Auxora-Payload-*'
   Get-ChildItem "$env:TEMP" -Force -Filter 'Auxora-Metadata-*'
   Get-ChildItem "$env:TEMP" -Force -Filter 'Auxora-ReleaseQualification-*'
   ```

8. Confirm Auxora remains closed and both current and legacy startup tasks/Run-key values are absent. Rollback deliberately does not re-enable an older automatic-startup entry. Steps 4-8 prove `rollbackAfterInjectedFailure=true`.
9. With the test environment variable still absent, run the same exact candidate installer normally. Confirm it succeeds, stays closed for at least 30 seconds, and leaves both startup paths absent.
10. Open Auxora deliberately. Confirm the harmless setting survived, `/api/health` reports the new candidate version, shortcuts and uninstall metadata now identify the new candidate, and the five residue searches above remain empty. This is `upgradeFromPreviousBeta=true`.

## Remove All Data Pass

1. With the candidate installed, seed harmless marker files under `%APPDATA%\Auxora`, `%LOCALAPPDATA%\Auxora`, `%APPDATA%\XenonEdgeHost`, and `%LOCALAPPDATA%\XenonEdgeHost`.
2. Use Start Menu > Auxora > Remove Auxora and Local Data.
3. Confirm the app, shortcuts, Windows Apps entry, startup paths, all four data roots, and marker files are absent. This is `removeAllData=true`.

Do not publish if any step fails. After all passes succeed, create this schema-3 receipt and verify it with `scripts\Test-BetaLifecycleReceipt.ps1` against the downloaded release asset directory:

Use JSON Boolean values, not quoted strings, for every environment and check result. Record `completedAt` as a UTC ISO-8601 timestamp. Publication verification rejects timestamps more than five minutes in the future or more than 30 days old.

```json
{
  "schemaVersion": 3,
  "tag": "v0.3.0-beta.1",
  "version": "0.3.0-beta.1",
  "commitSha": "<40-character manifest commit>",
  "installerFileName": "Auxora-Setup-0.3.0-beta.1-<date>.exe",
  "installerSha256": "<64-character manifest SHA-256>",
  "environment": {
    "disposableWindowsVm": true,
    "windowsVersion": "<Windows edition, version, and build>"
  },
  "operator": "<tester name>",
  "completedAt": "<UTC ISO-8601 timestamp>",
  "checks": {
    "install": true,
    "staysClosedAfterInstall": true,
    "launch": true,
    "health": true,
    "processRestart": true,
    "noAutoStartAfterReboot": true,
    "rollbackAfterInjectedFailure": true,
    "upgradeFromPreviousBeta": true,
    "repair": true,
    "normalUninstall": true,
    "removeAllData": true
  }
}
```
