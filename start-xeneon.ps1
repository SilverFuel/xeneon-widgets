$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeDir = Join-Path $repoRoot "bridge"
$installScript = Join-Path $bridgeDir "install-bridge.ps1"
$runScript = Join-Path $bridgeDir "run-bridge.ps1"
$configPath = Join-Path $bridgeDir "config.json"
$exampleConfigPath = Join-Path $bridgeDir "config.example.json"
$dashboardUrl = "http://127.0.0.1:8976/dashboard.html?v=20260425-4"
$healthUrl = "http://127.0.0.1:8976/api/health"
$frameSnippet = '<iframe src="http://127.0.0.1:8976/dashboard.html?v=20260425-4" width="2560" height="720" loading="eager" scrolling="no" referrerpolicy="no-referrer" style="display:block;width:100%;height:100%;border:0;overflow:hidden;background:#0b0f14;"></iframe>'

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

function Wait-ForBridge {
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

Write-Step "XENEON Widgets Quick Start"

try {
  $null = Get-Command node -ErrorAction Stop
} catch {
  Write-Host "Node.js is required and was not found." -ForegroundColor Red
  Write-Host "Install Node.js LTS from https://nodejs.org/ and then run this file again."
  exit 1
}

if (-not (Test-Path $configPath)) {
  Copy-Item $exampleConfigPath $configPath
}

Write-Step "Installing auto-start"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript

Write-Step "Starting local bridge"
Start-Process -FilePath powershell.exe -ArgumentList @(
  "-NoProfile",
  "-WindowStyle",
  "Hidden",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $runScript
) -WindowStyle Hidden | Out-Null

if (-not (Wait-ForBridge -Url $healthUrl)) {
  Write-Host "The local bridge did not start correctly." -ForegroundColor Red
  Write-Host "Check bridge/bridge.log for details."
  exit 1
}

try {
  Set-Clipboard -Value $frameSnippet
  $copiedUrl = $true
} catch {
  $copiedUrl = $false
}

Write-Step "Opening dashboard"
Start-Process $dashboardUrl

Write-Host "Local dashboard:"
Write-Host $dashboardUrl -ForegroundColor Green
Write-Host ""
Write-Host "Paste this into an iCUE iFrame widget:"
Write-Host $frameSnippet -ForegroundColor Yellow
Write-Host ""

if ($copiedUrl) {
  Write-Host "The full iCUE iframe code was copied to your clipboard."
}

Write-Host "Fast path:"
Write-Host "1. Open iCUE."
Write-Host "2. Add an iFrame widget on the XENEON EDGE."
Write-Host "3. Paste the iframe code above."
Write-Host "4. Resize it to fill the display."
