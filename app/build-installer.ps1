param(
  [string]$OutputPath = "",
  [switch]$SkipPublish
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$projectPath = Join-Path $scriptRoot "XenonEdgeHost.csproj"
$publishDir = Join-Path $repoRoot "publish"
$stageRoot = Join-Path $scriptRoot "installer-build"
$payloadRoot = Join-Path $stageRoot "payload"
$distDir = Join-Path $scriptRoot "dist"
$installerScriptRoot = Join-Path $scriptRoot "installer"
$appVersion = "local"
try {
  [xml]$projectXml = Get-Content -Path $projectPath -Raw
  $versionNode = $projectXml.Project.PropertyGroup | Select-Object -First 1
  if ($versionNode -and -not [string]::IsNullOrWhiteSpace($versionNode.Version)) {
    $appVersion = $versionNode.Version
  }
} catch {
  $appVersion = "local"
}
$buildStamp = Get-Date -Format "yyyyMMdd-HHmm"
$safeVersion = $appVersion -replace '[^0-9A-Za-z._-]', '-'
$defaultOutputPath = Join-Path $distDir "XenonEdgeHost-Setup-$safeVersion-$buildStamp.exe"
$outputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $defaultOutputPath
} else {
  [System.IO.Path]::GetFullPath($OutputPath)
}
$outputDirectory = Split-Path -Parent $outputPath
$sedPath = Join-Path $stageRoot "XenonEdgeHost-Setup.sed"
$installCmdPath = Join-Path $stageRoot "install.cmd"
$distReadmePath = Join-Path $distDir "README-install.txt"
$hashPath = "$outputPath.sha256"
$installScriptPath = Join-Path $installerScriptRoot "Install-XenonEdgeHost.ps1"
$removeScriptPath = Join-Path $installerScriptRoot "Remove-XenonEdgeHost.ps1"
$supportInstallPath = Join-Path $scriptRoot "install.ps1"
$supportUninstallPath = Join-Path $scriptRoot "uninstall.ps1"
$payloadZipPath = Join-Path $stageRoot "payload.zip"

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

function Get-Sha256Hash($path) {
  $hashCommand = Get-Command Get-FileHash -ErrorAction SilentlyContinue
  if ($hashCommand) {
    return (Get-FileHash -Path $path -Algorithm SHA256).Hash
  }

  $stream = [System.IO.File]::OpenRead($path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function New-IExpressSed($sourceDir, $targetPath, $sedPath) {
  $launchCommand = "cmd.exe /c install.cmd"
  $files = @(
    "install.cmd",
    "Install-XenonEdgeHost.ps1",
    "Remove-XenonEdgeHost.ps1",
    "install.ps1",
    "uninstall.ps1",
    "payload.zip"
  )

  $strings = @()
  $sourceEntries = @()
  for ($index = 0; $index -lt $files.Count; $index++) {
    $strings += "FILE$index=$($files[$index])"
    $sourceEntries += "%FILE$index%="
  }

  $sed = @(
    "[Version]",
    "Class=IEXPRESS",
    "SEDVersion=3",
    "",
    "[Options]",
    "PackagePurpose=InstallApp",
    "ShowInstallProgramWindow=1",
    "HideExtractAnimation=1",
    "UseLongFileName=1",
    "InsideCompressed=0",
    "CAB_FixedSize=0",
    "CAB_ResvCodeSigning=0",
    "RebootMode=N",
    "InstallPrompt=%InstallPrompt%",
    "DisplayLicense=%DisplayLicense%",
    "FinishMessage=%FinishMessage%",
    "TargetName=$targetPath",
    "FriendlyName=%FriendlyName%",
    "AppLaunched=%AppLaunched%",
    "PostInstallCmd=<None>",
    "AdminQuietInstCmd=%QuietCommand%",
    "UserQuietInstCmd=%QuietCommand%",
    "SourceFiles=SourceFiles",
    "",
    "[Strings]",
    "InstallPrompt=Install XENEON Edge Host for the current Windows user?",
    "DisplayLicense=",
    "FinishMessage=XENEON Edge Host setup has finished.",
    "FriendlyName=XENEON Edge Host Setup",
    "AppLaunched=$launchCommand",
    "QuietCommand=$launchCommand"
  ) + $strings + @(
    "",
    "[SourceFiles]",
    "SourceFiles0=$sourceDir\",
    "",
    "[SourceFiles0]"
  ) + $sourceEntries

  Set-Content -Path $sedPath -Value $sed -Encoding ASCII
}

if (-not $SkipPublish) {
  Write-Step "Publishing app"
  Get-Process XenonEdgeHost -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptRoot "publish.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "publish.ps1 failed while preparing the installer."
  }
} else {
  Write-Step "Using existing publish output"
}

if (-not (Test-Path (Join-Path $publishDir "XenonEdgeHost.exe"))) {
  throw "Publish output is missing XenonEdgeHost.exe"
}

Write-Step "Preparing installer staging"
Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

Get-ChildItem $publishDir -Force | Where-Object { $_.Name -ne "XenonEdgeHost.exe.WebView2" } | ForEach-Object {
  if ($_.Name -eq "installer-build" -or $_.Name -eq "dist") {
    return
  }
  Copy-Item $_.FullName $payloadRoot -Recurse -Force
}

if (Test-Path $payloadZipPath) {
  Remove-Item $payloadZipPath -Force
}

Compress-Archive -Path (Join-Path $payloadRoot "*") -DestinationPath $payloadZipPath -CompressionLevel Optimal
Copy-Item $installScriptPath (Join-Path $stageRoot "Install-XenonEdgeHost.ps1") -Force
Copy-Item $removeScriptPath (Join-Path $stageRoot "Remove-XenonEdgeHost.ps1") -Force
Copy-Item $supportInstallPath (Join-Path $stageRoot "install.ps1") -Force
Copy-Item $supportUninstallPath (Join-Path $stageRoot "uninstall.ps1") -Force

@"
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-XenonEdgeHost.ps1"
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
"@ | Set-Content -Path $installCmdPath -Encoding ASCII

Write-Step "Generating IExpress package"
if (Test-Path $outputPath) {
  Remove-Item $outputPath -Force
}

$iexpress = Get-Command iexpress.exe -ErrorAction SilentlyContinue
if (-not $iexpress) {
  throw "iexpress.exe was not found. IExpress ships with Windows and is required to build the setup EXE."
}

New-IExpressSed -sourceDir $stageRoot -targetPath $outputPath -sedPath $sedPath
Start-Process $iexpress.Source -ArgumentList @("/N", "/Q", "/M", $sedPath) -Wait

if (-not (Test-Path $outputPath)) {
  throw "IExpress did not produce the installer at $outputPath"
}

$installerSize = (Get-Item $outputPath).Length
$hash = Get-Sha256Hash $outputPath
Set-Content -Path $hashPath -Value "$hash  $(Split-Path -Leaf $outputPath)" -Encoding ASCII

@"
XENEON Edge Host Installer

Run:
  $(Split-Path -Leaf $outputPath)

Installs to:
  %LOCALAPPDATA%\Programs\XenonEdgeHost

Creates:
  - Start Menu shortcuts
  - Desktop shortcut
  - current-user auto-start entry
  - Apps & Features uninstall entry
  - Start Menu cleanup shortcut that removes local app data

Uninstall:
  Windows Settings > Apps > Installed apps > XENEON Edge Host
  Or Start Menu > XENEON Edge Host > Uninstall and Remove Local Data

SHA256:
  $hash

Note:
  This installer is unsigned until you add a code-signing step. Windows may show a SmartScreen warning for unsigned public releases.
"@ | Set-Content -Path $distReadmePath -Encoding ASCII

Write-Host ""
Write-Host "Installer built successfully." -ForegroundColor Green
Write-Host "  Output: $outputPath"
Write-Host "  Size:   $([math]::Round($installerSize / 1MB, 1)) MB"
Write-Host "  SHA256: $hashPath"
Write-Host "  Notes:  $distReadmePath"
