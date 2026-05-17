param(
  [string]$InstallerPath = "",
  [switch]$RunInstall,
  [switch]$RunUninstall,
  [switch]$RemoveLocalData,
  [switch]$QuietInstall,
  [int]$InstallTimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

if ($RemoveLocalData -and -not $RunUninstall) {
  throw "-RemoveLocalData requires -RunUninstall so local data is removed only through the product uninstaller."
}

$installRoot = Join-Path $env:LOCALAPPDATA "Programs\XenonEdgeHost"
$exePath = Join-Path $installRoot "XenonEdgeHost.exe"
$shortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\XENEON Edge Host"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "XENEON Edge Host.lnk"
$startMenuShortcut = Join-Path $shortcutRoot "XENEON Edge Host.lnk"
$safeModeShortcut = Join-Path $shortcutRoot "Launch Xenon Safe Mode.lnk"
$repairShortcut = Join-Path $shortcutRoot "Repair XENEON Edge Host.lnk"
$uninstallShortcut = Join-Path $shortcutRoot "Uninstall XENEON Edge Host.lnk"
$cleanupUninstallShortcut = Join-Path $shortcutRoot "Uninstall and Remove Local Data.lnk"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\XenonEdgeHost"
$userDataRoot = Join-Path $env:APPDATA "XenonEdgeHost"
$localDataRoot = Join-Path $env:LOCALAPPDATA "XenonEdgeHost"
$taskName = "XenonEdgeHost"
$runValueName = "XenonEdgeHost"
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

function Assert-StartupInstalled {
  $startupTask = Get-XenonStartupTask
  $startupRunValue = Get-XenonStartupRunValue

  if (-not $startupTask -and [string]::IsNullOrWhiteSpace($startupRunValue)) {
    throw "Neither scheduled task nor Run key startup integration was installed."
  }

  if ($startupTask -and $startupTask.State -eq "Disabled") {
    throw "Scheduled task '$taskName' is installed but disabled."
  }

  Write-Host "OK: startup integration installed"
}

function Assert-StartupRemoved {
  if (Get-XenonStartupTask) {
    throw "Scheduled task '$taskName' still exists after uninstall."
  }

  if (-not [string]::IsNullOrWhiteSpace((Get-XenonStartupRunValue))) {
    throw "Run key startup entry '$runValueName' still exists after uninstall."
  }

  Write-Host "OK: startup integration removed"
}

if ($RunInstall) {
  if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    throw "Pass -InstallerPath when using -RunInstall."
  }

  $resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
  Write-Step "Running installer"
  $installerArgs = @()
  if ($QuietInstall) {
    $installerArgs += "/Q"
  }
  if ($installerArgs.Count -gt 0) {
    $installerProcess = Start-Process -FilePath $resolvedInstaller -ArgumentList $installerArgs -PassThru
  } else {
    $installerProcess = Start-Process -FilePath $resolvedInstaller -PassThru
  }
  if (-not $installerProcess.WaitForExit($InstallTimeoutSeconds * 1000)) {
    $installMarkersPresent = (Test-Path -LiteralPath $exePath) -and (Test-Path -LiteralPath $uninstallKey)
    Stop-Process -Id $installerProcess.Id -Force -ErrorAction SilentlyContinue
    if (-not $installMarkersPresent) {
      throw "Installer did not exit within $InstallTimeoutSeconds seconds, and install markers were not present."
    }
    Write-Warning "Installer wrapper did not exit within $InstallTimeoutSeconds seconds, but install markers are present; continuing validation."
  } elseif ($installerProcess.ExitCode -ne 0) {
    throw "Installer exited with code $($installerProcess.ExitCode)."
  }
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
Assert-StartupInstalled

if ($RunUninstall) {
  Write-Step "Running uninstaller"
  $removeScript = Join-Path $installRoot "Remove-XenonEdgeHost.ps1"
  Assert-Present $removeScript "Uninstaller script"
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
  Assert-StartupRemoved
  if ($RemoveLocalData) {
    Write-Step "Checking local data cleanup"
    Assert-Absent $userDataRoot "Roaming local data"
    Assert-Absent $localDataRoot "Local app data"
  }
}

Write-Host ""
Write-Host "Windows install smoke test finished." -ForegroundColor Green
