# Privacy

Auxora is designed as a local-first dashboard.

## What Stays Local

- Dashboard settings are stored on the local machine.
- Weather, calendar, Hue, and UniFi secrets are not written into the normal dashboard config file.
- On Windows, those integration secrets are protected with Windows per-user data protection.
- On macOS, the Electron beta host uses Electron safe storage for protected secrets when available.
- System, network, audio, media, launcher, clipboard, and local integration state are served from `127.0.0.1`.

## Network Access

The app may contact:

- OpenWeather, only when the user adds an OpenWeather key.
- A local Philips Hue Bridge, only when the user links Hue.
- Local UniFi devices or consoles, only for local discovery and status.
- GitHub release endpoints, only for release/update checks shown in the dashboard.
- The public HTTPS calendar feed configured by the user. Calendar requests reject local/private destinations and re-check DNS at the connection boundary.

## Telemetry

The app does not currently include analytics, crash upload telemetry, or remote behavior tracking.

Foreground-app tracking is off by default. If the user turns it on in onboarding or Privacy, Auxora checks which desktop app is in the foreground and stores that app's display name, executable path, source, and last-opened time. It retains up to 24 entries in a local recent-app history file. It does not record window titles, keyboard input, screen contents, or time spent in an app, and it does not upload the history. Turning the toggle off clears the retained recent-app history.

Media titles, artist/album details, artwork, source application IDs, and audio-session application labels are also off by default. Audio and playback controls continue to work with generic labels. The user can opt in separately to media details and audio application labels from Privacy & Backup; both settings stay local, round-trip in the credential-free backup, and can be turned off again without disabling the controls. Auxora does not upload this metadata.

Game performance capture may create short-lived local PresentMon CSV files while a game session is active. They are deleted when no longer needed unless the user explicitly enables diagnostic retention; retained files are still age- and size-limited. Reset all app data deletes retained PresentMon files.

## Local Files

Windows data is stored under:

```text
%APPDATA%\Auxora
%LOCALAPPDATA%\Auxora
```

macOS beta data is stored under the app's standard Electron user-data folder.

Legacy `%APPDATA%\XenonEdgeHost` and `%LOCALAPPDATA%\XenonEdgeHost` folders may remain temporarily after migration so an older build can be restored. The Remove Auxora and Local Data shortcut deletes both current and legacy data.

## Data Removal

Use Reset all app data from the in-app Privacy or Setup panel to clear current configuration and protected integration secrets, recent-app history, host logs, retained PresentMon game telemetry, dashboard browser storage, known legacy data files, and the active WebView browsing profile when that profile is available. The reset response shows a deletion receipt. If a required deletion fails, Auxora reports the failure instead of claiming the reset completed. The Windows Start Menu also includes a Remove Auxora and Local Data cleanup shortcut.

Uninstalling removes the installed app. Local settings can remain so the dashboard keeps user preferences across upgrades, so reset local app data first if the machine is being sold, returned, or handed to another person.
