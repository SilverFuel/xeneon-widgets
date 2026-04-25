$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$configPath = Join-Path $scriptRoot "config.json"
$examplePath = Join-Path $scriptRoot "config.example.json"
$logPath = Join-Path $scriptRoot "bridge.log"
$stdoutPath = Join-Path $scriptRoot "bridge.stdout.log"
$stderrPath = Join-Path $scriptRoot "bridge.stderr.log"

if (-not (Test-Path $configPath)) {
  Copy-Item $examplePath $configPath
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
$port = [int]$config.port
$healthUrl = "http://127.0.0.1:$port/api/health"

function Test-BridgeListening {
  param(
    [int]$LocalPort
  )

  try {
    $listener = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction Stop
    return [bool]$listener
  } catch {
    return $false
  }
}

function Wait-ForBridge {
  param(
    [string]$Url,
    [int]$Attempts = 20,
    [int]$DelayMs = 500
  )

  for ($index = 0; $index -lt $Attempts; $index += 1) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return $true
      }
    } catch {
    }

    Start-Sleep -Milliseconds $DelayMs
  }

  return $false
}

if (Test-BridgeListening -LocalPort $port) {
  exit 0
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
Set-Location $repoRoot

"[$(Get-Date -Format s)] Starting XENEON bridge" | Out-File $logPath -Append -Encoding utf8
$process = Start-Process -FilePath $nodePath -ArgumentList @((Join-Path $scriptRoot "server.mjs")) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

if (Wait-ForBridge -Url $healthUrl) {
  "[$(Get-Date -Format s)] Bridge ready (PID $($process.Id))" | Out-File $logPath -Append -Encoding utf8
  exit 0
}

"[$(Get-Date -Format s)] Bridge failed to reach healthy state. See bridge.stderr.log" | Out-File $logPath -Append -Encoding utf8
try {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
} catch {
}
exit 1
