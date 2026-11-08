$ErrorActionPreference = "Stop"

if (-not [Environment]::Is64BitOperatingSystem) {
  throw "Installer architecture tests require a 64-bit Windows system."
}
$installerPath = Join-Path $PSScriptRoot "..\app\installer\Install-XenonEdgeHost.ps1"
$installerSource = Get-Content -LiteralPath $installerPath -Raw
$prologueEnd = $installerSource.IndexOf('$logRoot =')
if ($prologueEnd -lt 0) { throw "The installer prologue could not be isolated." }
$prologue = $installerSource.Substring(0, $prologueEnd)
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("Auxora-Installer-Architecture-" + [guid]::NewGuid().ToString("N"))
$fixturePath = Join-Path $fixtureRoot "architecture fixture.ps1"
$receiptPath = Join-Path $fixtureRoot "receipt.json"
$x86PowerShell = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
$x64PowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $x86PowerShell -PathType Leaf)) {
  throw "The 32-bit Windows PowerShell fixture host is unavailable."
}

try {
  New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
  $fixtureBody = @'
[ordered]@{
  Is64Bit = [Environment]::Is64BitProcess
  SourceRoot = $SourceRoot
  InstallRoot = $InstallRoot
  SkipLaunch = $SkipLaunch.IsPresent
  NoAutoStart = $NoAutoStart.IsPresent
  NoDesktopShortcut = $NoDesktopShortcut.IsPresent
  Quiet = $Quiet.IsPresent
} | ConvertTo-Json -Compress | Set-Content -LiteralPath '__RECEIPT_PATH__' -Encoding UTF8
exit 73
'@
  $fixtureBody = $fixtureBody.Replace('__RECEIPT_PATH__', $receiptPath.Replace("'", "''"))
  Set-Content -LiteralPath $fixturePath -Value ($prologue + $fixtureBody) -Encoding UTF8
  $sourceRoot = Join-Path $fixtureRoot "source's folder\"
  $installRoot = Join-Path $fixtureRoot 'install $literal & folder'
  foreach ($processArchitecture in @("x86", "x64")) {
    $hostPath = if ($processArchitecture -eq "x86") { $x86PowerShell } else { $x64PowerShell }
    foreach ($switchMode in @("enabled", "omitted")) {
      # Encode only the fixture's entry command so the test can give a 32-bit
      # PowerShell exact path values, independent of the caller's native quoting.
      $fixtureCommand = '$ProgressPreference = "SilentlyContinue"; & ' + "'" + $fixturePath.Replace("'", "''") + "' -SourceRoot '" + $sourceRoot.Replace("'", "''") + "' -InstallRoot '" + $installRoot.Replace("'", "''") + "'"
      if ($switchMode -eq "enabled") { $fixtureCommand += " -SkipLaunch -NoAutoStart -NoDesktopShortcut -Quiet" }
      $fixtureCommand += '; exit $LASTEXITCODE'
      $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($fixtureCommand))
      $launchArguments = @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedCommand)
      # These are hidden console processes running only the isolated prologue.
      # The remainder of the real installer is never executed.
      $output = & $hostPath @launchArguments
      $fixtureExitCode = $LASTEXITCODE
      if ($fixtureExitCode -ne 73) { throw "$processArchitecture/$switchMode did not preserve the fixture exit code: $fixtureExitCode" }
      $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
      if (-not $receipt.Is64Bit -or $receipt.SourceRoot -cne $sourceRoot -or $receipt.InstallRoot -cne $installRoot) {
        throw "$processArchitecture/$switchMode changed process architecture or path parameters: $output"
      }
      foreach ($switchName in @("SkipLaunch", "NoAutoStart", "NoDesktopShortcut", "Quiet")) {
        if ($receipt.$switchName -ne ($switchMode -eq "enabled")) { throw "$processArchitecture/$switchMode changed $switchName." }
      }
      Write-Host "PASS: $processArchitecture/$switchMode uses x64, preserves paths/switches, and returns exit 73"
    }
  }
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
  if (-not $resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a fixture outside the temporary directory."
  }
  if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
