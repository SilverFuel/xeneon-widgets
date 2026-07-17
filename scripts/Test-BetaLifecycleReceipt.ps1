param(
  [Parameter(Mandatory = $true)][string]$ReceiptPath,
  [Parameter(Mandatory = $true)][string]$ReleaseAssetsPath
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $ReleaseAssetsPath -ErrorAction Stop).Path
$manifest = Get-Content -LiteralPath (Join-Path $root "release-manifest.json") -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json

if ($receipt.schemaVersion -ne 1) {
  throw "Lifecycle receipt schemaVersion must be 1."
}
foreach ($binding in @("tag", "version", "commitSha")) {
  if ([string]$receipt.$binding -cne [string]$manifest.$binding) {
    throw "Lifecycle receipt $binding does not match the release manifest."
  }
}
if (([string]$receipt.installerFileName -cne [string]$manifest.installer.fileName) -or
    (-not ([string]$receipt.installerSha256).Equals([string]$manifest.installer.sha256, [StringComparison]::OrdinalIgnoreCase))) {
  throw "Lifecycle receipt does not bind the exact installer filename and SHA-256."
}
if ($receipt.environment.disposableWindowsVm -ne $true) {
  throw "Lifecycle receipt must come from a disposable Windows VM."
}
if (([string]::IsNullOrWhiteSpace([string]$receipt.environment.windowsVersion)) -or
    ([string]::IsNullOrWhiteSpace([string]$receipt.operator)) -or
    ([string]::IsNullOrWhiteSpace([string]$receipt.completedAt))) {
  throw "Lifecycle receipt must record Windows version, operator, and completion time."
}

$requiredChecks = @(
  "install",
  "launch",
  "health",
  "processRestart",
  "autoStartAfterReboot",
  "upgradeFromPreviousBeta",
  "repair",
  "normalUninstall",
  "removeAllData"
)
foreach ($check in $requiredChecks) {
  if ($receipt.checks.$check -ne $true) {
    throw "Lifecycle receipt check '$check' must be true before publication."
  }
}

Write-Host "Lifecycle receipt verified for exact candidate $($manifest.installer.fileName)."
