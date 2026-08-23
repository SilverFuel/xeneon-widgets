param(
  [string]$InstallerPath = "",
  [switch]$RunInstallSmoke,
  [switch]$RunUninstall,
  [switch]$RemoveLocalData,
  [switch]$RequireSignedInstaller,
  [switch]$AllowUnsignedBeta,
  [switch]$AllowGitHubSupportPath,
  [string]$CommercialEvidencePath = "",
  [string]$ReleaseAssetsPath = "",
  [string]$LifecycleReceiptPath = "",
  [string]$FrigateQualificationReceiptPath = "",
  [string]$DisplayQualificationReceiptPath = ""
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSEdition -eq "Desktop") {
  Import-Module (Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1") -Force
}

if ($RequireSignedInstaller -and $AllowUnsignedBeta) {
  throw "Cannot specify both -RequireSignedInstaller and -AllowUnsignedBeta."
}
if (-not $RequireSignedInstaller -and -not $AllowUnsignedBeta) {
  throw "Specify exactly one release mode: -RequireSignedInstaller or -AllowUnsignedBeta."
}
if ($RequireSignedInstaller -and [string]::IsNullOrWhiteSpace($CommercialEvidencePath)) {
  throw "Signed commercial releases require -CommercialEvidencePath with completed launch evidence."
}
if (-not [string]::IsNullOrWhiteSpace($CommercialEvidencePath) -and -not $RequireSignedInstaller) {
  throw "Commercial evidence can only be used with -RequireSignedInstaller."
}
$receiptEvidencePaths = @($LifecycleReceiptPath, $FrigateQualificationReceiptPath, $DisplayQualificationReceiptPath) |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if ($receiptEvidencePaths.Count -ne 0 -and $receiptEvidencePaths.Count -ne 3) {
  throw "LifecycleReceiptPath, FrigateQualificationReceiptPath, and DisplayQualificationReceiptPath must be supplied together."
}
if ($receiptEvidencePaths.Count -eq 3 -and [string]::IsNullOrWhiteSpace($ReleaseAssetsPath)) {
  throw "ReleaseAssetsPath is required with qualification receipts."
}
if ($RunInstallSmoke -and [string]::IsNullOrWhiteSpace($ReleaseAssetsPath)) {
  throw "RunInstallSmoke requires ReleaseAssetsPath so the installed executable is checked against the exact candidate manifest."
}

$allowedSignerThumbprints = @()
$resolvedCommercialEvidencePath = ""
if ($RequireSignedInstaller) {
  try {
    $resolvedCommercialEvidencePath = (Resolve-Path -LiteralPath $CommercialEvidencePath -ErrorAction Stop).Path
    $commercialEvidence = Get-Content -LiteralPath $resolvedCommercialEvidencePath -Raw | ConvertFrom-Json
    $allowedSignerThumbprints = @($commercialEvidence.releaseArtifact.allowedSignerThumbprints)
  } catch {
    throw "Commercial evidence could not be read before signature verification: $($_.Exception.Message)"
  }
  if ($allowedSignerThumbprints.Count -eq 0) {
    throw "Commercial evidence must provide at least one approved Auxora signer thumbprint."
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

function Invoke-CheckedCommand($command, $arguments, $failureMessage) {
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$failureMessage Exit code: $LASTEXITCODE"
  }
}

function Resolve-LatestInstaller {
  if (-not [string]::IsNullOrWhiteSpace($InstallerPath)) {
    return (Resolve-Path -LiteralPath $InstallerPath).Path
  }

  $localInstallers = @(Get-ChildItem (Join-Path $repoRoot "app\dist") -Filter "Auxora-Setup-*.exe" -File -ErrorAction SilentlyContinue)
  if ($localInstallers.Count -ne 1) {
    throw "Pass -InstallerPath for the exact candidate. Automatic selection is allowed only when app\dist contains exactly one installer; found $($localInstallers.Count)."
  }

  return $localInstallers[0].FullName
}

Push-Location $repoRoot
try {
  $resolvedInstaller = Resolve-LatestInstaller
  $hashPath = "$resolvedInstaller.sha256"

  Write-Step "Auditing dependencies"
  Invoke-CheckedCommand "npm" @("run", "audit:deps") "Dependency audit failed."

  Write-Step "Running repository checks"
  Invoke-CheckedCommand "npm" @("run", "check") "Repository checks failed."

  Write-Step "Checking release artifact"
  if (-not (Test-Path -LiteralPath $resolvedInstaller)) {
    throw "Installer does not exist: $resolvedInstaller"
  }
  if (-not (Test-Path -LiteralPath $hashPath)) {
    throw "Installer SHA256 file is missing: $hashPath"
  }

  try {
    $signature = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller -ErrorAction Stop
  } catch {
    throw "Installer signature could not be checked and cannot be treated as unsigned: $($_.Exception.Message)"
  }
  if ($signature.Status -eq "Valid") {
    if ($RequireSignedInstaller) {
      $actualThumbprint = ([string]$signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
      $approved = @($allowedSignerThumbprints | ForEach-Object { ([string]$_ -replace '\s', '').ToUpperInvariant() })
      if ($actualThumbprint -notin $approved) {
        throw "Installer signer is not in the approved Auxora signer list: $actualThumbprint"
      }
    }
    Write-Host "OK: Installer signature is valid"
  } elseif ($RequireSignedInstaller) {
    throw "Installer signature is required but is $($signature.Status)."
  } elseif ($AllowUnsignedBeta -and $signature.Status -eq "NotSigned") {
    Write-Warning "Installer is unsigned (NotSigned); allowed for free beta only."
  } elseif ($AllowUnsignedBeta) {
    throw "Installer has invalid Authenticode status $($signature.Status) and cannot be treated as an unsigned beta."
  } else {
    throw "Installer is not signed ($($signature.Status)). Pass -AllowUnsignedBeta only for an artifact whose status is exactly NotSigned, or sign the artifact."
  }

  Write-Step "Running release readiness gate"
  $readyArgs = @("-InstallerPath", $resolvedInstaller)
  if ($AllowGitHubSupportPath) {
    $readyArgs += "-AllowGitHubSupportPath"
  }
  if ($AllowUnsignedBeta) {
    $readyArgs += @("-AllowBetaVersion", "-RequireUnsignedInstaller")
  }
  if ($RequireSignedInstaller) {
    $readyArgs += "-RequireSignedInstaller"
    $readyArgs += @("-AllowedSignerThumbprint") + $allowedSignerThumbprints
  }
  Invoke-CheckedCommand "powershell" (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\assert-release-ready.ps1") + $readyArgs) "Release readiness gate failed."

  if (-not [string]::IsNullOrWhiteSpace($ReleaseAssetsPath)) {
    Write-Step "Checking immutable release manifest"
    $resolvedAssetsRoot = (Resolve-Path -LiteralPath $ReleaseAssetsPath -ErrorAction Stop).Path
    $candidateManifest = Get-Content -LiteralPath (Join-Path $resolvedAssetsRoot "release-manifest.json") -Raw | ConvertFrom-Json
    $manifestInstallerPath = (Resolve-Path -LiteralPath (Join-Path $resolvedAssetsRoot ([string]$candidateManifest.installer.fileName)) -ErrorAction Stop).Path
    if (-not $manifestInstallerPath.Equals($resolvedInstaller, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "InstallerPath must be the exact installer named by the release manifest."
    }
    $currentCommit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $currentCommit -notmatch '^[0-9a-f]{40}$') {
      throw "Receipt-bound verification requires a valid current Git commit."
    }
    [xml]$project = Get-Content -LiteralPath (Join-Path $repoRoot "app\XenonEdgeHost.csproj")
    $expectedTag = "v$([string]$project.Project.PropertyGroup.Version)"
    Invoke-CheckedCommand "powershell" @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\Test-ReleaseManifest.ps1",
      "-ReleaseAssetsPath", $ReleaseAssetsPath,
      "-ExpectedTag", $expectedTag,
      "-ExpectedCommitSha", $currentCommit
    ) "Release manifest verification failed."
    if ($receiptEvidencePaths.Count -eq 3) {
      Write-Step "Checking lifecycle, Frigate, and display qualification receipts"
      Invoke-CheckedCommand "powershell" @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\Test-BetaLifecycleReceipt.ps1",
        "-ReceiptPath", $LifecycleReceiptPath,
        "-ReleaseAssetsPath", $ReleaseAssetsPath
      ) "Lifecycle receipt verification failed."
      Invoke-CheckedCommand "powershell" @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\Test-FrigateQualificationReceipt.ps1",
        "-ReceiptPath", $FrigateQualificationReceiptPath,
        "-ReleaseAssetsPath", $ReleaseAssetsPath
      ) "Frigate qualification receipt verification failed."
      Invoke-CheckedCommand "powershell" @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\Test-DisplayQualificationReceipt.ps1",
        "-ReceiptPath", $DisplayQualificationReceiptPath,
        "-ReleaseAssetsPath", $ReleaseAssetsPath
      ) "Display qualification receipt verification failed."
    }
  }

  if ($RequireSignedInstaller) {
    [xml]$project = Get-Content (Join-Path $repoRoot "app\XenonEdgeHost.csproj")
    $version = [string]$project.Project.PropertyGroup.Version
    Write-Step "Checking commercial launch evidence"
    Invoke-CheckedCommand "powershell" @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\assert-commercial-launch-evidence.ps1",
      "-EvidencePath", $resolvedCommercialEvidencePath,
      "-ExpectedVersion", $version,
      "-InstallerPath", $resolvedInstaller,
      "-SupportPagePath", (Join-Path $repoRoot "support.html")
    ) "Commercial launch evidence failed."
  }

  if ($RunInstallSmoke) {
    Write-Step "Running Windows install smoke test"
    $smokeArgs = @(
      "-InstallerPath", $resolvedInstaller,
      "-ReleaseAssetsPath", $ReleaseAssetsPath,
      "-RunInstall", "-QuietInstall"
    )
    if ($RunUninstall) {
      $smokeArgs += "-RunUninstall"
    }
    if ($RemoveLocalData) {
      $smokeArgs += "-RemoveLocalData"
    }
    Invoke-CheckedCommand "powershell" (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\test-windows-install.ps1") + $smokeArgs) "Windows install smoke test failed."
  } else {
    Write-Warning "Destructive clean install/uninstall smoke was not run. Use a disposable Windows VM or fresh profile with -RunInstallSmoke -RunUninstall."
  }

  Write-Step "Release gauntlet result"
  Write-Host "Installer: $resolvedInstaller"
  Write-Host "SHA256:    $hashPath"
  Write-Host "Gauntlet checks finished." -ForegroundColor Green
} finally {
  Pop-Location
}
