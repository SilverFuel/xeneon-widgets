param(
  [switch]$SkipInstaller,
  [switch]$SkipChecks,
  [switch]$SkipReadiness,
  [switch]$AllowUnsignedBeta,
  [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $AllowUnsignedBeta) {
  throw "This local helper is restricted to the unsigned free-beta path. Use the protected commercial release workflow for signed stable releases."
}
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

Push-Location $repoRoot
try {
  $candidateInstaller = $null
  if (-not $SkipChecks) {
    Write-Step "Auditing dependencies"
    Invoke-CheckedCommand "npm" @("run", "audit:deps") "Dependency audit failed."

    Write-Step "Running repository checks"
    Invoke-CheckedCommand "npm" @("run", "check") "Repository checks failed."
  }

  if (-not $SkipInstaller) {
    Write-Step "Building Windows installer"
    if (-not [string]::IsNullOrWhiteSpace($InstallerPath)) {
      throw "-InstallerPath applies only with -SkipInstaller. Remove one of the two options."
    }
    [xml]$project = Get-Content -LiteralPath app\XenonEdgeHost.csproj
    $versionNode = $project.Project.PropertyGroup | Where-Object { $_.Version } | Select-Object -First 1
    $version = [string]$versionNode.Version
    if ([string]::IsNullOrWhiteSpace($version)) {
      throw "app\XenonEdgeHost.csproj does not define a Version."
    }
    $safeVersion = $version -replace '[^0-9A-Za-z._-]', '-'
    $buildStamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $candidateInstallerPath = Join-Path $repoRoot "app\dist\Auxora-Setup-$safeVersion-$buildStamp.exe"
    Invoke-CheckedCommand "powershell" @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "app\build-installer.ps1",
      "-OutputPath", $candidateInstallerPath
    ) "Windows installer build failed."
    $candidateInstaller = Get-Item -LiteralPath $candidateInstallerPath -ErrorAction Stop
  } elseif (-not [string]::IsNullOrWhiteSpace($InstallerPath)) {
    $resolvedInstallerPath = (Resolve-Path -LiteralPath $InstallerPath -ErrorAction Stop).Path
    $candidateInstaller = Get-Item -LiteralPath $resolvedInstallerPath -ErrorAction Stop
  }

  if (-not $SkipReadiness) {
    Write-Step "Checking release readiness"
    $readinessArgs = @("-AllowGitHubSupportPath", "-AllowBetaVersion", "-RequireUnsignedInstaller")
    if (-not $candidateInstaller) {
      throw "Release readiness requires the exact installer built in this run or an explicit -InstallerPath."
    }
    $readinessArgs += @("-InstallerPath", $candidateInstaller.FullName)
    Invoke-CheckedCommand "powershell" (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\assert-release-ready.ps1") + $readinessArgs) "Release readiness failed."
  }

  Write-Step "Release output"
  if (Test-Path app\dist) {
    Get-ChildItem app\dist -File | Sort-Object LastWriteTime -Descending | Select-Object Name, Length, LastWriteTime
  } else {
    Write-Host "No app\dist folder exists yet."
  }
} finally {
  Pop-Location
}
