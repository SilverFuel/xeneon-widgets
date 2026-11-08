# Validation results

43 of 49 required stages passed after the documented test updates. The remaining 6 stages failed or aborted. The complete suite is not green; no rendered or physical qualification is claimed.

The literal `npm run check` stopped at an assertion for the retired camera navigation implementation. That assertion was replaced with an execution test of the real resolver and hydration controller. All later required stages were then run serially and logged individually, rather than being skipped because of the earlier failure. The three adapted stages were rerun successfully.

- Camera Detection: exact routing, hidden-section and hydrated repaint behavior replaced two implementation-string checks; security and renderer checks remain.
- Commercial evidence: diagnostic whitespace is normalized before checking both missing-file messages, nonzero exit, and the exact three-blocker summary. The production gate is unchanged.
- Audit coverage: full-width geometry and preserved legacy-layout data replace retired width-cap/control names; all panel, viewport, Network-state, focus and accessibility requirements remain.

Source/test commit before this results document: `db4684bf250ff8a6d508b3fd2ba8a07187fac4d0`. Compiled host source: `52ae8de623a5c2f3ce2b7da97193e5a7986403de`; subsequent changes were tests and documentation. Asset revision: `20261108-02`.

| Required stage | Result | Evidence log |
| --- | --- | --- |
| `check:js` | Passed | `npm-check.log` |
| `test:wow-forever` | Passed | `npm-check.log` |
| `test:tmog` | Passed | `npm-check.log` |
| `check:theme-contract` | Passed | `npm-check.log` |
| `test:constellation-theme` | Passed | `npm-check.log` |
| `check:standalone-theme` | Passed | `npm-check.log` |
| `check:setup-guide` | Passed | `npm-check.log` |
| `test:setup-secrets` | Passed | `npm-check.log` |
| `check:bridge-boundaries` | Passed | `npm-check.log` |
| `check:observability` | Passed | `npm-check.log` |
| `check:frontend-performance` | Passed | `npm-check.log` |
| `check:settings-handlers` | Passed | `npm-check.log` |
| `check:quick-controls` | Passed | `npm-check.log` |
| `check:album-carousel` | Passed | `npm-check.log` |
| `check:dependency-pins` | Passed | `npm-check.log` |
| `check:support-redaction` | Passed | `npm-check.log` |
| `check:display-recovery` | Passed | `npm-check.log` |
| `test:display-receipt` | Passed | `npm-check.log` |
| `check:unifi-form` | Passed | `npm-check.log` |
| `check:camera-detection` | Passed after update | `check-camera-detection-retry.log` |
| `test:frigate-standalone-refresh` | Passed | `test-frigate-standalone-refresh.log` |
| `test:frigate-receipt` | Passed | `test-frigate-receipt.log` |
| `check:ui-remediation` | Passed | `check-ui-remediation.log` |
| `check:touch-root-press` | Passed | `check-touch-root-press.log` |
| `test:dashboard-navigation` | Passed | `test-dashboard-navigation.log` |
| `test:header-modes` | Passed | `test-header-modes.log` |
| `check:dashboard-smoke` | Passed | `check-dashboard-smoke.log` |
| `check:adaptive-layouts` | Passed | `check-adaptive-layouts.log` |
| `check:commercial-readiness` | Passed after update | `check-commercial-readiness-retry.log` |
| `test:release-version` | Passed | `test-release-version.log` |
| `test:release-artifact` | Passed | `test-release-artifact.log` |
| `test:json-lexical-types` | Passed | `test-json-lexical-types.log` |
| `test:release-manifest` | Passed | `test-release-manifest.log` |
| `test:release-environment` | Passed | `test-release-environment.log` |
| `check:release-gauntlet` | Passed | `check-release-gauntlet.log` |
| `test:iexpress-packaging` | Passed | `test-iexpress-packaging.log` |
| `test:webview2-runtime` | Passed | `test-webview2-runtime.log` |
| `check:installer-safety` | Passed | `check-installer-safety.log` |
| `test:installer-host-stop` | Passed | `test-installer-host-stop.log` |
| `test:installer-architecture` | Passed | `test-installer-architecture.log` |
| `test:visible-window-guard` | Passed | `test-visible-window-guard.log` |
| `check:app` | Passed | `check-app.log` |
| `check:audit-regressions` | Passed after update | `check-audit-regressions-retry.log` |
| `test:app` | Failed / aborted | `test-app.log` |
| `test:native-host-api` | Failed / aborted | `test-native-host-api.log` |
| `test:bridge-api` | Failed / aborted | `test-bridge-api.log` |
| `test:theme-rendered` | Failed / aborted | `test-theme-rendered.log` |
| `test:standalone-theme-rendered` | Failed / aborted | `test-standalone-theme-rendered.log` |
| `test:rendered-dashboard` | Failed / aborted | `test-rendered-dashboard.log` |

## Uncompleted validation

- **test:app:** Failed without results in the full sequence. Explicit x64 test-assembly retry aborted after a 20-second VSTest/testhost connection timeout; no NUnit cases reported executed.
- **test:native-host-api:** Lifecycle fixtures passed; native HTTP startup failed with HttpListener Windows error 6. The cleanup receipt also failed, so the profile was retained.
- **test:bridge-api:** Legacy bridge health request failed. API integration assertions did not complete.
- **test:theme-rendered:** Contrast helper fixtures passed. Native-host setup/cleanup failed; the final error reported that the owned process tree did not terminate. The rendered theme matrix was not completed.
- **test:standalone-theme-rendered:** Browser lifecycle fixtures passed. Headless Edge exited with code 3221225477 before its debugging endpoint was ready; output included AppContainer-profile creation failure. Rendered theme checks did not execute.
- **test:rendered-dashboard:** Native HTTP initialization failed with Windows error 6 before the dashboard matrix ran. The 25-panel/10-viewport matrix and 100-boot run remain unverified.

A diagnostic-only project invocation initially selected the AnyCPU output path, which had not been built. Repeating it against the existing x64 assembly produced the explicit VSTest timeout above. No test assertion, timeout gate, browser sandbox, execution policy, or local-server permission was relaxed.

After the native/browser sequence, a process inventory found no running XenonEdgeHost process. Individual test cleanup failures remain failures; that later inventory does not turn them into successful disposal receipts.

## Build identity

- Release host and test assembly: build succeeded, zero errors, four NU1900 warnings because the NuGet vulnerability feed could not be reached.
- Host ProductVersion: `0.3.0-beta.1+20261108.52ae8de623a5c2f3ce2b7da97193e5a7986403de`.
- Compiled host executable SHA-256: `831F539CA7BB9F9FE890929C3D12E6147D16FE351F85252F77F6491DD5EAC4CD`.
- `npm ci`: passed; npm reported zero vulnerabilities for this one-package workspace. This does not replace the unavailable NuGet vulnerability check.
- No installer was created or installed. The compile output is not a release artifact.

Logs are retained locally under `artifacts/edge-validation`. Raw host logs can contain local display identifiers and paths, so they are excluded from the source archive. Physical C1/C2/C3 controls, real touch/scrolling, cursor behavior, 100-200% scaling, primary-screen focus, and installed-candidate rollback remain pending.
