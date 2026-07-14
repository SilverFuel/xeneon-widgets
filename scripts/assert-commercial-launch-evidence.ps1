param(
  [Parameter(Mandatory = $true)]
  [string]$EvidencePath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,

  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$SupportPagePath
)

$ErrorActionPreference = "Stop"
$failures = New-Object System.Collections.Generic.List[string]
. (Join-Path $PSScriptRoot "lib\Hashing.ps1")

function Require-Completed($section, $name, $referenceProperty) {
  if (-not $section -or $section.completed -ne $true) {
    $script:failures.Add("$name is not completed.") | Out-Null
    return
  }
  if ($referenceProperty -and [string]::IsNullOrWhiteSpace([string]$section.$referenceProperty)) {
    $script:failures.Add("$name needs a non-empty $referenceProperty reference.") | Out-Null
  }
}

try {
  $resolvedEvidence = (Resolve-Path -LiteralPath $EvidencePath).Path
  $evidence = Get-Content -LiteralPath $resolvedEvidence -Raw | ConvertFrom-Json
} catch {
  Write-Error "Commercial evidence could not be read: $($_.Exception.Message)"
  exit 1
}

$resolvedSupportPage = ""
try {
  $resolvedSupportPage = (Resolve-Path -LiteralPath $SupportPagePath -ErrorAction Stop).Path
} catch {
  $failures.Add("Support page does not exist or cannot be resolved: $SupportPagePath") | Out-Null
}

$resolvedInstaller = ""
try {
  $resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath -ErrorAction Stop).Path
} catch {
  $failures.Add("Installer does not exist or cannot be resolved: $InstallerPath") | Out-Null
}

if ($evidence.schemaVersion -ne 1) { $failures.Add("schemaVersion must be 1.") | Out-Null }
if ($evidence.product -ne "Auxora") { $failures.Add("product must be Auxora.") | Out-Null }
if ($evidence.version -ne $ExpectedVersion) { $failures.Add("evidence version must match $ExpectedVersion.") | Out-Null }

Require-Completed $evidence.nameClearance "Name clearance" "reference"
Require-Completed $evidence.legalReview "Legal review" "reference"
Require-Completed $evidence.cleanMachineCertification "Clean-machine certification" "reportReference"
Require-Completed $evidence.displayCertification "Display certification" "reportReference"
Require-Completed $evidence.rollbackRelease "Rollback release" "releaseReference"
Require-Completed $evidence.paidPilot "Paid pilot" "reportReference"
Require-Completed $evidence.releaseArtifact "Release artifact" $null

$emailPattern = '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
$supportEmail = [string]$evidence.support.supportEmail
$securityEmail = [string]$evidence.support.securityEmail
if ($evidence.support.completed -ne $true) {
  $failures.Add("Support readiness is not completed.") | Out-Null
} elseif ($supportEmail -notmatch $emailPattern -or $securityEmail -notmatch $emailPattern) {
  $failures.Add("Support and security email addresses must both be valid.") | Out-Null
} elseif ($supportEmail -eq $securityEmail) {
  $failures.Add("Support and security email addresses must be distinct monitored roles.") | Out-Null
} elseif ($supportEmail -match '@(?:[^@\s]+\.)*(?:example\.com|example\.net|example\.org|example|invalid|localhost|test)$' -or $securityEmail -match '@(?:[^@\s]+\.)*(?:example\.com|example\.net|example\.org|example|invalid|localhost|test)$') {
  $failures.Add("Reserved email domains cannot satisfy commercial support readiness.") | Out-Null
} elseif ($resolvedSupportPage) {
  $supportPage = Get-Content -LiteralPath $resolvedSupportPage -Raw
  if ($supportPage -notmatch [regex]::Escape("mailto:$supportEmail") -or $supportPage -notmatch [regex]::Escape("mailto:$securityEmail")) {
    $failures.Add("Packaged support page must publish both evidence-approved role inboxes.") | Out-Null
  }
}

$participantCount = 0
if (-not [int]::TryParse([string]$evidence.paidPilot.participantCount, [ref]$participantCount) -or $participantCount -lt 10) {
  $failures.Add("Paid pilot must include at least 10 participants.") | Out-Null
}

$rawAllowedSignerThumbprints = $evidence.releaseArtifact.allowedSignerThumbprints
if (-not ($rawAllowedSignerThumbprints -is [System.Array])) {
  $failures.Add("releaseArtifact.allowedSignerThumbprints must be a JSON array.") | Out-Null
  $allowedSignerThumbprints = @()
} else {
  $allowedSignerThumbprints = @($rawAllowedSignerThumbprints)
}
if ($rawAllowedSignerThumbprints -is [System.Array] -and $allowedSignerThumbprints.Count -eq 0) {
  $failures.Add("Release artifact evidence must list at least one approved Auxora signer thumbprint.") | Out-Null
} else {
  foreach ($thumbprint in $allowedSignerThumbprints) {
    if (([string]$thumbprint -replace '\s', '') -notmatch '^[0-9A-Fa-f]{40}$') {
      $failures.Add("Approved signer thumbprints must contain exactly 40 hexadecimal characters.") | Out-Null
      break
    }
  }
}

$confirmedAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse([string]$evidence.confirmedAt, [ref]$confirmedAt)) {
  $failures.Add("confirmedAt must be a valid timestamp.") | Out-Null
} elseif ($confirmedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
  $failures.Add("confirmedAt cannot be more than five minutes in the future.") | Out-Null
} elseif ($confirmedAt -lt [DateTimeOffset]::UtcNow.AddDays(-30)) {
  $failures.Add("confirmedAt must be within the past 30 days.") | Out-Null
}

$evidenceHash = [string]$evidence.releaseArtifact.installerSha256
if ($resolvedInstaller) {
  $actualHash = Get-Sha256Hash $resolvedInstaller
}
if (-not $resolvedInstaller -or $evidenceHash -notmatch '^[0-9A-Fa-f]{64}$' -or -not $evidenceHash.Equals($actualHash, [System.StringComparison]::OrdinalIgnoreCase)) {
  $failures.Add("Commercial evidence installerSha256 must match the exact release artifact.") | Out-Null
}

if ($failures.Count -gt 0) {
  foreach ($failure in $failures) {
    Write-Error $failure -ErrorAction Continue
  }
  Write-Host "Commercial launch evidence failed with $($failures.Count) blocker(s)." -ForegroundColor Red
  exit 1
}

Write-Host "Commercial launch evidence verified for Auxora $ExpectedVersion." -ForegroundColor Green
