$ErrorActionPreference = "Stop"
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("auxora-release-manifest-tests-" + [guid]::NewGuid().ToString("N"))
$releaseAssetsRoot = Join-Path $fixtureRoot "release-assets"
$generator = Join-Path $PSScriptRoot "New-ReleaseManifest.ps1"
$verifier = Join-Path $PSScriptRoot "Test-ReleaseManifest.ps1"
$receiptVerifier = Join-Path $PSScriptRoot "Test-BetaLifecycleReceipt.ps1"
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")

function Invoke-ExpectedResult($label, [scriptblock]$command, [bool]$shouldPass) {
  $passed = $true
  $failureMessage = ""
  try { & $command | Out-Null } catch { $passed = $false; $failureMessage = $_.Exception.Message }
  if ($passed -ne $shouldPass) { throw "$label expected pass=$shouldPass but pass=$passed. $failureMessage" }
  Write-Host "OK: $label"
}

function Write-UnsignedExecutableFixture($path, [string]$productVersion) {
  $sourcePath = Join-Path $fixtureRoot "manifest-app-fixture.cs"
  $compilerPath = Join-Path $fixtureRoot "compile-manifest-app-fixture.ps1"
  $escapedProductVersion = $productVersion.Replace("\", "\\").Replace('"', '\"')
  @"
using System.Reflection;
[assembly: AssemblyProduct("Auxora")]
[assembly: AssemblyVersion("0.3.0.0")]
[assembly: AssemblyFileVersion("0.3.0.0")]
[assembly: AssemblyInformationalVersion("$escapedProductVersion")]
namespace AuxoraManifestFixture {
  public static class Program { public static void Main() { } }
}
"@ | Set-Content -LiteralPath $sourcePath -Encoding UTF8
  @'
param([string]$SourcePath, [string]$OutputPath)
$ErrorActionPreference = "Stop"
Add-Type -Path $SourcePath -OutputAssembly $OutputPath -OutputType ConsoleApplication
'@ | Set-Content -LiteralPath $compilerPath -Encoding UTF8

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $compilerPath -SourcePath $sourcePath -OutputPath $path
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Could not compile the manifest executable fixture."
  }
  return $path
}

try {
  New-Item -ItemType Directory -Path $releaseAssetsRoot -Force | Out-Null
  $sha = "a" * 40
  $publishedAppRoot = Join-Path $fixtureRoot "published-app"
  New-Item -ItemType Directory -Path $publishedAppRoot -Force | Out-Null
  $publishedApp = Write-UnsignedExecutableFixture (Join-Path $publishedAppRoot "XenonEdgeHost.exe") "0.3.0-beta.1+fixture.$sha"
  $installer = Join-Path $releaseAssetsRoot "Auxora-Setup-0.3.0-beta.1-fixture.exe"
  Set-Content -LiteralPath $installer -Value "fixture installer" -Encoding ASCII
  $hash = Get-Sha256Hash $installer
  Set-Content -LiteralPath "$installer.sha256" -Value "$hash  $([IO.Path]::GetFileName($installer))" -Encoding ASCII
  $installNotes = Join-Path $releaseAssetsRoot "WINDOWS-INSTALL-UNINSTALL.md"
  $releaseNotes = Join-Path $releaseAssetsRoot "FREE-BETA-RELEASE-NOTES.md"
  Set-Content -LiteralPath $installNotes -Value "install notes" -Encoding ASCII
  Set-Content -LiteralPath $releaseNotes -Value "release notes" -Encoding ASCII
  $manifestPath = Join-Path $releaseAssetsRoot "release-manifest.json"
  & $generator -InstallerPath $installer -Tag "v0.3.0-beta.1" -Version "0.3.0-beta.1" -CommitSha $sha -PublishedAppPath $publishedApp -InstallNotesPath $installNotes -ReleaseNotesPath $releaseNotes -OutputPath $manifestPath | Out-Null

  Invoke-ExpectedResult "valid exact manifest" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot -ExpectedTag "v0.3.0-beta.1" -ExpectedCommitSha $sha -PublishedAppPath $publishedApp } $true

  $manifestFixture = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $manifestFixture.schemaVersion = "2"
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Invoke-ExpectedResult "string manifest schema rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot -ExpectedTag "v0.3.0-beta.1" -ExpectedCommitSha $sha } $false
  $manifestFixture.schemaVersion = $true
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Invoke-ExpectedResult "Boolean manifest schema rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot -ExpectedTag "v0.3.0-beta.1" -ExpectedCommitSha $sha } $false
  $manifestFixture.schemaVersion = 2
  $manifestFractionJson = $manifestFixture | ConvertTo-Json -Depth 6
  $manifestFractionJson = [regex]::Replace($manifestFractionJson, '"schemaVersion"\s*:\s*2(?=\s*[,}])', '"schemaVersion": 2.0', 1)
  Set-Content -LiteralPath $manifestPath -Value $manifestFractionJson -Encoding UTF8
  Invoke-ExpectedResult "fractional-form manifest schema rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot -ExpectedTag "v0.3.0-beta.1" -ExpectedCommitSha $sha } $false
  $manifestFixture.schemaVersion = 2
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

  $manifestFixture | Add-Member -NotePropertyName "unexpectedRootField" -NotePropertyValue "unexpected"
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Invoke-ExpectedResult "extra manifest root property rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot } $false
  $manifestFixture.PSObject.Properties.Remove("unexpectedRootField")

  $signatureStatus = $manifestFixture.installer.signatureStatus
  $manifestFixture.installer.PSObject.Properties.Remove("signatureStatus")
  $manifestFixture.installer | Add-Member -NotePropertyName "SignatureStatus" -NotePropertyValue $signatureStatus
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Invoke-ExpectedResult "mis-cased installer property rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot } $false
  $manifestFixture.installer.PSObject.Properties.Remove("SignatureStatus")
  $manifestFixture.installer | Add-Member -NotePropertyName "signatureStatus" -NotePropertyValue $signatureStatus

  $installedHash = $manifestFixture.installedExecutable.sha256
  $manifestFixture.installedExecutable.PSObject.Properties.Remove("sha256")
  $manifestFixture.installedExecutable | Add-Member -NotePropertyName "Sha256" -NotePropertyValue $installedHash
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Invoke-ExpectedResult "mis-cased installed executable property rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot } $false
  $manifestFixture.installedExecutable.PSObject.Properties.Remove("Sha256")
  $manifestFixture.installedExecutable | Add-Member -NotePropertyName "sha256" -NotePropertyValue $installedHash

  $manifestFixture.installedExecutable | Add-Member -NotePropertyName "unexpectedField" -NotePropertyValue "unexpected"
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Invoke-ExpectedResult "extra installed executable property rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot } $false
  $manifestFixture.installedExecutable.PSObject.Properties.Remove("unexpectedField")

  $manifestFixture.installedExecutable.sha256 = "0" * 64
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Invoke-ExpectedResult "wrong installed executable hash rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot -PublishedAppPath $publishedApp } $false
  $manifestFixture.installedExecutable.sha256 = $installedHash

  $installedProductVersion = $manifestFixture.installedExecutable.productVersion
  $manifestFixture.installedExecutable.productVersion = "0.3.0-beta.1+fixture.$('b' * 40)"
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Invoke-ExpectedResult "wrong installed executable commit binding rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot } $false
  $manifestFixture.installedExecutable.productVersion = $installedProductVersion

  $manifestFixture.installedExecutable.productName = "Not Auxora"
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Invoke-ExpectedResult "wrong installed executable product rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot } $false
  $manifestFixture.installedExecutable.productName = "Auxora"
  $manifestFixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

  $mismatchedAppRoot = Join-Path $fixtureRoot "mismatched-app"
  New-Item -ItemType Directory -Path $mismatchedAppRoot -Force | Out-Null
  $mismatchedApp = Join-Path $mismatchedAppRoot "XenonEdgeHost.exe"
  Copy-Item -LiteralPath $publishedApp -Destination $mismatchedApp
  $mismatchStream = [System.IO.File]::Open($mismatchedApp, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try { $mismatchStream.WriteByte(0) } finally { $mismatchStream.Dispose() }
  Invoke-ExpectedResult "different published executable bytes rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot -PublishedAppPath $mismatchedApp } $false

  $wrongCommitManifest = Join-Path $fixtureRoot "wrong-commit-manifest.json"
  Invoke-ExpectedResult "generator rejects app from another commit" {
    & $generator -InstallerPath $installer -Tag "v0.3.0-beta.1" -Version "0.3.0-beta.1" -CommitSha ("b" * 40) -PublishedAppPath $publishedApp -InstallNotesPath $installNotes -ReleaseNotesPath $releaseNotes -OutputPath $wrongCommitManifest
  } $false

  $extra = Join-Path $releaseAssetsRoot "unexpected.txt"
  Set-Content -LiteralPath $extra -Value "unexpected" -Encoding ASCII
  Invoke-ExpectedResult "extra asset rejected" { & $verifier -ReleaseAssetsPath $releaseAssetsRoot -ExpectedTag "v0.3.0-beta.1" -ExpectedCommitSha $sha } $false
  Remove-Item -LiteralPath $extra

  $receiptPath = Join-Path $fixtureRoot "lifecycle-receipt.json"
  $receiptCompletedAt = [DateTimeOffset]::UtcNow
  $receipt = [ordered]@{
    schemaVersion = 3; tag = "v0.3.0-beta.1"; version = "0.3.0-beta.1"; commitSha = $sha
    installerFileName = [IO.Path]::GetFileName($installer); installerSha256 = $hash
    environment = [ordered]@{ disposableWindowsVm = $true; windowsVersion = "fixture" }
    operator = "fixture"; completedAt = $receiptCompletedAt.ToString("O")
    checks = [ordered]@{ install=$true; staysClosedAfterInstall=$true; launch=$true; health=$true; processRestart=$true; noAutoStartAfterReboot=$true; rollbackAfterInjectedFailure=$true; upgradeFromPreviousBeta=$true; repair=$true; normalUninstall=$true; removeAllData=$true }
  }
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "matching lifecycle receipt" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $true

  $receipt["unexpectedRootField"] = "unexpected"
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "extra lifecycle root property rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.Remove("unexpectedRootField")

  $receipt.environment["unexpectedEnvironmentField"] = "unexpected"
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "extra lifecycle environment property rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.environment.Remove("unexpectedEnvironmentField")

  $environment = $receipt.environment
  $receipt.Remove("environment")
  $receipt["Environment"] = $environment
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "mis-cased lifecycle root property rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.Remove("Environment")
  $receipt["environment"] = $environment

  $windowsVersion = $receipt.environment.windowsVersion
  $receipt.environment.Remove("windowsVersion")
  $receipt.environment["WindowsVersion"] = $windowsVersion
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "mis-cased lifecycle environment property rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.environment.Remove("WindowsVersion")
  $receipt.environment["windowsVersion"] = $windowsVersion

  $receipt.schemaVersion = 2
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "obsolete lifecycle receipt schema rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.schemaVersion = 3

  $receipt.schemaVersion = "3"
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "string lifecycle schema rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.schemaVersion = 3

  $receipt.schemaVersion = 3
  $receiptFractionJson = $receipt | ConvertTo-Json -Depth 5
  $receiptFractionJson = [regex]::Replace($receiptFractionJson, '"schemaVersion"\s*:\s*3(?=\s*[,}])', '"schemaVersion": 3.0', 1)
  Set-Content -LiteralPath $receiptPath -Value $receiptFractionJson -Encoding UTF8
  Invoke-ExpectedResult "fractional-form lifecycle schema rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.schemaVersion = 3

  $receipt.environment.disposableWindowsVm = "true"
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "string VM evidence rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.environment.disposableWindowsVm = $true

  $receipt.checks["autoStartAfterReboot"] = $true
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "legacy lifecycle check rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.checks.Remove("autoStartAfterReboot")

  $receipt.checks.rollbackAfterInjectedFailure = $false
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "missing failed-upgrade rollback evidence rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.checks.rollbackAfterInjectedFailure = $true

  $receipt.checks.health = $false
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "incomplete lifecycle receipt rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.checks.health = "true"
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "string lifecycle check rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
  $receipt.checks.health = $true

  $receipt.completedAt = $receiptCompletedAt.AddHours(1).ToString("O")
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "future lifecycle receipt rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false

  $receipt.completedAt = $receiptCompletedAt.AddDays(-31).ToString("O")
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "stale lifecycle receipt rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false

  $receipt.completedAt = $receiptCompletedAt.ToOffset([TimeSpan]::FromHours(-4)).ToString("O")
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "non-UTC lifecycle receipt rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false

  $receipt.completedAt = $receiptCompletedAt.ToString("O") + "`n"
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "newline lifecycle timestamp rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false

  $receipt.completedAt = $receiptCompletedAt.ToString("O")
  $receipt.checks.Remove("health")
  $receipt.checks["Health"] = $true
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "mis-cased lifecycle check rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $releaseAssetsRoot } $false
} finally {
  if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}

Write-Host "checked immutable release manifest and lifecycle receipt fixtures"
