param(
  [string]$InstallerPath = "",
  [switch]$RequireSignedInstaller,
  [switch]$AllowGitHubSupportPath,
  [switch]$AllowDirty,
  [switch]$RunBuildChecks
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

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

function Read-Text($relativePath) {
  Get-Content (Join-Path $repoRoot $relativePath) -Raw
}

function Assert-File($relativePath) {
  $path = Join-Path $repoRoot $relativePath
  if (Test-Path -LiteralPath $path) {
    Add-Pass "$relativePath exists"
    return $path
  }

  Add-Failure "$relativePath is missing"
  return $path
}

Push-Location $repoRoot
try {
  Write-Host ""
  Write-Host "XENEON Edge Host release readiness" -ForegroundColor Cyan

  if (-not $AllowDirty) {
    $status = git status --porcelain
    if ($status) {
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

  $csprojPath = Assert-File "app\XenonEdgeHost.csproj"
  [xml]$csproj = Get-Content $csprojPath
  $version = [string]$csproj.Project.PropertyGroup.Version
  if ($version -and $version -notmatch "preview|alpha|beta") {
    Add-Pass "App version is release-style: $version"
  } else {
    Add-Failure "App version is missing or still marked preview."
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
  $inlineText = Read-Text "js\inline-widgets.js"
  $setupGuideText = Read-Text "widgets\setup-guide.html"
  if ($dashboardText -match "showAdvanced" -and $inlineText -match "env\.showAdvanced" -and $inlineText -match "Hidden from normal setup" -and $setupGuideText -match "showAdvanced" -and $setupGuideText -notmatch "Copy advanced URL") {
    Add-Pass "Advanced setup stays out of normal onboarding"
  } else {
    Add-Failure "Advanced setup is not clearly separated from normal onboarding."
  }

  $csprojText = Read-Text "app\XenonEdgeHost.csproj"
  $electronPackageText = Read-Text "desktop\electron\package.json"
  if ($csprojText -match "support\.html" -and $csprojText -match "refund-policy\.html" -and $electronPackageText -match "support\.html" -and $electronPackageText -match "refund-policy\.html") {
    Add-Pass "Support and refund pages are packaged"
  } else {
    Add-Failure "Support/refund pages are not included in every app package."
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

    $signature = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller.Path
    if ($signature.Status -eq "Valid") {
      Add-Pass "Installer signature is valid"
    } elseif ($RequireSignedInstaller) {
      Add-Failure "Installer signature is not valid: $($signature.Status)"
    } else {
      Add-Warning "Installer is not signed: $($signature.Status)"
    }

    $hashPath = "$($resolvedInstaller.Path).sha256"
    if (Test-Path -LiteralPath $hashPath) {
      Add-Pass "Installer SHA256 file exists"
    } else {
      Add-Failure "Installer SHA256 file is missing."
    }
  } elseif ($RequireSignedInstaller) {
    Add-Failure "Pass -InstallerPath when -RequireSignedInstaller is used."
  } else {
    Add-Warning "Installer signature check skipped because no installer path was provided."
  }

  if ($RunBuildChecks) {
    Write-Host ""
    Write-Host "Running build checks" -ForegroundColor Cyan
    npm run check:js
    dotnet build app\XenonEdgeHost.sln --configuration Release
    npm --prefix desktop/electron run check
    Add-Pass "Build checks passed"
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
