$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$publishedExe = Join-Path $repoRoot "publish\XenonEdgeHost.exe"
$installedExe = Join-Path $env:LOCALAPPDATA "Programs\XenonEdgeHost\XenonEdgeHost.exe"
$dashboardUrl = "http://127.0.0.1:8976/dashboard.html?v=20260425-8"

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

Write-Step "XENEON Edge Host Quick Start"

if (Test-Path $publishedExe) {
  $exePath = $publishedExe
} elseif (Test-Path $installedExe) {
  $exePath = $installedExe
} else {
  Write-Host "XENEON Edge Host was not found." -ForegroundColor Red
  Write-Host "Run Build XENEON Installer.cmd, or publish it with app\publish.ps1."
  exit 1
}

Write-Step "Starting native app"
Start-Process $exePath

if (Wait-ForDashboard -Url "http://127.0.0.1:8976/api/health") {
  Write-Step "Opening dashboard"
  Start-Process $dashboardUrl
} else {
  Write-Host "The app started, but the local dashboard did not answer yet." -ForegroundColor Yellow
  Write-Host "Use the tray icon and choose Show EDGE Window."
}

Write-Host "Local dashboard:"
Write-Host $dashboardUrl -ForegroundColor Green
