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

This session did not replace the installed app, publish an installer, commit, push, or deploy. Its filesystem permissions do not include the normal per-user installation directory. Public release still requires the repository's exact-candidate qualification workflow.
