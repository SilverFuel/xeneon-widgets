$ErrorActionPreference = "Stop"
$root = Join-Path ([System.IO.Path]::GetTempPath()) "auxora-display-receipt-$([Guid]::NewGuid().ToString('N'))"
$assets = Join-Path $root "assets"
$receiptPath = Join-Path $root "display-qualification-receipt.json"
$verifier = Join-Path $PSScriptRoot "Test-DisplayQualificationReceipt.ps1"

function Write-Json($value, [string]$path) { $value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding utf8 }
function Copy-Receipt($value) { return $value | ConvertTo-Json -Depth 12 | ConvertFrom-Json }
function Assert-Rejected($value, [string]$label) {
  Write-Json $value $receiptPath
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
    operator = "fixture-operator"; completedAt = [DateTimeOffset]::UtcNow.ToString("O")
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
  Write-Host "checked display qualification receipt fixtures"
} finally {
  $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolved = [System.IO.Path]::GetFullPath($root)
  if ($resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved).StartsWith("auxora-display-receipt-", [StringComparison]::Ordinal)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
