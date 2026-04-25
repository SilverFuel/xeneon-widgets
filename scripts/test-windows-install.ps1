param(
  [string]$InstallerPath = "",
  [switch]$RunInstall,
  [switch]$RunUninstall,
  [switch]$RemoveLocalData
)

$ErrorActionPreference = "Stop"

$installRoot = Join-Path $env:LOCALAPPDATA "Programs\XenonEdgeHost"
$exePath = Join-Path $installRoot "XenonEdgeHost.exe"
$shortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\XENEON Edge Host"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "XENEON Edge Host.lnk"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\XenonEdgeHost"
$userDataRoot = Join-Path $env:APPDATA "XenonEdgeHost"
$localDataRoot = Join-Path $env:LOCALAPPDATA "XenonEdgeHost"

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

if ($RunInstall) {
  if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    throw "Pass -InstallerPath when using -RunInstall."
  }

  $resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
  Write-Step "Running installer"
  Start-Process -FilePath $resolvedInstaller -Wait
}

Write-Step "Checking installed app"
Assert-Present $exePath "Installed executable"
Assert-Present $shortcutRoot "Start Menu shortcut folder"
Assert-Present $desktopShortcut "Desktop shortcut"
Assert-Present $uninstallKey "Apps and Features uninstall entry"

$uninstallEntry = Get-ItemProperty -Path $uninstallKey
if ([string]::IsNullOrWhiteSpace($uninstallEntry.QuietUninstallString)) {
  throw "QuietUninstallString is missing from the uninstall entry."
}
Write-Host "OK: quiet uninstall command registered"

if ($RunUninstall) {
  Write-Step "Running uninstaller"
  $removeScript = Join-Path $installRoot "Remove-XenonEdgeHost.ps1"
  Assert-Present $removeScript "Uninstaller script"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $removeScript, "-Quiet") -Wait -WindowStyle Hidden
  Start-Sleep -Seconds 4

  Write-Step "Checking uninstall cleanup"
  Assert-Absent $exePath "Installed executable"
  Assert-Absent $shortcutRoot "Start Menu shortcut folder"
  Assert-Absent $desktopShortcut "Desktop shortcut"
  Assert-Absent $uninstallKey "Apps and Features uninstall entry"
}

if ($RemoveLocalData) {
  Write-Step "Removing current-user local data"
  foreach ($path in @($userDataRoot, $localDataRoot)) {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Recurse -Force
      Write-Host "Removed $path"
    }
  }
}

Write-Host ""
Write-Host "Windows install smoke test finished." -ForegroundColor Green
