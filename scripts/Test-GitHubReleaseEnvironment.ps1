param(
  [string]$Repository = $env:GITHUB_REPOSITORY,
  [string]$EnvironmentName = "beta-publication",
  [string]$EnvironmentJsonPath,
  [string]$SoloOwnerLogin
)

$ErrorActionPreference = "Stop"

function Get-EnvironmentJson {
  if (-not [string]::IsNullOrWhiteSpace($EnvironmentJsonPath)) {
    return Get-Content -LiteralPath $EnvironmentJsonPath -Raw -ErrorAction Stop
  }

  if ([string]::IsNullOrWhiteSpace($Repository) -or $Repository -notmatch '^[^/\s]+/[^/\s]+$') {
    throw "Repository must be supplied as owner/name when no environment fixture is provided."
  }
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI is required to verify the publication environment."
  }

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& gh api `
      -H "Accept: application/vnd.github+json" `
      -H "X-GitHub-Api-Version: 2022-11-28" `
      "repos/$Repository/environments/$EnvironmentName" 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "GitHub environment '$EnvironmentName' could not be read. It must exist and be protected before publication. $($output -join ' ')"
  }

  return ($output -join "`n")
}

$environmentJson = Get-EnvironmentJson
try {
  $environment = $environmentJson | ConvertFrom-Json -ErrorAction Stop
} catch {
  throw "GitHub environment response is not valid JSON. $($_.Exception.Message)"
}

if ($environment -isnot [System.Management.Automation.PSCustomObject]) {
  throw "GitHub environment response must be a JSON object."
}
if ($environment.name -isnot [string] -or [string]$environment.name -cne $EnvironmentName) {
  throw "GitHub environment response does not identify exact environment '$EnvironmentName'."
}
if ($environment.can_admins_bypass -isnot [bool] -or $environment.can_admins_bypass -ne $false) {
  throw "GitHub environment '$EnvironmentName' must disable administrator bypass."
}

$rules = @($environment.protection_rules)
$reviewerRules = @($rules | Where-Object { $_ -is [System.Management.Automation.PSCustomObject] -and [string]$_.type -ceq "required_reviewers" })
if ($reviewerRules.Count -ne 1) {
  throw "GitHub environment '$EnvironmentName' must have exactly one required-reviewers protection rule."
}

$reviewerRule = $reviewerRules[0]
if ($reviewerRule.prevent_self_review -isnot [bool]) {
  throw "GitHub environment '$EnvironmentName' prevent_self_review must be a JSON Boolean."
}
$soloOwnerMode = -not [string]::IsNullOrWhiteSpace($SoloOwnerLogin)
if ($soloOwnerMode) {
  if ($reviewerRule.prevent_self_review -ne $false) {
    throw "GitHub environment '$EnvironmentName' must allow self-review for explicitly selected solo-owner reviewer '$SoloOwnerLogin'."
  }
} elseif ($reviewerRule.prevent_self_review -ne $true) {
  throw "GitHub environment '$EnvironmentName' must prevent self-review unless an explicit solo owner is supplied."
}

$reviewers = @($reviewerRule.reviewers)
if ($reviewers.Count -lt 1 -or $reviewers.Count -gt 6) {
  throw "GitHub environment '$EnvironmentName' must name between one and six required reviewers."
}
foreach ($reviewer in $reviewers) {
  if ($reviewer -isnot [System.Management.Automation.PSCustomObject] -or
      ([string]$reviewer.type -cne "User" -and [string]$reviewer.type -cne "Team") -or
      $reviewer.reviewer -isnot [System.Management.Automation.PSCustomObject]) {
    throw "GitHub environment '$EnvironmentName' contains an invalid required reviewer."
  }
}

if ($soloOwnerMode) {
  $ownerReviewers = @($reviewers | Where-Object {
    $_.type -ceq "User" -and
    $_.reviewer.login -is [string] -and
    ([string]$_.reviewer.login).Equals($SoloOwnerLogin, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($ownerReviewers.Count -ne 1) {
    throw "GitHub environment '$EnvironmentName' must name solo owner '$SoloOwnerLogin' exactly once as a required User reviewer."
  }
  Write-Host "GitHub environment '$EnvironmentName' requires an explicit approval from solo owner '$SoloOwnerLogin' and disables administrator bypass."
  return
}

Write-Host "GitHub environment '$EnvironmentName' has required-reviewer protection with self-review disabled for $($reviewers.Count) reviewer(s)."
