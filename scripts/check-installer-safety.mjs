import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const buildInstaller = readWorkspaceFile("app/build-installer.ps1");
const installHost = readWorkspaceFile("app/installer/Install-XenonEdgeHost.ps1");
const autoStartInstall = readWorkspaceFile("app/install.ps1");
const removeHost = readWorkspaceFile("app/installer/Remove-XenonEdgeHost.ps1");
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
    && /Remove-Item -LiteralPath \$outputPath/.test(buildInstaller),
  "installer build must check IExpress exit code, constrain output deletion, and write a SHA256 sidecar"
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
    && /Uninstaller exited with code/.test(smokeTest),
  "install smoke test must validate startup integration and must not delete local data outside the uninstall flow"
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
