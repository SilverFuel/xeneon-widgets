import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const baseUrl = "http://127.0.0.1:8976";
const hostExecutable = resolve(repoRoot, "app/bin/x64/Release/net8.0-windows10.0.19041.0/win-x64/XenonEdgeHost.exe");
const edgeCandidates = [
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.LOCALAPPDATA || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe")
];
const browserExecutable = edgeCandidates.find(path => path && existsSync(path));
const viewports = [
  { name: "compact", width: 1280, height: 400, expected: "ultrawide" },
  { name: "standard", width: 1440, height: 900, expected: "standard" },
  { name: "ultrawide", width: 2560, height: 720, expected: "ultrawide" },
  { name: "portrait", width: 800, height: 1280, expected: "portrait" }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
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
  assert(port > 0, "could not reserve a local browser debugging port");
  return port;
}

async function hostAlreadyRunning() {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHost(child) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`native host exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await delay(400);
  }
  throw new Error("native host did not become healthy within 45 seconds");
}

async function waitForBrowser(debugPort, child) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/version`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`browser exited with code ${child.exitCode}`);
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Browser debugging endpoint is still starting.
    }
    await delay(250);
  }
  throw new Error("browser debugging endpoint did not start within 30 seconds");
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 10000
    });
  } else {
    child.kill();
  }
  await Promise.race([
    new Promise(resolveExit => child.once("exit", resolveExit)),
    delay(5000)
  ]);
  assert(child.exitCode !== null, `process tree ${child.pid} did not terminate`);
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => rejectOpen(new Error("CDP WebSocket open timed out")), 10000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolveOpen();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      rejectOpen(new Error("CDP WebSocket failed to open"));
    }, { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message || "CDP command failed"));
    else request.resolve(message.result || {});
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    }
  };
}

async function waitForProbe(cdp, viewport) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const evaluated = await cdp.send("Runtime.evaluate", {
      expression: "document.querySelector('#auxora-rendered-test-result')?.textContent || ''",
      returnByValue: true
    });
    const text = evaluated.result?.value || "";
    if (text) return JSON.parse(text);
    await delay(250);
  }
  throw new Error(`${viewport.name}: rendered result marker was not emitted within 25 seconds`);
}

function validateProbe(probe, viewport) {
  const geometry = JSON.stringify({ viewport: probe.viewport, shell: probe.shell, navigation: probe.navigation, viewer: probe.viewer });
  assert(probe.layoutClass === viewport.expected, `${viewport.name}: expected ${viewport.expected}, got ${probe.layoutClass}`);
  assert(probe.shellHorizontallyInBounds, `${viewport.name}: dashboard shell escaped horizontally: ${geometry}`);
  assert(probe.navigationHorizontallyInBounds, `${viewport.name}: primary navigation escaped horizontally: ${geometry}`);
  assert(probe.viewerHorizontallyInBounds, `${viewport.name}: viewer escaped horizontally: ${geometry}`);
  assert(!probe.horizontalOverflow, `${viewport.name}: document has horizontal overflow`);
  assert(!probe.navigationViewerOverlap, `${viewport.name}: primary navigation overlaps the viewer`);
  assert(probe.keyboardFocus, `${viewport.name}: primary navigation could not receive keyboard focus`);
  assert(probe.keyboardActivation, `${viewport.name}: focused Settings navigation did not activate`);
  assert(probe.visibleControlCount > 0, `${viewport.name}: no visible interactive controls were rendered`);
  assert(probe.undersizedControls.length === 0, `${viewport.name}: controls below 32px: ${probe.undersizedControls.join(", ")}`);
  assert(probe.unnamedControls.length === 0, `${viewport.name}: unnamed controls: ${probe.unnamedControls.join(", ")}`);
}

assert(process.platform === "win32", "rendered dashboard test requires Windows");
assert(hostExecutable, "Release native host is missing; build app/XenonEdgeHost.sln first");
assert(browserExecutable, "System Edge or Chrome is required for rendered dashboard testing");
assert(typeof WebSocket === "function", "Node.js with built-in WebSocket support is required");
assert(!(await hostAlreadyRunning()), "port 8976 is already in use; refusing to inspect an unrelated host");

const profileRoot = mkdtempSync(join(tmpdir(), "auxora-rendered-dashboard-"));
const roaming = join(profileRoot, "Roaming");
const local = join(profileRoot, "Local");
const browserProfile = join(profileRoot, "browser");
mkdirSync(roaming, { recursive: true });
mkdirSync(local, { recursive: true });
const debugPort = await reserveLocalPort();
const host = spawn(hostExecutable, ["--safe-mode"], {
  cwd: resolve(repoRoot, "app"),
  env: { ...process.env, APPDATA: roaming, LOCALAPPDATA: local, TEMP: profileRoot, TMP: profileRoot },
  stdio: "ignore",
  windowsHide: true
});
let browser;

try {
  await waitForHost(host);
  browser = spawn(browserExecutable, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-extensions",
    "--disable-gpu",
    "--disable-sync",
    "--no-first-run",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfile}`,
    "about:blank"
  ], { stdio: "ignore", windowsHide: true });
  await waitForBrowser(debugPort, browser);
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  assert(targetResponse.ok, `browser target creation failed with HTTP ${targetResponse.status}`);
  const target = await targetResponse.json();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    for (const viewport of viewports) {
      await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=privacy&renderedTest=1` });
      const probe = await waitForProbe(cdp, viewport);
      validateProbe(probe, viewport);
      console.log(`rendered ${viewport.name} ${viewport.width}x${viewport.height}: passed`);
    }
    const resetEvaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const response = await fetch('/api/config/reset', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Xenon-Session': window.XenonSessionToken
          },
          body: '{}'
        });
        return { status: response.status, receipt: await response.json() };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const resetResult = resetEvaluation.result?.value;
    const webViewStep = resetResult?.receipt?.steps?.find(step => step.id === "webview-data");
    assert(resetResult?.status === 200 && resetResult?.receipt?.ok === true, "initialized-host reset must complete successfully");
    assert(webViewStep?.status === "cleared", `initialized WebView reset was not cleared: ${JSON.stringify(webViewStep || null)}`);
    console.log("initialized WebView browsing data reset: passed");
  } finally {
    cdp.close();
  }
  console.log(`launched isolated native host and checked rendered DOM geometry, focus, activation, touch targets, and names at ${viewports.length} viewports`);
} finally {
  await stopProcessTree(browser);
  await stopProcessTree(host);
  rmSync(profileRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
