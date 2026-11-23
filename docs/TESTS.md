# Auxora tests

Two commands:

| Command | When | What it runs |
|---|---|---|
| `npm run check` | Every change. CI runs it on every push and pull request. | Syntax, behaviour tests, .NET build and tests, the launched native host, and the rendered dashboard. |
| `npm run check:release` | Before a release. The release workflows and release scripts run it. | Everything in `check`, then the installer, release, dependency and source-text guards. |

`npm run check` needs Windows, the .NET SDK, and Edge or Chrome. The plain Node steps run on any OS.

## Rules for new tests

1. A test runs code or renders the page and checks what happens. It never reads a source file as text to assert on how something is written.
2. Do not add to `scripts/check-source-guards.mjs`. It is a holding pen for old source-text checks. When you change code that one of its guards pins, replace the guard with a behaviour test.
3. A new everyday test goes in `check`. A test about installers, signing, release evidence or dependency pins goes in `check:release`.

## Kinds of test

- **Behaviour**: loads a real module, or mounts a real renderer with fake DOM, clock and network, and checks results.
- **Behaviour, extracted by name**: also runs real code, but first cuts named functions out of `js/dashboard.js` or a widget file (those files expose no module interface). If you rename or move a function it extracts, the test fails with a message naming that function. Update the name in the test; do not delete the test.
- **Rendered**: starts the real host and drives a real browser. Windows only.
- **Source text**: reads files and matches strings or regular expressions. Release set only.

## Everyday set: `npm run check`

| Step | Script | Kind | What it protects |
|---|---|---|---|
| `check:js` | `check-js.mjs` | Syntax | Every file in `js/`, `bridge/` and the Electron host parses. |
| `test:wow-forever` | `test-wow-forever.mjs` | Behaviour (one test extracted by name) | WoW journal: validation, backup import, session timer, undo, and how a long quest log from the game is split into views. |
| | `test-wow-autolaunch.mjs` | Behaviour, extracted by name | A game opens its Profile's home panel once per session: the Forever client gets the WoW journal, any other game the Game HUD, and never by name, path or launcher. The panel before the game returns when it exits. Profiles are evaluated at once when the game changes. |
| | `test-play-log.mjs` | Behaviour | The play log: time is counted only while a game is seen, sessions and day streaks, the welcome line, bounds on what is kept, and that only a key and a name are stored. |
| `test:tmog` | `test-tmog-companion.mjs` | Behaviour | TMOG telemetry: stale, missing and paused readings are never shown as live. |
| `test:constellation-theme` | `test-constellation-theme.mjs` | Behaviour, extracted by name | Every theme in `js/themes.js`, in both runtimes: the theme applies its own colours; text, accent text, filled controls and status reach 4.5:1 in standard, Night and high contrast, with preset and custom accents; Focus, Gaming and Warm keep the exact colours they shipped with; adding a theme takes one table entry. |
| `test:setup-secrets` | `test-setup-secrets.mjs` | Behaviour | Saved integration passwords are cleared from the form after save, including on failure. |
| `check:frontend-performance` | `check-frontend-performance.mjs` | Behaviour, extracted by name | Requests time out and cancel cleanly; polling recovers; the ambient canvas respects its frame budget and pauses when hidden. |
| `check:settings-handlers` | `check-settings-panels.mjs` | Behaviour, extracted by name | Appearance and Privacy panels: one swatch per theme, one tap applies and saves; one event causes one action, focus is kept, cleanup runs. |
| `check:quick-controls` | `check-quick-controls.mjs` | Behaviour | Quick controls: serialized writes, no retries of failed commands, stale snapshots cannot enable actions. |
| `check:album-carousel` | `check-album-carousel.mjs` | Behaviour | Music cards: private media labels, delete, and no re-creation after delete. |
| `check:camera-detection` | `check-camera-detection.mjs` | Behaviour, extracted by name | Camera Detection deep links land on the right section; setup feedback is escaped and announced as status or alert. |
| `test:frigate-standalone-refresh` | `test-frigate-standalone-refresh.mjs` | Behaviour | Standalone camera panel refresh and polling pause. |
| `check:ui-remediation` | `check-ui-remediation.mjs` | Behaviour, extracted by name | Every panel belongs to exactly one section and is reachable; Home long-press gestures; Display Controls pending states (`check-display-controls.mjs`). |
| `check:touch-root-press` | `check-touch-root-press.mjs` | Behaviour | Touch press feedback in `js/widget-core.js`. |
| `test:dashboard-navigation` | `test-dashboard-navigation.mjs` | Behaviour, extracted by name | Section and panel navigation, saved destinations, links to removed tabs, return from Game Mode. |
| `test:header-modes` | `test-header-modes.mjs` | Behaviour, extracted by name | Night toggle and Profile activation from the header. |
| `test:home-navigation` | `test-home-navigation.mjs` | Behaviour, extracted by name | Home cards open their panels; one-tap setups run once and report failure. |
| `test:ui-action-ownership` | `test-ui-action-ownership.mjs` | Behaviour, extracted by name | Profile duplicate, save and delete send one request and apply the server's answer. |
| `check:adaptive-layouts` | `check-adaptive-layout-matrix.mjs` | Behaviour | Layout class for 40 display size and scaling combinations. |
| `test:visible-window-guard` | `test-visible-window-guard.mjs` | Behaviour | The test helper that stops rendered tests from flashing windows. |
| `check:app` | `dotnet build` | Build | The native host compiles. |
| `test:app` | `dotnet test` | Behaviour (.NET) | Native services: config, scenes, game activity, privacy, recovery, release. |
| `test:native-host-api` | `test-native-host-api.mjs` | Rendered | Launches the built host: health, session-token bootstrap, private fields kept out of API payloads, display placement. |
| `test:bridge-api` | `test-bridge-api.mjs` | Behaviour | The legacy bridge's local API. |
| `test:theme-rendered` | `test-theme-rendered.mjs` | Rendered | Focus, Gaming and Warm in a real browser at four sizes: contrast, focus rings, forced colors, reduced motion, 44px targets, legacy theme migration, the 16-swatch picker. Every other theme once in standard and Night. |
| `test:standalone-theme-rendered` | `test-standalone-theme-rendered.mjs` | Rendered | The same for the 19 standalone pages, plus every added theme on one widget page. Runs on any OS with Chrome or Edge. |
| `test:rendered-dashboard` | `test-rendered-dashboard.mjs` | Rendered | The whole dashboard: every panel, geometry at ten sizes, 44px targets, accessible names, Touch Lock, backup and restore, layout migration, repeated cold boots. A 28-quest log from the game stays on one screen at 2560x720 and 2048x720 and scrolls inside its card. |

## Release set: added by `npm run check:release`

Left as they were unless noted. Most are source-text checks.

| Step | Script | Kind | What it protects |
|---|---|---|---|
| `check:standalone-theme` | `check-standalone-theme-contract.mjs` | Source text | Each of the 19 standalone pages loads `theme.css`, `standalone-theme.css` and `theme-bootstrap.js` once, in order. Trimmed in Phase 1: the CSS and bootstrap pins went; the rendered standalone test covers that behaviour. |
| `check:setup-guide` | `check-setup-guide.mjs` | Source text | `widgets/setup-guide.html` helper usage. |
| `check:bridge-boundaries` | `check-bridge-boundaries.mjs` | Source text | Legacy bridge network boundaries. |
| `check:observability` | `check-observability.mjs` | Source text | Local HTTP logging in native services. |
| `check:dependency-pins` | `check-dependency-pins.mjs` | Config | Dependency and workflow action versions are pinned. |
| `check:support-redaction` | `check-support-redaction.mjs` | Source text | Support bundles redact private data. |
| `check:display-recovery` | `check-display-recovery.mjs` | Source text | Companion-display startup, tray and recovery. |
| `test:display-receipt`, `test:frigate-receipt` | PowerShell | Behaviour | Qualification receipt verifiers. |
| `check:source-guards` | `check-source-guards.mjs` | Source text | Guards on native C# and standalone widget pages that used to live inside everyday scripts. New in Phase 1; see rule 2. |
| `check:commercial-readiness` | `check-commercial-readiness.mjs` | Source text | Commercial launch documents and evidence gate. |
| `test:release-version`, `test:release-artifact`, `test:json-lexical-types`, `test:release-manifest`, `test:release-environment` | PowerShell | Behaviour | Release version, artifact and manifest tooling. |
| `check:release-gauntlet` | `check-release-gauntlet.mjs` | Source text | Release scripts validate their arguments and evidence. |
| `test:iexpress-packaging`, `test:webview2-runtime`, `test:installer-host-stop`, `test:installer-architecture` | PowerShell | Behaviour | Installer packaging and runtime probes. |
| `check:installer-safety` | `check-installer-safety.mjs` | Source text | Installer transactions, autostart and cleanup. |
| `check:audit-regressions` | `check-audit-regressions.mjs` | Source text | Pinned SDK and packages, third-party notices, native security boundaries, HTML escaping in standalone pages, cache-busting asset revisions. Needs a completed `dotnet build`. Trimmed in Phase 1: pins on dashboard JS, CSS and `GameActivityService.cs` went. |

## Known gaps

Phase 1 removed these source-text checks on `GameActivityService.cs` without a behaviour test to replace them. They are functional rules, not security, privacy, accessibility or data-loss protections. Add a .NET test when that code is next changed:

- Game detection ignores Teams and other chat apps, and launcher processes.
- A keyword-only game match stays below the active threshold.
- Game activity scans are cached and the WMI fallback is throttled.

## WoW companion add-on

`addons/AuxoraCompanion` is a World of Warcraft add-on, written in Lua. `scripts/test-wow-companion-addon.lua` runs it against a fake game and checks what it saves and when. It is not part of `npm run check` because the project has no Lua runtime. Run it with any Lua 5.2 or newer: `lua scripts/test-wow-companion-addon.lua`. It cannot show that the add-on loads in the real client; only the game can.
