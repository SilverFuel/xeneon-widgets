$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSEdition -eq "Desktop") {
  Import-Module (Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1") -Force
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$verifier = Join-Path $PSScriptRoot "Test-ReleaseArtifact.ps1"
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("auxora-artifact-tests-" + [guid]::NewGuid().ToString("N"))
$resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")
if (-not $resolvedFixture.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Fixture path escaped the temporary directory."
}

function Write-Fixture($name, $content, [switch]$MismatchHash) {
  $path = Join-Path $resolvedFixture $name
  [System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($content))
  $hash = Get-Sha256Hash $path
  if ($MismatchHash) {
    $hash = "0" * 64
  }
  Set-Content -LiteralPath "$path.sha256" -Value "$hash  $name" -Encoding ASCII
  return $path
}

function Invoke-ExpectedResult($label, $path, [bool]$shouldPass, [switch]$RequireSignature, [string]$PublishedAppPath = "", [string[]]$AllowedSignerThumbprint = @()) {
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $verifier, "-InstallerPath", $path, "-ExpectedVersion", "0.3.0")
  if ($RequireSignature) {
    if ([string]::IsNullOrWhiteSpace($PublishedAppPath)) {
      $PublishedAppPath = $path
    }
    $arguments += @("-RequireSignature", "-PublishedAppPath", $PublishedAppPath, "-AllowedSignerThumbprint") + $AllowedSignerThumbprint
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & powershell @arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $passed = $exitCode -eq 0
  if ($passed -ne $shouldPass) {
    throw "$label returned exit code $exitCode; expected pass=$shouldPass. Output: $($output -join ' ')"
  }
  Write-Host "OK: $label"
}

try {
  New-Item -ItemType Directory -Path $resolvedFixture -Force | Out-Null
  $current = Write-Fixture "Auxora-Setup-0.3.0-current.exe" "current unsigned fixture"
  $stale = Write-Fixture "Auxora-Setup-0.2.0-stale.exe" "stale fixture"
  $mismatch = Write-Fixture "Auxora-Setup-0.3.0-mismatch.exe" "mismatched fixture" -MismatchHash
  $signedSystemExecutable = Join-Path $env:SystemRoot "System32\notepad.exe"
  if ((Get-AuthenticodeSignature -LiteralPath $signedSystemExecutable).Status -ne "Valid") {
    throw "A valid Windows-signed system executable is required for the positive signature fixture."
  }
  $signedThumbprint = (Get-AuthenticodeSignature -LiteralPath $signedSystemExecutable).SignerCertificate.Thumbprint
  $signedInstaller = Join-Path $resolvedFixture "Auxora-Setup-0.3.0-signed.exe"
  $signedApp = Join-Path $resolvedFixture "Auxora-signed-app.exe"
  Copy-Item -LiteralPath $signedSystemExecutable -Destination $signedInstaller
  Copy-Item -LiteralPath $signedSystemExecutable -Destination $signedApp
  $signedHash = Get-Sha256Hash $signedInstaller
  Set-Content -LiteralPath "$signedInstaller.sha256" -Value "$signedHash  $([System.IO.Path]::GetFileName($signedInstaller))" -Encoding ASCII

  Invoke-ExpectedResult "current unsigned beta artifact" $current $true
  Invoke-ExpectedResult "directory installer path" $resolvedFixture $false
  Invoke-ExpectedResult "stale-version artifact" $stale $false
  Invoke-ExpectedResult "hash-mismatched artifact" $mismatch $false
  Invoke-ExpectedResult "unsigned commercial artifact" $current $false -RequireSignature -AllowedSignerThumbprint $signedThumbprint
  Invoke-ExpectedResult "signed commercial artifact" $signedInstaller $true -RequireSignature -PublishedAppPath $signedApp -AllowedSignerThumbprint $signedThumbprint
  Invoke-ExpectedResult "unapproved valid signer" $signedInstaller $false -RequireSignature -PublishedAppPath $signedApp -AllowedSignerThumbprint ("0" * 40)
} finally {
  if (Test-Path -LiteralPath $resolvedFixture) {
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
  }
}

Write-Host "checked release artifact verifier fixtures"
