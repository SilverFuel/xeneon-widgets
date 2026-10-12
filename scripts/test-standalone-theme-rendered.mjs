import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import {
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const settingsStorageKey = "xeneon-dashboard-settings";
const standalonePages = [
  "hosted-dashboard.html",
  "index.html",
  "refund-policy.html",
  "support.html",
  "widgets/audio-output-panel.html",
  "widgets/calendar-widget.html",
  "widgets/clock-widget.html",
  "widgets/frigate-detection-panel.html",
  "widgets/home-automation-panel.html",
  "widgets/media-widget.html",
  "widgets/nas-storage-monitor.html",
  "widgets/network-widget.html",
  "widgets/philips-hue-panel.html",
  "widgets/plex-server-monitor.html",
  "widgets/setup-guide.html",
  "widgets/system-monitor.html",
  "widgets/unifi-camera-viewer.html",
  "widgets/unifi-network-dashboard.html",
  "widgets/weather-widget.html"
];
const viewports = [
  { name: "compact", width: 800, height: 480 },
  { name: "companion", width: 2560, height: 720 }
];
const themeIds = ["focus", "gaming", "warm"];
const variants = ["standard", "night"];
const requiredThemeTokens = [
  "--theme-page",
  "--theme-surface-primary",
  "--theme-surface-secondary",
  "--theme-surface-elevated",
  "--theme-surface-muted",
  "--theme-border",
  "--theme-border-strong",
  "--theme-text",
  "--theme-text-muted",
  "--theme-accent",
  "--theme-accent-text",
  "--theme-accent-secondary",
  "--theme-on-accent",
  "--theme-accent-soft",
  "--theme-accent-border",
  "--theme-accent-glow",
  "--theme-selected-surface",
  "--theme-focus-ring",
  "--theme-panel-shadow",
  "--theme-panel-radius",
  "--font-ui",
  "--status-success-text",
  "--status-warning-text",
  "--status-danger-text"
];
const legacyAliasMap = {
  "--bg": "--theme-page",
  "--fg": "--theme-text",
  "--text": "--theme-text",
  "--muted": "--theme-text-muted",
  "--panel": "--theme-surface-primary",
  "--panel-2": "--theme-surface-elevated",
  "--panel-soft": "--theme-surface-muted",
  "--panel-strong": "--theme-surface-elevated",
  "--surface": "--theme-surface-primary",
  "--surface-strong": "--theme-surface-elevated",
  "--border": "--theme-border",
  "--line": "--theme-border",
  "--accent": "--theme-accent",
  "--accent-2": "--theme-accent-secondary",
  "--chip": "--theme-selected-surface",
  "--good": "--status-success-text",
  "--warn": "--status-warning-text",
  "--danger": "--status-danger-text",
  "--shadow": "--theme-panel-shadow",
  "--radius": "--theme-panel-radius",
  "--font": "--font-ui",
  "--scene-a": "--theme-accent-border",
  "--scene-b": "--theme-ambient-secondary",
  "--scene-c": "--theme-ambient-rim"
};
const nativeConfigFixture = {
  dashboard: {
    themeId: "gaming",
    accentMode: "preset",
    customAccentColor: "",
    themeVariant: "night",
    performanceBudget: "max",
    themeReadability: "clean",
    animationIntensity: "64"
  },
  weather: { configured: false },
  frigate: { configured: false },
  hue: { linked: false }
};
const setupHealthFixture = {
  ok: true,
  setup: {
    essentialsReady: false,
    onboardingCompleted: false,
    onboardingCompletedAt: "",
    onboardingVersion: 1,
    needsAttention: true,
    items: {
      bridge: { id: "bridge", label: "Local app service", state: "Ready", required: true, nextStep: "Local test service is available." },
      display: { id: "display", label: "Auxora companion display", state: "Needs Setup", required: true, nextStep: "Choose a companion display." },
      provisioning: { id: "provisioning", label: "Auto provisioning", state: "Ready", required: true, nextStep: "Safe defaults are ready." },
      system: { id: "system", label: "System Monitor", state: "Ready", required: true, nextStep: "Native system telemetry is available." },
      network: { id: "network", label: "Network Monitor", state: "Ready", required: true, nextStep: "Native network telemetry is available." },
      weather: { id: "weather", label: "Weather", state: "Optional", required: false, nextStep: "Add an API key only if wanted." },
      hue: { id: "hue", label: "Philips Hue", state: "Optional", required: false, nextStep: "Add a bridge only if wanted." },
      calendar: { id: "calendar", label: "Calendar", state: "Optional", required: false, nextStep: "Add a calendar feed only if wanted." },
      unifi: { id: "unifi", label: "UniFi Network", state: "Optional", required: false, nextStep: "Link UniFi only if wanted." },
      frigate: { id: "frigate", label: "Camera Detection", state: "Optional", required: false, nextStep: "Add Frigate only if wanted." }
    }
  }
};
const hueFixture = {
  linked: false,
  bridgeIp: "",
  lights: [],
  message: "Press the physical bridge button before linking."
};
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

let baseUrl = "";
let browser;
let cdp;
let server;
let profileRoot = "";
let cleanupPromise;
let readBrowserDiagnostics = () => "browser diagnostics are unavailable";
let navigationSequence = 0;
let configRequestCount = 0;
let interceptionFailure = null;
let currentNavigationLabel = "browser startup";
const blockedExternalUrls = new Set();
const runtimeExceptions = [];
const staticResourceFailures = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function captureBrowserOutput(child, executable) {
  const maximumCharacters = 32768;
  let output = "";
  const append = (label, chunk) => {
    output += `[${label}] ${String(chunk)}`;
    if (output.length > maximumCharacters) {
      output = output.slice(-maximumCharacters);
    }
  };
  child.stdout?.on("data", chunk => append("stdout", chunk));
  child.stderr?.on("data", chunk => append("stderr", chunk));
  return () => {
    const status = child.exitCode !== null
      ? `exited with code ${child.exitCode}`
      : child.signalCode
        ? `exited from signal ${child.signalCode}`
        : `is still running as PID ${child.pid}`;
    return `${executable} ${status}${output.trim() ? `\n${output.trim()}` : "\n(no browser output captured)"}`;
  };
}

function isContainedPath(rootPath, candidatePath) {
  const pathFromRoot = relative(rootPath, candidatePath);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function writeResponse(response, statusCode, contentType, body) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self' data: blob:; base-uri 'none'; connect-src 'self'; font-src 'self' data:; form-action 'none'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function recordStaticResourceFailure(pathname, statusCode) {
  if (!pathname.startsWith("/api/") && pathname !== "/favicon.ico") {
    staticResourceFailures.push({ label: currentNavigationLabel, pathname, statusCode });
  }
}

function serveRequest(request, response) {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (requestUrl.hostname !== "127.0.0.1") {
    writeResponse(response, 400, "text/plain; charset=utf-8", "Invalid host");
    return;
  }

  if (requestUrl.pathname === "/api/config") {
    configRequestCount += 1;
    writeResponse(response, 200, "application/json; charset=utf-8", JSON.stringify(nativeConfigFixture));
    return;
  }
  if (requestUrl.pathname === "/api/health") {
    writeResponse(response, 200, "application/json; charset=utf-8", JSON.stringify(setupHealthFixture));
    return;
  }
  if (requestUrl.pathname === "/api/hue") {
    writeResponse(response, 200, "application/json; charset=utf-8", JSON.stringify(hueFixture));
    return;
  }
  if (requestUrl.pathname.startsWith("/api/")) {
    writeResponse(response, 404, "application/json; charset=utf-8", JSON.stringify({ status: "unavailable" }));
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    writeResponse(response, 405, "text/plain; charset=utf-8", "Method not allowed");
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestUrl.pathname).replaceAll("\\", "/");
  } catch {
    writeResponse(response, 400, "text/plain; charset=utf-8", "Invalid path");
    return;
  }
  if (decodedPath.includes("\0")) {
    writeResponse(response, 400, "text/plain; charset=utf-8", "Invalid path");
    return;
  }

  const relativePath = decodedPath.replace(/^\/+/, "");
  const unresolvedPath = resolve(repoRoot, relativePath || "index.html");
  if (!isContainedPath(repoRoot, unresolvedPath) || !existsSync(unresolvedPath)) {
    recordStaticResourceFailure(requestUrl.pathname, 404);
    writeResponse(response, 404, "text/plain; charset=utf-8", "Not found");
    return;
  }

  let filePath;
  try {
    filePath = realpathSync(unresolvedPath);
  } catch {
    recordStaticResourceFailure(requestUrl.pathname, 404);
    writeResponse(response, 404, "text/plain; charset=utf-8", "Not found");
    return;
  }
  if (!isContainedPath(repoRoot, filePath) || !statSync(filePath).isFile()) {
    recordStaticResourceFailure(requestUrl.pathname, 404);
    writeResponse(response, 404, "text/plain; charset=utf-8", "Not found");
    return;
  }

  const contentType = contentTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream";
  const body = request.method === "HEAD" ? undefined : readFileSync(filePath);
  writeResponse(response, 200, contentType, body);
}

async function startServer() {
  server = createServer((request, response) => {
    try {
      serveRequest(request, response);
    } catch (error) {
      let failedPathname = "/";
      try {
        failedPathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      } catch {
        // Keep the fail-closed root label for a malformed request URL.
      }
      recordStaticResourceFailure(failedPathname, 500);
      if (!response.headersSent) {
        writeResponse(response, 500, "text/plain; charset=utf-8", "Server error");
      } else {
        response.destroy(error);
      }
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === "object" && address.address === "127.0.0.1", "standalone test server did not bind to 127.0.0.1");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function findBrowserExecutable() {
  const explicit = process.env.AUXORA_BROWSER_PATH || "";
  const candidates = [
    explicit,
    join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env.LOCALAPPDATA || "", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] || "", "Google/Chrome/Application/chrome.exe"),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const directMatch = candidates.find(candidate => existsSync(candidate));
  if (directMatch) {
    return directMatch;
  }

  const locator = process.platform === "win32" ? "where.exe" : "which";
  for (const command of ["msedge", "microsoft-edge", "google-chrome", "chrome", "chromium"]) {
    const located = spawnSync(locator, [command], { encoding: "utf8", windowsHide: true });
    if (located.status === 0) {
      const firstPath = String(located.stdout || "").split(/\r?\n/).map(value => value.trim()).find(Boolean);
      if (firstPath && existsSync(firstPath)) {
        return firstPath;
      }
    }
  }
  return "";
}

async function readOwnedBrowserEndpoint(profileDirectory) {
  const activePortPath = join(profileDirectory, "DevToolsActivePort");
  try {
    const [portText, browserPath] = readFileSync(activePortPath, "utf8").trim().split(/\r?\n/);
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[a-z0-9-]+$/i.test(browserPath || "")) {
      return null;
    }
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return null;
    const version = await response.json();
    const webSocketUrl = `ws://127.0.0.1:${port}${browserPath}`;
    // Match the random browser identity as well as the port from our new profile.
    // Never close a reused port belonging to another browser during cleanup.
    return version.webSocketDebuggerUrl === webSocketUrl ? { port, webSocketUrl } : null;
  } catch {
    return null;
  }
}

async function waitForBrowser(profileDirectory, child, diagnostics, testClock = {}) {
  const now = testClock.now || Date.now;
  const pause = testClock.delay || delay;
  const endpointFor = testClock.readEndpoint || readOwnedBrowserEndpoint;
  const deadline = now() + 30000;
  while (now() < deadline) {
    if ((child.exitCode !== null && child.exitCode !== 0) || child.signalCode) {
      throw new Error(`headless browser exited before its debugging endpoint was ready:\n${diagnostics()}`);
    }
    // Edge can exit its launcher successfully after a compatibility-layer
    // relaunch. Readiness belongs to the isolated profile, not the launcher PID.
    const endpoint = await endpointFor(profileDirectory);
    if (endpoint) return endpoint.port;
    await pause(100);
  }
  throw new Error(`headless browser debugging endpoint did not start within 30 seconds:\n${diagnostics()}`);
}

async function checkBrowserLifecycle() {
  for (const exitCode of [null, 0]) {
    let clock = 0;
    let reads = 0;
    const port = await waitForBrowser("fixture-profile", { exitCode, signalCode: null }, () => "fixture", {
      now: () => clock,
      delay: async milliseconds => { clock += milliseconds; },
      readEndpoint: async () => ++reads === 2 ? { port: 12345 } : null
    });
    assert(port === 12345 && reads === 2, `browser readiness must survive launcher exit ${exitCode}`);
  }
  for (const child of [{ exitCode: 1, signalCode: null }, { exitCode: null, signalCode: "SIGTERM" }, { exitCode: 0, signalCode: null }]) {
    let clock = 0;
    let failure;
    try {
      await waitForBrowser("fixture-profile", child, () => "fixture", {
        now: () => clock,
        delay: async milliseconds => { clock += milliseconds; },
        readEndpoint: async () => null
      });
    } catch (error) {
      failure = error;
    }
    assert(failure && (child.exitCode === 0 ? /within 30 seconds/.test(failure.message) && clock === 30000 : /exited before/.test(failure.message) && clock === 0), "browser abnormal exit and startup timeout must fail closed");
  }
  console.log("headless browser lifecycle: live launcher, clean handoff, abnormal exit, signal, and timeout passed");
}

async function closeOwnedBrowser(profileDirectory, requireEndpoint) {
  const endpoint = await readOwnedBrowserEndpoint(profileDirectory);
  if (!endpoint) {
    assert(!requireEndpoint, `browser launcher handed off without a reachable owned endpoint; preserving profile: ${profileDirectory}`);
    return;
  }
  const connection = await connectCdp(endpoint.webSocketUrl, readBrowserDiagnostics);
  try {
    await connection.send("Browser.close");
  } catch {
    // A successful close may disconnect before its response arrives.
  } finally {
    connection.close();
  }
  const deadline = Date.now() + 5000;
  while (await readOwnedBrowserEndpoint(profileDirectory)) {
    assert(Date.now() < deadline, "owned headless browser endpoint did not close");
    await delay(100);
  }
}

async function connectCdp(webSocketUrl, diagnostics) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const handlers = new Map();
  let nextId = 1;
  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error("CDP WebSocket open timed out")), 10000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolveOpen();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      rejectOpen(new Error("CDP WebSocket failed to open"));
    }, { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(new Error(`CDP command ${request.method} failed: ${message.error.message || "protocol error"}`));
      } else {
        request.resolve(message.result || {});
      }
      return;
    }
    if (!message.method) {
      return;
    }
    for (const handler of handlers.get(message.method) || []) {
      try {
        handler(message.params || {});
      } catch (error) {
        interceptionFailure ||= error;
      }
    }
  });
  socket.addEventListener("close", event => {
    const closeDetail = `code ${event.code}${event.reason ? ` (${event.reason})` : ""}`;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`CDP WebSocket closed with ${closeDetail} before CDP command ${request.method} completed:\n${diagnostics()}`));
    }
    pending.clear();
  });

  return {
    send(method, params = {}) {
      if (socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error(`CDP command ${method} cannot run because the WebSocket is not open`));
      }
      const id = nextId++;
      return new Promise((resolveCommand, rejectCommand) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectCommand(new Error(`CDP command ${method} timed out`));
        }, 15000);
        pending.set(id, { method, resolve: resolveCommand, reject: rejectCommand, timer });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          rejectCommand(new Error(`CDP command ${method} could not be sent: ${error.message}`));
        }
      });
    },
    on(method, handler) {
      if (!handlers.has(method)) {
        handlers.set(method, new Set());
      }
      handlers.get(method).add(handler);
    },
    close() {
      socket.close();
    }
  };
}

async function stopProcessTree(child) {
  const terminated = () => !child || child.exitCode !== null || child.signalCode !== null;
  if (terminated()) {
    return;
  }
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 10000,
      windowsHide: true
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await Promise.race([
    new Promise(resolveExit => child.once("exit", resolveExit)),
    delay(5000)
  ]);
  if (!terminated() && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await Promise.race([
      new Promise(resolveExit => child.once("exit", resolveExit)),
      delay(2000)
    ]);
  }
  assert(terminated(), `headless browser process tree ${child.pid} did not terminate`);
}

async function closeServer() {
  if (!server) {
    return;
  }
  const activeServer = server;
  server = undefined;
  if (!activeServer.listening) {
    activeServer.closeAllConnections?.();
    return;
  }
  await new Promise((resolveClose, rejectClose) => {
    activeServer.close(error => error ? rejectClose(error) : resolveClose());
    activeServer.closeAllConnections?.();
  });
}

async function cleanup() {
  if (cleanupPromise) {
    return cleanupPromise;
  }
  cleanupPromise = (async () => {
    const cleanupErrors = [];
    let ownedBrowserStopped = true;
    const browserWasConnected = Boolean(cdp);
    if (cdp) {
      try {
        await cdp.send("Browser.close");
      } catch {
        // Closing the browser commonly closes CDP before acknowledging.
      }
      cdp.close();
      cdp = undefined;
    }
    try {
      await stopProcessTree(browser);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (profileRoot) {
      try {
        assert(isContainedPath(tmpdir(), profileRoot) && relative(tmpdir(), profileRoot).startsWith("auxora-standalone-theme-rendered-"), "refusing cleanup outside the isolated standalone browser profile");
        await closeOwnedBrowser(join(profileRoot, "browser"), !browserWasConnected && browser?.exitCode === 0);
      } catch (error) {
        ownedBrowserStopped = false;
        cleanupErrors.push(error);
      }
    }
    browser = undefined;
    try {
      await closeServer();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (profileRoot && ownedBrowserStopped) {
      const profileToRemove = profileRoot;
      try {
        await delay(250);
        rmSync(profileToRemove, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
        assert(!existsSync(profileToRemove), `isolated browser profile was not removed: ${profileToRemove}`);
        profileRoot = "";
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "standalone rendered test cleanup did not complete");
    }
  })();
  return cleanupPromise;
}

async function evaluate(expression, awaitPromise = false) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "browser evaluation failed");
  }
  return response.result?.value;
}

async function evaluateFunction(browserFunction, ...args) {
  return evaluate(`(${browserFunction.toString()})(${args.map(value => JSON.stringify(value)).join(",")})`, true);
}

async function waitForCondition(expression, label, timeoutMilliseconds = 10000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) {
      return;
    }
    await delay(50);
  }
  throw new Error(`${label} did not become ready within ${timeoutMilliseconds}ms`);
}

async function setViewport(viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false
  });
}

async function setMedia({ forcedColors = "none", reducedMotion = "no-preference" } = {}) {
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "forced-colors", value: forcedColors },
      { name: "prefers-reduced-motion", value: reducedMotion }
    ]
  });
}

async function navigateSeeded(page, settings, label) {
  assert(standalonePages.includes(page), `${page} is not in the exact standalone page inventory`);
  currentNavigationLabel = label;
  const exceptionStart = runtimeExceptions.length;
  const resourceFailureStart = staticResourceFailures.length;
  await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  const serializedSettings = JSON.stringify(settings || {});
  const injection = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => { if (location.origin === ${JSON.stringify(baseUrl)}) localStorage.setItem(${JSON.stringify(settingsStorageKey)}, ${JSON.stringify(serializedSettings)}); })();`
  });
  const marker = `standaloneThemeRendered=${++navigationSequence}`;
  const separator = page.includes("?") ? "&" : "?";
  const url = `${baseUrl}/${page}${separator}${marker}`;
  let navigationFailure;
  try {
    await cdp.send("Page.navigate", { url });
    await waitForCondition(
      `location.href.includes(${JSON.stringify(marker)}) && document.readyState === "complete"`,
      label
    );
  } catch (error) {
    navigationFailure = error;
    throw error;
  } finally {
    if (injection.identifier) {
      try {
        await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
      } catch (cleanupError) {
        if (!navigationFailure) {
          throw cleanupError;
        }
        console.warn(`${label}: preserving navigation failure; script-removal cleanup also failed: ${cleanupError.message}`);
      }
    }
  }
  await waitForCondition("document.documentElement.hasAttribute('data-standalone-ui') && Boolean(document.body)", `${label} standalone bootstrap`);
  await delay(120);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
  assert(!interceptionFailure, `request interception failed: ${interceptionFailure?.message || interceptionFailure}`);
  const navigationExceptions = runtimeExceptions.slice(exceptionStart);
  const navigationResourceFailures = staticResourceFailures.slice(resourceFailureStart);
  assert(navigationExceptions.length === 0, `${label}: uncaught runtime exceptions: ${JSON.stringify(navigationExceptions)}`);
  assert(navigationResourceFailures.length === 0, `${label}: essential same-origin resources failed: ${JSON.stringify(navigationResourceFailures)}`);
}

function browserProbeThemeState(tokens, aliases) {
  const root = document.documentElement;
  const body = document.body;
  const normalize = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const read = (node, name) => normalize(getComputedStyle(node).getPropertyValue(name));
  const tokenValues = Object.fromEntries(tokens.map(name => [name, read(root, name)]));
  const bodyTokenValues = Object.fromEntries(tokens.map(name => [name, read(body, name)]));
  const missingTokens = tokens.filter(name => !tokenValues[name] || !bodyTokenValues[name]);
  const aliasMismatches = [];
  for (const [alias, canonical] of Object.entries(aliases)) {
    for (const [label, node] of [["root", root], ["body", body]]) {
      const aliasValue = read(node, alias);
      const canonicalValue = read(node, canonical);
      if (!aliasValue || aliasValue !== canonicalValue) {
        aliasMismatches.push({ label, alias, canonical, aliasValue, canonicalValue });
      }
    }
  }
  const variantValues = {
    motionScale: read(root, "--theme-motion-scale"),
    motionDuration: read(root, "--theme-motion-duration"),
    glowIntensity: read(root, "--theme-glow-intensity"),
    nightBrightness: read(root, "--theme-night-brightness"),
    nightGlow: read(root, "--theme-night-glow"),
    panelShadow: read(root, "--theme-panel-shadow"),
    bodyBackgroundImage: normalize(getComputedStyle(body).backgroundImage)
  };
  return {
    rootMarker: root.hasAttribute("data-standalone-ui"),
    rootTheme: root.getAttribute("data-theme") || "",
    bodyTheme: body?.getAttribute("data-theme") || "",
    rootVariant: root.getAttribute("data-theme-variant") || "",
    bodyVariant: body?.getAttribute("data-theme-variant") || "",
    missingTokens,
    aliasMismatches,
    variantValues,
    variantSignature: Object.values(variantValues).join("|"),
    signature: ["--theme-page", "--theme-surface-primary", "--theme-accent", "--theme-focus-ring"]
      .map(name => tokenValues[name])
      .join("|")
  };
}

async function probeThemeState(themeId, variant, label) {
  await waitForCondition(
    `document.documentElement.dataset.theme === ${JSON.stringify(themeId)} && document.documentElement.dataset.themeVariant === ${JSON.stringify(variant)} && document.body?.dataset.theme === ${JSON.stringify(themeId)} && document.body?.dataset.themeVariant === ${JSON.stringify(variant)}`,
    `${label} theme state`
  );
  await delay(80);
  const probe = await evaluateFunction(browserProbeThemeState, requiredThemeTokens, legacyAliasMap);
  assert(probe.rootMarker, `${label}: standalone root marker is missing`);
  assert(probe.rootTheme === themeId && probe.bodyTheme === themeId, `${label}: ${themeId} did not propagate to root and body: ${JSON.stringify(probe)}`);
  assert(probe.rootVariant === variant && probe.bodyVariant === variant, `${label}: ${variant} did not propagate to root and body: ${JSON.stringify(probe)}`);
  assert(probe.missingTokens.length === 0, `${label}: semantic theme tokens are missing: ${probe.missingTokens.join(", ")}`);
  assert(probe.aliasMismatches.length === 0, `${label}: legacy aliases did not resolve to semantic tokens: ${JSON.stringify(probe.aliasMismatches)}`);
  return probe;
}

async function browserAuditStandalonePage() {
  const interactiveSelector = [
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='link']",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']"
  ].join(",");
  const clippingOverflow = new Set(["auto", "clip", "hidden", "overlay", "scroll"]);
  const nextFrame = () => new Promise(resolveFrame => requestAnimationFrame(() => resolveFrame()));
  const visible = element => {
    if (!element || !element.isConnected || element.closest("[hidden], [aria-hidden='true'], [inert]")) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.contentVisibility === "hidden" || Number.parseFloat(style.opacity || "1") <= 0) {
        return false;
      }
    }
    return true;
  };
  const renderedText = element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      const value = walker.currentNode.textContent?.trim() || "";
      if (value && parent && !parent.closest("svg, [aria-hidden='true']") && visible(parent)) {
        parts.push(value);
      }
    }
    return parts.join(" ").trim();
  };
  const labelledByText = element => String(element.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent?.trim() || "")
    .filter(Boolean)
    .join(" ");
  const associatedLabelText = element => Array.from(element.labels || [])
    .map(label => renderedText(label))
    .filter(Boolean)
    .join(" ");
  const accessibleName = element => {
    const type = String(element.getAttribute("type") || "").toLowerCase();
    const inputValueName = element.tagName === "INPUT" && ["button", "reset", "submit"].includes(type)
      ? String(element.value || "").trim()
      : "";
    return String(element.getAttribute("aria-label") || "").trim()
      || labelledByText(element)
      || associatedLabelText(element)
      || renderedText(element)
      || String(element.getAttribute("title") || "").trim()
      || String(element.getAttribute("alt") || "").trim()
      || inputValueName;
  };
  const describe = element => accessibleName(element)
    || element.id
    || element.getAttribute("name")
    || `${element.tagName.toLowerCase()}${element.className ? "." + String(element.className).trim().replace(/\s+/g, ".") : ""}`;
  const contains = (container, target, axes = { x: true, y: true }) => Boolean(container && target
    && (!axes.x || (target.left >= container.left - 1 && target.right <= container.right + 1))
    && (!axes.y || (target.top >= container.top - 1 && target.bottom <= container.bottom + 1)));
  const effectiveTargetSize = element => {
    const rect = element.getBoundingClientRect();
    const label = (element.labels && element.labels[0]) || element.closest("label");
    const labelRect = label ? label.getBoundingClientRect() : null;
    return {
      width: Math.max(rect.width, labelRect ? labelRect.width : 0),
      height: Math.max(rect.height, labelRect ? labelRect.height : 0)
    };
  };

  const controls = Array.from(document.querySelectorAll(interactiveSelector)).filter(visible);
  const unnamedControls = controls.filter(control => !accessibleName(control)).map(describe);
  const enabledControls = controls.filter(control => !control.matches(":disabled")
    && control.getAttribute("aria-disabled") !== "true"
    && !control.closest("[inert]"));
  const unfocusableControls = enabledControls.filter(control => control.tabIndex < 0).map(describe);
  const undersizedControls = controls.filter(control => {
    if (control.hasAttribute("data-touch-size-exempt")) {
      return false;
    }
    const size = effectiveTargetSize(control);
    return size.width < 44 || size.height < 44;
  }).map(control => ({ control: describe(control), ...effectiveTargetSize(control) }));
  const focusFailures = [];
  for (const control of enabledControls) {
    let focusError = "";
    try {
      control.focus();
      control.scrollIntoView({ block: "nearest", inline: "nearest" });
      await nextFrame();
    } catch (error) {
      focusError = String(error?.message || error || "focus failed");
    }
    const rect = control.getBoundingClientRect();
    const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const clippingAncestors = [];
    for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const clipsX = clippingOverflow.has(style.overflowX);
      const clipsY = clippingOverflow.has(style.overflowY);
      if (!clipsX && !clipsY) {
        continue;
      }
      const ancestorRect = ancestor.getBoundingClientRect();
      clippingAncestors.push({
        element: ancestor.id || ancestor.className || ancestor.tagName,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        rect: {
          left: ancestorRect.left,
          top: ancestorRect.top,
          right: ancestorRect.right,
          bottom: ancestorRect.bottom,
          width: ancestorRect.width,
          height: ancestorRect.height
        },
        scroll: {
          left: ancestor.scrollLeft,
          top: ancestor.scrollTop,
          width: ancestor.scrollWidth,
          height: ancestor.scrollHeight,
          clientWidth: ancestor.clientWidth,
          clientHeight: ancestor.clientHeight
        },
        contained: contains(ancestorRect, rect, { x: clipsX, y: clipsY })
      });
    }
    if (focusError || !control.isConnected || document.activeElement !== control || !contains(viewport, rect) || clippingAncestors.some(ancestor => !ancestor.contained)) {
      focusFailures.push({
        control: describe(control),
        focusError,
        connected: control.isConnected,
        active: document.activeElement === control,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        viewportContained: contains(viewport, rect),
        clippingAncestors
      });
    }
  }

  const textParents = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    const value = walker.currentNode.textContent?.trim() || "";
    if (!value || !parent || parent.closest("script, style, noscript, template, svg, [aria-hidden='true']") || ["OPTION"].includes(parent.tagName) || !visible(parent)) {
      continue;
    }
    textParents.add(parent);
  }
  const undersizedText = Array.from(textParents).filter(element => Number.parseFloat(getComputedStyle(element).fontSize) < 12)
    .map(element => `${describe(element)}@${getComputedStyle(element).fontSize}:${renderedText(element).slice(0, 80)}`);
  for (const control of controls) {
    const type = String(control.getAttribute("type") || "").toLowerCase();
    const hasControlText = renderedText(control)
      || control.tagName === "TEXTAREA"
      || control.tagName === "SELECT"
      || (control.tagName === "INPUT" && !["checkbox", "color", "radio", "range"].includes(type)
        && Boolean(control.value || control.getAttribute("placeholder")));
    if (hasControlText && Number.parseFloat(getComputedStyle(control).fontSize) < 12) {
      undersizedText.push(`${describe(control)}@${getComputedStyle(control).fontSize}`);
    }
  }

  const clippedTextControls = controls.filter(control => control.matches("button, a[href], summary")
    && renderedText(control)
    && control.clientWidth > 0
    && control.clientHeight > 0
    && (control.scrollWidth > control.clientWidth + 1 || control.scrollHeight > control.clientHeight + 1))
    .map(control => ({
      control: describe(control),
      clientWidth: control.clientWidth,
      scrollWidth: control.scrollWidth,
      clientHeight: control.clientHeight,
      scrollHeight: control.scrollHeight
    }));

  const root = document.documentElement;
  const body = document.body;
  const documentHorizontalOverflow = root.scrollWidth > root.clientWidth + 1
    || body.scrollWidth > root.clientWidth + 1;
  const horizontalOverflowElements = Array.from(body.querySelectorAll("*"))
    .filter(visible)
    .map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const leftOverflow = Math.max(0, -rect.left);
      const rightOverflow = Math.max(0, rect.right - innerWidth);
      return {
        element: describe(element),
        tag: element.tagName.toLowerCase(),
        left: rect.left,
        right: rect.right,
        width: rect.width,
        leftOverflow,
        rightOverflow,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: style.overflowX,
        position: style.position,
        transform: style.transform
      };
    })
    .filter(entry => entry.leftOverflow > 1 || entry.rightOverflow > 1)
    .sort((left, right) => Math.max(right.leftOverflow, right.rightOverflow) - Math.max(left.leftOverflow, left.rightOverflow))
    .slice(0, 20);
  const scroller = document.scrollingElement || root;
  const maximumScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const verticalOverflow = maximumScrollTop > 1;
  let verticalOverflowScrollable = !verticalOverflow;
  if (verticalOverflow) {
    const originalScrollTop = scroller.scrollTop;
    const targetScrollTop = originalScrollTop < maximumScrollTop
      ? Math.min(maximumScrollTop, originalScrollTop + 10)
      : Math.max(0, originalScrollTop - 10);
    scroller.scrollTop = targetScrollTop;
    await nextFrame();
    verticalOverflowScrollable = Math.abs(scroller.scrollTop - targetScrollTop) < 1;
    scroller.scrollTop = originalScrollTop;
  }

  return {
    documentHorizontalOverflow,
    documentMetrics: {
      innerWidth,
      scrollX,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth
    },
    horizontalOverflowElements,
    verticalOverflow,
    verticalOverflowScrollable,
    visibleControlCount: controls.length,
    enabledControlCount: enabledControls.length,
    unnamedControls,
    unfocusableControls,
    undersizedControls,
    focusFailures,
    undersizedText: Array.from(new Set(undersizedText)),
    clippedTextControls
  };
}

function assertGeometryAudit(audit, label) {
  assert(!audit.documentHorizontalOverflow, `${label}: document has horizontal overflow: ${JSON.stringify({ documentMetrics: audit.documentMetrics, horizontalOverflowElements: audit.horizontalOverflowElements })}`);
  assert(audit.verticalOverflowScrollable, `${label}: vertically overflowing document cannot be scrolled: ${JSON.stringify(audit)}`);
  assert(audit.unnamedControls.length === 0, `${label}: visible controls have no accessible name: ${JSON.stringify(audit.unnamedControls)}`);
  assert(audit.unfocusableControls.length === 0, `${label}: visible enabled controls are not focusable: ${JSON.stringify(audit.unfocusableControls)}`);
  assert(audit.undersizedControls.length === 0, `${label}: visible controls are below 44x44px: ${JSON.stringify(audit.undersizedControls)}`);
  assert(audit.focusFailures.length === 0, `${label}: visible enabled controls could not be focused and contained: ${JSON.stringify(audit.focusFailures)}`);
  assert(audit.undersizedText.length === 0, `${label}: visible text is below 12px: ${JSON.stringify(audit.undersizedText)}`);
  assert(audit.clippedTextControls.length === 0, `${label}: button/link/summary text is clipped: ${JSON.stringify(audit.clippedTextControls)}`);
}

function explicitSettings(themeId, variant, overrides = {}) {
  return {
    themeSchemaVersion: "2",
    themeId,
    accentMode: "preset",
    customAccentColor: "",
    accentColor: "",
    themeVariant: variant,
    animationIntensity: "25",
    performanceBudget: "balanced",
    themeReadability: "normal",
    ...overrides
  };
}

async function runPageMatrix() {
  for (const page of standalonePages) {
    for (const viewport of viewports) {
      await setViewport(viewport);
      const signatures = new Map();
      for (const themeId of themeIds) {
        let standardSignature = "";
        let standardVariantSignature = "";
        for (const variant of variants) {
          const label = `${page} ${viewport.width}x${viewport.height} ${themeId}/${variant}`;
          await navigateSeeded(page, explicitSettings(themeId, variant), label);
          const probe = await probeThemeState(themeId, variant, label);
          if (variant === "standard") {
            standardSignature = probe.signature;
            standardVariantSignature = probe.variantSignature;
            signatures.set(themeId, probe.signature);
          } else {
            assert(probe.signature === standardSignature, `${label}: night variant replaced the selected ${themeId} token signature`);
            assert(probe.variantSignature !== standardVariantSignature, `${label}: night-specific presentation tokens did not change`);
            assert(
              probe.variantValues.motionScale === "0"
                && probe.variantValues.motionDuration === "0ms"
                && Number(probe.variantValues.nightBrightness) < 1
                && Number(probe.variantValues.nightGlow) > 0
                && probe.variantValues.bodyBackgroundImage === "none",
              `${label}: night-specific motion, brightness, glow, or flat-background contract is missing: ${JSON.stringify(probe.variantValues)}`
            );
          }
          if (themeId === "focus" && variant === "standard") {
            const audit = await evaluateFunction(browserAuditStandalonePage);
            assertGeometryAudit(audit, label);
          }
        }
      }
      assert(new Set(signatures.values()).size === themeIds.length, `${page} ${viewport.width}x${viewport.height}: Focus, Gaming, and Warm token signatures are not distinct: ${JSON.stringify(Object.fromEntries(signatures))}`);
      console.log(`standalone ${page} ${viewport.width}x${viewport.height}: Focus/Gaming/Warm, standard/night, aliases, and geometry passed`);
    }
  }
}

async function runHostedOverflowProbe() {
  const page = "hosted-dashboard.html";
  const viewport = viewports.find(candidate => candidate.width === 2560 && candidate.height === 720);
  assert(viewport, "hosted overflow probe requires the 2560x720 viewport");
  await setViewport(viewport);
  const label = `${page} ${viewport.width}x${viewport.height} focus/standard overflow probe`;
  await navigateSeeded(page, explicitSettings("focus", "standard"), label);
  const audit = await evaluateFunction(browserAuditStandalonePage);
  console.log(JSON.stringify({ label, audit }, null, 2));
}

async function runUnifiFocusProbe() {
  const page = "widgets/unifi-network-dashboard.html";
  const viewport = viewports.find(candidate => candidate.width === 800 && candidate.height === 480);
  assert(viewport, "UniFi focus probe requires the 800x480 viewport");
  await setViewport(viewport);
  const label = `${page} ${viewport.width}x${viewport.height} focus/standard focus probe`;
  await navigateSeeded(page, explicitSettings("focus", "standard"), label);
  const audit = await evaluateFunction(browserAuditStandalonePage);
  console.log(JSON.stringify({ label, audit }, null, 2));
}

async function runSetupFocusProbe() {
  const page = "widgets/setup-guide.html";
  const viewport = viewports.find(candidate => candidate.width === 800 && candidate.height === 480);
  assert(viewport, "setup focus probe requires the 800x480 viewport");
  await setViewport(viewport);
  const label = `${page} ${viewport.width}x${viewport.height} focus/standard focus probe`;
  await navigateSeeded(page, explicitSettings("focus", "standard"), label);
  const audit = await evaluateFunction(browserAuditStandalonePage);
  console.log(JSON.stringify({ label, audit }, null, 2));
}

async function runControlSizeProbe() {
  const failures = [];
  for (const page of standalonePages) {
    for (const viewport of viewports) {
      await setViewport(viewport);
      const label = `${page} ${viewport.width}x${viewport.height} focus/standard control-size probe`;
      await navigateSeeded(page, explicitSettings("focus", "standard"), label);
      const audit = await evaluateFunction(browserAuditStandalonePage);
      if (audit.undersizedControls.length) {
        failures.push({ label, controls: audit.undersizedControls });
      }
    }
  }
  console.log(JSON.stringify({ checkedPages: standalonePages.length, viewports, failures }, null, 2));
  assert(failures.length === 0, `standalone control-size probe found controls below 44x44px: ${JSON.stringify(failures)}`);
}

function browserProbeCustomAccent(properties, expectedColor) {
  const root = document.documentElement;
  const body = document.body;
  const normalizeValue = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normalizeColor = value => {
    const probe = document.createElement("span");
    probe.style.color = value;
    probe.style.position = "fixed";
    probe.style.left = "-10000px";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };
  const parseColor = value => {
    const match = String(value || "").match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
    return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] == null ? 1 : Number(match[4]) } : null;
  };
  const luminance = color => {
    const parsed = parseColor(color);
    if (!parsed) return null;
    const channel = value => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    return (0.2126 * channel(parsed.r)) + (0.7152 * channel(parsed.g)) + (0.0722 * channel(parsed.b));
  };
  const contrast = (foreground, background) => {
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    if (foregroundLuminance == null || backgroundLuminance == null) return 0;
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
      / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  };
  const rootStyle = getComputedStyle(root);
  const bodyStyle = getComputedStyle(body);
  const rootValues = Object.fromEntries(properties.map(name => [name, normalizeValue(rootStyle.getPropertyValue(name))]));
  const bodyValues = Object.fromEntries(properties.map(name => [name, normalizeValue(bodyStyle.getPropertyValue(name))]));
  const normalizedRootColors = Object.fromEntries(properties.map(name => [name, normalizeColor(rootValues[name])]));
  const surfaceColors = ["--theme-page", "--theme-surface-primary", "--theme-surface-secondary", "--theme-surface-elevated"]
    .map(name => normalizeColor(rootStyle.getPropertyValue(name)));
  return {
    expectedColor: normalizeColor(expectedColor),
    rootAccent: normalizeColor(rootValues["--theme-accent"]),
    bodyAccent: normalizeColor(bodyValues["--theme-accent"]),
    rootValues,
    bodyValues,
    normalizedRootColors,
    accentTextMinimumContrast: Math.min(...surfaceColors.map(surface => contrast(normalizedRootColors["--theme-accent-text"], surface))),
    onAccentContrast: contrast(normalizedRootColors["--theme-on-accent"], normalizedRootColors["--theme-accent"]),
    rootTheme: root.dataset.theme || "",
    bodyTheme: body.dataset.theme || ""
  };
}

async function runCustomAccentChecks() {
  const properties = [
    "--theme-accent",
    "--theme-accent-text",
    "--theme-on-accent",
    "--theme-accent-soft",
    "--theme-accent-border",
    "--theme-accent-glow"
  ];
  const representatives = [
    { page: "support.html", viewport: viewports[0] },
    { page: "widgets/clock-widget.html", viewport: viewports[1] }
  ];
  for (const representative of representatives) {
    await setViewport(representative.viewport);
    const label = `${representative.page} custom accent`;
    await navigateSeeded(representative.page, explicitSettings("warm", "standard"), `${label} preset baseline`);
    await probeThemeState("warm", "standard", `${label} preset baseline`);
    const presetProbe = await evaluateFunction(browserProbeCustomAccent, properties, "#1a2b3c");
    await navigateSeeded(representative.page, explicitSettings("warm", "standard", {
      accentMode: "custom",
      customAccentColor: "#1a2b3c"
    }), label);
    await probeThemeState("warm", "standard", label);
    const probe = await evaluateFunction(browserProbeCustomAccent, properties, "#1a2b3c");
    assert(probe.rootTheme === "warm" && probe.bodyTheme === "warm", `${label}: selected theme did not survive custom accent`);
    assert(probe.rootAccent === probe.expectedColor && probe.bodyAccent === probe.expectedColor, `${label}: custom accent did not reach root and body: ${JSON.stringify(probe)}`);
    assert(properties.every(name => probe.rootValues[name] && probe.bodyValues[name]), `${label}: custom accent companion variables are incomplete: ${JSON.stringify(probe)}`);
    assert(properties.every(name => probe.rootValues[name] === probe.bodyValues[name]), `${label}: root/body custom accent companion variables diverged: ${JSON.stringify(probe)}`);
    assert(properties.every(name => probe.rootValues[name] !== presetProbe.rootValues[name]), `${label}: one or more custom-accent companion variables retained preset values: ${JSON.stringify({ preset: presetProbe.rootValues, custom: probe.rootValues })}`);
    assert(probe.normalizedRootColors["--theme-on-accent"] === "rgb(255, 255, 255)", `${label}: dark custom accent did not derive white on-accent text: ${JSON.stringify(probe)}`);
    assert(probe.normalizedRootColors["--theme-accent-soft"] === "rgba(26, 43, 60, 0.14)", `${label}: custom soft accent was not derived correctly: ${JSON.stringify(probe)}`);
    assert(probe.normalizedRootColors["--theme-accent-border"] === "rgba(26, 43, 60, 0.58)", `${label}: custom accent border was not derived correctly: ${JSON.stringify(probe)}`);
    assert(probe.normalizedRootColors["--theme-accent-glow"] === "rgba(26, 43, 60, 0.22)", `${label}: custom accent glow was not derived correctly: ${JSON.stringify(probe)}`);
    assert(probe.accentTextMinimumContrast >= 4.5 && probe.onAccentContrast >= 4.5, `${label}: derived custom-accent text colors do not meet 4.5:1 contrast: ${JSON.stringify(probe)}`);
  }
  console.log("standalone custom-accent companion variables across root and widget pages: passed");
}

async function pressTab() {
  await evaluate(`(() => {
    const body = document.body;
    const previousTabIndex = body.getAttribute("tabindex");
    body.setAttribute("tabindex", "-1");
    body.focus({ preventScroll: true });
    if (previousTabIndex == null) {
      body.removeAttribute("tabindex");
    } else {
      body.setAttribute("tabindex", previousTabIndex);
    }
    return document.activeElement === body;
  })()`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await delay(50);
}

function browserProbeHighContrast() {
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const root = document.documentElement;
  const body = document.body;
  const rootStyle = getComputedStyle(root);
  const focusTarget = document.activeElement;
  const focusStyle = focusTarget && focusTarget !== body ? getComputedStyle(focusTarget) : null;
  const linkOffenders = Array.from(document.querySelectorAll("a[href]"))
    .filter(visible)
    .filter(link => !getComputedStyle(link).textDecorationLine.includes("underline"))
    .map(link => link.getAttribute("aria-label") || link.textContent.trim() || link.href);
  return {
    rootReadability: root.dataset.readability || "",
    bodyReadability: body.dataset.readability || "",
    rootClass: root.classList.contains("dashboard-native-page--readability-high-contrast"),
    bodyClass: body.classList.contains("dashboard-native-page--readability-high-contrast"),
    panelShadow: rootStyle.getPropertyValue("--theme-panel-shadow").trim(),
    panelBlur: rootStyle.getPropertyValue("--theme-panel-blur").trim(),
    glowIntensity: rootStyle.getPropertyValue("--theme-glow-intensity").trim(),
    linkOffenders,
    focus: focusStyle ? {
      element: focusTarget.getAttribute("aria-label") || focusTarget.textContent.trim() || focusTarget.tagName,
      visible: focusTarget.matches(":focus-visible"),
      style: focusStyle.outlineStyle,
      width: Number.parseFloat(focusStyle.outlineWidth) || 0
    } : null
  };
}

async function runHighContrastChecks() {
  const representatives = [
    { page: "refund-policy.html", viewport: viewports[0] },
    { page: "widgets/setup-guide.html", viewport: viewports[1] }
  ];
  for (const representative of representatives) {
    await setViewport(representative.viewport);
    const label = `${representative.page} high contrast`;
    await navigateSeeded(representative.page, explicitSettings("focus", "standard", { themeReadability: "high-contrast" }), label);
    await waitForCondition("document.documentElement.dataset.readability === 'high-contrast' && document.body?.dataset.readability === 'high-contrast'", label);
    await pressTab();
    const probe = await evaluateFunction(browserProbeHighContrast);
    assert(probe.rootReadability === "high-contrast" && probe.bodyReadability === "high-contrast" && probe.rootClass && probe.bodyClass, `${label}: readability state did not reach root/body: ${JSON.stringify(probe)}`);
    assert(probe.panelShadow === "none" && probe.panelBlur === "0px" && Number(probe.glowIntensity) === 0, `${label}: decorative effects remain enabled: ${JSON.stringify(probe)}`);
    assert(probe.linkOffenders.length === 0, `${label}: visible links lost high-contrast underlines: ${JSON.stringify(probe.linkOffenders)}`);
    assert(probe.focus && probe.focus.visible && probe.focus.style !== "none" && probe.focus.width >= 3, `${label}: high-contrast keyboard focus is not visible: ${JSON.stringify(probe.focus)}`);
  }
  console.log("standalone high-contrast state across policy and widget pages: passed");
}

async function runStorageEventChecks() {
  const representatives = [
    { page: "hosted-dashboard.html", viewport: viewports[0], nextTheme: "gaming", nextVariant: "night" },
    { page: "widgets/network-widget.html", viewport: viewports[1], nextTheme: "warm", nextVariant: "standard" }
  ];
  for (const representative of representatives) {
    await setViewport(representative.viewport);
    const label = `${representative.page} storage event`;
    await navigateSeeded(representative.page, explicitSettings("focus", "standard"), label);
    const before = await probeThemeState("focus", "standard", label);
    const nextSettings = explicitSettings(representative.nextTheme, representative.nextVariant);
    await evaluate(`(() => {
      const key = ${JSON.stringify(settingsStorageKey)};
      const oldValue = localStorage.getItem(key);
      const newValue = ${JSON.stringify(JSON.stringify(nextSettings))};
      localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage, url: location.href }));
    })()`);
    const after = await probeThemeState(representative.nextTheme, representative.nextVariant, label);
    assert(after.signature !== before.signature, `${label}: storage event did not update semantic theme tokens`);
  }
  console.log("standalone storage-event live theme updates across root and widget pages: passed");
}

async function runNativeConfigFallbackChecks() {
  const representatives = [
    { page: "index.html", viewport: viewports[0] },
    { page: "widgets/system-monitor.html", viewport: viewports[1] }
  ];
  for (const representative of representatives) {
    await setViewport(representative.viewport);
    const label = `${representative.page} native config fallback`;
    const requestsBefore = configRequestCount;
    await navigateSeeded(representative.page, { performanceBudget: "battery" }, label);
    await waitForCondition("document.documentElement.dataset.theme === 'gaming' && document.documentElement.dataset.themeVariant === 'night' && document.documentElement.dataset.readability === 'clean'", label);
    const probe = await probeThemeState("gaming", "night", label);
    const state = await evaluate(`({
      rootBudget: document.documentElement.dataset.performanceBudget || "",
      bodyBudget: document.body?.dataset.performanceBudget || "",
      rootReadability: document.documentElement.dataset.readability || "",
      bodyReadability: document.body?.dataset.readability || ""
    })`);
    assert(configRequestCount > requestsBefore, `${label}: /api/config was not requested`);
    assert(state.rootBudget === "battery" && state.bodyBudget === "battery", `${label}: explicit non-theme local setting was not preserved: ${JSON.stringify(state)}`);
    assert(state.rootReadability === "clean" && state.bodyReadability === "clean", `${label}: native readability fallback did not apply: ${JSON.stringify(state)}`);
    assert(probe.rootTheme === "gaming", `${label}: native theme fallback did not apply`);
  }
  console.log("standalone native /api/config fallback without explicit local theme across root and widget pages: passed");
}

function browserProbeForcedColors() {
  const root = document.documentElement;
  const body = document.body;
  const active = document.activeElement;
  const activeStyle = active && active !== body ? getComputedStyle(active) : null;
  return {
    mediaActive: matchMedia("(forced-colors: active)").matches,
    forcedColorAdjust: getComputedStyle(root).forcedColorAdjust,
    pageToken: getComputedStyle(root).getPropertyValue("--theme-page").trim(),
    textToken: getComputedStyle(root).getPropertyValue("--theme-text").trim(),
    accentToken: getComputedStyle(root).getPropertyValue("--theme-accent").trim(),
    onAccentToken: getComputedStyle(root).getPropertyValue("--theme-on-accent").trim(),
    focusToken: getComputedStyle(root).getPropertyValue("--theme-focus-ring").trim(),
    focus: activeStyle ? {
      element: active.getAttribute("aria-label") || active.textContent.trim() || active.tagName,
      visible: active.matches(":focus-visible"),
      style: activeStyle.outlineStyle,
      width: Number.parseFloat(activeStyle.outlineWidth) || 0
    } : null,
    optOuts: Array.from(document.querySelectorAll("html, body, body *"))
      .filter(element => getComputedStyle(element).forcedColorAdjust === "none")
      .map(element => element.id || element.className || element.tagName)
      .slice(0, 30)
  };
}

async function runForcedColorsChecks() {
  const representatives = [
    { page: "support.html", viewport: viewports[0] },
    { page: "widgets/audio-output-panel.html", viewport: viewports[1] }
  ];
  await setMedia({ forcedColors: "active", reducedMotion: "no-preference" });
  try {
    for (const representative of representatives) {
      await setViewport(representative.viewport);
      const label = `${representative.page} forced colors`;
      await navigateSeeded(representative.page, explicitSettings("focus", "standard"), label);
      await probeThemeState("focus", "standard", label);
      const audit = await evaluateFunction(browserAuditStandalonePage);
      assertGeometryAudit(audit, label);
      await pressTab();
      const probe = await evaluateFunction(browserProbeForcedColors);
      assert(probe.mediaActive, `${label}: forced-colors emulation did not activate`);
      assert(probe.forcedColorAdjust === "auto", `${label}: root opted out of forced colors: ${JSON.stringify(probe)}`);
      assert(
        probe.pageToken.toLowerCase() === "canvas"
          && probe.textToken.toLowerCase() === "canvastext"
          && probe.accentToken.toLowerCase() === "linktext"
          && probe.onAccentToken.toLowerCase() === "canvas"
          && probe.focusToken.toLowerCase() === "highlight",
        `${label}: forced-color system-token remap did not apply: ${JSON.stringify(probe)}`
      );
      assert(probe.optOuts.length === 0, `${label}: visible UI opted out of forced colors: ${JSON.stringify(probe.optOuts)}`);
      assert(probe.focus && probe.focus.visible && probe.focus.style !== "none" && probe.focus.width >= 3, `${label}: forced-color keyboard focus is not visible: ${JSON.stringify(probe.focus)}`);
    }
  } finally {
    await setMedia();
  }
  console.log("standalone forced-colors rendering across root and widget pages: passed");
}

function browserProbeReducedMotion() {
  const seconds = value => String(value || "").split(",").reduce((maximum, part) => {
    const text = part.trim();
    const number = Number.parseFloat(text) || 0;
    return Math.max(maximum, text.endsWith("ms") ? number / 1000 : number);
  }, 0);
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const offenders = [];
  for (const element of Array.from(document.querySelectorAll("body, body *")).filter(visible)) {
    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(element, pseudo);
      if (seconds(style.animationDuration) > 0.000011 || seconds(style.transitionDuration) > 0.000011) {
        offenders.push({
          element: element.id || element.className || element.tagName,
          pseudo: pseudo || "element",
          animationDuration: style.animationDuration,
          transitionDuration: style.transitionDuration
        });
        if (offenders.length >= 50) {
          break;
        }
      }
    }
    if (offenders.length >= 50) {
      break;
    }
  }
  return {
    mediaActive: matchMedia("(prefers-reduced-motion: reduce)").matches,
    rootReducedMotion: document.documentElement.dataset.reducedMotion || "",
    bodyReducedMotion: document.body?.dataset.reducedMotion || "",
    rootScrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    bodyScrollBehavior: getComputedStyle(document.body).scrollBehavior,
    offenders
  };
}

async function runReducedMotionChecks() {
  const representatives = [
    { page: "hosted-dashboard.html", viewport: viewports[0] },
    { page: "widgets/weather-widget.html", viewport: viewports[1] }
  ];
  await setMedia({ forcedColors: "none", reducedMotion: "reduce" });
  try {
    for (const representative of representatives) {
      await setViewport(representative.viewport);
      const label = `${representative.page} reduced motion`;
      await navigateSeeded(representative.page, explicitSettings("warm", "standard", { animationIntensity: "100" }), label);
      await waitForCondition("document.documentElement.dataset.reducedMotion === 'true' && document.body?.dataset.reducedMotion === 'true'", label);
      const probe = await evaluateFunction(browserProbeReducedMotion);
      assert(probe.mediaActive, `${label}: reduced-motion emulation did not activate`);
      assert(probe.rootReducedMotion === "true" && probe.bodyReducedMotion === "true", `${label}: reduced-motion state did not reach root/body: ${JSON.stringify(probe)}`);
      assert(probe.rootScrollBehavior === "auto" && probe.bodyScrollBehavior === "auto", `${label}: animated scrolling remains enabled: ${JSON.stringify(probe)}`);
      assert(probe.offenders.length === 0, `${label}: animations or transitions remain active: ${JSON.stringify(probe.offenders)}`);
    }
  } finally {
    await setMedia();
  }
  console.log("standalone reduced-motion rendering across root and widget pages: passed");
}

async function configureRequestIsolation() {
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  cdp.on("Fetch.requestPaused", parameters => {
    void (async () => {
      const requestUrl = parameters.request?.url || "";
      let allowed = false;
      try {
        const parsed = new URL(requestUrl);
        allowed = parsed.origin === baseUrl || ["about:", "blob:", "data:"].includes(parsed.protocol);
      } catch {
        allowed = false;
      }
      if (allowed) {
        await cdp.send("Fetch.continueRequest", { requestId: parameters.requestId });
      } else {
        blockedExternalUrls.add(requestUrl);
        await cdp.send("Fetch.failRequest", { requestId: parameters.requestId, errorReason: "BlockedByClient" });
      }
    })().catch(error => {
      if (!/Invalid InterceptionId|No resource with given identifier|Target closed/i.test(String(error?.message || error))) {
        interceptionFailure ||= error;
      }
    });
  });
}

function configureRuntimeExceptionCapture() {
  cdp.on("Runtime.exceptionThrown", parameters => {
    const details = parameters.exceptionDetails || {};
    runtimeExceptions.push({
      label: currentNavigationLabel,
      text: details.exception?.description || details.text || "Uncaught browser exception",
      url: details.url || "",
      lineNumber: Number.isInteger(details.lineNumber) ? details.lineNumber + 1 : null,
      columnNumber: Number.isInteger(details.columnNumber) ? details.columnNumber + 1 : null
    });
  });
}

async function main() {
  await checkBrowserLifecycle();
  if (process.argv.includes("--check-browser-lifecycle")) return;
  assert(standalonePages.length === 19 && new Set(standalonePages).size === 19, "standalone rendered test must cover exactly 19 unique pages");
  for (const page of standalonePages) {
    const path = resolve(repoRoot, page);
    assert(isContainedPath(repoRoot, path) && existsSync(path) && statSync(path).isFile(), `standalone page is missing: ${page}`);
  }
  assert(typeof WebSocket === "function", "Node.js with built-in WebSocket support is required");

  const browserExecutable = findBrowserExecutable();
  assert(browserExecutable, "Microsoft Edge or Google Chrome/Chromium is required for standalone rendered testing");
  profileRoot = mkdtempSync(join(tmpdir(), "auxora-standalone-theme-rendered-"));
  const browserProfile = join(profileRoot, "browser");
  mkdirSync(browserProfile, { recursive: true });

  await startServer();
  browser = spawn(browserExecutable, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=OptimizationHints,MediaRouter,DialMediaRouteProvider",
    "--disable-gpu",
    "--disable-sync",
    "--enable-logging=stderr",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--log-level=1",
    "--no-first-run",
    "--no-proxy-server",
    "--remote-allow-origins=*",
    "--remote-debugging-port=0",
    `--user-data-dir=${browserProfile}`,
    "about:blank"
  ], { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  readBrowserDiagnostics = captureBrowserOutput(browser, browserExecutable);
  const debugPort = await waitForBrowser(browserProfile, browser, readBrowserDiagnostics);
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  assert(targetResponse.ok, `headless browser target creation failed with HTTP ${targetResponse.status}`);
  const target = await targetResponse.json();
  cdp = await connectCdp(target.webSocketDebuggerUrl, readBrowserDiagnostics);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  configureRuntimeExceptionCapture();
  await configureRequestIsolation();
  await setMedia();

  if (process.argv.includes("--probe-hosted-overflow")) {
    await runHostedOverflowProbe();
    return;
  }

  if (process.argv.includes("--probe-unifi-focus")) {
    await runUnifiFocusProbe();
    return;
  }

  if (process.argv.includes("--probe-setup-focus")) {
    await runSetupFocusProbe();
    return;
  }

  if (process.argv.includes("--probe-control-sizes")) {
    await runControlSizeProbe();
    return;
  }

  if (process.argv.includes("--probe-forced-colors")) {
    await runForcedColorsChecks();
    return;
  }

  if (process.argv.includes("--probe-reduced-motion")) {
    await runReducedMotionChecks();
    return;
  }

  await runPageMatrix();
  await runCustomAccentChecks();
  await runHighContrastChecks();
  await runStorageEventChecks();
  await runNativeConfigFallbackChecks();
  await runForcedColorsChecks();
  await runReducedMotionChecks();
  assert(!interceptionFailure, `request interception failed: ${interceptionFailure?.message || interceptionFailure}`);
  assert(runtimeExceptions.length === 0, `standalone pages emitted uncaught runtime exceptions: ${JSON.stringify(runtimeExceptions)}`);
  assert(staticResourceFailures.length === 0, `standalone pages failed essential same-origin resources: ${JSON.stringify(staticResourceFailures)}`);

  console.log(`rendered standalone theme acceptance passed for exactly ${standalonePages.length} pages at ${viewports.map(viewport => `${viewport.width}x${viewport.height}`).join(" and ")}; blocked ${blockedExternalUrls.size} external URL(s) before network access`);
}

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(exitCode));
  });
}

let primaryFailure;
try {
  await main();
} catch (error) {
  primaryFailure = error;
}

let cleanupFailure;
try {
  await cleanup();
} catch (error) {
  cleanupFailure = error;
}

if (primaryFailure) {
  if (cleanupFailure) {
    console.error("standalone rendered cleanup also failed:", cleanupFailure);
  }
  throw primaryFailure;
}
if (cleanupFailure) {
  throw cleanupFailure;
}
