$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$path = Join-Path $PSScriptRoot '../app/installer/Install-XenonEdgeHost.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Installer script contains syntax errors.' }
$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Stop-RunningHost' }, $true)
Invoke-Expression $function.Extent.Text

# Isolate the installer function. No real processes are stopped by this fixture.
function Get-Process {
  param($Name, $Id, $ErrorAction)
  if ($Name -and $script:scenario -ne 'absent') { return [pscustomobject]@{ Id = 4242 } }
  if ($Id -and $script:scenario -eq 'denied') { return [pscustomobject]@{ Id = 4242 } }
}
function Stop-Process {
  param([Parameter(ValueFromPipeline=$true)]$InputObject, [switch]$Force)
  process { throw 'Access is denied (fixture)' }
}
function Write-Info { param($message) }

foreach ($scenario in @('absent', 'exited', 'denied')) {
  $script:scenario = $scenario
  $failure = $null
  try { Stop-RunningHost } catch { $failure = $_.Exception.Message }
  if ($scenario -eq 'denied') {
    if (!$failure -or $failure -notmatch '4242' -or $failure -notmatch 'Access is denied') {
      throw 'A live inaccessible host must block replacement and preserve its PID and cause.'
    }
  } elseif ($failure) { throw "Unexpected failure for ${scenario}: $failure" }
  Write-Host "PASS: $scenario"
}
