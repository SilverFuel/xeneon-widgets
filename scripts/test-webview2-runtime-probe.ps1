$ErrorActionPreference = "Stop"

$probeScript = Join-Path $PSScriptRoot "..\app\installer\WebView2RuntimeProbe.ps1"
. $probeScript

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Auxora-WebView2-Probe-" + [guid]::NewGuid().ToString("N"))

function Invoke-ExpectedResult($label, [scriptblock]$command, [bool]$shouldPass) {
  $passed = $true
  $message = ""
  try {
    & $command | Out-Null
  } catch {
    $passed = $false
    $message = $_.Exception.Message
  }

  if ($passed -ne $shouldPass) {
    throw "$label expected pass=$shouldPass but pass=$passed. $message"
  }
  Write-Host "OK: $label"
}

try {
  New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $fixtureRoot "WebView2Loader.dll") -Value "fixture loader" -Encoding ASCII

  $recordedCalls = [System.Collections.Generic.List[object]]::new()
  $successfulProbe = {
    param($loaderPath, $browserExecutableFolder)
    $recordedCalls.Add([pscustomobject]@{
      LoaderPath = $loaderPath
      BrowserExecutableFolder = $browserExecutableFolder
    })
    return "151.0.4129.72"
  }

  $evergreen = Get-UsableWebView2Runtime $fixtureRoot $successfulProbe
  if ($evergreen.Kind -cne "Evergreen" -or $evergreen.Version -cne "151.0.4129.72") {
    throw "Evergreen fixture returned unexpected evidence."
  }
  if ($recordedCalls.Count -ne 1 -or $null -ne $recordedCalls[0].BrowserExecutableFolder) {
    throw "Evergreen fixture did not call the loader with a null browser folder."
  }
  Write-Host "OK: Evergreen uses the candidate loader Core API"

  $recordedCalls.Clear()
  $fixedRuntime = Join-Path $fixtureRoot "FixedRuntime\151.0.4129.72"
  New-Item -ItemType Directory -Path $fixedRuntime -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $fixedRuntime "msedgewebview2.exe") -Value "fixture runtime" -Encoding ASCII
  $fixed = Get-UsableWebView2Runtime $fixtureRoot $successfulProbe
  if ($fixed.Kind -cne "FixedRuntime" -or
      -not $fixed.RuntimePath.Equals([System.IO.Path]::GetFullPath($fixedRuntime), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "FixedRuntime fixture returned unexpected evidence."
  }
  if ($recordedCalls.Count -ne 1 -or
      -not ([string]$recordedCalls[0].BrowserExecutableFolder).Equals($fixed.RuntimePath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "FixedRuntime fixture did not pass the exact runtime folder to the loader Core API."
  }
  Write-Host "OK: FixedRuntime uses its exact browser folder"

  Invoke-ExpectedResult "zero version rejected" {
    Get-UsableWebView2Runtime $fixtureRoot { "0.0.0.0" }
  } $false
  Invoke-ExpectedResult "non-version response rejected" {
    Get-UsableWebView2Runtime $fixtureRoot { "present-in-registry" }
  } $false
  Invoke-ExpectedResult "loader API failure rejected" {
    Get-UsableWebView2Runtime $fixtureRoot { throw "Core API unavailable" }
  } $false

  Remove-Item -LiteralPath (Join-Path $fixtureRoot "WebView2Loader.dll") -Force
  Invoke-ExpectedResult "missing candidate loader rejected" {
    Get-UsableWebView2Runtime $fixtureRoot $successfulProbe
  } $false

  Initialize-WebView2LoaderInterop
  if (-not ("Auxora.Installer.WebView2LoaderProbe" -as [type])) {
    throw "The official WebView2 loader interop helper did not compile."
  }
  Write-Host "OK: official WebView2 loader interop compiles"
} finally {
  if (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}

Write-Host "checked fail-closed WebView2 runtime probe fixtures"
