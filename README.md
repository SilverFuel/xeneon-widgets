# XENEON Widgets

## Hosted Mode

```html
<iframe src="https://silverfuel.github.io/xeneon-widgets/hosted-dashboard.html?v=20260312-3" style="width:100%;height:100%;border:0;"></iframe>
```

Hosted mode uses only public web features:

- clock
- timezone
- optional weather if you add `?apiKey=YOUR_KEY&city=Indianapolis` to the URL

## Real-Time Mode

```html
<iframe src="http://127.0.0.1:8976/dashboard.html?v=20260312-3" style="width:100%;height:100%;border:0;"></iframe>
```

## One-Time Bridge Install

1. Copy `bridge/config.example.json` to `bridge/config.json`
2. Put your OpenWeather API key in `bridge/config.json` if you want live weather
3. Put an ICS URL in `bridge/config.json` if you want a real calendar feed
4. Install the bridge auto-start task once:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\install-bridge.ps1
```

The bridge now serves both the dashboard and the APIs from `http://127.0.0.1:8976`.

## Manual Start

```powershell
node bridge/server.mjs
```

## GitHub Pages

GitHub Pages is still fine for previewing the static UI:

```text
https://silverfuel.github.io/xeneon-widgets/hosted-dashboard.html?v=20260312-3
```

Use the hosted page for the helper-free dashboard. Use the localhost page for live telemetry.

## What Is Real Right Now

- Hosted mode: clock, timezone, optional OpenWeather
- Real-time mode: system and network through the local bridge
- Real-time mode optional: weather and calendar through `bridge/config.json`

## What Still Needs a Windows Media Bridge

- Media playback is no longer faked, but the local bridge does not yet expose Windows media sessions or transport controls.
