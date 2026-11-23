<#
.SYNOPSIS
Tells Claude Code on this PC to report to Auxora, so the EDGE can show when a session is
working, finished, or waiting on a decision.

.DESCRIPTION
Adds hooks to Claude Code's user settings (%USERPROFILE%\.claude\settings.json). Each hook
sends Claude Code's own event to Auxora on this PC (127.0.0.1) and nothing else. Hooks that
are already there are kept. The settings file is copied to a backup first.

Run it again any time: it replaces its own entries and never adds them twice.

.PARAMETER Remove
Takes Auxora's hooks back out and leaves everything else as it is.

.PARAMETER Test
Sends Auxora a pretend "waiting on a decision" report for ten seconds, so you can see the
amber bar on the EDGE without starting Claude Code. Changes no settings.

.PARAMETER Port
The port Auxora listens on. 8976 unless you changed it.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File addons\ClaudeCode\Install-ClaudeCodeHooks.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File addons\ClaudeCode\Install-ClaudeCodeHooks.ps1 -Test
#>
param(
    [switch]$Remove,
    [switch]$Test,
    [int]$Port = 8976,
    [string]$SettingsPath = (Join-Path $HOME '.claude\settings.json')
)

$ErrorActionPreference = 'Stop'
$base = "http://127.0.0.1:$Port"
$url = "$base/api/claude-code/event"
$marker = '/api/claude-code/event'

function Send-Report($body) {
    $json = $body | ConvertTo-Json -Depth 6 -Compress
    Invoke-WebRequest -Uri $url -Method Post -ContentType 'application/json' -Body $json -UseBasicParsing -TimeoutSec 3 | Out-Null
}

function Test-Auxora {
    try {
        $reply = Invoke-WebRequest -Uri "$base/api/claude-code" -UseBasicParsing -TimeoutSec 3
        return ($reply.StatusCode -eq 200)
    } catch {
        return $false
    }
}

if ($Test) {
    if (-not (Test-Auxora)) {
        throw "Auxora did not answer at $base/api/claude-code. Start Auxora, and make sure it is a build that has the Claude Code chip."
    }
    $session = 'auxora-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $folder = Join-Path $HOME 'auxora-test'
    Send-Report @{ session_id = $session; cwd = $folder; hook_event_name = 'PermissionRequest'; tool_name = 'Bash'; tool_input = @{ command = 'echo This is only a test' } }
    Write-Host 'Sent. The EDGE should show an amber "Claude needs you" bar within a few seconds.'
    Write-Host 'It clears itself in ten seconds.'
    Start-Sleep -Seconds 10
    Send-Report @{ session_id = $session; cwd = $folder; hook_event_name = 'SessionEnd' }
    Write-Host 'Cleared.'
    return
}

# The events Auxora listens to. A value is the matcher; empty means every time the event fires.
$events = [ordered]@{
    SessionStart       = ''
    SessionEnd         = ''
    UserPromptSubmit   = ''
    Stop               = ''
    StopFailure        = ''
    PermissionRequest  = ''
    PostToolUse        = ''
    PostToolUseFailure = ''
    Notification       = 'permission_prompt|idle_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input'
    PreToolUse         = 'AskUserQuestion|ExitPlanMode'
}

function Test-IsOurs($group) {
    if ($null -eq $group) { return $false }
    $handlers = @($group.hooks)
    foreach ($handler in $handlers) {
        if ($null -ne $handler -and "$($handler.url)".Contains($marker)) { return $true }
    }
    return $false
}

function Set-Property($object, [string]$name, $value) {
    if ($null -ne $object.PSObject.Properties[$name]) {
        $object.$name = $value
    } else {
        $object | Add-Member -NotePropertyName $name -NotePropertyValue $value
    }
}

# Read what is there. A file that is not plain JSON is left alone.
$settingsFolder = Split-Path -Parent $SettingsPath
$existed = Test-Path -LiteralPath $SettingsPath
$settings = New-Object psobject
if ($existed) {
    $text = [System.IO.File]::ReadAllText($SettingsPath)
    if ($text.Trim().Length -gt 0) {
        try {
            $settings = $text | ConvertFrom-Json
        } catch {
            throw "Could not read $SettingsPath as JSON, so nothing was changed. $($_.Exception.Message)"
        }
        if ($null -eq $settings -or $settings -isnot [psobject] -or $settings -is [array]) {
            throw "$SettingsPath does not hold a settings object, so nothing was changed."
        }
    }
}

if ($null -eq $settings.PSObject.Properties['hooks'] -or $null -eq $settings.hooks) {
    Set-Property $settings 'hooks' (New-Object psobject)
}
$hooks = $settings.hooks

# Take our entries out of every event, then (unless removing) put the current ones in.
$names = @($hooks.PSObject.Properties | ForEach-Object { $_.Name })
foreach ($name in $names) {
    $kept = @(@($hooks.$name) | Where-Object { -not (Test-IsOurs $_) })
    if ($kept.Count -eq 0) {
        $hooks.PSObject.Properties.Remove($name)
    } else {
        $hooks.$name = $kept
    }
}

if (-not $Remove) {
    foreach ($name in $events.Keys) {
        $handler = [pscustomobject]@{ type = 'http'; url = $url; timeout = 2 }
        if ($events[$name]) {
            $group = [pscustomobject]@{ matcher = $events[$name]; hooks = @($handler) }
        } else {
            $group = [pscustomobject]@{ hooks = @($handler) }
        }
        $kept = @()
        if ($null -ne $hooks.PSObject.Properties[$name]) { $kept = @($hooks.$name) }
        Set-Property $hooks $name (@($kept) + @($group))
    }
}

if (@($hooks.PSObject.Properties).Count -eq 0) {
    $settings.PSObject.Properties.Remove('hooks')
}

# Write to a new file, read it back to be sure it is still JSON, then swap it in.
$json = $settings | ConvertTo-Json -Depth 64
$null = $json | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $settingsFolder)) {
    New-Item -ItemType Directory -Path $settingsFolder | Out-Null
}
if ($existed) {
    $backup = "$SettingsPath.auxora-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item -LiteralPath $SettingsPath -Destination $backup
    Write-Host "Backup: $backup"
}
$temporary = "$SettingsPath.auxora-new"
[System.IO.File]::WriteAllText($temporary, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
Move-Item -LiteralPath $temporary -Destination $SettingsPath -Force

if ($Remove) {
    Write-Host "Auxora's hooks are out of $SettingsPath."
    Write-Host 'Sessions already open keep reporting until they are closed.'
    return
}

Write-Host "Auxora's hooks are in $SettingsPath."
Write-Host 'Start a new Claude Code session for them to take effect; sessions already open do not pick them up.'
if (Test-Auxora) {
    Write-Host "Auxora answered at $base. To see the bar on the EDGE now, run this again with -Test."
} else {
    Write-Host "Auxora did not answer at $base/api/claude-code. Start Auxora, or install a build that has the Claude Code chip."
}
