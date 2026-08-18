import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const buildInstaller = readWorkspaceFile("app/build-installer.ps1");
const installHost = readWorkspaceFile("app/installer/Install-XenonEdgeHost.ps1");
const webView2RuntimeProbe = readWorkspaceFile("app/installer/WebView2RuntimeProbe.ps1");
const autoStartInstall = readWorkspaceFile("app/install.ps1");
const autoStartRemove = readWorkspaceFile("app/uninstall.ps1");
const removeHost = readWorkspaceFile("app/installer/Remove-XenonEdgeHost.ps1");
const safeModeLaunch = readWorkspaceFile("app/Launch-XenonSafeMode.ps1");
const repairInstall = readWorkspaceFile("app/repair.ps1");
const program = readWorkspaceFile("app/Program.cs");
const mainWindow = readWorkspaceFile("app/MainWindow.xaml.cs");
const bridgeManager = readWorkspaceFile("app/BridgeManager.cs");
const smokeTest = readWorkspaceFile("scripts/test-windows-install.ps1");
const cleanInstallTest = readWorkspaceFile("docs/release/CLEAN-INSTALL-TEST.md");
const artifactVerifier = readWorkspaceFile("scripts/Test-ReleaseArtifact.ps1");
const iexpressFixture = readWorkspaceFile("scripts/test-iexpress-packaging.ps1");
const releaseWorkflow = readWorkspaceFile(".github/workflows/release.yml");
const manifestGenerator = readWorkspaceFile("scripts/New-ReleaseManifest.ps1");
const manifestVerifier = readWorkspaceFile("scripts/Test-ReleaseManifest.ps1");
const manifestFixture = readWorkspaceFile("scripts/test-release-manifest.ps1");
const webView2ProbeFixture = readWorkspaceFile("scripts/test-webview2-runtime-probe.ps1");
const packageJson = JSON.parse(readWorkspaceFile("package.json"));

function readWorkspaceFile(relativePath) {
  const filePath = resolve(process.cwd(), relativePath);
  try {
    if (!existsSync(filePath)) {
      throw new Error("file does not exist");
    }

    return readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`Unable to read ${relativePath} at ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  /Start-Process \$iexpress\.Source[\s\S]+-PassThru/.test(buildInstaller)
    && /IExpress requires a staging path without whitespace/.test(buildInstaller)
    && /-ArgumentList @\("\/N", "\/Q", "\/M", \$sedPath\)/.test(buildInstaller)
    && /IExpress failed with exit code/.test(buildInstaller)
    && /Get-Sha256Hash \$temporaryOutputPath/.test(buildInstaller)
    && /Published executable ProductVersion/.test(buildInstaller)
    && /not bound to current commit/.test(buildInstaller)
    && /Installer builds require a clean working tree/.test(buildInstaller)
    && /Use -AllowDirtySource only for a non-release development build/.test(buildInstaller)
    && /Git HEAD changed from \$currentCommit to \$postPublishCommit while publishing/.test(buildInstaller)
    && /The working tree changed while publishing/.test(buildInstaller)
    && /Auxora-InstallerBuild-/.test(buildInstaller)
    && /Installer staging was not empty immediately after creation/.test(buildInstaller)
    && /OutputPath must end with \.exe/.test(buildInstaller)
    && /\[System\.IO\.File\]::Move\(\$temporaryOutputPath, \$outputPath\)/.test(buildInstaller)
    && /\[System\.IO\.File\]::Move\(\$temporaryHashPath, \$hashPath\)/.test(buildInstaller)
    && /if \(\$movedInstallerToFinal\)[\s\S]+Remove-OwnedFinalFileBestEffort \$outputPath/.test(buildInstaller)
    && /if \(\$movedHashToFinal\)[\s\S]+Remove-OwnedFinalFileBestEffort \$hashPath/.test(buildInstaller)
    && /Remove-TemporaryPathBestEffort \$stageRoot/.test(buildInstaller)
    && !/Stop-Process/.test(buildInstaller)
    && /Install-XenonEdgeHost\.ps1" -Quiet -NoAutoStart -SkipLaunch/.test(buildInstaller)
    && /WebView2RuntimeProbe\.ps1/.test(buildInstaller)
    && /does not start at login/.test(buildInstaller)
    && /Get-FileHash -Algorithm SHA256/.test(buildInstaller)
    && /do not run the installer/.test(buildInstaller)
    && /Launch-XenonSafeMode\.ps1/.test(buildInstaller)
    && /repair\.ps1/.test(buildInstaller),
  "installer build must check IExpress exit code, constrain output deletion, package rescue scripts, stay closed without autostart, and explain SHA256 verification"
);

assert(
  /Auxora-IExpress-Test-/.test(iexpressFixture)
    && /Start-Process \$iexpress\.Source -ArgumentList @\("\/N", "\/Q", "\/M", \$sedPath\) -Wait -PassThru/.test(iexpressFixture)
    && /\.auxora-iexpress-test\.exe/.test(iexpressFixture)
    && /Remove-Item -LiteralPath \$testRoot -Recurse -Force/.test(iexpressFixture),
  "IExpress packaging must be tested without launching the generated fixture"
);

assert(
  /\$installationCompleted = \$false/.test(installHost)
    && /Stop-RunningHost/.test(installHost)
    && /Get-Process -Id \$processId/.test(installHost)
    && /The running XenonEdgeHost process did not exit/.test(installHost)
    && /Restored previous install after setup failed/.test(installHost)
    && /Backup remains at \$backupInstallRoot/.test(installHost)
    && /Removed partial install after setup failed/.test(installHost)
    && /Get-UsableWebView2Runtime \$stagedInstallRoot/.test(installHost)
    && /\. \$runtimeProbeScript/.test(installHost)
    && /No existing Auxora files were replaced/.test(installHost)
    && /function Restore-BackupInstall/.test(installHost)
    && /Restore target already exists; refusing to nest or overwrite the backup/.test(installHost)
    && /\[System\.IO\.Directory\]::Move\(\$safeBackupPath, \$safeRestorePath\)/.test(installHost)
    && /\$backupRestoreRoot = \$legacyInstallRoot[\s\S]+\[System\.IO\.Directory\]::Move\(\$legacyInstallRoot, \$backupInstallRoot\)/.test(installHost)
    && /Restore-BackupInstall \$backupInstallRoot \$restoreTarget \$programsRoot/.test(installHost)
    && /if \(-not \$installationCompleted -and \(Test-Path -LiteralPath \$backupInstallRoot -PathType Container\)\) \{\s*\$restoreTarget[\s\S]+?\s+try \{/.test(installHost)
    && /\$installerTempRoot = \[System\.IO\.Path\]::GetTempPath\(\)/.test(installHost)
    && /Join-Path \$installerTempRoot \("Auxora-Payload-"/.test(installHost)
    && /Join-Path \$installerTempRoot \("Auxora-Metadata-"/.test(installHost)
    && /AUXORA_INSTALLER_TEST_FAILURE -ceq "after-registration"/.test(installHost)
    && /AUXORA_RELEASE_QUALIFICATION_COMMIT/.test(installHost)
    && /AUXORA_RELEASE_QUALIFICATION_MARKER/.test(installHost)
    && /qualificationCommit -match '\^\[0-9a-fA-F\]\{40\}\$'/.test(installHost)
    && /installedProductVersion\.EndsWith\("\.\$qualificationCommit"/.test(installHost)
    && /Assert-SafePathUnder \$qualificationMarkerPath \$installerTempRoot "Release qualification marker"/.test(installHost)
    && /FileAttributes\]::ReparsePoint/.test(installHost)
    && /markerIsDirectTempFile/.test(installHost)
    && /qualificationMarkerMatches/.test(installHost)
    && /Injected release-test failure after app registration/.test(installHost)
    && /function Restore-RegistryKeySnapshot\(\$path, \$snapshot\) \{\s*\$currentUserPrefix[\s\S]+?Registry snapshot restore supports only current-user keys[\s\S]+?if \(Test-Path -LiteralPath \$path\)/.test(installHost)
    && /CreateSubKey\(\$subKeyPath, \$true\)/.test(installHost)
    && /Metadata rollback backup was retained at \$metadataBackupRoot/.test(installHost)
    && /Remove-DirectoryBestEffort \$backupInstallRoot/.test(installHost)
    && /A superseded XENEON Start Menu folder was retained/.test(installHost)
    && /A superseded XENEON desktop shortcut was retained/.test(installHost)
    && /superseded XenonEdgeHost uninstall registration was retained/.test(installHost)
    && /if \(\$installationCompleted\)[\s\S]+Backup install folder/.test(installHost),
  "installer must verify WebView2 before replacement, stop the running app, and preserve or restore current and legacy installs when an upgrade fails"
);

assert(
  /GetAvailableCoreWebView2BrowserVersionString/.test(webView2RuntimeProbe)
    && /LoadLibraryExW/.test(webView2RuntimeProbe)
    && /Marshal\.FreeCoTaskMem\(versionInfo\)/.test(webView2RuntimeProbe)
    && /Test-UsableWebView2Version/.test(webView2RuntimeProbe)
    && /0, 0, 0, 0/.test(webView2RuntimeProbe)
    && !/EdgeUpdate|Get-ItemProperty|["']pv["']/.test(webView2RuntimeProbe)
    && /Evergreen uses the candidate loader Core API/.test(webView2ProbeFixture)
    && /FixedRuntime uses its exact browser folder/.test(webView2ProbeFixture)
    && /zero version rejected/.test(webView2ProbeFixture)
    && /loader API failure rejected/.test(webView2ProbeFixture),
  "installer and repair must prove WebView2 availability through the shipped official loader API without trusting registry pv"
);

assert(
  /AUXORA_INSTALLER_TEST_FAILURE = 'after-registration'/.test(cleanInstallTest)
    && /AUXORA_RELEASE_QUALIFICATION_COMMIT = \$qualificationCommit/.test(cleanInstallTest)
    && /AUXORA_RELEASE_QUALIFICATION_MARKER = \$qualificationMarker/.test(cleanInstallTest)
    && /Auxora-Payload-\*/.test(cleanInstallTest)
    && /Auxora-Metadata-\*/.test(cleanInstallTest)
    && /Auxora-ReleaseQualification-\*/.test(cleanInstallTest)
    && /rollbackAfterInjectedFailure/.test(cleanInstallTest),
  "disposable-VM qualification must exercise injected rollback and verify installer temporary folders are removed"
);

assert(
  /if \(-not \$NoAutoStart\)/.test(installHost)
    && /Deliberate fail-safe:[\s\S]+never re-enables it after failure/.test(installHost)
    && /Configuring runtime without automatic startup/.test(installHost)
    && /\$runtimeScript[\s\S]+-RuntimeOnly/.test(installHost)
    && /Preflighting automatic startup removal[\s\S]+& \$supportUninstall/.test(installHost)
    && /Verifying automatic startup remains disabled/.test(installHost)
    && /\$autoStartRemoveScript\s*=\s*Join-Path \$InstallRoot "uninstall\.ps1"/.test(installHost)
    && /& \$autoStartRemoveScript/.test(installHost),
  "installer -NoAutoStart must remove any existing Xenon autostart integration"
);

assert(
  /Launch-XenonSafeMode\.ps1/.test(installHost)
    && /repair\.ps1/.test(installHost)
    && /Auxora\.lnk/.test(installHost)
    && /Auxora Recovery \(Safe Mode\)\.lnk/.test(installHost)
    && /Repair Auxora\.lnk/.test(installHost),
  "installer must install one obvious app shortcut plus clearly labeled recovery and repair shortcuts"
);

assert(
  /Stop-RunningHost/.test(safeModeLaunch)
    && /The running XenonEdgeHost process did not exit/.test(safeModeLaunch)
    && /uninstall\.ps1/.test(safeModeLaunch)
    && /Start-Process[\s\S]+--safe-mode/.test(safeModeLaunch),
  "Safe Mode launcher must stop the running app, disable autostart, and launch with --safe-mode"
);

assert(
  /Register-UninstallEntry/.test(repairInstall)
    && /Auxora\.lnk/.test(repairInstall)
    && /Auxora Recovery \(Safe Mode\)\.lnk/.test(repairInstall)
    && /Repair Auxora\.lnk/.test(repairInstall)
    && /legacyShortcutRoots/.test(repairInstall)
    && /& \$autoStartRemoveScript -Quiet -KeepRunning/.test(repairInstall)
    && /& \$runtimeScript -Quiet -RuntimeOnly/.test(repairInstall)
    && !/& \$installScript -Quiet/.test(repairInstall)
    && /InstallerLogs/.test(repairInstall)
    && /repair\.log/.test(repairInstall)
    && /Start-Transcript/.test(repairInstall)
    && /Show-QuietRepairFailure/.test(repairInstall)
    && /MessageBox/.test(repairInstall)
    && /Durable log/.test(repairInstall)
    && !/ResetLocalData/.test(repairInstall)
    && !/Remove-Item[\s\S]+XenonEdgeHost/.test(repairInstall),
  "repair script must restore shortcuts and uninstall registration, keep automatic startup disabled, and leave local data alone"
);

assert(
  /\$taskNames\s*=\s*@\("XenonEdgeHost", "XeneonBridge"\)/.test(autoStartRemove)
    && /\$runValueNames\s*=\s*@\("XenonEdgeHost", "XeneonBridge"\)/.test(autoStartRemove)
    && /Automatic startup could not be disabled/.test(autoStartRemove)
    && /legacyTaskName\s*=\s*"XeneonBridge"/.test(smokeTest)
    && /legacyRunValueName\s*=\s*"XeneonBridge"/.test(smokeTest),
  "safe installation and repair must remove both Auxora and legacy bridge autostart paths"
);

assert(
  /\[switch\]\$RuntimeOnly/.test(autoStartInstall)
    && /Scheduled task \(primary auto-start method\)/.test(autoStartInstall)
    && /if \(-not \$RuntimeOnly\)\s*\{[\s\S]+Register-ScheduledTask[\s\S]+New-ItemProperty -Path \$runKeyPath/.test(autoStartInstall)
    && /Configuring runtime without automatic startup[\s\S]+\$runtimeScript -Quiet -RuntimeOnly/.test(installHost)
    && /Get-UsableWebView2Runtime \$appRoot[\s\S]+# --- Scheduled task/.test(autoStartInstall)
    && !/Get-InstalledWebView2Version|EdgeUpdate|["']pv["']/.test(autoStartInstall)
    && /Verifying embedded browser runtime[\s\S]+\$runtimeScript -Quiet -RuntimeOnly[\s\S]+Repairing simple launch shortcuts/.test(repairInstall),
  "fresh install and repair must configure WebView2 runtime support without enabling automatic startup"
);

assert(
  /LaunchOptions = AppLaunchOptions\.Parse\(args\)/.test(program)
    && /Program\.LaunchOptions\.SafeMode/.test(mainWindow)
    && /ignoreSavedPreference:\s*safeMode/.test(mainWindow)
    && /saveSelection:\s*saveSelection && !safeMode/.test(mainWindow)
    && /\.Where\(display => !display\.IsPrimary\)/.test(mainWindow)
    && /if\s*\(targetDisplay\.IsPrimary\)[\s\S]+refused to show its window/.test(mainWindow)
    && /EnterCompanionDisplayWaitingState[\s\S]+SwHide/.test(mainWindow)
    && /ListDisplayCandidates\(bool ignoreSavedPreference = false\)/.test(bridgeManager)
    && !/\bpreferPrimary\b/.test(mainWindow)
    && !/\bpreferPrimary\b/.test(bridgeManager)
    && /available companion display/i.test(safeModeLaunch)
    && !/on the primary display/i.test(safeModeLaunch),
  "host Safe Mode must ignore a broken saved preference while remaining hidden until a non-primary companion display is available"
);

assert(
  /Register-ScheduledTask[\s\S]+-Force/.test(autoStartInstall)
    && /Enable-ScheduledTask -TaskName \$taskName -TaskPath/.test(autoStartInstall)
    && /schtasks\.exe \/Change \/TN/.test(autoStartInstall)
    && /still disabled after repair/.test(autoStartInstall)
    && /Installed or repaired scheduled task/.test(autoStartInstall),
  "autostart install must repair, enable, and verify an existing scheduled task"
);

assert(
  /Assert-SafeInstallPath \$InstallRoot/.test(removeHost)
    && /Resolve-SafeLocalDataPath/.test(removeHost)
    && /Stop-RunningHost/.test(removeHost)
    && /Get-Process -Id \$processId/.test(removeHost)
    && /The running XenonEdgeHost process did not exit/.test(removeHost)
    && /Remove-StartupFallback/.test(removeHost)
    && /Unregister-ScheduledTask -TaskName \$taskName -TaskPath/.test(removeHost)
    && /Remove-Item -LiteralPath \$shortcutRoot/.test(removeHost),
  "uninstaller must stop the app and constrain destructive cleanup to expected current-user paths"
);

assert(
  /\$RemoveLocalData -and -not \$RunUninstall/.test(smokeTest)
    && /RemoveLocalData requires -RunUninstall/.test(smokeTest)
    && /Assert-StartupAbsent/.test(smokeTest)
    && /Assert-HostClosed/.test(smokeTest)
    && /function Assert-HostClosed[\s\S]+ObservationSeconds[\s\S]+AddSeconds[\s\S]+Start-Sleep/.test(smokeTest)
    && /if \(\$RunInstall\)[\s\S]+Stop-InstalledHost[\s\S]+Invoke-Installer \$InstallerPath/.test(smokeTest)
    && /Launch-XenonSafeMode\.ps1/.test(smokeTest)
    && /repair\.ps1/.test(smokeTest)
    && /PreviousInstallerPath/.test(smokeTest)
    && /Assert-LaunchAndRestartHealth/.test(smokeTest)
    && /api\/health/.test(smokeTest)
    && /Running installed repair/.test(smokeTest)
    && /Uninstaller exited with code/.test(smokeTest)
    && /\$installRoot\s*=\s*Join-Path \$env:LOCALAPPDATA "Programs\\Auxora"/.test(smokeTest)
    && /\$shortcutRoot\s*=\s*Join-Path \$env:APPDATA "Microsoft\\Windows\\Start Menu\\Programs\\Auxora"/.test(smokeTest),
  "install smoke test must validate current Auxora paths, closed/no-autostart installation, rescue shortcuts, and keep data deletion inside uninstall"
);

assert(
  /ReleaseAssetsPath/.test(smokeTest)
    && /Test-ReleaseManifest\.ps1/.test(smokeTest)
    && /function Assert-InstalledCandidateIdentity/.test(smokeTest)
    && /Get-FileHash -LiteralPath \$exePath -Algorithm SHA256/.test(smokeTest)
    && /ProductVersion/.test(smokeTest)
    && /Assert-Present \$exePath "Installed executable"\s+Assert-InstalledCandidateIdentity[\s\S]+if \(\$RunLaunchHealth\)/.test(smokeTest)
    && /RunInstallSmoke requires ReleaseAssetsPath/.test(readWorkspaceFile("scripts/run-release-gauntlet.ps1")),
  "disposable install smoke must verify the installed executable manifest binding before health or receipt claims"
);

assert(
  /schemaVersion = 2/.test(manifestGenerator)
    && /installedExecutable = \[ordered\]@\{/.test(manifestGenerator)
    && /PublishedAppPath/.test(manifestGenerator)
    && /ProductVersion/.test(manifestGenerator)
    && /Assert-ExactProperties \$manifest/.test(manifestVerifier)
    && /installedExecutableHash/.test(manifestVerifier)
    && /Published app SHA-256 does not match/.test(manifestVerifier)
    && /extra manifest root property rejected/.test(manifestFixture)
    && /mis-cased installer property rejected/.test(manifestFixture)
    && /mis-cased installed executable property rejected/.test(manifestFixture)
    && /wrong installed executable hash rejected/.test(manifestFixture)
    && /different published executable bytes rejected/.test(manifestFixture),
  "release manifest schema must bind exact installed executable bytes and reject extra, mis-cased, or tampered identity fields"
);

assert(
  /Auxora-Setup-\$ExpectedVersion-/.test(artifactVerifier)
    && /Installer SHA256 sidecar does not match/.test(artifactVerifier)
    && /ExpectedInformationalVersion/.test(artifactVerifier)
    && /ExpectedProductName\s*=\s*"Auxora"/.test(artifactVerifier)
    && /Published app ProductName must be \$ExpectedProductName/.test(artifactVerifier)
    && /Published app ProductVersion/.test(artifactVerifier)
    && /Installer signature is not valid/.test(artifactVerifier)
    && /approved Auxora signer list/.test(artifactVerifier)
    && /Published app executable signature is not valid/.test(artifactVerifier),
  "release artifact verification must bind version, hash, installer signature, and app signature"
);

assert(
  /Install npm dependencies[\s\S]+npm ci/.test(releaseWorkflow)
    && /Build immutable Windows candidate/.test(releaseWorkflow)
    && /Publish receipt-bound Windows beta/.test(releaseWorkflow)
    && !/npm --prefix desktop\/electron ci|macos-latest/.test(releaseWorkflow),
  "beta release workflow must use lockfile-backed npm installs and remain Windows-only"
);

assert(
  packageJson.scripts.check.includes("test:iexpress-packaging")
    && packageJson.scripts.check.includes("test:webview2-runtime")
    && packageJson.scripts.check.includes("check:installer-safety")
    && packageJson.scripts["test:iexpress-packaging"]?.includes("test-iexpress-packaging.ps1")
    && packageJson.scripts["test:webview2-runtime"]?.includes("test-webview2-runtime-probe.ps1")
    && packageJson.scripts["check:installer-safety"] === "node scripts/check-installer-safety.mjs",
  "npm run check must include installer safety validation"
);

console.log("checked installer transaction, autostart, cleanup, and release safety");
