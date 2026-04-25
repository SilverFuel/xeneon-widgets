param(
  [switch]$WhatIf,
  [switch]$IncludeAssistantWorktrees
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$targets = @(
  "app\bin",
  "app\obj",
  "app\dist",
  "app\installer-build",
  "publish",
  "bridge\AudioBridge.dll",
  "bridge\bridge.log",
  "bridge\bridge.stderr.log",
  "bridge\bridge.stdout.log",
  "bridge\config.json"
)

if ($IncludeAssistantWorktrees) {
  $targets += ".claude"
}

Get-ChildItem -LiteralPath $repoRoot -Filter "tmp-*.png" -File -ErrorAction SilentlyContinue | ForEach-Object {
  $targets += $_.Name
}

function Resolve-CleanupTarget($relativePath) {
  $combined = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $combined)) {
    return $null
  }

  $resolved = Resolve-Path -LiteralPath $combined
  $rootPath = [System.IO.Path]::GetFullPath($repoRoot)
  $targetPath = [System.IO.Path]::GetFullPath($resolved)

  if (-not $targetPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean outside the repository: $targetPath"
  }

  return $targetPath
}

Write-Host "XENEON workspace cleanup"
Write-Host "Repo: $repoRoot"
Write-Host ""

$resolvedTargets = @()
foreach ($target in $targets) {
  $resolved = Resolve-CleanupTarget $target
  if ($resolved) {
    $resolvedTargets += $resolved
  }
}

if (-not $resolvedTargets.Count) {
  Write-Host "No generated files found."
  exit 0
}

Write-Host "Generated files/folders:"
$resolvedTargets | ForEach-Object { Write-Host "  $_" }
Write-Host ""

foreach ($target in $resolvedTargets) {
  if ($WhatIf) {
    Write-Host "Would remove: $target"
  } else {
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed: $target"
  }
}

if ($WhatIf) {
  Write-Host ""
  Write-Host "Dry run only. Run without -WhatIf to clean these files."
}
