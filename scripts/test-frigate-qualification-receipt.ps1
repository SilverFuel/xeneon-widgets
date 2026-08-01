$ErrorActionPreference = "Stop"
$root = Join-Path ([System.IO.Path]::GetTempPath()) "auxora-frigate-receipt-$([Guid]::NewGuid().ToString('N'))"
$assets = Join-Path $root "assets"
$receiptPath = Join-Path $root "frigate-qualification-receipt.json"
$verifier = Join-Path $PSScriptRoot "Test-FrigateQualificationReceipt.ps1"

function Write-Json($value, [string]$path) {
  $value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding utf8
}

function Copy-Receipt($value) {
  return $value | ConvertTo-Json -Depth 12 | ConvertFrom-Json
}

function Assert-Rejected($value, [string]$label) {
  Write-Json $value $receiptPath
  try {
    & $verifier -ReceiptPath $receiptPath -ReleaseAssetsPath $assets | Out-Null
    throw "$label fixture was accepted unexpectedly."
  } catch {
    if ($_.Exception.Message -eq "$label fixture was accepted unexpectedly.") {
      throw
    }
    Write-Host "OK: $label rejected"
  }
}

try {
  New-Item -ItemType Directory -Path $assets -Force | Out-Null
  $manifest = [ordered]@{
    schemaVersion = 1
    tag = "v0.3.0-beta.1"
    version = "0.3.0-beta.1"
    commitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    installer = [ordered]@{
      fileName = "Auxora-Setup-0.3.0-beta.1-fixture.exe"
      sha256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  }
  Write-Json $manifest (Join-Path $assets "release-manifest.json")

  $completed = [DateTimeOffset]::UtcNow
  $valid = [ordered]@{
    schemaVersion = 1
    tag = $manifest.tag
    version = $manifest.version
    commitSha = $manifest.commitSha
    installerFileName = $manifest.installer.fileName
    installerSha256 = $manifest.installer.sha256
    app = [ordered]@{ name = "Auxora"; version = $manifest.version; assetRevision = "20260719-15" }
    environment = [ordered]@{
      physicalFrigateServer = $true
      realCamera = $true
      targetLan = $true
      windowsTrustedTls = $true
      frigateVersion = "0.15.1"
      endpoint = "https://frigate.example.lan:8971/"
      camera = "driveway"
      role = "viewer"
    }
    authentication = [ordered]@{ configured = $true; authenticated = $true; tokenRenewalObserved = $true }
    evidence = [ordered]@{
      eventObservedAt = $completed.AddMinutes(-2).ToString("O")
      snapshotContentType = "image/jpeg"
      snapshotBytes = 2048
    }
    checks = [ordered]@{
      saveAndTest = $true
      authenticatedLogin = $true
      viewerOrCustomRole = $true
      cameraFilter = $true
      freshEvent = $true
      snapshot = $true
      tokenRenewal = $true
      disconnectDetected = $true
      reconnectRecovered = $true
    }
    operator = "fixture-operator"
    completedAt = $completed.ToString("O")
  }

  Write-Json $valid $receiptPath
  & $verifier -ReceiptPath $receiptPath -ReleaseAssetsPath $assets | Out-Null
  Write-Host "OK: valid physical Frigate receipt"

  $secret = Copy-Receipt $valid
  $secret | Add-Member -NotePropertyName password -NotePropertyValue "must-not-appear"
  Assert-Rejected $secret "secret-bearing receipt"

  $fixtureOnly = Copy-Receipt $valid
  $fixtureOnly.environment.realCamera = $false
  Assert-Rejected $fixtureOnly "fixture-only camera"

  $plaintext = Copy-Receipt $valid
  $plaintext.environment.endpoint = "http://frigate.example.lan:5000/"
  Assert-Rejected $plaintext "plaintext authenticated endpoint"

  $stale = Copy-Receipt $valid
  $stale.evidence.eventObservedAt = $completed.AddHours(-1).ToString("O")
  Assert-Rejected $stale "stale event"

  $failedReconnect = Copy-Receipt $valid
  $failedReconnect.checks.reconnectRecovered = $false
  Assert-Rejected $failedReconnect "failed reconnect"

  Write-Host "checked Frigate qualification receipt fixtures"
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolvedRoot = [System.IO.Path]::GetFullPath($root)
  if ($resolvedRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedRoot).StartsWith("auxora-frigate-receipt-", [StringComparison]::Ordinal)) {
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
