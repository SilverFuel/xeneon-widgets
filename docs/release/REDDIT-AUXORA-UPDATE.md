# Reddit update draft: XENEON Edge Host is becoming Auxora

## Suggested title

I rebuilt my XENEON Edge dashboard into Auxora — a local-first dashboard for almost any Windows touch display

## Post

Hey everyone — I have a pretty big update on the touch-display dashboard I have been building.

The project started as **XENEON Edge Host**, designed specifically around the Corsair XENEON Edge. After working through feedback and looking at what would make it useful to more people, I have started transitioning it into **Auxora**.

The idea behind Auxora is simple:

> **Your PC at a glance. Your controls within reach.**

Instead of targeting one 2560x720 display, Auxora is being built for compact landscape panels, ultrawide displays, normal monitors, and portrait touchscreens on Windows. It is still local-first and does not require a cloud account.

### The biggest change: Scenes

The whole interface can now shift around what you are doing.

- **Work** prioritizes productivity, calendar, focus, meetings, and system state.
- **Gaming** brings forward games, performance, network latency, microphone, and audio.
- **Media** focuses on artwork, playback, volume, and output controls.
- **Night** dims the interface, reduces motion, and keeps information privacy-safe.
- **Home** prioritizes weather, lighting, network health, and household actions.

Scenes can be selected manually or switched automatically using games, foreground applications, media playback, and schedules. A manual choice always wins until automatic switching is resumed.

### A much simpler interface

The old widget-heavy navigation has been replaced by four main destinations:

- **Home** for the information that matters right now
- **Scenes** for changing the entire experience
- **Library** for optional widgets and integrations
- **Settings** for configuration, privacy, recovery, and diagnostics

Widgets stay in the Library until they are pinned or needed by a Scene, so adding features should not turn the dashboard into a maze.

There is also a quick-control drawer for Scene selection and common controls, plus a dedicated edit mode for pinning, hiding, moving, and resizing cards without cluttering normal use.

### New features now working

- Adaptive layouts for compact, standard, ultrawide, and portrait displays
- A hardware-neutral display picker instead of XENEON-specific detection
- Per-display Scene assignments and display handoff
- Smart Glance briefings with useful local alerts
- Reactive ambient colors and motion
- Per-app audio focus and large volume controls
- DDC/CI brightness, contrast, input, and power controls on supported monitors
- Safe one-tap action chains such as Gaming Night, Focus, and Movie Time
- A temporary QR-code phone remote that stays on the local network
- Configuration backup and restore without exporting passwords or private endpoints
- Signed-extension inspection with declared permissions and no trusted third parties by default
- Automatic migration of existing XENEON settings and Windows-protected secrets

The Windows installer, shortcuts, storage locations, UI, and documentation now use the Auxora name. Some internal executable and source names remain unchanged temporarily so existing installations and protected secrets can migrate safely.

### Reliability work since the previous update

There has also been a large amount of less-visible cleanup:

- Better first-run readiness and diagnostics
- Safer display and embedded-browser recovery
- More reliable local API error handling
- Sanitized support bundles
- Installer transaction, repair, uninstall, and upgrade hardening
- Opt-in update availability notifications
- Touch gesture improvements that reduce accidental taps while scrolling
- Additional automated Scene, migration, extension, installer, API, and layout tests

The complete Windows CI suite is passing, the native Release build has no warnings or errors, and dependency audits currently report no known vulnerable packages.

### What is not finished yet

I do not want to pretend this is a polished commercial release yet.

- **Auxora is still a working name** until trademark and domain checks are complete.
- The Windows installer still needs production code signing.
- Signed download verification and automatic rollback need to be finished before automatic updating.
- The installer still needs clean-install, upgrade, rollback, and uninstall testing across more real Windows hardware and VMs.
- Multi-display assignment works, but running fully independent Auxora windows on several panels at once is still future work.
- macOS remains a beta scaffold; this release is Windows-first.
- The extension trust store is intentionally empty until real publishers are reviewed.

The latest code is now on the production branch, but I have not published a new downloadable release tag yet because I want the release and signing path to be honest and safe.

### Feedback I would really like

If you use a secondary screen or touch panel, I would love to know:

1. What display size and orientation do you use?
2. Which Scene would you use most often?
3. What is the one control you always want within reach?
4. Does **Auxora** work as a name, or do **ShiftPanel** or **OrbitDeck** communicate the idea better?

Thanks to everyone who has followed the project and given feedback. This has grown from a dashboard for one unusual display into something that could become a genuinely useful touch-control platform for many Windows setups.

GitHub: https://github.com/SilverFuel/xeneon-widgets

## Short version

XENEON Edge Host is becoming **Auxora**, a local-first Windows touch-display platform with adaptive layouts, Work/Gaming/Media/Night/Home Scenes, simpler four-part navigation, Smart Glance, audio focus, DDC/CI controls, action chains, a local phone remote, safer extensions, and automatic legacy-data migration. The code is on `main`; a new public installer will follow after signing and clean-machine release testing.
