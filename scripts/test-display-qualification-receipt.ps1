$ErrorActionPreference = "Stop"
$root = Join-Path ([System.IO.Path]::GetTempPath()) "auxora-display-receipt-$([Guid]::NewGuid().ToString('N'))"
$assets = Join-Path $root "assets"
$receiptPath = Join-Path $root "display-qualification-receipt.json"
$verifier = Join-Path $PSScriptRoot "Test-DisplayQualificationReceipt.ps1"

function Write-Json($value, [string]$path) { $value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding utf8 }
function Copy-Receipt($value) { return $value | ConvertTo-Json -Depth 12 | ConvertFrom-Json }
function Assert-Rejected($value, [string]$label) {
  Write-Json $value $receiptPath
  Assert-RejectedJson (Get-Content -LiteralPath $receiptPath -Raw) $label
}
function Assert-RejectedJson([string]$json, [string]$label) {
  Set-Content -LiteralPath $receiptPath -Value $json -Encoding utf8
  try {
    & $verifier -ReceiptPath $receiptPath -ReleaseAssetsPath $assets | Out-Null
    throw "$label fixture was accepted unexpectedly."
  } catch {
    if ($_.Exception.Message -eq "$label fixture was accepted unexpectedly.") { throw }
    Write-Host "OK: $label rejected"
  }
}

try {
  New-Item -ItemType Directory -Path $assets -Force | Out-Null
  $manifest = [ordered]@{
    schemaVersion = 1; tag = "v0.3.0-beta.1"; version = "0.3.0-beta.1"; commitSha = "a" * 40
    installer = [ordered]@{ fileName = "Auxora-Setup-0.3.0-beta.1-fixture.exe"; sha256 = "b" * 64 }
  }
  Write-Json $manifest (Join-Path $assets "release-manifest.json")
  $valid = [ordered]@{
    schemaVersion = 1; tag = $manifest.tag; version = $manifest.version; commitSha = $manifest.commitSha
    installerFileName = $manifest.installer.fileName; installerSha256 = $manifest.installer.sha256
    app = [ordered]@{ name = "Auxora"; version = $manifest.version; assetRevision = "20260719-15" }
    environment = [ordered]@{
      physicalWindowsMachine = $true; physicalCompanionDisplay = $true; multipleActiveDisplays = $true; physicalTouch = $true
      windowsVersion = "Windows 11 fixture"; companionModel = "XENEON Edge fixture"; companionWidth = 2560; companionHeight = 720
      testedScalingPercent = @(100, 125, 150, 175, 200)
    }
    checks = [ordered]@{
      startupCompanionOnly=$true; noPrimaryIntersection=$true; trayOnlyWithoutCompanion=$true; hotPlugRecovery=$true
      primaryRoleSwitchFailClosed=$true; savedPreferenceAfterReorder=$true; borderless=$true; taskbarHidden=$true
      touchTap=$true; touchLongPress=$true; touchScroll=$true; keyboardFocus=$true; screenReaderNames=$true
      readableAtAllScales=$true; dialogsContained=$true; reducedMotion=$true; noRefreshFlicker=$true
    }
    evidence = [ordered]@{ screenshotReferences = @("startup-100pct", "hotplug-recovery", "touch-200pct") }
    operator = "fixture-operator"; completedAt = [DateTime]::UtcNow.ToString("O", [Globalization.CultureInfo]::InvariantCulture)
  }
  Write-Json $valid $receiptPath
  & $verifier -ReceiptPath $receiptPath -ReleaseAssetsPath $assets | Out-Null
  Write-Host "OK: valid physical display receipt"

  $virtual = Copy-Receipt $valid; $virtual.environment.physicalCompanionDisplay = $false; Assert-Rejected $virtual "non-physical display"
  $primary = Copy-Receipt $valid; $primary.checks.noPrimaryIntersection = $false; Assert-Rejected $primary "primary-display intersection"
  $taskbar = Copy-Receipt $valid; $taskbar.checks.taskbarHidden = $false; Assert-Rejected $taskbar "visible taskbar"
  $scaling = Copy-Receipt $valid; $scaling.environment.testedScalingPercent = @(100,125,150); Assert-Rejected $scaling "incomplete scaling matrix"
  $touch = Copy-Receipt $valid; $touch.checks.touchLongPress = $false; Assert-Rejected $touch "failed touch interaction"
  $privatePath = Copy-Receipt $valid; $privatePath.evidence.screenshotReferences = @("C:\Users\tester\capture.png"); Assert-Rejected $privatePath "private screenshot path"

  $schemaString = Copy-Receipt $valid; $schemaString.schemaVersion = "1"; Assert-Rejected $schemaString "string schema version"
  $schemaBoolean = Copy-Receipt $valid; $schemaBoolean.schemaVersion = $true; Assert-Rejected $schemaBoolean "Boolean schema version"
  $schemaFractionJson = $valid | ConvertTo-Json -Depth 12
  $schemaFractionJson = [regex]::Replace($schemaFractionJson, '"schemaVersion"\s*:\s*1(?=\s*[,}])', '"schemaVersion": 1.0', 1)
  Assert-RejectedJson $schemaFractionJson "fractional-form schema version"

  $extraRoot = Copy-Receipt $valid; $extraRoot | Add-Member -NotePropertyName notes -NotePropertyValue "unexpected"; Assert-Rejected $extraRoot "extra root property"
  $extraEnvironment = Copy-Receipt $valid; $extraEnvironment.environment | Add-Member -NotePropertyName fixture -NotePropertyValue $false; Assert-Rejected $extraEnvironment "extra environment property"
  $extraEvidence = Copy-Receipt $valid; $extraEvidence.evidence | Add-Member -NotePropertyName localPath -NotePropertyValue "none"; Assert-Rejected $extraEvidence "extra evidence property"

  $appShape = Copy-Receipt $valid; $appShape.app = "Auxora"; Assert-Rejected $appShape "non-object app"
  $environmentShape = Copy-Receipt $valid; $environmentShape.environment = @("physical"); Assert-Rejected $environmentShape "non-object environment"
  $checksShape = Copy-Receipt $valid; $checksShape.checks = @($true); Assert-Rejected $checksShape "non-object checks"
  $evidenceShape = Copy-Receipt $valid; $evidenceShape.evidence = $true; Assert-Rejected $evidenceShape "non-object evidence"

  $blankOperator = Copy-Receipt $valid; $blankOperator.operator = " "; Assert-Rejected $blankOperator "blank operator"
  $numericWindowsVersion = Copy-Receipt $valid; $numericWindowsVersion.environment.windowsVersion = 11; Assert-Rejected $numericWindowsVersion "numeric Windows version"
  $numericCompanionModel = Copy-Receipt $valid; $numericCompanionModel.environment.companionModel = 123; Assert-Rejected $numericCompanionModel "numeric companion model"

  $stringEnvironmentBoolean = Copy-Receipt $valid; $stringEnvironmentBoolean.environment.physicalTouch = "true"; Assert-Rejected $stringEnvironmentBoolean "string environment Boolean"
  $numericEnvironmentBoolean = Copy-Receipt $valid; $numericEnvironmentBoolean.environment.multipleActiveDisplays = 1; Assert-Rejected $numericEnvironmentBoolean "numeric environment Boolean"
  $stringCheckBoolean = Copy-Receipt $valid; $stringCheckBoolean.checks.touchTap = "true"; Assert-Rejected $stringCheckBoolean "string check Boolean"
  $numericCheckBoolean = Copy-Receipt $valid; $numericCheckBoolean.checks.touchTap = 1; Assert-Rejected $numericCheckBoolean "numeric check Boolean"

  $missingCheck = Copy-Receipt $valid; $missingCheck.checks.PSObject.Properties.Remove("touchTap"); Assert-Rejected $missingCheck "missing check"
  $extraCheck = Copy-Receipt $valid; $extraCheck.checks | Add-Member -NotePropertyName unexpectedCheck -NotePropertyValue $true; Assert-Rejected $extraCheck "extra check"
  $wrongCaseCheck = Copy-Receipt $valid; $wrongCaseCheck.checks.PSObject.Properties.Remove("touchTap"); $wrongCaseCheck.checks | Add-Member -NotePropertyName TouchTap -NotePropertyValue $true; Assert-Rejected $wrongCaseCheck "wrong-case check"

  $stringWidth = Copy-Receipt $valid; $stringWidth.environment.companionWidth = "2560"; Assert-Rejected $stringWidth "string companion width"
  $BooleanHeight = Copy-Receipt $valid; $BooleanHeight.environment.companionHeight = $true; Assert-Rejected $BooleanHeight "Boolean companion height"
  $fractionWidth = Copy-Receipt $valid; $fractionWidth.environment.companionWidth = 2559.5; Assert-Rejected $fractionWidth "fractional companion width"
  $zeroHeight = Copy-Receipt $valid; $zeroHeight.environment.companionHeight = 0; Assert-Rejected $zeroHeight "non-positive companion height"

  $scalarScaling = Copy-Receipt $valid; $scalarScaling.environment.testedScalingPercent = 100; Assert-Rejected $scalarScaling "scalar scaling"
  $stringScaling = Copy-Receipt $valid; $stringScaling.environment.testedScalingPercent = @(100,125,150,175,"200"); Assert-Rejected $stringScaling "string scaling value"
  $BooleanScaling = Copy-Receipt $valid; $BooleanScaling.environment.testedScalingPercent = @(100,125,150,175,$true); Assert-Rejected $BooleanScaling "Boolean scaling value"
  $fractionScaling = Copy-Receipt $valid; $fractionScaling.environment.testedScalingPercent = @(100,125,150,175,199.5); Assert-Rejected $fractionScaling "fractional scaling value"
  $duplicateScaling = Copy-Receipt $valid; $duplicateScaling.environment.testedScalingPercent = @(100,125,150,175,175); Assert-Rejected $duplicateScaling "duplicate scaling value"
  $extraScaling = Copy-Receipt $valid; $extraScaling.environment.testedScalingPercent = @(100,125,150,175,200,225); Assert-Rejected $extraScaling "extra scaling value"

  $numericScreenshot = Copy-Receipt $valid; $numericScreenshot.evidence.screenshotReferences = @(123); Assert-Rejected $numericScreenshot "numeric screenshot reference"
  $scalarScreenshot = Copy-Receipt $valid; $scalarScreenshot.evidence.screenshotReferences = "startup-100pct"; Assert-Rejected $scalarScreenshot "scalar screenshot reference"

  $offsetTimestamp = Copy-Receipt $valid; $offsetTimestamp.completedAt = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(-4)).ToString("O", [Globalization.CultureInfo]::InvariantCulture); Assert-Rejected $offsetTimestamp "non-UTC offset timestamp"
  $futureTimestamp = Copy-Receipt $valid; $futureTimestamp.completedAt = [DateTime]::UtcNow.AddMinutes(6).ToString("O", [Globalization.CultureInfo]::InvariantCulture); Assert-Rejected $futureTimestamp "future timestamp"
  $staleTimestamp = Copy-Receipt $valid; $staleTimestamp.completedAt = [DateTime]::UtcNow.AddDays(-31).ToString("O", [Globalization.CultureInfo]::InvariantCulture); Assert-Rejected $staleTimestamp "stale timestamp"
  $localTimestamp = Copy-Receipt $valid; $localTimestamp.completedAt = [DateTime]::Now.ToString("yyyy-MM-dd'T'HH:mm:ss", [Globalization.CultureInfo]::InvariantCulture); Assert-Rejected $localTimestamp "non-UTC timestamp"
  $newlineTimestamp = Copy-Receipt $valid; $newlineTimestamp.completedAt = [DateTime]::UtcNow.ToString("O", [Globalization.CultureInfo]::InvariantCulture) + "`n"; Assert-Rejected $newlineTimestamp "newline timestamp"
  Write-Host "checked display qualification receipt fixtures"
} finally {
  $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolved = [System.IO.Path]::GetFullPath($root)
  if ($resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved).StartsWith("auxora-display-receipt-", [StringComparison]::Ordinal)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
