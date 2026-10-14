param(
  [switch]$Quiet,
  [switch]$RuntimeOnly
)

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
  throw "Auxora executable could not be found next to install.ps1 or in ..\publish."
}

$appRoot = $appRoot.ToString()
$exePath = Join-Path $appRoot "XenonEdgeHost.exe"
$taskName = "XenonEdgeHost"
$runValueName = "XenonEdgeHost"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

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

function Write-QuietWarning($message) {
  if (-not $Quiet) {
    Write-Warning $message
  }
}

function Test-WindowsAppRuntimeInstalled() {
  $packages = Get-AppxPackage Microsoft.WindowsAppRuntime.1.8* -ErrorAction SilentlyContinue
  return [bool]($packages | Select-Object -First 1)
}

function Get-RootScheduledTask($taskName) {
  return Get-ScheduledTask -TaskName $taskName -TaskPath "\" -ErrorAction SilentlyContinue
}

function Enable-XenonStartupTask($taskName) {
  Enable-ScheduledTask -TaskName $taskName -TaskPath "\" -ErrorAction Stop | Out-Null

  $task = Get-RootScheduledTask $taskName
  if ($task -and $task.State -eq "Disabled") {
    & schtasks.exe /Change /TN "\$taskName" /ENABLE | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "schtasks could not enable scheduled task '$taskName' (exit code $LASTEXITCODE)."
    }
  }

  $task = Get-RootScheduledTask $taskName
  if (-not $task -or $task.State -eq "Disabled") {
    throw "Scheduled task '$taskName' is still disabled after repair."
  }
}

if ($RuntimeOnly) {
  Write-Step "Auxora - Repair Runtime"
} else {
  Write-Step "Auxora - Install Auto-Start"
}

Write-Info "App root: $appRoot"

if (-not (Test-Path $exePath)) {
  Write-Info "Published app not found at:"
  Write-Info "  $exePath"
  Write-Info ""
  if ($repoRoot) {
    Write-Info "Run the publish script first:"
    Write-Info "  powershell -File `"$(Join-Path $scriptRoot 'publish.ps1')`""
  } else {
    Write-Info "Reinstall or copy the published app files into this folder."
  }
  throw "Auxora executable was not found at $exePath."
}

$runtimeProbeScript = @(
  (Join-Path $appRoot "WebView2RuntimeProbe.ps1"),
  (Join-Path $scriptRoot "WebView2RuntimeProbe.ps1"),
  (Join-Path $scriptRoot "installer\WebView2RuntimeProbe.ps1")
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($runtimeProbeScript)) {
  throw "WebView2RuntimeProbe.ps1 is missing. Reinstall Auxora before repairing runtime support."
}
. $runtimeProbeScript

# --- WebView2 runtime checks ---

try {
  $webView2Runtime = Get-UsableWebView2Runtime $appRoot
} catch {
  throw "Auxora could not prove a usable WebView2 runtime with its shipped loader. Install or repair Microsoft Edge WebView2 Runtime, then try again. $($_.Exception.Message)"
}

if ($webView2Runtime.Kind -ceq "FixedRuntime") {
  Write-Step "Configuring bundled WebView2 runtime"
  $fixedRuntimePath = $webView2Runtime.RuntimePath

  $isWindows10 = [Environment]::OSVersion.Version.Build -lt 22000
  if ($isWindows10) {
    try {
      & icacls.exe $fixedRuntimePath /grant "*S-1-15-2-2:(OI)(CI)(RX)" | Out-Null
      $grantAppPackagesExitCode = $LASTEXITCODE
      & icacls.exe $fixedRuntimePath /grant "*S-1-15-2-1:(OI)(CI)(RX)" | Out-Null
      $grantRestrictedPackagesExitCode = $LASTEXITCODE

      if ($grantAppPackagesExitCode -ne 0 -or $grantRestrictedPackagesExitCode -ne 0) {
        throw "icacls did not grant the required AppContainer read permissions to the bundled FixedRuntime folder."
      }
      Write-Info "Granted the required AppContainer read permissions to the bundled FixedRuntime folder."
    } catch {
      throw "Unable to apply the required FixedRuntime permissions automatically: $($_.Exception.Message)"
    }
  } else {
    Write-Info "Bundled FixedRuntime detected. No extra Windows 11 permission changes were needed."
  }
} else {
  Write-Info "Verified installed Evergreen WebView2 Runtime $($webView2Runtime.Version) with the shipped WebView2 loader."
}

# --- Scheduled task (primary auto-start method) ---

if (-not $RuntimeOnly) {
$taskInstalled = $false

try {
  $action = New-ScheduledTaskAction -Execute $exePath -WorkingDirectory $appRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $trigger.Delay = "PT20S"
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
    -Description "Starts Auxora at logon on the user's selected Windows display." `
    -Force | Out-Null

  Enable-XenonStartupTask $taskName
  $taskInstalled = $true
  Write-Info "Installed or repaired scheduled task '$taskName'."
} catch {
  Write-QuietWarning "Unable to install scheduled task '$taskName'. Falling back to startup entry only."
}

# --- Registry Run key (backup auto-start method) ---

New-Item -Path $runKeyPath -Force | Out-Null

if ($taskInstalled) {
  if (Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue
    Write-Info "Removed startup entry '$runValueName' because the scheduled task will handle auto-start."
  } else {
    Write-Info "Scheduled task '$taskName' will handle auto-start."
  }
} else {
  New-ItemProperty -Path $runKeyPath -Name $runValueName -PropertyType String -Value "`"$exePath`"" -Force | Out-Null
  Write-Info "Installed startup entry '$runValueName'."
}

# --- Remove old bridge-only auto-start if present ---

$oldBridgeTask = "XeneonBridge"
$oldBridgeRun = "XeneonBridge"

if (Get-RootScheduledTask $oldBridgeTask) {
  try {
    Unregister-ScheduledTask -TaskName $oldBridgeTask -TaskPath "\" -Confirm:$false
    Write-Info "Removed old bridge-only task '$oldBridgeTask' (the host app manages the bridge now)."
  } catch {
    if ($_.Exception.Message -match "Access is denied") {
      Write-QuietWarning "Old bridge task '$oldBridgeTask' still exists and requires an elevated PowerShell session to remove."
      Write-QuietWarning "Run as Administrator: Unregister-ScheduledTask -TaskName '$oldBridgeTask' -TaskPath '\' -Confirm:`$false"
    } else {
      Write-QuietWarning "Old bridge task '$oldBridgeTask' exists but could not be removed."
    }
  }
}

if (Get-ItemProperty -Path $runKeyPath -Name $oldBridgeRun -ErrorAction SilentlyContinue) {
  Remove-ItemProperty -Path $runKeyPath -Name $oldBridgeRun -ErrorAction SilentlyContinue
  Write-Info "Removed old bridge-only startup entry '$oldBridgeRun'."
}
}

if (Test-WindowsAppRuntimeInstalled) {
  Write-Info "Detected Windows App Runtime 1.8."
} else {
  Write-QuietWarning "Windows App Runtime 1.8 was not detected. On first launch, the bootstrapper may prompt to install it."
}

# --- Done ---

if (-not $Quiet) {
  Write-Host ""
  if ($RuntimeOnly) {
    Write-Host "Runtime checks repaired without changing automatic startup." -ForegroundColor Green
  } else {
    Write-Host "Auto-start installed." -ForegroundColor Green
    Write-Host "Auxora will launch after login."
    Write-Host ""
    Write-Host "To start it now:"
    Write-Host "  Start Menu > Auxora > Auxora" -ForegroundColor Yellow
  }
}
