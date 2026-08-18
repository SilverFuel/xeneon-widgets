param(
  [Parameter(Mandatory = $true)][string]$ReceiptPath,
  [Parameter(Mandatory = $true)][string]$ReleaseAssetsPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\Json.ps1")

function Get-ExactPropertyValue($owner, [string]$name, [string]$label) {
  if ($owner -isnot [System.Management.Automation.PSCustomObject]) {
    throw "$label parent must be a JSON object."
  }

  $properties = @($owner.PSObject.Properties | Where-Object { $_.Name -ceq $name })
  if ($properties.Count -ne 1) {
    throw "$label must use the exact JSON property name '$name'."
  }

  return $properties[0].Value
}

function Get-RequiredStringValue($owner, [string]$name, [string]$label) {
  $value = Get-ExactPropertyValue $owner $name $label
  if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value)) {
    throw "$label must be a non-empty JSON string."
  }

  return [string]$value
}

function Assert-ExactJsonTrue($value, [string]$message) {
  if ($value -isnot [bool] -or $value -ne $true) {
    throw $message
  }
}

function Assert-ExactSchemaVersion($value) {
  $isInteger = $value -is [int16] -or $value -is [int32] -or $value -is [int64]
  if (-not $isInteger -or [int64]$value -ne 3) {
    throw "Lifecycle receipt schemaVersion must be the JSON integer 3."
  }
}

$root = (Resolve-Path -LiteralPath $ReleaseAssetsPath -ErrorAction Stop).Path
$manifest = ConvertFrom-JsonPreservingLexicalTypes (Get-Content -LiteralPath (Join-Path $root "release-manifest.json") -Raw)
$receipt = ConvertFrom-JsonPreservingLexicalTypes (Get-Content -LiteralPath $ReceiptPath -Raw)

Assert-ExactSchemaVersion (Get-ExactPropertyValue $receipt "schemaVersion" "Lifecycle receipt schemaVersion")
foreach ($binding in @("tag", "version", "commitSha")) {
  $receiptBinding = Get-RequiredStringValue $receipt $binding "Lifecycle receipt $binding"
  if ($receiptBinding -cne [string]$manifest.$binding) {
    throw "Lifecycle receipt $binding does not match the release manifest."
  }
}
$installerFileName = Get-RequiredStringValue $receipt "installerFileName" "Lifecycle receipt installerFileName"
$installerSha256 = Get-RequiredStringValue $receipt "installerSha256" "Lifecycle receipt installerSha256"
if (($installerFileName -cne [string]$manifest.installer.fileName) -or
    (-not $installerSha256.Equals([string]$manifest.installer.sha256, [StringComparison]::OrdinalIgnoreCase))) {
  throw "Lifecycle receipt does not bind the exact installer filename and SHA-256."
}
if ($receipt.environment -isnot [System.Management.Automation.PSCustomObject]) {
  throw "Lifecycle receipt environment must be a JSON object."
}
Assert-ExactJsonTrue (Get-ExactPropertyValue $receipt.environment "disposableWindowsVm" "Lifecycle receipt disposableWindowsVm") "Lifecycle receipt must come from a disposable Windows VM using the JSON Boolean true."
$null = Get-RequiredStringValue $receipt.environment "windowsVersion" "Lifecycle receipt Windows version"
$null = Get-RequiredStringValue $receipt "operator" "Lifecycle receipt operator"
$completedAtText = Get-RequiredStringValue $receipt "completedAt" "Lifecycle receipt completion time"

if ($completedAtText -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,7})?(?:Z|\+00:00)\z') {
  throw "Lifecycle receipt completedAt must be an ISO-8601 UTC timestamp."
}
$completedAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse(
    $completedAtText,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind,
    [ref]$completedAt)) {
  throw "Lifecycle receipt completedAt must be a valid ISO-8601 UTC timestamp."
}
$now = [DateTimeOffset]::UtcNow
$completedAtUtc = $completedAt.ToUniversalTime()
if ($completedAtUtc -gt $now.AddMinutes(5)) {
  throw "Lifecycle receipt completedAt cannot be more than five minutes in the future."
}
if ($completedAtUtc -lt $now.AddDays(-30)) {
  throw "Lifecycle receipt must be completed within 30 days of publication verification."
}

$requiredChecks = @(
  "install",
  "staysClosedAfterInstall",
  "launch",
  "health",
  "processRestart",
  "noAutoStartAfterReboot",
  "rollbackAfterInjectedFailure",
  "upgradeFromPreviousBeta",
  "repair",
  "normalUninstall",
  "removeAllData"
)
if ($receipt.checks -isnot [System.Management.Automation.PSCustomObject]) {
  throw "Lifecycle receipt checks must be a JSON object."
}
$actualChecks = @($receipt.checks.PSObject.Properties.Name)
$checkDifference = Compare-Object `
  -ReferenceObject @($requiredChecks | Sort-Object) `
  -DifferenceObject @($actualChecks | Sort-Object) `
  -CaseSensitive
if ($actualChecks.Count -ne $requiredChecks.Count -or $checkDifference) {
  throw "Lifecycle receipt checks must contain exactly the schema-3 check names and no legacy or unknown entries."
}
foreach ($check in $requiredChecks) {
  Assert-ExactJsonTrue (Get-ExactPropertyValue $receipt.checks $check "Lifecycle receipt check '$check'") "Lifecycle receipt check '$check' must be the JSON Boolean true before publication."
}

Write-Host "Lifecycle receipt verified for exact candidate $($manifest.installer.fileName)."
