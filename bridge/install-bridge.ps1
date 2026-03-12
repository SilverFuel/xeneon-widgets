$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$taskName = "XeneonBridge"
$taskDescription = "Starts the local bridge for XENEON real-time widgets at logon."
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$runScriptPath = Join-Path $scriptRoot "run-bridge.ps1"
$configPath = Join-Path $scriptRoot "config.json"
$examplePath = Join-Path $scriptRoot "config.example.json"

if (-not (Test-Path $configPath)) {
  Copy-Item $examplePath $configPath
}

$null = Get-Command node -ErrorAction Stop

$argument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runScriptPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description $taskDescription -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Installed scheduled task '$taskName'."
Write-Host "The bridge will start automatically at logon."
Write-Host "iCUE URL: http://127.0.0.1:8976/dashboard.html?v=20260312-4"
