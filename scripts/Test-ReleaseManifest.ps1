param(
  [Parameter(Mandatory = $true)][string]$ReleaseAssetsPath,
  [string]$ExpectedTag = "",
  [string]$ExpectedCommitSha = "",
  [string]$PublishedAppPath = "",
  [switch]$RequireValidSignature
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSEdition -eq "Desktop") {
  Import-Module (Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1") -Force
}
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")
. (Join-Path $PSScriptRoot "lib\Json.ps1")

$root = (Resolve-Path -LiteralPath $ReleaseAssetsPath -ErrorAction Stop).Path
$manifestPath = Join-Path $root "release-manifest.json"
$manifest = ConvertFrom-JsonPreservingLexicalTypes (Get-Content -LiteralPath $manifestPath -Raw)

function Assert-ExactProperties($value, [string[]]$expectedNames, $label) {
  if ($null -eq $value -or $value -isnot [pscustomobject]) {
    throw "$label must be a JSON object."
  }

  $actualNames = @($value.PSObject.Properties.Name)
  if ($actualNames.Count -ne $expectedNames.Count) {
    throw "$label must contain exactly: $($expectedNames -join ', ')."
  }
  foreach ($expectedName in $expectedNames) {
    if ($actualNames -cnotcontains $expectedName) {
      throw "$label is missing exact property '$expectedName'."
    }
  }
  foreach ($actualName in $actualNames) {
    if ($expectedNames -cnotcontains $actualName) {
      throw "$label contains unexpected or mis-cased property '$actualName'."
    }
  }
}

Assert-ExactProperties $manifest @(
  "schemaVersion", "product", "platform", "channel", "tag", "version", "commitSha",
  "installer", "installedExecutable", "installNotesFileName", "releaseNotesFileName", "allowedAssets"
) "Release manifest"
Assert-ExactProperties $manifest.installer @("fileName", "sha256", "sha256FileName", "signatureStatus") "Release manifest installer"
Assert-ExactProperties $manifest.installedExecutable @(
  "fileName", "sha256", "productName", "version", "productVersion", "commitSha"
) "Release manifest installedExecutable"

$schemaVersionIsInteger = $manifest.schemaVersion -is [int16] -or $manifest.schemaVersion -is [int32] -or $manifest.schemaVersion -is [int64]
if (-not $schemaVersionIsInteger -or [int64]$manifest.schemaVersion -ne 2 -or $manifest.product -cne "Auxora" -or $manifest.platform -cne "windows-x64" -or $manifest.channel -cne "beta") {
  throw "Release manifest identity or schema is invalid."
}
if ($manifest.tag -cne "v$($manifest.version)") {
  throw "Release manifest tag and version do not agree."
}
if ($manifest.commitSha -notmatch '^[0-9a-f]{40}$') {
  throw "Release manifest must contain a full lowercase commit SHA."
}
if ($ExpectedTag -and $manifest.tag -cne $ExpectedTag) {
  throw "Release manifest tag '$($manifest.tag)' does not match expected tag '$ExpectedTag'."
}
if ($ExpectedCommitSha -and $manifest.commitSha -cne $ExpectedCommitSha.Trim().ToLowerInvariant()) {
  throw "Release manifest commit SHA does not match the immutable candidate commit."
}

$installedExecutable = $manifest.installedExecutable
$installedExecutableName = [string]$installedExecutable.fileName
$installedExecutableHash = [string]$installedExecutable.sha256
$installedProductName = [string]$installedExecutable.productName
$installedVersion = [string]$installedExecutable.version
$installedProductVersion = [string]$installedExecutable.productVersion
$installedCommitSha = [string]$installedExecutable.commitSha
if ($installedExecutableName -cne "XenonEdgeHost.exe" -or
    $installedExecutableHash -cnotmatch '^[0-9A-F]{64}$' -or
    $installedProductName -cne "Auxora" -or
    $installedVersion -cne ([string]$manifest.version) -or
    $installedCommitSha -cne ([string]$manifest.commitSha)) {
  throw "Release manifest installed executable identity is invalid."
}
$escapedVersion = [regex]::Escape([string]$manifest.version)
$escapedCommit = [regex]::Escape([string]$manifest.commitSha)
if ($installedProductVersion -cnotmatch "^$escapedVersion(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.$escapedCommit$") {
  throw "Release manifest installed executable ProductVersion is not bound to its version and commit."
}

if (-not [string]::IsNullOrWhiteSpace($PublishedAppPath)) {
  $publishedApp = Get-Item -LiteralPath $PublishedAppPath -ErrorAction Stop
  if ($publishedApp.Name -cne $installedExecutableName) {
    throw "Published app filename does not match the release manifest installed executable."
  }
  $publishedHash = Get-Sha256Hash $publishedApp.FullName
  if (-not $publishedHash.Equals($installedExecutableHash, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Published app SHA-256 does not match the release manifest installed executable."
  }
  $publishedVersionInfo = $publishedApp.VersionInfo
  if ([string]$publishedVersionInfo.ProductName -cne $installedProductName -or
      [string]$publishedVersionInfo.ProductVersion -cne $installedProductVersion) {
    throw "Published app product identity does not match the release manifest installed executable."
  }
}

$allowedAssets = @($manifest.allowedAssets | ForEach-Object { [string]$_ })
$actualAssets = @(Get-ChildItem -LiteralPath $root -File | ForEach-Object { $_.Name })
$expectedSorted = @($allowedAssets | Sort-Object)
$actualSorted = @($actualAssets | Sort-Object)
if ($allowedAssets.Count -ne 5 -or ($allowedAssets | Select-Object -Unique).Count -ne 5) {
  throw "Release manifest must allow exactly five unique public assets."
}
if (Compare-Object -ReferenceObject $expectedSorted -DifferenceObject $actualSorted) {
  throw "Release directory contains assets outside the exact manifest allowlist, or an allowed asset is missing."
}

$installerName = [string]$manifest.installer.fileName
$installerPath = Join-Path $root $installerName
$sidecarName = [string]$manifest.installer.sha256FileName
$sidecarPath = Join-Path $root $sidecarName
if ($installerName -notlike "Auxora-Setup-$($manifest.version)-*.exe" -or $sidecarName -cne "$installerName.sha256") {
  throw "Manifest installer filenames are not bound to the release version."
}
if ([string]$manifest.installNotesFileName -notin $allowedAssets -or [string]$manifest.releaseNotesFileName -notin $allowedAssets) {
  throw "Install and release notes must be present in the exact asset allowlist."
}

$actualHash = Get-Sha256Hash $installerPath
if (-not $actualHash.Equals([string]$manifest.installer.sha256, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Manifest SHA-256 does not match the installer bytes."
}
$sidecarParts = (Get-Content -LiteralPath $sidecarPath -Raw).Trim() -split '\s+', 2
if (($sidecarParts.Count -ne 2) -or
    (-not $sidecarParts[0].Equals($actualHash, [StringComparison]::OrdinalIgnoreCase)) -or
    ($sidecarParts[1].Trim() -cne $installerName)) {
  throw "SHA256 sidecar does not bind the exact installer filename and bytes."
}

$signature = Get-AuthenticodeSignature -LiteralPath $installerPath
if ([string]$signature.Status -cne [string]$manifest.installer.signatureStatus) {
  throw "Manifest signature status does not match the exact installer."
}
if ($RequireValidSignature -and $signature.Status -ne "Valid") {
  throw "A valid Authenticode signature is required."
}

Write-Host "Release manifest verified for $($manifest.tag) at $($manifest.commitSha)."
