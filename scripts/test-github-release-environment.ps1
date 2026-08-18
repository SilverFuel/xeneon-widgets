$ErrorActionPreference = "Stop"
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("auxora-release-environment-tests-" + [guid]::NewGuid().ToString("N"))
$verifier = Join-Path $PSScriptRoot "Test-GitHubReleaseEnvironment.ps1"
$fixturePath = Join-Path $fixtureRoot "environment.json"

function Invoke-ExpectedResult($label, $fixture, [bool]$shouldPass) {
  $fixture | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $fixturePath -Encoding UTF8
  $passed = $true
  $failureMessage = ""
  try {
    & $verifier -EnvironmentName "beta-publication" -EnvironmentJsonPath $fixturePath | Out-Null
  } catch {
    $passed = $false
    $failureMessage = $_.Exception.Message
  }
  if ($passed -ne $shouldPass) {
    throw "$label expected pass=$shouldPass but pass=$passed. $failureMessage"
  }
  Write-Host "OK: $label"
}

function New-ValidEnvironmentFixture {
  return [ordered]@{
    name = "beta-publication"
    protection_rules = @(
      [ordered]@{
        type = "required_reviewers"
        prevent_self_review = $true
        reviewers = @(
          [ordered]@{
            type = "User"
            reviewer = [ordered]@{ login = "release-reviewer"; id = 123 }
          }
        )
      }
    )
  }
}

try {
  New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null

  Invoke-ExpectedResult "protected environment" (New-ValidEnvironmentFixture) $true

  $fixture = New-ValidEnvironmentFixture
  $fixture.protection_rules = @()
  Invoke-ExpectedResult "missing reviewer rule rejected" $fixture $false

  $fixture = New-ValidEnvironmentFixture
  $fixture.protection_rules[0].prevent_self_review = $false
  Invoke-ExpectedResult "self-review allowed rejected" $fixture $false

  $fixture = New-ValidEnvironmentFixture
  $fixture.protection_rules[0].prevent_self_review = "true"
  Invoke-ExpectedResult "string self-review evidence rejected" $fixture $false

  $fixture = New-ValidEnvironmentFixture
  $fixture.protection_rules[0].reviewers = @()
  Invoke-ExpectedResult "missing reviewer rejected" $fixture $false

  $fixture = New-ValidEnvironmentFixture
  $fixture.protection_rules[0].reviewers[0].type = "user"
  Invoke-ExpectedResult "mis-cased reviewer type rejected" $fixture $false

  $fixture = New-ValidEnvironmentFixture
  $fixture.name = "production"
  Invoke-ExpectedResult "wrong environment rejected" $fixture $false
} finally {
  if (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}

Write-Host "checked protected GitHub publication environment fixtures"
