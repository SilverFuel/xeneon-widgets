$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$projectPath = Join-Path $scriptRoot "XenonEdgeHost.csproj"
$publishDir = Join-Path $repoRoot "publish"
$buildDir = Join-Path $scriptRoot "bin\\Release\\net8.0-windows10.0.19041.0\\win-x64"
$fixedRuntimeSource = Join-Path $scriptRoot "FixedRuntime"
$fixedRuntimePublish = Join-Path $publishDir "FixedRuntime"

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

Write-Step "XENEON Edge Host - Publish"

try {
  $null = Get-Command dotnet -ErrorAction Stop
} catch {
  Write-Host "The .NET SDK is required to build the host app." -ForegroundColor Red
  Write-Host ""
  Write-Host "Install the .NET 8 SDK from:"
  Write-Host "  https://dotnet.microsoft.com/en-us/download/dotnet/8.0" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "After installing, re-open this terminal and run this script again."
  exit 1
}

$sdkList = dotnet --list-sdks 2>&1
if ($LASTEXITCODE -ne 0 -or -not $sdkList -or $sdkList -match "No SDKs were found") {
  Write-Host "The .NET runtime is installed but no SDK was found." -ForegroundColor Red
  Write-Host ""
  Write-Host "Install the .NET 8 SDK from:"
  Write-Host "  https://dotnet.microsoft.com/en-us/download/dotnet/8.0" -ForegroundColor Yellow
  exit 1
}

Write-Step "Restoring packages"
dotnet restore $projectPath --runtime win-x64
if ($LASTEXITCODE -ne 0) {
  Write-Host "Package restore failed." -ForegroundColor Red
  exit 1
}

Write-Step "Publishing release build"
if (Test-Path $publishDir) {
  Remove-Item $publishDir -Recurse -Force
}

dotnet publish $projectPath `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -o $publishDir `
  /p:PublishSingleFile=false

if ($LASTEXITCODE -ne 0) {
  Write-Host "Publish failed." -ForegroundColor Red
  exit 1
}

Write-Step "Verifying WinUI and WebView2 support files"
$supportPatterns = @(
  "*.xbf",
  "*.pri"
)

foreach ($pattern in $supportPatterns) {
  Get-ChildItem $buildDir -Filter $pattern -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName $publishDir -Force
  }
}

$supportFiles = @(
  "WebView2Loader.dll",
  "Microsoft.Web.WebView2.Core.dll",
  "Microsoft.Web.WebView2.Core.Projection.dll"
)

foreach ($fileName in $supportFiles) {
  $sourcePath = Join-Path $buildDir $fileName
  if (Test-Path $sourcePath) {
    Copy-Item $sourcePath $publishDir -Force
  }
}

Write-Host "WinUI, Windows App SDK, .NET, and WebView2 support files are present in the publish output." -ForegroundColor Green

Write-Step "Syncing WebView2 runtime"
if (Test-Path $fixedRuntimePublish) {
  Remove-Item $fixedRuntimePublish -Recurse -Force
}

if (Test-Path $fixedRuntimeSource) {
  Copy-Item $fixedRuntimeSource $fixedRuntimePublish -Recurse -Force
  Write-Host "Bundled FixedRuntime copied to publish output." -ForegroundColor Green
} else {
  Write-Host "No app\\FixedRuntime folder was found." -ForegroundColor Yellow
  Write-Host "The published app will use the installed Evergreen WebView2 Runtime."
}

Write-Step "Verifying output"
$exePath = Join-Path $publishDir "XenonEdgeHost.exe"
if (-not (Test-Path $exePath)) {
  Write-Host "Expected output not found at $exePath" -ForegroundColor Red
  exit 1
}

$exeSize = (Get-Item $exePath).Length
$totalFiles = (Get-ChildItem $publishDir -Recurse -File).Count

Write-Host ""
Write-Host "Published successfully." -ForegroundColor Green
Write-Host "  Output:  $publishDir"
Write-Host "  Exe:     $exePath"
Write-Host "  Size:    $([math]::Round($exeSize / 1MB, 1)) MB"
Write-Host "  Files:   $totalFiles"
Write-Host ""
if (-not (Test-Path $fixedRuntimeSource)) {
  Write-Host "Optional bundled-WebView2 path:" -ForegroundColor Cyan
  Write-Host "  Extract the WebView2 Fixed Version runtime into app\\FixedRuntime\\<version>\\" -ForegroundColor Yellow
  Write-Host "  Then run publish.ps1 again to bundle it next to the exe." -ForegroundColor Yellow
  Write-Host "  Windows App SDK support files are bundled by the self-contained app build." -ForegroundColor Yellow
  Write-Host ""
}
Write-Host "Run the app:"
Write-Host "  $exePath" -ForegroundColor Yellow
Write-Host ""
Write-Host "Or install auto-start:"
Write-Host "  powershell -File `"$(Join-Path $scriptRoot 'install.ps1')`"" -ForegroundColor Yellow
