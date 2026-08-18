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
  Assert-RejectedJson (Get-Content -LiteralPath $receiptPath -Raw) $label
}

function Assert-RejectedJson([string]$json, [string]$label) {
  Set-Content -LiteralPath $receiptPath -Value $json -Encoding utf8
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

  $extraRootProperty = Copy-Receipt $valid
  $extraRootProperty | Add-Member -NotePropertyName notes -NotePropertyValue "unexpected"
  Assert-Rejected $extraRootProperty "extra root property"

  $arrayEnvironment = Copy-Receipt $valid
  $arrayEnvironment.environment = @($arrayEnvironment.environment)
  Assert-Rejected $arrayEnvironment "array in place of environment object"

  $extraEnvironmentProperty = Copy-Receipt $valid
  $extraEnvironmentProperty.environment | Add-Member -NotePropertyName fixture -NotePropertyValue $false
  Assert-Rejected $extraEnvironmentProperty "extra environment property"

  $schemaString = Copy-Receipt $valid
  $schemaString.schemaVersion = "1"
  Assert-Rejected $schemaString "string schema version"

  $schemaBoolean = Copy-Receipt $valid
  $schemaBoolean.schemaVersion = $true
  Assert-Rejected $schemaBoolean "Boolean schema version"

  $schemaFractionJson = $valid | ConvertTo-Json -Depth 12
  $schemaFractionJson = [regex]::Replace($schemaFractionJson, '"schemaVersion"\s*:\s*1(?=\s*[,}])', '"schemaVersion": 1.0', 1)
  Assert-RejectedJson $schemaFractionJson "fractional-form schema version"

  $numericCamera = Copy-Receipt $valid
  $numericCamera.environment.camera = 123
  Assert-Rejected $numericCamera "numeric camera name"

  $blankOperator = Copy-Receipt $valid
  $blankOperator.operator = "   "
  Assert-Rejected $blankOperator "blank operator"

  $fixtureOnly = Copy-Receipt $valid
  $fixtureOnly.environment.realCamera = $false
  Assert-Rejected $fixtureOnly "fixture-only camera"

  $stringEnvironmentBoolean = Copy-Receipt $valid
  $stringEnvironmentBoolean.environment.realCamera = "true"
  Assert-Rejected $stringEnvironmentBoolean "string environment Boolean"

  $numericAuthenticationBoolean = Copy-Receipt $valid
  $numericAuthenticationBoolean.authentication.authenticated = 1
  Assert-Rejected $numericAuthenticationBoolean "numeric authentication Boolean"

  $plaintext = Copy-Receipt $valid
  $plaintext.environment.endpoint = "http://frigate.example.lan:5000/"
  Assert-Rejected $plaintext "plaintext authenticated endpoint"

  $stale = Copy-Receipt $valid
  $stale.evidence.eventObservedAt = $completed.AddHours(-1).ToString("O")
  Assert-Rejected $stale "stale event"

  $eventAfterCompletion = Copy-Receipt $valid
  $eventAfterCompletion.evidence.eventObservedAt = $completed.AddMinutes(1).ToString("O")
  Assert-Rejected $eventAfterCompletion "event after completion"

  $nonUtcTimestamp = Copy-Receipt $valid
  $nonUtcTimestamp.completedAt = $completed.ToOffset([TimeSpan]::FromHours(-4)).ToString("O")
  Assert-Rejected $nonUtcTimestamp "non-UTC completion timestamp"

  $nonIsoTimestamp = Copy-Receipt $valid
  $nonIsoTimestamp.completedAt = $completed.ToString("yyyy/MM/dd HH:mm:ss")
  Assert-Rejected $nonIsoTimestamp "non-ISO completion timestamp"

  $newlineTimestamp = Copy-Receipt $valid
  $newlineTimestamp.completedAt = $completed.ToString("O") + "`n"
  Assert-Rejected $newlineTimestamp "newline completion timestamp"

  $futureCompletion = Copy-Receipt $valid
  $futureCompletion.completedAt = $completed.AddMinutes(6).ToString("O")
  Assert-Rejected $futureCompletion "completion more than five minutes in future"

  $expiredCompletion = Copy-Receipt $valid
  $expiredCompletion.completedAt = $completed.AddDays(-31).ToString("O")
  $expiredCompletion.evidence.eventObservedAt = $completed.AddDays(-31).AddMinutes(-2).ToString("O")
  Assert-Rejected $expiredCompletion "completion older than thirty days"

  $stringSnapshotBytes = Copy-Receipt $valid
  $stringSnapshotBytes.evidence.snapshotBytes = "2048"
  Assert-Rejected $stringSnapshotBytes "string snapshot byte count"

  $booleanSnapshotBytes = Copy-Receipt $valid
  $booleanSnapshotBytes.evidence.snapshotBytes = $true
  Assert-Rejected $booleanSnapshotBytes "Boolean snapshot byte count"

  $fractionalSnapshotBytes = Copy-Receipt $valid
  $fractionalSnapshotBytes.evidence.snapshotBytes = [double]2048.5
  Assert-Rejected $fractionalSnapshotBytes "fractional snapshot byte count"

  $arraySnapshotBytes = Copy-Receipt $valid
  $arraySnapshotBytes.evidence.snapshotBytes = @(2048)
  Assert-Rejected $arraySnapshotBytes "array snapshot byte count"

  $zeroSnapshotBytes = Copy-Receipt $valid
  $zeroSnapshotBytes.evidence.snapshotBytes = 0
  Assert-Rejected $zeroSnapshotBytes "zero snapshot byte count"

  $failedReconnect = Copy-Receipt $valid
  $failedReconnect.checks.reconnectRecovered = $false
  Assert-Rejected $failedReconnect "failed reconnect"

  $stringCheck = Copy-Receipt $valid
  $stringCheck.checks.snapshot = "true"
  Assert-Rejected $stringCheck "string check Boolean"

  $missingCheck = Copy-Receipt $valid
  $missingCheck.checks.PSObject.Properties.Remove("snapshot")
  Assert-Rejected $missingCheck "missing required check"

  $extraCheck = Copy-Receipt $valid
  $extraCheck.checks | Add-Member -NotePropertyName fixtureOnly -NotePropertyValue $true
  Assert-Rejected $extraCheck "extra check"

  Write-Host "checked Frigate qualification receipt fixtures"
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolvedRoot = [System.IO.Path]::GetFullPath($root)
  if ($resolvedRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedRoot).StartsWith("auxora-frigate-receipt-", [StringComparison]::Ordinal)) {
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
