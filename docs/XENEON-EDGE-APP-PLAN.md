# XENEON Edge Host — Standalone Desktop App Build Plan

## Executive Summary

Replace the iCUE iframe shell with a native Windows desktop app that runs full-screen on the CORSAIR XENEON EDGE (2560x720 capacitive touchscreen). The app uses WinUI 3 + WebView2 to host the existing HTML/CSS/JS dashboard in a borderless window, then progressively replaces the expensive parts (PowerShell polling, iframe-in-iframe rendering) with native C# services.

**End state**: A single `.exe` that auto-starts at login, finds the XENEON EDGE monitor, goes full-screen borderless on it, and serves the real-time dashboard with <1% CPU overhead. No iCUE dependency. Touch-first navigation.

---

## What Exists Today (Inventory)

### Files that will be reused as-is in Phase 1

| File | Role | Lines |
|------|------|-------|
| `dashboard.html` | Router shell — sidebar rail, widget picker, iframe viewer, settings panel | 93 |
| `js/dashboard.js` | Router controller — 12 widget defs, bridge health polling, settings forms, onboarding | 1271 |
| `js/widget-core.js` | Shared widget mount/resize lifecycle | 58 |
| `js/system-stats.js` | Client-side system stats stub (returns "Bridge required") | 22 |
| `js/touch-controls.js` | Pointer-down scale effect for touch buttons | 17 |
| `js/api-utils.js` | Shared fetch helpers | — |
| `css/theme.css` | Design tokens, body gradient, base resets | 41 |
| `css/widgets.css` | All component styles — router rail, viewer, picker, settings, metric cards | 1378+ |
| `widgets/*.html` | 15 self-contained widget pages (system-monitor, network, weather, clock, calendar, audio, hue, plex, nas, automation, unifi-camera, unifi-network, frigate, media, setup-guide) | — |
| `bridge/config.json` | Runtime config (port, weather, hue, calendar, dashboard onboarding) | — |
| `bridge/config.example.json` | Default config template | — |
| `bridge/audio-control.ps1` | Audio device/session routing via compiled C# DLL | — |

### Files that will be modified

| File | What changes | Phase |
|------|-------------|-------|
| `bridge/server.mjs` | Replace `getSystemSnapshot()` and `getNetworkSnapshot()` PowerShell spawns with persistent background collectors | 2 |

### Files that will be created

| File | Purpose | Phase |
|------|---------|-------|
| `app/XenonEdgeHost.sln` | Visual Studio solution | 1 |
| `app/XenonEdgeHost/XenonEdgeHost.csproj` | WinUI 3 project file | 1 |
| `app/XenonEdgeHost/App.xaml` + `.cs` | App entry point | 1 |
| `app/XenonEdgeHost/MainWindow.xaml` + `.cs` | Borderless window with WebView2 | 1 |
| `app/XenonEdgeHost/DisplayManager.cs` | Find XENEON EDGE monitor, position window | 1 |
| `app/XenonEdgeHost/BridgeManager.cs` | Launch/monitor `node bridge/server.mjs` | 1 |
| `app/XenonEdgeHost/TrayIcon.cs` | System tray icon with settings/quit | 1 |
| `app/XenonEdgeHost/Assets/` | App icon, tray icon | 1 |
| `bridge/metrics/MetricsService.cs` | Native C# performance counter + GPU collection | 3 |
| `bridge/metrics/NetworkService.cs` | Native C# network throughput + ping | 3 |

---

## Architecture

```
+-----------------------------------------------------------------------+
|  XENEON EDGE Display (2560x720, secondary monitor, capacitive touch)  |
+-----------------------------------------------------------------------+
        |
+-----------------------------------------------------------------------+
|  XenonEdgeHost.exe  (WinUI 3 / .NET 8 / borderless full-screen)      |
|  +-------------------------------------------------------------------+|
|  |  WebView2 Control (Chromium-based, ships with Windows 11)         ||
|  |  +---------------------------------------------------------------+||
|  |  |  dashboard.html  (your existing router shell)                  |||
|  |  |  -> js/dashboard.js (widget picker, settings, bridge polling)  |||
|  |  |  -> iframe: widgets/system-monitor.html, etc.                  |||
|  |  +---------------------------------------------------------------+||
|  +-------------------------------------------------------------------+|
|                                                                       |
|  DisplayManager  — finds XENEON EDGE by EDID, positions window        |
|  BridgeManager   — spawns/monitors `node bridge/server.mjs`           |
|  TrayIcon        — settings, diagnostics, quit (on primary monitor)   |
+-----------------------------------------------------------------------+
        |
+-----------------------------------------------------------------------+
|  bridge/server.mjs  (Node.js HTTP on 127.0.0.1:8976)                  |
|  /api/system   -> background cached metrics (Phase 2: no PowerShell)  |
|  /api/network  -> background cached network (Phase 2: no PowerShell)  |
|  /api/audio    -> audio-control.ps1 (unchanged)                       |
|  /api/weather  -> OpenWeather API (unchanged)                         |
|  /api/hue      -> Hue bridge REST (unchanged)                         |
|  /api/calendar -> ICS fetch (unchanged)                               |
|  /api/config   -> config.json read/write (unchanged)                  |
|  /api/health   -> setup summary (unchanged)                           |
|  Static files  -> dashboard.html, widgets/, css/, js/                 |
+-----------------------------------------------------------------------+
```

---

## Phase 1: Native App Shell (WebView2 Wrapper)

**Goal**: Launch the existing dashboard in a borderless WinUI 3 window on the XENEON EDGE. No changes to any web code. No changes to the bridge. Just a new `.exe` that replaces the "paste iframe into iCUE" workflow.

**Estimated effort**: 1-2 sessions

### 1.1 Project Setup

- Create `app/` directory at repo root
- Initialize WinUI 3 project targeting .NET 8 + Windows App SDK 1.5+
- Target `win-x64` only (XENEON EDGE is desktop Windows)
- Add `Microsoft.Web.WebView2` NuGet package
- Set project output to `app/bin/XenonEdgeHost.exe`

```xml
<!-- XenonEdgeHost.csproj key settings -->
<TargetFramework>net8.0-windows10.0.19041.0</TargetFramework>
<WindowsSdkPackageVersion>10.0.19041.38</WindowsSdkPackageVersion>
<RuntimeIdentifier>win-x64</RuntimeIdentifier>
<SelfContained>false</SelfContained>
<WindowsPackageType>None</WindowsPackageType>
```

### 1.2 DisplayManager.cs — Find the XENEON EDGE

```
Purpose: Enumerate monitors via Win32 EnumDisplayDevices/EnumDisplaySettings,
         find the one whose EDID or device name contains "XENEON" or matches
         the known resolution 2560x720, and return its screen bounds.

Fallback: If no XENEON EDGE is found, use the primary monitor.

API surface:
  - DisplayManager.FindXenonEdgeBounds() -> Rectangle
  - DisplayManager.IsXenonEdgeConnected() -> bool
```

Key implementation detail: Use `System.Windows.Forms.Screen.AllScreens` or P/Invoke `EnumDisplayMonitors` + `GetMonitorInfoW`. Match by:
1. Device name containing "XENEON" (via EDID registry lookup)
2. Resolution exactly 2560x720
3. Fall back to largest-width non-primary monitor

### 1.3 MainWindow.xaml — Borderless Full-Screen

```xml
<Window x:Class="XenonEdgeHost.MainWindow"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="XENEON Edge Host">
    <Grid>
        <WebView2 x:Name="EdgeWebView"
                  Source="http://127.0.0.1:8976/dashboard.html" />
    </Grid>
</Window>
```

MainWindow.cs responsibilities:
- On `Loaded`: Call `DisplayManager.FindXenonEdgeBounds()`, position and resize window to those exact bounds
- Remove title bar using `ExtendsContentIntoTitleBar = true` + hide title bar buttons
- Set `AppWindow.SetPresenter(FullScreenPresenter)` or manually size to exact monitor bounds
- Set `Topmost = true` (configurable via tray settings)
- Handle WebView2 initialization: set user agent, disable context menu, disable dev tools in release builds
- Handle `NavigationCompleted` to inject touch-friendly viewport meta if needed

### 1.4 BridgeManager.cs — Launch Node Bridge

```
Purpose: Start `node bridge/server.mjs` as a child process if port 8976 is not
         already listening. Monitor the process. Restart if it dies.

Lifecycle:
  App.OnLaunched -> BridgeManager.EnsureBridgeRunning()
  App.OnClosed   -> BridgeManager.StopBridge()

Implementation:
  - Check if 127.0.0.1:8976 is listening (TcpClient connect test)
  - If not, spawn: Process.Start("node", "bridge/server.mjs", workingDir=repoRoot)
  - Redirect stdout/stderr to bridge/bridge.log
  - Poll /api/health every 500ms up to 20 attempts
  - If health check passes, signal MainWindow to navigate WebView2
  - If bridge process exits unexpectedly, restart after 2s delay
  - On app exit, send SIGTERM (Process.Kill) to bridge process
```

### 1.5 TrayIcon — Settings on Primary Monitor

```
Purpose: System tray icon on the user's primary monitor with a context menu.

Menu items:
  - "Open Dashboard" — bring MainWindow to front
  - "Restart Bridge" — BridgeManager.RestartBridge()
  - "Open in Browser" — launch http://127.0.0.1:8976/dashboard.html in default browser
  - "Always on Top" — toggle MainWindow.Topmost
  - "Settings" — open a small settings dialog (bridge port, auto-start, display override)
  - separator
  - "Quit" — BridgeManager.StopBridge(), Application.Exit()
```

Implementation: Use `Microsoft.Windows.AppNotifications` or fall back to `System.Windows.Forms.NotifyIcon` (add `System.Windows.Forms` reference). WinUI 3 does not have native tray support, so the `NotifyIcon` approach from WinForms is the standard workaround.

### 1.6 Auto-Start at Login

Replace the current `install-bridge.ps1` scheduled task approach with:
- Registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` entry pointing to `XenonEdgeHost.exe`
- Set via a checkbox in the tray settings dialog
- The existing `XeneonBridge` scheduled task and `Run` registry entry from `install-bridge.ps1` can coexist — the app checks if the port is already bound before spawning a second bridge

### 1.7 Build & Distribution

```
# Single-command build
dotnet publish app/XenonEdgeHost/XenonEdgeHost.csproj -c Release -r win-x64

# Output: app/bin/Release/net8.0-windows10.0.19041.0/win-x64/publish/
# Key files: XenonEdgeHost.exe, *.dll, WebView2Loader.dll
```

No MSIX/packaging required — `WindowsPackageType=None` gives a plain `.exe`. Users can run it directly or use `Start XENEON Edge Host.cmd` to launch the app.

### 1.8 Phase 1 Acceptance Criteria

- [ ] `XenonEdgeHost.exe` launches, starts the bridge, opens the dashboard full-screen on the XENEON EDGE
- [ ] All 12 widget tabs work (setup, system, network, audio, weather, unifi-camera, unifi-network, plex, nas, automation, hue, clock/calendar)
- [ ] Touch works (tap widget tabs, tap settings, slider for opacity)
- [ ] Tray icon shows on primary monitor with working menu
- [ ] Bridge auto-restarts if killed
- [ ] Total CPU usage of app + bridge < 5% idle (still using PowerShell metrics at this point)
- [ ] No changes to any HTML, JS, CSS, or existing bridge code

---

## Phase 2: Fix Bridge CPU (Lightweight Metrics)

**Goal**: Replace the two PowerShell-spawning functions in `bridge/server.mjs` with background-cached collectors that use persistent system processes and Node.js built-ins. Target: <1% CPU for the bridge process.

**Estimated effort**: 1 session

**Files modified**: `bridge/server.mjs` ONLY

### 2.1 What Gets Replaced

| Current function | CPU cost | Replacement | CPU cost |
|---|---|---|---|
| `getSystemSnapshot()` (lines 383-571) | ~180-line PowerShell script spawned per call, includes `Start-Sleep -Milliseconds 350`, Get-Counter, Get-CimInstance, nvidia-smi, top 5 processes | Background collectors + cached result | Near zero |
| `getNetworkSnapshot()` (lines 573-599) | PowerShell with Get-Counter + Get-NetAdapter + Test-Connection per call | Background collectors + cached result | Near zero |

### 2.2 Background Collector Design

Add near the top of `server.mjs`:

```javascript
import os from "node:os";
import { spawn } from "node:child_process";
```

#### CPU Collector (Node.js os module — zero cost)
```
- Use os.cpus() to sample CPU times every 2 seconds
- Calculate usage delta between samples
- Store in metricsCache.cpu (percentage, 0-100)
```

#### RAM Collector (Node.js os module — zero cost)
```
- os.totalmem() and os.freemem()
- Calculate percentage
- Store in metricsCache.ram
```

#### GPU Collector (persistent nvidia-smi — near zero cost)
```
- Spawn: nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits -l 5
- Parse each stdout line as CSV
- Store in metricsCache.gpu and metricsCache.gpuTemp
- If nvidia-smi not found, store null (graceful degradation)
```

#### Disk Collector (persistent typeperf — near zero cost)
```
- Spawn: typeperf "\PhysicalDisk(_Total)\% Idle Time" -si 3
- Parse CSV output, calculate 100 - idlePercent
- Store in metricsCache.disk
```

#### CPU Temperature (persistent typeperf or LibreHardwareMonitor WMI — low cost)
```
- Attempt: typeperf "\Thermal Zone Information(*)\Temperature" -si 5
- Or: single PowerShell WMI query on a 30-second interval (not per-request)
- Store in metricsCache.cpuTemp
```

#### Network Collector (persistent typeperf + ping.exe — near zero cost)
```
- Spawn: typeperf "\Network Interface(*)\Bytes Received/sec" "\Network Interface(*)\Bytes Sent/sec" -si 3
- Parse and sum all interfaces
- Convert bytes/sec to Mbps
- Spawn: ping.exe -t 1.1.1.1 (persistent, parse "time=XXms" from each line)
- Store in metricsCache.download, .upload, .ping
```

#### Top Processes (WMI query on interval — low cost)
```
- Every 10 seconds, run a single lightweight PowerShell query:
  Get-Process | Sort-Object CPU -Descending | Select -First 5 | ConvertTo-Json
- This is far cheaper than the current approach which does a 350ms sleep
  and dual snapshot for accurate per-process CPU measurement
- Store in metricsCache.topProcesses
```

### 2.3 Modified getSystemSnapshot()

```javascript
function getSystemSnapshot() {
  return {
    cpu:   metricsCache.cpu   ?? 0,
    gpu:   metricsCache.gpu   ?? 0,
    ram:   metricsCache.ram   ?? 0,
    disk:  metricsCache.disk  ?? 0,
    cpuTemp: metricsCache.cpuTemp,
    gpuTemp: metricsCache.gpuTemp,
    topProcesses: metricsCache.topProcesses ?? [],
    source: "local bridge"
  };
}
```

No `async`. No PowerShell. No `await`. Just returns the cached object.

### 2.4 Modified getNetworkSnapshot()

```javascript
function getNetworkSnapshot() {
  return {
    download: metricsCache.download ?? 0,
    upload:   metricsCache.upload   ?? 0,
    ping:     metricsCache.ping     ?? 0,
    type:     metricsCache.networkType ?? "unknown",
    source: "local bridge"
  };
}
```

### 2.5 What Stays Untouched

Everything else in `server.mjs` stays exactly as-is:
- `runWindowsPowerShell()` — still used by audio control
- `runWindowsPowerShellFile()` — still used by audio control
- `runAudioControl()` — unchanged
- All Hue functions — unchanged
- All config functions — unchanged
- All setup/diagnostics functions — unchanged (they call `getSystemSnapshot()` and `getNetworkSnapshot()` which now return cached data instantly)
- All API routes — unchanged
- Status cache system — unchanged (but now the underlying resolvers are instant)
- Static file serving — unchanged

### 2.6 Phase 2 Acceptance Criteria

- [ ] `bridge/server.mjs` starts without errors
- [ ] `/api/system` returns data matching the existing schema: `{ cpu, gpu, ram, disk, cpuTemp, gpuTemp, topProcesses, source }`
- [ ] `/api/network` returns data matching the existing schema: `{ download, upload, ping, type, source }`
- [ ] `/api/health` returns full setup summary (system: Ready, network: Ready)
- [ ] System monitor widget shows live CPU/GPU/RAM/Disk bars and top processes
- [ ] Network widget shows live throughput and ping
- [ ] `node.exe` CPU usage < 1% sustained
- [ ] All other widgets (audio, weather, hue, setup, etc.) still work
- [ ] No changes to any file other than `bridge/server.mjs`

---

## Phase 3: Native Metrics Service (Optional, Future)

**Goal**: Move system/network metrics collection from Node.js child processes into a C# service inside the app, communicating with the WebView2 dashboard via a local API or JavaScript bridge.

**Estimated effort**: 2-3 sessions

### 3.1 MetricsService.cs

```
- Use System.Diagnostics.PerformanceCounter for CPU, disk, network
- Use NVML (NVIDIA Management Library) P/Invoke for GPU utilization + temp
- Use WMI/CIM for CPU temp, top processes
- Expose via internal HTTP endpoint or WebView2.CoreWebView2.AddHostObjectToScript()
```

### 3.2 Remove Node Bridge Dependency for Metrics

```
- WebView2 calls MetricsService directly via host object bridge
- Eliminates the Node.js -> typeperf/nvidia-smi pipeline entirely
- System and network widgets get data from C# with zero child processes
```

### 3.3 Keep Node Bridge for Non-Metrics

```
- Bridge still serves: weather, calendar, hue, audio, config, setup
- Bridge still serves static files (or WebView2 navigates to local files directly)
- Eventually, bridge could be replaced entirely with C# endpoints
```

---

## Phase 4: Single-DOM Dashboard (Optional, Future)

**Goal**: Replace the iframe-per-widget architecture with in-page component modules. One DOM, shared data layer, no iframe overhead.

### 4.1 Component Architecture

```
- Each widget becomes a JS module that renders into a container div
- Shared data service polls bridge endpoints, distributes to active widgets
- Page-based navigation via CSS class toggling (no iframe src changes)
- Swipe gesture support for page transitions (XENEON EDGE is touch)
```

### 4.2 Benefits

```
- Eliminates iframe creation/destruction on tab switch
- Single shared CSS — no redundant font/style loading per widget
- Direct data sharing between widgets (no postMessage)
- Faster tab switching (instant DOM swap vs. iframe load)
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| WebView2 Runtime not installed (Windows 10) | Medium | Blocks app launch | App checks on startup, prompts download, or bundle Evergreen Bootstrapper |
| XENEON EDGE not detected by EDID | Low | Wrong monitor | Fallback to resolution match (2560x720), then to primary monitor |
| DPI scaling issues on mixed-DPI setups | Medium | UI too small/large on EDGE | Force per-monitor DPI awareness, test with 100% and 150% scaling |
| Bridge port conflict (8976 already bound) | Low | Bridge won't start | BridgeManager checks port first, reuses existing bridge |
| nvidia-smi not in PATH | Medium | No GPU metrics | Graceful null — search `%ProgramFiles%\NVIDIA Corporation\NVSMI\` as fallback |
| typeperf locale differences | Low | CSV parsing breaks | Use `-si` not `-sc`, parse by comma, handle decimal separator |
| Audio control DLL compilation fails | Low | Audio widget broken | Existing behavior — `audio-control.ps1` handles this |
| Touch events not reaching WebView2 | Low | Can't use touch | WebView2 inherits touch from WinUI 3 — test early |

---

## Codex Task Breakdown

These are the discrete, self-contained tasks suitable for Codex execution. Each task has clear inputs, outputs, and verification steps.

### Task 1: Scaffold WinUI 3 + WebView2 Project
```
Create app/XenonEdgeHost/ with:
- XenonEdgeHost.csproj (net8.0-windows, WebView2 NuGet, WindowsPackageType=None)
- App.xaml + App.xaml.cs (minimal WinUI 3 app entry)
- MainWindow.xaml + MainWindow.xaml.cs (WebView2 control, borderless, full-screen)
- Verify: dotnet build succeeds
```

### Task 2: Implement DisplayManager
```
Create app/XenonEdgeHost/DisplayManager.cs
- EnumDisplayMonitors P/Invoke or Screen.AllScreens
- Find monitor by name containing "XENEON" or resolution 2560x720
- Return bounds rectangle
- Fallback to primary monitor
- Unit testable with mock monitor list
```

### Task 3: Implement BridgeManager
```
Create app/XenonEdgeHost/BridgeManager.cs
- Port check via TcpClient
- Process.Start for node bridge/server.mjs
- Health poll loop
- Process monitor with auto-restart
- Graceful shutdown
```

### Task 4: Implement TrayIcon
```
Create app/XenonEdgeHost/TrayIcon.cs
- System.Windows.Forms.NotifyIcon with context menu
- Menu: Open Dashboard, Restart Bridge, Open in Browser, Always on Top, Settings, Quit
- Wire to MainWindow and BridgeManager
```

### Task 5: Wire App Lifecycle
```
Modify App.xaml.cs:
- OnLaunched: create BridgeManager, start bridge, create MainWindow, position on XENEON EDGE
- Handle single-instance (mutex) — second launch brings existing window to front
- On close: stop bridge, dispose tray icon
```

### Task 6: Update Start Script
```
Modify Start XENEON Edge Host.cmd:
- If XenonEdgeHost.exe exists, launch it instead of the PowerShell start script
- Otherwise fall back to existing behavior (backward compatible)
```

### Task 7: Fix Bridge CPU — Background Collectors
```
Modify bridge/server.mjs ONLY:
- Add imports: os, spawn
- Add metricsCache object
- Add startCpuCollector() using os.cpus()
- Add startGpuCollector() using persistent nvidia-smi
- Add startDiskCollector() using persistent typeperf
- Add startNetworkCollector() using persistent typeperf + ping.exe
- Add startProcessCollector() using interval PowerShell query
- Replace getSystemSnapshot() body with cached return
- Replace getNetworkSnapshot() body with cached return
- Call all start*() functions at module load
- Verify: all /api/* endpoints return correct data, CPU < 1%
```

### Task 8: End-to-End Testing
```
- Launch XenonEdgeHost.exe
- Verify bridge starts automatically
- Verify dashboard loads in WebView2
- Verify all 12 widget tabs render
- Verify touch interaction (if XENEON EDGE available)
- Verify tray icon menu works
- Verify bridge restart from tray
- Verify app exit cleans up bridge process
- Verify CPU usage < 1% at idle
- Verify no errors in bridge.log
```

---

## File Tree After Phase 1+2

```
xeneon-widgets/
  app/
    XenonEdgeHost/
      XenonEdgeHost.csproj
      App.xaml
      App.xaml.cs
      MainWindow.xaml
      MainWindow.xaml.cs
      DisplayManager.cs
      BridgeManager.cs
      TrayIcon.cs
      Assets/
        xeneon-icon.ico
  bridge/
    server.mjs            <-- modified: background collectors
    config.json
    config.example.json
    run-bridge.ps1
    install-bridge.ps1
    uninstall-bridge.ps1
    audio-control.ps1
    bridge.log
  css/
    theme.css
    widgets.css
  js/
    dashboard.js
    widget-core.js
    system-stats.js
    touch-controls.js
    api-utils.js
    hosted-dashboard.js
    weather-api.js
  widgets/
    setup-guide.html
    system-monitor.html
    network-widget.html
    audio-output-panel.html
    weather-widget.html
    clock-widget.html
    calendar-widget.html
    media-widget.html
    unifi-camera-viewer.html
    unifi-network-dashboard.html
    plex-server-monitor.html
    nas-storage-monitor.html
    home-automation-panel.html
    philips-hue-panel.html
    frigate-detection-panel.html
  dashboard.html
  hosted-dashboard.html
  index.html
  package.json
  Start XENEON Edge Host.cmd
  start-xeneon.ps1
  docs/XENEON-EDGE-APP-PLAN.md
```

---

## Dependencies

| Dependency | Version | Purpose | Bundled? |
|-----------|---------|---------|----------|
| .NET 8 SDK | 8.0+ | Build the app | No — dev machine only |
| .NET 8 Runtime | 8.0+ | Run the app | No — user must install, or publish self-contained |
| Windows App SDK | 1.5+ | WinUI 3 framework | Yes — NuGet |
| Microsoft.Web.WebView2 | 1.0.2000+ | Chromium rendering | Yes — NuGet |
| WebView2 Runtime | Evergreen | Browser engine | Preinstalled on Win11, needs install on Win10 |
| Node.js | 18+ LTS | Run bridge/server.mjs | No — user must install (same as today) |

---

## Compatibility

| Scenario | Supported |
|----------|-----------|
| Windows 11 + XENEON EDGE | Full support (primary target) |
| Windows 10 (1809+) + XENEON EDGE | Supported (user installs WebView2 Runtime) |
| No XENEON EDGE connected | Works on primary monitor (for development/testing) |
| iCUE iframe (existing workflow) | Still works — bridge serves the same dashboard at same URL |
| Hosted dashboard (GitHub Pages) | Still works — completely separate from the app |

---

## Success Metrics

1. **CPU**: App + bridge combined < 1% CPU at idle on any Windows PC
2. **Startup**: Dashboard visible within 5 seconds of double-clicking the app
3. **Memory**: App < 150 MB RSS (WebView2 + WinUI 3 + bridge)
4. **Touch**: All widget tabs, settings sliders, and Hue controls respond to touch
5. **Reliability**: Bridge auto-restarts within 3 seconds if killed
6. **Compatibility**: Works on any Windows 10/11 machine with or without XENEON EDGE connected
