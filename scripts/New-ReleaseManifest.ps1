param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$Tag,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$CommitSha,
  [Parameter(Mandatory = $true)][string]$InstallNotesPath,
  [Parameter(Mandatory = $true)][string]$ReleaseNotesPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSEdition -eq "Desktop") {
  Import-Module (Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1") -Force
}
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")

$installer = Get-Item -LiteralPath $InstallerPath -ErrorAction Stop
$hashSidecar = Get-Item -LiteralPath "$($installer.FullName).sha256" -ErrorAction Stop
$installNotes = Get-Item -LiteralPath $InstallNotesPath -ErrorAction Stop
$releaseNotes = Get-Item -LiteralPath $ReleaseNotesPath -ErrorAction Stop
$normalizedSha = $CommitSha.Trim().ToLowerInvariant()

if ($normalizedSha -notmatch '^[0-9a-f]{40}$') {
  throw "CommitSha must be the full 40-character hexadecimal commit SHA."
}
if ($Tag -cne "v$Version") {
  throw "Release tag '$Tag' must exactly equal v$Version."
}

$expectedPrefix = "Auxora-Setup-$Version-"
if (-not ($installer.Name.StartsWith($expectedPrefix, [StringComparison]::Ordinal) -and $installer.Name.EndsWith(".exe", [StringComparison]::OrdinalIgnoreCase))) {
  throw "Installer filename must start with '$expectedPrefix' and end with .exe."
}

$actualHash = Get-Sha256Hash $installer.FullName
$sidecarParts = (Get-Content -LiteralPath $hashSidecar.FullName -Raw).Trim() -split '\s+', 2
if ($sidecarParts.Count -ne 2 -or $sidecarParts[0] -notmatch '^[0-9A-Fa-f]{64}$') {
  throw "Installer SHA256 sidecar must contain one SHA-256 value and the exact installer filename."
}
if (-not $sidecarParts[0].Equals($actualHash, [StringComparison]::OrdinalIgnoreCase) -or $sidecarParts[1].Trim() -cne $installer.Name) {
  throw "Installer SHA256 sidecar does not bind the exact installer filename and bytes."
}

$signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
$manifestName = [IO.Path]::GetFileName($OutputPath)
if ($manifestName -cne "release-manifest.json") {
  throw "Release manifest must be named release-manifest.json."
}

$allowedAssets = @(
  $installer.Name,
  $hashSidecar.Name,
  $installNotes.Name,
  $releaseNotes.Name,
  $manifestName
)
if (($allowedAssets | Select-Object -Unique).Count -ne $allowedAssets.Count) {
  throw "Release asset filenames must be unique."
}

$manifest = [ordered]@{
  schemaVersion = 1
  product = "Auxora"
  platform = "windows-x64"
  channel = "beta"
  tag = $Tag
  version = $Version
  commitSha = $normalizedSha
  installer = [ordered]@{
    fileName = $installer.Name
    sha256 = $actualHash.ToUpperInvariant()
    sha256FileName = $hashSidecar.Name
    signatureStatus = [string]$signature.Status
  }
  installNotesFileName = $installNotes.Name
  releaseNotesFileName = $releaseNotes.Name
  allowedAssets = $allowedAssets
}

$outputParent = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
if (-not (Test-Path -LiteralPath $outputParent)) {
  New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Host "Release manifest created for $Tag at $normalizedSha."
