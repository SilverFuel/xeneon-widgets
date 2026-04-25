param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path,

  [string]$CertificatePath = "",
  [securestring]$CertificatePassword,
  [string]$Thumbprint = "",
  [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

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

foreach ($item in $Path) {
  $resolved = Resolve-Path -LiteralPath $item
  $args = @(
    "sign",
    "/fd", "SHA256",
    "/tr", $TimestampUrl,
    "/td", "SHA256"
  )

  if ($CertificatePath) {
    $args += @("/f", (Resolve-Path -LiteralPath $CertificatePath))
    if (-not $CertificatePassword) {
      $CertificatePassword = Read-Host "Certificate password" -AsSecureString
    }
    $password = [Runtime.InteropServices.Marshal]::PtrToStringUni(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($CertificatePassword)
    )
    $args += @("/p", $password)
  } else {
    $args += @("/sha1", $Thumbprint, "/sm")
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
}
