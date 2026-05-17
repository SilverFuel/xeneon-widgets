# Release Readiness

## Summary

Release-readiness pass run for the current 0.2.0 beta release branch.

- CodeRabbit runs:
  - Initial release-diff chunk review completed for `app`, `js`, and `widgets`.
  - CodeRabbit raised 2 issues, both in `widgets/setup-guide.html`.
  - Branch diff review after the CodeRabbit fix completed with 0 findings.
  - Backend-scoped reruns completed with 0 findings for `app` and `bridge`.
  - A later `bridge` rerun raised 1 minor reliability issue in streamed error handling; it was fixed and the `bridge` rerun then completed with 0 findings.
  - Full branch review raised 2 later non-product-code issues in release checks/docs; both were fixed.
  - Final full branch review completed with 0 findings.
  - Post-improvement full branch review raised 1 public-changelog issue; it was fixed.
  - Final post-improvement full branch review completed with 0 findings.
  - User-reported UniFi credential-entry regression was fixed and covered before final packaging.
  - Post-UniFi CodeRabbit committed-diff review raised 2 minor issues; both were fixed and covered.
  - Final post-fix CodeRabbit committed-diff review completed with 0 findings.
  - User-reported Windows display-settings interference was mitigated by making monitor retargeting passive.
  - Post-display-safety CodeRabbit review raised 2 issues; both were fixed and covered.
  - Windows installer audit ran 5 focused passes across install transactions, cleanup safety, startup behavior, generated artifacts, and release validation.
  - Installer-scoped CodeRabbit review raised 2 major process-stop verification issues; both were fixed and the rerun completed with 0 findings.
  - Safe Mode and Repair installer recovery shortcuts were added and CodeRabbit reviewed the change with 0 findings.
  - Final committed CodeRabbit review raised 1 WebView recovery diagnostics issue; it was fixed and covered.
- Findings resolved:
  - P0: 0
  - P1: 9
  - P2: 4
- Scoped improvements completed:
  - Added local bridge API integration coverage for health, CORS rejection, invalid JSON, oversized JSON, and dashboard config writes.
  - Added a support-bundle redaction guard for native support bundle sanitization patterns.
  - Added a release gauntlet that runs dependency audits, repository checks, artifact validation, signature policy checks, and the readiness gate.
  - Fixed browser-bridge first-run setup status so display diagnostics and provisioning do not remain in generic fallback states.
  - Added Windows display topology and WebView process-failure recovery so monitor hotplug events reload the dashboard instead of leaving a blank WebView.
  - Fixed UniFi credential entry so detected-console refreshes do not interrupt username or password typing.
  - Disabled UniFi link controls during in-flight credential requests and guarded release-gauntlet signing mode arguments.
  - Stopped automatic monitor-change recovery from repositioning or saving display targets while Windows settings are changing.
  - Hardened Windows setup and removal so upgrades stop the running host deterministically, rollback preserves previous installs, `-NoAutoStart` removes stale startup entries, and cleanup paths stay under current-user install/data roots.
  - Added Launch Xenon Safe Mode and Repair XENEON Edge Host Start Menu shortcuts for display recovery and install self-healing without deleting local data.
- Tests and checks added:
  - `scripts/check-setup-guide.mjs`
  - `scripts/check-bridge-boundaries.mjs`
  - `scripts/check-observability.mjs`
  - `scripts/check-dependency-pins.mjs`
  - `scripts/check-support-redaction.mjs`
  - `scripts/check-display-recovery.mjs`
  - `scripts/check-unifi-form-draft.mjs`
  - `scripts/check-release-gauntlet.mjs`
  - `scripts/check-installer-safety.mjs`
  - `scripts/test-bridge-api.mjs`
  - `scripts/run-release-gauntlet.ps1`
- Local validation passed:
  - `npm run audit:deps`
  - `npm run check`
  - `npm run installer`
  - `npm run release:gauntlet`
  - `npm run release:ready`
  - `scripts/assert-release-ready.ps1 -AllowDirty -AllowGitHubSupportPath -InstallerPath app/dist/XenonEdgeHost-Setup-0.2.0-20260517-1942.exe`
  - Fresh installer SHA256 sidecar verification for `app/dist/XenonEdgeHost-Setup-0.2.0-20260517-1942.exe`
  - Source-to-staged installer script hash comparison for every packaged installer support script.
  - `scripts/test-windows-install.ps1` non-mutating installed-app smoke check
  - Browser visual QA at `2560x720` and `1280x720` using an isolated local bridge.
- Exit criteria status:
  - Local audits, checks, artifact build, and release gates pass.
  - Backend CodeRabbit confirmation is complete for `app` and `bridge`.
  - Full-branch CodeRabbit zero-finding confirmation is complete.
  - Installer-scoped CodeRabbit zero-finding confirmation is complete.
  - Recovery-shortcut CodeRabbit zero-finding confirmation is complete.

## Installer Audit Passes

| Pass | Scope | Result |
| --- | --- | --- |
| 1 | Installer artifact flow | Confirmed publish, staging, IExpress packaging, SHA256 sidecar generation, and source-to-staged script parity. Fixed IExpress exit-code handling and constrained output deletion to `.exe` targets. |
| 2 | Install transaction safety | Fixed failed-upgrade rollback so previous installs are restored or fresh partial installs are removed only after setup failure. |
| 3 | Uninstall and cleanup safety | Added exact-path cleanup, current-user path constraints, running-host shutdown before cleanup, root-task-only removal, and uninstaller exit-code smoke coverage. |
| 4 | Startup and upgrade behavior | Repaired stale/disabled scheduled tasks with forced re-registration, made `-NoAutoStart` remove existing startup integration, and made launch failure non-fatal after successful install. |
| 5 | Release validation and review | Added `scripts/check-installer-safety.mjs`, wired it into `npm run check`, rebuilt the installer, verified hashes/signature status, ran local gates, and reran CodeRabbit to 0 issues. |

## Resolved Findings

| CodeRabbit ID | Priority | File | Fix summary | Commit SHA |
| --- | --- | --- | --- | --- |
| CR-1 | P1 | `widgets/setup-guide.html` | Removed stale `settings` arguments from `getIntegrationState` and `summarizeIntegration` call sites; added a setup-guide validation check. | `e8cd0d9` |
| CR-2 | P1 | `widgets/setup-guide.html` | Added a general `.is-hidden { display: none; }` utility so hidden panels and buttons are actually hidden; added a setup-guide validation check. | `e8cd0d9` |
| CR-3 | P1 | `bridge/server.mjs` | Guarded the legacy bridge catch handler so it does not write a JSON error after streamed response headers are already sent; extended the bridge boundary check. | `fb6178a` |
| CR-4 | P1 | `scripts/check-bridge-boundaries.mjs` | Resolved workspace paths explicitly, checked file existence, and emitted clear read failures; applied the same robustness pattern to sibling validation scripts. | `dcb11e0` |
| CR-5 | P2 | `RELEASE_READINESS.md` | Removed environment-specific branch wording from the readiness report. | `ca75cff` |
| CR-6 | P1 | `CHANGELOG.md` | Replaced internal CI/tooling details in the public changelog with concise user-facing release notes while keeping technical specifics in this readiness report. | `c0d3474` |
| CR-7 | P2 | `app/MainWindow.xaml.cs` | Replaced the display-recovery async dispatcher lambda with an explicit fire-and-forget task assignment so exceptions remain contained in the Task-returning recovery method. | `9020892` |
| CR-8 | P1 | `.github/workflows/ci.yml` | Added an explicit `npm ci` step before dependency audit and repository checks so CI uses the locked dependency graph. | `c6f3c9c` |
| Improvement | P1 | `bridge/server.mjs` | Reported browser-bridge provisioning and display setup states explicitly so first-run diagnostics avoid stale fallback states; covered by bridge API integration test. | `629c9a8` |
| Improvement | P1 | `app/MainWindow.xaml.cs` | Added debounced Windows display-change recovery, non-persistent display retargeting during transient monitor changes, and WebView process-failure reload recovery. | `b855bb9` |
| User issue | P1 | `js/inline-widgets.js` | Paused Network widget polling while the UniFi credential form has focus, preserved transient form drafts across redraws, and prioritized the credential form when UniFi is detected but not linked. | `0203248` |
| CR-9 | P2 | `js/inline-widgets.js` | Disabled UniFi host, site, username, password, refresh, submit, and forget controls while link/disconnect requests are in flight; duplicate action handlers now return early while connecting. | `8006d6c` |
| CR-10 | P2 | `scripts/run-release-gauntlet.ps1` | Added early validation rejecting simultaneous `-RequireSignedInstaller` and `-AllowUnsignedBeta`; covered by a release-gauntlet validation check. | `8006d6c` |
| User issue | P1 | `app/MainWindow.xaml.cs` | Removed automatic Windows display-change retargeting and made startup/tray positioning non-persistent so Xenon does not fight Windows display defaults. | `c1bf008` |
| CR-11 | P0 | `app/MainWindow.xaml.cs` | Cleared the WebView recovery gate if dispatcher enqueue fails so future recovery attempts are not blocked. | `e7b8a6b` |
| CR-12 | P1 | `js/inline-widgets.js` | Tightened UniFi form focus detection so only editable credential fields pause polling; buttons and disabled/read-only controls no longer suppress redraws. | `e7b8a6b` |
| CR-13 | P1 | `app/installer/Install-XenonEdgeHost.ps1` | Verified stopped host processes actually exit before replacing install files, with a retry and clear failure path. | `5b07c15` |
| CR-14 | P1 | `app/installer/Remove-XenonEdgeHost.ps1` | Verified stopped host processes actually exit before uninstall cleanup, with a retry and clear failure path. | `5b07c15` |
| Installer audit | P1 | `app/build-installer.ps1`, `app/install.ps1`, `app/installer/Install-XenonEdgeHost.ps1`, `app/installer/Remove-XenonEdgeHost.ps1`, `app/uninstall.ps1`, `scripts/test-windows-install.ps1` | Hardened rollback, autostart repair, `-NoAutoStart`, exact cleanup paths, release workflow dependency installs, and installer safety regression checks. | `5b07c15` |
| Improvement | P1 | `app/AppLaunchOptions.cs`, `app/MainWindow.xaml.cs`, `app/Launch-XenonSafeMode.ps1`, `app/repair.ps1`, `app/installer/Install-XenonEdgeHost.ps1` | Added Safe Mode launch support, a Start Menu Safe Mode shortcut that disables auto-start and opens on the primary display, and a Repair shortcut that restores shortcuts/startup/uninstall registration without touching local data. | `24645d6` |
| CR-15 | P1 | `app/MainWindow.xaml.cs` | Reset the WebView diagnostics attachment flag before recovery reinitializes WebView2 so diagnostics handlers attach to the replacement CoreWebView2 instance. | `ecae443` |

## Checklist Status

| Area | Status | Evidence |
| --- | --- | --- |
| Security | 🔧 fixed | Added root lockfile so root `npm audit` runs (`4e1ec27`), added `npm run audit:deps` for root npm, Electron npm, and NuGet audits in CI/release builds (`81d2247`), verified audits report 0 vulnerabilities, and ran a targeted secret-pattern scan with no credential-shaped matches. Local API origin restrictions and protected secret storage were already covered by `scripts/assert-release-ready.ps1`; bridge API CORS/body handling is now covered by `scripts/test-bridge-api.mjs` (`a911acd`). |
| Reliability | 🔧 fixed | Added a 256 KiB JSON body limit to the legacy bridge, explicit HTTP 400/413 client errors, and generic HTTP 500 client messages (`0b09773`). Guarded streamed bridge error handling after headers are sent (`fb6178a`). Added bridge API integration coverage and explicit browser-bridge setup states (`a911acd`, `629c9a8`). WebView process-failure recovery remains, while automatic monitor-change retargeting was removed so Windows display settings remain authoritative (`c1bf008`). Native host already had request body limits, localhost binding, external-call timeouts, and graceful stop handling. |
| Observability | 🔧 fixed | Added `X-Request-ID` response headers and structured `http_request` boundary logs with request ID, method, path, status, and duration for native and legacy local HTTP servers (`73bade9`). `/api/health` already exists for health/readiness. |
| Testing | 🔧 fixed | Added targeted validation checks for every fixed issue and wired them into `npm run check`: setup-guide state, bridge boundaries, observability, dependency pins, support redaction, display/WebView recovery, UniFi credential form stability, release-gauntlet argument validation, installer safety, Safe Mode/Repair shortcut coverage, and bridge API behavior. Validation scripts now resolve workspace files explicitly and fail with clear read errors. `npm run check` passes. |
| Documentation | 🔧 fixed | Added `.env.example` documenting no required normal-install env vars plus optional HWiNFO/macOS notarization variables (`81d2247`). Updated `CHANGELOG.md` for the release-readiness changes. README already covers install, configure, run, release, support, and cleanup paths. |
| Operational | 🔧 fixed | Built `app/dist/XenonEdgeHost-Setup-0.2.0-20260517-1942.exe` and matching `.sha256`, verified the sidecar hash, and confirmed packaged support scripts match source. Added dependency audits to CI and release workflow (`81d2247`), explicit CI `npm ci` before audit/check (`c6f3c9c`), and release workflow lockfile installs before Windows/macOS packaging (`5b07c15`). Added `npm run release:gauntlet` to run audits, checks, artifact validation, signature policy checks, and release readiness in one command (`1e66790`). Pinned Electron dependency ranges to exact locked versions and added a dependency-pin check (`c9d5578`). Windows runtime is per-user rather than root/container-based. |
| Performance | ✅ already satisfied | No measured hot path or obvious user-facing O(n²) issue was identified in the scoped changes, so no performance changes were made. |

## Known Limitations

- The Windows installer remains unsigned for the free beta; release readiness reports this as an expected beta warning.
- Support remains GitHub Issues and GitHub Security Advisories for the free beta; this is an expected beta warning.
- A destructive clean install/uninstall cycle on a fresh Windows profile or VM was not run in this local pass because this machine intentionally has Xenon stopped and auto-start disabled. The installer smoke helper now validates startup integration when run in a disposable profile.

## Suggested Follow-ups

1. Run `scripts/test-windows-install.ps1 -InstallerPath app/dist/<installer>.exe -RunInstall -QuietInstall -RunUninstall` in a disposable Windows VM or fresh profile before wider promotion.
2. Sign the Windows installer and executable before any paid/stable release.
3. Add monitored support and security inboxes before switching from free beta to paid/stable distribution.
