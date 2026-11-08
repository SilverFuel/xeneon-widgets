$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\Json.ps1")

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
}

function Test-LexicalParser([string]$label, [scriptblock]$parse) {
  $json = '{"date":"2026-11-07T20:00:00.0000000-04:00","integer":1,"fraction":1.0,"numberString":"1","flag":true,"flagString":"true","missing":null,"empty":[],"single":["one"],"nested":[[],[null],{"date":"2026-11-08T00:00:00Z"}]}'
  $value = & $parse $json
  Assert-True ($value -is [pscustomobject]) "$label must return a JSON object."
  Assert-True ($value.date -is [string] -and $value.date -ceq '2026-11-07T20:00:00.0000000-04:00') "$label changed the timestamp's lexical form."
  Assert-True ($value.integer -is [int] -or $value.integer -is [long]) "$label changed an integer token."
  Assert-True ($value.fraction -is [double] -or $value.fraction -is [decimal]) "$label lost the fractional-form token."
  Assert-True ($value.numberString -is [string] -and $value.numberString -ceq '1') "$label coerced a numeric string."
  Assert-True ($value.flag -is [bool] -and $value.flag) "$label lost a Boolean token."
  Assert-True ($value.flagString -is [string] -and $value.flagString -ceq 'true') "$label coerced a Boolean string."
  Assert-True ($null -eq $value.missing) "$label lost a null token."
  Assert-True ($value.empty -is [array] -and $value.empty.Count -eq 0) "$label lost an empty array."
  Assert-True ($value.single -is [array] -and $value.single.Count -eq 1 -and $value.single[0] -ceq 'one') "$label unwrapped a singleton array."
  Assert-True ($value.nested.Count -eq 3 -and $value.nested[0] -is [array] -and $value.nested[0].Count -eq 0) "$label lost a nested empty array."
  Assert-True ($value.nested[1] -is [array] -and $value.nested[1].Count -eq 1 -and $null -eq $value.nested[1][0]) "$label lost a null array element."
  Assert-True ($value.nested[2].date -is [string] -and $value.nested[2].date -ceq '2026-11-08T00:00:00Z') "$label converted a nested date string."

  foreach ($invalid in @('{"unfinished":', '{"valid":true} {"extra":true}')) {
    $rejected = $false
    try { & $parse $invalid | Out-Null } catch { $rejected = $true }
    Assert-True $rejected "$label accepted invalid or multiple JSON documents."
  }
  Write-Host "OK: $label preserves JSON token types and rejects invalid documents"
}

Test-LexicalParser "default parser" { param($json) ConvertFrom-JsonPreservingLexicalTypes -Json $json }
if ($PSVersionTable.PSEdition -eq "Core") {
  & {
    function Get-Command {
      [CmdletBinding()]
      param([string]$Name)
      if ($Name -ne "ConvertFrom-Json") { throw "Unexpected command probe: $Name" }
      # Exercise the actual fallback routing on newer CI shells too.
      return [pscustomobject]@{ Parameters = @{} }
    }
    Test-LexicalParser "PowerShell Core without DateKind" { param($json) ConvertFrom-JsonPreservingLexicalTypes -Json $json }
  }
}
