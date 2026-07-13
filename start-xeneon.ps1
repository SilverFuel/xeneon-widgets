$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$installedExe = Join-Path $env:LOCALAPPDATA "Programs\Auxora\XenonEdgeHost.exe"
$legacyInstalledExe = Join-Path $env:LOCALAPPDATA "Programs\XenonEdgeHost\XenonEdgeHost.exe"
$publishedExe = Join-Path $repoRoot "publish\XenonEdgeHost.exe"
$latestInstaller = Get-ChildItem (Join-Path $repoRoot "app\dist") -Filter "Auxora-Setup-*.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

function Wait-ForDashboard {
  param(
    [string]$Url,
    [int]$Attempts = 20,
    [int]$DelayMs = 750
  )

  for ($index = 0; $index -lt $Attempts; $index += 1) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return $true
      }
    } catch {
    }

    Start-Sleep -Milliseconds $DelayMs
  }

  return $false
}

Write-Step "Auxora Quick Start"

if (Test-Path $installedExe) {
  $exePath = $installedExe
  $label = "installed app"
} elseif (Test-Path $legacyInstalledExe) {
  $exePath = $legacyInstalledExe
  $label = "legacy XENEON installation"
} elseif (Test-Path $publishedExe) {
  $exePath = $publishedExe
  $label = "developer build"
} else {
  Write-Host "Auxora is not installed yet." -ForegroundColor Red
  if ($latestInstaller) {
    Write-Host ""
    Write-Host "Run this installer, then launch Auxora from the desktop or Start Menu:"
    Write-Host "  $($latestInstaller.FullName)" -ForegroundColor Yellow
  } else {
    Write-Host ""
    Write-Host "Build the installer first:"
    Write-Host "  Build XENEON Installer.cmd" -ForegroundColor Yellow
  }
  exit 1
}

Write-Step "Opening Auxora"
Write-Host "Using the ${label}:"
Write-Host "  $exePath" -ForegroundColor DarkGray
Start-Process $exePath

if (Wait-ForDashboard -Url "http://127.0.0.1:8976/api/health") {
  Write-Host ""
  Write-Host "Auxora is running." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Auxora started, but the dashboard is still waking up." -ForegroundColor Yellow
  Write-Host "Use the tray icon and choose Show Auxora Display if it does not appear."
}
