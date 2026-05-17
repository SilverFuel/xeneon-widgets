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
- Findings resolved:
  - P0: 0
  - P1: 6
  - P2: 2
- Scoped improvements completed:
  - Added local bridge API integration coverage for health, CORS rejection, invalid JSON, oversized JSON, and dashboard config writes.
  - Added a support-bundle redaction guard for native support bundle sanitization patterns.
  - Added a release gauntlet that runs dependency audits, repository checks, artifact validation, signature policy checks, and the readiness gate.
  - Fixed browser-bridge first-run setup status so display diagnostics and provisioning do not remain in generic fallback states.
  - Added Windows display topology and WebView process-failure recovery so monitor hotplug events reload the dashboard instead of leaving a blank WebView.
  - Fixed UniFi credential entry so detected-console refreshes do not interrupt username or password typing.
- Tests and checks added:
  - `scripts/check-setup-guide.mjs`
  - `scripts/check-bridge-boundaries.mjs`
  - `scripts/check-observability.mjs`
  - `scripts/check-dependency-pins.mjs`
  - `scripts/check-support-redaction.mjs`
  - `scripts/check-display-recovery.mjs`
  - `scripts/check-unifi-form-draft.mjs`
  - `scripts/test-bridge-api.mjs`
  - `scripts/run-release-gauntlet.ps1`
- Local validation passed:
  - `npm run audit:deps`
  - `npm run check`
  - `npm run release:gauntlet`
  - `npm run release:ready`
  - `scripts/assert-release-ready.ps1 -AllowGitHubSupportPath -InstallerPath <built installer>`
  - `scripts/test-windows-install.ps1` non-mutating installed-app smoke check
  - Browser visual QA at `2560x720` and `1280x720` using an isolated local bridge.
- Exit criteria status:
  - Local audits, checks, artifact build, and release gates pass.
  - Backend CodeRabbit confirmation is complete for `app` and `bridge`.
  - Full-branch CodeRabbit zero-finding confirmation is complete.

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

## Checklist Status

| Area | Status | Evidence |
| --- | --- | --- |
| Security | 🔧 fixed | Added root lockfile so root `npm audit` runs (`4e1ec27`), added `npm run audit:deps` for root npm, Electron npm, and NuGet audits in CI/release builds (`81d2247`), verified audits report 0 vulnerabilities, and ran a targeted secret-pattern scan with no credential-shaped matches. Local API origin restrictions and protected secret storage were already covered by `scripts/assert-release-ready.ps1`; bridge API CORS/body handling is now covered by `scripts/test-bridge-api.mjs` (`a911acd`). |
| Reliability | 🔧 fixed | Added a 256 KiB JSON body limit to the legacy bridge, explicit HTTP 400/413 client errors, and generic HTTP 500 client messages (`0b09773`). Guarded streamed bridge error handling after headers are sent (`fb6178a`). Added bridge API integration coverage and explicit browser-bridge setup states (`a911acd`, `629c9a8`). Added Windows display hotplug and WebView process-failure recovery (`b855bb9`). Native host already had request body limits, localhost binding, external-call timeouts, and graceful stop handling. |
| Observability | 🔧 fixed | Added `X-Request-ID` response headers and structured `http_request` boundary logs with request ID, method, path, status, and duration for native and legacy local HTTP servers (`73bade9`). `/api/health` already exists for health/readiness. |
| Testing | 🔧 fixed | Added targeted validation checks for every fixed issue and wired them into `npm run check`: setup-guide state, bridge boundaries, observability, dependency pins, support redaction, display/WebView recovery, UniFi credential form stability, and bridge API behavior. Validation scripts now resolve workspace files explicitly and fail with clear read errors. `npm run check` passes. Existing installed-app smoke validation passes. |
| Documentation | 🔧 fixed | Added `.env.example` documenting no required normal-install env vars plus optional HWiNFO/macOS notarization variables (`81d2247`). Updated `CHANGELOG.md` for the release-readiness changes. README already covers install, configure, run, release, support, and cleanup paths. |
| Operational | 🔧 fixed | Built `app/dist/XenonEdgeHost-Setup-0.2.0-20260516-1349.exe` and matching `.sha256`. Added dependency audits to CI and release workflow (`81d2247`) and an explicit CI `npm ci` install before audit/check steps (`c6f3c9c`). Added `npm run release:gauntlet` to run audits, checks, artifact validation, signature policy checks, and release readiness in one command (`1e66790`). Pinned Electron dependency ranges to exact locked versions and added a dependency-pin check (`c9d5578`). Windows runtime is per-user rather than root/container-based. |
| Performance | ✅ already satisfied | No measured hot path or obvious user-facing O(n²) issue was identified in the scoped changes, so no performance changes were made. |

## Known Limitations

- The Windows installer remains unsigned for the free beta; release readiness reports this as an expected beta warning.
- Support remains GitHub Issues and GitHub Security Advisories for the free beta; this is an expected beta warning.
- A destructive clean install/uninstall cycle on a fresh Windows profile or VM was not run in this local pass because a current-user installation already exists. The non-mutating installed-app smoke check passed.

## Suggested Follow-ups

1. Run `scripts/test-windows-install.ps1 -InstallerPath app/dist/<installer>.exe -RunInstall -QuietInstall -RunUninstall` in a disposable Windows VM or fresh profile before wider promotion.
2. Sign the Windows installer and executable before any paid/stable release.
3. Add monitored support and security inboxes before switching from free beta to paid/stable distribution.
