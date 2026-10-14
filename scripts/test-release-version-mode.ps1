$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\ReleaseVersionMode.ps1")

$cases = @(
  @{ Name = "default stable"; Version = "1.2.3"; AllowBeta = $false; Signed = $false; Pass = $true },
  @{ Name = "default beta"; Version = "1.2.3-beta.1"; AllowBeta = $false; Signed = $false; Pass = $false },
  @{ Name = "unsigned beta"; Version = "1.2.3-beta.1"; AllowBeta = $true; Signed = $false; Pass = $true },
  @{ Name = "unsigned beta mode with stable"; Version = "1.2.3"; AllowBeta = $true; Signed = $false; Pass = $false },
  @{ Name = "signed stable"; Version = "1.2.3"; AllowBeta = $false; Signed = $true; Pass = $true },
  @{ Name = "signed beta"; Version = "1.2.3-beta.1"; AllowBeta = $false; Signed = $true; Pass = $false },
  @{ Name = "signed beta conflicting flags"; Version = "1.2.3-beta.1"; AllowBeta = $true; Signed = $true; Pass = $false },
  @{ Name = "stable leading-zero major"; Version = "01.2.3"; AllowBeta = $false; Signed = $false; Pass = $false },
  @{ Name = "beta leading-zero identifier"; Version = "1.2.3-beta.01"; AllowBeta = $true; Signed = $false; Pass = $false },
  @{ Name = "stable Unicode digit"; Version = "1.2.3١"; AllowBeta = $false; Signed = $false; Pass = $false },
  @{ Name = "beta Unicode digit"; Version = "1.2.3-beta.1١"; AllowBeta = $true; Signed = $false; Pass = $false }
)

foreach ($case in $cases) {
  $passed = $true
  try {
    Assert-ReleaseVersionMode -Version $case.Version -AllowBetaVersion:$case.AllowBeta -RequireSignedInstaller:$case.Signed | Out-Null
  } catch {
    $passed = $false
  }
  if ($passed -ne $case.Pass) {
    throw "Release version mode fixture failed: $($case.Name). Expected pass=$($case.Pass), actual pass=$passed."
  }
  Write-Host "OK: $($case.Name)"
}

Write-Host "checked strict release version mode matrix"
