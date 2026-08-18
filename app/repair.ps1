param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $scriptRoot "XenonEdgeHost.exe"
$runtimeScript = Join-Path $scriptRoot "install.ps1"
$autoStartRemoveScript = Join-Path $scriptRoot "uninstall.ps1"
$removeScript = Join-Path $scriptRoot "Remove-XenonEdgeHost.ps1"
$safeModeScript = Join-Path $scriptRoot "Launch-XenonSafeMode.ps1"
$repairScript = Join-Path $scriptRoot "repair.ps1"
$shortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Auxora"
$legacyShortcutRoots = @(
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\XENEON Edge"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\XENEON Edge Host"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Xenon Edge Host")
)
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Auxora.lnk"
$legacyDesktopShortcuts = @(
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "XENEON Edge.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "XENEON Edge Host.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "Xenon Edge Host.lnk")
)
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Auxora"
$logRoot = Join-Path $env:LOCALAPPDATA "Auxora\InstallerLogs"
$logPath = Join-Path $logRoot "repair.log"
$previousLogPath = Join-Path $logRoot "repair.prev.log"
$transcriptStarted = $false

function Write-Step($message) {
  if (-not $Quiet) {
    Write-Host ""
    Write-Host "== $message ==" -ForegroundColor Cyan
  }
}

function New-Shortcut($shortcutPath, $targetPath, $arguments, $workingDirectory, $iconLocation) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  if ($arguments) {
    $shortcut.Arguments = $arguments
  }
  if ($workingDirectory) {
    $shortcut.WorkingDirectory = $workingDirectory
  }
  if ($iconLocation) {
    $shortcut.IconLocation = $iconLocation
  }
  $shortcut.Save()
}

function Register-UninstallEntry($installPath, $appExePath) {
  $version = (Get-Item -LiteralPath $appExePath).VersionInfo.FileVersion
  if (-not $version) {
    $version = "0.0.0"
  }

  $estimatedSizeKb = 0
  try {
    $estimatedSizeKb = [int][math]::Ceiling(((Get-ChildItem -LiteralPath $installPath -Recurse -File -ErrorAction SilentlyContinue |
      Measure-Object -Property Length -Sum).Sum) / 1KB)
  } catch {
    $estimatedSizeKb = 0
  }

  $uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$removeScript`" -Quiet"
  New-Item -Path $uninstallKey -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "Auxora" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value $version -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "SilverFuel" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $installPath -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value $appExePath -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value $uninstallCommand -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "QuietUninstallString" -Value $uninstallCommand -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "InstallDate" -Value (Get-Date -Format "yyyyMMdd") -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "URLInfoAbout" -Value "https://github.com/SilverFuel/xeneon-widgets" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "HelpLink" -Value "https://github.com/SilverFuel/xeneon-widgets/issues" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "EstimatedSize" -Value $estimatedSizeKb -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null
}

function Show-QuietRepairFailure($errorMessage) {
  if (-not $Quiet) {
    return
  }

  try {
    Add-Type -AssemblyName PresentationFramework
    $message = "Auxora repair did not finish.`n`n$errorMessage`n`nDetails were saved to:`n$logPath`n`nTry Repair Auxora again. If it still fails, reinstall Auxora from the official release."
    [System.Windows.MessageBox]::Show(
      $message,
      "Auxora Repair",
      [System.Windows.MessageBoxButton]::OK,
      [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
  } catch {
    Write-Warning "Repair failed and the error dialog could not be shown. Read the durable log at $logPath" -WarningAction Continue
  }
}

try {
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 512KB) {
    Move-Item -LiteralPath $logPath -Destination $previousLogPath -Force
  }
  Start-Transcript -Path $logPath -Append | Out-Null
  $transcriptStarted = $true

  foreach ($requiredPath in @($exePath, $runtimeScript, $autoStartRemoveScript, $removeScript, $safeModeScript)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
      throw "Repair is missing required installed file: $requiredPath"
    }
  }

  Write-Step "Repairing simple launch shortcuts"
  foreach ($legacyShortcutRoot in $legacyShortcutRoots) {
    if (Test-Path $legacyShortcutRoot) {
      Remove-Item -LiteralPath $legacyShortcutRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($legacyDesktopShortcut in $legacyDesktopShortcuts) {
    if (Test-Path $legacyDesktopShortcut) {
      Remove-Item -LiteralPath $legacyDesktopShortcut -Force -ErrorAction SilentlyContinue
    }
  }
  New-Item -ItemType Directory -Path $shortcutRoot -Force | Out-Null

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Auxora.lnk") `
    -targetPath $exePath `
    -arguments "" `
    -workingDirectory $scriptRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Auxora Recovery (Safe Mode).lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$safeModeScript`" -Quiet" `
    -workingDirectory $scriptRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Repair Auxora.lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$repairScript`" -Quiet" `
    -workingDirectory $scriptRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Uninstall Auxora.lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$removeScript`" -Quiet" `
    -workingDirectory $scriptRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Remove Auxora and Local Data.lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$removeScript`" -Quiet -RemoveLocalData" `
    -workingDirectory $scriptRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath $desktopShortcut `
    -targetPath $exePath `
    -arguments "" `
    -workingDirectory $scriptRoot `
    -iconLocation $exePath

  Write-Step "Repairing uninstall registration"
  Register-UninstallEntry -installPath $scriptRoot -appExePath $exePath

  Write-Step "Keeping automatic startup disabled"
  & $autoStartRemoveScript -Quiet -KeepRunning

  Write-Step "Repairing embedded browser runtime"
  & $runtimeScript -Quiet -RuntimeOnly

  if (-not $Quiet) {
    Write-Host ""
    Write-Host "Repair completed without changing local app data." -ForegroundColor Green
  }
}
catch {
  $repairError = $_
  if (-not $transcriptStarted) {
    try {
      New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
      Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) Auxora repair failed before the transcript started: $($repairError.Exception.Message)"
    } catch {
      Write-Warning "Repair could not create its fallback log at $logPath" -WarningAction Continue
    }
  }
  Write-Warning "Auxora repair failed: $($repairError.Exception.Message). Durable log: $logPath" -WarningAction Continue
  Show-QuietRepairFailure $repairError.Exception.Message
  throw $repairError
}
finally {
  if ($transcriptStarted) {
    try {
      Stop-Transcript | Out-Null
    } catch {
      Write-Warning "Repair transcript could not be closed cleanly. The durable log remains at $logPath" -WarningAction Continue
    }
  }
}
