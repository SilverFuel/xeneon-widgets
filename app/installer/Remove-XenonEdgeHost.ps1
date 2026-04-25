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

Write-Step "XENEON Edge Host - Remove"
Assert-SafeInstallPath $InstallRoot

$shortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\XENEON Edge Host"
$legacyShortcutRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Xenon Edge Host"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "XENEON Edge Host.lnk"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\XenonEdgeHost"
$cleanupTargets = @([System.IO.Path]::GetFullPath($InstallRoot))

if ($RemoveLocalData) {
  $cleanupTargets += Resolve-SafeLocalDataPath (Join-Path $env:APPDATA "XenonEdgeHost") $env:APPDATA
  $cleanupTargets += Resolve-SafeLocalDataPath (Join-Path $env:LOCALAPPDATA "XenonEdgeHost") $env:LOCALAPPDATA
}

Write-Step "Removing startup integration"
$uninstallScript = Join-Path $InstallRoot "uninstall.ps1"
if (Test-Path $uninstallScript) {
  & $uninstallScript
}

Write-Step "Removing shortcuts and uninstall registration"
if (Test-Path $shortcutRoot) {
  Remove-Item $shortcutRoot -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $legacyShortcutRoot) {
  Remove-Item $legacyShortcutRoot -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $desktopShortcut) {
  Remove-Item $desktopShortcut -Force -ErrorAction SilentlyContinue
}
if (Test-Path $uninstallKey) {
  Remove-Item $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
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

Set-Content -Path $cleanupScript -Value $cleanupContent -Encoding UTF8
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
