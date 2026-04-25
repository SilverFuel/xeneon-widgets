param(
  [switch]$SkipInstaller,
  [switch]$SkipChecks,
  [switch]$SkipReadiness,
  [string]$SignPath = "",
  [string]$CertificatePath = "",
  [string]$Thumbprint = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

Push-Location $repoRoot
try {
  if (-not $SkipChecks) {
    Write-Step "Checking JavaScript"
    npm run check:js

    Write-Step "Building Windows app"
    dotnet build app\XenonEdgeHost.sln --configuration Release
  }

  if (-not $SkipInstaller) {
    Write-Step "Building Windows installer"
    powershell -NoProfile -ExecutionPolicy Bypass -File app\build-installer.ps1
  }

  if ($SignPath) {
    Write-Step "Signing release artifact"
    $signArgs = @("-Path", $SignPath)
    if ($CertificatePath) {
      $signArgs += @("-CertificatePath", $CertificatePath)
    }
    if ($Thumbprint) {
      $signArgs += @("-Thumbprint", $Thumbprint)
    }
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sign-windows.ps1 @signArgs
  }

  if (-not $SkipReadiness) {
    Write-Step "Checking release readiness"
    $readinessArgs = @("-AllowGitHubSupportPath")
    $latestInstaller = $null
    if (Test-Path app\dist) {
      $latestInstaller = Get-ChildItem app\dist -Filter "*.exe" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    }
    if ($latestInstaller) {
      $readinessArgs += @("-InstallerPath", $latestInstaller.FullName)
    }
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\assert-release-ready.ps1 @readinessArgs
  }

  Write-Step "Release output"
  if (Test-Path app\dist) {
    Get-ChildItem app\dist -File | Sort-Object LastWriteTime -Descending | Select-Object Name, Length, LastWriteTime
  } else {
    Write-Host "No app\dist folder exists yet."
  }
} finally {
  Pop-Location
}
