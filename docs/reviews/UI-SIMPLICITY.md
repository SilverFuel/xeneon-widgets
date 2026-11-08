# Simpler controls and predictable navigation

The latest control cleanup and asset revision `20261108-04` are described in [UI-CONTROL-CLEANUP.md](UI-CONTROL-CLEANUP.md).

This iteration applies the request to keep everyday use simple while retaining advanced features. Source changes remain in the isolated navigation checkout; the installed application has not been updated.

## What changed

- One labeled Mode selector replaces five always-visible buttons. It includes native and custom Modes and an Automatic option. Night display has one home in Quick controls.
- Mode changes preserve the current panel and keyboard focus, reject duplicate changes while applying, and restore the confirmed value after failure. Game auto-open waits for a pending Mode action to finish.
- Home's readings are real buttons, with visible destination labels. They reuse the existing section router and saved/deep-link selection behavior.
- One-tap setups are collapsed by default. Expanded controls describe their Windows settings changes, show progress and completion/error feedback, and reject repeated input while the request is pending.
- A completed one-tap setup applies its returned Mode receipt without sending a second native activation request.
- Setup status buttons open the relevant integration form. Global startup problems still open general setup and status. Touch Lock blocks these shortcuts.
- Missing sensor values are shown as unavailable rather than 0%. A disconnected calendar is distinguished from an empty schedule.
- Settings names distinguish Setup & status, Repair & recovery, and Modes & automation.

## Button destinations

| Control | Result |
| --- | --- |
| Home: View performance | PC / Performance |
| Home: View memory | PC / Performance, which includes memory readings |
| Home: Open Network | PC / Network |
| Home: Open Calendar | Home / Calendar |
| Set up Weather, Calendar, Lights, or Cameras | Settings / Setup & status, opening that integration's form |
| Healthy or global-problem status | Settings / Setup & status |
| Mode selector | Applies a Mode or resumes automation; keeps the current panel |
| Night Automatic / On / Off | Quick controls; changes the display preference |
| Customize Home | Settings / Layout |

All 25 panels remain reachable through the five sections and Settings. Constellation colors, saved layouts, Home's long-press gesture, and companion-window policies remain covered by the existing checks. The web asset revision is `20261108-03`.

## Validation

The added interaction tests exercise actual production functions with controlled transport and DOM fixtures. They cover custom Modes, automatic switching, pending and failed actions, correct Home/setup routes, duplicate prevention, and applying an action-chain receipt once. Existing rendered tests were adapted to the native selector and to Night's Quick controls location, without removing the panel, viewport, accessibility, or layout-persistence matrices.

The local preview browser rejected the `file:` URL because its security policy allows only HTTP and HTTPS navigation. No alternate browser route or policy workaround was attempted. Visual review and physical touch qualification remain pending. The earlier native/browser integration failures are documented in [VALIDATION-RESULTS.md](VALIDATION-RESULTS.md); their earlier passing stages are not presented as a new full-suite result.

All 22 selected validation stages passed under Node 22.23.2 and .NET SDK 8.0.424. The Release build completed with zero errors and four NU1900 warnings because the NuGet vulnerability feed was unavailable. This is focused validation, not a passing full native/browser suite. No installation, deployment, push, or cursor-restoration change is part of this iteration.


| Current check stage | Result |
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
| `check:dashboard-smoke` | Passed |
| `check:adaptive-layouts` | Passed |
| `test:release-version` | Passed |
| `check:app` | Passed |
| `check:audit-regressions` | Passed |

Compiled source commit: `a606d2162295343da19a4112f9449813a59b111f`. Host ProductVersion: `0.3.0-beta.1+20261108.a606d2162295343da19a4112f9449813a59b111f`. Host executable SHA-256: `313E7CFC09F0B125046421AC9C0350BBC6368D68D756CE73DCA81E7AC759E72E`. Logs are retained locally under `artifacts/ui-simplicity/validation`.

The original 74 Home gesture and 14 Display Controls assertions still pass. The Mode interaction suite now has 11 passing cases, Home/setup navigation has five, navigation migration has 15, and game auto-open has 18 (including pending Mode actions). These tests validate controlled interactions and source contracts; they do not establish rendered geometry or physical touch behavior.
