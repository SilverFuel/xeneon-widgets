param(
  [Parameter(Mandatory = $true)][string]$ReceiptPath,
  [Parameter(Mandatory = $true)][string]$ReleaseAssetsPath
)

$ErrorActionPreference = "Stop"

function Assert-True($condition, [string]$message) {
  if (-not $condition) {
    throw $message
  }
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
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json

Assert-NoSecrets $receipt
Assert-True ($receipt.schemaVersion -eq 1) "Frigate qualification receipt schemaVersion must be 1."

foreach ($binding in @("tag", "version", "commitSha")) {
  Assert-True ([string]$receipt.$binding -cne "") "Frigate qualification receipt must record $binding."
  Assert-True ([string]$receipt.$binding -ceq [string]$manifest.$binding) "Frigate qualification receipt $binding does not match the release manifest."
}

Assert-True ([string]$receipt.installerFileName -ceq [string]$manifest.installer.fileName) "Frigate qualification receipt does not bind the exact installer filename."
Assert-True (([string]$receipt.installerSha256).Equals([string]$manifest.installer.sha256, [StringComparison]::OrdinalIgnoreCase)) "Frigate qualification receipt does not bind the exact installer SHA-256."
Assert-True ([string]$receipt.app.name -ceq "Auxora") "Frigate qualification receipt app name must be Auxora."
Assert-True ([string]$receipt.app.version -ceq [string]$manifest.version) "Frigate qualification receipt app version does not match the release manifest."
Assert-True ([string]$receipt.app.assetRevision -match '^20\d{6}-\d{2}$') "Frigate qualification receipt must record the installed dashboard asset revision."

Assert-True ($receipt.environment.physicalFrigateServer -eq $true) "Qualification must use a physical Frigate server, not a fixture."
Assert-True ($receipt.environment.realCamera -eq $true) "Qualification must use a real camera."
Assert-True ($receipt.environment.targetLan -eq $true) "Qualification must run on the intended local/private target LAN."
Assert-True ($receipt.environment.windowsTrustedTls -eq $true) "Authenticated Frigate qualification requires Windows-trusted TLS."
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$receipt.environment.frigateVersion)) "Qualification must record the Frigate version."
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$receipt.environment.camera)) "Qualification must record the filtered camera name."
Assert-True (@("viewer", "custom") -contains [string]$receipt.environment.role) "Qualification role must be viewer or custom."

$endpoint = $null
Assert-True ([Uri]::TryCreate([string]$receipt.environment.endpoint, [UriKind]::Absolute, [ref]$endpoint)) "Qualification endpoint must be an absolute URI."
Assert-True ($endpoint.Scheme -ceq "https") "Qualification endpoint must use HTTPS."
Assert-True ([string]::IsNullOrWhiteSpace($endpoint.UserInfo)) "Qualification endpoint must not contain embedded credentials."
Assert-True ([string]::IsNullOrWhiteSpace($endpoint.Query) -and [string]::IsNullOrWhiteSpace($endpoint.Fragment)) "Qualification endpoint must not contain a query string or fragment."

Assert-True ($receipt.authentication.configured -eq $true) "Qualification must confirm authentication was configured."
Assert-True ($receipt.authentication.authenticated -eq $true) "Qualification must confirm Frigate authentication succeeded."
Assert-True ($receipt.authentication.tokenRenewalObserved -eq $true) "Qualification must observe token expiry and one successful renewal."

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
foreach ($check in $requiredChecks) {
  Assert-True ($receipt.checks.$check -eq $true) "Frigate qualification check '$check' must be true before release."
}

$completedAt = [DateTimeOffset]::MinValue
$eventObservedAt = [DateTimeOffset]::MinValue
Assert-True ([DateTimeOffset]::TryParse([string]$receipt.completedAt, [ref]$completedAt)) "Qualification must record a valid completedAt timestamp."
Assert-True ([DateTimeOffset]::TryParse([string]$receipt.evidence.eventObservedAt, [ref]$eventObservedAt)) "Qualification must record a valid eventObservedAt timestamp."
Assert-True ($eventObservedAt -le $completedAt) "Qualification event evidence cannot be dated after completion."
Assert-True (($completedAt - $eventObservedAt).TotalMinutes -le 15) "Qualification must observe a fresh camera event within 15 minutes of completion."
Assert-True (@("image/jpeg", "image/png", "image/webp") -contains [string]$receipt.evidence.snapshotContentType) "Qualification snapshot must use a supported image content type."
Assert-True ([long]$receipt.evidence.snapshotBytes -gt 0) "Qualification snapshot must contain image bytes."
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$receipt.operator)) "Qualification must record the operator."

Write-Host "Frigate qualification receipt verified for exact candidate $($manifest.installer.fileName)."
