# Auxora source review and repair

November 7, 2026, Indianapolis time. Asset revision `20261107-01`.

The repaired source builds successfully. This is not a completed installation or release qualification: end-to-end native and browser checks remain blocked in this execution environment. Existing uncommitted work was preserved.

## Repairs

| Area | Defect | Result |
| --- | --- | --- |
| WoW Forever launch | Restarting the same client between polls reused the previous session and did not reopen the journal. | Runtime identity changes start a new session. Missing identity fields do not create false restarts. |
| Game appearance and Modes | Failed or stale activity reads cleared game settings, dropped the game theme, or triggered automatic Mode changes. | Only accepted activity drives launch and Mode changes; a confirmed session end clears game presentation. |
| Journal backups | Slow older file reads could replace a newer import, edits could race an import, and invalid selections left an older confirmation actionable. | Latest selection wins, editing cancels pending imports, and invalid selections clear confirmation. |
| Journal recovery | Failed replacement saves could remove access to the original unreadable journal. | Original recovery export remains available until a replacement is saved successfully. |
| TMOG sampling | A response started before Pause could publish after Resume; a null TMOG response could interrupt telemetry. | Obsolete responses are discarded and replaced with a fresh batch. Missing TMOG data leaves the panel usable. |
| Network graphs | Ping refreshed the timestamp for frozen throughput; failed/reset counters could produce false readings. | Separate throughput timestamp, non-overlapping sampling, and fresh baselines after counter failures or interface changes. |
| Native server lifetime | An unexpected accept-loop failure could be silent or a stopped task could be reported ready. | Failures notify the host, retry drains the old lifetime, and immediate startup failure cannot announce ready. |
| Test process cleanup | Missing executables could crash the runner, final guard output could be missed, and failed-launch cleanup could hang. | Spawn errors are handled, output is drained, and cleanup is bounded. |

The normal `npm run check` pipeline now includes installer shutdown and visible-window guard regressions. Dashboard asset revision references were synchronized so rebuilt hosts receive the repaired assets.

## Verification

| Check | Result |
| --- | --- |
| Release native solution build | Passed, zero warnings and errors. |
| WoW journal behavior | 16 tests passed. |
| WoW launch, appearance, and Mode behavior | 17 tests passed. |
| TMOG frontend behavior | 11 tests passed. |
| Window guard lifecycle | 5 tests passed. Actual hidden-process self-test and missing-executable launch also passed. |
| Selected native fixture invocation | 46 cases passed, zero failures. Includes game identity/session handling, network sampling, and TMOG discovery. |
| Installer shutdown | Three isolated scenarios passed under both Windows PowerShell and PowerShell 7. |
| Syntax, themes, layout, accessibility contracts, audit guards, and release fixture checks | Passed before the native rendered test. These do not substitute for live visual verification. |
| Full `npm run check` | Blocked at rendered native startup. Not a passing full suite. |
| Full VSTest execution | Aborted. Testhost diagnostics record socket error 10013 on loopback and a 20-second connection timeout. |
| Standalone rendered pages | Blocked by headless Edge AppContainer initialization failure and process exit. |
| Legacy bridge API and Electron dependency compatibility probe | Blocked by loopback connectivity failures; Electron reported `EACCES`. |

The 46 native cases were invoked directly from the built NUnit fixture assembly without VSTest transport. This is supplemental evidence for selected behavior, not discovery or execution of the entire native suite. The new HTTP listener lifecycle tests still require a working native listener.

Local evidence:

- `artifacts/review-20261107/check.log`
- `artifacts/review-20261107/dotnet-test.log`
- `artifacts/review-20261107/vstest.log` and adjacent testhost log
- `artifacts/native-review-20261108/results.txt` and `run.ps1` (directory uses the execution host's UTC date)

The native rendered host failed to bind with Windows error 6, `The handle is invalid`. The loopback and AppContainer errors demonstrate environment restrictions affecting validation. They do not establish the cause of every previously reported installed-app problem. No firewall, Windows security, display settings, or game settings were changed.

## Remaining verification

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-local.ps1` in a normal Windows development session with working loopback and browser startup. Then validate journal persistence, game restart and dismissal behavior, TMOG sampling, companion-display placement, touch, and upgrade behavior against the resulting installed build.

The initial local review did not replace the installed app or publish an installer. Its filesystem permissions do not include the normal per-user installation directory. Public release still requires the repository's exact-candidate qualification workflow.

## Release preparation follow-up

The source repairs were pushed to release PR #9 as commit `62694848c0d1e60bc9ff9e41d1ad436909a431c7`. Hosted Windows CI passed dependency compatibility, dependency auditing, the native Release build, and the initial rendered layout matrix. It then found undersized TMOG controls on the short companion display. The follow-up patch raises the controls to the 44px minimum, raises small labels to 12px, and removes the duplicate panel title. That patch requires its own complete hosted CI result before merge.

The follow-up review also corrected these outstanding findings:

- A 32-bit setup launcher now hands off to native 64-bit PowerShell before probing the x64 WebView2 loader or changing installation files. Eight real architecture handoff cases passed across Windows PowerShell and PowerShell 7.
- Successful Weather and Frigate configuration saves clear the submitted secret field while retaining a replacement typed during the request. Nine behavioral regressions passed.
- Standalone Camera Detection can refresh after setup without restarting the page. Five behavioral regressions passed, including paused polling and duplicate requests.
- Chromium and Firefox slider pseudo-element selectors are separate, preserving browser-specific theme and reduced-motion rules.
- Older PowerShell Core preserves JSON timestamp text and token types without requiring the unavailable .NET Framework serializer. Default and fallback parser checks passed.
- Solo-owner publication approval requires the owner to be the sole reviewer. Environment fixtures cover extra users and teams.
- Calendar and system-monitor cache references match the asset revision and are included in version checks. Setup failures retain the server's reason; privacy and dependency documentation match the implementation.

Hosted CI at `048d08a9a85b4d482a0ba94a16efb239587e64ec` confirmed all 25 product surfaces at all ten viewport sizes, including touch targets, text sizes, naming, focus, and overflow. It then detected TMOG graph paths opting out of Windows forced colors. The follow-up removes that opt-out, retains system-color tokens and dashed-series differentiation, and adds a fast CSS contract check. Native and API checks now run before the longer rendered matrix; no checks were removed.

Hosted CI at `8b9c38656ec7ffb523df6502a87d249058c875d7` passed all 320 native tests with zero failures or skips, the live native-host API suite, and the bridge API suite. The theme matrix then caught buttons animating from zero-width borders when Windows forced colors activated. The follow-up disables interactive-control transitions in forced colors so system boundaries apply immediately; test assertions remain unchanged.

The final review also moved the NuGet assets audit after the restoring native build, so `npm run check` works on a fresh checkout without relying on CI's separate dependency audit. TMOG accent-colored text uses the existing contrast-safe text token for custom and game accents.

The normal check pipeline includes the new regression tests. A complete passing run is required on the final patch. Hosted CI, installed application validation, and public installer qualification remain distinct checks.
