param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path,

  [string]$CertificatePath = "",
  [securestring]$CertificatePassword,
  [string]$Thumbprint = "",
  [ValidateSet("CurrentUser", "LocalMachine")]
  [string]$CertificateStore = "CurrentUser",
  [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path $kitsRoot) {
    $candidate = Get-ChildItem $kitsRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }

  throw "signtool.exe was not found. Install the Windows SDK or add signtool.exe to PATH."
}

if (-not $CertificatePath -and -not $Thumbprint) {
  throw "Provide either -CertificatePath or -Thumbprint."
}

if ($CertificatePath -and $Thumbprint) {
  throw "Use either -CertificatePath or -Thumbprint, not both."
}

if ($CertificatePath -and -not (Test-Path -LiteralPath $CertificatePath)) {
  throw "Certificate file not found: $CertificatePath"
}

$signTool = Find-SignTool
$effectiveThumbprint = $Thumbprint
$certificateStorePath = "Cert:\$CertificateStore\My"
$temporaryCertificateThumbprints = @()

try {
  if ($CertificatePath) {
    if (-not $CertificatePassword) {
      $CertificatePassword = Read-Host "Certificate password" -AsSecureString
    }

    $resolvedCertificatePath = (Resolve-Path -LiteralPath $CertificatePath).Path
    if (-not (Test-Path -LiteralPath $resolvedCertificatePath -PathType Leaf)) {
      throw "Certificate path is not a file: $CertificatePath"
    }

    $pfxData = Get-PfxData -FilePath $resolvedCertificatePath -Password $CertificatePassword -ErrorAction Stop
    $pfxCertificates = @($pfxData.EndEntityCertificates) + @($pfxData.OtherCertificates)
    $temporaryCertificateThumbprints = @($pfxCertificates | Where-Object { $_ } | Select-Object -ExpandProperty Thumbprint -Unique)
    if ($temporaryCertificateThumbprints.Count -eq 0) {
      throw "The PFX does not contain any certificates."
    }
    foreach ($certificateThumbprint in $temporaryCertificateThumbprints) {
      if (Test-Path -LiteralPath (Join-Path $certificateStorePath $certificateThumbprint)) {
        throw "The PFX contains a certificate that already exists in $certificateStorePath; refusing a temporary import that could alter it."
      }
    }

    $importedCertificates = @(Import-PfxCertificate -FilePath $resolvedCertificatePath -CertStoreLocation $certificateStorePath -Password $CertificatePassword -ErrorAction Stop)
    $signingCertificates = @($importedCertificates | Where-Object { $_.HasPrivateKey })
    if ($signingCertificates.Count -ne 1) {
      throw "The PFX must contain exactly one certificate with a private key."
    }
    $effectiveThumbprint = $signingCertificates[0].Thumbprint
  }

  foreach ($item in $Path) {
    $resolved = Resolve-Path -LiteralPath $item
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
      throw "Signing target is not a file: $item"
    }
    $args = @(
      "sign",
      "/fd", "SHA256",
      "/tr", $TimestampUrl,
      "/td", "SHA256",
      "/sha1", $effectiveThumbprint
    )
    if ($CertificateStore -eq "LocalMachine") {
      $args += "/sm"
    }
    $args += $resolved.Path

    Write-Host "Signing $($resolved.Path)"
    & $signTool @args
    if ($LASTEXITCODE -ne 0) {
      throw "signtool sign failed for $($resolved.Path)"
    }

    & $signTool verify /pa /v $resolved.Path
    if ($LASTEXITCODE -ne 0) {
      throw "signtool verify failed for $($resolved.Path)"
    }

    $hashPath = "$($resolved.Path).sha256"
    if (Test-Path -LiteralPath $hashPath) {
      $hash = Get-Sha256Hash $resolved.Path
      Set-Content -LiteralPath $hashPath -Value "$hash  $(Split-Path -Leaf $resolved.Path)" -Encoding ASCII
      Write-Host "Updated SHA256 sidecar after signing: $hashPath"
    }
  }
} finally {
  $CertificatePassword = $null
  foreach ($certificateThumbprint in $temporaryCertificateThumbprints) {
    $temporaryCertificatePath = Join-Path $certificateStorePath $certificateThumbprint
    if (Test-Path -LiteralPath $temporaryCertificatePath) {
      Remove-Item -LiteralPath $temporaryCertificatePath -DeleteKey -Force -ErrorAction Stop
    }
  }
}
