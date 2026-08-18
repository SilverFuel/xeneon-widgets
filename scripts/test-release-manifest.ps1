$ErrorActionPreference = "Stop"
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("auxora-release-manifest-tests-" + [guid]::NewGuid().ToString("N"))
$generator = Join-Path $PSScriptRoot "New-ReleaseManifest.ps1"
$verifier = Join-Path $PSScriptRoot "Test-ReleaseManifest.ps1"
$receiptVerifier = Join-Path $PSScriptRoot "Test-BetaLifecycleReceipt.ps1"
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")

function Invoke-ExpectedResult($label, [scriptblock]$command, [bool]$shouldPass) {
  $passed = $true
  try { & $command | Out-Null } catch { $passed = $false }
  if ($passed -ne $shouldPass) { throw "$label expected pass=$shouldPass but pass=$passed." }
  Write-Host "OK: $label"
}

try {
  New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
  $installer = Join-Path $fixtureRoot "Auxora-Setup-0.3.0-beta.1-fixture.exe"
  Set-Content -LiteralPath $installer -Value "fixture installer" -Encoding ASCII
  $hash = Get-Sha256Hash $installer
  Set-Content -LiteralPath "$installer.sha256" -Value "$hash  $([IO.Path]::GetFileName($installer))" -Encoding ASCII
  $installNotes = Join-Path $fixtureRoot "WINDOWS-INSTALL-UNINSTALL.md"
  $releaseNotes = Join-Path $fixtureRoot "FREE-BETA-RELEASE-NOTES.md"
  Set-Content -LiteralPath $installNotes -Value "install notes" -Encoding ASCII
  Set-Content -LiteralPath $releaseNotes -Value "release notes" -Encoding ASCII
  $manifestPath = Join-Path $fixtureRoot "release-manifest.json"
  $sha = "a" * 40
  & $generator -InstallerPath $installer -Tag "v0.3.0-beta.1" -Version "0.3.0-beta.1" -CommitSha $sha -InstallNotesPath $installNotes -ReleaseNotesPath $releaseNotes -OutputPath $manifestPath | Out-Null

  Invoke-ExpectedResult "valid exact manifest" { & $verifier -ReleaseAssetsPath $fixtureRoot -ExpectedTag "v0.3.0-beta.1" -ExpectedCommitSha $sha } $true
  $extra = Join-Path $fixtureRoot "unexpected.txt"
  Set-Content -LiteralPath $extra -Value "unexpected" -Encoding ASCII
  Invoke-ExpectedResult "extra asset rejected" { & $verifier -ReleaseAssetsPath $fixtureRoot -ExpectedTag "v0.3.0-beta.1" -ExpectedCommitSha $sha } $false
  Remove-Item -LiteralPath $extra

  $receiptPath = Join-Path $fixtureRoot "lifecycle-receipt.json"
  $receipt = [ordered]@{
    schemaVersion = 3; tag = "v0.3.0-beta.1"; version = "0.3.0-beta.1"; commitSha = $sha
    installerFileName = [IO.Path]::GetFileName($installer); installerSha256 = $hash
    environment = [ordered]@{ disposableWindowsVm = $true; windowsVersion = "fixture" }
    operator = "fixture"; completedAt = "2026-07-16T00:00:00Z"
    checks = [ordered]@{ install=$true; staysClosedAfterInstall=$true; launch=$true; health=$true; processRestart=$true; noAutoStartAfterReboot=$true; rollbackAfterInjectedFailure=$true; upgradeFromPreviousBeta=$true; repair=$true; normalUninstall=$true; removeAllData=$true }
  }
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "matching lifecycle receipt" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $fixtureRoot } $true

  $receipt.schemaVersion = 2
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "obsolete lifecycle receipt schema rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $fixtureRoot } $false
  $receipt.schemaVersion = 3

  $receipt.checks["autoStartAfterReboot"] = $true
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "legacy lifecycle check rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $fixtureRoot } $false
  $receipt.checks.Remove("autoStartAfterReboot")

  $receipt.checks.rollbackAfterInjectedFailure = $false
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "missing failed-upgrade rollback evidence rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $fixtureRoot } $false
  $receipt.checks.rollbackAfterInjectedFailure = $true

  $receipt.checks.health = $false
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Invoke-ExpectedResult "incomplete lifecycle receipt rejected" { & $receiptVerifier -ReceiptPath $receiptPath -ReleaseAssetsPath $fixtureRoot } $false
} finally {
  if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}

Write-Host "checked immutable release manifest and lifecycle receipt fixtures"
