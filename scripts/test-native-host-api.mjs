import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let hostUrl = "";
const executable = resolve(
  process.cwd(),
  "app/bin/x64/Release/net8.0-windows10.0.19041.0/win-x64/XenonEdgeHost.exe"
);
const expectedAssetRevision = JSON.parse(readFileSync(resolve(process.cwd(), "assets/revision.json"), "utf8")).assetRevision;
const buildStamp = readFileSync(resolve(process.cwd(), "build/build-stamp.props"), "utf8");
const expectedProductVersion = buildStamp.match(/<XenonInformationalVersion>([^<]+)<\/XenonInformationalVersion>/)?.[1]?.split("+")[0] || "";
const expectedReleaseChannel = /-.*nightly/i.test(expectedProductVersion)
  ? "nightly"
  : expectedProductVersion.includes("-") ? "beta" : "stable";
const standaloneFallbackPaths = [
  "/widgets/audio-output-panel.html",
  "/widgets/calendar-widget.html",
  "/widgets/frigate-detection-panel.html",
  "/widgets/network-widget.html",
  "/widgets/philips-hue-panel.html",
  "/widgets/setup-guide.html",
  "/widgets/system-monitor.html",
  "/widgets/weather-widget.html"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function reserveLocalPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise(resolveClose => server.close(resolveClose));
  assert(port > 0, "could not reserve a local native-host test port");
  return port;
}

async function fetchWithTimeout(path, options = {}, timeoutMs = 3000) {
  return fetch(`${hostUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs)
  });
}

async function assertStandaloneScriptPolicy(path) {
  const response = await fetchWithTimeout(path);
  const html = await response.text();
  assert(response.status === 200, `live host must serve standalone fallback ${path}`);
  assert(/window\.XenonSessionToken\s*=/.test(html), `${path} must receive the native mutation-session bootstrap`);

  const csp = response.headers.get("content-security-policy") || "";
  const nonce = csp.match(/script-src[^;]*'nonce-([^']+)'/i)?.[1] || "";
  assert(nonce, `${path} must publish a script nonce in its Content Security Policy`);

  const inlineScripts = [...html.matchAll(/<script(?<attributes>[^>]*)>/gi)]
    .map(match => match.groups?.attributes || "")
    .filter(attributes => !/\bsrc\s*=/i.test(attributes));
  assert(inlineScripts.length >= 2, `${path} must contain the session bootstrap and its standalone inline runtime`);
  for (const attributes of inlineScripts) {
    const tagNonce = attributes.match(/\bnonce\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    assert(tagNonce === nonce, `${path} contains an inline script that the published CSP would block`);
  }
}

async function hostAlreadyRunning() {
  try {
    const response = await fetchWithTimeout("/api/config", {}, 3000);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHost(child, readDiagnostics, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const diagnostics = typeof readDiagnostics === "function" ? readDiagnostics() : {};
      throw new Error(`native host exited before becoming healthy: ${JSON.stringify(diagnostics)}`);
    }
    try {
      const response = await fetchWithTimeout("/api/health", {}, 10000);
      if (response.ok) return response;
    } catch {
      // The listener is expected to be unavailable during startup.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
  }
  const diagnostics = typeof readDiagnostics === "function" ? readDiagnostics() : {};
  throw new Error(`native host did not expose /api/health within 45 seconds: ${JSON.stringify(diagnostics)}`);
}

function captureChildOutput(child, logPath) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", chunk => { stdout = (stdout + chunk.toString()).slice(-12000); });
  child.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
  return () => {
    let hostLog = "";
    try {
      hostLog = existsSync(logPath) ? readFileSync(logPath, "utf8").slice(-12000) : "";
    } catch (error) {
      hostLog = `unreadable: ${error.message}`;
    }
    return { exitCode: child.exitCode, signalCode: child.signalCode, stdout, stderr, hostLog };
  };
}

async function waitForEmbeddedDashboardBoot(timeoutMs = 15000) {
  const displayResponse = await fetchWithTimeout("/api/display/diagnostics", {}, 3000);
  assert(displayResponse.ok, `live display diagnostics returned HTTP ${displayResponse.status} before embedded dashboard boot`);
  const display = await displayResponse.json();
  const companionDisplayCount = display?.companionDisplayCount;
  assert(Number.isInteger(companionDisplayCount), "display diagnostics must report an integer companion count before embedded dashboard boot");
  if (companionDisplayCount === 0) {
    assert(
      display?.status === "waiting-for-companion-display",
      `primary-only startup must publish the waiting display state before embedded dashboard boot: ${JSON.stringify(display)}`
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetchWithTimeout("/api/support/bundle", {}, 3000);
    const bundle = response.ok ? await response.json() : {};
    const log = Array.isArray(bundle.log) ? bundle.log.join("\n") : "";
    const dashboardLoads = (log.match(/Dashboard loaded successfully\./g) || []).length;
    const dashboardConfigRequests = (log.match(/"method":"GET","path":"\/api\/config","statusCode":200/g) || []).length;
    if (companionDisplayCount === 0) {
      assert(
        dashboardLoads === 0 && dashboardConfigRequests === 0,
        `primary-only startup initialized the embedded dashboard instead of deferring it: ${JSON.stringify({ dashboardLoads, dashboardConfigRequests })}`
      );
      return {
        companionDisplayCount,
        displayStatus: display.status,
        dashboardLoads,
        dashboardConfigRequests
      };
    }
    assert(dashboardLoads <= 1, `embedded dashboard loaded more than once during startup: ${dashboardLoads}`);
    if (dashboardLoads === 1 && dashboardConfigRequests >= 1) {
      return {
        companionDisplayCount,
        displayStatus: display.status,
        dashboardLoads,
        dashboardConfigRequests
      };
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }

  const response = await fetchWithTimeout("/api/support/bundle", {}, 3000);
  const bundle = response.ok ? await response.json() : {};
  throw new Error(`embedded dashboard did not complete a real companion-display boot within ${timeoutMs} ms; display=${JSON.stringify(display)}; log tail=${JSON.stringify(Array.isArray(bundle.log) ? bundle.log.slice(-30) : [])}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
    timeout: 10000
  });
  await Promise.race([
    new Promise(resolvePromise => child.once("exit", resolvePromise)),
    new Promise(resolvePromise => setTimeout(resolvePromise, 5000))
  ]);
}

const windowPlacementProbe = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class AuxoraRectSample
{
    public int Left { get; set; }
    public int Top { get; set; }
    public int Right { get; set; }
    public int Bottom { get; set; }
}

public sealed class AuxoraWindowSample : AuxoraRectSample
{
    public long Handle { get; set; }
    public string Title { get; set; }
    public uint Dpi { get; set; }
    public bool IntersectsPrimary { get; set; }
    public bool ContainedByCompanion { get; set; }
    public bool IsForeground { get; set; }
}

public sealed class AuxoraMonitorSample : AuxoraRectSample
{
    public string DeviceName { get; set; }
    public bool Primary { get; set; }
}

public sealed class AuxoraPlacementSample
{
    public AuxoraRectSample Primary { get; set; }
    public List<AuxoraMonitorSample> Monitors { get; set; }
    public List<AuxoraWindowSample> Windows { get; set; }

    public AuxoraPlacementSample()
    {
        Monitors = new List<AuxoraMonitorSample>();
        Windows = new List<AuxoraWindowSample>();
    }
}

public static class AuxoraWindowProbe
{
    private const uint MonitorInfoPrimary = 0x00000001;
    private const int DwmwaCloaked = 14;

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, ref NativeRect bounds, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRect Monitor;
        public NativeRect Work;
        public uint Flags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);

    [DllImport("winmm.dll")]
    private static extern uint timeBeginPeriod(uint period);

    [DllImport("winmm.dll")]
    private static extern uint timeEndPeriod(uint period);

    public static void EnablePhysicalCoordinates()
    {
        if (!SetProcessDpiAwarenessContext(new IntPtr(-4)))
        {
            throw new InvalidOperationException("The window watcher could not enable per-monitor-v2 physical coordinates.");
        }
        timeBeginPeriod(1);
    }

    public static void RestoreTimerResolution()
    {
        timeEndPeriod(1);
    }

    public static AuxoraPlacementSample Capture(int targetProcessId)
    {
        var sample = new AuxoraPlacementSample();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr monitor, IntPtr hdc, ref NativeRect bounds, IntPtr parameter)
        {
            var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (GetMonitorInfo(monitor, ref info))
            {
                var monitorSample = new AuxoraMonitorSample
                {
                    DeviceName = info.DeviceName == null ? "" : info.DeviceName.TrimEnd('\0'),
                    Primary = (info.Flags & MonitorInfoPrimary) != 0,
                    Left = info.Monitor.Left,
                    Top = info.Monitor.Top,
                    Right = info.Monitor.Right,
                    Bottom = info.Monitor.Bottom
                };
                sample.Monitors.Add(monitorSample);
                if (monitorSample.Primary)
                {
                    sample.Primary = CopyRect(info.Monitor);
                }
            }
            return true;
        }, IntPtr.Zero);

        var foregroundWindow = GetForegroundWindow();
        EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId != (uint)targetProcessId || !IsWindowVisible(window))
            {
                return true;
            }

            int cloaked;
            if (DwmGetWindowAttribute(window, DwmwaCloaked, out cloaked, sizeof(int)) == 0 && cloaked != 0)
            {
                return true;
            }

            NativeRect bounds;
            if (!GetWindowRect(window, out bounds) || bounds.Right <= bounds.Left || bounds.Bottom <= bounds.Top)
            {
                return true;
            }

            var title = new StringBuilder(256);
            GetWindowText(window, title, title.Capacity);
            sample.Windows.Add(new AuxoraWindowSample
            {
                Handle = window.ToInt64(),
                Title = title.ToString(),
                Dpi = GetDpiForWindow(window),
                Left = bounds.Left,
                Top = bounds.Top,
                Right = bounds.Right,
                Bottom = bounds.Bottom,
                IntersectsPrimary = sample.Primary != null && Intersects(bounds, sample.Primary),
                ContainedByCompanion = IsContainedByCompanion(bounds, sample.Monitors),
                IsForeground = window == foregroundWindow
            });
            return true;
        }, IntPtr.Zero);

        return sample;
    }

    private static AuxoraRectSample CopyRect(NativeRect bounds)
    {
        return new AuxoraRectSample
        {
            Left = bounds.Left,
            Top = bounds.Top,
            Right = bounds.Right,
            Bottom = bounds.Bottom
        };
    }

    private static bool Intersects(NativeRect window, AuxoraRectSample primary)
    {
        return Math.Min(window.Right, primary.Right) > Math.Max(window.Left, primary.Left)
            && Math.Min(window.Bottom, primary.Bottom) > Math.Max(window.Top, primary.Top);
    }

    private static bool IsContainedByCompanion(NativeRect window, List<AuxoraMonitorSample> monitors)
    {
        foreach (var monitor in monitors)
        {
            if (!monitor.Primary
                && window.Left >= monitor.Left
                && window.Top >= monitor.Top
                && window.Right <= monitor.Right
                && window.Bottom <= monitor.Bottom)
            {
                return true;
            }
        }

        return false;
    }
}
'@

[AuxoraWindowProbe]::EnablePhysicalCoordinates()
Write-Output "AUXORA_WINDOW_WATCHER_READY"
$targetLine = [Console]::In.ReadLine()
if ([string]::IsNullOrWhiteSpace($targetLine)) {
  throw "Auxora process ID was not provided to the window watcher."
}

$targetProcessId = [int]$targetLine
$stopTask = [Console]::In.ReadLineAsync()
$startedAt = [DateTimeOffset]::UtcNow
$minimumStopAt = $startedAt.AddSeconds(10)
$deadline = $startedAt.AddSeconds(45)
$sampleCount = 0
$visibleSampleCount = 0
$primaryFound = $false
$lastPrimary = $null
$observedWindowKeys = New-Object System.Collections.Generic.HashSet[string]
$observedWindows = New-Object System.Collections.Generic.List[object]
$violations = New-Object System.Collections.Generic.List[object]

while ([DateTimeOffset]::UtcNow -lt $deadline -and ((-not $stopTask.IsCompleted) -or [DateTimeOffset]::UtcNow -lt $minimumStopAt)) {
  $sample = [AuxoraWindowProbe]::Capture($targetProcessId)
  $sampleCount++
  if ($null -ne $sample.Primary) {
    $primaryFound = $true
    $lastPrimary = $sample.Primary
  }

  foreach ($window in $sample.Windows) {
    $visibleSampleCount++
    $windowKey = "$($window.Handle):$($window.Left):$($window.Top):$($window.Right):$($window.Bottom)"
    if ($observedWindows.Count -lt 20 -and $observedWindowKeys.Add($windowKey)) {
      $observedWindows.Add([ordered]@{
        handle = $window.Handle
        title = $window.Title
        left = $window.Left
        top = $window.Top
        right = $window.Right
        bottom = $window.Bottom
        dpi = $window.Dpi
        containedByCompanion = $window.ContainedByCompanion
        isForeground = $window.IsForeground
      })
    }
    if (($window.IntersectsPrimary -or -not $window.ContainedByCompanion -or $window.IsForeground) -and $violations.Count -lt 20) {
      $violations.Add([ordered]@{
        observedAtMs = [int]([DateTimeOffset]::UtcNow - $startedAt).TotalMilliseconds
        handle = $window.Handle
        title = $window.Title
        dpi = $window.Dpi
        intersectsPrimary = $window.IntersectsPrimary
        containedByCompanion = $window.ContainedByCompanion
        isForeground = $window.IsForeground
        window = [ordered]@{ left=$window.Left; top=$window.Top; right=$window.Right; bottom=$window.Bottom }
        primary = $sample.Primary
        monitors = $sample.Monitors
      })
    }
  }

  [System.Threading.Thread]::Yield() | Out-Null
}

[AuxoraWindowProbe]::RestoreTimerResolution()
$durationMs = [int]([DateTimeOffset]::UtcNow - $startedAt).TotalMilliseconds
[ordered]@{
  durationMs = $durationMs
  requestedDelayMs = 0
  effectiveIntervalMs = if ($sampleCount -gt 0) { [math]::Round($durationMs / $sampleCount, 3) } else { $null }
  sampleCount = $sampleCount
  visibleSampleCount = $visibleSampleCount
  primaryFound = $primaryFound
  primary = $lastPrimary
  observedWindows = $observedWindows.ToArray()
  violations = $violations.ToArray()
} | ConvertTo-Json -Compress -Depth 8
`;

async function startWindowPlacementWatcher() {
  const watcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowPlacementProbe], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let ready = false;
  let resolveReady;
  let rejectReady;
  let resolveResult;
  let rejectResult;
  let resultSettled = false;
  const readyPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const resultPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveResult = resolvePromise;
    rejectResult = rejectPromise;
  });

  watcher.stderr.on("data", chunk => {
    stderrBuffer += String(chunk);
  });
  watcher.stdout.on("data", chunk => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines.map(value => value.trim()).filter(Boolean)) {
      if (line === "AUXORA_WINDOW_WATCHER_READY") {
        ready = true;
        resolveReady();
        continue;
      }
      if (line.startsWith("{")) {
        try {
          resultSettled = true;
          resolveResult(JSON.parse(line));
        } catch (error) {
          resultSettled = true;
          rejectResult(new Error(`window watcher returned invalid JSON: ${error.message}`));
        }
      }
    }
  });
  watcher.once("error", error => {
    resultSettled = true;
    rejectReady(error);
    rejectResult(error);
  });
  watcher.once("exit", code => {
    if (!ready) {
      rejectReady(new Error(`window watcher exited before ready (code ${code}): ${stderrBuffer.trim()}`));
    }
    if (code !== 0) {
      resultSettled = true;
      rejectResult(new Error(`window watcher exited with code ${code}: ${stderrBuffer.trim()}`));
    } else if (!resultSettled) {
      resultSettled = true;
      rejectResult(new Error(`window watcher exited without a placement result: ${stderrBuffer.trim()}`));
    }
  });

  await readyPromise;
  return { process: watcher, resultPromise, stopped: false };
}

async function stopWindowPlacementWatcher(watcher) {
  if (!watcher.stopped) {
    watcher.stopped = true;
    watcher.process.stdin.end("STOP\n");
  }
  return watcher.resultPromise;
}

if (process.argv.includes("--window-probe-self-test")) {
  assert(process.platform === "win32", "window placement watcher self-test requires Windows");
  const watcher = await startWindowPlacementWatcher();
  watcher.process.stdin.write(`${process.pid}\n`);
  const result = await stopWindowPlacementWatcher(watcher);
  assert(result.primaryFound === true, "window placement watcher self-test must enumerate primary monitor bounds");
  assert(result.effectiveIntervalMs <= 5, `window placement watcher effective interval exceeded 5 ms: ${result.effectiveIntervalMs}`);
  console.log(`window placement watcher self-test passed with ${result.sampleCount} samples at ${result.effectiveIntervalMs} ms effective intervals; primary=${JSON.stringify(result.primary)}`);
  process.exit(0);
}

assert(process.platform === "win32", "launched native host test requires Windows");
assert(existsSync(executable), `Release host executable is missing: ${executable}; run npm run check:app first`);

const profileRoot = mkdtempSync(join(tmpdir(), "auxora-native-host-test-"));
const roaming = join(profileRoot, "Roaming");
const local = join(profileRoot, "Local");
mkdirSync(roaming, { recursive: true });
mkdirSync(local, { recursive: true });
const hostPort = await reserveLocalPort();
hostUrl = `http://127.0.0.1:${hostPort}`;
assert(!(await hostAlreadyRunning()), `test host port ${hostPort} is already serving a host; refusing to validate an unrelated process`);
const configDirectory = join(roaming, "Auxora");
mkdirSync(configDirectory, { recursive: true });
writeFileSync(join(configDirectory, "config.json"), JSON.stringify({ port: hostPort }));

const placementWatcher = await startWindowPlacementWatcher();
const child = spawn(executable, ["--safe-mode"], {
  cwd: resolve(process.cwd(), "app"),
  env: {
    ...process.env,
    APPDATA: roaming,
    LOCALAPPDATA: local,
    AUXORA_ENABLE_TEST_DATA_ROOTS: "1",
    AUXORA_TEST_ROAMING_ROOT: roaming,
    AUXORA_TEST_LOCAL_ROOT: local,
    AUXORA_TEST_INSTANCE_ID: profileRoot,
    TEMP: profileRoot,
    TMP: profileRoot
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
const readHostDiagnostics = captureChildOutput(child, join(local, "Auxora", "logs", "host.log"));
placementWatcher.process.stdin.write(`${child.pid}\n`);
let placementResult = null;

try {
  const healthResponse = await waitForHost(child, readHostDiagnostics);
  assert(existsSync(join(local, "Auxora", "logs", "host.log")), "native-host API test did not use the explicit isolated local-data root");
  assert(existsSync(join(roaming, "Auxora", "config.json")), "native-host API test did not use the explicit isolated roaming-data root");
  const health = await healthResponse.json();
  assert(health && typeof health === "object", "live /api/health must return JSON");
  assert(health.app?.name === "Auxora", `live /api/health did not identify Auxora: ${JSON.stringify(health.app)}`);
  assert(health.app?.version === expectedProductVersion, `live /api/health version mismatch: expected ${expectedProductVersion}, received ${JSON.stringify(health.app)}`);
  assert(health.app?.dashboardAssetRevision === expectedAssetRevision, `live /api/health revision mismatch: expected ${expectedAssetRevision}, received ${JSON.stringify(health.app)}`);
  const healthJson = JSON.stringify(health);
  for (const privateKey of ["suggestedLaunchers", "executablePath", "iconPath", "arguments"]) {
    assert(!healthJson.includes(`"${privateKey}"`), `live /api/health leaked private provisioning field '${privateKey}'`);
  }
  const embeddedBoot = await waitForEmbeddedDashboardBoot();
  if (embeddedBoot.companionDisplayCount === 0) {
    assert(
      embeddedBoot.displayStatus === "waiting-for-companion-display"
        && embeddedBoot.dashboardLoads === 0
        && embeddedBoot.dashboardConfigRequests === 0,
      `primary-only embedded dashboard deferral evidence was incomplete: ${JSON.stringify(embeddedBoot)}`
    );
  } else {
    assert(embeddedBoot.dashboardLoads === 1 && embeddedBoot.dashboardConfigRequests >= 1, `embedded dashboard boot evidence was incomplete: ${JSON.stringify(embeddedBoot)}`);
  }

  const configResponse = await fetchWithTimeout("/api/config");
  assert(configResponse.ok, `live /api/config returned HTTP ${configResponse.status}`);
  const config = await configResponse.json();
  assert(config && typeof config.port === "number", "live /api/config must return the configured port");
  assert(config.dashboard?.releaseChannel === expectedReleaseChannel, `live /api/config release channel mismatch: expected ${expectedReleaseChannel}, received ${JSON.stringify(config.dashboard)}`);
  const configJson = JSON.stringify(config);
  for (const privateKey of ["suggestedLaunchers", "executablePath", "iconPath", "arguments"]) {
    assert(!configJson.includes(`"${privateKey}"`), `live /api/config leaked private provisioning field '${privateKey}'`);
  }
  for (const key of ["updateRollbackEnabled", "lastKnownGoodVersion", "lastKnownGoodPath", "lastKnownGoodConfigured"]) {
    assert(!(key in (config.dashboard || {})), `live /api/config must not expose unusable rollback metadata '${key}'`);
  }

  const provisioningResponse = await fetchWithTimeout("/api/provisioning");
  assert(provisioningResponse.ok, `live /api/provisioning returned HTTP ${provisioningResponse.status}`);
  const provisioning = await provisioningResponse.json();
  assert(Array.isArray(provisioning.suggestedLaunchers), "live /api/provisioning must expose the launcher review list");
  for (const suggestion of provisioning.suggestedLaunchers) {
    const suggestionKeys = Object.keys(suggestion).sort();
    assert(JSON.stringify(suggestionKeys) === JSON.stringify(["displayName", "id", "source"]), `live /api/provisioning exposed unexpected launcher review fields: ${JSON.stringify(suggestionKeys)}`);
  }
  const provisioningJson = JSON.stringify(provisioning);
  for (const privateKey of ["executablePath", "iconPath", "arguments", "reason", "selected"]) {
    assert(!provisioningJson.includes(`"${privateKey}"`), `live /api/provisioning leaked private launcher field '${privateKey}'`);
  }

  const unconfiguredSnapshotResponse = await fetchWithTimeout("/api/frigate/snapshot?id=current-event");
  assert(unconfiguredSnapshotResponse.status === 404, `unconfigured Camera Detection snapshot must return HTTP 404; received ${unconfiguredSnapshotResponse.status}`);
  assert(/not configured/i.test((await unconfiguredSnapshotResponse.json()).error || ""), "unconfigured Camera Detection snapshot must explain that Frigate is not configured");

  const invalidSnapshotResponse = await fetchWithTimeout("/api/frigate/snapshot?id=..%2Fprivate-camera");
  assert(invalidSnapshotResponse.status === 404, `invalid Camera Detection snapshot ID must return HTTP 404; received ${invalidSnapshotResponse.status}`);

  const dashboardResponse = await fetchWithTimeout("/dashboard.html");
  assert(dashboardResponse.ok, `live dashboard returned HTTP ${dashboardResponse.status}`);
  const dashboardHtml = await dashboardResponse.text();
  assert(dashboardHtml.includes("Auxora"), "live dashboard must serve embedded Auxora HTML");
  for (const path of standaloneFallbackPaths) {
    await assertStandaloneScriptPolicy(path);
  }
  console.log(`live CSP nonce coverage for ${standaloneFallbackPaths.length} standalone fallback pages: passed`);
  const sessionTokenMatch = dashboardHtml.match(/window\.XenonSessionToken\s*=\s*("(?:\\.|[^"\\])*")/);
  assert(sessionTokenMatch, "live dashboard must include an inline mutation session token");
  const sessionToken = JSON.parse(sessionTokenMatch[1]);
  const sessionHeaders = {
    "Content-Type": "application/json",
    Origin: hostUrl,
    "X-Xenon-Session": sessionToken
  };

  const rollbackResponse = await fetchWithTimeout("/api/releases/rollback", {
    method: "POST",
    headers: sessionHeaders,
    body: "{}"
  });
  assert(rollbackResponse.ok, `live rollback capability returned HTTP ${rollbackResponse.status}`);
  const rollback = await rollbackResponse.json();
  assert(rollback.supported === false && rollback.configured === false && rollback.status === "unavailable", `beta rollback capability must fail closed instead of advertising a current executable as rollback media: ${JSON.stringify(rollback)}`);
  for (const key of ["rollbackEnabled", "lastKnownGoodVersion", "lastKnownGoodPath", "lastKnownGoodPathConfigured"]) {
    assert(!(key in rollback), `beta rollback capability must omit unusable rollback metadata '${key}'`);
  }
  assert(/not included in this beta/i.test(rollback.message || ""), "beta rollback capability must explain the manual-only boundary");

  const displayResponse = await fetchWithTimeout("/api/display/diagnostics");
  assert(displayResponse.ok, `live display diagnostics returned HTTP ${displayResponse.status}`);
  const displayDiagnostics = await displayResponse.json();
  const companionDisplays = Array.isArray(displayDiagnostics.displays) ? displayDiagnostics.displays : [];
  assert(Number.isInteger(displayDiagnostics.activeDisplayCount), "display diagnostics must report the active Windows display count");
  assert(Number.isInteger(displayDiagnostics.companionDisplayCount), "display diagnostics must report the companion display count");
  assert(
    displayDiagnostics.companionDisplayCount === companionDisplays.length,
    "display diagnostics companion count must match the returned companion list"
  );
  assert(
    displayDiagnostics.edgeCandidateCount === displayDiagnostics.companionDisplayCount,
    "legacy edge candidate count must remain a companion-count alias"
  );
  assert(companionDisplays.every(display => display && display.primary !== true), "display diagnostics must never expose the Windows primary display as a candidate");

  const monitorControlsResponse = await fetchWithTimeout("/api/displays/controls", {}, 10000);
  assert(monitorControlsResponse.ok, `live display controls returned HTTP ${monitorControlsResponse.status}`);
  const monitorControls = await monitorControlsResponse.json();
  assert(monitorControls.primaryExcluded === true, "display controls must explicitly exclude the Windows primary display");
  assert(monitorControls.scope === "companion-only", `display controls must report companion-only scope: ${JSON.stringify(monitorControls)}`);
  assert(/primary display is intentionally excluded/i.test(monitorControls.message || ""), "display controls must explain the primary-display safety boundary");

  if (displayDiagnostics.companionDisplayCount === 0) {
    assert(
      displayDiagnostics.status === "waiting-for-companion-display",
      `zero companions must wait instead of becoming ready; received ${displayDiagnostics.status}`
    );
    assert(!displayDiagnostics.selectedDisplayId, "zero companions must not report a selected display");
  } else if (displayDiagnostics.companionDisplayCount === 1) {
    assert(displayDiagnostics.status === "ready", `one companion must be ready; received ${displayDiagnostics.status}`);
  }

  if (displayDiagnostics.status === "ready") {
    assert(displayDiagnostics.companionDisplayCount > 0, "ready display status requires at least one companion");
    assert(
      companionDisplays.some(display => display.id === displayDiagnostics.selectedDisplayId),
      "ready display status must identify an active returned companion"
    );
  }

  const staleDisplayId = "auxora-test-disconnected-display";
  const stalePreferenceResponse = await fetchWithTimeout("/api/display/preference", {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({ displayId: staleDisplayId })
  });
  const stalePreferencePayload = await stalePreferenceResponse.json();
  assert(stalePreferenceResponse.status === 400, `stale display preference must return HTTP 400; received ${stalePreferenceResponse.status}: ${stalePreferencePayload.error || "unknown error"}`);
  assert(/active|companion/i.test(stalePreferencePayload.error || ""), "stale display rejection must explain that an active companion is required");

  const staleDashboardResponse = await fetchWithTimeout("/api/config/dashboard", {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({ preferredDisplayId: staleDisplayId })
  });
  assert(staleDashboardResponse.status === 400, `stale dashboard display preference must return HTTP 400; received ${staleDashboardResponse.status}`);
  assert(/active|companion/i.test((await staleDashboardResponse.json()).error || ""), "dashboard update must reject a stale display with companion guidance");

  const systemResponse = await fetchWithTimeout("/api/system");
  assert(systemResponse.ok, `live /api/system returned HTTP ${systemResponse.status}`);
  const system = await systemResponse.json();
  assert(!Object.prototype.hasOwnProperty.call(system, "topProcesses"), "live /api/system must not expose running application or process identity");
  const primaryDisplayId = String(system && system.primaryDisplay && system.primaryDisplay.deviceName || "").trim();
  if (primaryDisplayId) {
    const primaryPreferenceResponse = await fetchWithTimeout("/api/display/preference", {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ displayId: primaryDisplayId })
    });
    assert(primaryPreferenceResponse.status === 400, `primary display preference must return HTTP 400; received ${primaryPreferenceResponse.status}`);
    assert(/primary display/i.test((await primaryPreferenceResponse.json()).error || ""), "primary display rejection must clearly name the primary-display rule");

    const primaryDashboardResponse = await fetchWithTimeout("/api/config/dashboard", {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ preferredDisplayId: primaryDisplayId })
    });
    assert(primaryDashboardResponse.status === 400, `primary dashboard display preference must return HTTP 400; received ${primaryDashboardResponse.status}`);
    assert(/primary display/i.test((await primaryDashboardResponse.json()).error || ""), "dashboard update must clearly reject the primary display");
  }

  const rejectedOrigin = await fetchWithTimeout("/api/health", { headers: { Origin: "https://example.test" } });
  assert(rejectedOrigin.status === 403, `foreign Origin must be rejected; received HTTP ${rejectedOrigin.status}`);

  const rejectedMutation = await fetchWithTimeout("/api/config/dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert(rejectedMutation.status === 403, `mutation without session token must be rejected; received HTTP ${rejectedMutation.status}`);

  placementResult = await stopWindowPlacementWatcher(placementWatcher);
  assert(placementResult.primaryFound === true, "window placement watcher must enumerate the Windows primary monitor bounds");
  assert(
    Number.isFinite(placementResult.effectiveIntervalMs) && placementResult.effectiveIntervalMs <= 5,
    `window placement watcher effective interval exceeded 5 ms: ${placementResult.effectiveIntervalMs}`
  );
  const placementViolations = Array.isArray(placementResult.violations) ? placementResult.violations : [];
  assert(
    placementViolations.length === 0,
    `Auxora exposed a window on the primary display, outside a companion display, or as the unsolicited foreground window: ${JSON.stringify(placementViolations)}`
  );
  if (displayDiagnostics.companionDisplayCount > 0) {
    assert(placementResult.visibleSampleCount > 0, "an available companion display must produce a visible Auxora window during stabilization");
  } else {
    assert(placementResult.visibleSampleCount === 0, "primary-only startup must keep every Auxora top-level window hidden");
  }

  const finalSupportResponse = await fetchWithTimeout("/api/support/bundle", {}, 5000);
  assert(finalSupportResponse.ok, `final support bundle returned HTTP ${finalSupportResponse.status}`);
  const finalSupportBundle = await finalSupportResponse.json();
  const finalHostLog = Array.isArray(finalSupportBundle.log) ? finalSupportBundle.log.join("\n") : "";
  const finalDashboardLoads = (finalHostLog.match(/Dashboard loaded successfully\./g) || []).length;
  const expectedDashboardLoads = displayDiagnostics.companionDisplayCount > 0 ? 1 : 0;
  assert(
    finalDashboardLoads === expectedDashboardLoads,
    `display recovery must preserve the companion-only embedded dashboard policy; expected ${expectedDashboardLoads} load(s), observed ${finalDashboardLoads}`
  );
  assert(
    !/WebView2 initialization failed|Failed to load dashboard after bridge ready/.test(finalHostLog),
    `display recovery produced a false WebView2 startup failure: ${finalHostLog}`
  );

  console.log(`launched native host and verified live health, companion-only display diagnostics, preference rejection, and ${placementResult.sampleCount} HWND placement samples at ${placementResult.effectiveIntervalMs} ms effective intervals; primary=${JSON.stringify(placementResult.primary)}; visibleWindows=${JSON.stringify(placementResult.observedWindows)}`);
} finally {
  if (!placementResult) {
    try {
      await stopWindowPlacementWatcher(placementWatcher);
    } catch {
    }
  }
  await stopChild(child);
  rmSync(profileRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
