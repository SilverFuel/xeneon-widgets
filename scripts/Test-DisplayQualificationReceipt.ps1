param(
  [Parameter(Mandatory = $true)][string]$ReceiptPath,
  [Parameter(Mandatory = $true)][string]$ReleaseAssetsPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\Json.ps1")

function Assert-True($condition, [string]$message) {
  if (-not $condition) { throw $message }
}

function Assert-PSCustomObject($value, [string]$path) {
  Assert-True ($value -is [System.Management.Automation.PSCustomObject]) "$path must be a JSON object."
}

function Assert-ExactObjectShape($value, [string]$path, [string[]]$expectedProperties) {
  Assert-PSCustomObject $value $path
  $actualProperties = @($value.PSObject.Properties.Name)
  Assert-True ($actualProperties.Count -eq $expectedProperties.Count) "$path must contain exactly: $($expectedProperties -join ', ')."
  foreach ($property in $expectedProperties) {
    Assert-True ($actualProperties -ccontains $property) "$path is missing exact property '$property'."
  }
  foreach ($property in $actualProperties) {
    Assert-True ($expectedProperties -ccontains $property) "$path contains unexpected property '$property'."
  }
}

function Assert-ExactNonEmptyString($value, [string]$path) {
  Assert-True ($value -is [string]) "$path must be a JSON string."
  Assert-True (-not [string]::IsNullOrWhiteSpace($value)) "$path must not be empty."
}

function Assert-ExactTrue($value, [string]$path) {
  Assert-True ($value -is [bool] -and $value -eq $true) "$path must be the JSON Boolean true."
}

function Assert-JsonInteger($value, [string]$path) {
  $integerTypes = @(
    [sbyte], [byte], [int16], [uint16], [int32], [uint32], [int64], [uint64]
  )
  Assert-True ($null -ne $value -and $integerTypes -contains $value.GetType()) "$path must be a JSON integer."
}

function Assert-NoSensitiveFields($value, [string]$path = "receipt") {
  if ($null -eq $value) { return }
  if ($value -is [System.Management.Automation.PSCustomObject]) {
    $blockedNames = @("password", "username", "accessToken", "authorization", "cookie", "secret", "serialNumber", "edid", "deviceInstanceId")
    foreach ($property in $value.PSObject.Properties) {
      if ($blockedNames -contains $property.Name) {
        throw "Display qualification receipt must not contain sensitive field '$($property.Name)' at $path."
      }
      Assert-NoSensitiveFields $property.Value "$path.$($property.Name)"
    }
    return
  }
  if ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) {
    $index = 0
    foreach ($item in $value) {
      Assert-NoSensitiveFields $item "$path[$index]"
      $index += 1
    }
  }
}

$root = (Resolve-Path -LiteralPath $ReleaseAssetsPath -ErrorAction Stop).Path
$manifest = ConvertFrom-JsonPreservingLexicalTypes (Get-Content -LiteralPath (Join-Path $root "release-manifest.json") -Raw)
$receipt = ConvertFrom-JsonPreservingLexicalTypes (Get-Content -LiteralPath $ReceiptPath -Raw)

Assert-PSCustomObject $manifest "Release manifest"
Assert-PSCustomObject $manifest.installer "Release manifest installer"
Assert-ExactObjectShape $receipt "Display qualification receipt" @(
  "schemaVersion", "tag", "version", "commitSha", "installerFileName", "installerSha256",
  "app", "environment", "checks", "evidence", "operator", "completedAt"
)
Assert-ExactObjectShape $receipt.app "Display qualification receipt app" @("name", "version", "assetRevision")
Assert-ExactObjectShape $receipt.environment "Display qualification receipt environment" @(
  "physicalWindowsMachine", "physicalCompanionDisplay", "multipleActiveDisplays", "physicalTouch",
  "windowsVersion", "companionModel", "companionWidth", "companionHeight", "testedScalingPercent"
)
Assert-ExactObjectShape $receipt.evidence "Display qualification receipt evidence" @("screenshotReferences")
Assert-PSCustomObject $receipt.checks "Display qualification receipt checks"

Assert-NoSensitiveFields $receipt
Assert-JsonInteger $receipt.schemaVersion "Display qualification receipt schemaVersion"
Assert-True ($receipt.schemaVersion -eq 1) "Display qualification receipt schemaVersion must be the JSON integer 1."

foreach ($binding in @("tag", "version", "commitSha")) {
  Assert-ExactNonEmptyString $manifest.$binding "Release manifest $binding"
}
Assert-ExactNonEmptyString $manifest.installer.fileName "Release manifest installer fileName"
Assert-ExactNonEmptyString $manifest.installer.sha256 "Release manifest installer sha256"
foreach ($binding in @("tag", "version", "commitSha")) {
  Assert-ExactNonEmptyString $receipt.$binding "Display qualification receipt $binding"
  Assert-True ($receipt.$binding -ceq $manifest.$binding) "Display qualification receipt $binding does not match the release manifest."
}
Assert-ExactNonEmptyString $receipt.installerFileName "Display qualification receipt installerFileName"
Assert-ExactNonEmptyString $receipt.installerSha256 "Display qualification receipt installerSha256"
Assert-True ($receipt.installerFileName -ceq $manifest.installer.fileName) "Display qualification receipt does not bind the exact installer filename."
Assert-True ($receipt.installerSha256.Equals($manifest.installer.sha256, [StringComparison]::OrdinalIgnoreCase)) "Display qualification receipt does not bind the exact installer SHA-256."
Assert-ExactNonEmptyString $receipt.app.name "Display qualification receipt app name"
Assert-ExactNonEmptyString $receipt.app.version "Display qualification receipt app version"
Assert-ExactNonEmptyString $receipt.app.assetRevision "Display qualification receipt app assetRevision"
Assert-True ($receipt.app.name -ceq "Auxora") "Display qualification receipt app name must be Auxora."
Assert-True ($receipt.app.version -ceq $manifest.version) "Display qualification receipt app version does not match the manifest."
Assert-True ($receipt.app.assetRevision -cmatch '^20\d{6}-\d{2}$') "Display qualification receipt must record the installed dashboard asset revision."

foreach ($field in @("physicalWindowsMachine", "physicalCompanionDisplay", "multipleActiveDisplays", "physicalTouch")) {
  Assert-ExactTrue $receipt.environment.$field "Display qualification environment $field"
}
Assert-ExactNonEmptyString $receipt.environment.windowsVersion "Display qualification environment windowsVersion"
Assert-ExactNonEmptyString $receipt.environment.companionModel "Display qualification environment companionModel"
foreach ($dimension in @("companionWidth", "companionHeight")) {
  $dimensionValue = $receipt.environment.$dimension
  Assert-JsonInteger $dimensionValue "Display qualification environment $dimension"
  Assert-True ($dimensionValue -gt 0) "Display qualification environment $dimension must be a positive JSON integer."
}

$requiredScales = @(100, 125, 150, 175, 200)
Assert-True ($receipt.environment.testedScalingPercent -is [System.Array]) "Display qualification environment testedScalingPercent must be a JSON array."
$scales = @($receipt.environment.testedScalingPercent)
Assert-True ($scales.Count -eq $requiredScales.Count) "Display qualification scaling must contain exactly 100, 125, 150, 175, and 200 percent."
$seenScales = [System.Collections.Generic.HashSet[long]]::new()
foreach ($scale in $scales) {
  Assert-JsonInteger $scale "Display qualification scaling value"
  $exactScale = [long]$scale
  Assert-True ($requiredScales -contains $exactScale) "Display qualification scaling contains unsupported value $exactScale."
  Assert-True ($seenScales.Add($exactScale)) "Display qualification scaling must not contain duplicate value $exactScale."
}
foreach ($requiredScale in $requiredScales) {
  Assert-True ($seenScales.Contains([long]$requiredScale)) "Display qualification must exercise Windows scaling at $requiredScale percent."
}

$requiredChecks = @(
  "startupCompanionOnly",
  "noPrimaryIntersection",
  "trayOnlyWithoutCompanion",
  "hotPlugRecovery",
  "primaryRoleSwitchFailClosed",
  "savedPreferenceAfterReorder",
  "borderless",
  "taskbarHidden",
  "touchTap",
  "touchLongPress",
  "touchScroll",
  "keyboardFocus",
  "screenReaderNames",
  "readableAtAllScales",
  "dialogsContained",
  "reducedMotion",
  "noRefreshFlicker"
)
$actualChecks = @($receipt.checks.PSObject.Properties.Name)
Assert-True ($actualChecks.Count -eq $requiredChecks.Count) "Display qualification checks must contain the exact required check set with no extras."
foreach ($check in $requiredChecks) {
  Assert-True ($actualChecks -ccontains $check) "Display qualification checks are missing exact check '$check'."
  Assert-ExactTrue $receipt.checks.PSObject.Properties[$check].Value "Display qualification check '$check'"
}

Assert-True ($receipt.evidence.screenshotReferences -is [System.Array]) "Display qualification screenshotReferences must be a JSON array."
$references = @($receipt.evidence.screenshotReferences)
Assert-True ($references.Count -gt 0) "Display qualification must record at least one screenshot reference."
foreach ($reference in $references) {
  Assert-ExactNonEmptyString $reference "Display qualification screenshot reference"
  Assert-True ($reference -cmatch '^[A-Za-z0-9._-]{1,100}$') "Screenshot references must be privacy-safe identifiers, not local paths or URLs."
}

Assert-ExactNonEmptyString $receipt.completedAt "Display qualification completedAt"
Assert-True ($receipt.completedAt -cmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,7})?(?:Z|\+00:00)\z') "Display qualification completedAt must be an ISO-8601 UTC timestamp ending in Z or +00:00."
$completedAt = [DateTimeOffset]::MinValue
Assert-True ([DateTimeOffset]::TryParse($receipt.completedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$completedAt)) "Display qualification completedAt must be a valid ISO-8601 UTC timestamp."
Assert-True ($completedAt.Offset -eq [TimeSpan]::Zero) "Display qualification completedAt must use UTC."
$completedAt = $completedAt.ToUniversalTime()
$now = [DateTimeOffset]::UtcNow
Assert-True ($completedAt -le $now.AddMinutes(5)) "Display qualification completedAt must not be more than 5 minutes in the future."
Assert-True ($completedAt -ge $now.AddDays(-30)) "Display qualification completedAt must be within the last 30 days."
Assert-ExactNonEmptyString $receipt.operator "Display qualification operator"

Write-Host "Display qualification receipt verified for exact candidate $($manifest.installer.fileName)."
