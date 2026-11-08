param([string]$Check = 'check')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$localSdk = Join-Path $repoRoot '.codex-sdk-8.0.424/dotnet'
$originalPath = $env:PATH
$originalRoot = $env:DOTNET_ROOT
$originalTestTimeout = $env:VSTEST_CONNECTION_TIMEOUT
Push-Location $repoRoot
try {
  # Fail promptly when the environment blocks testhost loopback communication.
  $env:VSTEST_CONNECTION_TIMEOUT = '20'
  if (Test-Path (Join-Path $localSdk 'dotnet.exe')) {
    $env:DOTNET_ROOT = $localSdk
    $env:PATH = "$localSdk;$originalPath"
  }
  & dotnet --version
  if ($LASTEXITCODE -ne 0) { throw 'The SDK required by global.json is unavailable.' }
  & npm.cmd run $Check
  if ($LASTEXITCODE -ne 0) { throw "Validation failed: $Check" }
} finally {
  $env:PATH = $originalPath
  $env:DOTNET_ROOT = $originalRoot
  $env:VSTEST_CONNECTION_TIMEOUT = $originalTestTimeout
  Pop-Location
}
