param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

Push-Location $repoRoot
try {
  if (-not $SkipBuild) {
    Write-Step "Building the Windows free beta installer"
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-release.ps1 -SkipReadiness
  }

  $latestInstaller = Get-ChildItem app\dist -Filter "*.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latestInstaller) {
    throw "No installer was found in app\dist. Run npm run release:windows first."
  }

  Write-Step "Checking free beta readiness"
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\assert-release-ready.ps1 -AllowGitHubSupportPath -InstallerPath $latestInstaller.FullName

  $hashPath = "$($latestInstaller.FullName).sha256"
  if (-not (Test-Path -LiteralPath $hashPath)) {
    throw "The installer SHA256 file is missing: $hashPath"
  }

  Write-Step "Free beta upload list"
  Write-Host "GitHub Release title:"
  Write-Host "  XENEON Edge Host 0.2.0 Free Public Beta"
  Write-Host ""
  Write-Host "Mark it as:"
  Write-Host "  Pre-release"
  Write-Host ""
  Write-Host "Upload these files:"
  Write-Host "  $($latestInstaller.FullName)"
  Write-Host "  $hashPath"
  Write-Host ""
  Write-Host "Release notes:"
  Write-Host "  $(Join-Path $repoRoot 'docs\release\FREE-BETA-RELEASE-NOTES.md')"
} finally {
  Pop-Location
}
