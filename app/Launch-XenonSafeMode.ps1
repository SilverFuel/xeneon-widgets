param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $scriptRoot "XenonEdgeHost.exe"
$uninstallAutoStartScript = Join-Path $scriptRoot "uninstall.ps1"

function Write-Info($message) {
  if (-not $Quiet) {
    Write-Host $message
  }
}

function Stop-RunningHost {
  $running = @(Get-Process -Name "XenonEdgeHost" -ErrorAction SilentlyContinue)
  if ($running.Count -eq 0) {
    return
  }

  $processIds = @($running | Select-Object -ExpandProperty Id)
  try {
    $running | Stop-Process -Force -ErrorAction Stop
    foreach ($processId in $processIds) {
      Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue
    }

    $stillRunning = @($processIds | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($stillRunning.Count -gt 0) {
      $stillRunning | Stop-Process -Force -ErrorAction Stop
      foreach ($process in $stillRunning) {
        Wait-Process -Id $process.Id -Timeout 5 -ErrorAction SilentlyContinue
      }

      $stillRunning = @($processIds | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
      if ($stillRunning.Count -gt 0) {
        throw "The running XenonEdgeHost process did not exit."
      }
    }
  } catch {
    throw "Could not stop XenonEdgeHost. Close it and try Safe Mode again."
  }

  Write-Info "Stopped running XenonEdgeHost process."
}

if (-not (Test-Path -LiteralPath $exePath)) {
  throw "XenonEdgeHost.exe was not found next to Launch-XenonSafeMode.ps1."
}

Stop-RunningHost

if (Test-Path -LiteralPath $uninstallAutoStartScript) {
  Write-Info "Disabling Xenon auto-start before Safe Mode launch."
  & $uninstallAutoStartScript -Quiet
}

Write-Info "Launching Xenon Safe Mode on the primary display."
Start-Process -FilePath $exePath -ArgumentList "--safe-mode" -WorkingDirectory $scriptRoot
