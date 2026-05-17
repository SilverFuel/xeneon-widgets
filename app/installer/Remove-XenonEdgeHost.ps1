param(
  [switch]$Quiet,
  [switch]$RemoveLocalData,
  [string]$InstallRoot = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

$logRoot = Join-Path $env:LOCALAPPDATA "XenonEdgeHost\InstallerLogs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot "uninstall.log"
Start-Transcript -Path $logPath -Append | Out-Null

trap {
  try {
    Stop-Transcript | Out-Null
  } catch {
  }
  break
}

function Write-Step($message) {
  if (-not $Quiet) {
    Write-Host ""
    Write-Host "== $message ==" -ForegroundColor Cyan
  }
}

function Assert-SafeInstallPath($installPath) {
  $programsRoot = Join-Path $env:LOCALAPPDATA "Programs"
  $resolvedProgramsRoot = [System.IO.Path]::GetFullPath($programsRoot).TrimEnd('\') + '\'
  $resolvedInstallPath = [System.IO.Path]::GetFullPath($installPath)
  if (-not $resolvedInstallPath.StartsWith($resolvedProgramsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "InstallRoot must stay under $resolvedProgramsRoot"
  }
}

function Resolve-SafeLocalDataPath($path, $rootPath) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($rootPath).TrimEnd('\') + '\'
  $resolvedPath = [System.IO.Path]::GetFullPath($path)
  if (-not $resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Local data path must stay under $resolvedRoot"
  }

  return $resolvedPath
}

function Get-RootScheduledTask($taskName) {
  return Get-ScheduledTask -TaskName $taskName -TaskPath "\" -ErrorAction SilentlyContinue
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

    $stillRunning = @()
    foreach ($processId in $processIds) {
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($process) {
        $stillRunning += $process
      }
    }

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

    if (-not $Quiet) {
      Write-Host "Stopped running XenonEdgeHost process."
    }
  } catch {
    throw "Could not stop the running XenonEdgeHost process. Close the app and run uninstall again."
  }
}

Write-Step "XENEON Edge Host - Remove"
Assert-SafeInstallPath $InstallRoot

$shortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\XENEON Edge Host"
$legacyShortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Xenon Edge Host"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "XENEON Edge Host.lnk"
$legacyDesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Xenon Edge Host.lnk"
$publicDesktopShortcut = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "XENEON Edge Host.lnk"
$legacyPublicDesktopShortcut = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Xenon Edge Host.lnk"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\XenonEdgeHost"
$cleanupTargets = @([System.IO.Path]::GetFullPath($InstallRoot))

function Remove-StartupFallback {
  $taskNames = @("XenonEdgeHost", "XeneonBridge")
  foreach ($taskName in $taskNames) {
    if (Get-RootScheduledTask $taskName) {
      try {
        Unregister-ScheduledTask -TaskName $taskName -TaskPath "\" -Confirm:$false
        if (-not $Quiet) {
          Write-Host "Removed scheduled task '$taskName'."
        }
      } catch {
        if (-not $Quiet) {
          Write-Warning "Unable to remove scheduled task '$taskName'."
        }
      }
    }
  }

  $runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  foreach ($runValueName in @("XenonEdgeHost", "XeneonBridge")) {
    if (Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue) {
      Remove-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue
      if (-not $Quiet) {
        Write-Host "Removed startup entry '$runValueName'."
      }
    }
  }
}

if ($RemoveLocalData) {
  $cleanupTargets += Resolve-SafeLocalDataPath (Join-Path $env:APPDATA "XenonEdgeHost") $env:APPDATA
  $cleanupTargets += Resolve-SafeLocalDataPath (Join-Path $env:LOCALAPPDATA "XenonEdgeHost") $env:LOCALAPPDATA
}

Write-Step "Stopping running app"
Stop-RunningHost

Write-Step "Removing startup integration"
$uninstallScript = Join-Path $InstallRoot "uninstall.ps1"
if (Test-Path $uninstallScript) {
  if ($Quiet) {
    & $uninstallScript -Quiet
  } else {
    & $uninstallScript
  }
} else {
  Remove-StartupFallback
}

Write-Step "Removing shortcuts and uninstall registration"
if (Test-Path $shortcutRoot) {
  Remove-Item -LiteralPath $shortcutRoot -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $legacyShortcutRoot) {
  Remove-Item -LiteralPath $legacyShortcutRoot -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $desktopShortcut) {
  Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
}
if (Test-Path $legacyDesktopShortcut) {
  Remove-Item -LiteralPath $legacyDesktopShortcut -Force -ErrorAction SilentlyContinue
}
if (Test-Path $publicDesktopShortcut) {
  Remove-Item -LiteralPath $publicDesktopShortcut -Force -ErrorAction SilentlyContinue
}
if (Test-Path $legacyPublicDesktopShortcut) {
  Remove-Item -LiteralPath $legacyPublicDesktopShortcut -Force -ErrorAction SilentlyContinue
}
if (Test-Path $uninstallKey) {
  Remove-Item -LiteralPath $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Step "Scheduling file cleanup"
$cleanupScript = Join-Path $env:TEMP ("Cleanup-XenonEdgeHost-" + [guid]::NewGuid().ToString("N") + ".ps1")
$escapedCleanupScript = $cleanupScript.Replace("'", "''")
$targetLines = ($cleanupTargets | Select-Object -Unique | ForEach-Object {
  "  '" + $_.Replace("'", "''") + "'"
}) -join ",`r`n"

$cleanupContent = @"
Start-Sleep -Seconds 2
`$targets = @(
$targetLines
)
foreach (`$target in `$targets) {
  if (Test-Path -LiteralPath `$target) {
    Get-ChildItem -LiteralPath `$target -Force -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath `$target -Force -Recurse -ErrorAction SilentlyContinue
  }
}
Remove-Item -LiteralPath '$escapedCleanupScript' -Force -ErrorAction SilentlyContinue
"@

Set-Content -LiteralPath $cleanupScript -Value $cleanupContent -Encoding UTF8
Start-Process powershell.exe `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $cleanupScript) `
  -WindowStyle Hidden

if (-not $Quiet) {
  Write-Host ""
  Write-Host "Removal scheduled. The install folder will be cleaned up in a few seconds." -ForegroundColor Green
  if ($RemoveLocalData) {
    Write-Host "Local app data will also be removed." -ForegroundColor Green
  }
}

Stop-Transcript | Out-Null
