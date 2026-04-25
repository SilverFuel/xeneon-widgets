$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = $null
$repoRoot = $null

if (Test-Path (Join-Path $scriptRoot "XenonEdgeHost.exe")) {
  $appRoot = Resolve-Path $scriptRoot
} else {
  $repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
  $candidatePublishDir = Join-Path $repoRoot "publish"
  if (Test-Path (Join-Path $candidatePublishDir "XenonEdgeHost.exe")) {
    $appRoot = Resolve-Path $candidatePublishDir
  }
}

$taskName = "XenonEdgeHost"
$runValueName = "XenonEdgeHost"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

Write-Step "XENEON Edge Host - Uninstall Auto-Start"

if ($appRoot) {
  Write-Host "App root: $appRoot"
}

# --- Kill running instance ---

$running = Get-Process -Name "XenonEdgeHost" -ErrorAction SilentlyContinue
if ($running) {
  try {
    $running | Stop-Process -Force
    Write-Host "Stopped running XenonEdgeHost process."
  } catch {
    Write-Warning "Could not stop running XenonEdgeHost process."
  }
}

# --- Remove scheduled task ---

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task '$taskName'."
  } catch {
    Write-Warning "Unable to remove scheduled task '$taskName'."
  }
} else {
  Write-Host "Scheduled task '$taskName' was not installed."
}

# --- Remove registry Run key ---

if (Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue) {
  Remove-ItemProperty -Path $runKeyPath -Name $runValueName
  Write-Host "Removed startup entry '$runValueName'."
} else {
  Write-Host "Startup entry '$runValueName' was not installed."
}

Write-Host ""
Write-Host "Auto-start removed." -ForegroundColor Green
if ($repoRoot) {
  Write-Host "The published files in publish/ were not deleted."
} elseif ($appRoot) {
  Write-Host "The installed app files in $appRoot were not deleted."
}
