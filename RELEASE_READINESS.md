# Release Readiness

## Summary

Release-readiness pass run on branch `codex/coderabbit-release-readiness`.

- CodeRabbit runs:
  - Initial release-diff chunk review completed for `app`, `js`, and `widgets`.
  - CodeRabbit raised 2 issues, both in `widgets/setup-guide.html`.
  - Branch diff review after the CodeRabbit fix completed with 0 findings.
  - Final branch review after release-readiness checklist changes is blocked by CodeRabbit rate limiting. Multiple retries returned `errorType: rate_limit`; the latest retry on the `app` slice returned a wait time of 11 minutes and 5 seconds.
- Findings resolved:
  - P0: 0
  - P1: 2
  - P2: 0
- Tests and checks added:
  - `scripts/check-setup-guide.mjs`
  - `scripts/check-bridge-boundaries.mjs`
  - `scripts/check-observability.mjs`
  - `scripts/check-dependency-pins.mjs`
- Local validation passed:
  - `npm run audit:deps`
  - `npm run check`
  - `npm run release:ready`
  - `scripts/assert-release-ready.ps1 -AllowGitHubSupportPath -InstallerPath <built installer>`
  - `scripts/test-windows-install.ps1` non-mutating installed-app smoke check
- Exit criteria status:
  - Local audits, checks, artifact build, and release gates pass.
  - Final CodeRabbit zero-finding confirmation is not complete because CodeRabbit is rate-limiting the branch review.

## Resolved Findings

| CodeRabbit ID | Priority | File | Fix summary | Commit SHA |
| --- | --- | --- | --- | --- |
| CR-1 | P1 | `widgets/setup-guide.html` | Removed stale `settings` arguments from `getIntegrationState` and `summarizeIntegration` call sites; added a setup-guide validation check. | `e8cd0d9` |
| CR-2 | P1 | `widgets/setup-guide.html` | Added a general `.is-hidden { display: none; }` utility so hidden panels and buttons are actually hidden; added a setup-guide validation check. | `e8cd0d9` |

## Checklist Status

| Area | Status | Evidence |
| --- | --- | --- |
| Security | 🔧 fixed | Added root lockfile so root `npm audit` runs (`4e1ec27`), added `npm run audit:deps` for root npm, Electron npm, and NuGet audits in CI/release builds (`81d2247`), verified audits report 0 vulnerabilities, and ran a targeted secret-pattern scan with no credential-shaped matches. Local API origin restrictions and protected secret storage were already covered by `scripts/assert-release-ready.ps1`. |
| Reliability | 🔧 fixed | Added a 256 KiB JSON body limit to the legacy bridge, explicit HTTP 400/413 client errors, and generic HTTP 500 client messages (`0b09773`). Native host already had request body limits, localhost binding, external-call timeouts, and graceful stop handling. |
| Observability | 🔧 fixed | Added `X-Request-ID` response headers and structured `http_request` boundary logs with request ID, method, path, status, and duration for native and legacy local HTTP servers (`73bade9`). `/api/health` already exists for health/readiness. |
| Testing | 🔧 fixed | Added targeted validation checks for every fixed issue and wired them into `npm run check`: setup-guide state, bridge boundaries, observability, and dependency pins. `npm run check` passes. Existing installed-app smoke validation passes. |
| Documentation | 🔧 fixed | Added `.env.example` documenting no required normal-install env vars plus optional HWiNFO/macOS notarization variables (`81d2247`). Updated `CHANGELOG.md` for the release-readiness changes. README already covers install, configure, run, release, support, and cleanup paths. |
| Operational | 🔧 fixed | Built `app/dist/XenonEdgeHost-Setup-0.2.0-20260516-1349.exe` and matching `.sha256`. Added dependency audits to CI and release workflow (`81d2247`). Pinned Electron dependency ranges to exact locked versions and added a dependency-pin check (`c9d5578`). Windows runtime is per-user rather than root/container-based. |
| Performance | ✅ already satisfied | No measured hot path or obvious user-facing O(n²) issue was identified in the scoped changes, so no performance changes were made. |

## Known Limitations

- Final CodeRabbit review of the complete release-readiness branch is blocked by CodeRabbit rate limiting in this session. The last completed branch-diff CodeRabbit run, before the later checklist hardening commits, reported 0 findings.
- The Windows installer remains unsigned for the free beta; release readiness reports this as an expected beta warning.
- Support remains GitHub Issues and GitHub Security Advisories for the free beta; this is an expected beta warning.
- A destructive clean install/uninstall cycle on a fresh Windows profile or VM was not run in this local pass because a current-user installation already exists. The non-mutating installed-app smoke check passed.

## Suggested Follow-ups

1. Run `scripts/test-windows-install.ps1 -InstallerPath app/dist/<installer>.exe -RunInstall -QuietInstall -RunUninstall` in a disposable Windows VM or fresh profile before wider promotion.
2. Sign the Windows installer and executable before any paid/stable release.
3. Add monitored support and security inboxes before switching from free beta to paid/stable distribution.
