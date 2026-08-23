param(
  [string]$OutputPath = "",
  [switch]$SkipPublish,
  [switch]$AllowDirtySource
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$projectPath = Join-Path $scriptRoot "XenonEdgeHost.csproj"
$publishDir = Join-Path $repoRoot "publish"
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Auxora-InstallerBuild-" + [guid]::NewGuid().ToString("N"))
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
$buildStampPath = Join-Path $repoRoot "build\build-stamp.props"
[xml]$buildStampXml = Get-Content -LiteralPath $buildStampPath -Raw
$expectedInformationalVersion = [string]$buildStampXml.Project.PropertyGroup.XenonInformationalVersion
if ([string]::IsNullOrWhiteSpace($expectedInformationalVersion)) {
  throw "build\build-stamp.props does not define XenonInformationalVersion."
}
$buildStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeVersion = $appVersion -replace '[^0-9A-Za-z._-]', '-'
$defaultOutputPath = Join-Path $distDir "Auxora-Setup-$safeVersion-$buildStamp.exe"
$outputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $defaultOutputPath
} else {
  [System.IO.Path]::GetFullPath($OutputPath)
}
$outputDirectory = Split-Path -Parent $outputPath
if ([System.IO.Path]::GetExtension($outputPath) -ne ".exe") {
  throw "OutputPath must end with .exe so the build script cannot overwrite an unrelated file type."
}
$sedPath = Join-Path $stageRoot "XenonEdgeHost-Setup.sed"
$installCmdPath = Join-Path $stageRoot "install.cmd"
$distReadmePath = Join-Path $distDir "README-install.txt"
$hashPath = "$outputPath.sha256"
$installScriptPath = Join-Path $installerScriptRoot "Install-XenonEdgeHost.ps1"
$webView2RuntimeProbePath = Join-Path $installerScriptRoot "WebView2RuntimeProbe.ps1"
$removeScriptPath = Join-Path $installerScriptRoot "Remove-XenonEdgeHost.ps1"
$supportInstallPath = Join-Path $scriptRoot "install.ps1"
$supportUninstallPath = Join-Path $scriptRoot "uninstall.ps1"
$supportSafeModePath = Join-Path $scriptRoot "Launch-XenonSafeMode.ps1"
$supportRepairPath = Join-Path $scriptRoot "repair.ps1"
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

function Remove-TemporaryPathBestEffort($path, $label) {
  try {
    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) {
      return
    }
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $path) {
      throw "$label still exists after cleanup."
    }
  } catch {
    Write-Warning "$label was retained at $path because cleanup failed: $($_.Exception.Message)" -WarningAction Continue
  }
}

function Remove-OwnedFinalFileBestEffort($path, $label) {
  try {
    if (-not (Test-Path -LiteralPath $path)) {
      return
    }
    Remove-Item -LiteralPath $path -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $path) {
      throw "$label still exists after cleanup."
    }
  } catch {
    Write-Warning "$label created by this build could not be removed after packaging failed. Retained at $path. $($_.Exception.Message)" -WarningAction Continue
  }
}

function New-IExpressSed($sourceDir, $targetPath, $sedPath) {
  $launchCommand = "cmd.exe /c install.cmd"
  $files = @(
    "install.cmd",
    "Install-XenonEdgeHost.ps1",
    "WebView2RuntimeProbe.ps1",
    "Remove-XenonEdgeHost.ps1",
    "install.ps1",
    "uninstall.ps1",
    "Launch-XenonSafeMode.ps1",
    "repair.ps1",
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
    "ShowInstallProgramWindow=0",
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
    "InstallPrompt=",
    "DisplayLicense=",
    "FinishMessage=",
    "FriendlyName=Auxora Setup",
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

$currentCommit = ""
$sourceStatus = @()
try {
  $currentCommit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $currentCommit -notmatch '^[0-9a-f]{40}$') {
    throw "Git did not return a valid HEAD commit."
  }
} catch {
  if (-not $AllowDirtySource) {
    throw "Installer builds require a Git checkout with a valid HEAD so executable identity can be verified. Use -AllowDirtySource only for a non-release development build."
  }
  Write-Warning "Building an unversioned development installer because -AllowDirtySource was supplied."
  $currentCommit = ""
}

if ($currentCommit -match '^[0-9a-f]{40}$') {
  $sourceStatus = @(& git -C $repoRoot status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0) {
    throw "Git source cleanliness could not be verified."
  }
  if ($sourceStatus.Count -gt 0 -and -not $AllowDirtySource) {
    throw "Installer builds require a clean working tree. Commit or remove source changes before packaging."
  }
  if ($sourceStatus.Count -gt 0) {
    Write-Warning "Building a dirty development installer because -AllowDirtySource was supplied."
  }
}

if ($SkipPublish -and -not $AllowDirtySource) {
  throw "-SkipPublish is allowed only for a non-release development build with -AllowDirtySource. Release installers must republish from the verified clean source."
}
if ($stageRoot -match '\s') {
  throw "IExpress requires a staging path without whitespace. Set TEMP to a writable path without spaces and run the build again."
}

if (-not $SkipPublish) {
  Write-Step "Publishing app"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptRoot "publish.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "publish.ps1 failed while preparing the installer."
  }
} else {
  Write-Step "Using existing publish output for a development-only installer"
}

if ($currentCommit -match '^[0-9a-f]{40}$') {
  $postPublishCommit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $postPublishCommit -notmatch '^[0-9a-f]{40}$') {
    throw "Git HEAD could not be rechecked after publish."
  }
  if (-not $postPublishCommit.Equals($currentCommit, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Git HEAD changed from $currentCommit to $postPublishCommit while publishing. Refusing to package mixed source."
  }

  $postPublishStatus = @(& git -C $repoRoot status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0) {
    throw "Git source cleanliness could not be rechecked after publish."
  }
  if (-not $AllowDirtySource -and $postPublishStatus.Count -gt 0) {
    throw "The working tree changed while publishing. Release installers require the same clean source before and after publish."
  }
  if ($AllowDirtySource -and (($sourceStatus -join "`n") -cne ($postPublishStatus -join "`n"))) {
    throw "The development working tree changed while publishing. Refusing to package mixed source."
  }
}

$publishedExePath = Join-Path $publishDir "XenonEdgeHost.exe"
if (-not (Test-Path $publishedExePath)) {
  throw "Publish output is missing XenonEdgeHost.exe"
}
$publishedVersionInfo = (Get-Item -LiteralPath $publishedExePath).VersionInfo
if ([string]$publishedVersionInfo.ProductName -cne "Auxora") {
  throw "Published executable ProductName must be Auxora; found '$($publishedVersionInfo.ProductName)'."
}
$publishedProductVersion = [string]$publishedVersionInfo.ProductVersion
$escapedInformationalVersion = [regex]::Escape($expectedInformationalVersion)
if ($publishedProductVersion -notmatch "^$escapedInformationalVersion(?:\.[0-9a-fA-F]{40})?$") {
  throw "Published executable ProductVersion '$publishedProductVersion' does not match build identity '$expectedInformationalVersion'. Re-run publish before packaging."
}
if ($currentCommit -match '^[0-9a-f]{40}$') {
  $expectedPublishedProductVersion = "$expectedInformationalVersion.$currentCommit"
  if (-not $publishedProductVersion.Equals($expectedPublishedProductVersion, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Published executable ProductVersion is not bound to current commit $currentCommit. Re-run publish before packaging."
  }
}

try {
  Write-Step "Preparing installer staging"
  if (Test-Path -LiteralPath $stageRoot) {
    throw "The unique installer staging path already exists: $stageRoot"
  }
  New-Item -ItemType Directory -Path $stageRoot -ErrorAction Stop | Out-Null
  if (@(Get-ChildItem -LiteralPath $stageRoot -Force -ErrorAction Stop).Count -ne 0) {
    throw "Installer staging was not empty immediately after creation: $stageRoot"
  }
  New-Item -ItemType Directory -Path $payloadRoot -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $distDir -Force | Out-Null
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

  Get-ChildItem $publishDir -Force | Where-Object { $_.Name -ne "XenonEdgeHost.exe.WebView2" } | ForEach-Object {
    if ($_.Name -eq "installer-build" -or $_.Name -eq "dist") {
      return
    }
    Copy-Item $_.FullName $payloadRoot -Recurse -Force
  }

  if (Test-Path $payloadZipPath) {
    throw "Fresh installer staging unexpectedly contains payload.zip: $payloadZipPath"
  }

  Compress-Archive -Path (Join-Path $payloadRoot "*") -DestinationPath $payloadZipPath -CompressionLevel Optimal
  Copy-Item $installScriptPath (Join-Path $stageRoot "Install-XenonEdgeHost.ps1") -Force
  Copy-Item $webView2RuntimeProbePath (Join-Path $stageRoot "WebView2RuntimeProbe.ps1") -Force
  Copy-Item $removeScriptPath (Join-Path $stageRoot "Remove-XenonEdgeHost.ps1") -Force
  Copy-Item $supportInstallPath (Join-Path $stageRoot "install.ps1") -Force
  Copy-Item $supportUninstallPath (Join-Path $stageRoot "uninstall.ps1") -Force
  Copy-Item $supportSafeModePath (Join-Path $stageRoot "Launch-XenonSafeMode.ps1") -Force
  Copy-Item $supportRepairPath (Join-Path $stageRoot "repair.ps1") -Force

@"
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-XenonEdgeHost.ps1" -Quiet -NoAutoStart -SkipLaunch
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Auxora setup did not finish. Setup did not launch Auxora or add login startup. See %LOCALAPPDATA%\Auxora\InstallerLogs\install.log; it will say if an older startup entry could not be removed.', 'Auxora Setup', 'OK', 'Error') | Out-Null" >nul 2>&1
)
endlocal & exit /b %EXITCODE%
"@ | Set-Content -Path $installCmdPath -Encoding ASCII

  Write-Step "Generating IExpress package"
  if ((Test-Path -LiteralPath $outputPath) -or (Test-Path -LiteralPath $hashPath)) {
    throw "Installer output or checksum already exists. Choose a new unique OutputPath; release candidates are never overwritten."
  }

  $iexpress = Get-Command iexpress.exe -ErrorAction SilentlyContinue
  if (-not $iexpress) {
    throw "iexpress.exe was not found. IExpress ships with Windows and is required to build the setup EXE."
  }

  $temporaryOutputPath = Join-Path $stageRoot ("Auxora-InstallerCandidate-" + [guid]::NewGuid().ToString("N") + ".exe")
  $temporaryHashPath = "$temporaryOutputPath.sha256"
  $movedInstallerToFinal = $false
  $movedHashToFinal = $false
  try {
    New-IExpressSed -sourceDir $stageRoot -targetPath $temporaryOutputPath -sedPath $sedPath
    $iexpressProcess = Start-Process $iexpress.Source -ArgumentList @("/N", "/Q", "/M", $sedPath) -Wait -PassThru
    if ($iexpressProcess.ExitCode -ne 0) {
      throw "IExpress failed with exit code $($iexpressProcess.ExitCode)."
    }

    if (-not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
      throw "IExpress did not produce the temporary installer."
    }

    $installerSize = (Get-Item -LiteralPath $temporaryOutputPath).Length
    $hash = Get-Sha256Hash $temporaryOutputPath
    Set-Content -LiteralPath $temporaryHashPath -Value "$hash  $(Split-Path -Leaf $outputPath)" -Encoding ASCII

    if ((Test-Path -LiteralPath $outputPath) -or (Test-Path -LiteralPath $hashPath)) {
      throw "Installer output appeared while packaging. Refusing to replace an existing candidate."
    }
    try {
      [System.IO.File]::Move($temporaryOutputPath, $outputPath)
      $movedInstallerToFinal = $true
      [System.IO.File]::Move($temporaryHashPath, $hashPath)
      $movedHashToFinal = $true
      if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf) -or -not (Test-Path -LiteralPath $hashPath -PathType Leaf)) {
        throw "Installer and checksum were not both present after the final move."
      }
    } catch {
      if ($movedHashToFinal) {
        Remove-OwnedFinalFileBestEffort $hashPath "Installer checksum"
      }
      if ($movedInstallerToFinal) {
        Remove-OwnedFinalFileBestEffort $outputPath "Installer candidate"
      }
      throw
    }
  } finally {
    Remove-TemporaryPathBestEffort $temporaryOutputPath "Temporary installer candidate"
    Remove-TemporaryPathBestEffort $temporaryHashPath "Temporary installer checksum"
  }

  @"
Auxora Installer

Run:
  $(Split-Path -Leaf $outputPath)

Install behavior:
  Run the EXE. Auxora installs for the current Windows user without setup questions.
  It stays closed and does not start at login. Open it from the Start Menu when ready.
  If setup cannot finish, a dialog points to %LOCALAPPDATA%\Auxora\InstallerLogs\install.log.
  Setup never adds login startup. The log identifies any older startup entry that could not be removed.

Installs to:
  %LOCALAPPDATA%\Programs\Auxora

Creates:
  - Start Menu > Auxora > Auxora
  - Start Menu recovery shortcuts with clear names
  - Desktop shortcut named Auxora
  - Apps & Features uninstall entry
  - Start Menu cleanup shortcut that removes local app data

Uninstall:
  Windows Settings > Apps > Installed apps > Auxora
  Or Start Menu > Auxora > Remove Auxora and Local Data
  Uninstall runs without additional cleanup questions.

SHA256:
  $hash

Verify before running:
  (Get-FileHash -Algorithm SHA256 '.\$(Split-Path -Leaf $outputPath)').Hash

  The result must exactly match the SHA256 above and the first hash field in the .sha256 file.
  If the filename or hash differs, do not run the installer; delete it and download it again from the official GitHub Release.

Note:
  This free beta installer is unsigned. Verify the official source, exact filename, and SHA256 before choosing to run it.
  Do not disable SmartScreen, Smart App Control, antivirus, or organization security policy. If Windows or policy blocks it, stop.
"@ | Set-Content -Path $distReadmePath -Encoding ASCII
} finally {
  Remove-TemporaryPathBestEffort $stageRoot "Installer staging directory"
}

Write-Host ""
Write-Host "Installer built successfully." -ForegroundColor Green
Write-Host "  Output: $outputPath"
Write-Host "  Size:   $([math]::Round($installerSize / 1MB, 1)) MB"
Write-Host "  SHA256: $hashPath"
Write-Host "  Notes:  $distReadmePath"
