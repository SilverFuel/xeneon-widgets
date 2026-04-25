$ErrorActionPreference = "Stop"

$taskName = "XeneonBridge"
$runValueName = "XeneonBridge"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task '$taskName'."
  } catch {
    Write-Warning "Unable to remove scheduled task '$taskName'."
  }
} else {
  Write-Host "Scheduled task '$taskName' was not installed."
}

if (Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue) {
  Remove-ItemProperty -Path $runKeyPath -Name $runValueName
  Write-Host "Removed startup entry '$runValueName'."
} else {
  Write-Host "Startup entry '$runValueName' was not installed."
}
