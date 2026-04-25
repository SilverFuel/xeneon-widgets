param(
  [string]$SourceRoot = $PSScriptRoot,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\XenonEdgeHost"),
  [switch]$SkipLaunch,
  [switch]$NoAutoStart,
  [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"

$logRoot = Join-Path $env:LOCALAPPDATA "XenonEdgeHost\InstallerLogs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot "install.log"
Start-Transcript -Path $logPath -Append | Out-Null

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
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
      Write-Host "Stopped legacy node bridge process holding port 8976."
    }
  }
}

function Register-UninstallEntry($installPath, $exePath) {
  $uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\XenonEdgeHost"
  $version = (Get-Item $exePath).VersionInfo.FileVersion
  if (-not $version) {
    $version = "1.0.0"
  }

  $uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installPath\Remove-XenonEdgeHost.ps1`""
  New-Item -Path $uninstallKey -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "XENEON Edge Host" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value $version -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "SilverFuel" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $installPath -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value $exePath -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value $uninstallCommand -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "QuietUninstallString" -Value ($uninstallCommand + " -Quiet") -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null
}

function Assert-SafeInstallPath($installPath) {
  $programsRoot = Join-Path $env:LOCALAPPDATA "Programs"
  $resolvedProgramsRoot = [System.IO.Path]::GetFullPath($programsRoot).TrimEnd('\') + '\'
  $resolvedInstallPath = [System.IO.Path]::GetFullPath($installPath)
  if (-not $resolvedInstallPath.StartsWith($resolvedProgramsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "InstallRoot must stay under $resolvedProgramsRoot"
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

Assert-SafeInstallPath $InstallRoot
Write-Host "Install root: $InstallRoot"

Write-Step "Stopping running processes"
Get-Process XenonEdgeHost -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Stop-LegacyBridgeIfPresent

$extractRoot = Join-Path $env:TEMP ("XenonEdgeHost-Payload-" + [guid]::NewGuid().ToString("N"))
try {
  Write-Step "Extracting payload"
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  Expand-Archive -Path $payloadZip -DestinationPath $extractRoot -Force

  Write-Step "Copying app files"
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $InstallRoot -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $extractRoot "*") $InstallRoot -Recurse -Force
  Copy-Item $supportInstall (Join-Path $InstallRoot "install.ps1") -Force
  Copy-Item $supportUninstall (Join-Path $InstallRoot "uninstall.ps1") -Force
  Copy-Item $supportRemove (Join-Path $InstallRoot "Remove-XenonEdgeHost.ps1") -Force

  $exePath = Join-Path $InstallRoot "XenonEdgeHost.exe"
  if (-not (Test-Path $exePath)) {
    throw "Installed executable was not found at $exePath"
  }

  Write-Step "Creating Start Menu shortcuts"
  $shortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\XENEON Edge Host"
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
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\Remove-XenonEdgeHost.ps1`"" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  New-Shortcut `
    -shortcutPath (Join-Path $shortcutRoot "Uninstall and Remove Local Data.lnk") `
    -targetPath "powershell.exe" `
    -arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\Remove-XenonEdgeHost.ps1`" -RemoveLocalData" `
    -workingDirectory $InstallRoot `
    -iconLocation $exePath

  if (-not $NoDesktopShortcut) {
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
    & (Join-Path $InstallRoot "install.ps1")
  }

  if (-not $SkipLaunch) {
    Write-Step "Launching app"
    Start-Process $exePath
  }

  Write-Host ""
  Write-Host "Installed successfully." -ForegroundColor Green
  Write-Host "  App:      $exePath"
  Write-Host "  Uninstall: $InstallRoot\Remove-XenonEdgeHost.ps1"
}
catch {
  Write-Host ""
  Write-Host "Installation failed. See $logPath" -ForegroundColor Red
  throw
}
finally {
  Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  Stop-Transcript | Out-Null
}
