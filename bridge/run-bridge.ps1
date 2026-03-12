$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$configPath = Join-Path $scriptRoot "config.json"
$examplePath = Join-Path $scriptRoot "config.example.json"
$logPath = Join-Path $scriptRoot "bridge.log"

if (-not (Test-Path $configPath)) {
  Copy-Item $examplePath $configPath
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
$port = [int]$config.port

try {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
  if ($listener) {
    exit 0
  }
} catch {
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
Set-Location $repoRoot

"[$(Get-Date -Format s)] Starting XENEON bridge" | Out-File $logPath -Append -Encoding utf8
& $nodePath (Join-Path $scriptRoot "server.mjs") *>> $logPath
