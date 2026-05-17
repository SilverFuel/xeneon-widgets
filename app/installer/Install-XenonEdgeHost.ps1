param(
  [string]$SourceRoot = $PSScriptRoot,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\XenonEdgeHost"),
  [switch]$SkipLaunch,
  [switch]$NoAutoStart,
  [switch]$NoDesktopShortcut,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$logRoot = Join-Path $env:LOCALAPPDATA "XenonEdgeHost\InstallerLogs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot "install.log"
Start-Transcript -Path $logPath -Append | Out-Null

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

function Stop-LegacyBridgeIfPresent() {
  $connections = Get-NetTCPConnection -LocalPort 8976 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($processId in $connections) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if (-not $process) {
      continue
    }

    if ($process.Name -eq "node.exe" -and $process.CommandLine -match [regex]::Escape("\bridge\server.mjs")) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      Write-Info "Stopped legacy node bridge process holding port 8976."
    }
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

    Write-Info "Stopped running XenonEdgeHost process before replacing files."
  } catch {
    throw "Could not stop the running XenonEdgeHost process. Close the app and run setup again."
  }
}

function Register-UninstallEntry($installPath, $exePath) {
  $uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\XenonEdgeHost"
  $version = (Get-Item $exePath).VersionInfo.FileVersion
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

  $uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installPath\Remove-XenonEdgeHost.ps1`" -Quiet"
  New-Item -Path $uninstallKey -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "XENEON Edge Host" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value $version -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "SilverFuel" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $installPath -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value $exePath -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value $uninstallCommand -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "QuietUninstallString" -Value $uninstallCommand -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "InstallDate" -Value (Get-Date -Format "yyyyMMdd") -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "URLInfoAbout" -Value "https://github.com/SilverFuel/xeneon-widgets" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "HelpLink" -Value "https://github.com/SilverFuel/xeneon-widgets/issues" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "EstimatedSize" -Value $estimatedSizeKb -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null
}

function Get-ProgramsRoot {
  [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs")).TrimEnd('\')
}

function Assert-SafePathUnder($path, $rootPath, $label) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($rootPath).TrimEnd('\') + '\'
  $resolvedPath = [System.IO.Path]::GetFullPath($path)
  if (-not (($resolvedPath + '\').StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "$label must stay under $resolvedRoot"
  }

  return $resolvedPath
}

function Assert-SafeInstallPath($installPath) {
  return Assert-SafePathUnder $installPath (Get-ProgramsRoot) "InstallRoot"
}

function Remove-DirectoryIfPresent($path, $rootPath, $label) {
  if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) {
    Assert-SafePathUnder $path $rootPath $label | Out-Null
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Step "XENEON Edge Host - Install"

$payloadZip = Join-Path $SourceRoot "payload.zip"
$supportInstall = Join-Path $SourceRoot "install.ps1"
$supportUninstall = Join-Path $SourceRoot "uninstall.ps1"
$supportRemove = Join-Path $SourceRoot "Remove-XenonEdgeHost.ps1"

foreach ($requiredPath in @($payloadZip, $supportInstall, $supportUninstall, $supportRemove)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Missing installer payload file: $requiredPath"
  }
}

$InstallRoot = Assert-SafeInstallPath $InstallRoot
$programsRoot = Get-ProgramsRoot
$installParent = Split-Path -Parent $InstallRoot
Assert-SafePathUnder $installParent $programsRoot "Install parent" | Out-Null
New-Item -ItemType Directory -Path $installParent -Force | Out-Null

if (Test-Path -LiteralPath $InstallRoot -PathType Leaf) {
  throw "InstallRoot points to a file. Choose a folder under $programsRoot."
}

Write-Info "Install root: $InstallRoot"

Write-Step "Stopping running processes"
Stop-RunningHost
Stop-LegacyBridgeIfPresent

$extractRoot = Join-Path $env:TEMP ("XenonEdgeHost-Payload-" + [guid]::NewGuid().ToString("N"))
$stagedInstallRoot = Join-Path $installParent ("XenonEdgeHost.installing-" + [guid]::NewGuid().ToString("N"))
$backupInstallRoot = Join-Path $installParent ("XenonEdgeHost.backup-" + [guid]::NewGuid().ToString("N"))
$installMoved = $false
$installationCompleted = $false
try {
  Write-Step "Extracting payload"
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  Expand-Archive -Path $payloadZip -DestinationPath $extractRoot -Force

  Write-Step "Staging app files"
  New-Item -ItemType Directory -Path $stagedInstallRoot -Force | Out-Null
  Copy-Item (Join-Path $extractRoot "*") $stagedInstallRoot -Recurse -Force
  Copy-Item $supportInstall (Join-Path $stagedInstallRoot "install.ps1") -Force
  Copy-Item $supportUninstall (Join-Path $stagedInstallRoot "uninstall.ps1") -Force
  Copy-Item $supportRemove (Join-Path $stagedInstallRoot "Remove-XenonEdgeHost.ps1") -Force

  $stagedExePath = Join-Path $stagedInstallRoot "XenonEdgeHost.exe"
  if (-not (Test-Path $stagedExePath)) {
    throw "Staged executable was not found at $stagedExePath"
  }

  Write-Step "Installing app files"
  if (Test-Path -LiteralPath $InstallRoot) {
    Move-Item -LiteralPath $InstallRoot -Destination $backupInstallRoot -Force
  }

  try {
    Move-Item -LiteralPath $stagedInstallRoot -Destination $InstallRoot -Force
    $installMoved = $true
  } catch {
    if (Test-Path -LiteralPath $backupInstallRoot -PathType Container) {
      Move-Item -LiteralPath $backupInstallRoot -Destination $InstallRoot -Force
    }
    throw
  }

  $exePath = Join-Path $InstallRoot "XenonEdgeHost.exe"
  if (-not (Test-Path $exePath)) {
    throw "Installed executable was not found at $exePath"
  }

  Write-Step "Creating Start Menu shortcuts"
  $shortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\XENEON Edge Host"
  $legacyShortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Xenon Edge Host"
  if (Test-Path $legacyShortcutRoot) {
    Remove-Item -LiteralPath $legacyShortcutRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Path $shortcutRoot -Force | Out-Null

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "XENEON Edge Host.lnk") `
    -targetPath $exePath `
    -arguments "" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Uninstall XENEON Edge Host.lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\Remove-XenonEdgeHost.ps1`" -Quiet" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Uninstall and Remove Local Data.lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\Remove-XenonEdgeHost.ps1`" -Quiet -RemoveLocalData" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  if (-not $NoDesktopShortcut) {
    $legacyDesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Xenon Edge Host.lnk"
    if (Test-Path $legacyDesktopShortcut) {
      Remove-Item -LiteralPath $legacyDesktopShortcut -Force -ErrorAction SilentlyContinue
    }
    New-Shortcut `
      -shortcutPath (Join-Path ([Environment]::GetFolderPath("Desktop")) "XENEON Edge Host.lnk") `
      -targetPath $exePath `
      -arguments "" `
      -workingDirectory $InstallRoot `
      -iconLocation $exePath
  }

  Write-Step "Registering app"
  Register-UninstallEntry -installPath $InstallRoot -exePath $exePath

  if (-not $NoAutoStart) {
    Write-Step "Configuring auto-start"
    $autoStartScript = Join-Path $InstallRoot "install.ps1"
    if ($Quiet) {
      & $autoStartScript -Quiet
    } else {
      & $autoStartScript
    }
  } else {
    Write-Step "Disabling auto-start"
    $autoStartRemoveScript = Join-Path $InstallRoot "uninstall.ps1"
    if ($Quiet) {
      & $autoStartRemoveScript -Quiet
    } else {
      & $autoStartRemoveScript
    }
  }

  $installationCompleted = $true

  if (-not $SkipLaunch) {
    Write-Step "Launching app"
    try {
      Start-Process $exePath
    } catch {
      Write-Warning "The app was installed, but it could not be launched automatically. Start it from the Start Menu when ready."
    }
  }

  if (-not $Quiet) {
    Write-Host ""
    Write-Host "Installed successfully." -ForegroundColor Green
    Write-Host "  App:      $exePath"
    Write-Host "  Uninstall: $InstallRoot\Remove-XenonEdgeHost.ps1"
  }
}
catch {
  if (-not $installationCompleted -and (Test-Path -LiteralPath $backupInstallRoot -PathType Container)) {
    try {
      if (Test-Path -LiteralPath $InstallRoot) {
        Remove-DirectoryIfPresent $InstallRoot $programsRoot "Partial install folder"
      }

      Move-Item -LiteralPath $backupInstallRoot -Destination $InstallRoot -Force
      Write-Info "Restored previous install after setup failed."
    } catch {
      Write-Warning "Setup failed and rollback could not restore the previous install. Backup remains at $backupInstallRoot"
    }
  } elseif (-not $installationCompleted -and $installMoved -and (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
    try {
      Remove-DirectoryIfPresent $InstallRoot $programsRoot "Partial install folder"
      Write-Info "Removed partial install after setup failed."
    } catch {
      Write-Warning "Setup failed and the partial install could not be removed from $InstallRoot"
    }
  }

  if (-not $Quiet) {
    Write-Host ""
    Write-Host "Installation failed. See $logPath" -ForegroundColor Red
  }
  throw
}
finally {
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  if (-not $installMoved) {
    Remove-DirectoryIfPresent $stagedInstallRoot $programsRoot "Staged install folder"
  }
  if ($installationCompleted) {
    Remove-DirectoryIfPresent $backupInstallRoot $programsRoot "Backup install folder"
  }
  Stop-Transcript | Out-Null
}
