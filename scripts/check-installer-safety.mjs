import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const buildInstaller = readWorkspaceFile("app/build-installer.ps1");
const installHost = readWorkspaceFile("app/installer/Install-XenonEdgeHost.ps1");
const autoStartInstall = readWorkspaceFile("app/install.ps1");
const removeHost = readWorkspaceFile("app/installer/Remove-XenonEdgeHost.ps1");
const safeModeLaunch = readWorkspaceFile("app/Launch-XenonSafeMode.ps1");
const repairInstall = readWorkspaceFile("app/repair.ps1");
const program = readWorkspaceFile("app/Program.cs");
const mainWindow = readWorkspaceFile("app/MainWindow.xaml.cs");
const bridgeManager = readWorkspaceFile("app/BridgeManager.cs");
const smokeTest = readWorkspaceFile("scripts/test-windows-install.ps1");
const releaseWorkflow = readWorkspaceFile(".github/workflows/release.yml");
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
    && /IExpress failed with exit code/.test(buildInstaller)
    && /Get-Sha256Hash \$outputPath/.test(buildInstaller)
    && /OutputPath must end with \.exe/.test(buildInstaller)
    && /Remove-Item -LiteralPath \$outputPath/.test(buildInstaller)
    && /Launch-XenonSafeMode\.ps1/.test(buildInstaller)
    && /repair\.ps1/.test(buildInstaller),
  "installer build must check IExpress exit code, constrain output deletion, package rescue scripts, and write a SHA256 sidecar"
);

assert(
  /\$installationCompleted = \$false/.test(installHost)
    && /Stop-RunningHost/.test(installHost)
    && /Get-Process -Id \$processId/.test(installHost)
    && /The running XenonEdgeHost process did not exit/.test(installHost)
    && /Restored previous install after setup failed/.test(installHost)
    && /Backup remains at \$backupInstallRoot/.test(installHost)
    && /Removed partial install after setup failed/.test(installHost)
    && /if \(\$installationCompleted\)[\s\S]+Backup install folder/.test(installHost),
  "installer must stop the running app and preserve or restore the previous install when an upgrade fails"
);

assert(
  /if \(-not \$NoAutoStart\)/.test(installHost)
    && /else\s*\{[\s\S]+Disabling auto-start[\s\S]+uninstall\.ps1/.test(installHost),
  "installer -NoAutoStart must remove any existing Xenon autostart integration"
);

assert(
  /Launch-XenonSafeMode\.ps1/.test(installHost)
    && /repair\.ps1/.test(installHost)
    && /Launch Xenon Safe Mode\.lnk/.test(installHost)
    && /Repair XENEON Edge Host\.lnk/.test(installHost),
  "installer must install Safe Mode and Repair shortcuts"
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
    && /Launch Xenon Safe Mode\.lnk/.test(repairInstall)
    && /Repair XENEON Edge Host\.lnk/.test(repairInstall)
    && /& \$installScript -Quiet/.test(repairInstall)
    && !/ResetLocalData/.test(repairInstall)
    && !/Remove-Item[\s\S]+XenonEdgeHost/.test(repairInstall),
  "repair script must restore shortcuts, uninstall registration, startup/runtime checks, and leave local data alone"
);

assert(
  /LaunchOptions = AppLaunchOptions\.Parse\(args\)/.test(program)
    && /Program\.LaunchOptions\.SafeMode/.test(mainWindow)
    && /ignoreSavedPreference:\s*safeMode/.test(mainWindow)
    && /preferPrimary:\s*safeMode/.test(mainWindow)
    && /saveSelection:\s*saveSelection && !safeMode/.test(mainWindow)
    && /ListDisplayCandidates\(bool ignoreSavedPreference = false\)/.test(bridgeManager)
    && /bool preferPrimary = false/.test(bridgeManager)
    && /FirstOrDefault\(display => display\.IsPrimary\)/.test(bridgeManager),
  "host Safe Mode must ignore saved display preference, avoid saving a new target, and choose the primary display"
);

assert(
  /Register-ScheduledTask[\s\S]+-Force/.test(autoStartInstall)
    && /Enable-ScheduledTask -TaskName \$taskName -TaskPath/.test(autoStartInstall)
    && /Installed or repaired scheduled task/.test(autoStartInstall),
  "autostart install must repair and enable an existing scheduled task"
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
    && /Assert-StartupInstalled/.test(smokeTest)
    && /Assert-StartupRemoved/.test(smokeTest)
    && /Launch-XenonSafeMode\.ps1/.test(smokeTest)
    && /repair\.ps1/.test(smokeTest)
    && /Uninstaller exited with code/.test(smokeTest),
  "install smoke test must validate startup, rescue shortcuts, and must not delete local data outside the uninstall flow"
);

assert(
  /Install npm dependencies[\s\S]+npm ci/.test(releaseWorkflow)
    && /Install Electron host dependencies[\s\S]+npm --prefix desktop\/electron ci/.test(releaseWorkflow),
  "release workflow must use lockfile-backed npm ci installs"
);

assert(
  packageJson.scripts.check.includes("check:installer-safety") && packageJson.scripts["check:installer-safety"] === "node scripts/check-installer-safety.mjs",
  "npm run check must include installer safety validation"
);

console.log("checked installer transaction, autostart, cleanup, and release safety");
