param(
  [string]$InstallerPath = "",
  [switch]$RunInstallSmoke,
  [switch]$RunUninstall,
  [switch]$RemoveLocalData,
  [switch]$RequireSignedInstaller,
  [switch]$AllowUnsignedBeta,
  [switch]$AllowGitHubSupportPath
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

function Invoke-CheckedCommand($command, $arguments, $failureMessage) {
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$failureMessage Exit code: $LASTEXITCODE"
  }
}

function Resolve-LatestInstaller {
  if (-not [string]::IsNullOrWhiteSpace($InstallerPath)) {
    return (Resolve-Path -LiteralPath $InstallerPath).Path
  }

  $latestInstaller = Get-ChildItem (Join-Path $repoRoot "app\dist") -Filter "*.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latestInstaller) {
    throw "No installer found in app\dist. Run npm run installer first or pass -InstallerPath."
  }

  return $latestInstaller.FullName
}

Push-Location $repoRoot
try {
  $resolvedInstaller = Resolve-LatestInstaller
  $hashPath = "$resolvedInstaller.sha256"

  Write-Step "Auditing dependencies"
  Invoke-CheckedCommand "npm" @("run", "audit:deps") "Dependency audit failed."

  Write-Step "Running repository checks"
  Invoke-CheckedCommand "npm" @("run", "check") "Repository checks failed."

  Write-Step "Checking release artifact"
  if (-not (Test-Path -LiteralPath $resolvedInstaller)) {
    throw "Installer does not exist: $resolvedInstaller"
  }
  if (-not (Test-Path -LiteralPath $hashPath)) {
    throw "Installer SHA256 file is missing: $hashPath"
  }

  try {
    $signature = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller -ErrorAction Stop
    if ($signature.Status -eq "Valid") {
      Write-Host "OK: Installer signature is valid"
    } elseif ($RequireSignedInstaller) {
      throw "Installer signature is required but is $($signature.Status)."
    } elseif ($AllowUnsignedBeta) {
      Write-Warning "Installer is unsigned ($($signature.Status)); allowed for free beta only."
    } else {
      throw "Installer is not signed ($($signature.Status)). Pass -AllowUnsignedBeta for the free beta path or sign the artifact."
    }
  } catch {
    if ($RequireSignedInstaller) {
      throw "Installer signature is required but could not be checked: $($_.Exception.Message)"
    } elseif ($AllowUnsignedBeta) {
      Write-Warning "Installer signature could not be checked; allowed for free beta only. $($_.Exception.Message)"
    } else {
      throw "Installer signature could not be checked. Pass -AllowUnsignedBeta for the free beta path or sign and verify the artifact. $($_.Exception.Message)"
    }
  }

  Write-Step "Running release readiness gate"
  $readyArgs = @("-InstallerPath", $resolvedInstaller)
  if ($AllowGitHubSupportPath) {
    $readyArgs += "-AllowGitHubSupportPath"
  }
  if ($RequireSignedInstaller) {
    $readyArgs += "-RequireSignedInstaller"
  }
  Invoke-CheckedCommand "powershell" (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\assert-release-ready.ps1") + $readyArgs) "Release readiness gate failed."

  if ($RunInstallSmoke) {
    Write-Step "Running Windows install smoke test"
    $smokeArgs = @("-InstallerPath", $resolvedInstaller, "-RunInstall", "-QuietInstall")
    if ($RunUninstall) {
      $smokeArgs += "-RunUninstall"
    }
    if ($RemoveLocalData) {
      $smokeArgs += "-RemoveLocalData"
    }
    Invoke-CheckedCommand "powershell" (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\test-windows-install.ps1") + $smokeArgs) "Windows install smoke test failed."
  } else {
    Write-Warning "Destructive clean install/uninstall smoke was not run. Use a disposable Windows VM or fresh profile with -RunInstallSmoke -RunUninstall."
  }

  Write-Step "Release gauntlet result"
  Write-Host "Installer: $resolvedInstaller"
  Write-Host "SHA256:    $hashPath"
  Write-Host "Gauntlet checks finished." -ForegroundColor Green
} finally {
  Pop-Location
}
