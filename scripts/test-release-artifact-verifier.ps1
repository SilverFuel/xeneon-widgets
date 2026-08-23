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

function Write-UnsignedExecutableFixture($name, [string]$ProductName, [string]$ProductVersion) {
  if ($PSVersionTable.PSEdition -ne "Desktop") {
    throw "Release artifact executable fixtures require Windows PowerShell because Add-Type -OutputType ConsoleApplication is unavailable in PowerShell Core."
  }
  $path = Join-Path $resolvedFixture $name
  $escapedProductName = $ProductName.Replace("\", "\\").Replace('"', '\"')
  $escapedProductVersion = $ProductVersion.Replace("\", "\\").Replace('"', '\"')
  $source = @"
using System.Reflection;
[assembly: AssemblyProduct("$escapedProductName")]
[assembly: AssemblyInformationalVersion("$escapedProductVersion")]
namespace AuxoraArtifactFixture {
  public static class Program {
    public static void Main() { }
  }
}
"@
  Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $path -OutputType ConsoleApplication
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne "NotSigned") {
    throw "The unsigned executable fixture produced unexpected Authenticode status $($signature.Status)."
  }
  $hash = Get-Sha256Hash $path
  Set-Content -LiteralPath "$path.sha256" -Value "$hash  $name" -Encoding ASCII
  return $path
}

function Invoke-ExpectedResult($label, $path, [bool]$shouldPass, [switch]$RequireSignature, [switch]$RequireUnsigned, [string]$PublishedAppPath = "", [string]$ExpectedInformationalVersion = "", [string]$ExpectedCommitSha = "", [string]$ExpectedProductName = "Auxora", [string[]]$AllowedSignerThumbprint = @()) {
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $verifier, "-InstallerPath", $path, "-ExpectedVersion", "0.3.0")
  if ($RequireSignature) {
    if ([string]::IsNullOrWhiteSpace($PublishedAppPath)) {
      $PublishedAppPath = $path
    }
    $arguments += "-RequireSignature"
    if ($AllowedSignerThumbprint.Count -gt 0) {
      $arguments += @("-AllowedSignerThumbprint") + $AllowedSignerThumbprint
    }
  }
  if ($RequireUnsigned) {
    $arguments += "-RequireUnsigned"
  }
  if (-not [string]::IsNullOrWhiteSpace($PublishedAppPath)) {
    $arguments += @("-PublishedAppPath", $PublishedAppPath, "-ExpectedProductName", $ExpectedProductName)
  }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedInformationalVersion)) {
    $arguments += @("-ExpectedInformationalVersion", $ExpectedInformationalVersion)
  }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedCommitSha)) {
    $arguments += @("-ExpectedCommitSha", $ExpectedCommitSha)
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
  $fixtureCommit = "0123456789abcdef0123456789abcdef01234567"
  $wrongFixtureCommit = "fedcba9876543210fedcba9876543210fedcba98"
  $fixtureInformationalVersion = "0.3.0-beta.1+fixture"
  $current = Write-UnsignedExecutableFixture "Auxora-Setup-0.3.0-current.exe" "Auxora" "$fixtureInformationalVersion.$fixtureCommit"
  $stale = Write-Fixture "Auxora-Setup-0.2.0-stale.exe" "stale fixture"
  $mismatch = Write-Fixture "Auxora-Setup-0.3.0-mismatch.exe" "mismatched fixture" -MismatchHash
  $dotnetCommand = Get-Command dotnet -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $dotnetCommand) {
    throw "The .NET host is required for the Authenticode verifier fixture."
  }
  $signedSystemExecutable = $dotnetCommand.Source
  $signedFixtureSignature = Get-AuthenticodeSignature -LiteralPath $signedSystemExecutable
  if ($signedFixtureSignature.Status -ne "Valid" -or $signedFixtureSignature.SignatureType -ne "Authenticode") {
    throw "A valid embedded-Authenticode-signed .NET host is required for the signature verifier fixture."
  }
  $signedThumbprint = $signedFixtureSignature.SignerCertificate.Thumbprint
  $signedProductName = (Get-Item -LiteralPath $signedSystemExecutable).VersionInfo.ProductName
  $signedProductVersion = [string](Get-Item -LiteralPath $signedSystemExecutable).VersionInfo.ProductVersion
  $looseVersionPrefix = ($signedProductVersion -split '\.', 2)[0]
  $signedInstaller = Join-Path $resolvedFixture "Auxora-Setup-0.3.0-signed.exe"
  $hashMismatchInstaller = Join-Path $resolvedFixture "Auxora-Setup-0.3.0-hash-mismatch-signature.exe"
  $signedApp = Join-Path $resolvedFixture "Auxora-signed-app.exe"
  Copy-Item -LiteralPath $signedSystemExecutable -Destination $signedInstaller
  Copy-Item -LiteralPath $signedSystemExecutable -Destination $hashMismatchInstaller
  Copy-Item -LiteralPath $signedSystemExecutable -Destination $signedApp
  $signedHash = Get-Sha256Hash $signedInstaller
  Set-Content -LiteralPath "$signedInstaller.sha256" -Value "$signedHash  $([System.IO.Path]::GetFileName($signedInstaller))" -Encoding ASCII
  $hashMismatchStream = [System.IO.File]::Open($hashMismatchInstaller, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  try {
    if ($hashMismatchStream.Length -le 8192) {
      throw "The signed fixture is too small for a safe in-file signature mutation."
    }
    $hashMismatchStream.Position = 4096
    $originalByte = $hashMismatchStream.ReadByte()
    if ($originalByte -lt 0) {
      throw "The signed fixture could not be read for signature mutation."
    }
    $hashMismatchStream.Position = 4096
    $hashMismatchStream.WriteByte([byte]($originalByte -bxor 1))
  } finally {
    $hashMismatchStream.Dispose()
  }
  $hashMismatchHash = Get-Sha256Hash $hashMismatchInstaller
  Set-Content -LiteralPath "$hashMismatchInstaller.sha256" -Value "$hashMismatchHash  $([System.IO.Path]::GetFileName($hashMismatchInstaller))" -Encoding ASCII
  $invalidSignatureStatus = (Get-AuthenticodeSignature -LiteralPath $hashMismatchInstaller).Status
  if ($invalidSignatureStatus -in @("Valid", "NotSigned")) {
    throw "The corrupted Authenticode fixture did not produce a deterministic invalid status; found $invalidSignatureStatus."
  }

  Invoke-ExpectedResult "commit-bound unsigned beta artifact" $current $true -RequireUnsigned -PublishedAppPath $current -ExpectedInformationalVersion $fixtureInformationalVersion -ExpectedCommitSha $fixtureCommit
  Invoke-ExpectedResult "wrong commit binding" $current $false -RequireUnsigned -PublishedAppPath $current -ExpectedInformationalVersion $fixtureInformationalVersion -ExpectedCommitSha $wrongFixtureCommit
  Invoke-ExpectedResult "directory installer path" $resolvedFixture $false
  Invoke-ExpectedResult "stale-version artifact" $stale $false
  Invoke-ExpectedResult "hash-mismatched artifact" $mismatch $false
  Invoke-ExpectedResult "mismatched published app identity" $current $false -PublishedAppPath $signedApp -ExpectedInformationalVersion "0.3.0-beta.1+fixture"
  Invoke-ExpectedResult "malformed published app version suffix" $current $false -PublishedAppPath $signedApp -ExpectedInformationalVersion $looseVersionPrefix -ExpectedProductName $signedProductName
  Invoke-ExpectedResult "invalid Authenticode signature in unsigned mode" $hashMismatchInstaller $false -RequireUnsigned
  Invoke-ExpectedResult "signed artifact in unsigned beta mode" $signedInstaller $false -RequireUnsigned
  Invoke-ExpectedResult "unsigned commercial artifact" $current $false -RequireSignature -AllowedSignerThumbprint $signedThumbprint
  Invoke-ExpectedResult "signed wrong-version app" $signedInstaller $false -RequireSignature -PublishedAppPath $signedApp -ExpectedInformationalVersion "0.3.0-beta.1+fixture" -ExpectedProductName $signedProductName -AllowedSignerThumbprint $signedThumbprint
  Invoke-ExpectedResult "signed commercial artifact" $signedInstaller $true -RequireSignature -PublishedAppPath $signedApp -ExpectedProductName $signedProductName -AllowedSignerThumbprint $signedThumbprint
  Invoke-ExpectedResult "unapproved valid signer" $signedInstaller $false -RequireSignature -PublishedAppPath $signedApp -ExpectedProductName $signedProductName -AllowedSignerThumbprint ("0" * 40)
} finally {
  if (Test-Path -LiteralPath $resolvedFixture) {
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
  }
}

Write-Host "checked release artifact verifier fixtures"
