param(
  [string]$InstallerPath = "",
  [switch]$RequireSignedInstaller,
  [switch]$RequireUnsignedInstaller,
  [string[]]$AllowedSignerThumbprint = @(),
  [switch]$AllowGitHubSupportPath,
  [switch]$AllowBetaVersion,
  [switch]$AllowDirty,
  [switch]$RunBuildChecks
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]
$reportedMissingFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
. (Join-Path $PSScriptRoot "lib\ReleaseVersionMode.ps1")

function Add-Failure($message) {
  $script:failures.Add($message) | Out-Null
  Write-Host "FAIL: $message" -ForegroundColor Red
}

function Add-Warning($message) {
  $script:warnings.Add($message) | Out-Null
  Write-Host "WARN: $message" -ForegroundColor Yellow
}

function Add-Pass($message) {
  Write-Host "OK:   $message" -ForegroundColor Green
}

function Invoke-CheckedReadinessCommand($label, $command, $arguments) {
  try {
    & $command @arguments | Out-Host
    $exitCode = $LASTEXITCODE
  } catch {
    Add-Failure "$label could not run: $($_.Exception.Message)"
    return $false
  }
  if ($exitCode -ne 0) {
    Add-Failure "$label failed with exit code $exitCode."
    return $false
  }
  return $true
}

function Read-Text($relativePath) {
  $path = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    if ($script:reportedMissingFiles.Add($relativePath)) {
      Add-Failure "$relativePath is missing"
    }
    return ""
  }

  Get-Content -LiteralPath $path -Raw
}

function Assert-File($relativePath) {
  $path = Join-Path $repoRoot $relativePath
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    Add-Pass "$relativePath exists"
    return $path
  }

  if ($script:reportedMissingFiles.Add($relativePath)) {
    Add-Failure "$relativePath is missing"
  }
  return $path
}

Push-Location $repoRoot
try {
  Write-Host ""
  Write-Host "Auxora release readiness" -ForegroundColor Cyan

  if ($RequireSignedInstaller -and $RequireUnsignedInstaller) {
    Add-Failure "Release readiness cannot require both a signed and an unsigned installer."
  }
  if ($AllowBetaVersion -and -not $RequireUnsignedInstaller) {
    Add-Failure "Beta release readiness must require an exact unsigned installer with -RequireUnsignedInstaller."
  }
  if ($RequireUnsignedInstaller -and -not $AllowBetaVersion) {
    Add-Failure "Unsigned installer readiness is allowed only with -AllowBetaVersion."
  }
  if ($AllowBetaVersion -and [string]::IsNullOrWhiteSpace($InstallerPath)) {
    Add-Failure "Beta release readiness requires -InstallerPath for the exact candidate."
  }

  if (-not $AllowDirty) {
    $status = @()
    $gitStatusFailed = $false
    try {
      $status = @(git status --porcelain)
      if ($LASTEXITCODE -ne 0) {
        $gitStatusFailed = $true
      }
    } catch {
      $gitStatusFailed = $true
    }
    if ($gitStatusFailed) {
      Add-Failure "Working tree cleanliness could not be checked."
    } elseif ($status.Count -gt 0) {
      Add-Failure "Working tree has uncommitted changes."
    } else {
      Add-Pass "Working tree is clean"
    }
  } else {
    Add-Warning "Working tree cleanliness check skipped."
  }

  Assert-File "support.html" | Out-Null
  Assert-File "refund-policy.html" | Out-Null
  Assert-File "SUPPORT.md" | Out-Null
  Assert-File "SECURITY.md" | Out-Null
  Assert-File "PRIVACY.md" | Out-Null
  Assert-File "docs\release\CLEAN-INSTALL-TEST.md" | Out-Null
  Assert-File "docs\release\REFUND-LICENSE-POLICY.md" | Out-Null
  Assert-File "docs\release\FREE-BETA-RELEASE-NOTES.md" | Out-Null

  $csprojPath = Assert-File "app\XenonEdgeHost.csproj"
  [xml]$csproj = Get-Content $csprojPath
  $version = [string]$csproj.Project.PropertyGroup.Version
  try {
    $versionMode = Assert-ReleaseVersionMode -Version $version -AllowBetaVersion:$AllowBetaVersion -RequireSignedInstaller:$RequireSignedInstaller
    Add-Pass "App version is valid for $versionMode release mode: $version"
  } catch {
    Add-Failure $_.Exception.Message
  }

  if ($AllowBetaVersion) {
    Assert-File "README.md" | Out-Null
    Assert-File "docs\release\FREE-BETA-RELEASE-NOTES.md" | Out-Null
    Assert-File "docs\release\WINDOWS-INSTALL-UNINSTALL.md" | Out-Null
    Assert-File "docs\release\GITHUB-RELEASE.md" | Out-Null
    Assert-File "CHANGELOG.md" | Out-Null
    $readmeText = Read-Text "README.md"
    $releaseNotesText = Read-Text "docs\release\FREE-BETA-RELEASE-NOTES.md"
    $installNotesText = Read-Text "docs\release\WINDOWS-INSTALL-UNINSTALL.md"
    $githubReleaseText = Read-Text "docs\release\GITHUB-RELEASE.md"
    $changelogText = Read-Text "CHANGELOG.md"
    $customerBetaDocs = [ordered]@{
      "README.md" = $readmeText
      "docs/release/FREE-BETA-RELEASE-NOTES.md" = $releaseNotesText
      "docs/release/WINDOWS-INSTALL-UNINSTALL.md" = $installNotesText
    }

    if ($releaseNotesText -match [regex]::Escape("# Auxora $version Free Public Beta") -and
        $githubReleaseText -match [regex]::Escape("Auxora $version Free Public Beta") -and
        $changelogText -match [regex]::Escape("## $version -")) {
      Add-Pass "Beta version is synchronized across release notes, release title, and changelog"
    } else {
      Add-Failure "Beta release notes, GitHub title, and dated changelog must use exact version $version."
    }

    foreach ($customerDoc in $customerBetaDocs.GetEnumerator()) {
      if ($customerDoc.Value -match "Get-FileHash\s+-Algorithm\s+SHA256" -and
          $customerDoc.Value -match "(?i)do not run the installer" -and
          $customerDoc.Value -match "(?i)unsigned" -and
          $customerDoc.Value -match "(?i)never disable SmartScreen, Smart App Control, antivirus, or organization policy" -and
          $customerDoc.Value -match "(?i)automatic startup disabled" -and
          $customerDoc.Value -match "(?i)Windows 10 version 1809" -and
          $customerDoc.Value -match "(?i)x64" -and
          $customerDoc.Value -match "(?i)WebView2 Evergreen Runtime") {
        Add-Pass "$($customerDoc.Key) preserves unsigned-beta safety and Windows system requirements"
      } else {
        Add-Failure "$($customerDoc.Key) must include checksum verification, a mismatch stop rule, exact unsigned wording, no security bypass, disabled automatic startup, and Windows 10 1809/x64/WebView2 requirements."
      }
    }
  }

  $supportText = Read-Text "support.html"
  $supportEmails = [regex]::Matches($supportText, "[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "IgnoreCase") |
    ForEach-Object { $_.Value.ToLowerInvariant() } |
    Where-Object { $_ -notmatch "example\.com$" -and $_ -notmatch "^you@" } |
    Select-Object -Unique
  $hasGitHubIssues = $supportText -match "github\.com/SilverFuel/xeneon-widgets/issues"
  $hasGitHubSecurity = $supportText -match "github\.com/SilverFuel/xeneon-widgets/security/advisories"

  if ($supportEmails.Count -ge 2) {
    Add-Pass "Support page has monitored email contacts"
  } elseif ($AllowGitHubSupportPath -and $hasGitHubIssues -and $hasGitHubSecurity) {
    Add-Warning "Using GitHub Issues and Security Advisories as the published support path."
  } else {
    Add-Failure "Support page needs monitored support/security emails, or run with -AllowGitHubSupportPath for a beta release."
  }

  $allReleaseText = Get-ChildItem $repoRoot -Recurse -File |
    Where-Object { $_.FullName -notmatch "\\\.git\\|\\node_modules\\|\\app\\bin\\|\\app\\obj\\|\\desktop\\electron\\dist\\" } |
    Where-Object { $_.Name -notmatch "^test-" -and $_.Name -notmatch "\.example\." } |
    Where-Object { $_.Extension -in ".md", ".html", ".json", ".cs", ".js", ".ps1", ".cjs" } |
    ForEach-Object { Get-Content $_.FullName -Raw }
  if (($allReleaseText -join "`n") -match "support@example\.com|security@example\.com") {
    Add-Failure "Placeholder support/security email remains in the repo."
  } else {
    Add-Pass "No placeholder support/security emails found"
  }

  $configStoreText = Read-Text "app\Infrastructure\ConfigStore.cs"
  $secretStoreText = Read-Text "app\Infrastructure\SecretStore.cs"
  if ($configStoreText -match "RemoveSecretsFromDiskConfig" -and $secretStoreText -match "ProtectedData\.Protect" -and $configStoreText -match "ResetLocalData") {
    Add-Pass "Config secrets and reset path are protected"
  } else {
    Add-Failure "Config store secret protection/reset path is incomplete."
  }

  $unifiWidgetText = Read-Text "widgets\unifi-network-dashboard.html"
  if ($unifiWidgetText -match "searchParams\.get\(`"token`"\)|params\.get\(`"token`"\)|[?&]token=|tokenFromUrl") {
    Add-Failure "UniFi widget still appears to accept a token from the URL."
  } else {
    Add-Pass "UniFi widget has no token-in-URL setup pattern"
  }

  $dashboardText = Read-Text "js\dashboard.js"
  $setupWidgetText = Read-Text "js\widgets\setup.js"
  $setupGuideText = Read-Text "widgets\setup-guide.html"
  if ($dashboardText -match "showAdvanced" -and $setupWidgetText -match "env\.showAdvanced" -and $setupWidgetText -match "Hidden from normal setup" -and $setupGuideText -match "showAdvanced" -and $setupGuideText -notmatch "Copy advanced URL") {
    Add-Pass "Advanced setup stays out of normal onboarding"
  } else {
    Add-Failure "Advanced setup is not clearly separated from normal onboarding."
  }

  $csprojText = Read-Text "app\XenonEdgeHost.csproj"
  $electronPackageText = Read-Text "desktop\electron\package.json"
  if ($csprojText -match "support\.html" -and $csprojText -match "refund-policy\.html" -and $electronPackageText -match "support\.html" -and $electronPackageText -match "refund-policy\.html") {
    Add-Pass "Support and license pages are packaged"
  } else {
    Add-Failure "Support/license pages are not included in every app package."
  }

  $removeScriptText = Read-Text "app\installer\Remove-XenonEdgeHost.ps1"
  if ($removeScriptText -match "RemoveLocalData" -and $removeScriptText -match "XenonEdgeHost") {
    Add-Pass "Uninstaller has a local data removal option"
  } else {
    Add-Failure "Uninstaller local data removal option is missing."
  }

  if ($InstallerPath) {
    $resolvedInstaller = Resolve-Path -LiteralPath $InstallerPath
    Add-Pass "Installer found: $($resolvedInstaller.Path)"
    $artifactArgs = @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $repoRoot "scripts\Test-ReleaseArtifact.ps1"),
      "-InstallerPath", $resolvedInstaller.Path,
      "-ExpectedVersion", $version
    )
    if ($RequireSignedInstaller) {
      $artifactArgs += @("-RequireSignature", "-PublishedAppPath", (Join-Path $repoRoot "publish\XenonEdgeHost.exe"))
      if ($AllowedSignerThumbprint.Count -gt 0) {
        $artifactArgs += @("-AllowedSignerThumbprint") + $AllowedSignerThumbprint
      }
    } elseif ($RequireUnsignedInstaller) {
      $artifactArgs += "-RequireUnsigned"
    }
    & powershell.exe @artifactArgs
    if ($LASTEXITCODE -eq 0) {
      Add-Pass "Installer version, hash, and required signature policy are verified"
    } else {
      Add-Failure "Release artifact verification failed."
    }
  } elseif ($RequireSignedInstaller -or $RequireUnsignedInstaller) {
    Add-Failure "Pass -InstallerPath when an exact installer signature policy is required."
  } else {
    Add-Warning "Installer signature check skipped because no installer path was provided."
  }

  if ($RunBuildChecks) {
    Write-Host ""
    Write-Host "Running build checks" -ForegroundColor Cyan
    $buildChecksPassed = $true
    if (-not (Invoke-CheckedReadinessCommand "JavaScript check" "npm" @("run", "check:js"))) { $buildChecksPassed = $false }
    if (-not (Invoke-CheckedReadinessCommand ".NET build" "dotnet" @("build", "app\XenonEdgeHost.sln", "--configuration", "Release"))) { $buildChecksPassed = $false }
    if (-not (Invoke-CheckedReadinessCommand "Electron syntax check" "npm" @("--prefix", "desktop/electron", "run", "check"))) { $buildChecksPassed = $false }
    if ($buildChecksPassed) {
      Add-Pass "Build checks passed"
    }
  }

  Write-Host ""
  if ($failures.Count) {
    Write-Host "Release readiness failed with $($failures.Count) blocker(s)." -ForegroundColor Red
    exit 1
  }

  if ($warnings.Count) {
    Write-Host "Release readiness passed with $($warnings.Count) warning(s)." -ForegroundColor Yellow
  } else {
    Write-Host "Release readiness passed." -ForegroundColor Green
  }
} finally {
  Pop-Location
}
