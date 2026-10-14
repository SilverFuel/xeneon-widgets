param(
  [string]$ReleaseAssetsPath = "",
  [string]$LifecycleReceiptPath = "",
  [string]$FrigateQualificationReceiptPath = "",
  [string]$DisplayQualificationReceiptPath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

if ([string]::IsNullOrWhiteSpace($ReleaseAssetsPath) -or
    [string]::IsNullOrWhiteSpace($LifecycleReceiptPath) -or
    [string]::IsNullOrWhiteSpace($FrigateQualificationReceiptPath) -or
    [string]::IsNullOrWhiteSpace($DisplayQualificationReceiptPath)) {
  throw "Free beta publication preparation requires -ReleaseAssetsPath, -LifecycleReceiptPath, -FrigateQualificationReceiptPath, and -DisplayQualificationReceiptPath for the exact candidate. Build an immutable tag candidate with the Windows Beta Candidate workflow, complete all qualification receipts, then rerun this command."
}

$resolvedAssets = (Resolve-Path -LiteralPath $ReleaseAssetsPath -ErrorAction Stop).Path
$resolvedLifecycleReceipt = (Resolve-Path -LiteralPath $LifecycleReceiptPath -ErrorAction Stop).Path
$resolvedFrigateReceipt = (Resolve-Path -LiteralPath $FrigateQualificationReceiptPath -ErrorAction Stop).Path
$resolvedDisplayReceipt = (Resolve-Path -LiteralPath $DisplayQualificationReceiptPath -ErrorAction Stop).Path
$manifestPath = Join-Path $resolvedAssets "release-manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$installerPath = Join-Path $resolvedAssets ([string]$manifest.installer.fileName)
$appVersion = [string]$manifest.version

Push-Location $repoRoot
try {
  Write-Step "Verifying the exact free beta candidate and all physical receipts"
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-release-gauntlet.ps1 `
    -InstallerPath $installerPath `
    -AllowGitHubSupportPath `
    -AllowUnsignedBeta `
    -ReleaseAssetsPath $resolvedAssets `
    -LifecycleReceiptPath $resolvedLifecycleReceipt `
    -FrigateQualificationReceiptPath $resolvedFrigateReceipt `
    -DisplayQualificationReceiptPath $resolvedDisplayReceipt
  if ($LASTEXITCODE -ne 0) {
    throw "The receipt-bound free beta gauntlet failed with exit code $LASTEXITCODE."
  }

  Write-Step "Verified free beta publication list"
  Write-Host "GitHub Release title:"
  Write-Host "  Auxora $appVersion Free Public Beta"
  Write-Host ""
  Write-Host "Mark it as:"
  Write-Host "  Pre-release"
  Write-Host ""
  Write-Host "Upload only these manifest-bound files:"
  Write-Host "  $(Join-Path $resolvedAssets ([string]$manifest.installer.fileName))"
  Write-Host "  $(Join-Path $resolvedAssets ([string]$manifest.installer.sha256FileName))"
  Write-Host "  $(Join-Path $resolvedAssets ([string]$manifest.installNotesFileName))"
  Write-Host "  $(Join-Path $resolvedAssets ([string]$manifest.releaseNotesFileName))"
  Write-Host "  $manifestPath"
  Write-Host ""
  Write-Host "The qualification receipts are gates, not public release assets."
} finally {
  Pop-Location
}
