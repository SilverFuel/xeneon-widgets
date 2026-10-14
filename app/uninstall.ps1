param(
  [switch]$Quiet,
  [switch]$KeepRunning
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

$taskNames = @("XenonEdgeHost", "XeneonBridge")
$runValueNames = @("XenonEdgeHost", "XeneonBridge")
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

Write-Step "Auxora - Uninstall Auto-Start"

if ($appRoot) {
  Write-Info "App root: $appRoot"
}

# --- Kill running instance ---

if (-not $KeepRunning) {
  $running = Get-Process -Name "XenonEdgeHost" -ErrorAction SilentlyContinue
  if ($running) {
    try {
      $running | Stop-Process -Force
      Write-Info "Stopped running XenonEdgeHost process."
    } catch {
      Write-QuietWarning "Could not stop running XenonEdgeHost process."
    }
  }
}

# --- Remove scheduled task ---

foreach ($taskName in $taskNames) {
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
}

# --- Remove registry Run key ---

foreach ($runValueName in $runValueNames) {
  if (Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKeyPath -Name $runValueName
    Write-Info "Removed startup entry '$runValueName'."
  } else {
    Write-Info "Startup entry '$runValueName' was not installed."
  }
}

$remainingTasks = @($taskNames | Where-Object { Get-RootScheduledTask $_ })
$remainingRunValues = @($runValueNames | Where-Object {
  -not [string]::IsNullOrWhiteSpace((Get-ItemProperty -Path $runKeyPath -Name $_ -ErrorAction SilentlyContinue).$_)
})
if ($remainingTasks.Count -gt 0 -or $remainingRunValues.Count -gt 0) {
  $remaining = @($remainingTasks + $remainingRunValues) | Select-Object -Unique
  throw "Automatic startup could not be disabled for: $($remaining -join ', '). Remove those entries and run the operation again."
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
