$ErrorActionPreference = "Stop"

$iexpress = Get-Command iexpress.exe -ErrorAction Stop
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("Auxora-IExpress-Test-" + [guid]::NewGuid().ToString("N"))
$sourceRoot = Join-Path $testRoot "source"

function Invoke-IExpressFixture($outputName) {
  $outputPath = Join-Path $testRoot $outputName
  $sedPath = Join-Path $testRoot ("$outputName.sed")
  $sed = @(
    "[Version]",
    "Class=IEXPRESS",
    "SEDVersion=3",
    "",
    "[Options]",
    "PackagePurpose=InstallApp",
    "ShowInstallProgramWindow=0",
    "HideExtractAnimation=1",
    "UseLongFileName=1",
    "InsideCompressed=0",
    "CAB_FixedSize=0",
    "CAB_ResvCodeSigning=0",
    "RebootMode=N",
    "InstallPrompt=%InstallPrompt%",
    "DisplayLicense=%DisplayLicense%",
    "FinishMessage=%FinishMessage%",
    "TargetName=$outputPath",
    "FriendlyName=%FriendlyName%",
    "AppLaunched=%AppLaunched%",
    "PostInstallCmd=<None>",
    "AdminQuietInstCmd=%QuietCommand%",
    "UserQuietInstCmd=%QuietCommand%",
    "SourceFiles=SourceFiles",
    "",
    "[Strings]",
    "InstallPrompt=",
    "DisplayLicense=",
    "FinishMessage=",
    "FriendlyName=Auxora IExpress Test",
    "AppLaunched=payload.cmd",
    "QuietCommand=payload.cmd",
    "FILE0=payload.cmd",
    "",
    "[SourceFiles]",
    "SourceFiles0=$sourceRoot\",
    "",
    "[SourceFiles0]",
    "%FILE0%="
  )
  Set-Content -LiteralPath $sedPath -Value $sed -Encoding ASCII

  $process = Start-Process $iexpress.Source -ArgumentList @("/N", "/Q", "/M", $sedPath) -Wait -PassThru
  $iexpressExitCode = $process.ExitCode
  if ($iexpressExitCode -ne 0) {
    throw "IExpress fixture '$outputName' failed with exit code $iexpressExitCode."
  }
  if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
    throw "IExpress fixture '$outputName' did not create its exact output path."
  }
}

try {
  New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $sourceRoot "payload.cmd") -Value "@exit /b 0" -Encoding ASCII
  Invoke-IExpressFixture "Auxora-IExpress-Test.exe"
  Invoke-IExpressFixture ".auxora-iexpress-test.exe"
  Write-Host "IExpress packaging supports no-whitespace staging and dot-prefixed temporary output names."
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
