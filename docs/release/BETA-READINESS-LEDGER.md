# Auxora Windows Public Beta Readiness Ledger

This ledger is the evidence-backed release record for the first Windows-only Auxora public beta. A source check can close a code finding, but only an exact installed candidate exercised on a disposable Windows VM can close the artifact gates.

## Baseline

- Branch: `codex/fix-first-run-display-flow`
- Baseline commit: `edfa17018a495e06a7037a7cdb0603516776ec6c`
- Public repository: `SilverFuel/xeneon-widgets`
- Current public release: `v0.2.0` (`XENEON Edge Host v0.2.0 Free Public Beta`, published 2026-04-26)
- Open issues inspected: `#4 Refresh times`; no direct beta-blocker classification without further evidence.
- Initial dirty tree: 23 tracked first-run/display files, intentionally preserved.
- Integrated commits: `c749aa9` (first-run display), `aab9151` (remote/calendar security), `c1020e0` (Windows beta release pipeline).

## Findings and gates

| ID | Finding / gate | Severity / class | Evidence | Owner | Acceptance test | Status | Validation receipt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BETA-001 | Integrate the existing first-run display picker and readiness work without losing current changes. | High / beta blocker | `app/MainWindow.xaml:35`, `app/MainWindow.xaml.cs:196`, `app/Services/DisplayManager.cs:34`, plus the initial 23-file working-tree diff | Lead | Independent diff review; `npm run check`; `npm run audit:deps`; `git diff --check`; intentional commit | Closed in source | Product/recovery independent review passed; baseline checks passed; committed as `c749aa9` |
| BETA-002 | Prerelease versions do not follow SemVer ordering because the parser discards everything after `-` or `+`. | High / beta blocker | Original `app/Services/ReleaseService.cs:182-203` | Release/QA | Tests cover `beta.1 < beta.2 < rc.1 < stable`, numeric prerelease identifiers, and build metadata | Closed in source | 46/46 .NET tests pass after independent review correction; commit `c1020e0` |
| BETA-003 | A missing beta/nightly match falls back to the first release, crossing channels. | High / beta blocker | Original `app/Services/ReleaseService.cs:140-168` | Release/QA | Empty-match tests return unavailable for beta and nightly without returning stable/other-channel assets | Closed in source | Channel/no-fallback tests pass; commit `c1020e0` |
| BETA-004 | The beta build is still versioned `0.3.0` and defaults to the stable channel. | High / beta blocker | Original `app/XenonEdgeHost.csproj:13`, `app/Infrastructure/ConfigStore.cs:155` | Release/QA | Candidate is `0.3.0-beta.1`; beta builds default/check beta; stable builds default/check stable | Closed in source | `Test-ReleaseVersion.ps1` reports `0.3.0-beta.1`; commit `c1020e0` |
| BETA-005 | The public-beta workflow still builds and publishes the unfinished macOS scaffold. | High / beta blocker | Original `.github/workflows/release.yml:71-109` | Release/QA | Workflow contains no macOS job or macOS release dependency/assets; regression check enforces Windows-only beta | Closed in automation | Independent review confirmed Windows-only workflow; commit `c1020e0` |
| BETA-006 | Re-running an existing tag deletes its assets and uploads replacement bytes. | Critical / beta blocker | Original `.github/workflows/release.yml:124-130` | Release/QA | Existing tag/release causes a hard failure; workflow never deletes/replaces published assets | Closed in automation | Immutable workflow and fixtures pass; commit `c1020e0` |
| BETA-007 | The release path does not yet bind one candidate to an exact tag, version, commit SHA, filename, hash, and asset allowlist. | High / beta blocker | Original `.github/workflows/release.yml:18-68`, `.github/workflows/release.yml:111-132` | Release/QA | Manifest records all identifiers; workflow checks agreement and uploads only the exact five-item allowlist | Closed in automation | Manifest/lifecycle fixtures accept exact data and reject extra assets/incomplete receipts; commit `c1020e0` |
| BETA-008 | Native-host API coverage is source-pattern inspection, not a launched-host test. | High / beta blocker | Original `scripts/test-native-host-api.mjs:1-84` | Release/QA | Test launches the native host, waits for it, calls live health/config/assets and verifies origin/mutation boundaries, then terminates it | Closed in source | `npm run test:native-host-api` passed against a launched host; commit `c1020e0` |
| BETA-009 | Dashboard visual/accessibility smoke is source-pattern inspection rather than rendered-DOM geometry and interaction coverage. | High / beta blocker | Original `scripts/check-dashboard-visual-a11y.mjs:1-217` | Product/Recovery | Rendered tests cover compact, standard, ultrawide, portrait, keyboard, touch target size, focus, and accessibility with geometry assertions | Closed in source | Isolated launched host + system Edge passed 1280x400, 1440x900, 2560x720, and 800x1280 geometry, focus, activation, 32px targets, and accessible names |
| BETA-010 | Release trust UI says “Verified” when the service only found hash/signature sidecars and did not verify either. | High / beta blocker | Original `app/Services/ReleaseService.cs:249-269`, current `js/widgets/product.js:360` | Release/QA + Product | UI says “available” until downloaded bytes, checksum, and signer are actually verified; test prevents “Verified” from availability-only state | Closed in source | UI derives Available only when both proof assets are present and states that presence is not verification; source contract and full checks pass |
| BETA-011 | The exact installer has not passed the required disposable-VM install, launch, live `/api/health`, restart/autostart, upgrade, repair, uninstall, and remove-all-data cycle. | Critical / user-only operational gate | `docs/release/CLEAN-INSTALL-TEST.md:3-64`; source checks cannot prove an installed candidate | Lead + user | Completed VM evidence names the exact installer and SHA-256 and records every lifecycle result | Blocked on later exact candidate and disposable VM | Baseline source suite is not an artifact receipt |
| BETA-012 | The current local installers predate this dirty tree and cannot be the release candidate. | High / beta blocker | `app/dist/Auxora-Setup-0.3.0-20260714-2313.exe` and current uncommitted source state | Lead | Rebuild only after integrated tree is stable; verify exact new artifact against synchronized metadata | Open | Existing artifacts retained as historical local outputs only |
| BETA-013 | “Reset all app data” clears config and protected secrets but leaves recent-app history, logs, retained PresentMon captures, WebView data, and one dashboard storage key. | High / beta blocker | Original `app/Infrastructure/ConfigStore.cs:59-73`, `app/Services/LauncherService.cs:44-58`, `app/Services/GamePerformanceService.cs:140-146`, `app/MainWindow.xaml.cs:69-72`, `js/dashboard.js:2169-2175`, `js/dashboard.js:2343-2348` | Product/Recovery | Seed every retained store, call the real reset API, and assert complete deletion or a visible failure | Closed in source | Seeded-store reset and visible-failure tests pass; launched initialized WebView returned `webview-data: cleared`; dispatcher access independently reviewed |
| BETA-014 | Foreground-app tracking starts automatically, polls every three seconds, persists executable history, and has no user toggle or adequate disclosure. | High / beta blocker | Original `app/Services/LauncherService.cs:14-18`, `app/Services/LauncherService.cs:44-58`, `app/Services/LauncherService.cs:342-406`, `app/Models/AppConfig.cs:69-118`, `js/widgets/product.js:1266-1283` | Product/Recovery | Plain disclosure plus toggle; polling-off test proves no capture/persistence; reset clears retained history | Closed in source | Default-off/on/purge tests and in-flight capture-vs-opt-out race test pass; disclosure and toggle are present in Setup and Privacy |
| BETA-015 | Installed Recovery exposes developer packaging controls instead of customer recovery actions. | High / beta blocker | Original `js/dashboard.js:1973-1979`, `js/widgets/product.js:1178-1228`; customer actions existed separately at `app/TrayIcon.cs:153-170` and `app/installer/Install-XenonEdgeHost.ps1:265-290` | Product/Recovery | Installed panel provides Retry, Repair, Restart in Safe Mode, Open Logs, Quit; no repo path/build/signing UI | Closed in source | Customer recovery API/UI and safe fixed-script process arguments pass focused tests; unpackaged-only actions report unavailable |
| BETA-016 | Phone Remote put a bearer token in the URL and rendered user-controlled Scene names through `innerHTML` and inline JavaScript. | Critical / beta blocker | Original implementation at `app/Services/RemoteSessionService.cs:53-57`, `app/Services/RemoteSessionService.cs:113-166`; Scene names were only trimmed/length-limited at `app/Services/SceneDefaults.cs:72-76` | Security/Privacy + Product | Beta snapshot/UI report unavailable; start cannot bind; no token URL, QR, generated HTML, or LAN listener path remains | Closed in source | Service and UI truthfully report unavailable; no start/token/QR action remains; full .NET and dashboard contract checks pass; backend commit `aab9151` |
| BETA-017 | Calendar accepted HTTP and validated only the literal hostname before a redirect-following shared-client request; the feed URL was stored in plaintext. | Critical / beta blocker | Original implementation at `app/Infrastructure/NetworkEndpointGuard.cs:38-57`, `app/Services/CalendarService.cs:74-90`, `app/BridgeManager.cs:73-81`, `app/Infrastructure/ConfigStore.cs:278-342` | Security/Privacy + Product | Protected migration; HTTPS-only; all resolved addresses and redirect hops revalidated; automatic redirects disabled; reset clears secret; connection-boundary rebinding test | Closed in source | Direct connection-boundary rebinding test rejects loopback before connector; production handler guard asserted; full tests pass; backend commit `aab9151` |

## Baseline validation receipts

| Command | Result |
| --- | --- |
| `npm run check` | Pass: all repository checks, 20/20 .NET tests, zero build warnings/errors |
| `npm run audit:deps` | Pass: npm root, Electron npm, and NuGet reported zero known vulnerabilities |
| `git diff --check` | Pass with two line-ending conversion warnings; no whitespace errors |

## Integrated validation receipts

| Command | Result |
| --- | --- |
| `npm run check` | Pass: all repository checks, live native-host/API checks, four rendered viewports plus initialized-WebView reset, 55/55 .NET tests, zero build warnings/errors |
| Focused Product/Recovery/Calendar tests after independent review fixes | Pass: 24/24, including in-flight foreground capture versus opt-out |
| `npm run test:rendered-dashboard` | Pass: compact 1280x400, standard 1440x900, ultrawide 2560x720, portrait 800x1280, plus initialized WebView reset |
| `npm run test:native-host-api` | Pass: live health, config, embedded assets, origin rejection, and mutation-token rejection |
| `npm run audit:deps` | Pass: root npm, Electron npm, and NuGet reported zero known vulnerabilities |
| `git diff --check` | Pass: no whitespace errors |

## Operational stop rules

- Do not push, tag, sign, publish, or replace release assets without explicit user approval.
- Do not install or uninstall on the user's normal Windows profile.
- Do not mark BETA-011 complete from source tests or a locally built but uninstalled artifact.
