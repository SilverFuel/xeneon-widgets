param(
  [Parameter(Mandatory = $true)][string]$ReceiptPath,
  [Parameter(Mandatory = $true)][string]$ReleaseAssetsPath
)

$ErrorActionPreference = "Stop"

function Assert-True($condition, [string]$message) {
  if (-not $condition) { throw $message }
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
$manifest = Get-Content -LiteralPath (Join-Path $root "release-manifest.json") -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json

Assert-NoSensitiveFields $receipt
Assert-True ($receipt.schemaVersion -eq 1) "Display qualification receipt schemaVersion must be 1."
foreach ($binding in @("tag", "version", "commitSha")) {
  Assert-True ([string]$receipt.$binding -ceq [string]$manifest.$binding) "Display qualification receipt $binding does not match the release manifest."
}
Assert-True ([string]$receipt.installerFileName -ceq [string]$manifest.installer.fileName) "Display qualification receipt does not bind the exact installer filename."
Assert-True (([string]$receipt.installerSha256).Equals([string]$manifest.installer.sha256, [StringComparison]::OrdinalIgnoreCase)) "Display qualification receipt does not bind the exact installer SHA-256."
Assert-True ([string]$receipt.app.name -ceq "Auxora") "Display qualification receipt app name must be Auxora."
Assert-True ([string]$receipt.app.version -ceq [string]$manifest.version) "Display qualification receipt app version does not match the manifest."
Assert-True ([string]$receipt.app.assetRevision -match '^20\d{6}-\d{2}$') "Display qualification receipt must record the installed dashboard asset revision."

Assert-True ($receipt.environment.physicalWindowsMachine -eq $true) "Display qualification must run on a physical Windows machine."
Assert-True ($receipt.environment.physicalCompanionDisplay -eq $true) "Display qualification must use a physical companion display."
Assert-True ($receipt.environment.multipleActiveDisplays -eq $true) "Display qualification requires a primary display and an active companion display."
Assert-True ($receipt.environment.physicalTouch -eq $true) "Display qualification must exercise physical touch hardware."
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$receipt.environment.windowsVersion)) "Display qualification must record the Windows version."
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$receipt.environment.companionModel)) "Display qualification must record the companion display model without a serial number."
Assert-True ([int]$receipt.environment.companionWidth -gt 0 -and [int]$receipt.environment.companionHeight -gt 0) "Display qualification must record a valid companion resolution."

$scales = @($receipt.environment.testedScalingPercent | ForEach-Object { [int]$_ })
foreach ($requiredScale in @(100, 125, 150, 175, 200)) {
  Assert-True ($requiredScale -in $scales) "Display qualification must exercise Windows scaling at $requiredScale percent."
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
foreach ($check in $requiredChecks) {
  Assert-True ($receipt.checks.$check -eq $true) "Display qualification check '$check' must be true before release."
}

$references = @($receipt.evidence.screenshotReferences)
Assert-True ($references.Count -gt 0) "Display qualification must record at least one screenshot reference."
foreach ($reference in $references) {
  $value = [string]$reference
  Assert-True ($value -match '^[A-Za-z0-9._-]{1,100}$') "Screenshot references must be privacy-safe identifiers, not local paths or URLs."
}

$completedAt = [DateTimeOffset]::MinValue
Assert-True ([DateTimeOffset]::TryParse([string]$receipt.completedAt, [ref]$completedAt)) "Display qualification must record a valid completedAt timestamp."
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$receipt.operator)) "Display qualification must record the operator."

Write-Host "Display qualification receipt verified for exact candidate $($manifest.installer.fileName)."
