param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,

  [switch]$RequireSignature,

  [switch]$RequireUnsigned,

  [string]$PublishedAppPath = "",

  [string]$ExpectedInformationalVersion = "",

  [string]$ExpectedCommitSha = "",

  [string]$ExpectedProductName = "Auxora",

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
if ($RequireSignature -and $RequireUnsigned) {
  Add-ArtifactFailure "Release artifact verification cannot require both a signed and an unsigned installer."
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
if ($RequireSignature) {
  if ($installerSignature.Status -eq "Valid") {
    Assert-ApprovedSigner $installerSignature "Installer"
  } else {
    Add-ArtifactFailure "Installer signature is not valid: $($installerSignature.Status)"
  }
} elseif ($RequireUnsigned) {
  if ($installerSignature.Status -eq "NotSigned") {
    Write-Warning "Installer is unsigned (NotSigned), as required for this clearly labeled free beta."
  } else {
    Add-ArtifactFailure "Unsigned beta installer must have Authenticode status NotSigned; found $($installerSignature.Status)."
  }
} elseif ($installerSignature.Status -eq "Valid") {
  Write-Host "Installer has a valid Authenticode signature."
} elseif ($installerSignature.Status -eq "NotSigned") {
  Write-Warning "Installer is unsigned (NotSigned); this is acceptable only for a clearly labeled free beta."
} else {
  Add-ArtifactFailure "Installer has an invalid Authenticode status and cannot be treated as unsigned: $($installerSignature.Status)"
}

if ($RequireSignature -or
    -not [string]::IsNullOrWhiteSpace($PublishedAppPath) -or
    -not [string]::IsNullOrWhiteSpace($ExpectedInformationalVersion) -or
    -not [string]::IsNullOrWhiteSpace($ExpectedCommitSha)) {
  if ([string]::IsNullOrWhiteSpace($PublishedAppPath) -or -not (Test-Path -LiteralPath $PublishedAppPath -PathType Leaf)) {
    Add-ArtifactFailure "Published app executable is required when executable identity or signature verification is enabled."
  } else {
    $publishedVersionInfo = (Get-Item -LiteralPath $PublishedAppPath).VersionInfo
    if ([string]$publishedVersionInfo.ProductName -cne $ExpectedProductName) {
      Add-ArtifactFailure "Published app ProductName must be $ExpectedProductName; found '$($publishedVersionInfo.ProductName)'."
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedInformationalVersion)) {
      $publishedProductVersion = [string]$publishedVersionInfo.ProductVersion
      $escapedInformationalVersion = [regex]::Escape($ExpectedInformationalVersion)
      $expectedProductVersionPattern = "^$escapedInformationalVersion\.[0-9a-fA-F]{40}$"
      if ($publishedProductVersion -notmatch $expectedProductVersionPattern) {
        Add-ArtifactFailure "Published app ProductVersion '$publishedProductVersion' does not match '$ExpectedInformationalVersion'."
      }
      if (-not [string]::IsNullOrWhiteSpace($ExpectedCommitSha)) {
        if ($ExpectedCommitSha -notmatch '^[0-9a-fA-F]{40}$') {
          Add-ArtifactFailure "ExpectedCommitSha must contain exactly 40 hexadecimal characters."
        } elseif (-not $publishedProductVersion.Equals("$ExpectedInformationalVersion.$ExpectedCommitSha", [System.StringComparison]::OrdinalIgnoreCase)) {
          Add-ArtifactFailure "Published app ProductVersion is not bound to expected commit $ExpectedCommitSha."
        }
      }
    } elseif (-not [string]::IsNullOrWhiteSpace($ExpectedCommitSha)) {
      Add-ArtifactFailure "ExpectedInformationalVersion is required when ExpectedCommitSha is supplied."
    }

    if ($RequireSignature) {
      $appSignature = Get-AuthenticodeSignature -LiteralPath $PublishedAppPath
      if ($appSignature.Status -ne "Valid") {
        Add-ArtifactFailure "Published app executable signature is not valid: $($appSignature.Status)"
      } else {
        Assert-ApprovedSigner $appSignature "Published app executable"
      }
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Host "Release artifact verification failed with $($failures.Count) issue(s)." -ForegroundColor Red
  exit 1
}

Write-Host "Release artifact verified: $installerName" -ForegroundColor Green
