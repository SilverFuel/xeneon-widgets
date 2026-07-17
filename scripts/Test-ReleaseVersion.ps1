param([string]$ExpectedTag = "")

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
[xml]$project = Get-Content -LiteralPath (Join-Path $repoRoot "app\XenonEdgeHost.csproj")
$version = [string]$project.Project.PropertyGroup.Version
$fileVersion = [string]$project.Project.PropertyGroup.FileVersion
$desktopPackage = Get-Content -LiteralPath (Join-Path $repoRoot "desktop\electron\package.json") -Raw | ConvertFrom-Json
$desktopLockText = Get-Content -LiteralPath (Join-Path $repoRoot "desktop\electron\package-lock.json") -Raw
$revision = Get-Content -LiteralPath (Join-Path $repoRoot "assets\revision.json") -Raw | ConvertFrom-Json
[xml]$buildStamp = Get-Content -LiteralPath (Join-Path $repoRoot "build\build-stamp.props")
$stampRevision = [string]$buildStamp.Project.PropertyGroup.XenonAssetRevision
$stampVersion = [string]$buildStamp.Project.PropertyGroup.XenonInformationalVersion
$desktopPackageVersion = [string]$desktopPackage.version
$desktopLockVersions = @([regex]::Matches($desktopLockText, '(?m)^\s*"version"\s*:\s*"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
$desktopLockVersion = if ($desktopLockVersions.Count -gt 0) { $desktopLockVersions[0] } else { "" }
$desktopLockRootVersion = if ($desktopLockVersions.Count -gt 1) { $desktopLockVersions[1] } else { "" }
$revisionAsset = [string]$revision.assetRevision
$revisionVersion = [string]$revision.informationalVersion

if ($version -notmatch '^0\.3\.0-beta\.\d+$') {
  throw "Windows project version must be an explicit 0.3.0-beta.N SemVer."
}
if ($fileVersion -cne "0.3.0.0") {
  throw "Windows FileVersion must remain numeric 0.3.0.0."
}
if (($desktopPackageVersion -cne $version) -or
    ($desktopLockVersion -cne $version) -or
    ($desktopLockRootVersion -cne $version)) {
  throw "Windows and Electron project versions are not synchronized."
}
if (($revisionAsset -cne $stampRevision) -or
    ($revisionVersion -cne $stampVersion) -or
    ($revisionVersion -cne "$version+$($revisionAsset.Substring(0, 8))")) {
  throw "Build stamp, asset revision, and informational version are not synchronized."
}
if ($ExpectedTag -and $ExpectedTag -cne "v$version") {
  throw "Expected tag '$ExpectedTag' must exactly equal v$version."
}

$revisionFiles = @(
  "dashboard.html", "hosted-dashboard.html", "index.html", "bridge\install-bridge.ps1",
  "widgets\weather-widget.html", "widgets\network-widget.html", "widgets\media-widget.html", "widgets\setup-guide.html"
)
foreach ($relativePath in $revisionFiles) {
  $text = Get-Content -LiteralPath (Join-Path $repoRoot $relativePath) -Raw
  $found = [regex]::Matches($text, '\b20\d{6}-\d{2}\b') | ForEach-Object { $_.Value }
  if ($found.Count -eq 0 -or @($found | Where-Object { $_ -cne $stampRevision }).Count -gt 0) {
    throw "$relativePath does not use only synchronized asset revision $stampRevision."
  }
}

Write-Output $version
