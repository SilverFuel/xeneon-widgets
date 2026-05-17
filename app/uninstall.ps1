param(
  [switch]$Quiet
)

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
  if (-not $Quiet) {
    Write-Host ""
    Write-Host "== $message ==" -ForegroundColor Cyan
  }
}

function Write-Info($message) {
  if (-not $Quiet) {
    Write-Host $message
  }
}

function Write-QuietWarning($message) {
  if (-not $Quiet) {
    Write-Warning $message
  }
}

function Get-RootScheduledTask($taskName) {
  return Get-ScheduledTask -TaskName $taskName -TaskPath "\" -ErrorAction SilentlyContinue
}

Write-Step "XENEON Edge Host - Uninstall Auto-Start"

if ($appRoot) {
  Write-Info "App root: $appRoot"
}

# --- Kill running instance ---

$running = Get-Process -Name "XenonEdgeHost" -ErrorAction SilentlyContinue
if ($running) {
  try {
    $running | Stop-Process -Force
    Write-Info "Stopped running XenonEdgeHost process."
  } catch {
    Write-QuietWarning "Could not stop running XenonEdgeHost process."
  }
}

# --- Remove scheduled task ---

if (Get-RootScheduledTask $taskName) {
  try {
    Unregister-ScheduledTask -TaskName $taskName -TaskPath "\" -Confirm:$false
    Write-Info "Removed scheduled task '$taskName'."
  } catch {
    Write-QuietWarning "Unable to remove scheduled task '$taskName'."
  }
} else {
  Write-Info "Scheduled task '$taskName' was not installed."
}

# --- Remove registry Run key ---

if (Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue) {
  Remove-ItemProperty -Path $runKeyPath -Name $runValueName
  Write-Info "Removed startup entry '$runValueName'."
} else {
  Write-Info "Startup entry '$runValueName' was not installed."
}

if (-not $Quiet) {
  Write-Host ""
  Write-Host "Auto-start removed." -ForegroundColor Green
  if ($repoRoot) {
    Write-Host "The published files in publish/ were not deleted."
  } elseif ($appRoot) {
    Write-Host "The installed app files in $appRoot were not deleted."
  }
}
