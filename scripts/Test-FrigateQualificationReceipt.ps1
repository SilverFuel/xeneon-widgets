param(
  [Parameter(Mandatory = $true)][string]$ReceiptPath,
  [Parameter(Mandatory = $true)][string]$ReleaseAssetsPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\Json.ps1")

function Assert-True($condition, [string]$message) {
  if (-not $condition) {
    throw $message
  }
}

function Assert-ExactObjectShape($value, [string]$path, [string[]]$expectedProperties) {
  Assert-True ($null -ne $value -and $value.GetType() -eq [System.Management.Automation.PSCustomObject]) "Frigate qualification receipt $path must be a JSON object."

  $actualProperties = @($value.PSObject.Properties | ForEach-Object { $_.Name })
  Assert-True ($actualProperties.Count -eq $expectedProperties.Count) "Frigate qualification receipt $path must contain exactly: $($expectedProperties -join ', ')."
  foreach ($property in $expectedProperties) {
    Assert-True ($actualProperties -ccontains $property) "Frigate qualification receipt $path is missing exact property '$property'."
  }
  foreach ($property in $actualProperties) {
    Assert-True ($expectedProperties -ccontains $property) "Frigate qualification receipt $path contains unexpected property '$property'."
  }
}

function Assert-ExactNonEmptyString($value, [string]$path) {
  Assert-True ($value -is [string]) "Frigate qualification receipt $path must be a JSON string."
  Assert-True (-not [string]::IsNullOrWhiteSpace($value)) "Frigate qualification receipt $path must be a non-empty string."
}

function Assert-ExactTrue($value, [string]$path) {
  Assert-True ($value -is [bool]) "Frigate qualification receipt $path must be the JSON Boolean true."
  Assert-True ($value -eq $true) "Frigate qualification receipt $path must be true."
}

function Test-ExactJsonInteger($value) {
  return (
    $value -is [byte] -or
    $value -is [sbyte] -or
    $value -is [int16] -or
    $value -is [uint16] -or
    $value -is [int32] -or
    $value -is [uint32] -or
    $value -is [int64] -or
    $value -is [uint64]
  )
}

function ConvertFrom-StrictUtcTimestamp($value, [string]$path) {
  Assert-ExactNonEmptyString $value $path
  Assert-True ($value -cmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,7})?(?:Z|\+00:00)\z') "Frigate qualification receipt $path must be an ISO-8601 UTC timestamp ending in Z or +00:00."

  $parsed = [DateTimeOffset]::MinValue
  $parsedSuccessfully = [DateTimeOffset]::TryParse(
    $value,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::RoundtripKind,
    [ref]$parsed
  )
  Assert-True $parsedSuccessfully "Frigate qualification receipt $path must be a valid ISO-8601 timestamp."
  Assert-True ($parsed.Offset -eq [TimeSpan]::Zero) "Frigate qualification receipt $path must use UTC."
  return $parsed.ToUniversalTime()
}

function Assert-NoSecrets($value, [string]$path = "receipt") {
  if ($null -eq $value) {
    return
  }

  if ($value -is [string]) {
    if ($value -match '(?i)\bBearer\s+[A-Za-z0-9._~-]+') {
      throw "Frigate qualification receipt contains a bearer credential at $path."
    }
    return
  }

  if ($value -is [System.Management.Automation.PSCustomObject]) {
    $blockedNames = @("password", "username", "accessToken", "authorization", "cookie", "secret")
    foreach ($property in $value.PSObject.Properties) {
      if ($blockedNames -contains $property.Name) {
        throw "Frigate qualification receipt must not contain secret field '$($property.Name)' at $path."
      }
      Assert-NoSecrets $property.Value "$path.$($property.Name)"
    }
    return
  }

  if ($value -is [System.Collections.IEnumerable]) {
    $index = 0
    foreach ($item in $value) {
      Assert-NoSecrets $item "$path[$index]"
      $index += 1
    }
  }
}

$root = (Resolve-Path -LiteralPath $ReleaseAssetsPath -ErrorAction Stop).Path
$manifestPath = Join-Path $root "release-manifest.json"
$manifest = ConvertFrom-JsonPreservingLexicalTypes (Get-Content -LiteralPath $manifestPath -Raw)
$receipt = ConvertFrom-JsonPreservingLexicalTypes (Get-Content -LiteralPath $ReceiptPath -Raw)

Assert-NoSecrets $receipt
Assert-ExactObjectShape $receipt "root" @(
  "schemaVersion",
  "tag",
  "version",
  "commitSha",
  "installerFileName",
  "installerSha256",
  "app",
  "environment",
  "authentication",
  "evidence",
  "checks",
  "operator",
  "completedAt"
)
Assert-ExactObjectShape $receipt.app "app" @("name", "version", "assetRevision")
Assert-ExactObjectShape $receipt.environment "environment" @(
  "physicalFrigateServer",
  "realCamera",
  "targetLan",
  "windowsTrustedTls",
  "frigateVersion",
  "endpoint",
  "camera",
  "role"
)
Assert-ExactObjectShape $receipt.authentication "authentication" @("configured", "authenticated", "tokenRenewalObserved")
Assert-ExactObjectShape $receipt.evidence "evidence" @("eventObservedAt", "snapshotContentType", "snapshotBytes")

$requiredChecks = @(
  "saveAndTest",
  "authenticatedLogin",
  "viewerOrCustomRole",
  "cameraFilter",
  "freshEvent",
  "snapshot",
  "tokenRenewal",
  "disconnectDetected",
  "reconnectRecovered"
)
Assert-ExactObjectShape $receipt.checks "checks" $requiredChecks

Assert-True (Test-ExactJsonInteger $receipt.schemaVersion) "Frigate qualification receipt schemaVersion must be the JSON integer 1."
Assert-True ($receipt.schemaVersion -eq 1) "Frigate qualification receipt schemaVersion must be the JSON integer 1."

foreach ($binding in @("tag", "version", "commitSha")) {
  Assert-ExactNonEmptyString $receipt.$binding $binding
  Assert-True ([string]::Equals($receipt.$binding, [string]$manifest.$binding, [StringComparison]::Ordinal)) "Frigate qualification receipt $binding does not match the release manifest."
}

foreach ($stringPath in @(
  @{ value = $receipt.installerFileName; path = "installerFileName" },
  @{ value = $receipt.installerSha256; path = "installerSha256" },
  @{ value = $receipt.app.name; path = "app.name" },
  @{ value = $receipt.app.version; path = "app.version" },
  @{ value = $receipt.app.assetRevision; path = "app.assetRevision" },
  @{ value = $receipt.environment.frigateVersion; path = "environment.frigateVersion" },
  @{ value = $receipt.environment.endpoint; path = "environment.endpoint" },
  @{ value = $receipt.environment.camera; path = "environment.camera" },
  @{ value = $receipt.environment.role; path = "environment.role" },
  @{ value = $receipt.evidence.eventObservedAt; path = "evidence.eventObservedAt" },
  @{ value = $receipt.evidence.snapshotContentType; path = "evidence.snapshotContentType" },
  @{ value = $receipt.operator; path = "operator" },
  @{ value = $receipt.completedAt; path = "completedAt" }
)) {
  Assert-ExactNonEmptyString $stringPath.value $stringPath.path
}

Assert-True ([string]::Equals($receipt.installerFileName, [string]$manifest.installer.fileName, [StringComparison]::Ordinal)) "Frigate qualification receipt does not bind the exact installer filename."
Assert-True ([string]::Equals($receipt.installerSha256, [string]$manifest.installer.sha256, [StringComparison]::OrdinalIgnoreCase)) "Frigate qualification receipt does not bind the exact installer SHA-256."
Assert-True ([string]::Equals($receipt.app.name, "Auxora", [StringComparison]::Ordinal)) "Frigate qualification receipt app name must be Auxora."
Assert-True ([string]::Equals($receipt.app.version, [string]$manifest.version, [StringComparison]::Ordinal)) "Frigate qualification receipt app version does not match the release manifest."
Assert-True ($receipt.app.assetRevision -cmatch '^20\d{6}-\d{2}$') "Frigate qualification receipt must record the installed dashboard asset revision."

Assert-ExactTrue $receipt.environment.physicalFrigateServer "environment.physicalFrigateServer"
Assert-ExactTrue $receipt.environment.realCamera "environment.realCamera"
Assert-ExactTrue $receipt.environment.targetLan "environment.targetLan"
Assert-ExactTrue $receipt.environment.windowsTrustedTls "environment.windowsTrustedTls"
Assert-True (@("viewer", "custom") -ccontains $receipt.environment.role) "Qualification role must be viewer or custom."

$endpoint = $null
Assert-True ([Uri]::TryCreate([string]$receipt.environment.endpoint, [UriKind]::Absolute, [ref]$endpoint)) "Qualification endpoint must be an absolute URI."
Assert-True ($endpoint.Scheme -ceq "https") "Qualification endpoint must use HTTPS."
Assert-True ([string]::IsNullOrWhiteSpace($endpoint.UserInfo)) "Qualification endpoint must not contain embedded credentials."
Assert-True ([string]::IsNullOrWhiteSpace($endpoint.Query) -and [string]::IsNullOrWhiteSpace($endpoint.Fragment)) "Qualification endpoint must not contain a query string or fragment."

Assert-ExactTrue $receipt.authentication.configured "authentication.configured"
Assert-ExactTrue $receipt.authentication.authenticated "authentication.authenticated"
Assert-ExactTrue $receipt.authentication.tokenRenewalObserved "authentication.tokenRenewalObserved"

foreach ($check in $requiredChecks) {
  Assert-ExactTrue $receipt.checks.$check "checks.$check"
}

$completedAt = ConvertFrom-StrictUtcTimestamp $receipt.completedAt "completedAt"
$eventObservedAt = ConvertFrom-StrictUtcTimestamp $receipt.evidence.eventObservedAt "evidence.eventObservedAt"
$now = [DateTimeOffset]::UtcNow
Assert-True ($completedAt -le $now.AddMinutes(5)) "Qualification completion cannot be more than 5 minutes in the future."
Assert-True ($eventObservedAt -le $now.AddMinutes(5)) "Qualification event evidence cannot be more than 5 minutes in the future."
Assert-True ($completedAt -ge $now.AddDays(-30)) "Qualification must have been completed within the last 30 days."
Assert-True ($eventObservedAt -le $completedAt) "Qualification event evidence cannot be dated after completion."
Assert-True (($completedAt - $eventObservedAt).TotalMinutes -le 15) "Qualification must observe a fresh camera event within 15 minutes of completion."
Assert-True (@("image/jpeg", "image/png", "image/webp") -ccontains $receipt.evidence.snapshotContentType) "Qualification snapshot must use a supported image content type."
Assert-True (Test-ExactJsonInteger $receipt.evidence.snapshotBytes) "Qualification snapshotBytes must be a positive JSON integer."
Assert-True ($receipt.evidence.snapshotBytes -gt 0) "Qualification snapshotBytes must be a positive JSON integer."

Write-Host "Frigate qualification receipt verified for exact candidate $($manifest.installer.fileName)."
