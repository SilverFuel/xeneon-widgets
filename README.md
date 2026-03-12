# XENEON Widgets

## Paste This Into iCUE

```html
<iframe src="https://silverfuel.github.io/xeneon-widgets/dashboard.html?v=20260312-1" style="width:100%;height:100%;border:0;"></iframe>
```

## Real Data Setup

1. Copy `bridge/config.example.json` to `bridge/config.json`
2. Put your OpenWeather API key in `bridge/config.json` if you want live weather
3. Put an ICS URL in `bridge/config.json` if you want a real calendar feed
4. Start the bridge:

```powershell
node bridge/server.mjs
```

The dashboard reads real system and network data from `http://127.0.0.1:8976`.

## What Is Real Right Now

- Clock: local time
- System: Windows perf counters through the local bridge
- Network: Windows counters and ping through the local bridge
- Weather: OpenWeather through the local bridge when configured
- Calendar: ICS feed through the local bridge when configured

## What Still Needs a Windows Media Bridge

- Media playback is no longer faked, but the local bridge does not yet expose Windows media sessions or transport controls.
