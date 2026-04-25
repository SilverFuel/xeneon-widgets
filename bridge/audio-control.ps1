param(
  [ValidateSet("snapshot", "set-default", "set-master-volume", "set-master-mute", "set-session-volume", "set-session-mute")]
  [string]$Action = "snapshot",
  [string]$DeviceId = "",
  [string]$SessionId = "",
  [double]$Volume = -1,
  [string]$Muted = ""
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Join-Path $scriptRoot "audio-core.cs"
$assemblyPath = Join-Path $scriptRoot "AudioBridge.dll"

function Ensure-AudioAssembly {
  $compileNeeded = -not (Test-Path $assemblyPath)

  if (-not $compileNeeded) {
    $assemblyTime = (Get-Item $assemblyPath).LastWriteTimeUtc
    $sourceTime = (Get-Item $sourcePath).LastWriteTimeUtc
    $compileNeeded = $sourceTime -gt $assemblyTime
  }

  if ($compileNeeded) {
    if (Test-Path $assemblyPath) {
      Remove-Item $assemblyPath -Force
    }

    $typeDefinition = Get-Content $sourcePath -Raw
    Add-Type -TypeDefinition $typeDefinition -Language CSharp -OutputAssembly $assemblyPath -OutputType Library | Out-Null
  }

  Add-Type -Path $assemblyPath | Out-Null
}

function ConvertTo-SessionToken {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
  return $encoded.TrimEnd("=") -replace "\+", "-" -replace "/", "_"
}

function ConvertFrom-SessionToken {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  $base64 = $Value.Replace("-", "+").Replace("_", "/")
  switch ($base64.Length % 4) {
    2 { $base64 += "==" }
    3 { $base64 += "=" }
  }

  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($base64))
}

function ConvertTo-Boolean {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Muted value is required."
  }

  return @("1", "true", "yes", "on") -contains $Value.Trim().ToLowerInvariant()
}

function Resolve-OutputKind {
  param([string]$FriendlyName)

  $value = [string]$FriendlyName

  if ($value -match "headset|headphones|earphone") {
    return "headphones"
  }

  if ($value -match "tv|hdmi|display|nvidia") {
    return "display"
  }

  if ($value -match "digital output|spdif|optical") {
    return "digital"
  }

  if ($value -match "speaker") {
    return "speaker"
  }

  return "output"
}

function Resolve-SessionLabel {
  param($SessionRecord)

  if ($SessionRecord.IsSystemSounds) {
    return "System Sounds"
  }

  if (-not [string]::IsNullOrWhiteSpace($SessionRecord.DisplayName)) {
    if ($SessionRecord.DisplayName -like "@%SystemRoot*") {
      return "Windows Audio"
    }

    return $SessionRecord.DisplayName
  }

  if ($SessionRecord.ProcessId -gt 0) {
    try {
      $process = Get-Process -Id $SessionRecord.ProcessId -ErrorAction Stop
      if (-not [string]::IsNullOrWhiteSpace($process.MainWindowTitle)) {
        return $process.MainWindowTitle
      }

      if (-not [string]::IsNullOrWhiteSpace($process.ProcessName)) {
        return $process.ProcessName
      }
    } catch {
    }
  }

  return "Audio Session"
}

function Resolve-SessionDetail {
  param($SessionRecord)

  if ($SessionRecord.IsSystemSounds) {
    return "Windows notifications and shared system audio"
  }

  if ($SessionRecord.ProcessId -gt 0) {
    try {
      $process = Get-Process -Id $SessionRecord.ProcessId -ErrorAction Stop
      if ($process.Path) {
        return $process.Path
      }

      return "PID $($SessionRecord.ProcessId)"
    } catch {
      return "PID $($SessionRecord.ProcessId)"
    }
  }

  return $SessionRecord.State
}

function Get-AudioSnapshot {
  $raw = [Xeneon.Audio.AudioBridge]::GetSnapshot()
  $renderDeviceMap = @{}

  Get-PnpDevice -Class AudioEndpoint -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.InstanceId -like 'SWD\MMDEVAPI\{0.0.0.00000000}*' } |
    ForEach-Object {
      $id = ($_.InstanceId -replace '^SWD\\MMDEVAPI\\', '').ToLowerInvariant()
      $renderDeviceMap[$id] = $_
    }

  $devices = @(
    $raw.Devices |
      Where-Object {
        $_.IsDefault -or
        $renderDeviceMap.ContainsKey($_.Id.ToLowerInvariant()) -or
        $_.State -eq "Active"
      } |
      ForEach-Object {
        $deviceKey = $_.Id.ToLowerInvariant()
        $deviceInfo = if ($renderDeviceMap.ContainsKey($deviceKey)) { $renderDeviceMap[$deviceKey] } else { $null }
        $friendlyName = if ($deviceInfo) { $deviceInfo.FriendlyName } else { $_.Id }
        $availability = if ($_.State -eq "Active") { "Available" } elseif ($_.State -eq "Unplugged") { "Unplugged" } elseif ($_.State -eq "Disabled") { "Disabled" } else { $_.State }

        [pscustomobject]@{
          id = $_.Id
          name = $friendlyName
          state = $_.State
          availability = $availability
          isDefault = $_.IsDefault
          kind = Resolve-OutputKind $friendlyName
        }
      } |
      Sort-Object @{ Expression = { -not $_.isDefault } }, name
  )

  $sessions = @(
    $raw.Sessions |
      Where-Object {
        $_.State -ne "Expired" -and $_.Identifier
      } |
      ForEach-Object {
        $label = Resolve-SessionLabel $_
        [pscustomobject]@{
          id = ConvertTo-SessionToken $_.Identifier
          name = $label
          detail = Resolve-SessionDetail $_
          processId = [int]$_.ProcessId
          state = $_.State
          volume = [int]$_.Volume
          muted = [bool]$_.Muted
          active = $_.State -eq "Active"
          system = [bool]$_.IsSystemSounds
        }
      } |
      Sort-Object @{ Expression = { -not $_.active } }, system, name
  )

  [pscustomobject]@{
    defaultDeviceId = $raw.DefaultDeviceId
    masterVolume = [int]$raw.MasterVolume
    muted = [bool]$raw.Muted
    devices = $devices
    sessions = $sessions
    source = $raw.Source
    updatedAt = (Get-Date).ToString("o")
  }
}

Ensure-AudioAssembly

switch ($Action) {
  "snapshot" {
    Get-AudioSnapshot | ConvertTo-Json -Depth 6 -Compress
  }
  "set-default" {
    [Xeneon.Audio.AudioBridge]::SetDefaultDevice($DeviceId)
    [pscustomobject]@{ ok = $true } | ConvertTo-Json -Compress
  }
  "set-master-volume" {
    if ($Volume -lt 0) {
      throw "Volume is required."
    }

    [Xeneon.Audio.AudioBridge]::SetMasterVolume($DeviceId, [float]($Volume / 100))
    [pscustomobject]@{ ok = $true } | ConvertTo-Json -Compress
  }
  "set-master-mute" {
    [Xeneon.Audio.AudioBridge]::SetMasterMute($DeviceId, (ConvertTo-Boolean $Muted))
    [pscustomobject]@{ ok = $true } | ConvertTo-Json -Compress
  }
  "set-session-volume" {
    if ($Volume -lt 0) {
      throw "Volume is required."
    }

    $sessionIdentifier = ConvertFrom-SessionToken $SessionId
    [Xeneon.Audio.AudioBridge]::SetSessionVolume($DeviceId, $sessionIdentifier, [float]($Volume / 100))
    [pscustomobject]@{ ok = $true } | ConvertTo-Json -Compress
  }
  "set-session-mute" {
    $sessionIdentifier = ConvertFrom-SessionToken $SessionId
    [Xeneon.Audio.AudioBridge]::SetSessionMute($DeviceId, $sessionIdentifier, (ConvertTo-Boolean $Muted))
    [pscustomobject]@{ ok = $true } | ConvertTo-Json -Compress
  }
}
