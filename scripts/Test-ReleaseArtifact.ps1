param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,

  [switch]$RequireSignature,

  [string]$PublishedAppPath = ""
)

$ErrorActionPreference = "Stop"
$failures = New-Object System.Collections.Generic.List[string]
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")

function Add-ArtifactFailure($message) {
  $script:failures.Add($message) | Out-Null
  Write-Error $message -ErrorAction Continue
}

try {
  $resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
  if (-not (Test-Path -LiteralPath $resolvedInstaller -PathType Leaf)) {
    throw "Installer path is not a file."
  }
} catch {
  Write-Error "Installer does not exist: $InstallerPath"
  exit 1
}

$installerName = Split-Path -Leaf $resolvedInstaller
$expectedPrefix = "Auxora-Setup-$ExpectedVersion-"
if (-not ($installerName.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and $installerName.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase))) {
  Add-ArtifactFailure "Installer must be named $expectedPrefix<timestamp>.exe; found $installerName"
}

$hashPath = "$resolvedInstaller.sha256"
if (-not (Test-Path -LiteralPath $hashPath -PathType Leaf)) {
  Add-ArtifactFailure "Installer SHA256 sidecar is missing: $hashPath"
} else {
  $expectedHash = ((Get-Content -LiteralPath $hashPath -Raw).Trim() -split '\s+')[0]
  $actualHash = Get-Sha256Hash $resolvedInstaller
  if (-not ($expectedHash -match '^[0-9A-Fa-f]{64}$' -and $expectedHash.Equals($actualHash, [System.StringComparison]::OrdinalIgnoreCase))) {
    Add-ArtifactFailure "Installer SHA256 sidecar does not match the artifact."
  }
}

$installerSignature = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller
if ($RequireSignature -and $installerSignature.Status -ne "Valid") {
  Add-ArtifactFailure "Installer signature is not valid: $($installerSignature.Status)"
} elseif (-not $RequireSignature -and $installerSignature.Status -ne "Valid") {
  Write-Warning "Installer is unsigned ($($installerSignature.Status)); this is acceptable only for a clearly labeled free beta."
}

if ($RequireSignature) {
  if ([string]::IsNullOrWhiteSpace($PublishedAppPath) -or -not (Test-Path -LiteralPath $PublishedAppPath -PathType Leaf)) {
    Add-ArtifactFailure "Published app executable is required when signature verification is enabled."
  } else {
    $appSignature = Get-AuthenticodeSignature -LiteralPath $PublishedAppPath
    if ($appSignature.Status -ne "Valid") {
      Add-ArtifactFailure "Published app executable signature is not valid: $($appSignature.Status)"
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Host "Release artifact verification failed with $($failures.Count) issue(s)." -ForegroundColor Red
  exit 1
}

Write-Host "Release artifact verified: $installerName" -ForegroundColor Green
