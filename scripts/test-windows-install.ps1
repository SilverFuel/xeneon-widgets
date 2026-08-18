param(
  [string]$InstallerPath = "",
  [switch]$RunInstall,
  [switch]$RunUninstall,
  [switch]$RemoveLocalData,
  [switch]$QuietInstall,
  [string]$PreviousInstallerPath = "",
  [switch]$RunLaunchHealth,
  [switch]$RunRepair,
  [int]$InstallTimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

if ($RemoveLocalData -and -not $RunUninstall) {
  throw "-RemoveLocalData requires -RunUninstall so local data is removed only through the product uninstaller."
}

$installRoot = Join-Path $env:LOCALAPPDATA "Programs\Auxora"
$exePath = Join-Path $installRoot "XenonEdgeHost.exe"
$shortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Auxora"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Auxora.lnk"
$startMenuShortcut = Join-Path $shortcutRoot "Auxora.lnk"
$safeModeShortcut = Join-Path $shortcutRoot "Auxora Recovery (Safe Mode).lnk"
$repairShortcut = Join-Path $shortcutRoot "Repair Auxora.lnk"
$uninstallShortcut = Join-Path $shortcutRoot "Uninstall Auxora.lnk"
$cleanupUninstallShortcut = Join-Path $shortcutRoot "Remove Auxora and Local Data.lnk"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Auxora"
$userDataRoot = Join-Path $env:APPDATA "Auxora"
$localDataRoot = Join-Path $env:LOCALAPPDATA "Auxora"
$legacyUserDataRoot = Join-Path $env:APPDATA "XenonEdgeHost"
$legacyLocalDataRoot = Join-Path $env:LOCALAPPDATA "XenonEdgeHost"
$taskName = "XenonEdgeHost"
$runValueName = "XenonEdgeHost"
$legacyTaskName = "XeneonBridge"
$legacyRunValueName = "XeneonBridge"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

function Assert-Present($path, $label) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "$label was not found at $path"
  }

  Write-Host "OK: $label"
}

function Assert-Absent($path, $label) {
  if (Test-Path -LiteralPath $path) {
    throw "$label still exists at $path"
  }

  Write-Host "OK: $label removed"
}

function Assert-Contains($value, $expected, $label) {
  if ([string]::IsNullOrWhiteSpace($value) -or $value.IndexOf($expected, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw "$label does not contain '$expected'."
  }

  Write-Host "OK: $label"
}

function Get-ShortcutArguments($path) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($path)
  return $shortcut.Arguments
}

function Get-XenonStartupTask {
  return Get-ScheduledTask -TaskName $taskName -TaskPath "\" -ErrorAction SilentlyContinue
}

function Get-XenonStartupRunValue {
  return (Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue).$runValueName
}

function Assert-StartupAbsent {
  if (Get-XenonStartupTask) {
    throw "Scheduled task '$taskName' exists even though automatic startup must stay disabled."
  }

  if (-not [string]::IsNullOrWhiteSpace((Get-XenonStartupRunValue))) {
    throw "Run key startup entry '$runValueName' exists even though automatic startup must stay disabled."
  }

  if (Get-ScheduledTask -TaskName $legacyTaskName -TaskPath "\" -ErrorAction SilentlyContinue) {
    throw "Legacy scheduled task '$legacyTaskName' exists even though automatic startup must stay disabled."
  }

  if (-not [string]::IsNullOrWhiteSpace((Get-ItemProperty -Path $runKeyPath -Name $legacyRunValueName -ErrorAction SilentlyContinue).$legacyRunValueName)) {
    throw "Legacy Run-key startup entry '$legacyRunValueName' exists even though automatic startup must stay disabled."
  }

  Write-Host "OK: automatic startup is absent"
}

function Assert-HostClosed([int]$ObservationSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($ObservationSeconds)
  do {
    if (Get-Process -Name "XenonEdgeHost" -ErrorAction SilentlyContinue) {
      throw "Auxora was launched automatically; the public installer must leave it closed."
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  Write-Host "OK: installer left Auxora closed for $ObservationSeconds seconds"
}

function Invoke-Installer($path, $label) {
  $resolvedPath = (Resolve-Path -LiteralPath $path).Path
  Write-Step $label
  $installerArgs = @()
  if ($QuietInstall) { $installerArgs += "/Q" }
  $installerProcess = if ($installerArgs.Count -gt 0) {
    Start-Process -FilePath $resolvedPath -ArgumentList $installerArgs -PassThru
  } else {
    Start-Process -FilePath $resolvedPath -PassThru
  }
  if (-not $installerProcess.WaitForExit($InstallTimeoutSeconds * 1000)) {
    $installMarkersPresent = (Test-Path -LiteralPath $exePath) -and (Test-Path -LiteralPath $uninstallKey)
    Stop-Process -Id $installerProcess.Id -Force -ErrorAction SilentlyContinue
    if (-not $installMarkersPresent) {
      throw "$label did not exit within $InstallTimeoutSeconds seconds, and install markers were not present."
    }
    Write-Warning "$label wrapper did not exit within $InstallTimeoutSeconds seconds, but install markers are present; continuing validation."
  } elseif ($installerProcess.ExitCode -ne 0) {
    throw "$label exited with code $($installerProcess.ExitCode)."
  }
}

function Stop-InstalledHost {
  Get-Process -Name "XenonEdgeHost" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction Stop
  Start-Sleep -Seconds 1
}

function Assert-LiveHealth($label) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8976/api/health" -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        Write-Host "OK: $label"
        return
      }
    } catch {
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "$label did not return HTTP 200 within 45 seconds."
}

function Assert-LaunchAndRestartHealth {
  Stop-InstalledHost
  $first = Start-Process -FilePath $exePath -ArgumentList "--safe-mode" -PassThru
  try { Assert-LiveHealth "installed host launch /api/health" } finally { Stop-InstalledHost }
  $second = Start-Process -FilePath $exePath -ArgumentList "--safe-mode" -PassThru
  try { Assert-LiveHealth "installed host process restart /api/health" } finally { Stop-InstalledHost }
}

if ($RunInstall) {
  if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    throw "Pass -InstallerPath when using -RunInstall."
  }

  Write-Step "Preparing a closed-state install"
  Stop-InstalledHost
  if (-not [string]::IsNullOrWhiteSpace($PreviousInstallerPath)) {
    Invoke-Installer $PreviousInstallerPath "Installing previous beta for upgrade test"
    Stop-InstalledHost
  }
  Invoke-Installer $InstallerPath "Installing exact candidate"
}

Write-Step "Checking installed app"
Assert-Present $exePath "Installed executable"
Assert-Present $shortcutRoot "Start Menu shortcut folder"
Assert-Present $startMenuShortcut "Start Menu app shortcut"
Assert-Present $safeModeShortcut "Start Menu Safe Mode shortcut"
Assert-Present $repairShortcut "Start Menu repair shortcut"
Assert-Present $uninstallShortcut "Start Menu uninstall shortcut"
Assert-Present $cleanupUninstallShortcut "Start Menu data cleanup shortcut"
Assert-Present $desktopShortcut "Desktop shortcut"
Assert-Present $uninstallKey "Apps and Features uninstall entry"

$uninstallEntry = Get-ItemProperty -Path $uninstallKey
if ([string]::IsNullOrWhiteSpace($uninstallEntry.QuietUninstallString)) {
  throw "QuietUninstallString is missing from the uninstall entry."
}
Write-Host "OK: quiet uninstall command registered"
if ([string]::IsNullOrWhiteSpace($uninstallEntry.UninstallString)) {
  throw "UninstallString is missing from the uninstall entry."
}
Write-Host "OK: interactive uninstall command registered"
Assert-Contains $uninstallEntry.UninstallString "-Quiet" "Apps and Features uninstall is hands-free"
Assert-Contains (Get-ShortcutArguments $safeModeShortcut) "Launch-XenonSafeMode.ps1" "Start Menu Safe Mode runs rescue launcher"
Assert-Contains (Get-ShortcutArguments $repairShortcut) "repair.ps1" "Start Menu repair runs repair script"
Assert-Contains (Get-ShortcutArguments $uninstallShortcut) "-Quiet" "Start Menu uninstall is hands-free"
Assert-Contains (Get-ShortcutArguments $cleanupUninstallShortcut) "-RemoveLocalData" "Start Menu cleanup removes local data"
Assert-Contains (Get-ShortcutArguments $cleanupUninstallShortcut) "-Quiet" "Start Menu cleanup is hands-free"
if ([string]::IsNullOrWhiteSpace($uninstallEntry.InstallLocation) -or -not (Test-Path -LiteralPath $uninstallEntry.InstallLocation)) {
  throw "InstallLocation is missing or invalid in the uninstall entry."
}
Write-Host "OK: install location registered"
Assert-StartupAbsent
Assert-HostClosed

if ($RunLaunchHealth) {
  Write-Step "Checking live installed host"
  Assert-LaunchAndRestartHealth
}

if ($RunRepair) {
  Write-Step "Running installed repair"
  $repairScript = Join-Path $installRoot "repair.ps1"
  Assert-Present $repairScript "Installed repair script"
  $repairProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $repairScript, "-Quiet") -Wait -WindowStyle Hidden -PassThru
  if ($repairProcess.ExitCode -ne 0) { throw "Repair exited with code $($repairProcess.ExitCode)." }
  Assert-StartupAbsent
  Write-Host "OK: installed repair completed"
}

if ($RunUninstall) {
  Write-Step "Running uninstaller"
  $removeScript = Join-Path $installRoot "Remove-XenonEdgeHost.ps1"
  Assert-Present $removeScript "Uninstaller script"
  if ($RemoveLocalData) {
    foreach ($dataRoot in @($userDataRoot, $localDataRoot, $legacyUserDataRoot, $legacyLocalDataRoot)) {
      New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $dataRoot "beta-remove-all-data.marker") -Value "remove me" -Encoding ASCII
    }
  }
  $removeArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $removeScript, "-Quiet")
  if ($RemoveLocalData) {
    $removeArgs += "-RemoveLocalData"
  }
  $removeProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $removeArgs -Wait -WindowStyle Hidden -PassThru
  if ($removeProcess.ExitCode -ne 0) {
    throw "Uninstaller exited with code $($removeProcess.ExitCode)."
  }
  Start-Sleep -Seconds 4

  Write-Step "Checking uninstall cleanup"
  Assert-Absent $exePath "Installed executable"
  Assert-Absent $shortcutRoot "Start Menu shortcut folder"
  Assert-Absent $desktopShortcut "Desktop shortcut"
  Assert-Absent $uninstallKey "Apps and Features uninstall entry"
  Assert-StartupAbsent
  if ($RemoveLocalData) {
    Write-Step "Checking local data cleanup"
    Assert-Absent $userDataRoot "Roaming local data"
    Assert-Absent $localDataRoot "Local app data"
    Assert-Absent $legacyUserDataRoot "Legacy roaming local data"
    Assert-Absent $legacyLocalDataRoot "Legacy local app data"
  }
}

Write-Host ""
Write-Host "Windows install smoke test finished." -ForegroundColor Green
