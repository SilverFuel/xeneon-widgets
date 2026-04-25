# Privacy

XENEON Edge Host is designed as a local-first dashboard.

## What Stays Local

- Dashboard settings are stored on the local machine.
- Weather and Hue secrets are not written into the normal dashboard config file.
- On Windows, Weather and Hue secrets are protected with Windows per-user data protection.
- On macOS, the Electron beta host uses Electron safe storage for protected secrets when available.
- System, network, audio, media, launcher, clipboard, and local integration state are served from `127.0.0.1`.

## Network Access

The app may contact:

- OpenWeather, only when the user adds an OpenWeather key.
- A local Philips Hue Bridge, only when the user links Hue.
- Local UniFi devices or consoles, only for local discovery and status.
- GitHub release endpoints, only for release/update checks shown in the dashboard.

## Telemetry

The app does not currently include analytics, crash upload telemetry, or remote behavior tracking.

## Local Files

Windows data is stored under:

```text
%APPDATA%\XenonEdgeHost
%LOCALAPPDATA%\XenonEdgeHost
```

macOS beta data is stored under the app's standard Electron user-data folder.

## Data Removal

Uninstalling removes the installed app. Local settings may remain so the dashboard can keep user preferences across upgrades. A future release should add a one-click "remove all local data" action before broad public sales.
