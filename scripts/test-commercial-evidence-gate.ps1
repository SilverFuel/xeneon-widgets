$ErrorActionPreference = "Stop"

$gate = Join-Path $PSScriptRoot "assert-commercial-launch-evidence.ps1"
$templatePath = Join-Path $PSScriptRoot "..\docs\release\commercial-launch-evidence.example.json"
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("auxora-commercial-evidence-tests-" + [guid]::NewGuid().ToString("N"))
$resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")
if (-not $resolvedFixture.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Fixture path escaped the temporary directory."
}

function Invoke-Gate($evidencePath, $installerPath, $supportPath) {
  $arguments = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $gate,
    "-EvidencePath", $evidencePath,
    "-ExpectedVersion", "0.3.0",
    "-InstallerPath", $installerPath,
    "-SupportPagePath", $supportPath
  )
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & powershell @arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = $output -join " "
  }
}

try {
  New-Item -ItemType Directory -Path $resolvedFixture -Force | Out-Null
  $installerPath = Join-Path $resolvedFixture "Auxora-Setup-0.3.0-fixture.exe"
  [System.IO.File]::WriteAllBytes($installerPath, [System.Text.Encoding]::UTF8.GetBytes("commercial fixture"))
  $installerHash = Get-Sha256Hash $installerPath
  $supportPath = Join-Path $resolvedFixture "support.html"
  Set-Content -LiteralPath $supportPath -Value '<a href="mailto:support@commercial-fixture.dev">Support</a><a href="mailto:security@commercial-fixture.dev">Security</a>' -Encoding UTF8

  $incompletePath = Join-Path $resolvedFixture "incomplete.json"
  Copy-Item -LiteralPath $templatePath -Destination $incompletePath
  $incompleteResult = Invoke-Gate $incompletePath $installerPath $supportPath
  if ($incompleteResult.ExitCode -eq 0) {
    throw "Incomplete commercial evidence unexpectedly passed. Output: $($incompleteResult.Output)"
  }
  Write-Host "OK: incomplete evidence rejected"

  $complete = Get-Content -LiteralPath $templatePath -Raw | ConvertFrom-Json
  $complete.nameClearance.completed = $true; $complete.nameClearance.reference = "fixture-clearance"
  $complete.legalReview.completed = $true; $complete.legalReview.reference = "fixture-legal-review"
  $complete.support.completed = $true
  $complete.support.supportEmail = "support@commercial-fixture.dev"
  $complete.support.securityEmail = "security@commercial-fixture.dev"
  $complete.cleanMachineCertification.completed = $true; $complete.cleanMachineCertification.reportReference = "fixture-clean-machine"
  $complete.displayCertification.completed = $true; $complete.displayCertification.reportReference = "fixture-display"
  $complete.rollbackRelease.completed = $true; $complete.rollbackRelease.releaseReference = "fixture-rollback"
  $complete.paidPilot.completed = $true; $complete.paidPilot.participantCount = 10; $complete.paidPilot.reportReference = "fixture-pilot"
  $complete.releaseArtifact.completed = $true; $complete.releaseArtifact.installerSha256 = $installerHash
  $complete.confirmedAt = [DateTimeOffset]::UtcNow.ToString("O")
  $completePath = Join-Path $resolvedFixture "complete.json"
  $complete | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $completePath -Encoding UTF8

  $completeResult = Invoke-Gate $completePath $installerPath $supportPath
  if ($completeResult.ExitCode -ne 0) {
    throw "Complete matching commercial evidence did not pass. Output: $($completeResult.Output)"
  }
  Write-Host "OK: complete evidence accepted"

  $complete.releaseArtifact.installerSha256 = "0" * 64
  $badHashPath = Join-Path $resolvedFixture "bad-hash.json"
  $complete | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $badHashPath -Encoding UTF8
  $badHashResult = Invoke-Gate $badHashPath $installerPath $supportPath
  if ($badHashResult.ExitCode -eq 0) {
    throw "Hash-mismatched commercial evidence unexpectedly passed. Output: $($badHashResult.Output)"
  }
  Write-Host "OK: artifact mismatch rejected"

  $complete.releaseArtifact.installerSha256 = $installerHash
  $complete.support.supportEmail = "support@example.com"
  $complete.support.securityEmail = "security@example.org"
  $reservedEmailPath = Join-Path $resolvedFixture "reserved-email.json"
  $complete | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reservedEmailPath -Encoding UTF8
  $reservedEmailResult = Invoke-Gate $reservedEmailPath $installerPath $supportPath
  if ($reservedEmailResult.ExitCode -eq 0) {
    throw "Reserved example-domain support addresses unexpectedly passed. Output: $($reservedEmailResult.Output)"
  }
  Write-Host "OK: reserved support domains rejected"

  $complete.support.supportEmail = "support@commercial-fixture.dev"
  $complete.support.securityEmail = "security@commercial-fixture.dev"
  $complete.confirmedAt = [DateTimeOffset]::UtcNow.AddMinutes(10).ToString("O")
  $futureTimestampPath = Join-Path $resolvedFixture "future-timestamp.json"
  $complete | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $futureTimestampPath -Encoding UTF8
  $futureTimestampResult = Invoke-Gate $futureTimestampPath $installerPath $supportPath
  if ($futureTimestampResult.ExitCode -eq 0) {
    throw "Future-dated commercial evidence unexpectedly passed. Output: $($futureTimestampResult.Output)"
  }
  Write-Host "OK: future-dated evidence rejected"

  $complete.confirmedAt = [DateTimeOffset]::UtcNow.AddDays(-31).ToString("O")
  $staleTimestampPath = Join-Path $resolvedFixture "stale-timestamp.json"
  $complete | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $staleTimestampPath -Encoding UTF8
  $staleTimestampResult = Invoke-Gate $staleTimestampPath $installerPath $supportPath
  if ($staleTimestampResult.ExitCode -eq 0) {
    throw "Stale commercial evidence unexpectedly passed. Output: $($staleTimestampResult.Output)"
  }
  Write-Host "OK: stale commercial evidence rejected"

  $missingPathsResult = Invoke-Gate $completePath (Join-Path $resolvedFixture "missing-installer.exe") (Join-Path $resolvedFixture "missing-support.html")
  if ($missingPathsResult.ExitCode -eq 0 -or $missingPathsResult.Output -notmatch "Support page does not exist" -or $missingPathsResult.Output -notmatch "Installer does not exist") {
    throw "Missing commercial inputs were not reported cleanly. Output: $($missingPathsResult.Output)"
  }
  Write-Host "OK: missing commercial inputs reported cleanly"
} finally {
  if (Test-Path -LiteralPath $resolvedFixture) {
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
  }
}

Write-Host "checked commercial launch evidence gate fixtures"
