param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,

  [switch]$RequireSignature,

  [string]$PublishedAppPath = "",

  [string[]]$AllowedSignerThumbprint = @()
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSEdition -eq "Desktop") {
  Import-Module (Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1") -Force
}
$failures = New-Object System.Collections.Generic.List[string]
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")

function Add-ArtifactFailure($message) {
  $script:failures.Add($message) | Out-Null
  Write-Error $message -ErrorAction Continue
}

$approvedSignerThumbprints = New-Object System.Collections.Generic.List[string]
foreach ($thumbprint in $AllowedSignerThumbprint) {
  $normalizedThumbprint = ([string]$thumbprint -replace '\s', '').ToUpperInvariant()
  if ($normalizedThumbprint -notmatch '^[0-9A-F]{40}$') {
    Add-ArtifactFailure "Approved signer thumbprints must contain exactly 40 hexadecimal characters."
  } elseif (-not $approvedSignerThumbprints.Contains($normalizedThumbprint)) {
    $approvedSignerThumbprints.Add($normalizedThumbprint) | Out-Null
  }
}
if ($RequireSignature -and $approvedSignerThumbprints.Count -eq 0) {
  Add-ArtifactFailure "At least one approved Auxora signer thumbprint is required for signed releases."
}

function Assert-ApprovedSigner($signature, $artifactLabel) {
  if ($signature.Status -ne "Valid") {
    return
  }

  $actualThumbprint = ([string]$signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
  if (-not $script:approvedSignerThumbprints.Contains($actualThumbprint)) {
    Add-ArtifactFailure "$artifactLabel signer is not in the approved Auxora signer list: $actualThumbprint"
  }
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
  $hashParts = (Get-Content -LiteralPath $hashPath -Raw).Trim() -split '\s+', 2
  $expectedHash = $hashParts[0]
  $actualHash = Get-Sha256Hash $resolvedInstaller
  if (($hashParts.Count -ne 2) -or
      (-not ($expectedHash -match '^[0-9A-Fa-f]{64}$')) -or
      (-not $expectedHash.Equals($actualHash, [System.StringComparison]::OrdinalIgnoreCase)) -or
      ($hashParts[1].Trim() -cne $installerName)) {
    Add-ArtifactFailure "Installer SHA256 sidecar does not match the exact artifact filename and bytes."
  }
}

$installerSignature = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller
if ($RequireSignature -and $installerSignature.Status -ne "Valid") {
  Add-ArtifactFailure "Installer signature is not valid: $($installerSignature.Status)"
} elseif ($RequireSignature) {
  Assert-ApprovedSigner $installerSignature "Installer"
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
    } else {
      Assert-ApprovedSigner $appSignature "Published app executable"
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Host "Release artifact verification failed with $($failures.Count) issue(s)." -ForegroundColor Red
  exit 1
}

Write-Host "Release artifact verified: $installerName" -ForegroundColor Green
