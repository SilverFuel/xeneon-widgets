# One place for each common control

This pass removes redundant controls and makes navigation labels more explicit. Changes are local source changes, with web asset revision `20261108-04`; they have not been installed.

| Action | Where it belongs |
| --- | --- |
| CPU and memory details | One Performance card on Home, or PC / Performance |
| Network details | Home's Network card, or PC / Network |
| Calendar | Home / Calendar |
| Recent apps | Home only, with Show all / Show fewer |
| Volume, mute, playback, Night display | Quick controls; full audio tools remain under Media |
| Choose a Mode or resume automatic switching | Header Mode selector |
| Edit, duplicate, or delete a Mode | Settings / Modes & automation |
| Arrange Home and sections | Settings / Layout; Home long-press remains available |
| Windows theme, Night Light settings, Lock PC, Windows Settings, Recycle Bin | PC / Windows tools |
| Notifications, Windows brightness, sleep, restart, shutdown | PC / Windows controls |
| Integration setup and connection status | Settings / Setup & status, or the integration's setup action |
| Repair tools | Settings / Repair & recovery |

Removed controls include the old media strip's Open/Keep/Dismiss buttons, the duplicate Night selector in Appearance, the duplicate automatic-switching button in Modes, Streaming's extra Audio and legacy layout shortcuts, the extra Memory-to-Performance card, and Home's extra Layout button. The header status chip is now a passive live status indicator. Recent-app launch buttons no longer appear across unrelated panels.

Windows actions now say Windows theme, Night Light settings, Lock PC, Windows Settings, and Empty Recycle Bin. Their native action IDs, availability checks, and destructive-action confirmation requirements remain intact. Small navigation and helper text touched by this pass uses at least 14px text.

Mode editing now applies the returned snapshot without issuing another activation request. Repeated Duplicate input is blocked while a request is pending. An unchanged active Mode preserves personal presentation settings; a changed active Mode or server fallback still updates its presentation.

Validation adds actual-renderer action-label checks, all-25-panel Recent apps placement checks, Mode duplicate/save/delete interaction tests, and single-owner checks. Retired status-button tests now exercise the shared integration setup router, including Touch Lock. The Appearance focus regression uses Readability instead of the removed Night selector. Home's original 74 long-press and Display Controls' 14 lifecycle assertions remain intact.

Visual preview and physical touch qualification remain pending because of the previously recorded browser restriction. No browser-policy workaround was attempted. The earlier full native/browser suite failures remain documented in [VALIDATION-RESULTS.md](VALIDATION-RESULTS.md).

All 23 selected stages passed under Node 22.23.2 and .NET SDK 8.0.424. The Release build passed with zero errors and four NU1900 warnings because the NuGet vulnerability feed was unavailable. This is focused validation, not a passing full native/browser suite.


| Focused check | Result |
| --- | --- |
| `check:js` | Passed |
| `test:wow-forever` | Passed |
| `test:tmog` | Passed |
| `check:theme-contract` | Passed |
| `test:constellation-theme` | Passed |
| `check:standalone-theme` | Passed |
| `check:setup-guide` | Passed |
| `check:bridge-boundaries` | Passed |
| `check:frontend-performance` | Passed |
| `check:settings-handlers` | Passed |
| `check:quick-controls` | Passed |
| `check:camera-detection` | Passed |
| `check:ui-remediation` | Passed |
| `check:touch-root-press` | Passed |
| `test:dashboard-navigation` | Passed |
| `test:header-modes` | Passed |
| `test:home-navigation` | Passed |
| `test:ui-action-ownership` | Passed |
| `check:dashboard-smoke` | Passed |
| `check:adaptive-layouts` | Passed |
| `test:release-version` | Passed |
| `check:app` | Passed |
| `check:audit-regressions` | Passed |

Compiled source: `38bfdc20d92dde550ead5c06a01ee15428ce7cc8`. Host ProductVersion: `0.3.0-beta.1+20261108.38bfdc20d92dde550ead5c06a01ee15428ce7cc8`. Executable SHA-256: `20EDC1BBF5C81D4ABF6AA6A4A74523681E308E4FED088FC7B01E5EA0E844CF80`. The final follow-up changes only strengthen the deletion-fallback fixture and record these results. No installer was created. Logs remain in `artifacts/ui-deduplication/validation`.
