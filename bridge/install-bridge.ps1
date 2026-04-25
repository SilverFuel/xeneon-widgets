$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$taskName = "XeneonBridge"
$taskDescription = "Starts the local bridge for XENEON real-time widgets at logon."
$runValueName = "XeneonBridge"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$runScriptPath = Join-Path $scriptRoot "run-bridge.ps1"
$configPath = Join-Path $scriptRoot "config.json"
$examplePath = Join-Path $scriptRoot "config.example.json"

if (-not (Test-Path $configPath)) {
  Copy-Item $examplePath $configPath
}

$null = Get-Command node -ErrorAction Stop
$powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source

$argument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runScriptPath`""
$runCommand = "`"$powerShellPath`" $argument"
$taskInstalled = $false

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  $taskInstalled = $true
  Write-Host "Scheduled task '$taskName' is already installed."
} else {
  try {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description $taskDescription -Force | Out-Null
    $taskInstalled = $true
    Write-Host "Installed scheduled task '$taskName'."
  } catch {
    Write-Warning "Unable to install scheduled task '$taskName'. Falling back to the current-user startup entry."
  }
}

New-Item -Path $runKeyPath -Force | Out-Null
New-ItemProperty -Path $runKeyPath -Name $runValueName -PropertyType String -Value $runCommand -Force | Out-Null
Write-Host "Installed startup entry '$runValueName'."

if ($taskInstalled) {
  try {
    Start-ScheduledTask -TaskName $taskName
  } catch {
    Write-Warning "Scheduled task '$taskName' is installed but could not be started right now."
  }
} else {
  Start-Process -FilePath $powerShellPath -ArgumentList @(
    "-NoProfile",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $runScriptPath
  ) -WindowStyle Hidden | Out-Null
}

Write-Host "The bridge will start automatically at logon."
Write-Host "iCUE URL: http://127.0.0.1:8976/dashboard.html?v=20260425-4"
