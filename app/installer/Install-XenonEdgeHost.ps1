param(
  [string]$SourceRoot = $PSScriptRoot,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\Auxora"),
  [switch]$SkipLaunch,
  [switch]$NoAutoStart,
  [switch]$NoDesktopShortcut,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$logRoot = Join-Path $env:LOCALAPPDATA "Auxora\InstallerLogs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot "install.log"
$previousLogPath = Join-Path $logRoot "install.prev.log"
if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 512KB) {
  Move-Item -LiteralPath $logPath -Destination $previousLogPath -Force
}
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

function Get-InstalledWebView2Version {
  $webViewClientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  $registryPaths = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$webViewClientId",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$webViewClientId",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$webViewClientId"
  )

  foreach ($path in $registryPaths) {
    $value = (Get-ItemProperty -Path $path -Name "pv" -ErrorAction SilentlyContinue).pv
    if ($value -and $value -ne "0.0.0.0") {
      return [string]$value
    }
  }

  return $null
}

function Get-BundledWebView2Runtime($rootPath) {
  $fixedRuntimeRoot = Join-Path $rootPath "FixedRuntime"
  if (-not (Test-Path -LiteralPath $fixedRuntimeRoot -PathType Container)) {
    return $null
  }

  return Get-ChildItem -LiteralPath $fixedRuntimeRoot -Filter "msedgewebview2.exe" -File -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    Select-Object -First 1
}

function Register-UninstallEntry($installPath, $exePath) {
  $uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Auxora"
  $version = (Get-Item $exePath).VersionInfo.FileVersion
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

  $uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installPath\Remove-XenonEdgeHost.ps1`" -Quiet"
  New-Item -Path $uninstallKey -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "Auxora" -PropertyType String -Force | Out-Null
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
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $path) {
      throw "$label could not be removed completely: $path"
    }
  }
}

function Remove-DirectoryBestEffort($path, $rootPath, $label) {
  try {
    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) {
      return
    }
    Remove-DirectoryIfPresent $path $rootPath $label
  } catch {
    Write-Warning "$label was retained at $path because cleanup failed: $($_.Exception.Message)" -WarningAction Continue
  }
}

function Restore-BackupInstall($backupPath, $restorePath, $rootPath) {
  $safeBackupPath = Assert-SafePathUnder $backupPath $rootPath "Backup install folder"
  $safeRestorePath = Assert-SafePathUnder $restorePath $rootPath "Restore target"

  if (-not (Test-Path -LiteralPath $safeBackupPath -PathType Container)) {
    throw "Backup install folder is missing: $safeBackupPath"
  }
  if (Test-Path -LiteralPath $safeRestorePath) {
    throw "Restore target already exists; refusing to nest or overwrite the backup: $safeRestorePath"
  }

  [System.IO.Directory]::Move($safeBackupPath, $safeRestorePath)
  if ((Test-Path -LiteralPath $safeBackupPath) -or -not (Test-Path -LiteralPath $safeRestorePath -PathType Container)) {
    throw "The previous installation was not restored exactly to $safeRestorePath. Backup source: $safeBackupPath"
  }

  return $safeRestorePath
}

function Get-RegistryKeySnapshot($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    return [pscustomobject]@{
      Exists = $false
      Values = @()
    }
  }

  $key = Get-Item -LiteralPath $path
  $values = @($key.GetValueNames() | ForEach-Object {
    [pscustomobject]@{
      Name = $_
      Value = $key.GetValue($_, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      Kind = $key.GetValueKind($_)
    }
  })

  return [pscustomobject]@{
    Exists = $true
    Values = $values
  }
}

function Restore-RegistryKeySnapshot($path, $snapshot) {
  $currentUserPrefix = "HKCU:\"
  if (-not $path.StartsWith($currentUserPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Registry snapshot restore supports only current-user keys."
  }

  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }

  if ($null -eq $snapshot -or -not $snapshot.Exists) {
    return
  }

  $subKeyPath = $path.Substring($currentUserPrefix.Length)
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($subKeyPath, $true)
  if ($null -eq $key) {
    throw "Could not reopen the uninstall registry key for rollback."
  }
  try {
    foreach ($value in $snapshot.Values) {
      $key.SetValue($value.Name, $value.Value, $value.Kind)
    }
  } finally {
    $key.Dispose()
  }
}

Write-Step "Auxora - Install"

$payloadZip = Join-Path $SourceRoot "payload.zip"
$supportInstall = Join-Path $SourceRoot "install.ps1"
$supportUninstall = Join-Path $SourceRoot "uninstall.ps1"
$supportRemove = Join-Path $SourceRoot "Remove-XenonEdgeHost.ps1"
$supportSafeMode = Join-Path $SourceRoot "Launch-XenonSafeMode.ps1"
$supportRepair = Join-Path $SourceRoot "repair.ps1"

foreach ($requiredPath in @($payloadZip, $supportInstall, $supportUninstall, $supportRemove, $supportSafeMode, $supportRepair)) {
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

$legacyInstallRoot = Assert-SafeInstallPath (Join-Path $env:LOCALAPPDATA "Programs\XenonEdgeHost")

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
$legacyUninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\XenonEdgeHost"

$installerTempRoot = [System.IO.Path]::GetTempPath()
$extractRoot = Join-Path $installerTempRoot ("Auxora-Payload-" + [guid]::NewGuid().ToString("N"))
$stagedInstallRoot = Join-Path $installParent ("Auxora.installing-" + [guid]::NewGuid().ToString("N"))
$backupInstallRoot = Join-Path $installParent ("Auxora.backup-" + [guid]::NewGuid().ToString("N"))
$metadataBackupRoot = Join-Path $installerTempRoot ("Auxora-Metadata-" + [guid]::NewGuid().ToString("N"))
$shortcutBackupRoot = Join-Path $metadataBackupRoot "StartMenu"
$desktopShortcutBackupPath = Join-Path $metadataBackupRoot "Auxora.desktop.lnk"
$registrySnapshotBackupPath = Join-Path $metadataBackupRoot "Auxora-uninstall-registry.xml"
$backupRestoreRoot = ""
$priorUninstallSnapshot = $null
$hadShortcutRoot = $false
$hadDesktopShortcut = $false
$metadataSnapshotCreated = $false
$metadataMutationStarted = $false
$metadataRestoreFailed = $false
$startupConfigurationAttempted = $false
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
  Copy-Item $supportSafeMode (Join-Path $stagedInstallRoot "Launch-XenonSafeMode.ps1") -Force
  Copy-Item $supportRepair (Join-Path $stagedInstallRoot "repair.ps1") -Force

  $stagedExePath = Join-Path $stagedInstallRoot "XenonEdgeHost.exe"
  if (-not (Test-Path $stagedExePath)) {
    throw "Staged executable was not found at $stagedExePath"
  }

  Write-Step "Checking embedded browser runtime"
  $bundledWebView2 = Get-BundledWebView2Runtime $stagedInstallRoot
  $installedWebView2Version = Get-InstalledWebView2Version
  if (-not $bundledWebView2 -and [string]::IsNullOrWhiteSpace($installedWebView2Version)) {
    throw "Auxora requires Microsoft Edge WebView2 Runtime. Install the Evergreen WebView2 Runtime from Microsoft, then run setup again. No existing Auxora files were replaced."
  }
  if ($bundledWebView2) {
    Write-Info "Verified bundled WebView2 runtime."
  } else {
    Write-Info "Verified installed Evergreen WebView2 Runtime $installedWebView2Version."
  }

  Write-Step "Stopping running processes"
  Stop-RunningHost
  Stop-LegacyBridgeIfPresent

  if ($NoAutoStart) {
    # Deliberate fail-safe: public setup removes known login startup before any
    # install mutation and never re-enables it after failure. This protects remote
    # access and display recovery even when an older install had startup enabled.
    Write-Step "Preflighting automatic startup removal"
    if ($Quiet) {
      & $supportUninstall -Quiet -KeepRunning
    } else {
      & $supportUninstall -KeepRunning
    }
  }

  Write-Step "Protecting existing app registration"
  New-Item -ItemType Directory -Path $metadataBackupRoot -Force | Out-Null
  if (Test-Path -LiteralPath $shortcutRoot -PathType Container) {
    Copy-Item -LiteralPath $shortcutRoot -Destination $shortcutBackupRoot -Recurse -Force
    $hadShortcutRoot = $true
  }
  if (Test-Path -LiteralPath $desktopShortcut -PathType Leaf) {
    Copy-Item -LiteralPath $desktopShortcut -Destination $desktopShortcutBackupPath -Force
    $hadDesktopShortcut = $true
  }
  $priorUninstallSnapshot = Get-RegistryKeySnapshot $uninstallKey
  $priorUninstallSnapshot | Export-Clixml -LiteralPath $registrySnapshotBackupPath
  $metadataSnapshotCreated = $true

  Write-Step "Installing app files"
  if (Test-Path -LiteralPath $InstallRoot -PathType Container) {
    $backupRestoreRoot = $InstallRoot
    [System.IO.Directory]::Move($InstallRoot, $backupInstallRoot)
  } elseif (Test-Path -LiteralPath $legacyInstallRoot -PathType Container) {
    $backupRestoreRoot = $legacyInstallRoot
    [System.IO.Directory]::Move($legacyInstallRoot, $backupInstallRoot)
    Write-Info "Staged the previous XENEON installation for transactional migration."
  }

  try {
    [System.IO.Directory]::Move($stagedInstallRoot, $InstallRoot)
    $installMoved = $true
  } catch {
    $stageMoveError = $_
    if (Test-Path -LiteralPath $backupInstallRoot -PathType Container) {
      try {
        Restore-BackupInstall $backupInstallRoot $backupRestoreRoot $programsRoot | Out-Null
        Write-Info "Restored previous install after the staged install move failed."
      } catch {
        Write-Warning "The staged install move failed and the previous install could not be restored. Backup remains at $backupInstallRoot; intended target: $backupRestoreRoot"
      }
    }
    throw $stageMoveError
  }

  $exePath = Join-Path $InstallRoot "XenonEdgeHost.exe"
  if (-not (Test-Path $exePath)) {
    throw "Installed executable was not found at $exePath"
  }

  if (-not $NoAutoStart) {
    Write-Step "Configuring auto-start"
    $autoStartScript = Join-Path $InstallRoot "install.ps1"
    $startupConfigurationAttempted = $true
    if ($Quiet) {
      & $autoStartScript -Quiet
    } else {
      & $autoStartScript
    }
  } else {
    Write-Step "Configuring runtime without automatic startup"
    $runtimeScript = Join-Path $InstallRoot "install.ps1"
    if ($Quiet) {
      & $runtimeScript -Quiet -RuntimeOnly
    } else {
      & $runtimeScript -RuntimeOnly
    }

    Write-Step "Verifying automatic startup remains disabled"
    $autoStartRemoveScript = Join-Path $InstallRoot "uninstall.ps1"
    if ($Quiet) {
      & $autoStartRemoveScript -Quiet -KeepRunning
    } else {
      & $autoStartRemoveScript -KeepRunning
    }
  }

  Write-Step "Creating simple launch shortcuts"
  $metadataMutationStarted = $true
  New-Item -ItemType Directory -Path $shortcutRoot -Force | Out-Null

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Auxora.lnk") `
    -targetPath $exePath `
    -arguments "" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Auxora Recovery (Safe Mode).lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\Launch-XenonSafeMode.ps1`" -Quiet" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Repair Auxora.lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\repair.ps1`" -Quiet" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Uninstall Auxora.lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\Remove-XenonEdgeHost.ps1`" -Quiet" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Remove Auxora and Local Data.lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\Remove-XenonEdgeHost.ps1`" -Quiet -RemoveLocalData" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  if (-not $NoDesktopShortcut) {
    New-Shortcut `
      -shortcutPath $desktopShortcut `
      -targetPath $exePath `
      -arguments "" `
      -workingDirectory $InstallRoot `
      -iconLocation $exePath
  }

  Write-Step "Registering app"
  Register-UninstallEntry -installPath $InstallRoot -exePath $exePath

  # Keep this inert-by-default seam in the release bytes so the disposable-VM test
  # can prove rollback on the exact candidate. The action is accepted only when the
  # caller supplies the full embedded commit and a one-time marker under the local
  # temp root. Public release metadata alone cannot trigger the injected failure.
  $qualificationCommit = [string]$env:AUXORA_RELEASE_QUALIFICATION_COMMIT
  $qualificationMarkerPath = [string]$env:AUXORA_RELEASE_QUALIFICATION_MARKER
  $installedProductVersion = [string](Get-Item -LiteralPath $exePath).VersionInfo.ProductVersion
  $qualificationCommitMatches = $qualificationCommit -match '^[0-9a-fA-F]{40}$' -and
    $installedProductVersion.EndsWith(".$qualificationCommit", [System.StringComparison]::OrdinalIgnoreCase)
  $qualificationMarkerMatches = $false
  if ($qualificationCommitMatches -and -not [string]::IsNullOrWhiteSpace($qualificationMarkerPath)) {
    try {
      $safeQualificationMarkerPath = Assert-SafePathUnder $qualificationMarkerPath $installerTempRoot "Release qualification marker"
      if (Test-Path -LiteralPath $safeQualificationMarkerPath -PathType Leaf) {
        $qualificationMarkerItem = Get-Item -LiteralPath $safeQualificationMarkerPath -Force -ErrorAction Stop
        $markerParent = [System.IO.Path]::GetFullPath($qualificationMarkerItem.DirectoryName).TrimEnd('\')
        $expectedMarkerParent = [System.IO.Path]::GetFullPath($installerTempRoot).TrimEnd('\')
        $markerIsDirectTempFile = $markerParent.Equals($expectedMarkerParent, [System.StringComparison]::OrdinalIgnoreCase) -and
          $qualificationMarkerItem.Name -match '^Auxora-ReleaseQualification-[0-9a-fA-F]{32}\.marker$'
        $markerIsReparsePoint = ($qualificationMarkerItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
        if ($markerIsDirectTempFile -and -not $markerIsReparsePoint) {
          $expectedMarker = "Auxora:$qualificationCommit`:after-registration"
          $actualMarker = (Get-Content -LiteralPath $qualificationMarkerItem.FullName -Raw).Trim()
          $qualificationMarkerMatches = $actualMarker -ceq $expectedMarker
        }
      }
    } catch {
      $qualificationMarkerMatches = $false
    }
  }
  if ($qualificationCommitMatches -and $qualificationMarkerMatches -and $env:AUXORA_INSTALLER_TEST_FAILURE -ceq "after-registration") {
    Write-Info "Release qualification requested an injected failure after app registration."
    throw "Injected release-test failure after app registration."
  }

  Write-Step "Removing superseded XENEON registration"
  foreach ($legacyShortcutRoot in $legacyShortcutRoots) {
    if (Test-Path -LiteralPath $legacyShortcutRoot) {
      Remove-Item -LiteralPath $legacyShortcutRoot -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $legacyShortcutRoot) {
        Write-Warning "A superseded XENEON Start Menu folder was retained at $legacyShortcutRoot"
      }
    }
  }
  foreach ($legacyDesktopShortcut in $legacyDesktopShortcuts) {
    if (Test-Path -LiteralPath $legacyDesktopShortcut) {
      Remove-Item -LiteralPath $legacyDesktopShortcut -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $legacyDesktopShortcut) {
        Write-Warning "A superseded XENEON desktop shortcut was retained at $legacyDesktopShortcut"
      }
    }
  }
  Remove-Item -LiteralPath $legacyUninstallKey -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $legacyUninstallKey) {
    Write-Warning "The superseded XenonEdgeHost uninstall registration was retained at $legacyUninstallKey"
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
  $installationError = $_
  $restoredPreviousInstall = $false

  if (-not $installationCompleted -and $startupConfigurationAttempted -and $installMoved) {
    try {
      $partialUninstallScript = Join-Path $InstallRoot "uninstall.ps1"
      if (Test-Path -LiteralPath $partialUninstallScript -PathType Leaf) {
        & $partialUninstallScript -Quiet -KeepRunning
      } else {
        & $supportUninstall -Quiet -KeepRunning
      }
    } catch {
      Write-Warning "Setup failed and the partial automatic-startup registration could not be removed. See $logPath"
    }
  }

  if (-not $installationCompleted -and (Test-Path -LiteralPath $backupInstallRoot -PathType Container)) {
    $restoreTarget = if ([string]::IsNullOrWhiteSpace($backupRestoreRoot)) { $InstallRoot } else { $backupRestoreRoot }
    try {
      if ($installMoved -and (Test-Path -LiteralPath $InstallRoot)) {
        Remove-DirectoryIfPresent $InstallRoot $programsRoot "Partial install folder"
      }

      Restore-BackupInstall $backupInstallRoot $restoreTarget $programsRoot | Out-Null
      $restoredPreviousInstall = $true
      Write-Info "Restored previous install after setup failed."
    } catch {
      Write-Warning "Setup failed and rollback could not restore the previous install. Backup remains at $backupInstallRoot; intended target: $restoreTarget"
    }
  } elseif (-not $installationCompleted -and $installMoved -and (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
    try {
      Remove-DirectoryIfPresent $InstallRoot $programsRoot "Partial install folder"
      Write-Info "Removed partial install after setup failed."
    } catch {
      Write-Warning "Setup failed and the partial install could not be removed from $InstallRoot"
    }
  }

  if (-not $installationCompleted -and $metadataMutationStarted -and $metadataSnapshotCreated) {
    try {
      if (Test-Path -LiteralPath $shortcutRoot) {
        Remove-Item -LiteralPath $shortcutRoot -Recurse -Force
      }
      if (Test-Path -LiteralPath $desktopShortcut) {
        Remove-Item -LiteralPath $desktopShortcut -Force
      }
      if ($hadShortcutRoot) {
        Copy-Item -LiteralPath $shortcutBackupRoot -Destination $shortcutRoot -Recurse -Force
      }
      if ($hadDesktopShortcut) {
        Copy-Item -LiteralPath $desktopShortcutBackupPath -Destination $desktopShortcut -Force
      }
      Restore-RegistryKeySnapshot $uninstallKey $priorUninstallSnapshot
      Write-Info "Restored previous shortcuts and uninstall registration after setup failed."
    } catch {
      $metadataRestoreFailed = $true
      Write-Warning "Setup failed and rollback could not fully restore the previous shortcuts or uninstall registration. See $logPath"
    }
  }

  if (-not $installationCompleted -and $startupConfigurationAttempted -and $restoredPreviousInstall) {
    try {
      $restoredInstallRoot = if ([string]::IsNullOrWhiteSpace($restoreTarget)) {
        if ([string]::IsNullOrWhiteSpace($backupRestoreRoot)) { $InstallRoot } else { $backupRestoreRoot }
      } else {
        $restoreTarget
      }
      $restoredAutoStartScript = Join-Path $restoredInstallRoot "install.ps1"
      if (Test-Path -LiteralPath $restoredAutoStartScript -PathType Leaf) {
        & $restoredAutoStartScript -Quiet
      } else {
        Write-Warning "The previous install was restored, but its automatic-startup script was not available."
      }
    } catch {
      Write-Warning "The previous install was restored, but its automatic-startup registration could not be restored. See $logPath"
    }
  }

  if (-not $Quiet) {
    Write-Host ""
    Write-Host "Installation failed. See $logPath" -ForegroundColor Red
  }
  throw $installationError
}
finally {
  Remove-DirectoryBestEffort $extractRoot $installerTempRoot "Extracted installer payload"
  if ($metadataRestoreFailed) {
    Write-Warning "Metadata rollback backup was retained at $metadataBackupRoot" -WarningAction Continue
  } else {
    Remove-DirectoryBestEffort $metadataBackupRoot $installerTempRoot "Installer metadata backup"
  }
  if (-not $installMoved) {
    Remove-DirectoryBestEffort $stagedInstallRoot $programsRoot "Staged install folder"
  }
  if ($installationCompleted) {
    Remove-DirectoryBestEffort $backupInstallRoot $programsRoot "Backup install folder"
  }
  try {
    Stop-Transcript | Out-Null
  } catch {
    Write-Warning "Installer transcript could not be closed cleanly. The durable log remains at $logPath" -WarningAction Continue
  }
}
