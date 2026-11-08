# Auxora touch and navigation implementation

The latest control cleanup and asset revision `20261108-04` are described in [UI-CONTROL-CLEANUP.md](UI-CONTROL-CLEANUP.md).

For the subsequent simplification pass and asset revision `20261108-03`, see [UI-SIMPLICITY.md](UI-SIMPLICITY.md). The 49-stage results below describe the earlier revision.

Local implementation of the approved `CODEX_PROMPT_auxora-touch-and-ui.md`. The installed app and the original Xenon working tree were not modified. Nothing was pushed, merged, installed, or deployed.

## Source and scope

- Working checkout: `C:\Users\silve\AppData\Local\Temp\Auxora-Work-20261108`, branch `feature/edge-navigation`.
- Baseline: `697b27bb2781bfd6c39f7d706134fc469b62a079`, which matches the currently installed source identity. The original checkout was older and already dirty.
- The normal network clone could not complete. This separate shallow checkout was reconstructed from the exact signed upstream commit and verified Git blobs. All 312 baseline blobs, the tree, and the commit matched; `git fsck --full --strict` passed. It contains a shallow history boundary at the baseline, not the complete remote history.
- The original `C:\Users\silve\Downloads\Xenon` source was read only. Its existing SDK was used to compile projects in the new checkout. No before/after comparison of its preexisting dirty files is claimed.

## Implemented changes

The root touch-press fix excludes `html` and `body` from pressable-control resolution. This prevents the theme attribute on a document root from triggering whole-dashboard press scaling. The supplied regression exercises the real resolver and timing code. This is a fix for dashboard scaling during a touch, not proof that the Windows cursor-jump problem is solved.

Navigation now has Home, Gaming, Media, PC, and Smart Home sections, plus a permanently accessible Settings action. All 25 existing panels remain mapped. Section tabs preserve saved panel order, Settings has a vertical category list, and panels use the available content width. Legacy card-size values are preserved for compatibility, but the obsolete Width control was removed because it no longer describes section-panel sizing.

The header contains section navigation, Mode controls, one status chip, and Quick controls. Quick contains sound, playback, and Night display controls. Favorites storage remains untouched but is no longer read. The old Favorites/All panels/Panel options navigation and duplicate shell titles/status were removed. Layout includes section ordering and visibility; deep links and automatic game routes still reach hidden sections.

Settings retains Appearance, Layout, Modes, Updates, Privacy & Backup, Phone Remote, Widget Packs, Diagnostics & Recovery, and Installation & Recovery. Appearance retains opacity, Reset opacity, readability, performance, game tuning, and game auto-open. Weather preferences stay with Weather. A separate Appearance bug was fixed so a themed ancestor is not mistaken for a selected preset.

Constellation Gold (`#d4ac63`) and navy (`#132238`) identify the selected section; forced-color mode uses system highlight colors. Existing Constellation theme and contrast checks remain. Home's 700 ms / 6 px gesture and Display safety harness were retained unchanged. Touch Lock and Quick dialog inertness/focus handling remain in place. Game/WoW automatic navigation now waits while a Settings category is open and resumes through the existing idle guard after leaving Settings.

## Cursor investigation remains separate

The observation-only branch `diag/touch-cursor-trace` is in `C:\Users\silve\AppData\Local\Temp\Auxora-Touch-Diagnostics-20261108`, commit `4cea597`. It is not merged into the navigation branch.

Tracing requires the exact process environment opt-in `AUXORA_TOUCH_CURSOR_TRACE=1` and a valid isolated test identity. It keeps a bounded 256-record ring and reduced cursor/history monitor roles, without persisting coordinates or pointer IDs. It flushes once on actual quit and discards the trace on Privacy reset. The diagnostic WebView also uses isolated browser storage. It introduces no cursor positioning, input injection, hooks, or window-activation changes.

The native diagnostic host and test assembly compile. The focused NUnit run aborted because VSTest could not connect to its test host within 20 seconds; no tests were reported executed. C1 (normal Edge), C2 (WinUI Gallery WebView2), and C3 (Gallery native Button) observations are still pending, as is physical Auxora testing. The installed WebView2 runtime differs from the older evidence, so those observations cannot be treated as current reproduction results.

See the diagnostic branch's `docs/diagnostics/TOUCH-CURSOR-TRACE.md` for the exact isolation environment, interpretation limits, source references, log location, and collection procedure. No automatic cursor-restoration mitigation has been selected or implemented.

## Validation and assertion migration

Node 22.23.2 and .NET SDK 8.0.424 were used. **43 of 49 required check stages passed. Six native/browser stages failed or aborted, so the suite is not green.** See [VALIDATION-RESULTS.md](VALIDATION-RESULTS.md) for every stage, the actual failures, retries, and build identity. Compilation and source tests do not establish physical touch correctness or rendered layout quality.

| Removed UI assumption | Replacement coverage |
| --- | --- |
| Four destinations and Favorites/All panels | Exact section-to-panel catalog, legacy storage integration, five configurable sections plus Settings, all-panel routing, order/visibility/reset/reload |
| Catalog modal focus | Quick modal focus return, Escape, inert background, and stable section/tab focus |
| Panel options sidebar | Mounted Appearance and Privacy handlers, one event/one action after refresh, focused-edit deferral, reset/error recovery, and local Weather form rebinding |
| Outer panel title/status and Now strip | Active-panel identity, one section heading/status chip, Audio/Quick actions, compact content visibility |
| Fixed card Width control | Saved cardSizes survive while section panels use full width |
| Settings drawer game deferral | Every Settings category defers game auto-open; leaving uses the existing interaction-idle timer |
| Night omitted from old activation UI | Requested Night header control retains display-variant semantics and does not replace the base Mode |

The 74 Home and 14 Display assertions were retained byte-for-byte. Their combined harness SHA-256 is `16348DB16992E18A5DFC655552A385DDCD1335EE87683ABF7C357523DF15FE16`. The rendered suite still specifies 25 panels across 10 viewport sizes, 100 boot checks, touch-target size, focus, privacy/reset, status/retry, contrast, and forced-color checks. Test inventory is not a claim that a blocked rendered run executed those checks. The all-panel reachability test allows scrolling to expose controls, then at most two selection clicks; it is not physical touch evidence.

## Build, install, and rollback

Do not use the old dirty checkout as the build source. From the isolated navigation checkout, with Node 22 and the pinned .NET SDK on PATH:

```powershell
npm ci
npm run check
powershell -NoProfile -File .\app\build-installer.ps1
```

The installer build was blocked by Windows PowerShell with `AuthorizationManager check failed`. No execution-policy workaround was attempted, and no candidate or rollback installer was produced by this task. Resolve that execution restriction through the normal trusted environment before attempting packaging. A native compile output is not an installer or a qualified release.

The current installed source is `697b27bb2781bfd6c39f7d706134fc469b62a079`, so the matching rollback checkout is `C:\Users\silve\AppData\Local\Temp\Auxora-Rollback-697b27bb-20261108`. The older `83f15519` checkout is not the current installed rollback baseline. Build the rollback installer from the clean matching checkout, record its version and SHA-256, and retain it before installing a candidate.

Before a later authorized installation, export Privacy & Backup, pass the required automated checks, build and hash both candidate and rollback installers, and complete the exact-candidate physical checks in `docs/release/DISPLAY-CERTIFICATION.md`. Use the generated candidate installer's exact path, then verify its installed version and dashboard asset revision. For rollback, quit Auxora normally and run the retained matching rollback installer. Verify its version before restoring preferences if needed. None of those installation steps was performed here.


## Local commits

The web asset revision for this earlier pass was `20261108-02`. The diagnostic branch remains separate. Production and test commits, in chronological order:

- `b2bf6fe` Stop treating html/body as touch-pressable controls
- `3855b72` Refresh web asset revision for the touch press fix
- `6321745` Synchronize touch release version with its asset date
- `9562e08` Add pure section navigation model and catalog regressions
- `72ac588` Replace overlapping panel navigation with section rail and tabs
- `c4f5274` Move Mode activation into the section header
- `0a656ec` Keep Quick controls focused on sound playback and Night display
- `9b38c02` Move preferences into Settings and add section layout controls
- `18433c8` Consolidate panel heading status and full-width content
- `401daad` Verify Settings interactions and accessible Constellation section colors
- `b83ab18` Preserve legacy panel memory and native Night variant behavior
- `861da97` Toggle Night from the effective display preference
- `5c9bbab` Adapt regression coverage and qualification notes to section navigation
- `52ae8de` Refresh web asset revision for section navigation
- `db4684b` Preserve routing and release regression checks after shell migration
