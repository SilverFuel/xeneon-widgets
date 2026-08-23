function Assert-ReleaseVersionMode {
  param(
    [Parameter(Mandatory = $true)][string]$Version,
    [switch]$AllowBetaVersion,
    [switch]$RequireSignedInstaller
  )

  if ($AllowBetaVersion -and $RequireSignedInstaller) {
    throw "Signed releases cannot use the beta-version allowance."
  }

  $stablePattern = '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
  $betaPattern = '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-beta\.(0|[1-9][0-9]*)$'
  if ($AllowBetaVersion) {
    if ($Version -notmatch $betaPattern) {
      throw "Unsigned beta mode requires a strict <major>.<minor>.<patch>-beta.<number> version."
    }
    return "beta"
  }

  if ($Version -notmatch $stablePattern) {
    throw "Default and signed release modes require a strict stable <major>.<minor>.<patch> version."
  }
  return "stable"
}
