$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = $null
$repoRoot = $null

if (Test-Path (Join-Path $scriptRoot "XenonEdgeHost.exe")) {
  $appRoot = Resolve-Path $scriptRoot
} else {
  $repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
  $candidatePublishDir = Join-Path $repoRoot "publish"
  if (Test-Path (Join-Path $candidatePublishDir "XenonEdgeHost.exe")) {
    $appRoot = Resolve-Path $candidatePublishDir
  }
}

if (-not $appRoot) {
  Write-Host "Xenon Edge Host executable could not be found next to install.ps1 or in ..\\publish." -ForegroundColor Red
  exit 1
}

$appRoot = $appRoot.ToString()
$exePath = Join-Path $appRoot "XenonEdgeHost.exe"
$taskName = "XenonEdgeHost"
$runValueName = "XenonEdgeHost"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$webViewClientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

function Get-FixedRuntimePath($rootPath) {
  $fixedRoot = Join-Path $rootPath "FixedRuntime"
  if (-not (Test-Path $fixedRoot)) {
    return $null
  }

  $exe = Get-ChildItem $fixedRoot -Filter "msedgewebview2.exe" -File -Recurse -ErrorAction SilentlyContinue |
    Sort-Object `
      @{ Expression = {
          try { [version] $_.Directory.Name } catch { [version] "0.0" }
        }; Descending = $true },
      @{ Expression = { $_.FullName }; Descending = $false } |
    Select-Object -First 1

  if ($exe) {
    return $exe.Directory.FullName
  }

  return $null
}

function Get-InstalledWebView2Version() {
  $registryPaths = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$webViewClientId",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$webViewClientId",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$webViewClientId"
  )

  foreach ($path in $registryPaths) {
    $value = (Get-ItemProperty -Path $path -Name "pv" -ErrorAction SilentlyContinue).pv
    if ($value -and $value -ne "0.0.0.0") {
      return $value
    }
  }

  return $null
}

function Test-WindowsAppRuntimeInstalled() {
  $packages = Get-AppxPackage Microsoft.WindowsAppRuntime.1.8* -ErrorAction SilentlyContinue
  return [bool]($packages | Select-Object -First 1)
}

Write-Step "XENEON Edge Host - Install Auto-Start"

Write-Host "App root: $appRoot"

if (-not (Test-Path $exePath)) {
  Write-Host "Published app not found at:" -ForegroundColor Red
  Write-Host "  $exePath"
  Write-Host ""
  if ($repoRoot) {
    Write-Host "Run the publish script first:"
    Write-Host "  powershell -File `"$(Join-Path $scriptRoot 'publish.ps1')`"" -ForegroundColor Yellow
  } else {
    Write-Host "Reinstall or copy the published app files into this folder."
  }
  exit 1
}

# --- Scheduled task (primary auto-start method) ---

$taskInstalled = $false

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  $taskInstalled = $true
  Write-Host "Scheduled task '$taskName' is already installed."
} else {
  try {
    $action = New-ScheduledTaskAction -Execute $exePath -WorkingDirectory $appRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -StartWhenAvailable `
      -MultipleInstances IgnoreNew `
      -ExecutionTimeLimit (New-TimeSpan -Hours 0)

    Register-ScheduledTask `
      -TaskName $taskName `
      -Action $action `
      -Trigger $trigger `
      -Settings $settings `
      -Description "Starts Xenon Edge Host at logon for the CORSAIR XENEON EDGE display." `
      -Force | Out-Null

    $taskInstalled = $true
    Write-Host "Installed scheduled task '$taskName'."
  } catch {
    Write-Warning "Unable to install scheduled task '$taskName'. Falling back to startup entry only."
  }
}

# --- Registry Run key (backup auto-start method) ---

New-Item -Path $runKeyPath -Force | Out-Null

if ($taskInstalled) {
  if (Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue
    Write-Host "Removed startup entry '$runValueName' because the scheduled task will handle auto-start."
  } else {
    Write-Host "Scheduled task '$taskName' will handle auto-start."
  }
} else {
  New-ItemProperty -Path $runKeyPath -Name $runValueName -PropertyType String -Value "`"$exePath`"" -Force | Out-Null
  Write-Host "Installed startup entry '$runValueName'."
}

# --- Remove old bridge-only auto-start if present ---

$oldBridgeTask = "XeneonBridge"
$oldBridgeRun = "XeneonBridge"

if (Get-ScheduledTask -TaskName $oldBridgeTask -ErrorAction SilentlyContinue) {
  try {
    Unregister-ScheduledTask -TaskName $oldBridgeTask -Confirm:$false
    Write-Host "Removed old bridge-only task '$oldBridgeTask' (the host app manages the bridge now)."
  } catch {
    if ($_.Exception.Message -match "Access is denied") {
      Write-Warning "Old bridge task '$oldBridgeTask' still exists and requires an elevated PowerShell session to remove."
      Write-Warning "Run as Administrator: Unregister-ScheduledTask -TaskName '$oldBridgeTask' -TaskPath '\' -Confirm:`$false"
    } else {
      Write-Warning "Old bridge task '$oldBridgeTask' exists but could not be removed."
    }
  }
}

if (Get-ItemProperty -Path $runKeyPath -Name $oldBridgeRun -ErrorAction SilentlyContinue) {
  Remove-ItemProperty -Path $runKeyPath -Name $oldBridgeRun -ErrorAction SilentlyContinue
  Write-Host "Removed old bridge-only startup entry '$oldBridgeRun'."
}

# --- WebView2 runtime checks ---

$fixedRuntimePath = Get-FixedRuntimePath $appRoot
if ($fixedRuntimePath) {
  Write-Step "Configuring bundled WebView2 runtime"

  $isWindows10 = [Environment]::OSVersion.Version.Build -lt 22000
  if ($isWindows10) {
    try {
      & icacls.exe $fixedRuntimePath /grant "*S-1-15-2-2:(OI)(CI)(RX)" | Out-Null
      $grantAppPackagesExitCode = $LASTEXITCODE
      & icacls.exe $fixedRuntimePath /grant "*S-1-15-2-1:(OI)(CI)(RX)" | Out-Null
      $grantRestrictedPackagesExitCode = $LASTEXITCODE

      if ($grantAppPackagesExitCode -eq 0 -and $grantRestrictedPackagesExitCode -eq 0) {
        Write-Host "Granted the required AppContainer read permissions to the bundled FixedRuntime folder."
      } else {
        Write-Warning "icacls did not complete successfully. WebView2 may fail to start until the FixedRuntime permissions are granted."
      }
    } catch {
      Write-Warning "Unable to apply the required FixedRuntime permissions automatically. WebView2 may fail to start until they are granted."
    }
  } else {
    Write-Host "Bundled FixedRuntime detected. No extra Windows 11 permission changes were needed."
  }
} else {
  $webViewVersion = Get-InstalledWebView2Version
  if ($webViewVersion) {
    Write-Host "Using installed Evergreen WebView2 Runtime $webViewVersion."
  } else {
    Write-Warning "No bundled FixedRuntime folder was found and no installed Evergreen WebView2 Runtime was detected."
    Write-Warning "Install WebView2 from https://developer.microsoft.com/en-us/microsoft-edge/webview2/ or bundle app\\FixedRuntime before publishing."
  }
}

if (Test-WindowsAppRuntimeInstalled) {
  Write-Host "Detected Windows App Runtime 1.8."
} else {
  Write-Warning "Windows App Runtime 1.8 was not detected. On first launch, the bootstrapper may prompt to install it."
}

# --- Done ---

Write-Host ""
Write-Host "Auto-start installed." -ForegroundColor Green
Write-Host "The XENEON Edge Host will launch after login."
Write-Host ""
Write-Host "To start it now:"
Write-Host "  Start-Process `"$exePath`"" -ForegroundColor Yellow
