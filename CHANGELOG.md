# Changelog

## Unreleased

- Added primary display FPS telemetry from the native host.
- Upgraded Game Mode with live display FPS, dashboard FPS, CPU, and GPU readouts.
- Added a local Steam launch pad that scans installed games and launches them through Steam.
- Simplified Game Mode by removing game profile presets, color chips, manual theme fields, and extra summary clutter.
- Hid product/admin panels from the normal dashboard picker so the app opens to the daily-use controls.
- Removed the advanced setup shortcut and planned-connector cards from first-run setup.
- Replaced the old standalone Audio fallback page with a compact quick-control panel.
- Hid empty App Launcher and Clipboard History from the default picker to keep the dashboard cleaner and more private.
- Treated invalid 0 C hardware temperature readings as unavailable instead of showing bad telemetry.
- Removed the visible Profiles widget, Game Mode profile picker, and Game Mode on/off toggle so the gaming flow is just theme plus launch.
- Removed disk activity from System Monitor and stopped sampling the disk performance counter.
- Fixed Top Processes touch scrolling by letting the main System Monitor panel handle the scroll gesture.
- Removed Top Processes from System Monitor and stopped enumerating running processes in the native host.
- Simplified Network Monitor to the useful essentials: download, upload, ping, connection health, and a compact UniFi summary only when detected.
- Simplified Audio into a quick control panel with one master output, compact output switching, active app controls only, and smoother page scrolling.
- Improved touch handling so scroll gestures do not accidentally trigger taps.
- Added touch-specific pressed feedback and scroll-area behavior for the dashboard.
- Added a downloadable support bundle from Diagnostics with sanitized config, health, and recent host logs.
- Collapsed optional setup extras by default so first run focuses on the bridge, system, network, and media basics.
- Made touch taps more deliberate by increasing the scroll movement threshold and press delay.
- Added Steam running-game detection so Game Mode can apply the matching game look automatically.
- Added lightweight game-aware color themes for popular Steam titles without adding another profile picker.
- Rebuilt the shared touch engine to detect scroll gestures earlier, suppress accidental taps after scrolling, and keep pressed states from fighting scroll.
- Added coarse-pointer sizing for the dashboard so buttons, sliders, app tiles, and scroll strips are easier to use on touchscreens.
- Added the approved touch polish pass: quiet settings drawer, touch lock, now-playing strip, larger sliders, action feedback, long-press game theming, and a Steam launch dock.

## 0.2.0 - 2026-04-25

- Prepared the first free public beta release path.
- Added Windows installer packaging with versioned setup output and SHA256 files.
- Moved Weather and Hue secrets out of plain dashboard config into protected local storage.
- Removed token-in-URL UniFi setup behavior.
- Added background/cached UniFi discovery so dashboard health loads quickly.
- Reworked setup guidance so normal users do not need JSON endpoint setup.
- Cleaned repository structure into app models, services, and infrastructure folders.
- Added release, privacy, support, security, signing, and macOS release documentation.
- Added an Electron macOS beta host scaffold for building a Mac package from the shared dashboard.
- Added in-app Reset all app data for local settings and protected secrets.
- Added app-served support and free beta license pages.
- Moved update checks behind the local host and added release asset links for customer downloads.
- Added a Windows clean install smoke-test helper.
- Hid advanced connector setup from normal onboarding.
- Added a Start Menu uninstall cleanup path for local app data.
- Added an automated release readiness gate.

## 0.1.0-preview

- Early native Windows host and local dashboard prototype.
