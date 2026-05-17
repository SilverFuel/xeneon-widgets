param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $scriptRoot "XenonEdgeHost.exe"
$installScript = Join-Path $scriptRoot "install.ps1"
$removeScript = Join-Path $scriptRoot "Remove-XenonEdgeHost.ps1"
$safeModeScript = Join-Path $scriptRoot "Launch-XenonSafeMode.ps1"
$repairScript = Join-Path $scriptRoot "repair.ps1"
$shortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\XENEON Edge Host"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "XENEON Edge Host.lnk"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\XenonEdgeHost"

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
    $version = "1.0.0"
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
  New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "XENEON Edge Host" -PropertyType String -Force | Out-Null
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

foreach ($requiredPath in @($exePath, $installScript, $removeScript, $safeModeScript)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Repair is missing required installed file: $requiredPath"
  }
}

Write-Step "Repairing Start Menu shortcuts"
New-Item -ItemType Directory -Path $shortcutRoot -Force | Out-Null

New-Shortcut `
  -shortcutPath (Join-Path $shortcutRoot "XENEON Edge Host.lnk") `
  -targetPath $exePath `
  -arguments "" `
  -workingDirectory $scriptRoot `
  -iconLocation $exePath

New-Shortcut `
  -shortcutPath (Join-Path $shortcutRoot "Launch Xenon Safe Mode.lnk") `
  -targetPath "powershell.exe" `
  -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$safeModeScript`" -Quiet" `
  -workingDirectory $scriptRoot `
  -iconLocation $exePath

New-Shortcut `
  -shortcutPath (Join-Path $shortcutRoot "Repair XENEON Edge Host.lnk") `
  -targetPath "powershell.exe" `
  -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$repairScript`" -Quiet" `
  -workingDirectory $scriptRoot `
  -iconLocation $exePath

New-Shortcut `
  -shortcutPath (Join-Path $shortcutRoot "Uninstall XENEON Edge Host.lnk") `
  -targetPath "powershell.exe" `
  -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$removeScript`" -Quiet" `
  -workingDirectory $scriptRoot `
  -iconLocation $exePath

New-Shortcut `
  -shortcutPath (Join-Path $shortcutRoot "Uninstall and Remove Local Data.lnk") `
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

Write-Step "Repairing startup and runtime integration"
& $installScript -Quiet

if (-not $Quiet) {
  Write-Host ""
  Write-Host "Repair completed without changing local app data." -ForegroundColor Green
}
