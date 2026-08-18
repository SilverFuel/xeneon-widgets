# Release Readiness

> [!WARNING]
> Historical archive only. This file records older 0.2.0-era work and is not a current release procedure or proof that Auxora is ready to publish. Use `docs/release/BETA-READINESS-LEDGER.md`, `docs/release/PUBLIC-RELEASE-CHECKLIST.md`, `docs/release/CLEAN-INSTALL-TEST.md`, and `docs/release/GITHUB-RELEASE.md` for the current unsigned Windows beta gates.

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
| Improvement | P1 | `app/AppLaunchOptions.cs`, `app/MainWindow.xaml.cs`, `app/Launch-XenonSafeMode.ps1`, `app/repair.ps1`, `app/installer/Install-XenonEdgeHost.ps1` | Added Safe Mode launch support and recovery shortcuts; current Safe Mode ignores saved placement but still requires an active non-primary companion display, remaining tray-only when none is available. | `24645d6` |
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

## 2026-07-19 RC continuation — Camera Detection and installed UI

### Outcome

The local `0.3.0-beta.1` candidate at asset revision `20260719-07` closes the reported dashboard crash, recurring redraw/flicker, primary-display placement, visible taskbar/titlebar, readability, and missing Camera Detection implementation in source and installed-local evidence. This was not an external release: no files were staged, committed, tagged, pushed, published, or deployed.

### Implemented

- Added a native Frigate Camera Detection integration with local/private-network endpoint enforcement, connect-time DNS validation, redirects and proxy use disabled, bounded responses, cached event reads, and validated event/snapshot identifiers.
- Added protected Frigate configuration, removal, redacted diagnostics, truthful health/capability reporting, production dashboard registration, native inline rendering, and Diagnostics setup controls.
- Fixed explicit Camera Detection deep links so they select the correct destination instead of falling back to Home.
- Added a 12px readable-text floor for the remaining scene, privacy, and code-preview labels.
- Bumped embedded web assets to revision `20260719-07` and forced a non-incremental native build so the packaged host contains the current CSS and JavaScript.

### Validation

- `npm run check`: passed after a non-incremental native build.
- `npm run audit:deps`: npm dependency trees reported 0 vulnerabilities and NuGet reported no vulnerable packages.
- `npm run test:app`: 114 passed, 0 failed, 0 skipped.
- Focused Frigate suite: 13 passed.
- Complete revision `20260719-15` rendered suite passed seven viewports including 2560x720, authenticated Camera Detection event/snapshot rendering, 100/100 cold boots, and initialized-WebView reset. Route assertions now wait for the committed browser URL so a slow navigation cannot evaluate the previous panel.
- Installed localhost API returned HTTP 200, semantic version `0.3.0-beta.1`, asset revision `20260719-15`, Beta channel, and the Frigate capability in the correct optional/unconfigured state.
- Installed revision 15 selected Windows non-primary `\\.\DISPLAY2` with reported `619,2160`, `2560x720` bounds. Prior installed candidates confirmed the matching HWND was borderless and taskbar-free; a new revision-15 HWND timing sample is not claimed under the current fully loaded desktop.
- Installer produced: `app/dist/Auxora-Setup-0.3.0-beta.1-20260719-2239.exe` (SHA256 `3676EB8763B39D2E9D2D7D89041FCFDA8F8CDA4990892AB6F058C2CFA455F35C`). Exact artifact verification passed with the expected unsigned-free-beta warning; the installer parent exited 0 and the installed revision-15 API supplied the evidence above.

### Remaining gates

- Exercise an actual Frigate server and camera on the target LAN, including authentication, disconnect/reconnect, event freshness, snapshots, and camera filtering.
- Run destructive install, upgrade, rollback, and uninstall validation in a disposable clean Windows VM/profile.
- Repeat physical companion-display hotplug, primary-role switching, touch, Windows scaling, and screen-reader sessions.
- Sign the executable and installer before paid/stable distribution, and complete the external support/security ownership gates already listed above.

## 2026-07-19 RC continuation — Authenticated Camera Detection and build identity

### Outcome

The next local beta candidate closes authenticated Frigate access and installed-build identity gaps. Asset revision `20260719-09` is packaged and installed for the current Windows user. This remains a local release-candidate pass only: no files were staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added Frigate username/password fields to both Diagnostics surfaces, with blank-password preservation for unchanged credentials and explicit removal behavior.
- Migrated and stored the Frigate password through the existing Windows DPAPI secret store; `config.json`, `/api/config`, support snapshots, and support-log sanitization do not expose it.
- Added Frigate `/api/login` support, cookie retention, in-memory bearer-token use, and exactly one controlled reauthentication after HTTP 401. Login POSTs do not use the normal transient retry policy, avoiding duplicate authentication attempts and rate-limit pressure.
- Rejected incomplete credentials and authenticated non-loopback HTTP. Authenticated LAN connections require HTTPS, and normal Windows TLS certificate validation remains enabled.
- Added an `app` identity block to `/api/health`, including product name, native version, and the exact embedded dashboard asset revision.

### Validation

- Complete `npm run check`: passed, including seven rendered viewports, 15 theme/viewport captures, 100/100 cold boots, native/legacy API checks, artifact-policy fixtures, and 117/117 native application tests.
- Authenticated rendered Camera Detection: the native host logged in to the isolated local Frigate server, sent the bearer token, rendered a recent event, and rendered its proxied snapshot with zero unauthenticated upstream requests.
- Focused authentication, DPAPI migration, HTTP retry, setup, and redaction gate: 21/21 native tests plus all associated JavaScript contract checks passed.
- Native display placement: 63,075 samples passed with no visible Auxora window intersecting the primary display.
- Dependency audits: both npm trees reported 0 vulnerabilities; NuGet reported no vulnerable packages.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260719-2019.exe`, SHA256 `042666FDFBFBC685C25B7D130CCEC97A8F57475C0FB75D83F0BC30F3236A3C0F`.
- Installed transaction: installer exited cleanly; `/api/health` reported `app.name=Auxora` and `app.dashboardAssetRevision=20260719-09`.
- Installed companion window: selected non-primary `\\.\DISPLAY2`, exact bounds `619,2160`, `2560x720`, caption false, thick frame false, and `APPWINDOW` false.
- Installed Frigate state: capability present and truthfully optional/unconfigured; `/api/config` reported Windows DPAPI storage and no password property.

### Remaining gates

- Connect an actual Frigate instance on authenticated port 8971 with a Windows-trusted TLS certificate and real camera, then exercise login, role/camera permissions, token expiry, event freshness, snapshots, filtering, and disconnect/reconnect.
- Complete destructive clean install/upgrade/rollback/uninstall in a disposable Windows VM/profile.
- Complete physical display hotplug/primary-role switching, Windows scaling, touch, and screen-reader sessions.
- Sign the executable and installer before paid/stable distribution and close the external support/security ownership gates.

## 2026-07-19 RC continuation — Verified Camera Detection setup state

### Outcome

Asset revision `20260719-10` removes the remaining false-ready behavior from Camera Detection setup. Saving Frigate settings now performs a real authenticated events request, and Diagnostics/health distinguish saved-but-untested, verified-ready, and needs-attention states. The candidate is packaged and installed locally; no files were staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added session-protected `POST /api/frigate/test`, which invalidates the short event cache and tests the currently saved endpoint, camera filter, and authentication.
- Added connection status keyed to the effective endpoint, camera, username, and protected password so old success cannot carry across a configuration change.
- Changed health from field-presence inference to truthful `Configured`, `Ready`, and `Needs Setup` states with connected/authenticated flags and a sample timestamp.
- Updated both Diagnostics implementations to save and test automatically. A failed test leaves settings intact and reports `Camera saved; test failed` instead of discarding configuration or claiming readiness.
- Normal Frigate panel reads also refresh connection truth; network/transport failures are normalized into a safe retryable error.

### Validation

- Complete `npm run check`: passed with 119/119 native tests, seven rendered dashboard geometries, 15 theme/viewport captures, 100/100 cold boots, and all release/artifact/API contracts.
- Focused Frigate suite: 17/17 passed, including untested state, authenticated success, rejected credentials, saved-setting preservation, token renewal, event mapping, snapshot safety, and DNS-rebinding protection.
- Rendered native flow: saved authenticated Frigate settings, called the connection test, observed health change to `Ready`/`connected=true`, rendered an event and snapshot, and recorded zero unauthenticated upstream requests.
- Native display placement: 65,329 samples passed with no visible Auxora window intersecting the primary display.
- Dependency audits: both npm trees reported 0 vulnerabilities and NuGet reported no vulnerable packages.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260719-2033.exe`, SHA256 `5DE909D8C9652CFB15748CE401847B58A7C946ABC11796B467CDE344B86D7874`.
- Installed transaction: installer exited cleanly and health reported `Auxora`, revision `20260719-10`, display `ready`, non-primary selection, and truthful unconfigured Camera Detection state.
- Installed HWND: exact `619,2160`, `2560x720`; caption false, thick frame false, and `APPWINDOW` false.

### Remaining gates

- Exercise save-and-test against the intended physical Frigate server/camera on authenticated port 8971 with a Windows-trusted certificate, including viewer/custom-role camera permissions and token expiry.
- Complete destructive clean install/upgrade/rollback/uninstall in a disposable Windows VM/profile.
- Complete physical display hotplug/primary-role switching, Windows scaling, touch, and screen-reader sessions.
- Sign the executable and installer before paid/stable distribution and close the external support/security ownership gates.

## 2026-07-19 RC continuation — Honest Widget Packs and feature claims

### Outcome

Asset revision `20260719-11` removes an overstated third-party extension capability and aligns the UI, native API, README, and changelog with what this beta actually ships. The candidate is packaged and installed locally; no files were staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Renamed the visible Extensions surface to Widget Packs and kept the useful built-in dashboard layouts available.
- Replaced `Runnable` extension language with explicit manifest inspection results. A valid signature, content hash, and permission set now yields `verified=true`, `loadable=false`; the service always reports `thirdPartyLoadingEnabled=false` for this beta.
- Removed `Available`, `Trust enforced`, and `Signed extensions` claims that implied Auxora could load inspected third-party code.
- Corrected release-facing feature copy: Phone Remote is unavailable and opens no listener, Night is separate from the four Modes, current navigation is Home/Modes/Apps & Controls/Settings, and Widget Packs are built in.

### Validation

- Clean non-incremental Release build: passed with 0 warnings and 0 errors.
- Complete `npm run check`: passed with 120/120 native tests, seven rendered dashboard geometries, 15 theme/viewport captures, 100/100 cold boots, authenticated Camera Detection rendering, and all release/artifact/API contracts.
- Focused extension suite: 2/2 passed, including a valid RSA-PSS signed manifest that remains non-loadable and an invalid permission manifest that is rejected.
- Native display placement: 78,454 samples passed with no visible Auxora window intersecting the primary display.
- Dependency audits: both npm trees reported 0 vulnerabilities and NuGet reported no vulnerable packages.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260719-2049.exe`, SHA256 `2B28C02CE7C0C54DC0F395366F1043275079DD88913889CD8B8B38498B4F2B01`; the sidecar and exact artifact verifier passed. The artifact is unsigned, which remains acceptable only for the clearly labeled free beta.
- Installed transaction: installer exited cleanly; `/api/health` reported Auxora revision `20260719-11`, display ready, and a non-primary 2560x720 selection. `/api/extensions` reported `thirdPartyLoadingEnabled=false` with no installed manifests.
- Installed HWND: exact `619,2160`, `2560x720`; caption false, thick frame false, and `APPWINDOW` false.

### Remaining gates

- Exercise save-and-test against the intended physical Frigate server/camera on authenticated port 8971 with a Windows-trusted certificate, including viewer/custom-role camera permissions and token expiry.
- Complete destructive clean install/upgrade/rollback/uninstall in a disposable Windows VM/profile.
- Complete physical display hotplug/primary-role switching, Windows scaling, touch, and screen-reader sessions.
- Sign the executable and installer before paid/stable distribution and close the external support/security ownership gates.

## 2026-07-19 RC continuation — Verification-gated update trust

### Outcome

Asset revision `20260719-12` closes the remaining presence-only trust path in Updates. Hash and signature sidecar discovery is now informational only; the UI can show Verified only when the native trust contract explicitly says the downloaded artifact was verified and trusted. The candidate is packaged and installed locally; no files were staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Replaced the `hash available + signature available = trust available` UI calculation with the authoritative `trust.trusted` and `trust.verificationStatus` fields.
- Kept hash/signature presence visible while stating that Auxora has not verified the downloaded bytes; failed checks clear any previously cached trusted state.
- Renamed the download action to `Open installer asset` so the feed link is not presented as a verified in-app update.
- Added the missing `verificationStatus=missing` field to unavailable release responses and extended native and UI regression coverage.
- Corrected the beta readiness ledger and public update draft so they no longer advertise Phone Remote, extension loading, Night as a fifth Mode, or presence-only update trust.

### Validation

- Clean non-incremental Release build: passed with 0 warnings and 0 errors.
- Complete `npm run check`: passed with 120/120 native tests, seven rendered dashboard geometries, 15 theme/viewport captures, 100/100 cold boots, authenticated Camera Detection rendering, and all release/artifact/API contracts.
- Focused release-service suite: 9/9 passed, including sidecar-present-but-not-verified and unavailable-channel trust states.
- Native display placement: 59,607 samples passed with no visible Auxora window intersecting the primary display.
- Dependency audits: both npm trees reported 0 vulnerabilities and NuGet reported no vulnerable packages.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260719-2109.exe`, SHA256 `4B1CF1E0CA21E36A0274921CC5C36E9CC018ED0FC2A54896A6D24BE59E5C0CE1`; sidecar and exact artifact verification passed. The artifact remains unsigned and is acceptable only for the clearly labeled free beta.
- Installed transaction: installer exited cleanly; health reported Auxora revision `20260719-12`, display ready, and a non-primary 2560x720 selection.
- Installed live beta feed: `hashStatus=available`, `signatureStatus=missing`, `verificationStatus=not-verified`, and `trusted=false`; the 2560x720 Updates capture showed Not verified.
- Installed HWND: exact `619,2160`, `2560x720`; caption false, thick frame false, and `APPWINDOW` false.

### Remaining gates

- Exercise save-and-test against the intended physical Frigate server/camera on authenticated port 8971 with a Windows-trusted certificate, including viewer/custom-role camera permissions and token expiry.
- Complete destructive clean install/upgrade/rollback/uninstall in a disposable Windows VM/profile.
- Complete physical display hotplug/primary-role switching, Windows scaling, touch, and screen-reader sessions.
- Sign the executable and installer before paid/stable distribution and close the external support/security ownership gates.

## 2026-07-19 RC continuation — Downgrade and release-channel truth

### Outcome

Revisions `20260719-13` through `20260719-15` close three related update-safety gaps: an older public feed is identified as behind instead of current, the beta build consistently identifies and displays itself as `0.3.0-beta.1` on the Beta channel, and the native API no longer exposes downgrade download locations. Revision 15 is packaged and installed locally. No files were staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added semantic `newer`, `current`, `older`, and `unknown` release comparison results. Older feeds show `Feed behind`, retain the unverified warning, and never create an installer action.
- Added shared `AppBuildIdentity` handling so health, support, release checks, persisted configuration, and the Updates selector use the canonical prerelease version and channel. Beta builds no longer offer an ineffective Stable option.
- Added the explicit `downloadAllowed` service contract. When a feed is older, current, or uncomparable, top-level installer/macOS URLs and every asset, checksum, and signature location are blanked before the payload leaves the native service.
- Kept the UI as a second guard: download actions require a newer release, `downloadAllowed=true`, an actually verified native trust state, and a non-empty location.
- Improved rendered-test diagnostics so Windows temporary-profile cleanup cannot mask the original product assertion and slow desktops receive separate hydration, widget-mount, and release-result deadlines.

### Validation

- Revision 14 complete `npm run check`: passed with 128/128 native tests, seven rendered geometries, 15 theme captures, 100/100 cold boots, authenticated Camera Detection rendering, bridge APIs, and native companion-display placement.
- Revision 15 focused release-service suite: 10/10 passed, including complete download-location redaction for an older beta feed.
- Revision 15 non-timing gates: 128/128 native tests; exhaustive UI, Camera Detection, and audit-regression contracts passed; both npm trees reported 0 vulnerabilities and NuGet reported no vulnerable packages.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260719-2239.exe`, SHA256 `3676EB8763B39D2E9D2D7D89041FCFDA8F8CDA4990892AB6F058C2CFA455F35C`; exact artifact verification passed with the expected unsigned-free-beta warning.
- Installed transaction: the installer parent exited 0. Live health reported `Auxora`, `0.3.0-beta.1`, and revision `20260719-15`; configuration reported `releaseChannel=beta`; display diagnostics selected only non-primary `\\.\DISPLAY2` at 2560x720; Camera Detection remained truthfully optional/unconfigured.
- Installed older-feed boundary: `versionRelation=older`, `updateAvailable=false`, `downloadAllowed=false`, empty installer/macOS URLs, and no asset, checksum, or signature download locations. Trust remained `not-verified`/`false`.
- Complete revision 15 `npm run check` passed in one sequential receipt while the active game remained running: seven rendered geometries, 15 theme captures, 100/100 cold boots, authenticated Camera Detection, bridge APIs, 128/128 native tests, and 40,816 companion-window placement samples at a 0.245 ms effective interval. No visible Auxora window intersected the primary display.

### Remaining gates

- Exercise save-and-test against the intended physical Frigate server/camera on authenticated port 8971 with a Windows-trusted certificate, including viewer/custom-role camera permissions and token expiry.
- Complete destructive clean install/upgrade/rollback/uninstall in a disposable Windows VM/profile.
- Complete physical display hotplug/primary-role switching, Windows scaling, touch, and screen-reader sessions.
- Sign the executable and installer before paid/stable distribution and close the external support/security ownership gates.

## 2026-07-19 RC continuation — Physical Camera Detection publication gate

### Outcome

The source/runtime Camera Detection work was already passing, but the public beta workflow could still accept only a disposable-VM lifecycle receipt and publish without physical Frigate evidence. That release-path gap is closed in automation. The product candidate remains revision `20260719-15`; only release tooling, tests, and documentation changed, so no new installer was built or installed. No files were staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added a secret-safe schema-1 Frigate qualification receipt verifier bound to the exact release manifest tag, semantic version, commit SHA, installer filename, installer SHA-256, and installed Auxora version.
- Required a physical Frigate server, real camera, target LAN, Windows-trusted HTTPS, viewer/custom role, save-and-test, authenticated login, camera filtering, fresh event, valid snapshot, observed token renewal, disconnect detection, and reconnect recovery.
- Added fail-closed fixtures for secret-bearing evidence, fixture-only cameras, plaintext authenticated endpoints, stale events, and failed reconnects.
- Made the Frigate receipt mandatory beside the lifecycle receipt in the receipt-bound local gauntlet and GitHub publication job. The manual free-beta helper now rejects missing evidence instead of offering a local two-file upload shortcut.
- Added `docs/release/FRIGATE-CERTIFICATION.md` and updated the public release checklist. Qualification receipts remain private gate inputs and are not added to the five-file public asset allowlist.

### Validation

- Focused Camera Detection, receipt, release-gauntlet, and audit-regression checks passed.
- Missing-receipt manual publication preparation was rejected with the intended fail-closed message.
- Complete sequential `npm run check` passed: 128/128 native tests, seven rendered geometries, 15 theme/viewport captures, 100/100 cold boots, authenticated Camera Detection rendering, native and bridge APIs, and 58,706 companion-window placement samples at a 0.17 ms effective interval. No visible Auxora window intersected the primary display.
- Clean Release build passed with 0 warnings and 0 errors.
- Dependency audit passed with 0 vulnerabilities in both npm trees and no vulnerable NuGet packages.
- `git diff --check` passed; Git reported only the existing LF-to-CRLF conversion warning for `build/build-stamp.props`.
- Installed revision-15 Auxora was restored after isolated testing; live health reported `0.3.0-beta.1`, asset revision `20260719-15`, display `ready`, and the selected 2560x720 companion display.

### Remaining gates

- Produce a real exact-candidate Frigate qualification receipt on the target LAN; fixtures and source tests do not close BETA-022.
- Complete the exact-candidate destructive clean install/upgrade/rollback/repair/uninstall/remove-data lifecycle in a disposable Windows VM/profile.
- Complete physical display hotplug/primary-role switching, Windows scaling, touch, and screen-reader sessions.
- Sign the executable and installer before paid/stable distribution and close the external support/security ownership gates.

## 2026-07-19 RC continuation — Physical companion-display publication gate

### Outcome

Automated window sampling and rendered geometry were strong, but physical display certification was still a prose checklist that did not block publication. The receipt-bound release path now requires exact-candidate physical display evidence. The installed product remains revision `20260719-15`; this pass changed only release automation, tests, and documentation. No installer was rebuilt, and nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added a privacy-safe schema-1 display qualification verifier bound to the exact release tag, semantic version, commit SHA, installer filename/SHA-256, and installed Auxora version.
- Required a physical Windows machine, physical touch companion display, active primary-plus-companion topology, all five supported Windows scaling levels, and privacy-safe screenshot reference identifiers.
- Required companion-only startup, zero primary intersection, tray-only behavior without a companion, unplug/replug recovery, primary-role-switch fail-closed behavior, saved preference after reorder, borderless/taskbar-free presentation, touch tap/long-press/scroll, keyboard focus, screen-reader names, scale readability, contained dialogs, reduced motion, and no periodic refresh flicker.
- Added rejection fixtures for virtual/non-physical display evidence, primary intersection, visible taskbar, incomplete scaling, failed touch, and private local screenshot paths.
- Made the display receipt mandatory in the local receipt-bound gauntlet, manual free-beta verifier, and GitHub publication job without adding it to public release assets.

### Validation

- `npm run test:display-receipt`, `npm run check:display-recovery`, `npm run check:release-gauntlet`, and `npm run check:audit-regressions` passed.
- Manual free-beta preparation and the receipt-bound gauntlet both rejected missing display evidence before running release work.
- Complete sequential `npm run check` passed with 128/128 native tests, seven rendered geometries, 15 theme captures, 100/100 cold boots, both hardware receipt fixture suites, authenticated Camera Detection rendering, live bridge/native APIs, and a clean Release build with 0 warnings/errors.
- Native host validation recorded 37,594 HWND placement samples at a 0.266 ms effective interval with no visible Auxora window intersecting the primary display.
- Installed revision-15 Auxora was restored after isolated testing and reported `0.3.0-beta.1`, asset revision `20260719-15`, display `ready`, and the 2560x720 companion selection.

### Remaining gates

- Produce the real exact-candidate physical display receipt; automated tests do not close BETA-024.
- Produce the real exact-candidate physical Frigate receipt; fixtures do not close BETA-022.
- Complete the exact-candidate destructive disposable-VM lifecycle receipt.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Installed UI truth and accessible controls

### Outcome

Asset revision `20260719-16` closes the installed-screen defects found during the live UI audit: Recovery no longer remains on `Checking` after its API has loaded, repeated Layout and Mode actions now expose unique accessible names, and Updates no longer describes unsupported Stable or automatic-install behavior. The exact beta candidate was rebuilt, verified, installed over the existing copy, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Recovery now publishes a terminal `Ready`, `Waiting for display`, or `Unavailable` status to both the selected panel and outer picker after `/api/recovery` completes; action and confirmation messages keep separate concise status and detail text.
- Layout Editor actions name both the panel and operation for assistive technology, including move, pin, size, show, and hide controls. The sales-oriented layout description was replaced with user-focused copy.
- Mode activation and duplication controls now identify their Mode and active state instead of repeating ambiguous `Use Mode` and `Duplicate` names.
- Updates now says it checks the public feed without installing automatically and exposes only the Beta and Nightly channels supported by this prerelease build.
- Static and rendered guards now reject a stuck Recovery state, ambiguous Layout or Mode action labels, unsupported update-channel claims, and reintroduction of the old sales-oriented copy.

### Validation

- Complete sequential `npm run check` passed: all source/theme/setup/boundary/redaction/display/Camera Detection/release gates, both physical-receipt fixture suites, a clean Release build with 0 warnings/errors, seven rendered geometries, 15 theme captures, 100/100 cold boots, authenticated Camera Detection rendering, bridge APIs, and 128/128 native tests.
- Native host validation recorded 97,392 HWND placement samples at a 0.103 ms effective interval with no visible Auxora window intersecting the primary display.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-0704.exe`, 86,966,272 bytes, SHA256 `9EC8316F99CB82F73C4DCD6FE2E7EE4BA2127F01F755ED7075754D0269D84EBE`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Installed health reported `Auxora`, version `0.3.0-beta.1`, asset revision `20260719-16`, and one ready non-primary companion display.
- Live installed-browser audit at 1280x720 showed no dashboard failure, horizontal overflow, vertical page overflow, refresh error, console warning, or console error. Recovery reached `Ready` with all five customer actions; all 55 Layout action names and all eight Mode action names were unique; Updates stated that Auxora does not install automatically and showed no Stable channel; Camera Detection optional setup exposed a password field and HTTPS guidance without saving or transmitting credentials.
- Installed HWND audit: exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`; zero primary-display intersection; caption false; thick frame false; `APPWINDOW` false; topmost true. The window exactly covered the companion bounds, preventing that display's taskbar from appearing over Auxora.

### Remaining gates

- Produce a real exact-candidate physical Frigate receipt on the intended server, camera, LAN, TLS, restricted-role, token-renewal, disconnect, and reconnect environment; fixtures do not close BETA-022.
- Produce a real exact-candidate physical display receipt covering unplug/replug, primary-role switching, all required scaling levels, touch, keyboard, screen reader, reduced motion, physical taskbar visibility, and flicker; automated/live HWND evidence does not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Camera filter and snapshot privacy boundary

### Outcome

Asset revision `20260720-17` closes a Camera Detection privacy and truthfulness gap found by comparing the public beta promises with the native connector. Auxora no longer trusts Frigate alone to honor the selected-camera and one-hour query filters, and its localhost snapshot endpoint no longer proxies arbitrary well-formed event IDs. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Enforced the configured camera locally with case-insensitive exact matching after parsing the upstream event payload.
- Enforced a one-hour event lookback and rejected events more than five minutes in the future, preventing stale or clock-invalid events from being described as recent.
- Required event IDs to be valid during event parsing and treated snapshots as available only when Frigate explicitly reports `has_snapshot=true`.
- Bound every snapshot proxy request to an event with a snapshot in the current locally filtered result set. Invalid, unavailable, unconfigured, stale, future, or other-camera IDs return HTTP 404 without an upstream snapshot request.
- Required authenticated Frigate login to return a usable bearer/cookie token instead of treating an empty successful response as authenticated.
- Extended static, unit, launched-host, README, changelog, and physical-certification contracts to preserve these boundaries.

### Validation

- Focused Frigate suite passed 20/20, including hostile other-camera results, stale/future events, missing snapshot flags, empty-token login, allowed snapshot proxying, invalid IDs, and configured-camera snapshot bypass attempts.
- Complete sequential `npm run check` passed: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, seven rendered geometries, 15 theme captures, 100/100 cold boots, authenticated Camera Detection rendering, bridge/native APIs, a clean Release build with 0 warnings/errors, and 131/131 native tests.
- Native host validation recorded 111,111 HWND placement samples at a 0.09 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-0728.exe`, 86,966,272 bytes, SHA256 `F48FF2F4F9118095BD30BBC817D5B202D7458B886A8F1484E0670A13443A6BA4`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Silent installed upgrade exited 0. Live health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-17`, and one ready non-primary 2560x720 companion display.
- Installed snapshot requests returned 404 for both an unconfigured well-formed event and an invalid path-like event ID. No snapshot request was proxied to an upstream server.
- Live installed Diagnostics at 1280x720 rendered the optional Camera Detection form with a password input and HTTPS guidance, without dashboard failure, page overflow, console warning, or console error.
- Installed HWND remained exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`, with zero primary intersection, no caption, no thick frame, no `APPWINDOW`, and topmost enabled.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt, including the newly explicit other-camera snapshot-denial observation; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Streaming preview truth and loopback boundary

### Outcome

Asset revision `20260720-19` closes a product-truth and network-boundary gap in Streaming. The panel now describes only what the beta implements, accepts only local OBS WebSocket endpoints, and performs save plus reachability check as one explicit action. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Replaced the misleading `Available` state with `Preview` in the Apps & Controls picker and selected panel.
- Reworded the surface as a local-only OBS reachability and streaming-layout preview and stated that this beta sends no OBS commands.
- Restricted OBS WebSocket endpoints to credential-free `ws:` or `wss:` addresses on `localhost`, `127.0.0.1`, or IPv6 loopback, with no non-root path, query, or fragment.
- Replaced the separate implicit save/probe behavior with one `Save & check OBS` form submission so the exact validated value is persisted and checked atomically.
- Added static and rendered interaction contracts for status truth, copy, loopback enforcement, public-host rejection, and final submit behavior.

### Validation

- Complete sequential `npm run check` passed in 127.8 seconds: all source/theme/setup/boundary/redaction/display/release gates, both physical-receipt fixture suites, seven rendered geometries, 15 theme captures, 100/100 cold boots, authenticated Camera Detection rendering, final Streaming submission semantics, bridge/native APIs, a clean Release build with 0 warnings/errors, and 131/131 native tests.
- Native host validation recorded 78,283 HWND placement samples at a 0.128 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-0747.exe`, 86,966,272 bytes, SHA256 `1A226D1275AD79EF3A1BE8511D142196F7ADB20649954C3ADE156253D3DC50B5`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Live health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-19`, and one ready non-primary 2560x720 companion display.
- Live installed Streaming at 1280x720 showed `Preview`, explicitly stated that no OBS commands are sent, rejected `ws://example.com:4455` as `Local address required`, and restored the saved loopback endpoint.
- The installed page remained exactly 1280x720 with no horizontal or vertical overflow, dashboard failure, or runtime-error surface.
- Installed HWNDs remained exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`, with zero primary intersection, no caption, no thick frame, and no `APPWINDOW`; the owning window remained topmost.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Portable Privacy backup and action ordering

### Outcome

Asset revision `20260720-20` closes an incomplete backup and partial-restore risk in Privacy & Backup. Portable backups now include the presentation and Mode state promised by the UI, malformed client-only fields are rejected before native configuration changes, and background diagnostics cannot replace a newer backup, restore, reset, or privacy result. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added a single portable dashboard allowlist covering profile, theme, readability, performance, animation, opacity, layout order, pinned/hidden panels, card sizes, per-Mode layouts, built-in pack selection, and Game Mode presentation behavior.
- Preserved the JSON types expected by the native portable-backup endpoint while retaining client-only fields for the browser-side restore.
- Continued excluding credentials, integration and OBS endpoints, weather location, launcher paths, display identifiers, and logs.
- Validated the portable dashboard object, scalar types, numeric values, size bounds, and nested layout JSON before sending the native restore request.
- Made scene-only legacy backups valid instead of failing after a successful native restore because they contained no browser-local fields.
- Ordered Privacy status updates so stale diagnostics or another older async operation cannot overwrite a newer action result.
- Refreshed native and local post-restore state without remounting the panel and discarding its completion status.
- Added static and rendered regression coverage for complete export, excluded private values, malformed preflight rejection with zero native POSTs, valid round trip, and stable completion messaging.

### Validation

- Complete sequential `npm run check` passed in 123.8 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, seven rendered geometries, 15 theme captures, 100/100 cold boots, authenticated Camera Detection, Streaming and Privacy interaction semantics, live bridge/native APIs, a clean Release build with 0 warnings/errors, and 131/131 native tests.
- The rendered backup round trip preserved layout order, pinned/hidden panels, card sizes, per-Mode layouts, built-in pack, readability, performance, and Game Mode presentation; it excluded the OBS endpoint and weather location.
- The rendered malformed backup was rejected before any native POST. A valid backup produced exactly one native POST, restored the changed local layout and pin state, and kept `Auxora backup restored` visible after the native/local refresh.
- Native host validation recorded 103,978 HWND placement samples at a 0.096 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-0811.exe`, 86,966,272 bytes, SHA256 `59D01535EE36D2AE3C461B6BEC9C3FA063103C099A5B77117DFA7ED019B27A30`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Silent installed upgrade exited 0. Live health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-20`, and one ready non-primary 2560x720 companion display.
- Live installed Privacy at 1280x720 rejected an object-valued `layoutOrder` as `Backup JSON is invalid`; the result remained visible after 2.2 seconds, and sanitized installed logs contained zero POST requests to `/api/config/backup`.
- The installed page remained exactly 1280x720 with no horizontal or vertical overflow, dashboard failure, or runtime-error surface.
- Both installed Auxora HWNDs remained exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`, with zero primary intersection, no caption, no thick frame, and no `APPWINDOW`; the owning window remained topmost.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Media detail privacy controls

### Outcome

Asset revision `20260720-21` closes an inaccessible-feature gap in Audio & Media. The native host already supported separate default-off privacy switches for media metadata and audio application labels, but the shipped UI neither exposed them nor explained why those surfaces stayed generic. Privacy & Backup now gives users explicit local opt-ins while preserving the private defaults. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added separate `Show media titles and artwork on this display` and `Show application names in the audio mixer` controls to Privacy & Backup.
- Kept both settings off by default and explained the exact local media/app details each switch reveals.
- Preserved generic playback and mixer controls when either detail class remains private.
- Persisted both choices through the existing native dashboard configuration API and synchronized the installed UI from the returned native state.
- Kept both fields in the native credential-free portable backup and documented that no media metadata is uploaded.
- Added a native round-trip test plus rendered production-UI checks for the default-off state, both opt-ins, both return-to-private transitions, API state, and disclosure copy.

### Validation

- Complete sequential `npm run check` passed in 123.4 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, seven rendered geometries, 15 theme captures, 100/100 cold boots, authenticated Camera Detection, Streaming/backup/media-privacy interactions, live bridge/native APIs, a clean Release build with 0 warnings/errors, and 132/132 native tests.
- The native test proved both settings default off, update together, serialize into schema-2 portable backup, and restore into a second configuration store.
- The rendered installed-equivalent UI proved both unchecked defaults, enabled both through the production Privacy controls, observed both native API values as true, disabled both again, and observed both native values as false.
- Native host validation recorded 113,412 HWND placement samples at a 0.088 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-0826.exe`, 86,966,272 bytes, SHA256 `C1427CD85553A7E646832148F61B5CE9F82839C87B122713257FCD0A2AE4B8E7`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Silent installed upgrade exited 0. Live health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-21`, and one ready non-primary 2560x720 companion display.
- Live installed Privacy at 1280x720 showed both controls unchecked with private-state explanations, persisted each as true through `/api/config`, then returned each to false. The final installed configuration is private.
- The installed page remained exactly 1280x720 with no horizontal or vertical overflow, dashboard failure, or runtime-error surface.
- Both installed Auxora HWNDs remained exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`, with zero primary intersection, no caption, no thick frame, and no `APPWINDOW`; the owning window remained topmost.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Camera Detection discoverability and deep-link ownership

### Outcome

Asset revision `20260720-22` closes a Camera Detection discoverability and navigation-truth gap. The installed host advertised the feature, but Apps & Controls hid it until a user completed setup through a four-step Diagnostics path. Direct Camera links could also leave Settings highlighted after bridge hydration. Camera Detection now remains visible whenever the native capability is supported, reports an actionable Setup state before configuration, opens Diagnostics directly, and keeps the owning navigation destination synchronized. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Kept supported Camera Detection visible in Apps & Controls before a Frigate address is configured.
- Replaced the ambiguous Optional surface state with Setup while leaving the integration optional.
- Added `Set up Camera Detection` and `Camera settings` actions directly to the Camera Detection panel.
- Routed the action to Diagnostics without requiring the secondary Settings drawer or optional-extras discovery path.
- Replaced the obsolete `hidden until configured` description with truthful discoverability copy.
- Repainted primary navigation after hydrated deep-link resolution so a Camera link highlights Apps & Controls instead of stale Settings state.
- Extended static and rendered contracts to cover unconfigured discovery, Setup wording, navigation ownership, Diagnostics handoff, configured authenticated events, and snapshot rendering.

### Validation

- Complete sequential `npm run check` passed in 122.8 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, seven rendered geometries, 15 theme captures, 100/100 cold boots, unconfigured and authenticated Camera Detection flows, Streaming/backup/media-privacy interactions, live bridge/native APIs, a clean Release build with 0 warnings/errors, and 132/132 native tests.
- The rendered test proved an unconfigured Camera Detection button and Setup state, selected the panel from an explicit deep link under Apps & Controls, opened Diagnostics through the in-panel action, then configured an authenticated mock Frigate connection and rendered its filtered event and snapshot.
- Native host validation recorded 78,904 HWND placement samples at a 0.127 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-0853.exe`, 86,966,272 bytes, SHA256 `77D231A250EEA2BDB4C3B2BEEA1305848BF3122FB6EAA6747CBC50581DF40D33`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Silent installed upgrade exited 0. The installed executable SHA256 `D14BEFC532C0FDE05CD5CEE4F175615D286922E5477B879CB1B705CF6D697D36` exactly matched the published executable.
- Live health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-22`, and ready non-primary `\\.\DISPLAY2` at `619,2160`, `2560x720`.
- Live installed Camera Detection at 1280x720 appeared under Apps & Controls as Setup, showed truthful direct-setup copy, and opened Diagnostics. The page remained exactly 1280x720 with no horizontal/vertical overflow, dashboard failure, or runtime-error surface.
- The installed Auxora HWND remained exact `619,2160`, `2560x720`, with zero primary intersection, no caption, no thick frame, no `APPWINDOW`, and topmost enabled.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Complete Camera Detection setup landing

### Outcome

Asset revision `20260720-23` closes the remaining Camera Detection handoff gap. Revision 22 made Camera Detection discoverable and sent its setup action to Diagnostics, but the optional integrations section remained collapsed, so no camera form was visible. The action now carries a targeted Frigate setup request into Diagnostics, expands the section, scrolls the camera card fully into view, and focuses the local Frigate address after the asynchronous Diagnostics refresh completes. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added a short-lived targeted setup request to the dashboard's inline-widget environment rather than storing navigation state permanently.
- Changed Camera Detection to request the Frigate section specifically while retaining a compatibility fallback to ordinary Diagnostics navigation.
- Initialized optional Diagnostics as expanded only for that targeted request.
- Marked the Camera Detection setup card as the requested destination and focused its `baseUrl` input only after the initial native health/config/Hue refresh finishes.
- Scrolled the requested card into the visible inline viewer before focusing without producing page-level overflow.
- Extended static and rendered Camera Detection contracts to require the visible form, expanded state, correct owning navigation, and address-field focus.

### Validation

- Complete sequential `npm run check` passed in 121.6 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, seven rendered geometries, 15 theme captures, 100/100 cold boots, full unconfigured/setup/authenticated Camera Detection flows, Streaming/backup/media-privacy interactions, live bridge/native APIs, a clean Release build with 0 warnings/errors, and 132/132 native tests.
- The rendered test now rejects a Diagnostics-only handoff: it requires the Frigate form to be visible, Optional extras to say `Hide extras`, and `baseUrl` to own focus before configuring the authenticated mock connection.
- Native host validation recorded 114,344 HWND placement samples at a 0.087 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-0908.exe`, 86,966,272 bytes, SHA256 `4F73C109318ECE2E661561ED6DD7E0E0213C9214A013D2E7695CD7B05E0794CA`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Silent installed upgrade exited 0. Live health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-23`, and ready non-primary `\\.\DISPLAY2` at `619,2160`, `2560x720`.
- Live installed Camera Detection at 1280x720 opened Diagnostics with the Frigate form visible, Optional extras expanded, and the Frigate address focused. The camera card stayed inside the viewer at approximately `140–684` CSS pixels while the viewer occupied `130–695`; document size remained exactly 1280x720 with no dashboard failure or runtime-error surface.
- The installed Auxora HWND remained exact `619,2160`, `2560x720`, with zero primary intersection, no caption, no thick frame, no `APPWINDOW`, and topmost enabled.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Blur-safe Theme Studio and companion-only monitor commands

### Outcome

Asset revision `20260720-24` closes the reported Theme Studio runtime crash and a critical primary-display command boundary in Display Controls. Theme changes now reconcile the existing control tree instead of replacing the focused controls, and DDC/CI discovery plus mutations now fail closed to Windows-confirmed non-primary logical monitors. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Changed Theme Studio redraws to the shared stable-DOM reconciler so the focused select, slider, or swatch is not torn out during a change/blur sequence.
- Hardened reconciliation against a focus handler moving a node while a patch is underway by checking ownership before insert, replace, and removal operations.
- Added a rendered regression that focuses the Theme selector, changes it, requires the same connected control to retain focus, and rejects both browser errors and the fatal dashboard surface.
- Classified every DDC/CI logical-monitor source with generated `GetMonitorInfo` bindings and skipped both Windows-primary and unclassified monitors before acquiring physical-monitor handles.
- Kept GET discovery and POST mutations on the same companion-only enumeration, preventing a changing index from ever resolving to the Windows primary display.
- Added machine-readable `primaryExcluded=true` and `scope=companion-only` API fields, terminal Ready/Limited/Unavailable picker status, explicit safety copy, and monitor-specific input and power accessible names.
- Added native unit, static contract, launched-host API, rendered UI, and installed-candidate coverage for the new boundaries.

### Validation

- Complete sequential `npm run check` passed in 139.4 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, seven rendered geometries, 15 theme captures, 100/100 cold boots, focused Theme Studio change/blur preservation, authenticated Camera Detection, live companion-only Display Controls, bridge/native APIs, a clean Release build with 0 warnings/errors, and 136/136 native tests.
- Native host validation recorded 44,959 HWND placement samples at a 0.222 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-0929.exe`, 86,970,368 bytes, SHA256 `FB7D7380192972A9E20B0890F2636FDF2A87D4903CF61CC334980F72F8CE85D4`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- The installed upgrade and launch/restart smoke passed. Live health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-24`, and Ready display state; the installed executable SHA256 exactly matched the published executable.
- Live `/api/displays/controls` reported one controllable `Generic PnP Monitor`, `scope=companion-only`, `primaryExcluded=true`, and `ready`, instead of revision 23's two-monitor enumeration that included the primary logical display.
- Live installed Theme Studio completed 24 repeated theme/Night/readability changes at 1280x720 with no fatal surface or overflow. Display Controls reached Ready, stated that the Windows primary is excluded, and exposed four unique monitor-specific control labels.
- The installed Auxora HWND remained exact `619,2160`, `2560x720` on a non-primary monitor, with no caption, thick frame, or `APPWINDOW`, and with topmost enabled. The window covered the full 2560x720 monitor rather than the 2560x672 work area reserved by the taskbar.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024 or visually prove taskbar/flicker behavior on every required topology.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Complete focus-safe live UI reconciliation

### Outcome

Asset revision `20260720-26` closes the remaining live-redraw crash and draft-loss class across Auxora. Revision 25 extended stable reconciliation beyond Theme Studio, but its installed audit correctly rejected the candidate after a real Refresh click cleared an unsaved Privacy draft. Revision 26 preserves dirty form state after focus moves, keeps busy actions focusable, and protects Streaming, Privacy, and Camera Detection interactions through refresh and teardown. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Converted every interactive widget renderer, periodic refresh, dynamic picker/launcher/Mode surface, and inline-panel teardown to shared multi-root DOM reconciliation.
- Reconciled keyed action and form controls instead of replacing them when surrounding status or list content changes.
- Captured and restored unsaved text, textarea, checkbox, radio, and select state when a touch or mouse action moves focus before an asynchronous redraw.
- Preserved the active control, text selection, and scroll positions when focus remains inside the redrawn panel.
- Kept Privacy's diagnostics Refresh action focusable while busy and ignored duplicate requests instead of disabling the focused button and dropping focus to the page body.
- Added rendered regressions that reproduce the real focus movement for Privacy and Camera Detection, retain the Streaming Enter-submit path, navigate away from the Streaming panel, and reject runtime/fatal surfaces.
- Retained the companion-only DDC/CI boundary and exact full-monitor window placement from revision 24.

### Validation

- Complete sequential `npm run check` passed in 140 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, 40 adaptive layout combinations, seven rendered geometries, 15 theme captures, 100/100 cold boots, real-focus Streaming/Privacy/Camera redraw tests, authenticated Camera Detection, live bridge/native APIs, a clean Release build with 0 warnings/errors, and 136/136 native tests.
- Native host validation recorded 108,650 HWND placement samples at a 0.092 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1016.exe`, 86,970,368 bytes, SHA256 `02796B4168B56BB82080FA0A86CC679F8C3FC8D09B9DD1DBFFA9DC26C45FE39D`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install, registered shortcut/uninstall/startup checks, installed launch health, and process-restart health passed. Live health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-26`; installed executable, DLL, dependency manifest, and runtime configuration hashes matched the published files.
- Live installed Privacy retained `revision 26 draft` after Refresh and kept Refresh focused; Camera Detection retained `http://camera-draft.local:5000` after Refresh and kept Refresh focused; Streaming retained `ws://example.test:4455` through Enter-submit with its input focused. All three controls stayed connected with no dashboard failure or horizontal overflow.
- Live `/api/displays/controls` reported one companion monitor, `scope=companion-only`, and `primaryExcluded=true`. The installed window was exact `619,2160`, `2560x720` on the non-primary monitor, while its work area was `2560x672`; the borderless topmost window therefore covered the full taskbar-reserved strip and exposed no caption, thick frame, or `APPWINDOW` taskbar style.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024 or visually prove taskbar/flicker behavior on every required topology.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Isolated panels and truthful Camera recovery

### Outcome

Asset revision `20260720-28` closes the stale-panel overwrite race and the remaining Camera Detection refresh-truth gaps. Revision 27 was deliberately rejected after its installed audit showed `Not updated` beside `Fresh Frigate sample`; revision 28 distinguishes setup and connection waiting, marks retained results cached after connection loss, serializes refreshes, and restores Fresh only after a successful response. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Gave each mounted inline panel a disposable isolated root so late asynchronous work can update only its detached former mount, never the newly selected panel.
- Preserved checkbox and radio identity with name plus value, and preserved select drafts by option value rather than mutable option index.
- Added rendered coverage for dirty text, textarea, checkbox, radio, select, and range controls while the authoritative model reorders them, plus model catch-up after the draft is no longer dirty.
- Serialized automatic and manual Camera Detection refreshes, raised the background poll interval from 10 to 30 seconds, and serialized Diagnostics health/config/Hue refreshes.
- Kept the last successful Camera Detection data after a connection failure while explicitly showing `Connection lost`, `Cached after connection loss`, and a local-cache explanation.
- Made unconfigured and not-yet-sampled Camera Detection show `Not updated` with `Waiting for setup` or `Waiting for connection`, never a nonexistent Fresh sample.
- Added HTTP 503, cached-data, bounded retry, reconnect, stale-mount teardown, rapid navigation, and installed draft/focus regressions.

### Validation

- Complete sequential `npm run check` passed in 158 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, 40 adaptive layout combinations, seven rendered geometries, 15 theme captures, 100/100 cold boots, stable reordered multi-control drafts, serialized refresh, stale-mount isolation, authenticated Camera live/loss/cache/reconnect behavior, live bridge/native APIs, a clean Release build with 0 warnings/errors, and 136/136 native tests.
- Native host validation recorded 106,647 HWND placement samples at a 0.094 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1053.exe`, 86,970,368 bytes, SHA256 `9106EA8E6EA355938B07FD71F1451EAF38B25AC1D40620C168934C116DC48E8F`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed shortcut registration, Apps & Features, cleanup, Safe Mode, Repair, autostart, installed launch health, and process-restart health. Live health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-28`; installed executable, DLL, dependency manifest, and runtime configuration hashes matched the published files.
- Installed unconfigured Camera Detection showed `Setup`, `Not updated`, and `Waiting for setup`, with no Fresh claim, fatal surface, or horizontal overflow. Its unsaved address `http://camera-draft.local:5000` survived Refresh with the Refresh button still focused.
- Rapid installed navigation across System, Network, Display Controls, Camera Detection, Audio, and back to System ended on exactly one System Monitor mount with no stale overwrite, fatal surface, or horizontal overflow. Installed Privacy likewise retained `revision 28 draft` with Refresh focused.
- Live `/api/displays/controls` reported one companion monitor, `scope=companion-only`, and `primaryExcluded=true`. The installed HWND was exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`, with no caption, thick frame, or `APPWINDOW`, topmost enabled, and full coverage of the `2560x672` work area's taskbar-reserved strip.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024 or visually prove taskbar/flicker behavior on every required topology.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Accessible controls and quiet unconfigured Camera

### Outcome

Asset revision `20260720-30` closes the remaining duplicate-control accessibility defects and stops unconfigured Camera Detection from generating background requests. Revision 29 was deliberately rejected after installed host logs proved that the dashboard health refresh bypassed the Camera panel's paused timer at 30 seconds. Revision 30 makes that controller refresh path fail quiet while retaining an immediate deliberate Refresh action. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Renamed the secondary dashboard settings-drawer action to the distinct visible label `Panel options`, with `Open panel options` and `Close panel options` accessible states.
- Assigned privacy-safe, unique Audio session names such as `Mute Audio App 1` and `Audio App 1 volume` without exposing hidden application identity.
- Paused Camera Detection's own timer while Frigate is unconfigured and made the controller's dashboard-driven refresh a no-op in the same state.
- Kept the visible Camera Detection Refresh action connected directly to the serialized request loop so a deliberate retry remains immediate.
- Added static and rendered regression coverage for the new accessible names, panel-options interaction, quiet automatic refresh contract, and manual refresh behavior.

### Validation

- Complete sequential `npm run check` passed in 153 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, 40 adaptive combinations, seven rendered geometries, 15 theme captures, 100/100 cold boots, focused redraw and stale-mount tests, Camera live/loss/cache/reconnect behavior, a clean Release build with 0 warnings/errors, and 136/136 native tests.
- Native host validation recorded 74,920 HWND placement samples at a 0.134 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1134.exe`, 86,970,368 bytes, SHA256 `87C41219169EC6E036B14F73503A477F08A4B38F1007899A232B8F5C220639D7`; exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed installed launch and restart health, shortcuts, Apps & Features, startup integration, Repair, quiet and interactive uninstall registration, and remove-data registration. Installed executable, DLL, dependency manifest, and runtime configuration hashes matched the published files.
- Live installed Audio exposed four unique privacy-safe mute/volume accessible names, no unnamed or duplicate visible controls, and the dashboard drawer exposed `Open panel options` instead of a second `Settings` control.
- Live installed unconfigured Camera Detection logged one `/api/frigate` request when opened and still exactly one after 34 seconds; a real pointer click on the 44px Refresh action produced exactly the second request and retained focus without a fatal surface or overflow.
- The installed Auxora HWND was exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`, borderless and topmost, with no caption, thick frame, or `APPWINDOW`. It covered the full 2560x720 monitor rather than the 2560x672 work area, including the taskbar-reserved strip.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024 or visually prove taskbar/flicker behavior on every required topology.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Privacy-safe System telemetry

### Outcome

Asset revision `20260720-31` closes a System Monitor privacy regression found by comparing the installed UI and live API with the product changelog. Revision 30 again enumerated running processes and exposed the top five application names, PIDs, CPU, and memory even though Top Processes was documented as removed. Revision 31 keeps overall system pressure and the explicit Task Manager handoff without collecting or publishing process identity through System telemetry. The dormant standalone Camera panel was also brought into the same quiet-unconfigured, 30-second contract as the production inline panel. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Removed `Process.GetProcesses`, per-process sampling caches, `SystemProcessSnapshot`, and `topProcesses` from the native System telemetry service and API schema.
- Replaced the installed top-app/PID list with a privacy-safe System tools panel that explains the boundary and retains Refresh plus Task Manager actions.
- Removed stale process and disk presentation from the standalone System Monitor asset and synchronized that asset with the current revision.
- Added source guards that reject process enumeration, process-identity API fields, and application/PID rendering in System Monitor.
- Added rendered and launched-host assertions proving `/api/system` omits `topProcesses`, the UI contains no application/PID list, and Task Manager remains available.
- Synchronized the standalone Camera panel to a 30-second recursive timer that stops after an unconfigured response instead of continuing background requests.

### Validation

- Complete sequential `npm run check` passed in 144.9 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, 40 adaptive combinations, seven rendered geometries, 15 theme captures, 100/100 cold boots, System telemetry privacy assertions, focused redraw and Camera recovery tests, a clean Release build with 0 warnings/errors, and 136/136 native tests.
- Native host validation recorded 112,561 HWND placement samples at a 0.089 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1200.exe`, 86,970,368 bytes, SHA256 `7722DA492795F5D93009774F38ED98D9D6883E1066698DD493711AB52086F785`; exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed installed launch and restart health, shortcuts, Apps & Features, startup integration, Repair, quiet and interactive uninstall registration, and remove-data registration. Installed executable, DLL, dependency manifest, and runtime configuration hashes matched the published files.
- The exact installed `/api/system` response remained `live` and omitted `topProcesses`. The installed 2560x720 System Monitor showed overall CPU/GPU/RAM, companion display, and thermal/power telemetry plus `Privacy-safe telemetry`; it exposed no application names or PIDs.
- Installed unconfigured Camera Detection generated one request when the browser audit opened it and still exactly one after 34 seconds. Opening it in the native app generated the expected next request, and a genuine native pointer tap on Refresh generated exactly one further immediate request.
- Installed Display Controls reported `ready`, `scope=companion-only`, `primaryExcluded=true`, and one controllable companion. The Auxora HWND remained exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`, borderless and topmost, with full coverage of the taskbar-reserved strip.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024 or visually prove taskbar/flicker behavior on every required topology.
- Complete the exact-candidate destructive clean install, upgrade, repair, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Routed Network telemetry and readable status

### Outcome

Asset revision `20260720-33` closes a Network Monitor truth and accessibility defect found by comparing the installed API with Windows' live route table. Revision 31 selected a faster Hyper-V virtual switch instead of the physical adapter Windows actually used. Revision 32 corrected the route but was deliberately rejected after its installed screen showed that a saved custom accent could make Network success values difficult to read. Revision 33 follows Windows routing, distinguishes local-router response from internet game readiness, and renders success values with contrast-checked semantic text. The exact beta candidate was rebuilt, verified, installed, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Selected Network Monitor's active adapter through the Windows IP Helper route decision for the external probe target, including legitimate routed VPN interfaces.
- Added a fail-closed fallback that prefers an IPv4 adapter with a gateway before advertised link speed, preventing disconnected or gateway-free virtual adapters from winning solely because they claim 10 Gbps.
- Sampled throughput only from the selected routed adapter and reset rate deltas whenever Windows changes the routed interface.
- Added native tests for physical-versus-Hyper-V routing, routed VPN selection, gateway fallback, and adapters without an IPv4 address.
- Carried the health-target source into the UI so a gateway probe is labeled `Router` and `Local link ready`, not an unqualified internet `Game ready` result.
- Changed Network success values from arbitrary custom-accent text to the semantic success color and added a rendered regression using a near-black custom accent.

### Validation

- Complete sequential `npm run check` passed in 139.7 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, 40 adaptive combinations, seven rendered geometries, 15 theme captures, 100/100 cold boots, dark-custom-accent Network contrast, Camera live/loss/cache/reconnect behavior, a clean Release build with 0 warnings/errors, and 140/140 native tests.
- Native host validation recorded 83,944 HWND placement samples at a 0.119 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1236.exe`, 86,970,368 bytes, SHA256 `8AB9B5E42A90296FE439F74F01BD981F24AB8B82EF54449B3E3592844057C305`; exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed installed launch and restart health, shortcuts, Apps & Features, startup integration, Repair, quiet and interactive uninstall registration, and remove-data registration. Installed executable, DLL, dependency manifest, and runtime configuration hashes matched the published files.
- The exact installed `/api/network` matched Windows' live default route: interface 12 `Ethernet`, Realtek PCIe 2.5GbE, 2.5 Gbps, IP `192.168.1.101`, gateway/DNS `192.168.1.254`; the former Hyper-V 10 Gbps selection was absent.
- The installed Network screen showed readable `100`, `Local link ready`, `Router`, `Ethernet`, IP, gateway, and DNS values with the user's saved accent. The Auxora HWND remained exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`, with no visible taskbar strip in the full-window capture.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the real exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND and browser evidence do not close BETA-024 or visually prove taskbar/flicker behavior on every required topology.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass covered local install, launch/restart, and Repair only.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Truthful controls and bounded confirmation

### Outcome

Asset revision `20260720-34` closes the remaining installed UI truth and safety defects found across Home, Modes, Quick Actions, System Shortcuts, Display Controls, Updates, and optional Camera Detection setup. Destructive actions now require a clearly bounded second tap, each surface describes only behavior the beta actually implements, and the exact candidate was rebuilt, verified, installed, and visually audited on the companion display. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Changed Home to identify the actual gateway, DNS, configured-target, or internet probe instead of describing a local-router response as general network responsiveness.
- Replaced the pre-confirmed appearance of destructive Quick Actions and System Shortcuts with `Two-step`; the first tap arms an explicit confirmation for eight seconds and automatically disarms when that window expires.
- Replaced Display Controls' premature no-controls result with an explicit DDC/CI capability scan while the native response is pending.
- Replaced unused Mode brightness percentages with the animation/motion intensity Auxora actually applies.
- Removed the unusable automatic-rollback action and fail-closed native rollback metadata; Updates now states that rollback is manual and requires retaining the previous verified installer.
- Corrected Diagnostics wording so discoverable Camera Detection is not described as hidden, while retaining quiet unconfigured polling, immediate deliberate Refresh, protected credentials, local camera/time filtering, safe snapshot binding, and connection-loss recovery.

### Validation

- Complete sequential `npm run check` passed in 150.5 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, 40 adaptive combinations, seven rendered geometries, 15 theme captures, 100/100 cold boots, eight-second confirmation expiry, Camera live/loss/cache/reconnect behavior, a clean Release build with 0 warnings/errors, and 140/140 native tests.
- Native host validation recorded 133,108 HWND placement samples at a 0.075 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1304.exe`, 86,970,368 bytes, SHA256 `1C38E43560CEB680548B7850C87DC63E19BE877F53A5E95F0F9A2A6A9A92D840`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed installed launch and restart health, shortcuts, Apps & Features, startup integration, Repair, quiet and interactive uninstall registration, and remove-data registration. Installed health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-34`.
- Installed Home showed `local router responds` and `Router`; Modes showed motion rather than brightness; Updates showed `Manual only` with no rollback action; unconfigured Camera Detection showed `Setup`, `Not updated`, and `Waiting for setup`; Display Controls showed `Checking companion controls` before reaching `Ready` with one non-primary DDC/CI monitor.
- The installed HWND was exact `619,2160`, `2560x720` on non-primary `\\.\DISPLAY2`, topmost and full-screen. A live composite capture of the physical companion display showed no Windows taskbar or title bar, and the app was left safely on Home.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; this pass verifies the current companion screen and taskbar coverage but not every required topology or interaction in BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass covered local install, launch/restart, and Repair only.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Stable startup and quiet refresh

### Outcome

Asset revision `20260720-35` closes the delayed full-dashboard reload that remained after a recovered first WebView navigation, removes avoidable unchanged-state redraw work, and deletes the stale automatic-rollback configuration that outlived its visible control. The exact beta candidate was rebuilt, verified, installed, and timed against the installed host log. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Bound startup retry work to the navigation attempt that created it and cancel the retry after a later success, while treating the one recoverable WebView interruption as informational rather than a dashboard warning.
- Kept the current Home sample visible during periodic background refresh instead of redrawing an intermediate loading state.
- Made shared inline-widget reconciliation a true no-op when the generated HTML is unchanged, and stopped rewriting the now-playing strip when its visible state has not changed.
- Removed obsolete automatic-rollback fields from configuration models, normalization, display saves, support/config responses, and dashboard mutation state; legacy stored fields are dropped during configuration load.
- Changed internal-facing `customer` labels in Theme Studio and Recovery to direct user-facing language.
- Added source guards, a configuration-migration test, a launched-host API assertion, and a rendered MutationObserver regression for these behaviors.

### Validation

- Complete sequential `npm run check` passed in 166.1 seconds: every source/theme/setup/boundary/redaction/display/release gate, both physical-receipt fixture suites, 40 adaptive combinations, seven rendered geometries, 15 theme captures, 100/100 cold boots, identical-HTML zero-mutation behavior, Camera live/loss/cache/reconnect behavior, a clean Release build with 0 warnings/errors, and 141/141 native tests.
- Native host validation recorded 128,642 HWND placement samples at a 0.078 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1328.exe`, 86,970,368 bytes, SHA256 `3346E6ED72D26F801231A90EF0DBA9F60EBA1213C138CD2FD0C583FD4F96000E`; exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed installed launch and restart health, shortcuts, Apps & Features, startup integration, Repair, quiet and interactive uninstall registration, and remove-data registration. Installed health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-35`.
- A fresh installed launch was observed for eight seconds. It produced exactly one `Dashboard loaded successfully`, no delayed second dashboard load, no warning/error or non-success request lines, and retained the expected single informational startup-interruption message before successful recovery.
- Live installed `/api/config` omitted the retired rollback fields. The protected rollback capability returned `supported=false`, `configured=false`, `status=unavailable`, manual-only guidance, and no obsolete rollback metadata.
- Native capture metadata placed the exact installed window at `619,2160`, `2560x720`, matching the full non-primary companion display bounds. Host evidence confirmed topmost, no-activate tool-window mode that stays off the taskbar; the app was left safely on Home.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; current-hardware automation does not close every topology and interaction in BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass covered local install, launch/restart, and Repair only.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Panel ownership and verified native rendering

### Outcome

Asset revision `20260720-37` closes a cross-panel asynchronous ownership race and rejects blank or intermediate WebView completions as successful dashboard startup. Revision 36 was deliberately rejected after its installed native window remained white despite a misleading success log. Revision 37 was rebuilt, verified, installed, and visibly rendered on the companion display. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Bound every inline-widget status and error callback to the widget and generation that created it, so a late Display Controls or Camera Detection response cannot relabel, redraw, or crash the next panel.
- Changed background surface-status updates to modify only the matching selector label instead of rebuilding the entire selector and potentially swallowing a tap.
- Tracked the actual dashboard navigation ID and accepted success only when both that navigation and the dashboard source matched; blank and intermediate completions now leave recovery active.
- Strengthened launched-host validation so a success log is insufficient: the embedded dashboard must itself request live configuration before startup passes.
- Added rendered regressions for late status/error isolation, selector-node preservation, and click stability, plus source guards for the native navigation contract.

### Validation

- Complete sequential `npm run check` passed in 157.6 seconds: all repository gates, 141/141 native tests, seven rendered geometries, 15 theme captures, 100/100 cold boots, widget-generation ownership, selector click stability, authenticated Camera live/loss/cache/reconnect behavior, and a clean Release build with 0 warnings/errors.
- Native host validation recorded 130,195 HWND placement samples at a 0.077 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1416.exe`, 86,970,368 bytes, SHA256 `FBA5F7E5F9621CF4996A9022251B5B19704BB1282254B678554E9F516C81817A`; exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed installed launch/restart health, shortcuts, Apps & Features, startup integration, Repair, quiet and interactive uninstall registration, and remove-data registration.
- A fresh exact installed launch reported asset revision `20260720-37`, exactly one `Dashboard loaded successfully`, two embedded `/api/config` requests, and zero warning, error, or non-success request lines.
- Native capture showed the actual Auxora Diagnostics interface filling the 2560x720 companion window. The formerly white display, dashboard-error overlay, Windows taskbar, and title bar were absent.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; fixtures and localhost tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; the current screen proves this topology but not every required BETA-024 transition.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass covered local install, launch/restart, and Repair only.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Camera renewal, setup feedback, and packaged fallback truth

### Outcome

Asset revision `20260720-38` closes the remaining Camera Detection concurrency and setup-feedback defects found in this pass and reduces the installed standalone widget set to the fallbacks the dashboard can actually open. The exact candidate was rebuilt, verified, installed, and exercised through launch, restart, and Repair. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added an authentication-generation lease to Camera Detection so simultaneous requests rejected by one expired Frigate session share a single successful renewal, even when the server returns the same token text.
- Added form-local, announced Camera setup feedback for saving, connected, removed, rejected, test-failed, and post-test status-refresh-failed states.
- Cancelled the browser's default form action before the busy guard, preventing a duplicate submit from turning into a GET navigation or reload.
- Renamed the setup action to `Save and test Camera Detection` and kept a successful connection test distinct from a later Diagnostics refresh failure.
- Corrected Calendar's fallback path to `/widgets/calendar-widget.html`.
- Replaced the wildcard standalone-widget package rule with the exact eight fallback pages referenced by the dashboard; unreachable legacy pages are no longer installed.
- Added native, rendered, source, and live-host regressions for concurrent renewal, local/private-address rejection beside the form, duplicate-submit cancellation, exact fallback packaging, and live Calendar serving.

### Validation

- Complete sequential `npm run check` passed in 155.7 seconds: every repository gate, 142/142 native tests, seven rendered geometries, 15 theme captures, 100/100 cold boots, Camera setup rejection and duplicate-submit cancellation, authenticated Camera live/loss/cache/reconnect behavior, exact fallback-resource allowlisting, a clean Release build with 0 warnings/errors, and embedded-dashboard startup proof.
- Native host validation recorded 132,652 HWND placement samples at a 0.075 ms effective interval with no visible Auxora window intersecting the Windows primary display.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1445.exe`, 86,949,888 bytes, SHA256 `08B5FB4DE257BF8230A6D72494917E2051C9CFB471A256C3A8F2AC7999EB5555`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed executable, shortcuts, Apps & Features registration, startup integration, live launch health, live restart health, and installed Repair. Installed health reported `Auxora`, `0.3.0-beta.1`, asset revision `20260720-38`.
- The installed live host served `/widgets/calendar-widget.html` with status 200 and rejected removed `/widgets/home-automation-panel.html` with status 404. Camera Detection remained intentionally unconfigured after the invalid-address test.
- The fresh installed host logged one successful embedded dashboard load, the full dashboard asset set, and live configuration requests with no warning, error, or non-success request lines. Windows Computer Use returned a uniformly black capture for the off-primary WebView window despite those runtime receipts, so this pass does not treat that capture as physical visual proof.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; automated authentication, rendering, and recovery tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND placement and prior current-hardware captures do not close every BETA-024 transition, and the revision-38 capture path did not provide new visual evidence.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass covered local install, launch/restart, and Repair only.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Isolated UI QA, complete Modes, and private fast startup

### Outcome

Asset revision `20260720-39` closes the UI, Mode lifecycle, Camera memory, test-isolation, and startup/readiness defects found in this pass. The exact candidate was rebuilt, verified, installed, and exercised through launch, restart, and Repair. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Required explicit, fail-closed roaming and local test data roots in the native host, and made every launched-host suite prove that its config and log files were created only inside the isolated profile.
- Fixed clipped primary navigation labels at supported companion sizes and removed Theme Studio's redundant Theme dropdown, leaving the three Focus, Gaming, and Warm cards as the single Theme selector.
- Added complete custom Mode editing for name, Theme, spacing, performance, and motion, plus an eight-second two-step delete flow that safely synchronizes the active Mode and falls back to Work.
- Cleared Camera Detection credentials, cached detections, and connection receipts from memory after configuration changes, removal, and local-data reset; an in-flight generation guard prevents stale responses from restoring cleared state.
- Queued slow initial system/network telemetry off the startup path, preserved native-host diagnostics on rendered failures, and changed host responsiveness probes so they do not pile up canceled detailed health requests.
- Stopped routine health checks from enumerating clipboard history; the health payload now reports capability and privacy state without reading clipboard entries.
- Made Recovery and destructive-action rendering wait for real native hydration and accept the truthful safe state when no companion display is connected; Auxora remains hidden instead of opening on the Windows primary display.

### Validation

- Complete sequential `npm run check` passed in 662.3 seconds: all source/theme/setup/boundary/redaction/display/release gates, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, 100/100 cold boots, custom Mode lifecycle, Camera live/loss/cache/reconnect and sensitive-state clearing, truthful companion-absent Recovery, a clean Release build, and 147/147 native tests.
- Native host validation recorded 3,650 placement samples at a 2.74 ms effective interval on a 2560x720 primary-only topology. No visible Auxora windows were observed; live display status said Auxora was waiting for a companion display and would not open on the primary display.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1606.exe`, 86,949,888 bytes, SHA256 `4BDF16DB6F69EE71FA075DFDC5E1A09E5E8FAAAAC11B8EC61C2F7F331D3ECC80`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed executable, shortcuts, Apps & Features registration, startup integration, live launch health, live restart health, and installed Repair. The installed executable exactly matched the published executable.
- The final installed runtime reported `Auxora`, version `0.3.0-beta.1`, asset revision `20260720-39`, zero warning/error/non-success request lines, and no visible main window while the companion display was absent.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; automated authentication, rendering, privacy, and recovery tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt on the companion hardware; the primary-only safety receipt proves fail-closed behavior but does not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass intentionally covered only in-place install, launch/restart, and Repair.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Stable global settings and focused Camera setup

### Outcome

Asset revision `20260720-40` closes the remaining global settings focus/blur crash path and the adjacent installed UI and Camera lifecycle defects found in this pass. The exact candidate was rebuilt, verified, installed, and exercised through launch, restart, and Repair. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Replaced every live global settings-body `innerHTML` assignment with stable DOM reconciliation and added a re-entrant render guard so a change or blur event cannot start a second node-removal pass.
- Changed the fallback dashboard patch path to build disconnected template content and use `replaceChildren`, eliminating live `innerHTML` removal even when the shared reconciler is unavailable.
- Limited post-scroll click suppression to active touch gestures, so mouse, keyboard, browser, and programmatic scrolling cannot consume the next action.
- Removed the redundant opaque Diagnostics rail card, made the top status publish `Needs Setup` when onboarding or display attention remains, and shortened the selected-panel chip to the panel name.
- Replaced unconfigured Camera Detection's zero metrics, blank snapshot, and empty event list with one setup card containing explicit Setup and Refresh actions.
- Added a Camera sensitive-state cancellation lease: changing, removing, or resetting Camera Detection swaps and cancels the old request token immediately, clears authentication without waiting for an in-flight login, rejects stale results by generation, and preserves the caller's own cancellation semantics.
- Added static, rendered, and native regressions for the reported settings crash class, first-click behavior after non-touch scroll, rail removal, truthful chrome, focused Camera setup, and nonblocking in-flight credential cancellation.

### Validation

- Complete sequential `npm run check` passed in 680 seconds: all repository gates, 148/148 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, focused settings change/blur reconciliation, non-touch first-click activation, authenticated Camera live/loss/cache/reconnect, and 100/100 cold boots.
- Native host validation recorded 3,129 HWND placement samples at a 3.196 ms effective interval on the 2560x720 primary-only topology with no visible Auxora windows.
- Dependency audits reported zero known vulnerabilities in the root npm tree, Electron npm tree, and both NuGet projects.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1710.exe`, 86,953,984 bytes, SHA256 `E4C855A456837DA2B168EC23B62A0DD22397687C8CB38F22D111D8368D6FC294`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact install smoke passed executable, shortcuts, Apps & Features registration, startup integration, installed launch, process restart, and installed Repair. The installed executable hash exactly matched the published executable.
- The exact installed dashboard reported revision `20260720-40`, `Needs Setup`, and `Theme Studio` with no redundant Diagnostics rail card. The final installed host ran from the expected per-user install path with main-window handle `0`; live health reported `waiting-for-companion-display`, zero companion displays, and explicitly stated that Auxora would not open on the Windows primary display.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; automated authentication, rendering, privacy, cancellation, and recovery tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt on companion hardware; the primary-only safety receipt proves fail-closed behavior but does not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass intentionally covered only in-place install, launch/restart, and Repair.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Truthful renderer recovery and packaging advisory closure

### Outcome

Asset revision `20260720-41` removes the last internal-development fallback copy found in the shipped panel runtime, makes unmatched native feature routes report an unavailable endpoint instead of claiming an unfinished feature, and closes the newly published Electron packaging advisory. The exact candidate was rebuilt, verified, installed, and exercised through launch, restart, and Repair. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Replaced the emergency inline renderer's `Inline migration`, `In Progress`, and `Panel still moving off iframe` language with a stable, user-facing `Panel unavailable` recovery state that keeps the rest of Auxora usable and points to restart, logs, and Repair.
- Routed the fallback through the shared stable DOM reconciler so even the recovery surface follows the same focus-safe rendering contract as production panels.
- Added a source gate that requires a registered inline renderer for every shipped canonical surface, including Camera Detection, and rejects internal migration wording from the fallback.
- Replaced the native unmatched-route message `not implemented yet` with a truthful endpoint-unavailable response; implemented Audio, Media, and Hue routes continue to use their real handlers.
- Updated six transitive `brace-expansion` lockfile entries used by Electron packaging from vulnerable releases to `1.1.16`, `2.1.2`, and `5.0.7` without changing Electron or electron-builder.

### Validation

- Complete sequential `npm run check` passed in 631.4 seconds: every repository gate, 148/148 native tests, seven rendered geometries, 15 Theme captures, 100/100 cold boots, settings focus/blur stability, non-touch first-click behavior, renderer/status ownership, Camera Detection setup/live/loss/cache/reconnect behavior, a clean Release build with 0 warnings/errors, and bridge/native API coverage.
- Final exact-installer gauntlet validation recorded 3,995 HWND placement samples at a 2.504 ms effective interval with no visible Auxora window on the primary-only display topology.
- `npm run audit:deps` passed after the lockfile update: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities. Dependency-pin and Electron syntax checks also passed.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1750.exe`, 86,953,984 bytes, SHA256 `15523A9B07A356D3D399117B5E55FC94D3EE6CE792965D7CB573E4A96D8E782B`; the sidecar matched and exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact in-place install smoke passed executable, shortcuts, Apps & Features registration, startup integration, live launch health, live process-restart health, and installed Repair. The installed executable SHA256 matched the published executable.
- The installed host reported `Auxora`, `0.3.0-beta.1`, dashboard revision `20260720-41`, one primary display, zero companion displays, and `waiting-for-companion-display`; PID 56420 had main-window handle `0`, and the health message explicitly stated that Auxora would not open on the Windows primary display.
- A fresh installed-browser audit loaded 24 revision-41 asset references at 1280x720, rendered the single unconfigured Camera Detection setup card, had zero horizontal overflow, and contained no dashboard failure or runtime-error state.
- The final non-installing release gauntlet passed its dependency audit, complete repository check, and exact unsigned-beta artifact verification, then stopped only at the clean-working-tree policy. The dirty tree is intentionally preserved and was not staged or committed without owner authorization.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; automated authentication, rendering, and recovery tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt; automated HWND placement does not close BETA-024.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass intentionally covered only in-place install, launch/restart, and Repair.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Installed blur-crash closure and provisioning privacy minimization

### Outcome

Asset revision `20260720-42` closes the newly reported installed Theme Studio `innerHTML`/blur crash path, fixes the adjacent Custom accent state bug, stabilizes the Diagnostics name, and removes unnecessary local launcher execution details from public dashboard API payloads. The exact candidate was rebuilt, verified, installed, repaired, restarted, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Replaced the remaining dashboard template and one-time panel `innerHTML` setter paths with detached contextual-fragment parsing plus stable DOM reconciliation.
- Added a Theme Studio focus owner and pending-redraw queue so selects, sliders, and color inputs finish their browser blur cleanup before reconciliation can move or remove nodes.
- Fixed Custom accent's render-scope reference error and enabled or disabled the color input immediately from the live selection without replacing the focused form.
- Kept the setup/repair destination named `Diagnostics` before and after onboarding, with `Setup & diagnostics` as its stable context.
- Added summary and public provisioning DTOs. Health and config receive no launcher suggestions; provisioning actions return only suggestion ID, display name, and source. Executable paths, icon paths, arguments, reason, selection internals, browser profiles, and URLs remain inside the native service where applying a reviewed suggestion requires them.
- Changed Diagnostics to request the minimized `/api/provisioning` payload directly for launcher review instead of relying on raw provisioning data embedded in health or config.
- Added source guards, a native privacy unit test, live API assertions, and a focused real-browser regression covering Theme variant, Custom accent, blur, fatal-overlay absence, and control preservation.

### Validation

- Complete sequential `npm run check` passed in 621.4 seconds: every repository gate, 149/149 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, focused settings and Theme change/blur reconciliation, immediate Custom accent state, stable Diagnostics navigation, provisioning API minimization, authenticated Camera live/loss/cache/reconnect behavior, and 100/100 cold boots.
- Native-host validation recorded 3,422 HWND placement samples at a 2.925 ms effective interval on the 2560x720 primary-only topology; no visible Auxora windows were observed.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1849.exe`, 86,953,984 bytes, SHA256 `B2F6133529F67CBC376F15B50E079FDC33E061C7B212A8B693ECDA7B7794F7C5`; its sidecar and exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact in-place install smoke passed the executable, Start menu and desktop shortcuts, Apps & Features registration, quiet uninstall registration, install location, startup integration, and installed Repair. The installed executable SHA256 `D14BEFC532C0FDE05CD5CEE4F175615D286922E5477B879CB1B705CF6D697D36` exactly matched the published executable.
- The restarted installed host reported `Auxora` `0.3.0-beta.1`, revision `20260720-42`, one active primary display, zero companion displays, `waiting-for-companion-display`, and main-window handle `0`; its message explicitly stated that Auxora would not open on the Windows primary display.
- Live installed `/api/health` and `/api/config` contained no provisioning suggestion or execution fields. `/api/provisioning` exposed review identities without executable paths, icon paths, arguments, browser profile values, or URLs.
- Live installed browser validation changed Night and Readability without a fatal surface, console warning/error, or horizontal overflow, then opened stable `Diagnostics`; launcher review displayed only app names and `Start Menu` source labels.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; automated authentication, rendering, privacy, and recovery tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt on companion hardware; primary-only fail-closed placement does not close BETA-024 or physically prove taskbar suppression on that device.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass intentionally covered only in-place install, restart, and Repair.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Authorized background refresh

### Outcome

Asset revision `20260720-43` closes the recurring background refresh rejection found during the final installed revision-42 log audit. The exact candidate was rebuilt, verified, installed, repaired, restarted, and observed live across four Scene evaluation cycles. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Added the native `X-Xenon-Session` token explicitly to the dashboard's background JSON mutation helper instead of depending solely on the host's injected fetch wrapper.
- Added a source remediation gate that fails if the explicit mutation header is removed.
- Advanced all shipped runtime asset references to revision `20260720-43` so installed evidence cannot be confused with the previous candidate.

### Validation

- Complete sequential `npm run check` passed in 652 seconds: every repository gate, 149/149 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, focused Theme change/blur behavior, Camera live/loss/cache/reconnect, and 100/100 cold boots.
- Native host validation recorded exactly 4,000 placement samples at a 2.505 ms effective interval on the 2560x720 primary-only topology with no visible Auxora window.
- `npm run audit:deps` passed immediately before packaging: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1909.exe`, 86,953,984 bytes, SHA256 `B931D6115241826690A4EFAA085F6F5233D9E9439730D7A6E05AD949C1162143`; exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact in-place install and Repair passed the executable, shortcuts, Apps & Features registration, uninstall commands, install location, and startup integration checks. Installed and packaged executable hashes both equal `D14BEFC532C0FDE05CD5CEE4F175615D286922E5477B879CB1B705CF6D697D36`.
- The restarted installed host reported revision `20260720-43`, one active primary display, zero companion displays, `waiting-for-companion-display`, and main-window handle `0`. Its message explicitly states that Auxora will not open on the Windows primary display.
- Over 93.6 seconds the installed host completed four background `POST /api/scenes/evaluate` requests with status `200` and logged zero warnings or errors. Installed health/config responses contained no private provisioning execution fields, and provisioning suggestions exposed only ID, display name, and source.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; automated authentication, rendering, privacy, and recovery tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt on companion hardware; primary-only fail-closed placement does not physically prove taskbar suppression, touch, scaling, or hotplug behavior on that device.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass intentionally covered only in-place install, restart, and Repair.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 RC continuation — Truthful Diagnostics completion state

### Outcome

Asset revision `20260720-44` removes the contradictory inert setup-completion action found in the installed revision-43 UI audit and simplifies the repeated Diagnostics hierarchy. The exact candidate was rebuilt, verified, installed, repaired, and audited live. Nothing was staged, committed, tagged, pushed, published, or externally released.

### Implemented

- Removed the disabled `Auto ready` control that appeared while Diagnostics simultaneously reported `Needs Setup`.
- Made `Finish setup` appear only when required setup is actually ready to complete and onboarding is not already complete.
- Replaced the nested `Diagnostics` / `Auto setup and diagnostics` repetition with a concise `Readiness overview` / `System readiness` hierarchy.
- Added source and rendered regressions that reject inert completion controls and verify the installed heading semantics.

### Validation

- Complete sequential `npm run check` passed in 609.2 seconds: every repository gate, 149/149 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, focused Theme and settings blur behavior, Camera live/loss/cache/reconnect, and 100/100 cold boots.
- Native host validation recorded 3,401 placement samples at a 2.947 ms effective interval on the 2560x720 primary-only topology with no visible Auxora window.
- `npm run audit:deps` passed immediately before packaging: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260720-1942.exe`, 86,953,984 bytes, SHA256 `19109BA6ECF4D856C051BBA60174541E66A9D8D3DA28705C4AAE82538CF8D200`; exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact in-place install and Repair passed executable, shortcut, Apps & Features, uninstall-command, install-location, and startup-integration checks. Installed and published executable hashes both equal `D14BEFC532C0FDE05CD5CEE4F175615D286922E5477B879CB1B705CF6D697D36`.
- The installed host reported revision `20260720-44`, one active primary display, zero companion displays, `waiting-for-companion-display`, and main-window handle `0`; it remained completely hidden from the primary display.
- Installed-browser validation showed `System readiness`, no `Auto ready` or disabled `Finish setup` control, no fatal state, no horizontal overflow, and no console messages.
- Over 139.1 seconds the installed runtime logged nine background `POST /api/scenes/evaluate` requests with status `200` and zero warnings or errors.

### Remaining gates

- Produce the real exact-candidate physical Frigate receipt; automated authentication, rendering, privacy, and recovery tests do not close BETA-022.
- Produce the full exact-candidate physical display/touch/scaling/hotplug/accessibility receipt on companion hardware; primary-only fail-closed placement does not physically prove taskbar suppression, touch, scaling, or hotplug behavior on that device.
- Complete the exact-candidate destructive clean install, upgrade, rollback, uninstall, and remove-data lifecycle in a disposable Windows VM/profile; this pass intentionally covered only in-place install, restart, and Repair.
- Sign the executable and installer before paid/stable distribution and close external support/security ownership gates.

## 2026-07-20 completion audit — Local closure and external stop

### Outcome

The revision-44 completion audit found 48 tracked beta findings: 45 are closed with source, rendered, native, artifact, install, or live evidence, and three remain open only because their required physical or disposable-environment receipts do not exist. No additional locally actionable UI, feature, Camera Detection, display-policy, privacy, packaging, or runtime defect was found. This is not a public-release approval.

### Evidence checked

- The exact installer `Auxora-Setup-0.3.0-beta.1-20260720-1942.exe` passes local beta readiness, artifact identity, support, privacy, advanced-setup, packaging, and uninstall-data checks when the intentionally dirty user-owned tree is exempted.
- The strict readiness command reran every local rule and failed with exactly one local blocker: `Working tree has uncommitted changes.` The 119-entry tree was preserved; no files were staged, committed, pushed, tagged, or published without owner authorization.
- No non-fixture lifecycle, Frigate qualification, display qualification, or release-assets receipt was found in the workspace.
- The publication workflow requires lifecycle, physical Frigate, and physical display receipts as mandatory inputs and verifies all three against the immutable release manifest.
- Installed health reports revision `20260720-44`, one active primary display, zero companion displays, `waiting-for-companion-display`, no configured Frigate server, and main-window handle `0`.
- Windows Sandbox availability could not be established or enabled from the current non-elevated session; the required destructive lifecycle cannot be substituted with the normal user profile.

### External or authorization gates

- Provide a disposable Windows VM/profile and authorize the destructive install, reboot/autostart, previous-beta upgrade, Repair, rollback, uninstall, and remove-data lifecycle, then generate its schema-1 receipt.
- Connect the intended physical Frigate server and real camera, complete the TLS/authentication/filtering/token-expiry/disconnect/reconnect matrix, and generate the secret-free receipt.
- Connect the physical touch companion display and complete taskbar, primary-role switching, unplug/replug, scaling, touch, keyboard, screen-reader, reduced-motion, and flicker certification, then generate the privacy-safe receipt.
- Authorize source-control finalization so the exact candidate can be bound to a clean commit and immutable tag. Signing remains required before paid/stable distribution; the clearly labeled free beta may use the documented unsigned path.

## 2026-07-21 RC continuation — Native XENEON resolution and sticky movable placement

### Outcome

Asset revision `20260721-46` is installed and running on the connected physical XENEON EDGE. Windows had configured the panel at 1280×1024/75 Hz, producing an 853×683 logical viewport, wrapped navigation, clipped content, and the wrong composition. The panel is now at its supported native 2560×720/60 Hz mode. Auxora remains locked to that companion by default, exposes a deliberate constrained move mode, restores fullscreen after the move window closes, and reasserts z-order after Windows finishes raising the companion taskbar.

### Validation

- Complete sequential `npm run check` passed in 153 seconds: every repository gate, 151/151 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, 100/100 cold boots, and 173,885 live HWND placement samples on the two-display topology.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installed health reports revision `20260721-46`, two active displays, one companion, hardware identity `CRXED00`, native 2560×720 mode at 60 Hz, and no native-mode correction required.
- Locked placement is visible at exact Windows bounds `(619,2160) 2560×720`, topmost, non-activating, outside the primary display, and covers the complete companion surface without the 48-pixel taskbar.
- `Move Auxora Display...` produced a normal movable 1120×688 app window entirely within the companion. Closing it kept the process alive and restored exact 2560×720 topmost placement; a capture taken after a four-second Windows settle still showed no taskbar.
- A 50-cycle soak issued four concurrent `/api/media` requests per cycle: 200 requests, zero failures, zero new host warnings/errors, and zero media timeout warnings.
- Installer: `app/dist/Auxora-Setup-0.3.0-beta.1-20260721-0752.exe`, 86,958,080 bytes, SHA256 `1DFB21E2D0E67022309E3B3E8225C3341296F422C4AA1A260679BAE62BBD1DEE`; exact artifact verification passed with the expected unsigned-free-beta warning.
- Exact in-place install, launch-health restart, and Repair passed. Installed and published executable hashes both equal `19DC14C8BF6AB7921AEE515230F47C8687FD0A9C40AEEEAF68C36D4975CCC`.
- The 122-entry user-owned working tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining gates

- Physical unplug/replug, primary-role switching, scaling matrix, touch/long-press, keyboard, screen-reader, and reduced-motion certification still require the complete privacy-safe display receipt; this live pass closes native resolution, locked placement, taskbar coverage, and move/cancel behavior only.
- The existing Frigate, disposable lifecycle, signing, source-control, and owner-approval gates remain unchanged.

## 2026-07-21 RC continuation — XENEON hardware identity

### Outcome

Asset revision `20260721-47` is installed and running on the connected physical XENEON EDGE. Auxora now converts only the known `CRXED00` generic Windows label to `XENEON EDGE`; a specific manufacturer-provided friendly name still wins, and the hardware-backed stable display ID is unchanged.

### Validation

- Complete sequential `npm run check` passed in 192.1 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, 100/100 cold boots, and 78,858 live HWND placement samples on the two-display topology.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260721-1801.exe` is 86,958,080 bytes with SHA256 `DAEE6A2E70CCB7528F719ABDB5406AB12DBA76F48936F96ACADA4AF91E61DC73`; it is intentionally unsigned under the documented free-beta path.
- Exact in-place installation succeeded. Installed health reports revision `20260721-47`, display ID `CRXED00`, `friendlyName=XENEON EDGE`, native 2560×720 at 60 Hz, and no native-mode correction required.
- The installed Modes display assignment reads `XENEON EDGE (2560x720)` instead of `Generic PnP Monitor (2560x720)`.
- The only visible installed Auxora window is uncloaked at exact companion bounds `(619,2160)-(3179,2880)`, has topmost status, does not intersect the primary display, and precedes the secondary taskbar in live z-order; the secondary taskbar remains underneath Auxora.
- Published and installed revision-bearing DLL hashes both equal `D2E822293ED61C6911058439E62A81518B970FEC475AE886FBB7EC762427CE4B`. The current runtime log tail contains no warning, error, timeout, or exception entry.
- The user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining gates

- Complete the physical display receipt for unplug/replug, primary-role switching, the full scaling matrix, touch/long-press, keyboard, screen-reader, reduced-motion, and flicker behavior.
- Complete the exact-candidate physical Frigate receipt and disposable Windows lifecycle receipt.
- Obtain source-control finalization authority and code signing before paid/stable distribution; the candidate has not been externally published or released.

## 2026-07-21 RC continuation — Expiring local-data reset

### Outcome

Asset revision `20260721-48` is installed and running on the physical XENEON EDGE. Diagnostics no longer leaves its destructive local-data reset armed indefinitely: the warning owns status for eight seconds, then cancels automatically. Selecting another Diagnostics action cancels the armed state, and closing the panel disposes its timer.

### Validation

- Complete sequential `npm run check` passed in 200.8 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, 100/100 cold boots, and 75,853 live HWND placement samples on the two-display topology.
- The rendered regression first reproduced the revision-47 failure in the isolated test profile: after the confirmation remained armed, a later click issued one destructive reset. Against the rebuilt revision-48 host, the unchanged production interaction displayed `Tap again within 8 seconds`, expired to `Reset cancelled`, re-armed and cancelled safely, issued zero native reset requests, and produced no fatal or runtime error.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260721-1825.exe` is 86,958,080 bytes with SHA256 `FCEFEE413EC59E822F11E0B36AAA4E1879A46C20C1058F04626CCD1739B1C35B`; it is intentionally unsigned under the documented free-beta path.
- Exact in-place installation succeeded. Installed health reports revision `20260721-48`, completed onboarding, display `ready`, and `XENEON EDGE (2560x720)`.
- The exact installed UI repeated the full expiry/re-arm/cancel interaction. The host log contains zero `/api/config/reset` requests, proving no local data was erased, and the runtime tail contains no warning, error, timeout, or exception entry.
- The installed Auxora window remains visible and topmost at exact companion bounds `(619,2160)-(3179,2880)`, ahead of the secondary taskbar in z-order and outside the primary display.
- Published and installed revision-bearing DLL hashes both equal `5B589CBF1CF5458B12C58FF3D93B96BD5EF951174EABA1CB63E9D09300A0B74B`.
- The user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining gates

- Complete the physical display receipt for unplug/replug, primary-role switching, the full scaling matrix, touch/long-press, keyboard, screen-reader, reduced-motion, and flicker behavior.
- Complete the exact-candidate physical Frigate receipt and disposable Windows lifecycle receipt.
- Obtain source-control finalization authority and code signing before paid/stable distribution; the candidate has not been externally published or released.

## Revision 49 installed Touch Lock qualification (2026-07-21)

### Outcome

Asset revision `20260721-49` is installed and running on the physical XENEON EDGE at its native 2560×720/60 Hz mode. Touch Lock now creates an actual persistent interaction boundary instead of only changing its label: all dashboard regions behind the transparent lock guard are inert, protected controls cannot act, and Unlock Touch remains the single deliberate exit.

### Validation

- Complete sequential `npm run check` passed in 204.8 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, 100/100 cold boots, Camera Detection live/loss/reconnect coverage, and 80,991 native HWND placement samples on the two-display topology.
- The rendered interaction suite proved Touch Lock isolation, persistence across reload, and focus recovery. It also caught and closed a reset-confirmation race: selecting another Diagnostics control now redraws the safe cancelled state immediately even when an earlier refresh is still in flight; no reset POST occurs.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260721-1921.exe` has SHA256 `3622AD593EEC2273B4315B54373F7AB015A904BDA96F2D0390B8BB48AE53429D`; it is intentionally unsigned under the documented free-beta path.
- Exact in-place installation succeeded. Installed health reports revision `20260721-49`, completed onboarding, display `ready`, and `XENEON EDGE (2560x720)` at `(619,2160)-(3179,2880)`.
- Installed 2560×720 DOM geometry exactly matched the display: viewport, document, and body were all 2560×720 with no horizontal or vertical overflow and no dashboard runtime failure.
- While locked, live installed clicks on Modes, Quick controls, and Reset local data produced no navigation, drawer, or reset-confirmation change. Four dashboard regions remained inert, Unlock Touch retained focus, and the lock survived a reload. Unlocking removed every inert region, returned focus to Touch Lock, and restored working Modes navigation.
- The installed window was visible at exact companion bounds, outside the primary display, and ahead of the visible primary taskbar in desktop z-order; no secondary taskbar window was present on the companion during this qualification.
- Published and installed binaries matched exactly: EXE SHA256 `19DC14C8BF6AB7921AEE515230F47C8687FD0A9C40AEEEAF68C36D4975CCC128`; DLL SHA256 `BBFAEA32756DC80ECCDD6FB216BDB576644772D49DD3A219DCC066CA2FDAE2DE`.
- Five expected security warnings were logged while the stale revision-48 audit tab reconnected during installation without the new session token; after the revision-49 page loaded, the final runtime tail contained only successful INFO requests and no further warning, error, timeout, exception, or fatal entry. No `/api/config/reset` request occurred.
- The user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining release gates

- BETA-011: exact-candidate install, upgrade, repair, uninstall, rollback, and reboot/autostart receipt from a disposable Windows environment.
- BETA-022: exact-candidate physical Frigate server and camera qualification receipt.
- BETA-024: the remaining physical unplug/replug, primary-role switching, scaling, touch/long-press, keyboard, screen-reader, reduced-motion, and flicker matrix.
- Authenticode signing and source-control/release authority remain external owner actions; this unsigned beta installer has not been published.

## Revision 56 Windows High Contrast qualification (2026-07-22)

### Outcome

Asset revision `20260722-56` is installed and running on the physical non-primary XENEON EDGE at native 2560×720/60 Hz. Windows forced-colors mode now removes Auxora's decorative ambient layers, gives action controls system-color boundaries, keeps selected states distinct, uses the system highlight for keyboard focus, and prevents Theme Studio's color input from opting out of the High Contrast palette.

### Implemented

- Added an explicit `forced-colors: active` presentation that removes ambient canvas/glow/pseudo-element decoration and nonessential shadows.
- Added system `ButtonFace`/`ButtonText` boundaries plus `Highlight`/`HighlightText` selected states for product actions, including the previously borderless Home actions, Game Mode Steam launch cards, and Camera Detection setup/refresh buttons.
- Added a system-highlight keyboard focus ring and forced Theme Studio's color input back into automatic Windows forced-color handling.
- Extended the three-theme rendered matrix with forced-colors media activation, selected-navigation distinction, real keyboard Tab focus, control-boundary, opt-out, overflow, and fatal-state checks.
- Extended the exact 2560×720 product-surface sweep to open and inspect all 23 registered surfaces under Windows forced colors.

### Validation

- The new tests first failed on the ambient layers, then on Home/Game Mode control boundaries, then on Camera Detection controls, and finally on Theme Studio's forced-color opt-out. The accepted implementation passed only after each reproduced defect was corrected.
- Complete sequential `npm run check` passed in 178.5 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven viewport geometries, all 23 registered product surfaces in normal and forced-colors sweeps at exact 2560×720, three-theme forced-colors keyboard/selection coverage, 15 Theme captures, 100/100 cold boots, Camera Detection live/loss/reconnect, all eight standalone fallbacks, and 162,557 native HWND placement samples.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260722-0229.exe` is 86,958,080 bytes with SHA256 `DEBE288E564F4F8CD457D57FB0370E8C83336773F804907744F0907B7B0A7E8A`; the exact artifact verifier passed with the expected unsigned-free-beta warning.
- The IExpress wrapper exceeded its five-minute wait, but no installer process remained and authoritative installation evidence proved completion: the installer transcript closed normally, live health and `/assets/revision.json` report `20260722-56`, and the installed app is running from the expected per-user location.
- Installed health reports `display=ready`, two active displays, one companion display, and non-primary `XENEON EDGE (2560x720)` at `(619,2160)` in native 2560×720/60 Hz mode. Startup logs state that the taskbar-free topmost tool-window policy was applied and the dashboard completed a successful HTTP 200 navigation.
- Published and installed binaries match exactly: EXE SHA256 `21651BB54786D7E9D92FCA2807332F695690650EAA6A54F2A3738C972782EA1E`; DLL SHA256 `4E2F45845056BBB0C17133206E329F8672D77AAEC2F8446CAB1FADF4C871DE23`.
- The installed server's `css/widgets.css` contains the forced-colors media block, ambient removal, system button boundary, Game Mode and Camera Detection selectors, and Theme Studio color-input override. The 282-line installed session contained zero warnings and zero errors.
- The accessibility note, Theme captures, and detailed `npm run check` transcript are retained in the local ignored qualification archive, not as repository artifacts.
- The user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining release gates

- BETA-011: exact-candidate install, upgrade, repair, uninstall, rollback, and reboot/autostart receipt from a disposable Windows environment.
- BETA-022: exact-candidate physical Frigate server and camera qualification receipt.
- BETA-024: physical unplug/replug, primary-role switching, full scaling, touch/long-press, screen-reader, and human-observed flicker checks. Reduced-motion and Windows forced-colors behavior are now automated locally but still require the final physical certification receipt.
- Authenticode signing and source-control/release authority remain external owner actions; this unsigned beta installer has not been published.

## Revision 55 conditional-feature discoverability and privacy qualification (2026-07-22)

### Outcome

Asset revision `20260721-55` is installed and running on the physical XENEON EDGE at native 2560×720/60 Hz. All 23 registered product surfaces are now discoverable and included in the exact companion-resolution sweep. Clipboard History is reachable with previews hidden by default; Weather and Calendar provide direct Diagnostics handoffs; Philips Hue exposes local setup without exposing an unusable quick shortcut before a bridge is linked.

### Validation

- Complete sequential `npm run check` passed in 168.7 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven viewport geometries, all 23 registered product surfaces at exact 2560×720, all eight shipped standalone fallbacks, 15 Theme captures, 100/100 cold boots, Camera Detection live/loss/reconnect coverage, and 161,091 native HWND placement samples on the two-display topology.
- The installed audit proved direct links to Clipboard History, Weather, Calendar, and Philips Hue no longer fall back to Network. Calendar, Weather, and Hue remain truthful `Optional` surfaces; Clipboard History reports `Ready` only after its explicit panel request reads Windows history.
- Clipboard health remains metadata-only. When the installed panel was deliberately opened, all 12 returned entries rendered only as `Hidden by privacy mode`, the action remained `Show previews`, and no raw clipboard content appeared.
- Weather and Calendar each exposed one `Open Diagnostics` action. Installed clicks selected Diagnostics, revealed the correct optional form, and focused `apiKey` and `icsUrl` respectively. Hue exposed its local bridge form while the unlinked `Lights` quick control remained hidden and disabled.
- Layout Editor now includes Clipboard History, reports 12 panels, and rendered 62 visible inline actions with a 44×44 minimum. The installed Home Mode remained uncluttered with only `home`, `system`, `audio`, and `quick-actions`; unconfigured Weather, Calendar, and Hue were absent from the ordinary Mode layout.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260722-0147.exe` is 86,958,080 bytes with SHA256 `BFD254B22F5A74A21B804131C7C102FA48E9EEB24D7BB2E98C15CDFED3875F8D`; it is intentionally unsigned under the documented free-beta path. The installer exited with code 0.
- Installed health and `/assets/revision.json` both report `20260721-55`, version `0.3.0-beta.1`, display `ready`, two active displays, one companion display, and `XENEON EDGE (2560x720)` at `(619,2160)` in native 2560×720/60 Hz mode.
- Published and installed binaries matched exactly: EXE SHA256 `19DC14C8BF6AB7921AEE515230F47C8687FD0A9C40AEEEAF68C36D4975CCC128`; DLL SHA256 `EFABC75DCDC62E142BCA37375A20010BE01F32672D84A284A01C1143CB4C4502`.
- Installed browser logs were empty. The 211-line installed-session snapshot contained zero warnings, zero errors, one successful dashboard load, and zero `/api/config/reset` requests.
- A read-only Windows capture of the exact installed Auxora window showed edge-to-edge Diagnostics on the XENEON EDGE with no Windows taskbar, error overlay, title bar, or misplaced desktop content.
- All 15 Theme captures and the complete check transcript were retained in the local ignored qualification archive. The verified current-run temporary screenshot directory was removed after preservation.
- A sustained installed-runtime audit resolved the original recurring-refresh concern. Diagnostics produced zero panel/shell changes, loading states, or fatal states over 40 one-second samples. On Home, the CPU value changed from 22% to 23% while the mounted root, shell, all four metric cards, every button, and scroll position remained intact. Balanced mode intentionally polls game/media state every 8 seconds and broader bridge/launcher state every 30 seconds; those requests do not reload the page.
- The rendered suite now performs two real Home API refreshes and fails if polling replaces the Home mount, shell, metric cards, controls, or focused Edit Home action. The focused rendered suite passed in 85.6 seconds. The subsequent complete `npm run check` passed in 165.5 seconds with 152/152 native tests, all 23 product surfaces at exact 2560×720, the new refresh-stability guard, 15 Theme captures, Camera Detection loss/reconnect, 100/100 cold boots, all eight standalone fallbacks, 160,914 native placement samples, and zero build warnings/errors. The detailed receipt and full transcript are retained in the local ignored qualification archive.
- The user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining release gates

- BETA-011: exact-candidate install, upgrade, repair, uninstall, rollback, and reboot/autostart receipt from a disposable Windows environment.
- BETA-022: exact-candidate physical Frigate server and camera qualification receipt.
- BETA-024: the remaining physical unplug/replug, primary-role switching, scaling, touch/long-press, keyboard, screen-reader, reduced-motion, and flicker matrix.
- Authenticode signing and source-control/release authority remain external owner actions; this unsigned beta installer has not been published.

## Revision 54 complete installed-surface resolution qualification (2026-07-22)

### Outcome

Asset revision `20260721-54` is installed and running on the physical XENEON EDGE at native 2560×720/60 Hz. The companion-resolution sweep now covers every visible registered product surface rather than only the shell and standalone fallbacks. Layout Editor actions meet the 44×44 touch minimum, and the verified supporting labels in System Monitor, Audio & Media, and Network meet the 12-pixel readability floor.

### Validation

- Complete sequential `npm run check` passed in 167.6 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven main viewport geometries, all 19 visible registered product surfaces at exact 2560×720, all eight shipped standalone fallback pages at exact 2560×720, 15 Theme captures, 100/100 cold boots, Camera Detection live/loss/reconnect coverage, and 160,547 native HWND placement samples on the two-display topology.
- The all-surface pass required every visible registered surface to reach a terminal status with no fatal/runtime state, document or panel overflow, clipped or unnamed control, control below 44×44, text below 12 pixels, or duplicate inner title. The four registered but intentionally hidden optional surfaces remained conditional by configuration policy.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260722-0104.exe` is 86,958,080 bytes with SHA256 `ED01DF32DA84B3544855FD801F0BB70F918676005654270D03CC6007CA15D93B`; it is intentionally unsigned under the documented free-beta path.
- The installer wrapper exceeded its 210-second wait after the transaction, but no installer process remained and authoritative post-install evidence proved completion: health and `/assets/revision.json` report `20260721-54`, version `0.3.0-beta.1`, display `ready`, two active displays, one companion display, and `XENEON EDGE (2560x720)` at `(619,2160)` in native 2560×720/60 Hz mode.
- Installed browser measurements reported viewport, body, and document geometry of exactly 2560×720 with no overflow or fatal state. Layout Editor exposed 57 visible inline actions with a 44×44 minimum. The targeted System Monitor, Audio & Media, and Network labels all measured at least 12 pixels. Browser warning/error logs were empty.
- A read-only Windows capture of the exact installed Auxora window showed edge-to-edge Diagnostics on the XENEON EDGE with no Windows taskbar, error overlay, title bar, or misplaced desktop content.
- Published payload and installed binaries matched exactly: EXE SHA256 `19DC14C8BF6AB7921AEE515230F47C8687FD0A9C40AEEEAF68C36D4975CCC128`; DLL SHA256 `9255962044E74A0D3E9B443AB9F61E9A4971E4B8C79815DF475134896EF4A477`.
- Eight expected rejected-token warnings occurred while a stale pre-install browser tab continued polling during the replacement transaction. After the fresh revision-54 installed audit began, the 187-line qualification tail contained zero warnings, zero errors, and zero `/api/config/reset` requests.
- All 15 Theme captures and the complete check transcript were retained in the local ignored qualification archive. The verified current-run temporary screenshot directory was removed after preservation.
- The user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining release gates

- BETA-011: exact-candidate install, upgrade, repair, uninstall, rollback, and reboot/autostart receipt from a disposable Windows environment.
- BETA-022: exact-candidate physical Frigate server and camera qualification receipt.
- BETA-024: the remaining physical unplug/replug, primary-role switching, scaling, touch/long-press, keyboard, screen-reader, reduced-motion, and flicker matrix.
- Authenticode signing and source-control/release authority remain external owner actions; this unsigned beta installer has not been published.

## Revision 53 standalone-fallback resolution and product-truth qualification (2026-07-22)

### Outcome

Asset revision `20260721-53` is installed and running on the physical XENEON EDGE at native 2560×720/60 Hz. Every shipped standalone fallback now uses the same truthful local data paths and product wording as the main dashboard: Calendar no longer invents meetings, Network and System Monitor use their native endpoints by default, Audio never exposes a raw Windows device ID, Diagnostics contains no developer embed controls, and Philips Hue actions meet the 44-pixel touch minimum. Remote font requests were removed from the fallback pages.

### Validation

- Complete sequential `npm run check` passed in 145.8 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, 100/100 cold boots, Camera Detection live/loss/reconnect coverage, all eight shipped standalone CSP checks, all eight standalone terminal-state and exact 2560×720 geometry checks, and 158,978 native HWND placement samples on the two-display topology.
- The standalone rendered pass proved Audio hides its raw device GUID, Calendar contains no fabricated sample events, Network does not use a browser estimate, System Monitor does not claim the available bridge is missing, Diagnostics contains no embed/URL controls, Hue Refresh is at least 44 pixels high, and Weather and Camera Detection reach truthful setup states without overflow or fatal UI.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260722-0038.exe` is 86,958,080 bytes with SHA256 `EC746EA2AF6642AE04D70B82537C3990EE5AF2B3F671FD8838DCEBEF4B7ED8B3`; it is intentionally unsigned under the documented free-beta path.
- The installer wrapper exceeded its 180-second wait after the transaction, but no installer process remained and authoritative post-install evidence proved completion: health and `/assets/revision.json` report `20260721-53`, and source/installed binaries match exactly.
- Installed health reports `XENEON EDGE (2560x720)` at `(619,2160)` in native 2560×720/60 Hz mode. A read-only Windows capture of the exact Auxora window measured 2560×720 and showed complete edge-to-edge Diagnostics with no taskbar, error overlay, or misplaced desktop content.
- Browser measurement of the installed dashboard reported viewport and document geometry of exactly 2560×720, zero horizontal overflow, zero undersized visible controls, and no fatal dashboard state.
- Published and installed binaries matched exactly: EXE SHA256 `19DC14C8BF6AB7921AEE515230F47C8687FD0A9C40AEEEAF68C36D4975CCC128`; DLL SHA256 `93331DCF140073B1099D68FAB05E0E40B1C5C85D4A81E2509C2917F0F8606CB1`.
- The installed-session snapshot at qualification contained 382 lines with zero warnings, zero errors, one successful dashboard load, and zero `/api/config/reset` requests.
- All 15 Theme captures and the complete check transcript were retained in the local ignored qualification archive. The verified temporary screenshot directory was removed after preservation.
- The user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining release gates

- BETA-011: exact-candidate install, upgrade, repair, uninstall, rollback, and reboot/autostart receipt from a disposable Windows environment.
- BETA-022: exact-candidate physical Frigate server and camera qualification receipt.
- BETA-024: the remaining physical unplug/replug, primary-role switching, scaling, touch/long-press, keyboard, screen-reader, reduced-motion, and flicker matrix.
- Authenticode signing and source-control/release authority remain external owner actions; this unsigned beta installer has not been published.

## Revision 52 standalone-fallback CSP qualification (2026-07-22)

### Outcome

Asset revision `20260721-52` is installed and running on the physical XENEON EDGE at native 2560×720/60 Hz. Native-served standalone fallback pages now receive the same per-response nonce as the session bootstrap, so their inline runtimes execute under the strict Content Security Policy instead of remaining on their initial Loading placeholders. Standalone Diagnostics now uses the stable `Diagnostics` name, omits the obsolete disabled `Auto ready` control, and creates manual completion only when it is actionable.

### Validation

- Complete sequential `npm run check` passed in 145.1 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, 100/100 cold boots, Camera Detection live/loss/reconnect coverage, all eight shipped standalone CSP checks, direct rendered Diagnostics execution/terminal-state proof, and 162,399 native HWND placement samples on the two-display topology.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260722-0019.exe` is 86,962,176 bytes with SHA256 `42FB58915E71AD86105F38060C3369A86B5622598131CF31B2986953EEA428D8`; it is intentionally unsigned under the documented free-beta path.
- The exact installer completed with exit code 0. Installed health and `/assets/revision.json` report `20260721-52`; health reports `XENEON EDGE (2560x720)` at `(619,2160)` in native 2560×720/60 Hz mode, with Camera Detection still optional and unconfigured.
- The installed Diagnostics fallback returns HTTP 200, publishes one CSP nonce, applies it to both inline scripts with zero mismatches, contains `<h1>Diagnostics</h1>`, and contains no `Auto ready` copy. The launched rendered test proved the same candidate executes `WidgetCore`, receives its protected session bootstrap, renders essential rows, reaches a terminal status, and has no horizontal overflow or fatal state.
- Published and installed binaries matched exactly: EXE SHA256 `19DC14C8BF6AB7921AEE515230F47C8687FD0A9C40AEEEAF68C36D4975CCC128`; DLL SHA256 `BF6AE88DF5A3131DC5CC33E4F93C22B2DC7C0F51CB3F993BA83D0B240761172B`.
- The installed-session snapshot at qualification contained 73 lines with zero warnings, zero errors, and zero `/api/config/reset` requests. No test-owned browser process or temporary test profile remained.
- All 15 Theme captures and the complete check transcript were retained in the local ignored qualification archive.
- The user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining release gates

- BETA-011: exact-candidate install, upgrade, repair, uninstall, rollback, and reboot/autostart receipt from a disposable Windows environment.
- BETA-022: exact-candidate physical Frigate server and camera qualification receipt.
- BETA-024: the remaining physical unplug/replug, primary-role switching, scaling, touch/long-press, keyboard, screen-reader, reduced-motion, and flicker matrix.
- Authenticode signing and source-control/release authority remain external owner actions; this unsigned beta installer has not been published.

## Revision 51 Diagnostics integration-card qualification (2026-07-21)

### Outcome

Asset revision `20260721-51` is installed and running on the physical XENEON EDGE at native 2560×720/60 Hz. Optional Diagnostics integrations now keep their natural height instead of stretching every card in a grid row to the Camera Detection form height, removing the large opaque empty panel beside Camera setup. The rendered validators now also follow Microsoft Edge's real debugging endpoint across its launcher-process handoff and close the owned browser cleanly.

### Validation

- Complete sequential `npm run check` passed in 652.1 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, 100/100 cold boots, Camera Detection live/loss/reconnect coverage, and 28,965 native HWND placement samples on the two-display topology.
- The first rendered attempt was rejected because it correctly tested the unrecompiled revision-50 binary and still measured the stretched card. The first integrated attempt was also rejected when the separate Theme validator left Edge's relaunched process profile locked. Revision 51 was accepted only after rebuilding the embedded assets, following the live debugging endpoint for the full startup window, closing the real browser through CDP, and passing the complete gate with no cleanup warning.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260721-2345.exe` is 86,958,080 bytes with SHA256 `29CB6C2E90BF041C47D6E2E53CFD8E0A867C4E31677A8B69F2E95BE4FA3E9DB6`; it is intentionally unsigned under the documented free-beta path.
- The installer wrapper exceeded its 180-second wait after the transaction, but no installer process remained and authoritative post-install evidence proved completion: health and `/assets/revision.json` both report `20260721-51`, and source/installed binaries match exactly.
- Installed Camera setup focuses the local Frigate address, uses `align-items: start`, measures the Camera card at 544 px and the UniFi card at its natural 110 px, and has no horizontal overflow, fatal state, or browser console warning/error. Camera Detection remains `Optional` and unconfigured.
- Installed health reports `XENEON EDGE (2560x720)` at `(619,2160)` in native 2560×720/60 Hz mode. Desktop z-order places Auxora ahead of the secondary taskbar.
- Published and installed binaries matched exactly: EXE SHA256 `19DC14C8BF6AB7921AEE515230F47C8687FD0A9C40AEEEAF68C36D4975CCC128`; DLL SHA256 `E27DCEAAF5B1A93D546C9EF7156A35450BC1445634357F1C8850B15E6E2ECE51`.
- The installed-session snapshot at final audit contains 590 lines with zero warnings, zero errors, and zero `/api/config/reset` requests. No test-owned browser process remained, and all 14 interrupted test-only profiles were removed after their owning processes exited.
- The user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining release gates

- BETA-011: exact-candidate install, upgrade, repair, uninstall, rollback, and reboot/autostart receipt from a disposable Windows environment.
- BETA-022: exact-candidate physical Frigate server and camera qualification receipt.
- BETA-024: the remaining physical unplug/replug, primary-role switching, scaling, touch/long-press, keyboard, screen-reader, reduced-motion, and flicker matrix.
- Authenticode signing and source-control/release authority remain external owner actions; this unsigned beta installer has not been published.

## Revision 50 terminal feature-status qualification (2026-07-21)

### Outcome

Asset revision `20260721-50` is installed and running on the physical XENEON EDGE at native 2560×720/60 Hz. Recovery and Display Controls no longer remain indefinitely on `Checking` until selected. Recovery resolves through one lightweight post-hydration readiness request; Display Controls exposes the truthful surface state `Available` and performs potentially slow DDC/CI discovery only when opened.

### Validation

- Complete sequential `npm run check` passed in 163.6 seconds: every repository gate, 152/152 native tests, zero build warnings/errors, 40 adaptive combinations, seven rendered geometries, 15 Theme captures, 100/100 cold boots, Camera Detection live/loss/reconnect coverage, and 100,990 native HWND placement samples on the two-display topology.
- The first Display Controls implementation was rejected during the pass because boot-time DDC/CI discovery pushed the rendered suite beyond its four-minute bound. The final implementation removed that hardware probe and restored the complete rendered suite to 81.5 seconds while preserving on-demand native discovery inside the panel.
- `npm run audit:deps` passed: root npm, Electron npm, and both NuGet projects reported zero known vulnerabilities.
- Installer `app/dist/Auxora-Setup-0.3.0-beta.1-20260721-1957.exe` has SHA256 `F42B21C58C4CA2236052BA1BEAFFBD024437136776C13812E69A6AD63CC74DB3`; it is intentionally unsigned under the documented free-beta path.
- Exact in-place installation succeeded. Installed health reports revision `20260721-50`, display `ready`, Camera Detection `Optional` and unconfigured, and `XENEON EDGE (2560x720)` at 60 Hz.
- Without opening either target panel, installed Display Controls read `Available` while System Monitor remained selected, and installed Recovery read `Ready` while Diagnostics remained selected.
- Installed Camera Detection rejected `http://example.com:5000/` as non-local, preserved the typed address and `driveway` filter for correction, remained unconfigured, and showed only the inline validation message with no dashboard failure. The single expected validation warning was the only warning/error-class entry in the qualification session; zero reset requests occurred.
- The installed window is visible at exact companion bounds `(619,2160)-(3179,2880)`, ahead of the visible primary taskbar in desktop z-order, outside the primary display, with no secondary taskbar window present.
- Published and installed binaries matched exactly: EXE SHA256 `19DC14C8BF6AB7921AEE515230F47C8687FD0A9C40AEEEAF68C36D4975CCC128`; DLL SHA256 `608E9CC178E2F728D9EA868BA0F38D7431C2E3EEAE4BAA29A6B9F541913B3238`.
- The 122-entry user-owned dirty tree was preserved. Nothing was staged, committed, tagged, pushed, published, signed, or externally released.

### Remaining release gates

- BETA-011: exact-candidate install, upgrade, repair, uninstall, rollback, and reboot/autostart receipt from a disposable Windows environment.
- BETA-022: exact-candidate physical Frigate server and camera qualification receipt.
- BETA-024: the remaining physical unplug/replug, primary-role switching, scaling, touch/long-press, keyboard, screen-reader, reduced-motion, and flicker matrix.
- Authenticode signing and source-control/release authority remain external owner actions; this unsigned beta installer has not been published.
