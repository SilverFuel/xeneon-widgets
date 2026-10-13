import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnWithVisibleWindowGuard, stopVisibleWindowGuard } from "./lib/visible-window-guard.mjs";

const repoRoot = process.cwd();
let baseUrl = "";
const hostExecutable = resolve(repoRoot, "app/bin/x64/Release/net8.0-windows10.0.19041.0/win-x64/XenonEdgeHost.exe");
const edgeCandidates = [
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.LOCALAPPDATA || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe")
];
const browserExecutable = edgeCandidates.find(path => path && existsSync(path));
const viewports = [
  { name: "short-companion", width: 1280, height: 360, expected: "ultrawide" },
  { name: "compact", width: 800, height: 480, expected: "compact" },
  { name: "portrait-phone", width: 390, height: 844, expected: "portrait" },
  { name: "standard", width: 1280, height: 720, expected: "standard" },
  { name: "common-laptop", width: 1366, height: 768, expected: "standard" },
  { name: "common-desktop", width: 1440, height: 900, expected: "standard" },
  { name: "desktop", width: 1600, height: 900, expected: "standard" },
  { name: "network-stack-boundary", width: 2047, height: 720, expected: "ultrawide" },
  { name: "wide-companion", width: 2048, height: 720, expected: "ultrawide" },
  { name: "ultrawide", width: 2560, height: 720, expected: "ultrawide" },
];
const surfaceAuditViewportNames = viewports.map(viewport => viewport.name);
const surfaceAuditViewports = surfaceAuditViewportNames.map(name => {
  const viewport = viewports.find(candidate => candidate.name === name);
  assert(viewport, `product-surface viewport ${name} is missing from the rendered matrix`);
  return viewport;
});
const surfaceOnlyArgument = process.argv.find(argument => argument.startsWith("--surface-only="));
const surfaceOnlyViewport = surfaceOnlyArgument
  ? viewports.find(viewport => viewport.name === surfaceOnlyArgument.slice("--surface-only=".length))
  : null;
assert(!surfaceOnlyArgument || surfaceOnlyViewport, `unknown focused surface viewport: ${surfaceOnlyArgument}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

async function waitForCommittedUrl(cdp, marker, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const evaluation = await cdp.send("Runtime.evaluate", {
        expression: `location.href.includes(${JSON.stringify(marker)})`,
        returnByValue: true
      });
      if (evaluation.result?.value === true) return;
    } catch {
      // The previous execution context may be disappearing while navigation commits.
    }
    await delay(50);
  }
  throw new Error(`browser did not commit navigation containing ${marker}`);
}

async function reserveLocalPort() {
  const server = createNetServer();
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

async function startMockFrigate() {
  const requests = { login: 0, events: 0, eventLog: [], snapshots: 0, unauthorized: 0, loginBody: "" };
  let mode = "live";
  const eventId = "rendered-camera-event";
  const snapshot = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/login" && request.method === "POST") {
      requests.login += 1;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.loginBody = Buffer.concat(chunks).toString("utf8");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ access_token: "rendered-frigate-token" }));
      return;
    }
    if (request.headers.authorization !== "Bearer rendered-frigate-token") {
      requests.unauthorized += 1;
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Authentication required" }));
      return;
    }
    if (url.pathname === "/api/events") {
      requests.events += 1;
      requests.eventLog.push({ mode, at: Date.now() });
      if (mode === "offline" || mode === "slow-offline") {
        if (mode === "slow-offline") await delay(250);
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Frigate is temporarily offline" }));
        return;
      }
      const payload = [{
        id: eventId,
        label: "person",
        camera: "garage",
        start_time: Date.now() / 1000,
        end_time: null,
        false_positive: false,
        zones: ["driveway"],
        has_snapshot: true,
        data: { score: 0.96 }
      }];
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
      return;
    }
    if (url.pathname === `/api/events/${eventId}/snapshot.jpg`) {
      requests.snapshots += 1;
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": snapshot.length });
      response.end(snapshot);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert(port > 0, "mock Frigate server did not receive a local port");
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    setMode: nextMode => {
      mode = nextMode;
    },
    close: () => new Promise(resolveClose => server.close(resolveClose))
  };
}

async function hostAlreadyRunning() {
  try {
    const response = await fetch(`${baseUrl}/api/config`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHost(child, readDiagnostics) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`native host exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/config`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await delay(400);
  }
  const diagnostics = typeof readDiagnostics === "function" ? readDiagnostics() : {};
  throw new Error(`native host did not become responsive within 60 seconds: ${JSON.stringify(diagnostics)}`);
}

async function waitForNativeWebView(child, readDiagnostics) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const diagnostics = readDiagnostics();
    assert(child.exitCode === null, `native host exited before its isolated WebView initialized: ${JSON.stringify(diagnostics)}`);
    if (diagnostics.hostLog.includes("Dashboard loaded successfully.")) return;
    await delay(400);
  }
  throw new Error(`native host did not initialize its isolated WebView within 60 seconds: ${JSON.stringify(readDiagnostics())}`);
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

async function validateEmbeddedProductCss() {
  const response = await fetch(`${baseUrl}/css/widgets/product.css?embeddedAssetTest=1`, { cache: "no-store" });
  assert(response.ok, `embedded product stylesheet returned HTTP ${response.status}`);
  const css = await response.text();
  assert(/\.product-code-preview\s*\{[^}]*font-size:\s*12px;/s.test(css), "native host embedded a stale product-code-preview font size");
}

async function validateEmbeddedNetworkCss() {
  const response = await fetch(`${baseUrl}/css/widgets/network.css?embeddedAssetTest=1`, { cache: "no-store" });
  assert(response.ok, `embedded Network stylesheet returned HTTP ${response.status}`);
  const css = await response.text();
  assert(
    /@media\s*\(max-width:\s*2047px\)[\s\S]*?\.network-command-grid\s*\{[^}]*grid-template-columns:\s*1fr;/.test(css),
    "native host embedded a stale 2047px Network stacking contract"
  );
  assert(
    /\.network-command-grid\s*\{[^}]*grid-template-columns:\s*360px\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s+430px;/.test(css),
    "native host embedded a stale four-column Network grid contract"
  );
  assert(
    /data-card-size="compact"\][\s\S]*?\.network-command-grid\s*\{[^}]*grid-template-columns:\s*1fr;/.test(css),
    "native host embedded a stale compact-card Network stacking contract"
  );
}

async function validateNetworkSuccessContrast(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 2560,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=network&renderedTest=networkContrast` });
  await waitForCommittedUrl(cdp, "widget=network&renderedTest=networkContrast");
  await delay(1800);
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      document.documentElement.style.setProperty('--theme-accent', '#001020');
      document.documentElement.style.setProperty('--color-accent', '#001020');
      const expected = document.createElement('span');
      expected.style.color = 'var(--status-success-text)';
      document.body.appendChild(expected);
      const result = {
        expected: getComputedStyle(expected).color,
        accent: 'rgb(0, 16, 32)',
        score: getComputedStyle(document.querySelector('.network-quality-score strong')).color,
        goodValues: Array.from(document.querySelectorAll('.network-pill[data-tone="good"] strong')).map(node => getComputedStyle(node).color)
      };
      expected.remove();
      return result;
    })()`,
    returnByValue: true
  });
  const result = evaluation.result?.value || {};
  assert(result.score === result.expected && result.score !== result.accent, `Network readiness score inherited an unsafe custom accent: ${JSON.stringify(result)}`);
  assert(result.goodValues?.length > 0 && result.goodValues.every(color => color === result.expected && color !== result.accent), `Network success details inherited an unsafe custom accent: ${JSON.stringify(result)}`);
  console.log("rendered Network success contrast with dark custom accent: passed");
}

async function validateActionConfirmationExpiry(cdp) {
  const cases = [
    { widget: "quick-actions", id: "empty-recycle-bin", label: "Empty Bin" },
    { widget: "shortcuts", id: "sleep", label: "Sleep" }
  ];
  for (const testCase of cases) {
    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=${testCase.widget}&renderedTest=confirmationExpiry` });
    await waitForCommittedUrl(cdp, `widget=${testCase.widget}&renderedTest=confirmationExpiry`);
    const selector = `[data-id="${testCase.id}"]`;
    const initialEvaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const deadline = Date.now() + 15000;
        let button = null;
        while (Date.now() < deadline) {
          button = document.querySelector(${JSON.stringify(selector)});
          if (document.body?.dataset.bridgeHydrated === 'true' && button) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return { exists: !!button, text: button?.innerText || '', state: button?.getAttribute('data-state') || '' };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const initial = initialEvaluation.result?.value || {};
    assert(initial.exists && /two-step/i.test(initial.text) && initial.state !== "confirm", `${testCase.label} was presented as already confirmed: ${JSON.stringify(initial)}`);

    const armedEvaluation = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        button?.click();
        const current = document.querySelector(${JSON.stringify(selector)});
        return { text: current?.innerText || '', state: current?.getAttribute('data-state') || '' };
      })()`,
      returnByValue: true
    });
    const armed = armedEvaluation.result?.value || {};
    assert(armed.state === "confirm" && /Tap again within 8 seconds/.test(armed.text), `${testCase.label} did not enter an explicit short confirmation state: ${JSON.stringify(armed)}`);

    await delay(8300);
    const expiredEvaluation = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        return { text: button?.innerText || '', state: button?.getAttribute('data-state') || '' };
      })()`,
      returnByValue: true
    });
    const expired = expiredEvaluation.result?.value || {};
    assert(expired.state !== "confirm" && /two-step/i.test(expired.text), `${testCase.label} confirmation did not expire safely: ${JSON.stringify(expired)}`);
  }
  console.log("rendered destructive-action two-step confirmation expiry: passed");
}

async function waitForBrowser(debugPort, child) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/version`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Browser debugging endpoint is still starting.
    }
    await delay(250);
  }
  throw new Error(`browser debugging endpoint did not start within 30 seconds${child.exitCode === null ? "" : `; launcher exited with code ${child.exitCode}`}`);
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
  if (child.exitCode === null && process.platform === "win32" && child.pid) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const taskList = spawnSync(
        "tasklist.exe",
        ["/FI", `PID eq ${child.pid}`, "/FO", "CSV", "/NH"],
        { encoding: "utf8", windowsHide: true, timeout: 5000 }
      );
      const processStillExists = String(taskList.stdout || "").includes(`\"${child.pid}\"`);
      if (!processStillExists) return;
      await delay(250);
    }
    throw new Error(`process tree ${child.pid} did not terminate within 10 seconds`);
  }
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

async function validateColdBoots(cdp, attempts) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "local_storage" });
      await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=privacy&coldBootTest=${attempt}` });
      await waitForCommittedUrl(cdp, `coldBootTest=${attempt}`);
      const deadline = Date.now() + 8000;
      let sampledInitialState = false;
      let lastSample = {};
      while (Date.now() < deadline) {
        const sample = await cdp.send("Runtime.evaluate", {
          expression: `({
            currentAttempt: new URLSearchParams(location.search).get('coldBootTest'),
            ready: document.readyState !== 'loading',
            hydrated: document.body?.dataset.bridgeHydrated === 'true',
            prematureFailure: document.body?.dataset.bridgeHydrated !== 'true' && /Needs Setup|Dashboard failed/.test(document.body?.innerText || '')
          })`,
          returnByValue: true
        });
        const value = sample.result?.value || {};
        lastSample = value;
        if (value.currentAttempt !== String(attempt)) {
          await delay(15);
          continue;
        }
        assert(!value.prematureFailure, `cold boot ${attempt}: warning/error copy appeared before health hydration`);
        if (value.ready) {
          sampledInitialState = true;
          break;
        }
        await delay(15);
      }
      assert(sampledInitialState, `cold boot ${attempt}: initial page state was not available within 8 seconds: ${JSON.stringify(lastSample)}`);
      if (attempt % 10 === 0) console.log(`cold boot hydration progress: ${attempt}/${attempts}`);
  }
  console.log(`cold boot pre-hydration state: ${attempts}/${attempts} passed without premature setup/error copy`);
}

async function validateSettingsInteractionSafety(cdp) {
  await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=setup&settingsRaceTest=1` });
  await waitForCommittedUrl(cdp, "settingsRaceTest=1");
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') {
        await wait(50);
      }
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')));
      const settingsToggle = document.getElementById('dashboard-settings-toggle');
      const closedToggleText = settingsToggle?.textContent?.trim() || '';
      const closedToggleName = settingsToggle?.getAttribute('aria-label') || '';
      const controlsSettingsBody = settingsToggle?.getAttribute('aria-controls') || '';
      settingsToggle.click();
      const readability = document.getElementById('dashboard-readability-select');
      const budget = document.getElementById('dashboard-budget-select');
      const autoTune = document.getElementById('dashboard-autotune-toggle');
      const opacity = document.getElementById('dashboard-opacity-slider');
      const autoTuneBefore = autoTune.checked;

      readability.focus();
      readability.value = 'clean';
      readability.dispatchEvent(new Event('change', { bubbles: true }));
      budget.focus();
      budget.value = 'game';
      budget.dispatchEvent(new Event('change', { bubbles: true }));
      autoTune.focus();
      autoTune.click();
      opacity.focus();
      opacity.value = '57';
      opacity.dispatchEvent(new Event('input', { bubbles: true }));
      opacity.dispatchEvent(new Event('change', { bubbles: true }));
      settingsToggle.focus();
      await wait(150);

      return {
        errors,
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body.innerText || ''),
        closedToggleText,
        closedToggleName,
        controlsSettingsBody,
        openToggleText: settingsToggle?.textContent?.trim() || '',
        openToggleName: settingsToggle?.getAttribute('aria-label') || '',
        settingsOpen: document.getElementById('dashboard-settings-panel')?.classList.contains('is-open'),
        readability: document.getElementById('dashboard-readability-select')?.value,
        budget: document.getElementById('dashboard-budget-select')?.value,
        autoTuneBefore,
        autoTune: document.getElementById('dashboard-autotune-toggle')?.checked,
        opacity: document.getElementById('dashboard-opacity-slider')?.value
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const result = evaluation.result?.value || {};
  assert(result.errors?.length === 0, `settings interaction emitted runtime errors: ${JSON.stringify(result.errors || [])}`);
  assert(!result.fatalVisible, "settings interaction collapsed the dashboard into a fatal error surface");
  assert(result.closedToggleText === "Panel options" && result.closedToggleName === "Open panel options" && result.controlsSettingsBody === "dashboard-widget-settings", `collapsed panel options were ambiguous or disconnected: ${JSON.stringify(result)}`);
  assert(result.openToggleText === "Hide options" && result.openToggleName === "Close panel options", `expanded panel options did not publish a distinct accessible name: ${JSON.stringify(result)}`);
  assert(result.settingsOpen, "settings drawer closed during focused-control reconciliation");
  assert(result.readability === "clean", `readability change was lost: ${JSON.stringify(result)}`);
  assert(result.budget === "game", `performance change was lost: ${JSON.stringify(result)}`);
  assert(result.autoTune === !result.autoTuneBefore, `auto-tune change was lost: ${JSON.stringify(result)}`);
  assert(result.opacity === "57", `opacity change was lost: ${JSON.stringify(result)}`);
  console.log("focused Settings change/blur reconciliation: passed");
}

async function validateTouchLockIsolation(cdp) {
  await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?touchLockTest=1` });
  await waitForCommittedUrl(cdp, "touchLockTest=1");
  const lockedEvaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);
      const settingsNav = document.querySelector('#dashboard-primary-nav [data-destination="settings"]');
      settingsNav?.click();
      const diagnosticsDeadline = Date.now() + 5000;
      let resetButton = null;
      while (Date.now() < diagnosticsDeadline) {
        const setupButton = document.querySelector('[data-widget-id="setup"]');
        if (setupButton && !setupButton.classList.contains('is-active')) {
          document.getElementById('dashboard-panels-toggle')?.click();
          setupButton.click();
        }
        resetButton = document.querySelector('#dashboard-inline-widget [data-action="reset-local-data"]');
        if (resetButton) break;
        await wait(50);
      }
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')), true);
      const headingBefore = document.getElementById('dashboard-widget-title')?.textContent || '';
      const destinationBefore = document.querySelector('#dashboard-primary-nav [aria-pressed="true"]')?.getAttribute('data-destination') || '';
      const lockButton = document.getElementById('dashboard-touch-lock-toggle');
      lockButton?.click();
      await wait(100);
      const unlockButton = document.getElementById('dashboard-touch-unlock');
      const modesButton = document.querySelector('#dashboard-primary-nav [data-destination="scenes"]');
      const quickButton = document.getElementById('dashboard-quick-toggle');
      modesButton?.click();
      resetButton?.click();
      quickButton?.click();
      await wait(100);
      return {
        ready: !!(lockButton && unlockButton && resetButton),
        lockedClass: document.body.classList.contains('dashboard-native-page--touch-locked'),
        railInert: document.querySelector('.router-rail')?.hasAttribute('inert'),
        viewerInert: document.querySelector('.router-viewer')?.hasAttribute('inert'),
        quickInert: document.getElementById('dashboard-quick-drawer')?.hasAttribute('inert'),
        scrimVisible: !document.getElementById('dashboard-touch-lock-scrim')?.classList.contains('is-hidden'),
        unlockVisible: !unlockButton?.classList.contains('is-hidden'),
        focusedId: document.activeElement?.id || '',
        headingBefore,
        headingAfter: document.getElementById('dashboard-widget-title')?.textContent || '',
        destinationBefore,
        destinationAfter: document.querySelector('#dashboard-primary-nav [aria-pressed="true"]')?.getAttribute('data-destination') || '',
        resetText: resetButton?.textContent?.trim() || '',
        quickOpen: document.body.classList.contains('dashboard-native-page--quick-open'),
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body?.innerText || ''),
        errors
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const locked = lockedEvaluation.result?.value || {};
  assert(locked.ready && locked.lockedClass && locked.railInert && locked.viewerInert && locked.quickInert && locked.scrimVisible && locked.unlockVisible, `Touch Lock did not isolate every interaction surface: ${JSON.stringify(locked)}`);
  assert(locked.focusedId === "dashboard-touch-unlock", `Touch Lock did not move focus to its only available control: ${JSON.stringify(locked)}`);
  assert(locked.headingAfter === locked.headingBefore && locked.destinationAfter === locked.destinationBefore && locked.resetText === "Reset local data" && !locked.quickOpen, `Touch Lock allowed an underlying navigation, reset, or Quick controls action: ${JSON.stringify(locked)}`);
  assert(!locked.fatalVisible && (locked.errors || []).length === 0, `Touch Lock emitted a dashboard runtime failure: ${JSON.stringify(locked)}`);

  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?touchLockPersistTest=1` });
  await waitForCommittedUrl(cdp, "touchLockPersistTest=1");
  const persistedEvaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);
      const unlockButton = document.getElementById('dashboard-touch-unlock');
      const persisted = document.body.classList.contains('dashboard-native-page--touch-locked')
        && document.querySelector('.router-rail')?.hasAttribute('inert')
        && document.querySelector('.router-viewer')?.hasAttribute('inert')
        && !unlockButton?.classList.contains('is-hidden');
      unlockButton?.click();
      await wait(100);
      return {
        persisted,
        unlocked: !document.body.classList.contains('dashboard-native-page--touch-locked')
          && !document.querySelector('.router-rail')?.hasAttribute('inert')
          && !document.querySelector('.router-viewer')?.hasAttribute('inert')
          && unlockButton?.classList.contains('is-hidden'),
        focusedId: document.activeElement?.id || '',
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body?.innerText || '')
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const persisted = persistedEvaluation.result?.value || {};
  assert(persisted.persisted && persisted.unlocked && persisted.focusedId === "dashboard-touch-lock-toggle" && !persisted.fatalVisible, `Touch Lock did not persist or recover through its single unlock path: ${JSON.stringify(persisted)}`);
  console.log("rendered Touch Lock isolation, persistence, and focus recovery: passed");
}

async function validateFocusedInlineWidgetReconciliation(cdp) {
  async function runProbe(url, expression, label) {
    await cdp.send("Page.navigate", { url });
    await waitForCommittedUrl(cdp, new URL(url).searchParams.keys().next().value || "widget");
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    const result = evaluation.result?.value || {};
    assert(result.ready, `${label} did not render its target control: ${JSON.stringify(result)}`);
    assert(result.connected && result.focused && result.valuePreserved, `${label} replaced, reset, or stole focus from its interaction controls: ${JSON.stringify(result)}`);
    assert(result.chromePreserved !== false && result.teardownSafe !== false, `${label} replaced focused dashboard chrome or failed during panel teardown: ${JSON.stringify(result)}`);
    assert(result.detailsOpen !== false, `${label} collapsed an open disclosure during its redraw: ${JSON.stringify(result)}`);
    assert(result.redrawStarted !== false && result.redrawCompleted !== false, `${label} did not exercise both the immediate and completed redraw: ${JSON.stringify(result)}`);
    assert(result.rootScrolled !== false && result.contained !== false, `${label} lost the focused control's scrolled, contained position: ${JSON.stringify(result)}`);
    assert(result.customEnabled !== false, `${label} failed to apply the custom-accent control after blur: ${JSON.stringify(result)}`);
    assert((result.errors || []).length === 0 && !result.fatalVisible, `${label} emitted a dashboard runtime failure: ${JSON.stringify(result)}`);
  }

  await runProbe(
    `${baseUrl}/dashboard.html?widget=theme-studio&focusedThemeTest=1`,
    `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || !document.querySelector('[data-form="theme-studio"]'))) await wait(50);
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')), true);
      const form = document.querySelector('[data-form="theme-studio"]');
      const variant = form?.elements?.themeVariant;
      const accent = form?.elements?.accentMode;
      const blurTarget = document.getElementById('dashboard-panels-toggle');
      if (!variant || !accent || !blurTarget) return { ready: false, errors };
      variant.focus();
      variant.value = 'standard';
      variant.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(50);
      const focusedChangePreserved = variant.isConnected && document.activeElement === variant && variant.value === 'standard';
      accent.focus();
      accent.value = 'custom';
      accent.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(50);
      const customChangePreserved = accent.isConnected && document.activeElement === accent && accent.value === 'custom';
      const customEnabledBeforeBlur = form.elements.customAccentColor.disabled === false;
      const storedBeforeBlur = JSON.parse(localStorage.getItem('xeneon-dashboard-settings') || '{}');
      blurTarget.focus();
      await wait(150);
      const storedAfterBlur = JSON.parse(localStorage.getItem('xeneon-dashboard-settings') || '{}');
      return {
        ready: true,
        connected: variant.isConnected && accent.isConnected,
        focused: document.activeElement === blurTarget,
        valuePreserved: focusedChangePreserved && customChangePreserved
          && document.querySelector('[data-form="theme-studio"]')?.elements?.themeVariant?.value === 'standard'
          && document.querySelector('[data-form="theme-studio"]')?.elements?.accentMode?.value === 'custom',
        customEnabled: document.querySelector('[data-form="theme-studio"]')?.elements?.customAccentColor?.disabled === false,
        customEnabledBeforeBlur,
        storedBeforeBlur: { accentMode: storedBeforeBlur.accentMode, customAccentColor: storedBeforeBlur.customAccentColor },
        storedAfterBlur: { accentMode: storedAfterBlur.accentMode, customAccentColor: storedAfterBlur.customAccentColor },
        errors,
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body.innerText || '')
      };
    })()`,
    "Theme Studio focused change and blur"
  );

  await runProbe(
    `${baseUrl}/dashboard.html?widget=streaming&focusedStreamingTest=1`,
    `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || !document.querySelector('[data-form="streaming"] input[name="obsEndpoint"]'))) await wait(50);
      await wait(750);
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')), true);
      const catalogToggle = document.getElementById('dashboard-panels-toggle');
      catalogToggle?.focus(); catalogToggle?.click(); await wait(50);
      const pickerButton = document.querySelector('#dashboard-widget-picker [data-widget-id="streaming"]');
      pickerButton?.focus();
      pickerButton?.click();
      await wait(150);
      const chromePreserved = !!pickerButton && pickerButton.isConnected && document.activeElement === catalogToggle
        && document.getElementById('dashboard-panels-drawer')?.classList.contains('is-hidden');
      const input = document.querySelector('[data-form="streaming"] input[name="obsEndpoint"]');
      if (!input) return { ready: false, errors };
      input.focus();
      input.value = 'ws://example.test:4455';
      input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await wait(150);
      const connected = input.isConnected;
      const focused = document.activeElement === input;
      const valuePreserved = input.value === 'ws://example.test:4455';
      const openMedia = document.querySelector('[data-action="open-media"]');
      openMedia?.focus();
      openMedia?.click();
      await wait(150);
      return {
        ready: true,
        connected,
        focused,
        valuePreserved,
        chromePreserved,
        teardownSafe: document.getElementById('dashboard-widget-title')?.textContent === 'Audio & Media',
        errors,
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body.innerText || '')
      };
    })()`,
    "Streaming validation redraw"
  );

  await runProbe(
    `${baseUrl}/dashboard.html?widget=privacy&focusedPrivacyTest=1`,
    `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const nextFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (
        document.body?.dataset.bridgeHydrated !== 'true'
        || !document.querySelector('[data-settings-import]')
        || !document.querySelector('[data-action="refresh-diagnostics"]')
        || document.querySelector('[data-action="refresh-diagnostics"]')?.getAttribute('aria-disabled') === 'true'
      )) await wait(50);
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')), true);
      const input = document.querySelector('[data-settings-import]');
      const refresh = document.querySelector('[data-action="refresh-diagnostics"]');
      const root = document.getElementById('dashboard-inline-widget');
      if (!input || !refresh || !root) return { ready: false, errors };
      input.closest('details').open = true;
      refresh.closest('details').open = true;
      input.closest('details').open = true;
      root.scrollTop = 0;
      input.focus({ preventScroll: true });
      input.value = 'draft backup text';
      input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await nextFrames();
      const initialScrollTop = root.scrollTop;
      const snapshot = () => {
        const currentInput = document.querySelector('[data-settings-import]');
        const currentReset = document.querySelector('[data-ui-key="privacy-reset"]');
        const inputRect = input.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        return {
          sameInput: currentInput === input,
          connected: input.isConnected,
          focused: document.activeElement === input,
          resetOpen: currentReset?.open === true,
          valuePreserved: input.value === 'draft backup text',
          rootScrollTop: root.scrollTop,
          contained: inputRect.left >= rootRect.left - 1
            && inputRect.right <= rootRect.right + 1
            && inputRect.top >= rootRect.top - 1
            && inputRect.bottom <= rootRect.bottom + 1,
          activeControl: document.activeElement?.getAttribute('data-ui-key')
            || document.activeElement?.getAttribute('data-action')
            || document.activeElement?.tagName
            || '',
          inputRect: { left: inputRect.left, top: inputRect.top, right: inputRect.right, bottom: inputRect.bottom },
          rootRect: { left: rootRect.left, top: rootRect.top, right: rootRect.right, bottom: rootRect.bottom }
        };
      };
      refresh.click();
      const immediateRefresh = document.querySelector('[data-action="refresh-diagnostics"]');
      const immediate = snapshot();
      const redrawStarted = immediateRefresh?.getAttribute('aria-disabled') === 'true';
      const completionDeadline = Date.now() + 10000;
      let completedRefresh = immediateRefresh;
      while (Date.now() < completionDeadline) {
        completedRefresh = document.querySelector('[data-action="refresh-diagnostics"]');
        if (completedRefresh && completedRefresh.getAttribute('aria-disabled') !== 'true') break;
        await wait(50);
      }
      await nextFrames();
      const completed = snapshot();
      const redrawCompleted = Boolean(completedRefresh && completedRefresh.getAttribute('aria-disabled') !== 'true');
      return {
        ready: true,
        connected: immediate.sameInput && immediate.connected && completed.sameInput && completed.connected,
        focused: immediate.focused && completed.focused,
        valuePreserved: immediate.valuePreserved && completed.valuePreserved,
        detailsOpen: immediate.resetOpen && completed.resetOpen,
        rootScrolled: initialScrollTop > 0 && immediate.rootScrollTop > 0 && completed.rootScrollTop > 0,
        contained: immediate.contained && completed.contained,
        redrawStarted,
        redrawCompleted,
        initialScrollTop,
        immediate,
        completed,
        errors,
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body.innerText || '')
      };
    })()`,
    "Privacy diagnostics redraw"
  );

  await runProbe(
    `${baseUrl}/dashboard.html?widget=setup&focusedCameraDraftTest=1`,
    `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);
      let toggle = document.querySelector('[data-action="toggle-optional-setup"]');
      if (toggle && /show extras/i.test(toggle.textContent || '')) {
        toggle.click();
        await wait(50);
      }
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')), true);
      const input = document.querySelector('[data-setup-section="frigate"] input[name="baseUrl"]');
      const refresh = document.querySelector('[data-action="refresh"]');
      if (!input || !refresh) return { ready: false, errors };
      input.focus();
      input.value = 'http://camera-draft.local:5000';
      refresh.focus();
      refresh.click();
      await wait(900);
      return {
        ready: true,
        connected: input.isConnected,
        focused: document.activeElement === refresh,
        activeControl: document.activeElement?.getAttribute('data-action') || document.activeElement?.tagName || '',
        valuePreserved: input.value === 'http://camera-draft.local:5000',
        errors,
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body.innerText || '')
      };
    })()`,
    "Camera Detection draft refresh"
  );

  console.log("focused Theme Studio, Streaming, Privacy, and Camera Detection redraw reconciliation: passed");
}

async function validateStableRuntimeIsolation(cdp) {
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=privacy&stableRuntimeTest=1` });
  await waitForCommittedUrl(cdp, "stableRuntimeTest=1");
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && !window.InlineWidgets?.runtime?.patchStableDom) await wait(50);
      const runtime = window.InlineWidgets?.runtime;
      if (!runtime) return { ready: false };

      const formHost = document.createElement('div');
      document.body.appendChild(formHost);
      const initial = '<div data-ui-key="drafts"><input name="title" value="model"><textarea name="notes">model</textarea><input type="checkbox" name="enabled"><input type="radio" name="choice" value="a" checked><input type="radio" name="choice" value="b"><select name="target"><option value="one" selected>One</option><option value="two">Two</option></select><input type="range" name="level" value="10"></div><button type="button" data-action="refresh">Refresh</button>';
      runtime.patchStableDom(formHost, initial);
      let noOpMutationCount = 0;
      const noOpObserver = new MutationObserver(records => { noOpMutationCount += records.length; });
      noOpObserver.observe(formHost, { subtree: true, childList: true, attributes: true, characterData: true });
      runtime.patchStableDom(formHost, initial);
      await wait(0);
      noOpObserver.disconnect();
      formHost.querySelector('[name="title"]').value = 'draft title';
      formHost.querySelector('[name="notes"]').value = 'draft notes';
      formHost.querySelector('[name="enabled"]').checked = true;
      formHost.querySelector('[name="choice"][value="a"]').checked = false;
      formHost.querySelector('[name="choice"][value="b"]').checked = true;
      formHost.querySelector('[name="target"]').value = 'two';
      formHost.querySelector('[name="level"]').value = '75';
      const refresh = formHost.querySelector('[data-action="refresh"]');
      refresh.focus();

      const staleModel = '<div data-ui-key="drafts"><input name="title" value="model"><textarea name="notes">model</textarea><input type="checkbox" name="enabled"><input type="radio" name="choice" value="b"><input type="radio" name="choice" value="a" checked><select name="target"><option value="two">Two</option><option value="one" selected>One</option></select><input type="range" name="level" value="10"></div><button type="button" data-action="refresh">Refresh</button>';
      runtime.patchStableDom(formHost, staleModel);
      const dirtyPreserved = {
        title: formHost.querySelector('[name="title"]').value,
        notes: formHost.querySelector('[name="notes"]').value,
        enabled: formHost.querySelector('[name="enabled"]').checked,
        choice: formHost.querySelector('[name="choice"]:checked')?.value || '',
        target: formHost.querySelector('[name="target"]').value,
        level: formHost.querySelector('[name="level"]').value,
        focus: document.activeElement === refresh
      };

      const caughtUpModel = '<div data-ui-key="drafts"><input name="title" value="draft title"><textarea name="notes">draft notes</textarea><input type="checkbox" name="enabled" checked><input type="radio" name="choice" value="b" checked><input type="radio" name="choice" value="a"><select name="target"><option value="two" selected>Two</option><option value="one">One</option></select><input type="range" name="level" value="75"></div><button type="button" data-action="refresh">Refresh</button>';
      runtime.patchStableDom(formHost, caughtUpModel);
      const authoritativeModel = '<div data-ui-key="drafts"><input name="title" value="server title"><textarea name="notes">server notes</textarea><input type="checkbox" name="enabled"><input type="radio" name="choice" value="b"><input type="radio" name="choice" value="a" checked><select name="target"><option value="two">Two</option><option value="one" selected>One</option></select><input type="range" name="level" value="10"></div><button type="button" data-action="refresh">Refresh</button>';
      runtime.patchStableDom(formHost, authoritativeModel);
      const authoritativeApplied = {
        title: formHost.querySelector('[name="title"]').value,
        notes: formHost.querySelector('[name="notes"]').value,
        enabled: formHost.querySelector('[name="enabled"]').checked,
        choice: formHost.querySelector('[name="choice"]:checked')?.value || '',
        target: formHost.querySelector('[name="target"]').value,
        level: formHost.querySelector('[name="level"]').value,
        focus: document.activeElement === refresh
      };
      formHost.remove();

      const mountHost = document.createElement('div');
      document.body.appendChild(mountHost);
      let releaseLate;
      window.InlineWidgets.registerRenderer('late-old', function (_widget, mountRoot) {
        runtime.patchStableDom(mountRoot, '<div data-lifetime="old">Old panel</div>');
        new Promise(resolve => { releaseLate = resolve; }).then(() => {
          runtime.patchStableDom(mountRoot, '<div data-lifetime="late">Late old response</div>');
        });
        return { refresh: () => Promise.resolve(), destroy: () => runtime.patchStableDom(mountRoot, '') };
      });
      window.InlineWidgets.registerRenderer('late-new', function (_widget, mountRoot) {
        runtime.patchStableDom(mountRoot, '<div data-lifetime="new">New panel</div>');
        return { refresh: () => Promise.resolve(), destroy: () => runtime.patchStableDom(mountRoot, '') };
      });
      const oldController = window.InlineWidgets.mountWidget({ id: 'late-old' }, mountHost, {});
      const oldRoot = mountHost.querySelector('[data-inline-widget-mount="late-old"]');
      oldController.destroy();
      const newController = window.InlineWidgets.mountWidget({ id: 'late-new' }, mountHost, {});
      releaseLate();
      await wait(50);
      const lifetime = {
        oldDisconnected: !oldRoot.isConnected,
        newPresent: !!mountHost.querySelector('[data-lifetime="new"]'),
        lateAbsent: !mountHost.querySelector('[data-lifetime="late"]'),
        mountCount: mountHost.querySelectorAll('[data-inline-widget-mount]').length
      };
      newController.destroy();
      mountHost.remove();

      let loopCalls = 0;
      let releaseLoop;
      const serializedLoop = runtime.createTimerLoop(() => {
        loopCalls += 1;
        return new Promise(resolve => { releaseLoop = resolve; });
      }, 0);
      const firstLoopRefresh = serializedLoop.refresh();
      serializedLoop.refresh();
      serializedLoop.refresh();
      const callsWhileBusy = loopCalls;
      releaseLoop();
      await firstLoopRefresh;
      const secondLoopRefresh = serializedLoop.refresh();
      const callsAfterRelease = loopCalls;
      releaseLoop();
      await secondLoopRefresh;
      serializedLoop.destroy();
      return { ready: true, noOpMutationCount, dirtyPreserved, authoritativeApplied, lifetime, loop: { callsWhileBusy, callsAfterRelease } };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const result = evaluation.result?.value || {};
  assert(result.ready, `stable runtime contract did not initialize: ${JSON.stringify(result)}`);
  assert(result.noOpMutationCount === 0, `an unchanged polling sample still mutated the panel DOM: ${JSON.stringify(result)}`);
  assert(JSON.stringify(result.dirtyPreserved) === JSON.stringify({
    title: "draft title", notes: "draft notes", enabled: true, choice: "b", target: "two", level: "75", focus: true
  }), `dirty form state did not survive reordered redraws: ${JSON.stringify(result)}`);
  assert(JSON.stringify(result.authoritativeApplied) === JSON.stringify({
    title: "server title", notes: "server notes", enabled: false, choice: "a", target: "one", level: "10", focus: true
  }), `clean controls did not accept a later authoritative model: ${JSON.stringify(result)}`);
  assert(result.lifetime?.oldDisconnected && result.lifetime?.newPresent && result.lifetime?.lateAbsent && result.lifetime?.mountCount === 1, `late widget work overwrote the next mount: ${JSON.stringify(result)}`);
  assert(result.loop?.callsWhileBusy === 1 && result.loop?.callsAfterRelease === 2, `timer refreshes were not serialized: ${JSON.stringify(result)}`);
  console.log("stable multi-control reconciliation, serialized refresh, and stale-mount isolation: passed");
}

async function validateHomeRefreshStability(cdp) {
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=home&homeRefreshStabilityTest=1` });
  await waitForCommittedUrl(cdp, "homeRefreshStabilityTest=1");
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || !document.querySelector('#dashboard-inline-widget [data-inline-widget-mount="home"] .product-shell'))) await wait(50);

      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px;overflow:hidden';
      document.body.appendChild(host);
      const controller = window.InlineWidgets.mountWidget({ id: 'home', title: 'Home' }, host, {
        bridgeOrigin: location.origin,
        bridgeConfig: { dashboard: {} },
        getSetting: () => '',
        selectWidget: () => {},
        activateScene: () => Promise.resolve()
      });

      while (Date.now() < deadline && (!host.querySelector('.product-shell') || /Loading/i.test(host.querySelector('.widget-status')?.textContent || ''))) await wait(50);
      const mount = host.querySelector('[data-inline-widget-mount="home"]');
      const shell = mount?.querySelector('.product-shell');
      const cards = Array.from(mount?.querySelectorAll('.metric-card') || []);
      const buttons = Array.from(mount?.querySelectorAll('button') || []);
      const editHome = mount?.querySelector('[data-home-open="layout-editor"]');
      editHome?.focus();
      const beforeText = cards.map(card => card.textContent.trim());

      await controller.refresh();
      await controller.refresh();

      const nextMount = host.querySelector('[data-inline-widget-mount="home"]');
      const nextShell = nextMount?.querySelector('.product-shell');
      const nextCards = Array.from(nextMount?.querySelectorAll('.metric-card') || []);
      const nextButtons = Array.from(nextMount?.querySelectorAll('button') || []);
      const result = {
        ready: !!mount && !!shell && cards.length === 4 && buttons.length >= 4,
        mountPreserved: mount === nextMount,
        shellPreserved: shell === nextShell,
        cardsPreserved: cards.length === nextCards.length && cards.every((card, index) => card === nextCards[index]),
        buttonsPreserved: buttons.length === nextButtons.length && buttons.every((button, index) => button === nextButtons[index]),
        focusPreserved: document.activeElement === editHome,
        beforeText,
        afterText: nextCards.map(card => card.textContent.trim()),
        fatal: /Dashboard failed|Dashboard runtime error/i.test(document.body?.innerText || '')
      };
      controller.destroy();
      host.remove();
      return result;
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const result = evaluation.result?.value || {};
  assert(result.ready, `Home refresh stability fixture did not initialize: ${JSON.stringify(result)}`);
  assert(result.mountPreserved && result.shellPreserved && result.cardsPreserved && result.buttonsPreserved, `Home polling replaced stable UI nodes: ${JSON.stringify(result)}`);
  assert(result.focusPreserved, `Home polling stole keyboard focus: ${JSON.stringify(result)}`);
  assert(!result.fatal, `Home polling created a fatal dashboard state: ${JSON.stringify(result)}`);
  console.log("Home telemetry refresh preserves mount, cards, controls, and keyboard focus: passed");
}

async function validateSurfaceStatusOwnership(cdp) {
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=display-controls&surfaceStatusOwnershipTest=1` });
  await waitForCommittedUrl(cdp, "surfaceStatusOwnershipTest=1");
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || !document.querySelector('[data-widget-id="display-controls"]'))) await wait(50);
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')), true);
      let capturedEnv = null;
      window.InlineWidgets.registerRenderer('display-controls', function (_widget, root, env) {
        capturedEnv = env;
        window.InlineWidgets.runtime.patchStableDom(root, '<div data-ui-key="status-owner">Controlled display status</div>');
        return {
          refresh: () => Promise.resolve(),
          destroy: () => window.InlineWidgets.runtime.patchStableDom(root, '')
        };
      });

      document.getElementById('dashboard-panels-toggle')?.click();
      document.querySelector('#dashboard-widget-picker [data-widget-id="display-controls"]')?.click();
      await wait(50);
      if (!capturedEnv) return { ready: false, errors };
      const buttonsBefore = Array.from(document.querySelectorAll('#dashboard-widget-picker [data-widget-id]'));
      capturedEnv.publishStatus('Ready', 'good', 'Owned display status');
      await wait(0);
      const buttonsAfter = Array.from(document.querySelectorAll('#dashboard-widget-picker [data-widget-id]'));
      const activeStatus = {
        heading: document.getElementById('dashboard-widget-title')?.textContent || '',
        source: document.getElementById('dashboard-widget-source')?.textContent || '',
        picker: document.querySelector('[data-widget-id="display-controls"] .router-picker__meta')?.textContent || '',
        nodesPreserved: buttonsBefore.length === buttonsAfter.length && buttonsBefore.every((button, index) => button === buttonsAfter[index])
      };

      document.querySelector('[data-widget-id="network"]')?.click();
      await wait(100);
      const networkBeforeLateWork = {
        heading: document.getElementById('dashboard-widget-title')?.textContent || '',
        source: document.getElementById('dashboard-widget-source')?.textContent || '',
        picker: document.querySelector('[data-widget-id="network"] .router-picker__meta')?.textContent || ''
      };
      capturedEnv.publishStatus('Bogus stale status', 'danger', 'Must be ignored');
      capturedEnv.reportWidgetError(new Error('late stale widget failure'), 'refreshing');
      await wait(100);
      const afterLateWork = {
        heading: document.getElementById('dashboard-widget-title')?.textContent || '',
        source: document.getElementById('dashboard-widget-source')?.textContent || '',
        picker: document.querySelector('[data-widget-id="network"] .router-picker__meta')?.textContent || '',
        staleDisplayStatus: document.querySelector('[data-widget-id="display-controls"] .router-picker__meta')?.textContent || '',
        fatalVisible: /Dashboard failed|Dashboard runtime error|late stale widget failure/.test(document.body.innerText || '')
      };
      return { ready: true, activeStatus, networkBeforeLateWork, afterLateWork, errors };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const result = evaluation.result?.value || {};
  assert(result.ready, `surface status ownership probe did not initialize: ${JSON.stringify(result)}`);
  assert(result.activeStatus?.heading === "Display Controls" && result.activeStatus?.source === "Ready" && result.activeStatus?.picker === "Ready" && result.activeStatus?.nodesPreserved, `active surface status replaced selector controls or missed its owner: ${JSON.stringify(result)}`);
  assert(JSON.stringify(result.networkBeforeLateWork) === JSON.stringify({ heading: "Network", source: "Ready", picker: "Ready" }), `selector activation failed after an active status update: ${JSON.stringify(result)}`);
  assert(JSON.stringify(result.afterLateWork) === JSON.stringify({ heading: "Network", source: "Ready", picker: "Ready", staleDisplayStatus: "Ready", fatalVisible: false }), `late widget status or error work escaped into the next panel: ${JSON.stringify(result)}`);
  assert((result.errors || []).length === 0, `surface status ownership emitted runtime errors: ${JSON.stringify(result.errors || [])}`);
  console.log("widget-generation status ownership and selector click stability: passed");
}

async function validateNonTouchScrollClickAndRailStatus(cdp) {
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=installer&scrollClickTest=1` });
  await waitForCommittedUrl(cdp, "scrollClickTest=1");
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || !document.querySelector('[data-widget-id="setup"]'))) await wait(50);
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')), true);
      const picker = document.getElementById('dashboard-widget-picker');
      document.getElementById('dashboard-panels-toggle')?.click();
      await wait(50);
      const setupButton = document.querySelector('[data-widget-id="setup"]');
      const setupStatus = setupButton?.querySelector('.router-picker__meta')?.textContent || '';
      setupButton?.scrollIntoView({ block: 'nearest' });
      picker?.dispatchEvent(new Event('scroll'));
      await wait(50);
      setupButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await wait(150);
      return {
        ready: !!setupButton,
        setupStatus,
        scrollDispatched: true,
        heading: document.getElementById('dashboard-widget-title')?.textContent || '',
        origin: document.getElementById('dashboard-origin-status')?.textContent || '',
        selection: document.getElementById('dashboard-selection-status')?.textContent || '',
        diagnosticsRailPresent: !!document.getElementById('dashboard-diagnostics-rail'),
        readinessHeading: document.querySelector('[data-inline-widget-mount] .inline-title')?.textContent || '',
        inertCompletionPresent: [...document.querySelectorAll('[data-action="finish-setup"]')].some(button => button.disabled || /Auto ready|Finish manually/.test(button.textContent || '')),
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body.innerText || ''),
        errors
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const result = evaluation.result?.value || {};
  assert(result.ready, `non-touch scroll-click probe did not find Diagnostics: ${JSON.stringify(result)}`);
  assert(result.scrollDispatched, `probe did not exercise a programmatic picker scroll before clicking: ${JSON.stringify(result)}`);
  assert(result.heading === "Diagnostics", `a non-touch scroll swallowed the first Diagnostics click: ${JSON.stringify(result)}`);
  assert(["Ready", "Needs Setup"].includes(result.origin) && result.origin === result.setupStatus, `dashboard chrome disagreed with the live Diagnostics status: ${JSON.stringify(result)}`);
  assert(result.selection === "Diagnostics", `selected panel status was clipped or redundant: ${JSON.stringify(result)}`);
  assert(!result.diagnosticsRailPresent, "the redundant opaque Diagnostics rail card returned");
  assert(result.readinessHeading === "System readiness" && !result.inertCompletionPresent, `Diagnostics rendered a repeated heading or inert setup-completion control: ${JSON.stringify(result)}`);
  assert(!result.fatalVisible && (result.errors || []).length === 0, `scroll-click/status validation emitted a dashboard runtime failure: ${JSON.stringify(result)}`);
  console.log("non-touch scroll click, concise selection, truthful setup status, and rail cleanup: passed");
}

async function validateResetConfirmationExpiry(cdp) {
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?resetExpiryTest=1` });
  await waitForCommittedUrl(cdp, "resetExpiryTest=1");
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      let resetButton = null;
      while (Date.now() < deadline) {
        const setupButton = document.querySelector('[data-widget-id="setup"]');
        if (document.body?.dataset.bridgeHydrated === 'true' && setupButton && !setupButton.classList.contains('is-active')) {
          document.getElementById('dashboard-panels-toggle')?.click();
          setupButton.click();
        }
        resetButton = document.querySelector('#dashboard-inline-widget [data-action="reset-local-data"]');
        if (document.body?.dataset.bridgeHydrated === 'true' && resetButton) break;
        await wait(50);
      }
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')), true);
      const originalFetch = window.fetch;
      let resetPostCount = 0;
      window.fetch = function (url, options) {
        if (String(url).includes('/api/config/reset') && String(options?.method || 'GET').toUpperCase() === 'POST') resetPostCount += 1;
        return originalFetch.apply(this, arguments);
      };
      const initialText = resetButton?.textContent?.trim() || '';
      resetButton?.click();
      await wait(100);
      const armedText = document.querySelector('#dashboard-inline-widget [data-action="reset-local-data"]')?.textContent?.trim() || '';
      const armedCopy = document.querySelector('#dashboard-inline-widget')?.innerText || '';
      await wait(8300);
      resetButton = document.querySelector('#dashboard-inline-widget [data-action="reset-local-data"]');
      const expiredText = resetButton?.textContent?.trim() || '';
      const expiredCopy = document.querySelector('#dashboard-inline-widget')?.innerText || '';
      resetButton?.click();
      await wait(100);
      const rearmedText = document.querySelector('#dashboard-inline-widget [data-action="reset-local-data"]')?.textContent?.trim() || '';
      const refreshButton = document.querySelector('#dashboard-inline-widget [data-action="refresh"]');
      refreshButton?.click();
      await wait(150);
      const cancelledText = document.querySelector('#dashboard-inline-widget [data-action="reset-local-data"]')?.textContent?.trim() || '';
      window.fetch = originalFetch;
      return {
        ready: !!resetButton,
        initialText,
        armedText,
        armedCopy,
        expiredText,
        expiredCopy,
        rearmedText,
        cancelledText,
        resetPostCount,
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body?.innerText || ''),
        errors
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const result = evaluation.result?.value || {};
  assert(result.ready && result.initialText === "Reset local data", `Diagnostics reset expiry probe did not initialize: ${JSON.stringify(result)}`);
  assert(result.armedText === "Confirm reset" && /Tap again within 8 seconds/i.test(result.armedCopy || ""), `Diagnostics reset did not enter a bounded confirmation state: ${JSON.stringify(result)}`);
  assert(result.expiredText === "Reset local data" && /Reset cancelled/i.test(result.expiredCopy || ""), `Diagnostics reset confirmation did not expire safely: ${JSON.stringify(result)}`);
  assert(result.rearmedText === "Confirm reset" && result.cancelledText === "Reset local data", `Diagnostics reset did not re-arm or cancel safely: ${JSON.stringify(result)}`);
  assert(result.resetPostCount === 0, `an expired or cancelled reset confirmation invoked destructive native reset: ${JSON.stringify(result)}`);
  assert(!result.fatalVisible && (result.errors || []).length === 0, `Diagnostics reset expiry emitted a dashboard runtime failure: ${JSON.stringify(result)}`);
  console.log("rendered Diagnostics reset confirmation expiry and cancellation: passed");
}

async function validateBackgroundTerminalStatuses(cdp) {
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=system&backgroundTerminalStatusTest=1` });
  await waitForCommittedUrl(cdp, "backgroundTerminalStatusTest=1");
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 15000;
      let displayStatus = '';
      let displayActive = false;
      while (Date.now() < deadline) {
        const displayButton = document.querySelector('[data-widget-id="display-controls"]');
        displayStatus = displayButton?.querySelector('.router-picker__meta')?.textContent?.trim() || '';
        displayActive = displayButton?.getAttribute('aria-pressed') === 'true';
        if (document.body?.dataset.bridgeHydrated === 'true'
            && displayStatus === 'Available') break;
        await wait(50);
      }
      document.querySelector('[data-destination="settings"]')?.click();
      await wait(50);
      const setupButton = document.querySelector('[data-widget-id="setup"]');
      if (setupButton?.getAttribute('aria-pressed') !== 'true') {
        document.getElementById('dashboard-panels-toggle')?.click();
        setupButton?.click();
      }
      let recoveryStatus = '';
      let recoveryActive = false;
      while (Date.now() < deadline) {
        const recoveryButton = document.querySelector('[data-widget-id="installer"]');
        recoveryStatus = recoveryButton?.querySelector('.router-picker__meta')?.textContent?.trim() || '';
        recoveryActive = recoveryButton?.getAttribute('aria-pressed') === 'true';
        if (['Ready', 'Waiting for display', 'Unavailable'].includes(recoveryStatus)) break;
        await wait(50);
      }
      return {
        hydrated: document.body?.dataset.bridgeHydrated === 'true',
        recoveryStatus,
        displayStatus,
        recoveryActive,
        displayActive,
        fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body?.innerText || '')
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const result = evaluation.result?.value || {};
  assert(result.hydrated && !result.recoveryActive && ['Ready', 'Waiting for display', 'Unavailable'].includes(result.recoveryStatus), `Recovery rail did not resolve without panel activation: ${JSON.stringify(result)}`);
  assert(!result.displayActive && result.displayStatus === 'Available', `Display Controls rail did not expose a terminal Available state without probing DDC/CI: ${JSON.stringify(result)}`);
  assert(!result.fatalVisible, `background feature-status checks collapsed the dashboard: ${JSON.stringify(result)}`);
  console.log("rendered Recovery and Display Controls terminal statuses without activation: passed");
}

async function validateUpdateDowngradeGuard(cdp) {
  await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=updates&downgradeGuardTest=1` });
  await waitForCommittedUrl(cdp, "downgradeGuardTest=1");
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const hydrationDeadline = Date.now() + 20000;
      while (Date.now() < hydrationDeadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')));
      const originalFetch = window.fetch;
      window.fetch = (url, options) => {
        if (String(url).includes('/api/releases/latest')) {
          return Promise.resolve(new Response(JSON.stringify({
            status: 'live',
            channel: 'beta',
            currentVersion: '0.3.0-beta.1',
            latestVersion: 'v0.2.0',
            updateAvailable: false,
            versionComparisonKnown: true,
            versionRelation: 'older',
            downloadAllowed: false,
            htmlUrl: 'https://example.test/releases/v0.2.0',
            installerUrl: 'https://example.test/XenonEdgeHost-Setup-0.2.0.exe',
            macUrl: 'https://example.test/XENEON-Edge-0.2.0.dmg',
            trust: {
              hashStatus: 'available',
              signatureStatus: 'available',
              verificationStatus: 'not-verified',
              trusted: false
            },
            message: 'Latest beta release is v0.2.0.'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return originalFetch(url, options);
      };
      const mountDeadline = Date.now() + 10000;
      let button = document.querySelector('[data-action="check-release"]');
      while (Date.now() < mountDeadline && !button) {
        await wait(50);
        button = document.querySelector('[data-action="check-release"]');
      }
      button?.click();
      const resultDeadline = Date.now() + 10000;
      while (Date.now() < resultDeadline && !/Feed behind/.test(document.querySelector('#dashboard-inline-widget')?.innerText || '')) await wait(50);
      const frame = document.querySelector('#dashboard-inline-widget');
      const frameText = frame?.innerText || '';
      const directLinks = Array.from(frame?.querySelectorAll('a') || []).map(link => ({ text: link.textContent.trim(), href: link.href }));
      const releaseChannel = frame?.querySelector('select[name="releaseChannel"]')?.value || '';
      const hasStableOption = Boolean(frame?.querySelector('option[value="stable"]'));
      window.fetch = originalFetch;
      return { errors, frameText, directLinks, releaseChannel, hasStableOption };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const result = evaluation.result?.value || {};
  assert(result.errors?.length === 0, `update downgrade guard emitted runtime errors: ${JSON.stringify(result.errors || [])}`);
  assert(/Feed behind/.test(result.frameText || ""), `older release feed was not identified: ${JSON.stringify(result)}`);
  assert(/Downgrade links are hidden/.test(result.frameText || ""), "older release feed did not explain the downgrade guard");
  assert(/Not verified/.test(result.frameText || ""), "older unverified release did not retain its trust warning");
  assert(result.releaseChannel === "beta", `beta build did not keep the beta release channel: ${JSON.stringify(result)}`);
  assert(result.hasStableOption === false, "beta build offered an ineffective stable release channel");
  assert(!(result.directLinks || []).some(link => /XenonEdgeHost-Setup-0\.2\.0|XENEON-Edge-0\.2\.0/.test(link.href || "")), `older release exposed a direct download: ${JSON.stringify(result.directLinks || [])}`);
  assert(!(result.directLinks || []).some(link => /Download verified|Open installer asset/.test(link.text || "")), `older release exposed an installer action: ${JSON.stringify(result.directLinks || [])}`);
  console.log("rendered older-feed downgrade guard: passed");
}

async function validateProductSurfaceSemantics(cdp) {
  async function navigateAndEvaluate(widget, marker, expression) {
    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=${widget}&${marker}=1` });
    await waitForCommittedUrl(cdp, `${marker}=1`);
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    assert(!evaluation.exceptionDetails, `${marker} evaluation failed: ${evaluation.exceptionDetails?.exception?.description || evaluation.exceptionDetails?.text || "unknown browser error"}`);
    return evaluation.result?.value || {};
  }

  const layout = await navigateAndEvaluate("layout-editor", "productLayoutTest", `(async () => {
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && document.querySelectorAll('[data-layout-item]').length === 0) await wait(50);
    const rows = Array.from(document.querySelectorAll('[data-layout-item]'));
    const controls = Array.from(document.querySelectorAll('[data-layout-action="earlier"], [data-layout-action="later"], [data-layout-placement], [data-layout-size]'));
    const placements = Array.from(document.querySelectorAll('[data-layout-placement]'));
    const widths = Array.from(document.querySelectorAll('[data-layout-size]'));
    return {
      copy: document.querySelector('#dashboard-inline-widget')?.innerText || '',
      guide: document.querySelector('.product-layout-guide')?.innerText || '',
      listTag: document.querySelector('.product-layout-list')?.tagName || '',
      rowKeys: rows.map(row => row.getAttribute('data-ui-key') || ''),
      positions: rows.map(row => row.querySelector('.product-layout-row__handle strong')?.textContent.trim() || ''),
      labels: controls.map(control => control.getAttribute('aria-label') || ''),
      controlCount: controls.length,
      rowCount: rows.length,
      placementOptions: placements.map(select => Array.from(select.options).map(option => option.value)),
      placementLabels: placements.map(select => Array.from(select.options).map(option => option.textContent.trim())),
      widthOptions: widths.map(select => Array.from(select.options).map(option => option.value)),
      hasLiveStatus: Boolean(document.querySelector('[data-layout-live][aria-live="polite"]')),
      hasOldControls: Boolean(document.querySelector('[data-layout-action="pin"], [data-layout-action="hide"], [data-layout-action="size"]'))
    };
  })()`);
  assert(layout.rowCount > 0 && layout.controlCount === layout.rowCount * 4, `Layout Editor controls did not render coherently: ${JSON.stringify(layout)}`);
  assert(layout.labels.every(Boolean), `Layout Editor exposed unnamed row actions: ${JSON.stringify(layout.labels)}`);
  assert(new Set(layout.labels).size === layout.labels.length, `Layout Editor row action names are ambiguous: ${JSON.stringify(layout.labels)}`);
  assert(layout.listTag === "OL" && layout.positions.every((position, index) => position === String(index + 1)), `Layout Editor did not expose one numbered order: ${JSON.stringify(layout)}`);
  assert(layout.rowKeys.every(Boolean) && new Set(layout.rowKeys).size === layout.rowKeys.length, `Layout Editor rows did not have stable identities: ${JSON.stringify(layout.rowKeys)}`);
  assert(/Editing/i.test(layout.guide) && /Mode/i.test(layout.guide) && /Changes save automatically/i.test(layout.guide), `Layout Editor did not identify the Mode or autosave behavior: ${JSON.stringify(layout.guide)}`);
  assert(layout.placementOptions.every(options => options.includes("home") && options.includes("hidden")) && layout.placementOptions.some(options => options.includes("library")), `Layout Editor placement choices were incomplete: ${JSON.stringify(layout.placementOptions)}`);
  assert(layout.placementLabels.every(labels => labels.includes("Hidden in this Mode") && ["On Home", "Home after setup"].includes(labels[0])), `Layout Editor placement labels did not match their real scope or setup state: ${JSON.stringify(layout.placementLabels)}`);
  assert(layout.widthOptions.every(options => options.join(",") === "compact,standard,wide"), `Layout Editor width was not directly selectable: ${JSON.stringify(layout.widthOptions)}`);
  assert(layout.hasLiveStatus && !layout.hasOldControls, `Layout Editor retained ambiguous controls or omitted saved-change feedback: ${JSON.stringify(layout)}`);
  assert(!/sold or used/i.test(layout.copy || ""), "Layout Editor exposed internal sales-oriented copy");

  const modes = await navigateAndEvaluate("scenes", "productModesTest", `(async () => {
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && document.querySelectorAll('[data-scene-activate]').length === 0) await wait(50);
    const buttons = Array.from(document.querySelectorAll('[data-scene-activate], [data-scene-duplicate]'));
    document.querySelector('[data-scene-duplicate="scene-work"]')?.click();
    const duplicateDeadline = Date.now() + 10000;
    let editForm = null;
    while (Date.now() < duplicateDeadline) {
      editForm = document.querySelector('form[data-scene-edit]');
      if (editForm) break;
      await wait(50);
    }
    const duplicateSnapshot = await fetch('/api/scenes', { cache: 'no-store' }).then(response => response.json());
    let renamed = false;
    let firstDeleteArmed = false;
    let removed = false;
    if (editForm) {
      editForm.elements.name.value = 'Work Touch';
      editForm.elements.themeId.value = 'warm';
      editForm.elements.density.value = 'compact';
      editForm.elements.animationIntensity.value = '47';
      editForm.elements.performanceBudget.value = 'game';
      editForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      const renameDeadline = Date.now() + 10000;
      while (Date.now() < renameDeadline) {
        const saved = await fetch('/api/scenes', { cache: 'no-store' }).then(response => response.json());
        const current = (saved.profiles || []).find(scene => scene && scene.isBuiltIn === false);
        if (current?.name === 'Work Touch' && current.themeId === 'warm' && current.density === 'compact' && current.animationIntensity === 47 && current.performanceBudget === 'game') { renamed = true; break; }
        await wait(50);
      }
      document.querySelector('[data-scene-delete]')?.click();
      const armDeadline = Date.now() + 3000;
      while (Date.now() < armDeadline) {
        const confirmation = document.querySelector('[data-scene-delete]');
        if (confirmation && !confirmation.disabled && /Confirm delete/i.test(confirmation.textContent || '')) { firstDeleteArmed = true; break; }
        await wait(25);
      }
      document.querySelector('[data-scene-delete]:not([disabled])')?.click();
      const deleteDeadline = Date.now() + 10000;
      while (Date.now() < deleteDeadline) {
        if (!document.querySelector('form[data-scene-edit]')) { removed = true; break; }
        await wait(50);
      }
    }
    const finalSnapshot = await fetch('/api/scenes', { cache: 'no-store' }).then(response => response.json());
    return {
      labels: buttons.map(button => button.getAttribute('aria-label') || ''),
      buttonCount: buttons.length,
      duplicateCreatedCustom: (duplicateSnapshot.profiles || []).some(scene => scene && scene.isBuiltIn === false),
      customEditorVisible: Boolean(editForm),
      renamed,
      firstDeleteArmed,
      removed,
      finalCustomCount: (finalSnapshot.profiles || []).filter(scene => scene && scene.isBuiltIn === false).length,
      finalActiveSceneId: finalSnapshot.activeSceneId || ''
    };
  })()`);
  assert(modes.buttonCount >= 8, `Mode controls did not render: ${JSON.stringify(modes)}`);
  assert(modes.labels.every(Boolean), `Modes exposed unnamed actions: ${JSON.stringify(modes.labels)}`);
  assert(new Set(modes.labels).size === modes.labels.length, `Mode action names are ambiguous: ${JSON.stringify(modes.labels)}`);
  assert(modes.duplicateCreatedCustom && modes.customEditorVisible && modes.renamed, `Duplicated Mode could not be edited through the UI: ${JSON.stringify(modes)}`);
  assert(modes.firstDeleteArmed && modes.removed && modes.finalCustomCount === 0 && modes.finalActiveSceneId === "scene-work", `Custom Mode did not use a bounded delete flow or restore the default Mode: ${JSON.stringify(modes)}`);

  const recovery = await navigateAndEvaluate("installer", "productRecoveryTest", `(async () => {
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const deadline = Date.now() + 15000;
    let status = '';
    let actionCount = 0;
    while (Date.now() < deadline) {
      status = document.querySelector('#dashboard-widget-source')?.textContent?.trim() || '';
      actionCount = document.querySelectorAll('[data-recovery-action]').length;
      if (document.body?.dataset.bridgeHydrated === 'true' && actionCount >= 5 && (status === 'Ready' || status === 'Waiting for display')) break;
      await wait(50);
    }
    return {
      status,
      pickerStatus: document.querySelector('[data-widget-id="installer"] .router-picker__meta')?.textContent?.trim() || '',
      detail: document.querySelector('#dashboard-inline-widget [role="status"]')?.textContent?.trim() || '',
      actionCount
    };
  })()`);
  assert(["Ready", "Waiting for display"].includes(recovery.status), `Recovery published an invalid hardware state: ${JSON.stringify(recovery)}`);
  assert(recovery.pickerStatus === recovery.status, `Recovery picker disagreed with its panel: ${JSON.stringify(recovery)}`);
  if (recovery.status === "Waiting for display") {
    assert(/hidden|connect|extend|non-primary|companion/i.test(recovery.detail), `Recovery did not explain the safe no-companion-display state: ${JSON.stringify(recovery)}`);
  }
  assert(recovery.detail.length > 0 && recovery.actionCount >= 5, `Recovery details or actions are incomplete: ${JSON.stringify(recovery)}`);

  const updates = await navigateAndEvaluate("updates", "productUpdatesCopyTest", `(async () => {
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !document.querySelector('[data-form="updates"]')) await wait(50);
    return {
      headerCopy: document.querySelector('#dashboard-widget-copy')?.textContent?.trim() || '',
      frameCopy: document.querySelector('#dashboard-inline-widget')?.innerText || '',
      stableOption: Boolean(document.querySelector('[data-form="updates"] option[value="stable"]'))
    };
  })()`);
  assert(/channels supported by this build/i.test(updates.headerCopy || ""), `Updates header copy is stale: ${JSON.stringify(updates)}`);
  assert(/does not install updates automatically/i.test(updates.frameCopy || ""), "Updates still implies automatic installation");
  assert(updates.stableOption === false, "beta Updates surface exposed Stable after semantic audit");

  const systemPrivacy = await navigateAndEvaluate("system", "systemTelemetryPrivacyTest", `(async () => {
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !document.querySelector('[data-action="system-task-manager"]')) await wait(50);
    const payload = await fetch('/api/system', { cache: 'no-store' }).then(response => response.json());
    return {
      frameCopy: document.querySelector('#dashboard-inline-widget')?.innerText || '',
      exposesTopProcesses: Object.prototype.hasOwnProperty.call(payload || {}, 'topProcesses'),
      taskManagerVisible: Boolean(document.querySelector('[data-action="system-task-manager"]'))
    };
  })()`);
  assert(systemPrivacy.exposesTopProcesses === false, `System API exposed process identity: ${JSON.stringify(systemPrivacy)}`);
  assert(/Privacy-safe telemetry/i.test(systemPrivacy.frameCopy || "") && /without listing running applications or process IDs/i.test(systemPrivacy.frameCopy || ""), `System Monitor did not explain its privacy-safe telemetry boundary: ${JSON.stringify(systemPrivacy)}`);
  assert(!/Top apps right now|PID \d+/i.test(systemPrivacy.frameCopy || "") && systemPrivacy.taskManagerVisible, `System Monitor still exposed process identity or lost the Task Manager handoff: ${JSON.stringify(systemPrivacy)}`);

  const streaming = await navigateAndEvaluate("streaming", "productStreamingTruthTest", `(async () => {
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !document.querySelector('[data-form="streaming"]')) await wait(50);
    const input = document.querySelector('[data-form="streaming"] input[name="obsEndpoint"]');
    const form = document.querySelector('[data-form="streaming"]');
    const initialEndpoint = input?.value || '';
    if (input && form) {
      input.value = 'ws://example.com:4455';
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await wait(100);
    }
    return {
      headerCopy: document.querySelector('#dashboard-widget-copy')?.textContent?.trim() || '',
      frameCopy: document.querySelector('#dashboard-inline-widget')?.innerText || '',
      pickerStatus: document.querySelector('[data-widget-id="streaming"] .router-picker__meta')?.textContent?.trim() || '',
      outerStatus: document.querySelector('#dashboard-widget-source')?.textContent?.trim() || '',
      initialEndpoint
    };
  })()`);
  assert(streaming.pickerStatus === "Preview" && streaming.outerStatus === "Preview", `Streaming was not labeled Preview: ${JSON.stringify(streaming)}`);
  assert(/does not issue OBS commands/i.test((streaming.headerCopy || "") + " " + (streaming.frameCopy || "")), "Streaming did not disclose its commandless beta boundary");
  assert(/Local address required/i.test(streaming.frameCopy || ""), "Streaming accepted a non-loopback OBS endpoint");
  assert(/^ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$/i.test(streaming.initialEndpoint || ""), `Streaming default was not loopback-only: ${JSON.stringify(streaming)}`);

  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const key = 'xeneon-dashboard-settings';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      Object.assign(settings, {
        profileId: 'gaming',
        themeReadability: 'clean',
        performanceBudget: 'game',
        gameModeAutoFace: '0',
        layoutOrder: 'game-mode,system,audio',
        pinnedWidgets: 'game-mode',
        hiddenWidgets: 'weather',
        cardSizes: JSON.stringify({ system: 'wide' }),
        modeLayouts: JSON.stringify({ 'scene-gaming': { layoutOrder: 'game-mode,system,audio', cardSizes: JSON.stringify({ system: 'wide' }) } }),
        marketplacePack: 'gaming',
        obsEndpoint: 'ws://127.0.0.1:4455',
        city: 'private-test-city'
      });
      localStorage.setItem(key, JSON.stringify(settings));
    })()`
  });
  const privacy = await navigateAndEvaluate("privacy", "productPrivacyBackupTest", `(async () => {
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !document.querySelector('[data-action="export-backup"]')) await wait(50);

    window.__auxoraCopiedBackup = '';
    const clipboard = { writeText: async value => { window.__auxoraCopiedBackup = String(value || ''); } };
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    } catch (error) {
      navigator.clipboard.writeText = clipboard.writeText;
    }

    let backupPosts = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (resource, options) {
      const url = typeof resource === 'string' ? resource : String(resource?.url || '');
      if (url.includes('/api/config/backup') && String(options?.method || 'GET').toUpperCase() === 'POST') backupPosts += 1;
      return originalFetch(resource, options);
    };

    document.querySelector('[data-action="export-backup"]').click();
    while (Date.now() < deadline && !window.__auxoraCopiedBackup) await wait(50);
    const exported = JSON.parse(window.__auxoraCopiedBackup || '{}');
    const exportedDashboard = exported.dashboard || {};
    const exportedKeys = Object.keys(exportedDashboard);

    const malformed = JSON.parse(JSON.stringify(exported));
    malformed.dashboard.layoutOrder = { invalid: true };
    let textarea = document.querySelector('[data-settings-import]');
    textarea.value = JSON.stringify(malformed);
    document.querySelector('[data-action="restore-backup"]').click();
    await wait(150);
    const invalidCopy = document.querySelector('#dashboard-inline-widget')?.innerText || '';
    const invalidPostCount = backupPosts;

    const valid = JSON.parse(JSON.stringify(exported));
    valid.dashboard.layoutOrder = 'audio,system';
    valid.dashboard.pinnedWidgets = 'audio';
    textarea = document.querySelector('[data-settings-import]');
    textarea.value = JSON.stringify(valid);
    document.querySelector('[data-action="restore-backup"]').click();
    const restoreDeadline = Date.now() + 15000;
    while (Date.now() < restoreDeadline && !/Auxora backup restored/i.test(document.querySelector('#dashboard-inline-widget')?.innerText || '')) await wait(50);
    const stored = JSON.parse(localStorage.getItem('xeneon-dashboard-settings') || '{}');
    const restoredStatus = document.querySelector('#dashboard-inline-widget')?.innerText || '';
    const mediaToggleInitiallyChecked = Boolean(document.querySelector('[data-media-metadata]')?.checked);
    const audioLabelsInitiallyChecked = Boolean(document.querySelector('[data-audio-session-labels]')?.checked);

    document.querySelector('[data-media-metadata]')?.click();
    const mediaDeadline = Date.now() + 10000;
    while (Date.now() < mediaDeadline && !/Media details visible/i.test(document.querySelector('#dashboard-inline-widget')?.innerText || '')) await wait(50);
    document.querySelector('[data-audio-session-labels]')?.click();
    const labelsDeadline = Date.now() + 10000;
    while (Date.now() < labelsDeadline && !/Audio app labels visible/i.test(document.querySelector('#dashboard-inline-widget')?.innerText || '')) await wait(50);
    const enabledPrivacy = await fetch('/api/config', { cache: 'no-store' }).then(response => response.json());

    document.querySelector('[data-media-metadata]')?.click();
    const privateMediaDeadline = Date.now() + 10000;
    while (Date.now() < privateMediaDeadline && !/Media details private/i.test(document.querySelector('#dashboard-inline-widget')?.innerText || '')) await wait(50);
    document.querySelector('[data-audio-session-labels]')?.click();
    const privateLabelsDeadline = Date.now() + 10000;
    while (Date.now() < privateLabelsDeadline && !/Audio app labels private/i.test(document.querySelector('#dashboard-inline-widget')?.innerText || '')) await wait(50);
    const disabledPrivacy = await fetch('/api/config', { cache: 'no-store' }).then(response => response.json());
    return {
      exportedKeys,
      hasScenes: Boolean(exported.scenes),
      layoutOrder: exportedDashboard.layoutOrder,
      pinnedWidgets: exportedDashboard.pinnedWidgets,
      hiddenWidgets: exportedDashboard.hiddenWidgets,
      cardSizes: exportedDashboard.cardSizes,
      modeLayouts: exportedDashboard.modeLayouts,
      marketplacePack: exportedDashboard.marketplacePack,
      themeReadability: exportedDashboard.themeReadability,
      performanceBudget: exportedDashboard.performanceBudget,
      gameModeAutoFace: exportedDashboard.gameModeAutoFace,
      leaksObsEndpoint: Object.prototype.hasOwnProperty.call(exportedDashboard, 'obsEndpoint'),
      leaksCity: Object.prototype.hasOwnProperty.call(exportedDashboard, 'city'),
      invalidCopy,
      invalidPostCount,
      validPostCount: backupPosts,
      restoredLayoutOrder: stored.layoutOrder,
      restoredPinnedWidgets: stored.pinnedWidgets,
      restoredStatus,
      mediaToggleInitiallyChecked,
      audioLabelsInitiallyChecked,
      enabledMediaMetadata: enabledPrivacy?.dashboard?.mediaMetadataVisible,
      enabledAudioSessionLabels: enabledPrivacy?.dashboard?.audioSessionLabelsVisible,
      disabledMediaMetadata: disabledPrivacy?.dashboard?.mediaMetadataVisible,
      disabledAudioSessionLabels: disabledPrivacy?.dashboard?.audioSessionLabelsVisible,
      mediaPrivacyCopy: document.querySelector('#dashboard-inline-widget')?.innerText || ''
    };
  })()`);
  const requiredPortableKeys = ["layoutOrder", "pinnedWidgets", "hiddenWidgets", "cardSizes", "modeLayouts", "modeLayoutSchemaVersion", "marketplacePack", "themeReadability", "performanceBudget", "gameModeAutoFace"];
  assert(privacy.hasScenes, `Privacy backup omitted Modes: ${JSON.stringify(privacy)}`);
  assert(requiredPortableKeys.every(key => privacy.exportedKeys.includes(key)), `Privacy backup omitted presentation fields: ${JSON.stringify(privacy.exportedKeys)}`);
  assert(privacy.layoutOrder === "game-mode,system,audio" && privacy.pinnedWidgets === "game-mode" && privacy.hiddenWidgets === "weather", `Privacy backup changed layout state: ${JSON.stringify(privacy)}`);
  assert(privacy.marketplacePack === "gaming" && privacy.themeReadability === "clean" && privacy.performanceBudget === "game" && privacy.gameModeAutoFace === "0", `Privacy backup changed product presentation state: ${JSON.stringify(privacy)}`);
  assert(!privacy.leaksObsEndpoint && !privacy.leaksCity, `Privacy backup leaked an excluded connection or location: ${JSON.stringify(privacy)}`);
  assert(/Backup JSON is invalid/i.test(privacy.invalidCopy || "") && privacy.invalidPostCount === 0, `Malformed client settings reached native restore: ${JSON.stringify(privacy)}`);
  assert(privacy.validPostCount === 1 && privacy.restoredLayoutOrder === "audio,system" && privacy.restoredPinnedWidgets === "audio", `Valid presentation backup did not restore completely: ${JSON.stringify(privacy)}`);
  assert(/Auxora backup restored/i.test(privacy.restoredStatus || ""), `Privacy restore did not publish completion: ${JSON.stringify(privacy)}`);
  assert(privacy.mediaToggleInitiallyChecked === false && privacy.audioLabelsInitiallyChecked === false, `Media privacy controls did not default off: ${JSON.stringify(privacy)}`);
  assert(privacy.enabledMediaMetadata === true && privacy.enabledAudioSessionLabels === true, `Media privacy controls did not enable through the production UI: ${JSON.stringify(privacy)}`);
  assert(privacy.disabledMediaMetadata === false && privacy.disabledAudioSessionLabels === false, `Media privacy controls did not return to private defaults: ${JSON.stringify(privacy)}`);
  assert(/Show media titles and artwork on this display \(off by default\)/i.test(privacy.mediaPrivacyCopy || "") && /Show application names in the audio mixer \(off by default\)/i.test(privacy.mediaPrivacyCopy || ""), `Media privacy controls lack clear disclosure: ${JSON.stringify(privacy)}`);
  console.log("rendered product-surface status, copy, and accessible action semantics: passed");
}

async function validateCameraDetection(cdp, mockFrigate) {
  await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?cameraResetTest=1` });
  await waitForCommittedUrl(cdp, "cameraResetTest=1");
  const reset = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);
      const response = await fetch('/api/config/frigate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Xenon-Session': window.XenonSessionToken
        },
        body: JSON.stringify({ baseUrl: '', camera: '', username: '', password: '' })
      });
      return { status: response.status, payload: await response.json() };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  assert(reset.result?.value?.status === 200 && reset.result?.value?.payload?.frigate?.configured === false, `Camera Detection test precondition did not clear saved configuration: ${JSON.stringify(reset.result?.value || {})}`);
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=frigate&cameraSetupTest=1` });
  await waitForCommittedUrl(cdp, "cameraSetupTest=1");
  const discoverable = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);
      const button = document.querySelector('.router-picker__button[data-widget-id="frigate"]');
      const setupAction = document.querySelector('#dashboard-inline-widget [data-action="setup"]');
      const before = {
        activeWidget: document.querySelector('.router-picker__button.is-active')?.getAttribute('data-widget-id') || '',
        activeDestination: document.querySelector('#dashboard-primary-nav button[aria-pressed="true"]')?.getAttribute('data-destination') || '',
        buttonExists: !!button,
        buttonText: button?.innerText || '',
        setupActionText: setupAction?.innerText || '',
        frameText: document.querySelector('#dashboard-inline-widget')?.innerText || '',
        focusedSetupState: !!document.querySelector('#dashboard-inline-widget [data-frigate-setup-state]'),
        renderedDataLayout: !!document.querySelector('#dashboard-inline-widget .inline-camera-layout')
      };
      setupAction?.click();
      const handoffDeadline = Date.now() + 10000;
      let cameraForm = null;
      while (Date.now() < handoffDeadline) {
        cameraForm = document.querySelector('#dashboard-inline-widget form[data-form="frigate"]');
        if (cameraForm && document.activeElement?.getAttribute('name') === 'baseUrl') break;
        await wait(50);
      }
      const cameraCard = cameraForm?.closest('article');
      const optionalGrid = cameraCard?.parentElement;
      const unifiCard = [...(optionalGrid?.children || [])].find(card => /UniFi Network/i.test(card.textContent || ''));
      const optionalCardLayout = {
        alignItems: optionalGrid ? getComputedStyle(optionalGrid).alignItems : '',
        cameraHeight: cameraCard?.getBoundingClientRect().height || 0,
        unifiHeight: unifiCard?.getBoundingClientRect().height || 0
      };
      let firstSubmitPrevented = false;
      let duplicateSubmitPrevented = false;
      let rejectedFeedback = '';
      let rejectedConfig = null;
      const cameraAddress = cameraForm?.querySelector('input[name="baseUrl"]');
      if (cameraForm && cameraAddress) {
        cameraAddress.value = 'http://93.184.216.34:5000/';
        firstSubmitPrevented = !cameraForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        duplicateSubmitPrevented = !cameraForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        const feedbackDeadline = Date.now() + 5000;
        while (Date.now() < feedbackDeadline) {
          rejectedFeedback = document.querySelector('[data-frigate-feedback]')?.textContent?.trim() || '';
          if (rejectedFeedback.toLowerCase().includes('local/private')) break;
          await wait(50);
        }
        rejectedConfig = await fetch('/api/config', { cache: 'no-store' }).then(response => response.json());
      }
      return {
        ...before,
        handoffWidget: document.querySelector('.router-picker__button.is-active')?.getAttribute('data-widget-id') || '',
        handoffDestination: document.querySelector('#dashboard-primary-nav button[aria-pressed="true"]')?.getAttribute('data-destination') || '',
        cameraFormVisible: !!(cameraForm && cameraForm.getClientRects().length),
        focusedName: document.activeElement?.getAttribute('name') || '',
        optionalAction: document.querySelector('#dashboard-inline-widget [data-action="toggle-optional-setup"]')?.innerText || '',
        optionalCardLayout,
        firstSubmitPrevented,
        duplicateSubmitPrevented,
        rejectedFeedback,
        rejectedConfig: rejectedConfig?.frigate || null
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  assert(!discoverable.exceptionDetails, `Camera Detection setup evaluation failed: ${discoverable.exceptionDetails?.exception?.description || discoverable.exceptionDetails?.text || "unknown browser error"}`);
  const discoveryResult = discoverable.result?.value || {};
  assert(discoveryResult.buttonExists && discoveryResult.activeWidget === "frigate" && discoveryResult.activeDestination === "library", `Unconfigured Camera Detection was not discoverable in Apps & Controls: ${JSON.stringify(discoveryResult)}`);
  assert(/Setup/i.test(discoveryResult.buttonText || "") && /Set up Camera Detection/i.test(discoveryResult.setupActionText || ""), `Camera Detection did not present an actionable setup state: ${JSON.stringify(discoveryResult)}`);
  assert(/Camera Detection needs setup/i.test(discoveryResult.frameText || ""), `Camera Detection did not explain its unconfigured state: ${JSON.stringify(discoveryResult)}`);
  assert(/Not updated/i.test(discoveryResult.frameText || "") && /Waiting for setup/i.test(discoveryResult.frameText || "") && !/Fresh Frigate sample/i.test(discoveryResult.frameText || ""), `Unconfigured Camera Detection reported a nonexistent fresh sample: ${JSON.stringify(discoveryResult)}`);
  assert(discoveryResult.focusedSetupState && !discoveryResult.renderedDataLayout && !/Last hour|Latest snapshot|No event snapshot/i.test(discoveryResult.frameText || ""), `Unconfigured Camera Detection rendered fake zero metrics or an empty data dashboard: ${JSON.stringify(discoveryResult)}`);
  assert(discoveryResult.handoffWidget === "setup" && discoveryResult.handoffDestination === "settings", `Camera Detection setup action did not open Diagnostics: ${JSON.stringify(discoveryResult)}`);
  assert(discoveryResult.cameraFormVisible && discoveryResult.focusedName === "baseUrl" && /Hide extras/i.test(discoveryResult.optionalAction || ""), `Camera Detection setup action did not reveal and focus the Frigate form: ${JSON.stringify(discoveryResult)}`);
  assert(discoveryResult.optionalCardLayout?.alignItems === "start" && discoveryResult.optionalCardLayout.unifiHeight > 0 && discoveryResult.optionalCardLayout.unifiHeight + 80 < discoveryResult.optionalCardLayout.cameraHeight, `Diagnostics stretched the short UniFi integration into an opaque Camera-form-height panel: ${JSON.stringify(discoveryResult)}`);
  assert(discoveryResult.firstSubmitPrevented && discoveryResult.duplicateSubmitPrevented, `Camera Detection did not cancel both the active and duplicate form submissions: ${JSON.stringify(discoveryResult)}`);
  assert(/local\/private/i.test(discoveryResult.rejectedFeedback || ""), `Camera Detection did not show the rejected endpoint beside the form: ${JSON.stringify(discoveryResult)}`);
  assert(discoveryResult.rejectedConfig?.configured === false, `Rejected Camera Detection endpoint changed saved configuration: ${JSON.stringify(discoveryResult)}`);
  const configured = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);
      const response = await fetch('/api/config/frigate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Xenon-Session': window.XenonSessionToken
        },
        body: JSON.stringify({
          baseUrl: ${JSON.stringify(mockFrigate.baseUrl)},
          camera: 'garage',
          username: 'viewer',
          password: 'rendered-test-password'
        })
      });
      const payload = await response.json();
      const testResponse = await fetch('/api/frigate/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Xenon-Session': window.XenonSessionToken
        },
        body: '{}'
      });
      const connection = await testResponse.json();
      const health = await fetch('/api/health', { cache: 'no-store' }).then(result => result.json());
      const config = await fetch('/api/config', { cache: 'no-store' }).then(result => result.json());
      return {
        status: response.status,
        testStatus: testResponse.status,
        payload,
        connection,
        healthCapability: health?.capabilities?.frigate,
        healthState: health?.setup?.items?.frigate?.state,
        healthConnected: health?.setup?.items?.frigate?.connected,
        configFrigate: config?.frigate
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const configResult = configured.result?.value || {};
  assert(configResult.status === 200, `Camera Detection configuration failed: ${JSON.stringify(configResult)}`);
  assert(configResult.testStatus === 200 && configResult.connection?.connected === true && configResult.connection?.state === "Ready", `Camera Detection connection test failed: ${JSON.stringify(configResult)}`);
  assert(configResult.payload?.frigate?.configured === true, "Camera Detection configuration was not persisted");
  assert(configResult.payload?.frigate?.authenticationConfigured === true, "Camera Detection authentication was not persisted");
  assert(configResult.healthCapability === true && configResult.healthState === "Ready" && configResult.healthConnected === true, `Camera Detection health did not reflect the verified connection: ${JSON.stringify(configResult)}`);
  assert(configResult.configFrigate?.configured === true, `Camera Detection config snapshot did not reflect configuration: ${JSON.stringify(configResult)}`);
  assert(configResult.configFrigate?.username === "viewer" && configResult.configFrigate?.authenticationConfigured === true, `Camera Detection config did not expose redacted authentication state: ${JSON.stringify(configResult)}`);
  assert(!Object.prototype.hasOwnProperty.call(configResult.configFrigate || {}, "password"), "Camera Detection config leaked its password");

  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=frigate&cameraRenderedTest=1` });
  await waitForCommittedUrl(cdp, "cameraRenderedTest=1");
  const deadline = Date.now() + 20000;
  let probe = {};
  while (Date.now() < deadline) {
    const evaluated = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const viewer = document.querySelector('#dashboard-inline-widget');
        const snapshot = viewer?.querySelector('.inline-camera-preview img');
        return {
          hydrated: document.body?.dataset.bridgeHydrated === 'true',
          fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body?.innerText || ''),
          location: location.href,
          activeWidget: document.querySelector('.router-picker__button.is-active')?.getAttribute('data-widget-id') || '',
          frigateButtonExists: !!document.querySelector('.router-picker__button[data-widget-id="frigate"]'),
          activeDestination: document.querySelector('#dashboard-primary-nav button[aria-pressed="true"]')?.getAttribute('data-destination') || '',
          rendererMounted: !!viewer?.querySelector('.inline-camera-layout'),
          frameText: viewer?.innerText || '',
          imageComplete: !!snapshot?.complete,
          imageWidth: snapshot?.naturalWidth || 0
        };
      })()`,
      returnByValue: true
    });
    probe = evaluated.result?.value || {};
    if (/person on garage/i.test(probe.frameText || "") && probe.imageWidth > 0) break;
    await delay(200);
  }
  assert(probe.hydrated, `Camera Detection dashboard did not hydrate: ${JSON.stringify(probe)}`);
  assert(!probe.fatalVisible, "Camera Detection collapsed the dashboard into a fatal error surface");
  assert(probe.rendererMounted, `Camera Detection native production renderer was not mounted: ${JSON.stringify(probe)}`);
  assert(/person on garage/i.test(probe.frameText || ""), `Camera Detection event did not render: ${JSON.stringify(probe)}`);
  assert(/driveway/i.test(probe.frameText || ""), "Camera Detection zone did not render");
  assert(probe.imageComplete && probe.imageWidth > 0, "Camera Detection proxied snapshot did not render");
  assert(mockFrigate.requests.events > 0, "Camera Detection did not call the Frigate events API");
  assert(mockFrigate.requests.snapshots > 0, "Camera Detection did not call the Frigate snapshot API");
  assert(mockFrigate.requests.login > 0, "Camera Detection did not authenticate to Frigate");
  assert(mockFrigate.requests.unauthorized === 0, `Camera Detection sent unauthenticated upstream requests: ${JSON.stringify(mockFrigate.requests)}`);
  assert(/\"user\":\"viewer\"/.test(mockFrigate.requests.loginBody) && /\"password\":\"rendered-test-password\"/.test(mockFrigate.requests.loginBody), "Camera Detection sent an invalid Frigate login payload");

  await delay(3300);
  mockFrigate.setMode("slow-offline");
  const eventsBeforeFailure = mockFrigate.requests.events;
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const refresh = document.querySelector('#dashboard-inline-widget [data-action="refresh"]');
      refresh?.click();
      refresh?.click();
    })()`
  });
  const failureDeadline = Date.now() + 10000;
  let failureProbe = {};
  while (Date.now() < failureDeadline) {
    const evaluated = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const viewer = document.querySelector('#dashboard-inline-widget');
        return {
          text: viewer?.innerText || '',
          fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body?.innerText || ''),
          refreshCount: viewer?.querySelectorAll('[data-action="refresh"]').length || 0
        };
      })()`,
      returnByValue: true
    });
    failureProbe = evaluated.result?.value || {};
    if (/Connection lost/i.test(failureProbe.text || "") && /Cached after connection loss/i.test(failureProbe.text || "")) break;
    await delay(100);
  }
  const upstreamFailureAttempts = mockFrigate.requests.events - eventsBeforeFailure;
  assert(upstreamFailureAttempts >= 1 && upstreamFailureAttempts <= 3, `Camera Detection native retry attempts were not bounded: ${JSON.stringify(mockFrigate.requests)}`);
  assert(/Connection lost/i.test(failureProbe.text || "") && /last successful local update/i.test(failureProbe.text || "") && /Cached after connection loss/i.test(failureProbe.text || ""), `Camera Detection did not label retained data after connection loss: ${JSON.stringify(failureProbe)}`);
  assert(/person on garage/i.test(failureProbe.text || ""), "Camera Detection discarded its last successful local result during a temporary outage");
  assert(!failureProbe.fatalVisible && failureProbe.refreshCount === 1, `Camera Detection failure handling destabilized the panel: ${JSON.stringify(failureProbe)}`);

  mockFrigate.setMode("live");
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      document.querySelector('#dashboard-inline-widget [data-action="refresh"]')?.click();
    })()`
  });
  const recoveryDeadline = Date.now() + 10000;
  let recoveryProbe = {};
  while (Date.now() < recoveryDeadline) {
    const evaluated = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const text = document.querySelector('#dashboard-inline-widget')?.innerText || '';
        return { text, fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body?.innerText || '') };
      })()`,
      returnByValue: true
    });
    recoveryProbe = evaluated.result?.value || {};
    if (/Fresh Frigate sample/i.test(recoveryProbe.text || "") && !/Connection lost|Cached after connection loss/i.test(recoveryProbe.text || "")) break;
    await delay(100);
  }
  assert(/Fresh Frigate sample/i.test(recoveryProbe.text || "") && !/Connection lost|Cached after connection loss/i.test(recoveryProbe.text || ""), `Camera Detection did not recover to fresh state: ${JSON.stringify(recoveryProbe)}`);
  assert(!recoveryProbe.fatalVisible, "Camera Detection reconnect collapsed the dashboard into a fatal surface");
  console.log("rendered authenticated Camera Detection live, connection-loss cache, serialized refresh, and reconnect: passed");
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
  assert(probe.quickOptionalHidden, `${viewport.name}: unavailable optional Lights control remained visible in Quick controls`);
  assert(probe.undersizedText.length === 0, `${viewport.name}: visible text below 12px: ${probe.undersizedText.join(", ")}`);
  assert(probe.clippedPrimaryNavLabels.length === 0, `${viewport.name}: primary navigation labels are clipped: ${probe.clippedPrimaryNavLabels.join(", ")}`);
  assert(probe.undersizedControls.length === 0, `${viewport.name}: controls below 44px: ${probe.undersizedControls.join(", ")}`);
  if (viewport.width >= 1800 && viewport.height >= 600) {
    assert(probe.distanceUndersizedControls.length === 0, `${viewport.name}: distance controls below 54px: ${probe.distanceUndersizedControls.join(", ")}`);
    assert(probe.distanceSmallControlText.length === 0, `${viewport.name}: distance control labels below 15px: ${probe.distanceSmallControlText.join(", ")}`);
  }
  assert(probe.unnamedControls.length === 0, `${viewport.name}: unnamed controls: ${probe.unnamedControls.join(", ")}`);
}

async function validateFavoritesNavigation(cdp) {
  const expectedIds = [
    "audio", "calendar", "clipboard", "display-controls", "frigate", "game-mode", "home", "hue",
    "installer", "layout-editor", "marketplace", "network", "privacy", "quick-actions", "remote",
    "scenes", "setup", "shortcuts", "streaming", "system", "theme-studio", "updates", "weather"
  ];
  const defaults = ["system", "audio", "network", "quick-actions"];
  const storageKey = "auxora-dashboard-favorites-v1";
  for (const { width, height } of [{ width: 800, height: 480 }, { width: 720, height: 480 }, { width: 390, height: 844 }, { width: 2560, height: 720 }]) {
    await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const marker = `favoritesNavigationTest=${width}`;
    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=system&${marker}` });
    await waitForCommittedUrl(cdp, marker);
    if (width === 800) {
      await cdp.send("Runtime.evaluate", {
        expression: `(async () => { const deadline = Date.now() + 12000; while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || document.querySelectorAll('#dashboard-favorites [data-widget-id]').length !== 4)) await new Promise(resolve => setTimeout(resolve, 50)); })()`,
        awaitPromise: true
      });
      const artifactDirectory = mkdtempSync(join(tmpdir(), "auxora-favorites-defaults-"));
      const screenshotPath = join(artifactDirectory, "favorites-defaults-800x480.png");
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      console.log(`default favorites screenshot: ${screenshotPath}`);
      await cdp.send("Runtime.evaluate", {
        expression: `(async () => {
          const toggle = document.getElementById('dashboard-panels-toggle'); toggle.focus(); toggle.click();
          document.getElementById('dashboard-widget-picker').scrollTop = 0;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`, awaitPromise: true
      });
      const catalogScreenshotPath = join(artifactDirectory, "all-panels-800x480.png");
      const catalogScreenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(catalogScreenshotPath, Buffer.from(catalogScreenshot.data, "base64"));
      console.log(`All panels screenshot: ${catalogScreenshotPath}`);
      await cdp.send("Runtime.evaluate", {
        expression: `document.querySelector('#dashboard-panels-drawer [data-panels-close]').click()`
      });
    }
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const check = (value, message) => { if (!value) throw new Error(message); };
        const favoriteIds = () => [...document.querySelectorAll('#dashboard-favorites [data-widget-id]')].map(node => node.dataset.widgetId);
        const storedIds = () => JSON.parse(localStorage.getItem('${storageKey}') || 'null');
        const visible = node => !!node && !node.closest('[hidden], [aria-hidden="true"], .is-hidden') && node.getClientRects().length > 0;
        const target = async node => {
          check(visible(node), 'Missing visible control: ' + node?.outerHTML);
          node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await frames();
          const rect = node.getBoundingClientRect();
          const minSize = ${width} >= 1800 ? 54 : 44;
          check(rect.width >= minSize && rect.height >= minSize, 'Small target: ' + node.outerHTML + ' ' + JSON.stringify(rect));
          check(rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, 'Clipped target: ' + node.outerHTML);
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent); const box = parent.getBoundingClientRect();
            if (['auto', 'hidden', 'scroll', 'clip'].includes(style.overflowX)) check(rect.left >= box.left - 1 && rect.right <= box.right + 1, 'Control clipped by horizontal scrollport: ' + node.outerHTML);
            if (['auto', 'hidden', 'scroll', 'clip'].includes(style.overflowY)) check(rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1, 'Control clipped by vertical scrollport: ' + node.outerHTML);
          }
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          check(hit && (node === hit || node.contains(hit)), 'Covered target: ' + node.outerHTML + '; hit ' + hit?.outerHTML);
          const label = node.querySelector('.router-picker__title') || node;
          const range = document.createRange(); range.selectNodeContents(label);
          const text = range.getBoundingClientRect();
          check(text.left >= rect.left - 1 && text.right <= rect.right + 1 && text.top >= rect.top - 1 && text.bottom <= rect.bottom + 1 && label.scrollWidth <= label.clientWidth + 1, 'Clipped control label: ' + node.outerHTML);
          check(parseFloat(getComputedStyle(label).fontSize) >= (${width} >= 1800 ? 15 : 12), 'Unreadable control label: ' + node.outerHTML);
          check(Boolean(node.getAttribute('aria-label') || node.textContent.trim()), 'Unnamed control');
          node.focus(); check(document.activeElement === node, 'Control cannot receive focus: ' + node.outerHTML);
        };
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || favoriteIds().length !== 4)) await wait(50);
        check(document.body?.dataset.bridgeHydrated === 'true', 'Dashboard did not hydrate');
        const drawer = document.getElementById('dashboard-panels-drawer');
        const toggle = document.getElementById('dashboard-panels-toggle');
        const picker = document.getElementById('dashboard-widget-picker');
        check(JSON.stringify(favoriteIds()) === '${JSON.stringify(defaults)}', 'Incorrect default favorites: ' + JSON.stringify(favoriteIds()));
        check(drawer?.classList.contains('is-hidden') && toggle?.getAttribute('aria-expanded') === 'false', 'Catalog must start closed: ' + JSON.stringify({ drawerClass: drawer?.className, toggleExpanded: toggle?.getAttribute('aria-expanded') }));
        if (${width} === 800 || ${width} === 720) {
          const favorites = document.getElementById('dashboard-favorites'); const viewport = favorites.getBoundingClientRect();
          check(favorites.scrollWidth <= favorites.clientWidth + 1, 'Default favorites require scrolling at companion width: ' + JSON.stringify({ scroll: favorites.scrollWidth, client: favorites.clientWidth }));
          for (const button of favorites.querySelectorAll('[data-widget-id]')) {
            const box = button.getBoundingClientRect();
            check(box.left >= viewport.left - 1 && box.right <= viewport.right + 1, 'Default favorite not immediately visible: ' + button.dataset.widgetId);
          }
        }
        for (const button of document.querySelectorAll('#dashboard-favorites [data-widget-id]')) await target(button);
        await target(toggle);
        const viewer = document.querySelector('.router-viewer__frame-shell').getBoundingClientRect();
        check(viewer.height >= 140 && viewer.bottom <= innerHeight + 1, 'Favorites consumed usable panel space: ' + JSON.stringify(viewer));
        toggle.click(); await frames();
        check(visible(drawer) && drawer.getAttribute('role') === 'dialog' && drawer.getAttribute('aria-modal') === 'true' && drawer.contains(document.activeElement), 'All panels did not open as a focused modal');
        check(document.querySelector('.router-rail').inert && document.querySelector('.router-viewer').inert, 'Catalog did not isolate background controls');
        const ids = [...picker.querySelectorAll('[data-widget-id]')].filter(visible).map(node => node.dataset.widgetId).sort();
        check(JSON.stringify(ids) === '${JSON.stringify(expectedIds)}', 'Catalog lost a panel: ' + JSON.stringify(ids));
        for (const button of drawer.querySelectorAll('button:not([disabled])')) await target(button);
        const focusable = [...drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(visible);
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        first.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        check(document.activeElement === last, 'Shift+Tab escaped the All panels dialog');
        last.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        check(document.activeElement === first, 'Tab escaped the All panels dialog');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await frames();
        check(!visible(drawer) && document.activeElement === toggle && !document.querySelector('.router-rail').inert && !document.querySelector('.router-viewer').inert, 'Escape did not close catalog and return focus');
        toggle.click(); await frames();
        document.getElementById('dashboard-panels-scrim').click(); await frames();
        check(!visible(drawer) && document.activeElement === toggle, 'Catalog scrim did not close and return focus');
        toggle.click(); await frames();
        const extra = picker.querySelector('[data-favorite-widget="weather"]');
        extra.click(); await frames();
        check(JSON.stringify(favoriteIds()) === '${JSON.stringify(defaults)}' && extra.getAttribute('aria-pressed') === 'false', 'More than four favorites were allowed');
        const remove = picker.querySelector('[data-favorite-widget="network"]');
        await target(remove); remove.click(); await frames();
        check(!favoriteIds().includes('network') && favoriteIds().length === 3 && drawer.contains(document.activeElement), 'Removing a favorite lost dialog focus or failed');
        const add = picker.querySelector('[data-favorite-widget="weather"]');
        await target(add); add.click(); await frames();
        check(favoriteIds().join('|') === 'system|audio|quick-actions|weather' && JSON.stringify(storedIds()) === JSON.stringify(favoriteIds()), 'Edited favorites were not persisted');
        const open = picker.querySelector('[data-widget-id="calendar"]');
        await target(open); open.click(); await frames();
        check(!visible(drawer) && document.activeElement === toggle && open.getAttribute('aria-pressed') === 'true', 'Opening a nonfavorite did not close catalog, restore focus, and select the panel');
        const quick = document.getElementById('dashboard-quick-toggle');
        quick.focus(); quick.click(); await frames();
        check(visible(document.getElementById('dashboard-quick-drawer')), 'Quick controls failed after catalog use');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await frames();
        check(document.activeElement === quick, 'Quick controls failed focus recovery after catalog use');
        toggle.focus(); toggle.click(); await frames();
        // Exercise the lock state transition while a modal is open; physical background input remains inert.
        document.getElementById('dashboard-touch-lock-toggle').click(); await frames();
        check(document.body.classList.contains('dashboard-native-page--touch-locked') && !visible(drawer) && drawer.inert && document.activeElement?.id === 'dashboard-touch-unlock', 'Touch Lock left catalog open or focus behind the lock');
        document.getElementById('dashboard-touch-unlock').click(); await frames();
        check(!document.querySelector('.router-rail').inert && !document.querySelector('.router-viewer').inert && !document.body.classList.contains('dashboard-native-page--touch-locked'), 'Unlock did not recover navigation');
        check(document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1, 'Favorites caused page overflow');
        check((window.__auxoraRenderedRuntimeErrors || []).length === 0, 'Favorites navigation emitted runtime errors');
        return { ids, favorites: favoriteIds(), stored: storedIds(), viewerHeight: viewer.height };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (width === 800 || evaluation.exceptionDetails) {
      const artifactDirectory = mkdtempSync(join(tmpdir(), "auxora-favorites-layout-"));
      const screenshotPath = join(artifactDirectory, `favorites-${width}x${height}${evaluation.exceptionDetails ? "-failure" : ""}.png`);
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      console.log(`favorites layout screenshot: ${screenshotPath}`);
    }
    assert(!evaluation.exceptionDetails, `favorites ${width}x${height}: ${evaluation.exceptionDetails?.exception?.description || JSON.stringify(evaluation.exceptionDetails)}`);
    const result = evaluation.result?.value;
    assert(result?.ids.length === 23 && result.favorites.join("|") === "system|audio|quick-actions|weather", `favorites test produced no navigation evidence: ${JSON.stringify(result)}`);
    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=system&favoritesReloadTest=${width}` });
    await waitForCommittedUrl(cdp, `favoritesReloadTest=${width}`);
    const reload = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await new Promise(resolve => setTimeout(resolve, 50));
        return [...document.querySelectorAll('#dashboard-favorites [data-widget-id]')].map(node => node.dataset.widgetId);
      })()`, awaitPromise: true, returnByValue: true
    });
    assert(JSON.stringify(reload.result?.value) === JSON.stringify(result.favorites), `favorites ${width}x${height}: edits did not survive reload: ${JSON.stringify(reload.result?.value)}`);
    console.log(`rendered favorites and All panels ${width}x${height}: passed; 23 panels, editable four favorites, persistence, keyboard trap, focus return, lock, and target geometry`);
  }
  for (const invalid of ["{broken", JSON.stringify({ ids: ["system"] }), JSON.stringify(["unknown", "system", "system", 7, "audio", "network", "quick-actions", "weather"])]) {
    await cdp.send("Runtime.evaluate", { expression: `localStorage.setItem('${storageKey}', ${JSON.stringify(invalid)})` });
    const marker = `favoritesInvalidStorageTest=${encodeURIComponent(invalid)}`;
    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=system&${marker}` });
    await waitForCommittedUrl(cdp, "favoritesInvalidStorageTest=");
    const probe = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await new Promise(resolve => setTimeout(resolve, 50));
        const ids = [...document.querySelectorAll('#dashboard-favorites [data-widget-id]')].map(node => node.dataset.widgetId);
        return { ids, errors: window.__auxoraRenderedRuntimeErrors || [], fatal: /Dashboard failed|Dashboard runtime error/.test(document.body.innerText || '') };
      })()`, awaitPromise: true, returnByValue: true
    });
    const result = probe.result?.value;
    assert(result && !result.fatal && result.errors.length === 0 && JSON.stringify(result.ids) === JSON.stringify(defaults), `invalid favorites did not safely normalize/fall back: ${JSON.stringify(result)}`);
  }
  await cdp.send("Runtime.evaluate", { expression: `(async () => {
    const settings = JSON.parse(localStorage.getItem('xeneon-dashboard-settings') || '{}');
    const config = await fetch('/api/config').then(response => response.json());
    const layouts = {};
    for (const scene of config.scenes?.profiles || []) layouts[scene.id] = { hiddenWidgets: 'weather' };
    layouts[config.scenes?.activeSceneId || 'scene-work'] = { hiddenWidgets: 'weather' };
    settings.modeLayouts = JSON.stringify(layouts);
    settings.modeLayoutSchemaVersion = '2';
    settings.hiddenWidgets = 'weather';
    localStorage.setItem('xeneon-dashboard-settings', JSON.stringify(settings));
    localStorage.setItem('${storageKey}', JSON.stringify(['system', 'audio', 'quick-actions', 'weather']));
  })()`, awaitPromise: true });
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=privacy&favoritesRemovalResetTest=1` });
  await waitForCommittedUrl(cdp, "favoritesRemovalResetTest=1");
  const removalReset = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const check = (value, message) => { if (!value) throw new Error(message); };
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || !document.querySelector('[data-action="reset-all-local-data"]'))) await wait(50);
      const toggle = document.getElementById('dashboard-panels-toggle');
      const drawer = document.getElementById('dashboard-panels-drawer');
      toggle.focus(); toggle.click(); await wait(50);
      const hiddenPanel = drawer.querySelector('[data-widget-id="weather"]');
      const remove = drawer.querySelector('[data-favorite-widget="weather"]');
      check(hiddenPanel?.disabled && remove?.getAttribute('aria-pressed') === 'true' && !document.querySelector('#dashboard-favorites [data-widget-id="weather"]'), 'Hidden favorite must remain removable without becoming an active shortcut: ' + JSON.stringify({ disabled: hiddenPanel?.disabled, kept: remove?.getAttribute('aria-pressed'), shortcut: !!document.querySelector('#dashboard-favorites [data-widget-id="weather"]') }));
      remove.scrollIntoView({ block: 'nearest' }); remove.focus(); remove.click(); await wait(50);
      check(!remove.isConnected && !drawer.querySelector('[data-favorite-widget="weather"]') && drawer.contains(document.activeElement), 'Removing an unavailable favorite lost keyboard focus');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50);
      check(document.activeElement === toggle, 'Hidden favorite removal broke Escape focus return');
      const resetDisclosure = document.querySelector('[data-ui-key="privacy-reset"] > summary');
      resetDisclosure?.click();
      const originalFetch = window.fetch;
      let resetRequests = 0;
      window.fetch = function (input, options) {
        const url = new URL(typeof input === 'string' ? input : input.url || input, location.href);
        if (url.origin === location.origin && url.pathname === '/api/config/reset' && String(options?.method || 'GET').toUpperCase() === 'POST') {
          resetRequests += 1;
          return Promise.resolve(new Response(JSON.stringify({ ok: true, message: 'Isolated rendered reset fixture' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return originalFetch.apply(this, arguments);
      };
      try {
        let reset = document.querySelector('[data-action="reset-all-local-data"]');
        check(reset?.textContent.trim() === 'Reset all app data', 'Privacy reset control unavailable');
        reset.scrollIntoView({ block: 'nearest' }); reset.focus(); reset.click(); await wait(50);
        reset = document.querySelector('[data-action="reset-all-local-data"]');
        check(reset?.textContent.trim() === 'Confirm reset' && resetRequests === 0, 'Privacy reset skipped confirmation');
        reset.click();
        const resetDeadline = Date.now() + 12000;
        while (Date.now() < resetDeadline && document.getElementById('dashboard-widget-title')?.textContent !== 'Diagnostics') await wait(50);
        const favorites = [...document.querySelectorAll('#dashboard-favorites [data-widget-id]')].map(node => node.dataset.widgetId);
        check(resetRequests === 1 && JSON.stringify(favorites) === '${JSON.stringify(defaults)}' && localStorage.getItem('${storageKey}') === null, 'Privacy reset did not clear in-memory and stored favorites: ' + JSON.stringify({ resetRequests, favorites, stored: localStorage.getItem('${storageKey}') }));
        return { favorites, resetRequests, errors: window.__auxoraRenderedRuntimeErrors || [] };
      } finally { window.fetch = originalFetch; }
    })()`, awaitPromise: true, returnByValue: true
  });
  assert(!removalReset.exceptionDetails && removalReset.result?.value?.resetRequests === 1 && removalReset.result.value.errors.length === 0, `hidden favorite removal/privacy reset regression: ${removalReset.exceptionDetails?.exception?.description || JSON.stringify(removalReset.result?.value)}`);
  console.log("hidden favorite removal retains dialog focus; confirmed Privacy reset clears in-memory and stored favorites without a native reset request: passed");
  await cdp.send("Page.navigate", { url: "about:blank" });
  await waitForCommittedUrl(cdp, "about:blank");
  await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  console.log("corrupt, wrong-shaped, duplicate, unknown, and over-limit favorite storage: passed");
}

// This fixture is installed before dashboard scripts. Every audio/media request,
// including unexpected mutation paths, terminates here instead of reaching Windows.
function installQuickControlsFixture() {
  if (!location.search.includes("quickControlsTest=")) return;
  localStorage.setItem("auxora-now-strip-mode", "hidden");
  const originalFetch = window.fetch;
  const fixture = window.__quickControlsFixture = {
    audio: { supported: true, configured: true, status: "live", stale: false, masterVolume: 42, muted: false, defaultDeviceId: "fixture-speakers", devices: [], sessions: [] },
    media: { supported: true, configured: true, status: "live", stale: false, playbackStatus: "playing", canPlay: true, canPause: true, title: "Local fixture track", appId: "fixture-player" },
    reads: { audio: 0, media: 0 },
    writes: [],
    held: [],
    holdNext: {},
    failReads: {},
    failNextWrite: false,
    writeDelay: 140,
    aborted: 0,
    unexpected: []
  };
  const snapshot = kind => ({ sampledAt: new Date().toISOString(), ...fixture[kind] });
  const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = function (input, options) {
    const url = new URL(typeof input === "string" ? input : input.url || input, location.href);
    const method = String(options?.method || input?.method || "GET").toUpperCase();
    if (url.origin === location.origin && url.pathname === "/api/health" && method === "GET") {
      return originalFetch.apply(this, arguments).then(async result => {
        const payload = await result.json();
        payload.capabilities = { ...payload.capabilities, audio: true, media: true };
        return response(payload, result.status);
      });
    }
    const match = /^\/api\/(audio|media)(?:\/|$)/.exec(url.pathname);
    if (!match) return originalFetch.apply(this, arguments);
    const kind = match[1];
    if (method === "GET" && url.pathname === "/api/" + kind) {
      fixture.reads[kind] += 1;
      if (fixture.failReads[kind]) return Promise.resolve(response({ message: "Fixture read unavailable" }, 503));
      if (fixture.holdNext[kind]) {
        fixture.holdNext[kind] = false;
        const payload = snapshot(kind);
        return new Promise(resolveRead => {
          // Deliberately allow a late completion even after abort, to prove that
          // a stale generation cannot overwrite a newer observation.
          const signal = options?.signal || input?.signal;
          if (signal) signal.addEventListener("abort", () => { fixture.aborted += 1; }, { once: true });
          fixture.held.push({ kind, release: () => resolveRead(response(payload)) });
        });
      }
      return Promise.resolve(response(snapshot(kind)));
    }
    if (method === "POST") {
      let body;
      try { body = JSON.parse(options?.body || "{}"); } catch { body = null; }
      fixture.writes.push({ path: url.pathname, body });
      const fail = fixture.failNextWrite;
      fixture.failNextWrite = false;
      return new Promise(resolveWrite => setTimeout(() => {
        if (fail) { resolveWrite(response({ message: "Fixture action failed" }, 503)); return; }
        if (url.pathname === "/api/audio/master-volume") fixture.audio.masterVolume = body?.volume;
        else if (url.pathname === "/api/audio/master-mute") fixture.audio.muted = body?.muted;
        else if (url.pathname === "/api/media/pause") fixture.media.playbackStatus = "paused";
        else if (url.pathname === "/api/media/play") fixture.media.playbackStatus = "playing";
        else { fixture.unexpected.push({ path: url.pathname, method }); resolveWrite(response({ message: "Blocked unexpected fixture action" }, 400)); return; }
        resolveWrite(response(snapshot(kind)));
      }, fixture.writeDelay));
    }
    fixture.unexpected.push({ path: url.pathname, method });
    return Promise.resolve(response({ message: "Blocked unexpected fixture endpoint" }, 400));
  };
}

async function checkQuickControlsInPage(deep) {
  const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
  const frames = () => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const until = async (predicate, message, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (!predicate() && Date.now() < deadline) await wait(25);
    check(predicate(), message);
  };
  const query = selector => document.querySelector(selector);
  await until(() => document.body?.dataset.bridgeHydrated === "true", "Dashboard bridge did not hydrate");
  const fixture = window.__quickControlsFixture;
  check(fixture, "Preboot audio/media isolation fixture was not installed");
  const drawer = query("#dashboard-quick-drawer");
  const opener = query("#dashboard-quick-toggle");
  const volume = query("#dashboard-quick-volume");
  const output = query("#dashboard-quick-volume-value");
  const mute = query("#dashboard-quick-mute");
  const playback = query("#dashboard-quick-playback");
  const audioStatus = query("#dashboard-quick-audio-status");
  const mediaStatus = query("#dashboard-quick-media-status");
  const close = drawer?.querySelector("[data-quick-close]");
  const ready = node => !node.disabled && node.getAttribute("aria-disabled") !== "true";
  check(drawer && opener && volume && output && mute && playback && audioStatus && mediaStatus && close, "Quick controls contract is incomplete");
  check(volume.type === "range" && volume.min === "0" && volume.max === "100" && volume.step === "1", "Volume range must use whole percentages from 0 to 100");
  check(audioStatus.getAttribute("aria-live") === "polite" && mediaStatus.getAttribute("aria-live") === "polite", "Quick state feedback must announce updates politely");
  check(volume.disabled && mute.disabled && playback.disabled, "Hidden Quick controls were enabled without a fresh drawer read");
  const selectedBefore = query("#dashboard-widget-title")?.textContent;
  const openDrawer = async () => { opener.focus(); opener.click(); await frames(); check(!drawer.classList.contains("is-hidden"), "Quick controls did not open"); };
  const closeDrawer = async () => { close.click(); await frames(); check(drawer.classList.contains("is-hidden") && document.activeElement === opener, "Quick close did not return keyboard focus"); };
  const refresh = async () => { await closeDrawer(); await openDrawer(); await wait(80); };
  await openDrawer();
  await until(() => !volume.disabled && !mute.disabled && !playback.disabled, "Fresh fixture observations did not enable direct controls");
  check(Number(volume.value) === 42 && /42/.test(output.textContent), "Initial volume did not reflect the observed endpoint");
  check(/^mute$/i.test(mute.textContent.trim()), "Unmuted audio should offer Mute");
  check(/pause/i.test(playback.textContent), "Playing media should offer Pause");
  check(drawer.contains(document.activeElement), "Quick drawer did not receive keyboard focus");
  const visible = node => node && !node.closest(".is-hidden,[hidden],[aria-hidden=true]") && getComputedStyle(node).display !== "none" && node.getBoundingClientRect().width > 0;
  const controls = [...drawer.querySelectorAll("button,input,select,[tabindex]")].filter(node => !node.disabled && node.tabIndex >= 0 && visible(node));
  const targetMinimum = innerWidth >= 1800 && innerHeight >= 600 ? 54 : 44;
  for (const node of controls) {
    node.scrollIntoView({ block: "center", inline: "nearest" }); await frames();
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const name = node.getAttribute("aria-label") || [...(node.labels || [])].map(label => label.textContent).join(" ") || node.textContent;
    check(name?.trim(), "Unnamed Quick control: " + node.outerHTML);
    check(rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 && hit && (node === hit || node.contains(hit)), "Unreachable Quick control: " + node.id + " " + name);
    check(rect.width >= targetMinimum && rect.height >= targetMinimum, "Undersized Quick control: " + node.id + " " + name + " " + rect.width + "x" + rect.height);
    node.focus(); check(document.activeElement === node, "Quick control cannot receive focus: " + name);
    if (node.tagName === "BUTTON") {
      const range = document.createRange(); range.selectNodeContents(node);
      const textRect = range.getBoundingClientRect();
      check(textRect.left >= rect.left - 1 && textRect.right <= rect.right + 1 && textRect.top >= rect.top - 1 && textRect.bottom <= rect.bottom + 1 && node.scrollWidth <= node.clientWidth + 1, "Clipped Quick button label: " + name);
      if (targetMinimum === 54) check(parseFloat(getComputedStyle(node).fontSize) >= 15, "Distance Quick label is below 15px: " + name);
    }
  }
  controls.at(-1).focus();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  check(document.activeElement === controls[0], "Quick Tab navigation escaped the modal");
  controls[0].focus();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  check(document.activeElement === controls.at(-1), "Quick reverse Tab navigation escaped the modal");
  check(document.documentElement.scrollWidth <= innerWidth + 1, "Quick controls introduced horizontal document overflow");
  check(fixture.writes.length === 0, "Opening or observing Quick controls changed audio/media");

  if (deep) {
    const initialReads = fixture.reads.audio;
    await until(() => fixture.reads.audio > initialReads, "Open Quick controls did not poll current audio", 6000);
    check(fixture.writes.length === 0, "Polling sent an audio/media mutation");
    volume.focus(); volume.value = "67"; volume.dispatchEvent(new Event("input", { bubbles: true }));
    check(/67/.test(output.textContent) && fixture.writes.length === 0, "Volume input must preview without sending");
    volume.dispatchEvent(new Event("change", { bubbles: true }));
    check(volume.getAttribute("aria-disabled") === "true" && document.activeElement === volume, "Pending volume commit must preserve focus and expose its disabled state");
    volume.dispatchEvent(new Event("change", { bubbles: true }));
    mute.click(); playback.click();
    await until(() => ready(volume) && Number(volume.value) === 67, "Committed volume was not confirmed by a fresh snapshot");
    check(fixture.writes.length === 1 && fixture.writes[0].path === "/api/audio/master-volume" && fixture.writes[0].body?.volume === 67, "Volume commit or duplicate-action protection failed: " + JSON.stringify(fixture.writes));
    mute.click(); mute.click();
    await until(() => ready(mute) && /^unmute$/i.test(mute.textContent.trim()), "Mute was not confirmed");
    check(fixture.writes.length === 2 && fixture.writes[1].path === "/api/audio/master-mute" && fixture.writes[1].body?.muted === true, "Mute must send one explicit true state");
    check(/unmute/i.test(mute.textContent), "Muted state should offer Unmute");
    mute.click();
    await until(() => ready(mute) && /^mute$/i.test(mute.textContent.trim()), "Unmute was not confirmed");
    check(fixture.writes.length === 3 && fixture.writes[2].body?.muted === false, "Unmute must send an explicit false state");
    playback.click(); playback.click();
    await until(() => ready(playback) && /^play$/i.test(playback.textContent.trim()), "Pause did not update the observed playback state");
    check(fixture.writes.length === 4 && fixture.writes[3].path === "/api/media/pause", "Pause must send one explicit pause, not a toggle");
    playback.click();
    await until(() => ready(playback) && /pause/i.test(playback.textContent), "Play did not update the observed playback state");
    check(fixture.writes.length === 5 && fixture.writes[4].path === "/api/media/play", "Play must send an explicit play, not a toggle");

    // Invalid endpoint states may still be returned with HTTP 200. None grants
    // authority to change a device or guess the media action.
    const invalidAudio = [
      { masterVolume: null }, { masterVolume: "42" }, { masterVolume: -1 }, { masterVolume: 101 },
      { muted: "false" }, { defaultDeviceId: "" }, { supported: false }, { configured: false },
      { status: "stale" }, { stale: true }, { sampledAt: "not-a-date" },
      { sampledAt: new Date(Date.now() - 9000).toISOString() }
    ];
    const goodAudio = { ...fixture.audio };
    for (const invalid of invalidAudio) {
      fixture.audio = { ...goodAudio, ...invalid }; await refresh();
      check(volume.disabled && mute.disabled && audioStatus.textContent.trim(), "Invalid audio state enabled mutation: " + JSON.stringify(invalid));
    }
    fixture.audio = goodAudio;
    const invalidMedia = [
      { playbackStatus: "unknown" }, { playbackStatus: "idle" }, { playbackStatus: "playing", canPause: false },
      { playbackStatus: "paused", canPlay: false }, { playbackStatus: "stopped", canPlay: false },
      { supported: false }, { configured: false }, { status: "stale" }, { stale: true },
      { sampledAt: new Date(Date.now() - 21000).toISOString() }
    ];
    const goodMedia = { ...fixture.media };
    for (const invalid of invalidMedia) {
      fixture.media = { ...goodMedia, ...invalid }; await refresh();
      check(playback.disabled && mediaStatus.textContent.trim(), "Invalid or uncontrollable media enabled mutation: " + JSON.stringify(invalid));
    }
    fixture.media = { ...goodMedia, playbackStatus: "stopped" }; await refresh();
    await until(() => !playback.disabled, "Stopped controllable media should offer Play");
    check(/^play$/i.test(playback.textContent.trim()), "Stopped media offered the wrong explicit action");
    fixture.media = goodMedia; await refresh();
    await until(() => !volume.disabled && !playback.disabled, "Valid endpoints did not recover");
    check(fixture.writes.length === 5, "State refreshes or invalid payloads sent a mutation");

    fixture.failReads.audio = true;
    await until(() => volume.disabled && mute.disabled, "Failed polling retained enabled stale audio controls", 6000);
    fixture.failReads.audio = false;
    await until(() => !volume.disabled && !mute.disabled, "Fresh polling did not recover after a read failure", 6000);
    fixture.failNextWrite = true;
    mute.click(); mute.click();
    await until(() => fixture.writes.length === 6, "Failed action was not sent");
    await wait(fixture.writeDelay + 50);
    check(mute.disabled && /fail|unable|could|unavailable|confirm/i.test(audioStatus.textContent), "Failed action did not invalidate the old observation: " + audioStatus.textContent);
    await until(() => !mute.disabled, "Fresh read did not recover after a failed action", 6000);
    check(fixture.writes.length === 6, "A failed mutation was retried");

    await closeDrawer();
    fixture.audio.masterVolume = 19; fixture.holdNext.audio = true;
    const heldBefore = fixture.held.length;
    await openDrawer();
    await until(() => fixture.held.length > heldBefore, "Reopening Quick did not request fresh audio");
    check(volume.disabled && mute.disabled, "Reopening reused a previously fresh observation before its new read");
    await closeDrawer();
    check(fixture.aborted > 0, "Closing Quick did not cancel its in-flight read");
    fixture.audio.masterVolume = 81;
    await openDrawer();
    await until(() => !volume.disabled && Number(volume.value) === 81, "Reopen did not use the new endpoint state");
    fixture.held[heldBefore].release(); await wait(100);
    check(Number(volume.value) === 81, "Late pre-close response overwrote the latest volume");

    // A polling read can also race an action in the same drawer generation.
    fixture.audio.masterVolume = 13; fixture.holdNext.audio = true;
    const actionHeldBefore = fixture.held.length;
    await until(() => fixture.held.length > actionHeldBefore, "Could not hold the pre-action polling read", 6000);
    volume.value = "74"; volume.dispatchEvent(new Event("input", { bubbles: true }));
    volume.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => fixture.writes.length === 7 && ready(volume) && Number(volume.value) === 74, "Action did not invalidate its older polling read");
    fixture.held[actionHeldBefore].release(); await wait(100);
    check(Number(volume.value) === 74 && fixture.writes.length === 7, "Pre-action late read overwrote committed state or caused a replay");

    fixture.writeDelay = 500;
    mute.click();
    await until(() => fixture.writes.length === 8, "Could not begin the close/reopen action fixture");
    await closeDrawer(); await openDrawer();
    check(!ready(mute) && !ready(playback), "Reopening allowed a second action while the first was unsettled");
    mute.click(); playback.click();
    await until(() => ready(mute), "Pending action did not settle after close/reopen");
    check(fixture.writes.length === 8 && /^unmute$/i.test(mute.textContent.trim()), "Closing or reopening canceled, replayed, or overlapped a received action");

    await closeDrawer();
    const closedReads = fixture.reads.audio;
    await wait(2400);
    check(fixture.reads.audio === closedReads, "Closed Quick drawer continued polling audio");
    query("#dashboard-touch-lock-toggle").click(); await frames();
    const writesBeforeLock = fixture.writes.length;
    opener.click(); mute.click(); playback.click();
    volume.dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
    check(drawer.classList.contains("is-hidden") && fixture.writes.length === writesBeforeLock, "Touch Lock allowed a Quick action");
    query("#dashboard-touch-unlock").click(); await frames();
    await openDrawer();
    await until(() => !volume.disabled && !playback.disabled, "Quick controls did not recover after Touch Lock");
  }
  check(query("#dashboard-widget-title")?.textContent === selectedBefore, "Direct controls navigated away from the selected panel");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await frames();
  check(drawer.classList.contains("is-hidden") && document.activeElement === opener, "Escape did not close Quick and restore its opener");
  query("#dashboard-panels-toggle").click(); await frames();
  check(!query("#dashboard-panels-drawer").classList.contains("is-hidden") && document.querySelectorAll("#dashboard-widget-picker [data-widget-id]").length >= 23, "Quick controls broke access to All panels");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await frames();
  check(fixture.unexpected.length === 0, "Unexpected audio/media endpoint was safely blocked: " + JSON.stringify(fixture.unexpected));
  check((window.__auxoraRenderedRuntimeErrors || []).length === 0, "Quick controls emitted runtime errors: " + JSON.stringify(window.__auxoraRenderedRuntimeErrors));
  return { controls: controls.length, writes: fixture.writes.length, aborted: fixture.aborted, deep };
}

async function validateQuickControls(cdp) {
  const fixture = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installQuickControlsFixture.toString()})()` });
  try {
    for (const { width, height } of [{ width: 800, height: 480 }, { width: 720, height: 480 }, { width: 390, height: 844 }, { width: 2560, height: 720 }]) {
      await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const marker = `quickControlsTest=${width}`;
      await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=privacy&${marker}` });
      await waitForCommittedUrl(cdp, marker);
      const evaluation = await cdp.send("Runtime.evaluate", {
        expression: `(${checkQuickControlsInPage.toString()})(${width === 800})`, awaitPromise: true, returnByValue: true
      });
      if (width === 800 || evaluation.exceptionDetails) {
        const artifactDirectory = mkdtempSync(join(tmpdir(), "auxora-quick-controls-"));
        const screenshotPath = join(artifactDirectory, `quick-${width}x${height}${evaluation.exceptionDetails ? "-failure" : ""}.png`);
        // Keep the successful screenshot useful instead of capturing the closed drawer.
        if (!evaluation.exceptionDetails) await cdp.send("Runtime.evaluate", { expression: "document.getElementById('dashboard-quick-toggle').click()" });
        await delay(150);
        const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
        console.log(`Quick controls screenshot: ${screenshotPath}`);
      }
      assert(!evaluation.exceptionDetails, `Quick controls ${width}x${height}: ${evaluation.exceptionDetails?.exception?.description || JSON.stringify(evaluation.exceptionDetails)}`);
      const result = evaluation.result?.value;
      assert(result?.controls > 0, `Quick controls returned no verification evidence at ${width}x${height}`);
      console.log(`rendered Quick controls ${width}x${height}: passed; ${result.controls} accessible controls, ${result.writes} fixture-only actions${result.deep ? ", state validation, single-send, failures, late reads, cancellation and Touch Lock" : ""}`);
    }
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: fixture.identifier });
    await cdp.send("Page.navigate", { url: "about:blank" });
    await waitForCommittedUrl(cdp, "about:blank");
    await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  }
}

async function validateCompactChrome(cdp) {
  const fixture = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      if (!location.search.includes('compactChromeTest=')) return;
      localStorage.setItem('auxora-now-strip-mode', 'pinned');
      const nativeFetch = window.fetch;
      window.fetch = function (input, options) {
        const url = new URL(typeof input === 'string' ? input : input.url || input, location.href);
        const method = String(options?.method || input?.method || 'GET').toUpperCase();
        if (url.origin === location.origin && url.pathname === '/api/media' && method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify({
            title: 'Compact layout test track', artist: 'Local test fixture', playbackStatus: 'playing'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return nativeFetch.apply(this, arguments);
      };
    })()`
  });
  try {
    for (const { width, height } of [{ width: 800, height: 480 }, { width: 720, height: 480 }, { width: 390, height: 844 }]) {
      const portrait = height > width;
      await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const marker = `compactChromeTest=${width}`;
      await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=privacy&${marker}` });
      await waitForCommittedUrl(cdp, marker);
      const evaluation = await cdp.send("Runtime.evaluate", {
        expression: `(async () => {
          const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
          const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const check = (value, message) => { if (!value) throw new Error(message); };
          const query = selector => document.querySelector(selector);
          const rect = node => node.getBoundingClientRect();
          const describe = node => {
            if (!node) return null;
            const r = rect(node); const style = getComputedStyle(node);
            return { tag: node.tagName, id: node.id, className: node.className, rect: { x: r.x, y: r.y, width: r.width, height: r.height },
              position: style.position, zIndex: style.zIndex, overflow: style.overflow, transform: style.transform,
              backdropFilter: style.backdropFilter, gridRows: style.gridTemplateRows, scrollTop: node.scrollTop, scrollHeight: node.scrollHeight };
          };
          const diagnose = node => {
            if (!node) return { missing: true };
            const r = rect(node); const ancestors = [];
            for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.push(describe(parent));
            return { control: describe(node), hit: describe(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)), ancestors };
          };
          const inside = node => { const r = rect(node); return r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; };
          const reachable = node => { const r = rect(node); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return inside(node) && !!hit && (node === hit || node.contains(hit)); };
          const target = node => { check(node && reachable(node), 'Unreachable control: ' + JSON.stringify(diagnose(node))); check(rect(node).width >= 44 && rect(node).height >= 44, 'Undersized control: ' + JSON.stringify(diagnose(node))); };
          const deadline = Date.now() + 12000;
          while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || query('#dashboard-now-strip strong')?.textContent !== 'Compact layout test track')) await wait(50);
          check(document.body?.dataset.bridgeHydrated === 'true', 'Dashboard bridge did not hydrate');
          check(document.body?.dataset.layoutClass === '${portrait ? "portrait" : "compact"}', 'Expected responsive layout was not activated');
          const nav = [...document.querySelectorAll('#dashboard-primary-nav button')];
          const viewer = query('.router-viewer__frame-shell');
          const availableHeight = rect(viewer).height;
          let previousHeight = null; let recoveredHeight = null;
          if (!${portrait}) {
          check(nav.length === 4, 'All four navigation destinations must remain available');
          check(nav.map(node => node.textContent.trim()).join('|') === 'Home|Modes|Apps & Controls|Settings', 'Navigation labels changed');
          check(nav.every(node => Math.abs(rect(node).top - rect(nav[0]).top) <= 1), 'Navigation must occupy one row');
          nav.forEach(node => {
            target(node);
            const range = document.createRange(); range.selectNodeContents(node);
            const text = range.getBoundingClientRect(); const box = rect(node);
            check(text.left >= box.left && text.right <= box.right && text.top >= box.top && text.bottom <= box.bottom && node.scrollWidth <= node.clientWidth + 1, 'Clipped navigation label: ' + node.textContent);
            node.focus(); check(document.activeElement === node, 'Navigation cannot receive focus');
          });
          check(inside(viewer) && availableHeight >= 140, 'Insufficient usable viewer height: ' + availableHeight);
          const previousLayout = document.createElement('style');
          previousLayout.textContent = '.dashboard-native-page--adaptive.dashboard-native-page--layout-compact .auxora-primary-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } .dashboard-native-page--adaptive.dashboard-native-page--layout-compact .router-rail { grid-template-rows: auto auto auto; } .dashboard-native-page--adaptive.dashboard-native-page--layout-compact .router-rail__lower { grid-row: 3; }';
          document.head.append(previousLayout); await frames();
          previousHeight = rect(viewer).height;
          previousLayout.remove(); await frames();
          recoveredHeight = rect(viewer).height - previousHeight;
          check(recoveredHeight >= 44, 'Compact layout did not recover one touch row: ' + recoveredHeight);
          }
          const options = query('#dashboard-settings-toggle'); target(options); options.focus(); options.click(); await frames();
          const panel = query('#dashboard-settings-panel');
          check(options.getAttribute('aria-expanded') === 'true' && getComputedStyle(panel).position === 'fixed' && inside(panel), 'Panel options overlay escaped viewport');
          for (const selector of ['#dashboard-opacity-slider', '#dashboard-readability-select', '#dashboard-budget-select']) {
            const control = query(selector); check(control, 'Missing option: ' + selector);
            control.scrollIntoView({ block: 'center' }); await frames(); target(control);
            control.focus(); check(document.activeElement === control, 'Option cannot receive focus: ' + selector);
          }
          // Options is nonmodal: keyboard users can still open the modal Quick drawer.
          const nestedQuick = query('#dashboard-quick-toggle'); const nestedDrawer = query('#dashboard-quick-drawer');
          nestedQuick.focus(); check(document.activeElement === nestedQuick, 'Quick toggle lost keyboard reachability with options open');
          nestedQuick.click(); await frames();
          check(inside(nestedDrawer) && nestedDrawer.contains(document.activeElement), 'Quick drawer failed over open options');
          target(nestedDrawer.querySelector('[data-quick-close]'));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frames();
          check(nestedDrawer.classList.contains('is-hidden') && document.activeElement === nestedQuick, 'Quick drawer did not close and restore focus over options');
          check(options.getAttribute('aria-expanded') === 'true' && panel.classList.contains('is-open'), 'Closing Quick unexpectedly closed options');
          const resumedOption = query('#dashboard-opacity-slider'); resumedOption.scrollIntoView({ block: 'center' }); await frames(); target(resumedOption);
          target(options); options.click(); await frames();
          check(options.getAttribute('aria-expanded') === 'false' && panel.classList.contains('is-collapsed'), 'Panel options did not close');
          const quick = query('#dashboard-quick-toggle'); const drawer = query('#dashboard-quick-drawer');
          for (const closeWithEscape of [false, true]) {
            target(quick); quick.focus(); quick.click(); await frames();
            check(inside(drawer) && drawer.contains(document.activeElement), 'Quick drawer geometry or initial focus failed');
            const close = drawer.querySelector('[data-quick-close]'); target(close);
            if (closeWithEscape) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); else close.click();
            await frames();
            check(drawer.classList.contains('is-hidden') && quick.getAttribute('aria-expanded') === 'false' && document.activeElement === quick, 'Quick drawer did not close and restore focus');
          }
          if (${portrait}) {
            check(inside(viewer) && availableHeight >= 140, 'Portrait media header left insufficient usable content: ' + JSON.stringify(diagnose(viewer)));
            for (const selector of ['.router-viewer__header', '#dashboard-widget-title', '.router-viewer__header-actions']) check(inside(query(selector)), 'Portrait media header escaped viewport: ' + JSON.stringify(diagnose(query(selector))));
          }
          const strip = query('#dashboard-now-strip'); const pin = strip.querySelector('[data-now-strip-action="pin"]');
          check(inside(strip) && !strip.classList.contains('is-hidden') && pin.textContent === 'Auto', 'Pinned media strip is missing');
          [...strip.querySelectorAll('button')].forEach(target);
          const actionTextFits = () => [...strip.querySelectorAll('button:not(.dashboard-now-strip__open)')].forEach(node => {
            const range = document.createRange(); range.selectNodeContents(node);
            const text = range.getBoundingClientRect(); const box = rect(node);
            check(text.left >= box.left && text.right <= box.right && text.top >= box.top && text.bottom <= box.bottom && node.scrollWidth <= node.clientWidth + 1, 'Clipped media action: ' + JSON.stringify(diagnose(node)));
          });
          actionTextFits();
          const mediaBox = rect(strip); const viewerBox = rect(viewer);
          check(mediaBox.bottom <= viewerBox.top + 1 || mediaBox.top >= viewerBox.bottom - 1, 'Pinned media overlaps widget content');
          pin.click(); await frames(); check(localStorage.getItem('auxora-now-strip-mode') === 'auto' && pin.textContent === 'Keep', 'Media Auto transition failed'); actionTextFits();
          pin.click(); await frames(); check(localStorage.getItem('auxora-now-strip-mode') === 'pinned' && pin.textContent === 'Auto', 'Media Keep transition failed');
          check((window.__auxoraRenderedRuntimeErrors || []).length === 0, 'Compact interactions emitted runtime errors');
          return { availableHeight, previousHeight, recoveredHeight, navHeight: rect(nav[0]).height, portraitOptions: ${portrait} };
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      if (width === 800 || portrait || evaluation.exceptionDetails) {
        const artifactDirectory = mkdtempSync(join(tmpdir(), "auxora-compact-layout-"));
        const screenshotPath = join(artifactDirectory, `compact-${width}x${height}${evaluation.exceptionDetails ? "-failure" : ""}.png`);
        const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
        console.log(`compact layout screenshot: ${screenshotPath}`);
      }
      assert(!evaluation.exceptionDetails, `responsive chrome ${width}x${height}: ${evaluation.exceptionDetails?.exception?.description || JSON.stringify(evaluation.exceptionDetails)}`);
      const result = evaluation.result?.value;
      if (portrait) {
        assert(result?.portraitOptions === true, `portrait options returned no interaction evidence: ${JSON.stringify(result)}`);
        console.log(`rendered portrait options and pinned media ${width}x${height}: passed; viewer ${result.availableHeight}px, header/actions, options controls, combined Quick drawer, close and focus return`);
        continue;
      }
      assert(result?.recoveredHeight >= 44, `compact ${width}x480 returned no geometry evidence: ${JSON.stringify(result)}`);
      const dismissed = await cdp.send("Runtime.evaluate", {
        expression: `(() => { document.querySelector('[data-now-strip-action="dismiss"]').click(); return localStorage.getItem('auxora-now-strip-mode') === 'hidden' && document.querySelector('#dashboard-now-strip').classList.contains('is-hidden'); })()`,
        returnByValue: true
      });
      assert(dismissed.result?.value === true, `compact ${width}x480: media dismissal failed`);
      console.log(`rendered compact chrome ${width}x480: passed; viewer ${result.availableHeight}px, recovered ${result.recoveredHeight}px; options, Quick focus, pinned media`);
    }
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: fixture.identifier });
    await cdp.send("Page.navigate", { url: "about:blank" });
    await waitForCommittedUrl(cdp, "about:blank");
    await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  }
}

async function validateAllVisibleProductSurfaces(cdp, viewport) {
  const marker = `allSurfaceAudit=${encodeURIComponent(viewport.name)}`;
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=home&${marker}` });
  await waitForCommittedUrl(cdp, marker);

  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const nextFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const transientStatus = /Loading|Refreshing|Checking|Measuring|Monitoring/i;
      const runtimeCaptureReady = Array.isArray(window.__auxoraRenderedRuntimeErrors);
      const errors = runtimeCaptureReady ? window.__auxoraRenderedRuntimeErrors : [];
      let consumedErrorCount = 0;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);

      const visible = element => {
        if (!element || element.closest('[hidden], [aria-hidden="true"], .is-hidden')) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number.parseFloat(style.opacity || '1') > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const renderedText = element => {
        if (!element) return '';
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const parts = [];
        while (walker.nextNode()) {
          const parent = walker.currentNode.parentElement;
          if (!parent || parent.closest('svg, [aria-hidden="true"]') || !visible(parent)) continue;
          const value = walker.currentNode.textContent?.trim() || '';
          if (value) parts.push(value);
        }
        return parts.join(' ').trim();
      };
      const labelledByText = element => String(element?.getAttribute('aria-labelledby') || '')
        .split(/\\s+/)
        .filter(Boolean)
        .map(id => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ');
      const associatedLabelText = element => Array.from(element?.labels || [])
        .map(label => renderedText(label))
        .filter(Boolean)
        .join(' ');
      const describeControl = element => element?.getAttribute('aria-label')
        || labelledByText(element)
        || associatedLabelText(element)
        || renderedText(element)
        || element?.getAttribute('title')
        || element?.getAttribute('alt')
        || element?.getAttribute('name')
        || element?.id
        || element?.tagName
        || 'control';
      const effectiveTargetSize = element => {
        const rect = element.getBoundingClientRect();
        const label = (element.labels && element.labels[0]) || element.closest('label');
        const labelRect = label ? label.getBoundingClientRect() : null;
        return {
          width: Math.max(rect.width, labelRect ? labelRect.width : 0),
          height: Math.max(rect.height, labelRect ? labelRect.height : 0)
        };
      };
      const hasRenderedControlText = element => {
        const type = String(element.getAttribute('type') || '').toLowerCase();
        if (['range', 'checkbox', 'radio', 'color'].includes(type)) return false;
        if (renderedText(element)) return true;
        if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true;
        return element.tagName === 'INPUT' && Boolean(element.value || element.getAttribute('placeholder'));
      };
      const currentSurface = () => {
        const active = document.querySelector('#dashboard-widget-picker [data-widget-id].is-active')
          || document.querySelector('#dashboard-widget-picker [data-widget-id][aria-current="true"]');
        const id = active?.getAttribute('data-widget-id')
          || (document.querySelector('[data-destination="home"]')?.getAttribute('aria-pressed') === 'true' ? 'home' : '')
          || (document.querySelector('[data-destination="scenes"]')?.getAttribute('aria-pressed') === 'true' ? 'scenes' : '');
        return { active, id };
      };
      const focusSelection = async (control, container) => {
        if (!control || !visible(control)) return { accepted: false, reachable: false, label: '' };
        control.focus();
        control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        await nextFrames();
        const rect = control.getBoundingClientRect();
        const containerRect = container?.getBoundingClientRect() || { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        return {
          accepted: document.activeElement === control,
          reachable: rect.left >= containerRect.left - 1
            && rect.right <= containerRect.right + 1
            && rect.top >= containerRect.top - 1
            && rect.bottom <= containerRect.bottom + 1,
          label: describeControl(control),
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
          containerRect: { left: containerRect.left, top: containerRect.top, right: containerRect.right, bottom: containerRect.bottom, width: containerRect.width, height: containerRect.height },
          containerScroll: container ? { left: container.scrollLeft, width: container.scrollWidth, clientWidth: container.clientWidth } : null
        };
      };
      const snapshotRect = rect => rect ? {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      } : null;
      const containsRect = (containerRect, targetRect, axes = { x: true, y: true }) => Boolean(containerRect && targetRect
        && (!axes.x || (targetRect.left >= containerRect.left - 1 && targetRect.right <= containerRect.right + 1))
        && (!axes.y || (targetRect.top >= containerRect.top - 1 && targetRect.bottom <= containerRect.bottom + 1)));
      const describeElement = element => {
        if (!element) return '';
        const id = element.id ? '#' + element.id : '';
        const classes = typeof element.className === 'string' && element.className.trim()
          ? '.' + element.className.trim().split(/\\s+/).join('.')
          : '';
        return element.tagName.toLowerCase() + id + classes;
      };
      const openVisibleDisclosures = async panelRoot => {
        const audits = [];
        const seenDisclosures = new Set();
        const maximumAudits = 100;

        while (audits.length < maximumAudits) {
          const candidates = Array.from(panelRoot?.querySelectorAll('details:not([open])') || [])
            .filter(visible)
            .filter(details => !seenDisclosures.has(details));
          if (!candidates.length) break;

          for (const details of candidates) {
            if (audits.length >= maximumAudits) break;
            seenDisclosures.add(details);
            const summary = details.querySelector(':scope > summary');
            const audit = {
              index: audits.length,
              details: describeElement(details),
              key: details.getAttribute('data-ui-key') || '',
              summary: summary ? describeControl(summary) : '',
              summaryFound: Boolean(summary),
              summaryVisible: visible(summary),
              detailsRectBefore: snapshotRect(details.getBoundingClientRect()),
              summaryRectBefore: snapshotRect(summary?.getBoundingClientRect()),
              clickError: '',
              connected: false,
              opened: false,
              detailsRectAfter: null,
              summaryRectAfter: null
            };

            if (summary && visible(summary)) {
              try {
                summary.focus();
                summary.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                if (!details.open) summary.click();
                await nextFrames();
              } catch (error) {
                audit.clickError = String(error?.message || error || 'summary click failed');
              }
            }

            audit.connected = Boolean(details.isConnected && summary?.isConnected);
            audit.opened = Boolean(details.open);
            audit.detailsRectAfter = snapshotRect(details.getBoundingClientRect());
            audit.summaryRectAfter = snapshotRect(summary?.getBoundingClientRect());
            audit.passed = audit.summaryFound
              && audit.summaryVisible
              && !audit.clickError
              && audit.connected
              && audit.opened;
            audits.push(audit);
          }
        }

        await nextFrames();
        const remainingVisibleClosed = Array.from(panelRoot?.querySelectorAll('details:not([open])') || [])
          .filter(visible)
          .map((details, index) => {
            const summary = details.querySelector(':scope > summary');
            return {
              index,
              details: describeElement(details),
              key: details.getAttribute('data-ui-key') || '',
              summary: summary ? describeControl(summary) : '',
              detailsRect: snapshotRect(details.getBoundingClientRect()),
              summaryRect: snapshotRect(summary?.getBoundingClientRect())
            };
          });
        return {
          auditedCount: audits.length,
          openedCount: audits.filter(audit => audit.opened).length,
          failures: audits.filter(audit => !audit.passed),
          remainingVisibleClosed,
          limitReached: audits.length >= maximumAudits && remainingVisibleClosed.length > 0
        };
      };
      const clippingOverflowValues = new Set(['auto', 'clip', 'hidden', 'overlay', 'scroll']);
      const auditFocusableControl = async (control, index, panelRoot) => {
        const label = describeControl(control);
        const tag = control?.tagName?.toLowerCase() || '';
        const id = control?.id || '';
        let focusError = '';
        try {
          control.focus();
          control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          await nextFrames();
        } catch (error) {
          focusError = String(error?.message || error || 'focus failed');
        }

        const connected = Boolean(control?.isConnected);
        const active = document.activeElement === control;
        const rect = snapshotRect(control?.getBoundingClientRect());
        const viewportRect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
        const rootRect = snapshotRect(panelRoot?.getBoundingClientRect());
        const viewportContained = containsRect(viewportRect, rect);
        const rootContained = containsRect(rootRect, rect);
        const clippingAncestors = [];

        for (let ancestor = control?.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          const clipsX = clippingOverflowValues.has(style.overflowX);
          const clipsY = clippingOverflowValues.has(style.overflowY);
          if (!clipsX && !clipsY) continue;
          const ancestorRect = snapshotRect(ancestor.getBoundingClientRect());
          clippingAncestors.push({
            element: describeElement(ancestor),
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            rect: ancestorRect,
            contained: containsRect(ancestorRect, rect, { x: clipsX, y: clipsY })
          });
        }

        const clippingAncestorsContained = clippingAncestors.every(ancestor => ancestor.contained);
        return {
          index,
          label,
          tag,
          id,
          focusError,
          connected,
          active,
          rect,
          viewportRect,
          viewportContained,
          root: describeElement(panelRoot),
          rootRect,
          rootContained,
          clippingAncestors,
          clippingAncestorsContained,
          passed: !focusError && connected && active && viewportContained && rootContained && clippingAncestorsContained
        };
      };
      const seen = new Set();
      const results = [];
      const interactiveSelector = [
        'button',
        'a[href]',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        'summary',
        '[contenteditable="true"]',
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="combobox"]',
        '[role="menuitem"]',
        '[role="menuitemcheckbox"]',
        '[role="menuitemradio"]',
        '[role="option"]',
        '[role="radio"]',
        '[role="spinbutton"]',
        '[role="switch"]',
        '[role="tab"]',
        '[role="treeitem"]',
        '[role="slider"]',
        '[tabindex]:not([tabindex="-1"])'
      ].join(', ');

      const displayPausedState = (panelRoot, status) => {
        const statusRegion = panelRoot?.querySelector('[data-monitor-status]');
        const retry = statusRegion?.querySelector('[data-monitor-retry]');
        const details = {
          exactStatus: status === 'Still checking',
          statusRegionVisible: visible(statusRegion),
          pausedHeading: renderedText(statusRegion?.querySelector('strong')) === 'Still checking companion controls',
          automaticChecksPaused: renderedText(statusRegion).includes('Automatic checks have paused; try again when you are ready.'),
          retryVisible: visible(retry),
          retryEnabled: Boolean(retry && !retry.matches(':disabled') && retry.getAttribute('aria-disabled') !== 'true'
            && !retry.closest('[inert]') && retry.tabIndex >= 0 && renderedText(retry) === 'Try again'),
          hardwareControlCount: panelRoot?.querySelectorAll('[data-monitor-control], [data-monitor-power]').length ?? -1
        };
        details.passed = details.exactStatus && details.statusRegionVisible && details.pausedHeading
          && details.automaticChecksPaused && details.retryVisible && details.retryEnabled && details.hardwareControlCount === 0;
        return details;
      };
      const surfaceStatusSettled = (id, panelRoot, status) => Boolean(status && (!transientStatus.test(status)
        || (id === 'display-controls' && displayPausedState(panelRoot, status).passed)));

      async function auditCurrentSurface(expectedId, selectionFocus) {
        let state = currentSurface();
        // Monitor discovery may use its 15s polling window and final 8s read
        // deadline before presenting the explicit, manually retryable pause.
        const settleDeadline = Date.now() + ((expectedId || state.id) === 'display-controls' ? 25000 : 5000);
        let root = document.getElementById('dashboard-inline-widget');
        let status = document.getElementById('dashboard-widget-source')?.textContent?.trim() || '';
        let settled = false;
        while (Date.now() < settleDeadline) {
          state = currentSurface();
          root = document.getElementById('dashboard-inline-widget');
          status = document.getElementById('dashboard-widget-source')?.textContent?.trim() || '';
          const loadingHidden = document.getElementById('dashboard-widget-loading')?.classList.contains('is-hidden');
          if (state.id
              && (!expectedId || state.id === expectedId)
              && loadingHidden
              && visible(root)
              && surfaceStatusSettled(state.id, root, status)) {
            settled = true;
            break;
          }
          await wait(50);
        }
        await wait(500);
        state = currentSurface();
        const id = state.id;
        if (!id || seen.has(id)) return;
        seen.add(id);

        root = document.getElementById('dashboard-inline-widget');
        status = document.getElementById('dashboard-widget-source')?.textContent?.trim() || '';
        const displayPausedDetails = id === 'display-controls' ? displayPausedState(root, status) : null;
        const displayDetectionPaused = Boolean(displayPausedDetails?.passed);
        const disclosureAudit = await openVisibleDisclosures(root);
        let controls = root ? Array.from(root.querySelectorAll(interactiveSelector)).filter(visible) : [];
        const focusableControls = controls.filter(element => !element.matches(':disabled')
          && element.getAttribute('aria-disabled') !== 'true'
          && !element.closest('[inert]')
          && element.tabIndex >= 0);
        const focusTarget = focusableControls[0] || null;
        const contentFocusAudits = [];
        for (let index = 0; index < focusableControls.length; index += 1) {
          contentFocusAudits.push(await auditFocusableControl(focusableControls[index], index, root));
        }
        const contentFocusFailures = contentFocusAudits.filter(audit => !audit.passed);
        const contentFocusAccepted = contentFocusAudits.every(audit => audit.connected && audit.active && !audit.focusError);
        const contentFocusReachable = contentFocusAudits.every(audit => audit.viewportContained
          && audit.rootContained
          && audit.clippingAncestorsContained);
        const displayControlStateAudits = [];
        if (id === 'display-controls' && root) {
          const originalFetch = window.fetch;
          const fixtureOrigin = 'https://auxora-display-controls-fixture.invalid';
          const nativeMounts = Array.from(root.querySelectorAll(':scope > .inline-widget-mount'));
          const nativeMountDisplays = nativeMounts.map(mount => mount.style.display);
          let fixture = null;
          let mutationCount = 0;
          const pendingPayload = {
            status: 'pending', supported: false, displays: [], primaryExcluded: true,
            scope: 'companion-only', message: 'Checking companion monitor controls.'
          };
          const readyPayload = {
            status: 'ready', supported: true, primaryExcluded: true, scope: 'companion-only',
            message: 'Companion controls ready.', displays: [{
              index: 0, name: 'Rendered companion', brightnessSupported: true, brightness: 55,
              contrastSupported: true, contrast: 65, inputSupported: true, inputSource: 17,
              powerSupported: true
            }]
          };
          const unavailablePayload = {
            status: 'unavailable', supported: false, displays: [], primaryExcluded: true,
            scope: 'companion-only', message: 'No companion DDC/CI controls found.'
          };
          const captureDisplayState = async (mount, expectedStatus) => {
            await nextFrames();
            const fixtureControls = Array.from(mount.querySelectorAll(interactiveSelector)).filter(visible);
            const enabled = fixtureControls.filter(element => !element.matches(':disabled')
              && element.getAttribute('aria-disabled') !== 'true' && !element.closest('[inert]'));
            const focus = [];
            for (let index = 0; index < enabled.length; index += 1) {
              focus.push(await auditFocusableControl(enabled[index], index, root));
            }
            const targetMinimum = innerWidth >= 1800 && innerHeight >= 600 ? 54 : 44;
            const undersized = fixtureControls.filter(element => {
              const size = effectiveTargetSize(element);
              return size.width < targetMinimum || size.height < targetMinimum;
            }).map(describeControl);
            const unnamed = fixtureControls.filter(element => !(element.getAttribute('aria-label')
              || labelledByText(element) || associatedLabelText(element) || renderedText(element)
              || element.getAttribute('title'))).map(describeControl);
            const smallText = Array.from(mount.querySelectorAll('*')).filter(element => visible(element)
              && !['SCRIPT', 'STYLE', 'SVG', 'PATH', 'DEFS', 'USE', 'OPTION'].includes(element.tagName)
              && element.children.length === 0 && renderedText(element)
              && Number.parseFloat(getComputedStyle(element).fontSize) < 12).map(describeElement);
            const smallControlText = targetMinimum === 54 ? fixtureControls.filter(element =>
              hasRenderedControlText(element) && Number.parseFloat(getComputedStyle(element).fontSize) < 15
            ).map(describeControl) : [];
            const clipped = fixtureControls.filter(element => element.matches('button, a[href], summary, [role="button"], [role="link"]')
              && renderedText(element) && (element.scrollWidth > element.clientWidth + 1
                || element.scrollHeight > element.clientHeight + 1)).map(describeControl);
            const horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 1
              || root.scrollWidth > root.clientWidth + 1 || mount.scrollWidth > mount.clientWidth + 1;
            const initialScroll = root.scrollTop;
            const maximumScroll = Math.max(0, root.scrollHeight - root.clientHeight);
            root.scrollTop = maximumScroll;
            const verticalReachable = maximumScroll <= 1 || (['auto', 'scroll', 'overlay'].includes(getComputedStyle(root).overflowY)
              && Math.abs(root.scrollTop - maximumScroll) < 1);
            root.scrollTop = initialScroll;
            const status = fixture.statuses.at(-1)?.status || '';
            const text = renderedText(mount);
            const pendingHonest = expectedStatus !== 'Checking' || (/Checking companion controls/.test(text)
              && !/No companion.*controls found|Monitor controls unavailable|No controls/i.test(text)
              && fixtureControls.length === 0 && fixture.statuses.every(entry => entry.status === 'Checking'));
            const expectedControlCount = expectedStatus === 'Ready' ? 4 : expectedStatus === 'Unavailable' ? 1 : 0;
            const retryAvailable = expectedStatus !== 'Unavailable' || (enabled.length === 1
              && enabled[0].matches('[data-monitor-retry]') && renderedText(enabled[0]) === 'Try again');
            const settlementAccepted = surfaceStatusSettled('display-controls', mount, status);
            const settlementCorrect = expectedStatus === 'Checking' ? !settlementAccepted : settlementAccepted;
            return {
              expectedStatus, status, pendingHonest, controlCount: fixtureControls.length, expectedControlCount,
              enabledControlCount: enabled.length, retryAvailable, settlementAccepted, settlementCorrect,
              statuses: fixture.statuses.slice(), undersized, unnamed, smallText, smallControlText, clipped,
              focusFailures: focus.filter(entry => !entry.passed), horizontalOverflow, verticalReachable,
              passed: status === expectedStatus && pendingHonest && fixtureControls.length === expectedControlCount
                && enabled.length === expectedControlCount && retryAvailable && settlementCorrect
                && undersized.length === 0 && unnamed.length === 0 && smallText.length === 0
                && smallControlText.length === 0 && clipped.length === 0 && focus.every(entry => entry.passed)
                && !horizontalOverflow && verticalReachable
            };
          };
          try {
            nativeMounts.forEach(mount => { mount.style.display = 'none'; });
            window.fetch = async function (input, init) {
              const url = new URL(String(input && input.url ? input.url : input), location.href);
              const method = String(init?.method || input?.method || 'GET').toUpperCase();
              if (url.pathname === '/api/displays/controls' && method !== 'GET') {
                mutationCount += 1;
                return new Response(JSON.stringify({ error: 'Rendered display fixture blocks all monitor writes.' }), { status: 405 });
              }
              if (url.origin !== fixtureOrigin) return originalFetch.call(window, input, init);
              if (url.pathname !== '/api/displays/controls' || method !== 'GET' || !fixture) {
                throw new Error('Unexpected rendered display fixture request');
              }
              fixture.reads += 1;
              return new Response(JSON.stringify(fixture.payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            for (const scenario of ['ready', 'unavailable', 'destroy-pending']) {
              fixture = { payload: pendingPayload, reads: 0, statuses: [] };
              let controller = null;
              let mount = null;
              try {
                const existingMounts = new Set(Array.from(root.querySelectorAll(':scope > .inline-widget-mount')));
                controller = window.InlineWidgets.mountWidget({ id: 'display-controls', title: 'Display Controls' }, root, {
                  bridgeOrigin: fixtureOrigin,
                  publishStatus(status, tone, message) { fixture.statuses.push({ status, tone, message }); }
                });
                mount = Array.from(root.querySelectorAll(':scope > .inline-widget-mount')).find(candidate => !existingMounts.has(candidate));
                const pendingDeadline = Date.now() + 2000;
                while (Date.now() < pendingDeadline && fixture.statuses.at(-1)?.status !== 'Checking') await wait(25);
                const pending = await captureDisplayState(mount, 'Checking');
                let terminal = null;
                let destroyCancelledRetry = true;
                if (scenario === 'destroy-pending') {
                  const readsAtDestroy = fixture.reads;
                  const statusesAtDestroy = fixture.statuses.length;
                  controller.destroy();
                  await wait(1150);
                  destroyCancelledRetry = fixture.reads === readsAtDestroy && fixture.statuses.length === statusesAtDestroy && !mount.isConnected;
                } else {
                  fixture.payload = scenario === 'ready' ? readyPayload : unavailablePayload;
                  const expectedStatus = scenario === 'ready' ? 'Ready' : 'Unavailable';
                  const terminalDeadline = Date.now() + 3000;
                  while (Date.now() < terminalDeadline && fixture.statuses.at(-1)?.status !== expectedStatus) await wait(25);
                  terminal = await captureDisplayState(mount, expectedStatus);
                }
                controller.destroy();
                displayControlStateAudits.push({
                  scenario, pending, terminal, reads: fixture.reads, mutationCount, destroyCancelledRetry,
                  mountRemoved: !mount.isConnected,
                  passed: pending.passed && (terminal ? terminal.passed && fixture.reads >= 2 : destroyCancelledRetry)
                    && mutationCount === 0 && !mount.isConnected
                });
              } finally {
                controller?.destroy?.();
              }
            }
          } finally {
            window.fetch = originalFetch;
            nativeMounts.forEach((mount, index) => { mount.style.display = nativeMountDisplays[index]; });
          }
        }
        const networkLayoutAudits = [];
        const networkStateAudits = [];
        if (id === 'network' && root && (innerWidth === 2047 || innerWidth === 2048)) {
          const initialCardSize = root.dataset.cardSize || '';
          const initialDensity = document.body?.dataset.density || '';
          const cardSelectors = [
            '.network-quality-card',
            '.network-kpi-grid',
            '.network-adapter-card',
            '.network-unifi-card',
            '.network-list-card--clients',
            '.network-list-card--aps'
          ];
          const paddingSelectors = [
            '.network-quality-card',
            '.network-kpi-grid .metric-card',
            '.network-adapter-card',
            '.network-unifi-card',
            '.network-list-card--clients',
            '.network-list-card--aps'
          ].join(', ');
          const auditNetworkVariant = async (queryRoot, density, cardSize, stateLabel) => {
            document.body.dataset.density = density;
            root.dataset.cardSize = cardSize;
            await nextFrames();

            const visibleControls = Array.from(queryRoot.querySelectorAll(interactiveSelector)).filter(visible);
            const enabledControls = visibleControls.filter(element => !element.matches(':disabled')
              && element.getAttribute('aria-disabled') !== 'true'
              && !element.closest('[inert]'));
            const focusableControls = enabledControls.filter(element => element.tabIndex >= 0);
            const unfocusableControls = enabledControls.filter(element => element.tabIndex < 0).map(describeControl);
            const focusAudits = [];
            for (let index = 0; index < enabledControls.length; index += 1) {
              focusAudits.push(await auditFocusableControl(enabledControls[index], index, root));
            }

            const shell = queryRoot.querySelector('.network-command-shell');
            const grid = queryRoot.querySelector('.network-command-grid');
            const unifiCard = queryRoot.querySelector('.network-unifi-card');
            const form = queryRoot.querySelector('.network-unifi-form');
            // Inspect certificate text while the deterministic review mount is
            // still present, rather than relying on a later native refresh.
            const certificateText = Array.from(queryRoot.querySelectorAll('.network-certificate-review > span, .network-certificate-review > strong, .network-certificate-review > small')).map(element => ({
              text: element.textContent.trim(),
              visible: visible(element),
              fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
            }));
            const certificateTextPresent = stateLabel !== 'review' || certificateText.length === 3;
            const certificateTextReadable = certificateText.every(entry => entry.visible && entry.text
              && Number.isFinite(entry.fontSize) && entry.fontSize >= 12);
            const gridStyle = grid ? getComputedStyle(grid) : null;
            const gridColumns = gridStyle?.gridTemplateColumns || '';
            const gridColumnCount = gridColumns.trim() ? gridColumns.trim().split(/\\s+/).length : 0;
            const expectedGridColumnCount = innerWidth <= 2047 || cardSize === 'compact' ? 1 : 4;
            const rootStyle = getComputedStyle(root);
            const rootContentWidth = root.clientWidth
              - (Number.parseFloat(rootStyle.paddingLeft) || 0)
              - (Number.parseFloat(rootStyle.paddingRight) || 0);
            const shellRect = snapshotRect(shell?.getBoundingClientRect());
            const gridRect = snapshotRect(grid?.getBoundingClientRect());
            const cardElements = cardSelectors.map(selector => queryRoot.querySelector(selector)).filter(Boolean);
            const cardBounds = cardElements.map(element => ({
              element: describeElement(element),
              rect: snapshotRect(element.getBoundingClientRect()),
              horizontallyOverflowing: element.scrollWidth > element.clientWidth + 1
            }));
            const cardsContained = cardBounds.every(card => containsRect(gridRect, card.rect));
            const cardsWithinShell = cardBounds.every(card => containsRect(shellRect, card.rect, { x: true, y: false }));
            const horizontallyOverflowingCards = cardBounds.filter(card => card.horizontallyOverflowing).map(card => card.element);
            const shellCap = cardSize === 'compact' ? 1040 : cardSize === 'standard' ? 1680 : rootContentWidth;
            const expectedShellWidth = Math.min(rootContentWidth, shellCap);
            const shellWidthMatches = Boolean(shellRect && Math.abs(shellRect.width - expectedShellWidth) <= 1.5);
            const expectedPadding = density === 'compact' ? 10 : density === 'spacious' ? 18 : 16;
            const paddingFailures = Array.from(queryRoot.querySelectorAll(paddingSelectors)).filter(element => {
              const style = getComputedStyle(element);
              return ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].some(property =>
                Math.abs((Number.parseFloat(style[property]) || 0) - expectedPadding) > 0.5
              );
            }).map(element => {
              const style = getComputedStyle(element);
              return {
                element: describeElement(element),
                padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
              };
            });
            const clippedControls = enabledControls.filter(element => {
              return element.matches('button, a[href], summary, [role="button"], [role="link"]')
                && renderedText(element)
                && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
            }).map(describeControl);
            const documentHorizontalOverflow = document.documentElement.scrollWidth > innerWidth + 1;
            const documentVerticalOverflow = document.documentElement.scrollHeight > innerHeight + 1;
            const panelHorizontalOverflow = root.scrollWidth > root.clientWidth + 1;
            const panelVerticalOverflow = root.scrollHeight > root.clientHeight + 1;
            const panelOverflowY = getComputedStyle(root).overflowY;
            let panelVerticalScrollReachable = !panelVerticalOverflow;
            if (panelVerticalOverflow) {
              const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
              const start = root.scrollTop;
              const target = start < maximum ? Math.min(maximum, start + 1) : Math.max(0, start - 1);
              root.scrollTop = target;
              panelVerticalScrollReachable = ['auto', 'scroll', 'overlay'].includes(panelOverflowY)
                && Math.abs(root.scrollTop - target) < 0.5;
              root.scrollTop = start;
            }
            const focusFailures = focusAudits.filter(audit => !audit.passed);
            const expectedControlCount = stateLabel === 'linked' || stateLabel === 'review' ? 7 : null;
            const controlCountMatches = expectedControlCount == null || enabledControls.length === expectedControlCount;
            const allEnabledControlsAudited = enabledControls.length > 0
              && enabledControls.length === focusableControls.length
              && enabledControls.length === focusAudits.length;
            return {
              density,
              cardSize,
              stateLabel,
              linkState: unifiCard?.getAttribute('data-link-state') || '',
              certificateText,
              certificateTextPresent,
              certificateTextReadable,
              documentHorizontalOverflow,
              documentVerticalOverflow,
              panelHorizontalOverflow,
              panelVerticalOverflow,
              panelOverflowY,
              panelVerticalScrollReachable,
              gridColumns,
              gridColumnCount,
              expectedGridColumnCount,
              gridRect,
              shellRect,
              rootContentWidth,
              shellCap,
              expectedShellWidth,
              shellWidthMatches,
              cardBounds,
              cardsContained,
              cardsWithinShell,
              horizontallyOverflowingCards,
              expectedPadding,
              paddingFailures,
              unifiRect: snapshotRect(unifiCard?.getBoundingClientRect()),
              formRect: snapshotRect(form?.getBoundingClientRect()),
              visibleControlCount: visibleControls.length,
              enabledControlCount: enabledControls.length,
              focusableControlCount: focusableControls.length,
              focusAuditedCount: focusAudits.length,
              expectedControlCount,
              controlCountMatches,
              allEnabledControlsAudited,
              unfocusableControls,
              clippedControls,
              focusFailures,
              passed: !documentHorizontalOverflow
                && certificateTextPresent
                && certificateTextReadable
                && !documentVerticalOverflow
                && !panelHorizontalOverflow
                && panelVerticalScrollReachable
                && gridColumnCount === expectedGridColumnCount
                && shellWidthMatches
                && cardsContained
                && cardsWithinShell
                && horizontallyOverflowingCards.length === 0
                && paddingFailures.length === 0
                && controlCountMatches
                && allEnabledControlsAudited
                && unfocusableControls.length === 0
                && clippedControls.length === 0
                && focusFailures.length === 0
            };
          };

          try {
            for (const density of ['compact', 'comfortable', 'spacious']) {
              for (const cardSize of ['compact', 'standard', 'wide']) {
                networkLayoutAudits.push(await auditNetworkVariant(root, density, cardSize, 'current'));
              }
            }

            const originalFetch = window.fetch;
            const nativeMounts = Array.from(root.querySelectorAll(':scope > .inline-widget-mount'));
            const nativeMountDisplays = nativeMounts.map(mount => mount.style.display);
            const networkPayload = {
              supported: true,
              status: 'live',
              source: 'rendered Network state test',
              download: 412.5,
              upload: 38.4,
              ping: 12,
              type: 'ethernet',
              name: 'Ethernet',
              description: 'Rendered test adapter',
              linkSpeedMbps: 2500,
              ipAddress: '192.0.2.10',
              gateway: '192.0.2.1',
              dnsServers: ['192.0.2.1'],
              healthTargetSource: 'gateway'
            };
            const statePayloads = {
              linked: {
                status: 'live', configured: true, linked: true, detected: true,
                gateway: 'Rendered UniFi Gateway', gatewayIp: '192.0.2.1', host: '192.0.2.1', site: 'default', provider: 'UniFi OS',
                clients: { total: 8, wifi: 5, wired: 3 },
                aps: [{ id: 'ap-1', name: 'Office AP', status: 'online', channel: '5 GHz', clients: 5 }],
                topClients: [{ id: 'client-1', name: 'Game PC', ip: '192.0.2.10', usage: '412 Mbps' }]
              },
              review: {
                status: 'review', configured: true, linked: false, detected: true,
                gateway: 'Rendered UniFi Gateway', gatewayIp: '192.0.2.1', host: '192.0.2.1', site: 'default', provider: 'UniFi OS',
                certificateTrustRequired: true,
                certificateThumbprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
                certificateSubject: 'CN=rendered-unifi.local',
                certificateMessage: 'Review the rendered UniFi certificate fingerprint.',
                clients: { total: 0, wifi: 0, wired: 0 }, aps: [], topClients: []
              }
            };

            try {
              nativeMounts.forEach(mount => { mount.style.display = 'none'; });
              for (const stateLabel of ['linked', 'review']) {
                let mockController = null;
                let mockMount = null;
                const mountsBefore = new Set(Array.from(root.querySelectorAll(':scope > .inline-widget-mount')));
                window.fetch = async function (input, init) {
                  const url = String(input && input.url ? input.url : input);
                  if (/\\/api\\/unifi\\/network(?:$|\\?)/.test(url)) {
                    return new Response(JSON.stringify(statePayloads[stateLabel]), { status: 200, headers: { 'Content-Type': 'application/json' } });
                  }
                  if (/\\/api\\/network(?:$|\\?)/.test(url)) {
                    return new Response(JSON.stringify(networkPayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
                  }
                  return originalFetch.call(window, input, init);
                };
                try {
                  mockController = window.InlineWidgets.mountWidget(
                    { id: 'network', title: 'Network' },
                    root,
                    { bridgeOrigin: location.origin, getSetting() { return ''; } }
                  );
                  mockMount = Array.from(root.querySelectorAll(':scope > .inline-widget-mount')).find(mount => !mountsBefore.has(mount)) || null;
                  const stateDeadline = Date.now() + 5000;
                  while (Date.now() < stateDeadline
                      && mockMount?.querySelector('.network-unifi-card')?.getAttribute('data-link-state') !== stateLabel) {
                    await wait(50);
                  }
                  if (!mockMount || mockMount.querySelector('.network-unifi-card')?.getAttribute('data-link-state') !== stateLabel) {
                    networkStateAudits.push({ stateLabel, passed: false, error: 'mock Network state did not render' });
                  } else {
                    networkStateAudits.push(await auditNetworkVariant(mockMount, 'comfortable', 'standard', stateLabel));
                  }
                } finally {
                  mockController?.destroy?.();
                }
              }
            } finally {
              window.fetch = originalFetch;
              nativeMounts.forEach((mount, index) => { mount.style.display = nativeMountDisplays[index]; });
            }
          } finally {
            if (initialCardSize) root.dataset.cardSize = initialCardSize;
            else delete root.dataset.cardSize;
            if (initialDensity) document.body.dataset.density = initialDensity;
            else delete document.body.dataset.density;
            await nextFrames();
          }
        }
        if (id === 'network' && root) {
          controls = Array.from(root.querySelectorAll(interactiveSelector)).filter(visible);
        }
        const undersizedControls = controls.filter(element => {
          const size = effectiveTargetSize(element);
          return size.width < 44 || size.height < 44;
        }).map(describeControl);
        const distanceViewport = innerWidth >= 1800 && innerHeight >= 600;
        const distanceUndersizedControls = distanceViewport ? controls.filter(element => {
          const size = effectiveTargetSize(element);
          return size.width < 54 || size.height < 54;
        }).map(describeControl) : [];
        const distanceSmallControlText = distanceViewport ? controls.filter(element => {
          return hasRenderedControlText(element) && Number.parseFloat(getComputedStyle(element).fontSize) < 15;
        }).map(element => describeControl(element) + '@' + getComputedStyle(element).fontSize) : [];
        const clippedControls = controls.filter(element => {
          return element.matches('button, a[href], summary, [role="button"], [role="link"]')
            && renderedText(element)
            && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
        }).map(describeControl);
        const unnamedControls = controls.filter(element => !(element.getAttribute('aria-label')
          || element.getAttribute('aria-labelledby')
          || element.getAttribute('title')
          || element.getAttribute('alt')
          || renderedText(element)
          || element.labels && element.labels.length))
          .map(element => element.outerHTML.slice(0, 160));
        const undersizedText = root ? Array.from(root.querySelectorAll('*')).filter(element => {
          return visible(element)
            && !['SCRIPT', 'STYLE', 'SVG', 'PATH', 'DEFS', 'USE', 'OPTION'].includes(element.tagName)
            && element.children.length === 0
            && renderedText(element)
            && Number.parseFloat(getComputedStyle(element).fontSize) < 12;
        }).map(element => element.className + ':' + renderedText(element).slice(0, 60) + '@' + getComputedStyle(element).fontSize) : [];
        const panelVerticalOverflow = root ? root.scrollHeight > root.clientHeight + 1 : false;
        const panelOverflowY = root ? getComputedStyle(root).overflowY : '';
        let panelVerticalScrollReachable = !panelVerticalOverflow;
        if (root && panelVerticalOverflow) {
          const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
          const start = root.scrollTop;
          const target = start < maximum ? Math.min(maximum, start + 1) : Math.max(0, start - 1);
          root.scrollTop = target;
          panelVerticalScrollReachable = ['auto', 'scroll', 'overlay'].includes(panelOverflowY)
            && Math.abs(root.scrollTop - target) < 0.5;
          root.scrollTop = start;
        }
        const title = document.getElementById('dashboard-widget-title')?.textContent?.trim() || '';
        const duplicateTitleCount = root ? Array.from(root.querySelectorAll('h1, h2, h3')).filter(element => element.textContent.trim() === title).length : 0;
        const widgetErrorVisible = visible(document.getElementById('dashboard-widget-error'));
        const surfaceErrors = errors.slice(consumedErrorCount);
        consumedErrorCount = errors.length;

        results.push({
          id,
          title,
          status,
          settled,
          displayDetectionPaused,
          displayPausedDetails,
          selectionMatches: !expectedId || id === expectedId,
          selectionFocus,
          disclosureAuditedCount: disclosureAudit.auditedCount,
          disclosureOpenedCount: disclosureAudit.openedCount,
          disclosureFailures: disclosureAudit.failures,
          remainingVisibleClosedDisclosures: disclosureAudit.remainingVisibleClosed,
          disclosureAuditLimitReached: disclosureAudit.limitReached,
          contentFocusRequired: Boolean(focusTarget),
          contentFocusableCount: focusableControls.length,
          contentFocusAuditedCount: contentFocusAudits.length,
          contentFocusAccepted,
          contentFocusReachable,
          networkLayoutAudits,
          networkStateAudits,
          displayControlStateAudits,
          focusTarget: describeControl(focusTarget),
          contentFocusFailures,
          layoutDiagnostics: contentFocusFailures.length ? ['.router-viewer', '.router-viewer__header', '.router-viewer__header > div:first-child', '.router-viewer__header-actions', '#dashboard-widget-source', '.router-viewer__frame-shell', '#dashboard-inline-widget', '.network-unifi-form'].map(selector => {
            const element = document.querySelector(selector);
            if (!element) return { selector, missing: true };
            const style = getComputedStyle(element);
            return { selector, rect: snapshotRect(element.getBoundingClientRect()), text: element.matches('.router-viewer__header, #dashboard-widget-source') ? element.textContent.trim().slice(0, 400) : '', scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollLeft: element.scrollLeft, width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth, display: style.display, gridTemplateColumns: style.gridTemplateColumns, flex: style.flex, flexWrap: style.flexWrap, overflowX: style.overflowX };
          }) : [],
          runtimeErrors: surfaceErrors,
          fatal: widgetErrorVisible || /Dashboard failed|Dashboard runtime error/i.test(document.body?.innerText || ''),
          widgetErrorVisible,
          documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          panelOverflow: root ? root.scrollWidth > root.clientWidth + 1 : false,
          panelVerticalOverflow,
          panelOverflowY,
          panelVerticalScrollReachable,
          undersizedControls,
          distanceUndersizedControls,
          distanceSmallControlText,
          clippedControls,
          unnamedControls,
          undersizedText,
          duplicateTitleCount,
          hasSetupAction: !!root?.querySelector('[data-action="setup"]'),
          hasHueLinkForm: !!root?.querySelector('[data-form="hue-link"]'),
          clipboardPrivacyToggle: root?.querySelector('[data-action="toggle-hide-previews"]')?.textContent?.trim() || '',
          clipboardUnsafePreviews: root ? Array.from(root.querySelectorAll('.inline-clipboard-preview')).filter(element => element.textContent.trim() !== 'Hidden by privacy mode').map(element => element.textContent.trim().slice(0, 60)) : []
        });
      }

      for (const destination of ['home', 'scenes', 'library', 'settings']) {
        const destinationButton = document.querySelector('[data-destination="' + destination + '"]');
        const destinationFocus = await focusSelection(destinationButton, document.getElementById('dashboard-primary-nav'));
        destinationButton?.click();
        await wait(350);
        if (destination === 'home' || destination === 'scenes') {
          await auditCurrentSurface(destination, destinationFocus);
        }
      }
      const catalogToggle = document.getElementById('dashboard-panels-toggle');
      catalogToggle?.click(); await nextFrames();
      const picker = document.getElementById('dashboard-widget-picker');
      const ids = Array.from(picker?.querySelectorAll('[data-widget-id]') || []).filter(visible).map(element => element.getAttribute('data-widget-id'));
      document.querySelector('#dashboard-panels-drawer [data-panels-close]')?.click();
      for (const id of ids) {
        if (seen.has(id)) continue;
        catalogToggle?.focus(); catalogToggle?.click(); await nextFrames();
        const button = picker?.querySelector('[data-widget-id="' + id + '"]');
        const selectionFocus = await focusSelection(button, picker);
        button?.click();
        await wait(350);
        selectionFocus.returnedToOpener = document.activeElement === catalogToggle;
        selectionFocus.drawerClosed = document.getElementById('dashboard-panels-drawer')?.classList.contains('is-hidden');
        await auditCurrentSurface(id, selectionFocus);
      }

      return {
        results,
        errors,
        runtimeCaptureReady,
        layoutClass: document.body?.dataset.layoutClass || '',
        layoutState: {
          browser: document.body?.classList.contains('dashboard-native-page--browser') || false,
          compact: document.body?.classList.contains('dashboard-native-page--layout-compact') || false,
          ultrawide: document.body?.classList.contains('dashboard-native-page--layout-ultrawide') || false
        },
        viewport: { width: innerWidth, height: innerHeight }
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  assert(!evaluation.exceptionDetails, `${viewport.name}: product-surface evaluation failed: ${evaluation.exceptionDetails?.exception?.description || evaluation.exceptionDetails?.text || "unknown error"}`);
  const audit = evaluation.result?.value || {};
  const focusFailure = (audit.results || []).find(result => !result.contentFocusAccepted || !result.contentFocusReachable);
  if (focusFailure) {
    console.error(`surface failure layout diagnostics: ${JSON.stringify({ viewport: viewport.name, id: focusFailure.id, layout: focusFailure.layoutDiagnostics })}`);
    // Reopen the failed panel for an inspectable screenshot before the assertion
    // tears down the hidden host. The original audit geometry remains unchanged.
    await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        document.getElementById('dashboard-panels-toggle')?.click(); await frames();
        document.querySelector('#dashboard-widget-picker [data-widget-id=' + ${JSON.stringify(JSON.stringify(focusFailure.id))} + ']')?.click();
        await new Promise(resolve => setTimeout(resolve, 500));
        for (const details of document.querySelectorAll('#dashboard-inline-widget details:not([open])')) { details.querySelector(':scope > summary')?.click(); await frames(); }
        const input = document.querySelector('#dashboard-inline-widget input:not([type=hidden]):not(:disabled)');
        input?.focus(); input?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await frames();
      })()`, awaitPromise: true, returnByValue: true
    });
    const artifactDirectory = mkdtempSync(join(tmpdir(), "auxora-surface-failure-"));
    const screenshotPath = join(artifactDirectory, `${viewport.name}-${focusFailure.id}.png`);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.error(`surface failure screenshot: ${screenshotPath}`);
  }
  const expectedIds = [
    "audio", "calendar", "clipboard", "display-controls", "frigate", "game-mode", "home", "hue",
    "installer", "layout-editor", "marketplace", "network", "privacy", "quick-actions", "remote",
    "scenes", "setup", "shortcuts", "streaming", "system", "theme-studio", "updates", "weather"
  ];
  const actualIds = (audit.results || []).map(result => result.id).sort();
  const viewportLabel = `${viewport.name} ${viewport.width}x${viewport.height}`;
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `${viewportLabel}: visible product-surface inventory changed: ${JSON.stringify(audit)}`);
  assert(audit.viewport?.width === viewport.width && audit.viewport?.height === viewport.height, `${viewportLabel}: product-surface audit ran at the wrong viewport: ${JSON.stringify(audit.viewport || null)}`);
  assert(audit.layoutClass === viewport.expected, `${viewportLabel}: expected layout ${viewport.expected}, got ${audit.layoutClass || "none"}`);
  if (viewport.width === 1280 && viewport.height === 360) {
    assert(audit.layoutState?.browser === false && audit.layoutState?.compact === false && audit.layoutState?.ultrawide === true, `${viewportLabel}: expected browser=false, compact=false, ultrawide=true: ${JSON.stringify(audit.layoutState || null)}`);
  }
  assert(audit.runtimeCaptureReady, `${viewportLabel}: early runtime error capture was not installed`);
  for (const result of audit.results || []) {
    const surfaceLabel = `${viewport.name}/${result.id}`;
    const displayPaused = result.id === "display-controls" && result.status === "Still checking"
      && result.displayDetectionPaused === true && result.displayPausedDetails?.passed === true;
    assert(result.settled && result.status && (!/Loading|Refreshing|Checking|Measuring|Monitoring/i.test(result.status) || displayPaused), `${surfaceLabel}: surface status did not reach a terminal state or explicit monitor-discovery pause: ${JSON.stringify(result)}`);
    if (displayPaused) {
      const details = result.displayPausedDetails;
      assert(details.exactStatus && details.statusRegionVisible && details.pausedHeading && details.automaticChecksPaused
        && details.retryVisible && details.retryEnabled && details.hardwareControlCount === 0,
      `${surfaceLabel}: paused discovery must explain the pause, expose an enabled visible retry, and hide hardware controls: ${JSON.stringify(details)}`);
    }
    assert(result.selectionMatches, `${surfaceLabel}: the requested product surface did not become active: ${JSON.stringify(result)}`);
    assert(result.selectionFocus?.accepted && result.selectionFocus?.reachable, `${surfaceLabel}: surface selector was not keyboard-focusable and reachable: ${JSON.stringify(result.selectionFocus || null)}`);
    assert(result.selectionFocus?.returnedToOpener !== false && result.selectionFocus?.drawerClosed !== false, `${surfaceLabel}: catalog selection did not close its dialog and recover focus: ${JSON.stringify(result.selectionFocus || null)}`);
    assert(!result.disclosureAuditLimitReached && result.disclosureOpenedCount === result.disclosureAuditedCount && result.disclosureFailures.length === 0 && result.remainingVisibleClosedDisclosures.length === 0, `${surfaceLabel}: visible disclosures did not all open through their summary controls: ${JSON.stringify({ auditedCount: result.disclosureAuditedCount, openedCount: result.disclosureOpenedCount, limitReached: result.disclosureAuditLimitReached, failures: result.disclosureFailures, remainingVisibleClosed: result.remainingVisibleClosedDisclosures })}`);
    assert(result.contentFocusAuditedCount === result.contentFocusableCount, `${surfaceLabel}: audited ${result.contentFocusAuditedCount} of ${result.contentFocusableCount} enabled focusable controls`);
    assert(result.contentFocusAccepted && result.contentFocusReachable, `${surfaceLabel}: content focus was lost or inaccessible: ${JSON.stringify({ required: result.contentFocusRequired, focusableCount: result.contentFocusableCount, auditedCount: result.contentFocusAuditedCount, failures: result.contentFocusFailures })}`);
    assert((result.runtimeErrors || []).length === 0, `${surfaceLabel}: surface transition emitted runtime errors: ${JSON.stringify(result.runtimeErrors)}`);
    assert(!result.fatal && !result.widgetErrorVisible && !result.documentOverflow && !result.panelOverflow, `${surfaceLabel}: invalid geometry or fatal state: ${JSON.stringify(result)}`);
    assert(result.panelVerticalScrollReachable, `${surfaceLabel}: vertically overflowing content cannot be scrolled: ${JSON.stringify(result)}`);
    assert(result.undersizedControls.length === 0, `${surfaceLabel}: controls below 44x44: ${result.undersizedControls.join(", ")}`);
    if (viewport.width >= 1800 && viewport.height >= 600) {
      assert(result.distanceUndersizedControls.length === 0, `${surfaceLabel}: distance controls below 54x54: ${result.distanceUndersizedControls.join(", ")}`);
      assert(result.distanceSmallControlText.length === 0, `${surfaceLabel}: distance control labels below 15px: ${result.distanceSmallControlText.join(", ")}`);
    }
    assert(result.clippedControls.length === 0, `${surfaceLabel}: clipped controls: ${result.clippedControls.join(", ")}`);
    assert(result.unnamedControls.length === 0, `${surfaceLabel}: unnamed controls: ${result.unnamedControls.join(", ")}`);
    assert(result.undersizedText.length === 0, `${surfaceLabel}: text below 12px: ${result.undersizedText.join(", ")}`);
    assert(result.duplicateTitleCount === 0, `${surfaceLabel}: repeats the outer panel title inside the content`);
    if (result.id === "weather" || result.id === "calendar") {
      assert(result.hasSetupAction, `${surfaceLabel}: optional unconfigured surface has no direct Diagnostics handoff`);
    }
    if (result.id === "hue") {
      assert(result.hasHueLinkForm, `${surfaceLabel}: optional unconfigured surface has no local bridge setup form`);
    }
    if (result.id === "clipboard") {
      assert(result.clipboardPrivacyToggle === "Show previews", `${surfaceLabel}: previews were not hidden by default: ${JSON.stringify(result)}`);
      assert(result.clipboardUnsafePreviews.length === 0, `${surfaceLabel}: private preview text rendered before opt-in: ${JSON.stringify(result.clipboardUnsafePreviews)}`);
    }
    if (result.id === "display-controls") {
      assert(result.displayControlStateAudits.length === 3
        && result.displayControlStateAudits.map(state => state.scenario).join(",") === "ready,unavailable,destroy-pending"
        && result.displayControlStateAudits.every(state => state.passed), `${surfaceLabel}: pending monitor discovery failed status honesty, transition, readability, control reachability, cancellation, or no-write coverage: ${JSON.stringify(result.displayControlStateAudits)}`);
    }
    if (result.id === "network" && (viewport.width === 2047 || viewport.width === 2048)) {
      const expectedVariants = ["compact", "comfortable", "spacious"].flatMap(density =>
        ["compact", "standard", "wide"].map(cardSize => `${density}/${cardSize}`)
      );
      const actualVariants = result.networkLayoutAudits.map(audit => `${audit.density}/${audit.cardSize}`);
      assert(JSON.stringify(actualVariants) === JSON.stringify(expectedVariants), `${surfaceLabel}: Network density/card-size matrix changed: ${JSON.stringify(result.networkLayoutAudits)}`);
      assert(result.networkLayoutAudits.length === 9 && result.networkLayoutAudits.every(audit => audit.passed), `${surfaceLabel}: Network boundary layout, caps, padding, overflow, or enabled-control coverage failed: ${JSON.stringify(result.networkLayoutAudits)}`);
      assert(result.networkLayoutAudits.every(audit => audit.gridColumnCount === (viewport.width === 2047 || audit.cardSize === "compact" ? 1 : 4)), `${surfaceLabel}: Network grid did not switch from stacked to the exact four-column standard/wide contract at 2048px: ${JSON.stringify(result.networkLayoutAudits)}`);
      assert(result.networkStateAudits.length === 2 && result.networkStateAudits.map(audit => audit.linkState).join(",") === "linked,review" && result.networkStateAudits.every(audit => audit.passed), `${surfaceLabel}: deterministic linked or certificate-review Network state failed typography, geometry, control-count, or focus coverage: ${JSON.stringify(result.networkStateAudits)}`);
    }
  }
  assert((audit.errors || []).length === 0, `${viewportLabel}: product-surface audit emitted runtime errors: ${JSON.stringify(audit.errors)}`);
  console.log(`rendered all ${actualIds.length} visible product surfaces at ${viewport.width}x${viewport.height} with terminal status, focus, touch, text, naming, and overflow checks: passed`);
}

async function validateNetworkLayoutEditorPersistence(cdp) {
  await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 2048,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=layout-editor&networkLayoutPersistence=setup` });
  await waitForCommittedUrl(cdp, "networkLayoutPersistence=setup");

  const captureEvaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      let select = null;
      while (Date.now() < deadline) {
        select = document.querySelector('[data-layout-size][data-id="network"]');
        if (document.body?.dataset.bridgeHydrated === 'true' && select) break;
        await wait(50);
      }
      return {
        ready: Boolean(select),
        value: select?.value || '',
        active: document.querySelector('#dashboard-widget-picker [data-widget-id="layout-editor"].is-active')?.getAttribute('data-widget-id') || ''
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const capture = captureEvaluation.result?.value || {};
  assert(!captureEvaluation.exceptionDetails && capture.ready && ["compact", "standard", "wide"].includes(capture.value) && capture.active === "layout-editor", `Layout Editor did not expose the Network width setting: ${JSON.stringify(capture)}`);

  const originalCardSize = capture.value;
  const changedCardSize = originalCardSize === "wide" ? "compact" : "wide";
  let changed = {};
  let persisted = {};
  let restore = {};
  let restored = {};
  try {
    const changeEvaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
        const nextFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const select = document.querySelector('[data-layout-size][data-id="network"]');
        if (!select) return { ready: false };
        select.value = ${JSON.stringify(changedCardSize)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await nextFrames();
        const editorValue = document.querySelector('[data-layout-size][data-id="network"]')?.value || '';
        document.querySelector('[data-destination="library"]')?.click();
        document.getElementById('dashboard-panels-toggle')?.click();
        const pickerDeadline = Date.now() + 5000;
        let networkButton = null;
        while (Date.now() < pickerDeadline) {
          networkButton = document.querySelector('#dashboard-widget-picker [data-widget-id="network"]');
          if (networkButton) break;
          await wait(50);
        }
        networkButton?.click();
        const widgetDeadline = Date.now() + 10000;
        let root = null;
        while (Date.now() < widgetDeadline) {
          root = document.getElementById('dashboard-inline-widget');
          if (root?.dataset.cardSize === ${JSON.stringify(changedCardSize)} && root.querySelector('.network-command-shell')) break;
          await wait(50);
        }
        return {
          ready: Boolean(select && networkButton && root?.querySelector('.network-command-shell')),
          editorValue,
          rootCardSize: root?.dataset.cardSize || '',
          pickerCardSize: networkButton?.getAttribute('data-card-size') || '',
          gridColumnCount: (getComputedStyle(root?.querySelector('.network-command-grid')).gridTemplateColumns || '').trim().split(/\\s+/).filter(Boolean).length
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    changed = changeEvaluation.result?.value || {};
    if (changeEvaluation.exceptionDetails) changed.exception = changeEvaluation.exceptionDetails?.exception?.description || changeEvaluation.exceptionDetails?.text || "unknown";

    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=network&networkLayoutPersistence=reload` });
    await waitForCommittedUrl(cdp, "networkLayoutPersistence=reload");
    const persistedEvaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 10000;
        let root = null;
        while (Date.now() < deadline) {
          root = document.getElementById('dashboard-inline-widget');
          if (document.body?.dataset.bridgeHydrated === 'true' && root?.querySelector('.network-command-shell')) break;
          await wait(50);
        }
        const picker = document.querySelector('#dashboard-widget-picker [data-widget-id="network"]');
        return {
          ready: Boolean(root?.querySelector('.network-command-shell')),
          rootCardSize: root?.dataset.cardSize || '',
          pickerCardSize: picker?.getAttribute('data-card-size') || ''
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    persisted = persistedEvaluation.result?.value || {};
    if (persistedEvaluation.exceptionDetails) persisted.exception = persistedEvaluation.exceptionDetails?.exception?.description || persistedEvaluation.exceptionDetails?.text || "unknown";
  } finally {
    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=layout-editor&networkLayoutPersistence=restore` });
    await waitForCommittedUrl(cdp, "networkLayoutPersistence=restore");
    const restoreEvaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 10000;
        let select = null;
        while (Date.now() < deadline) {
          select = document.querySelector('[data-layout-size][data-id="network"]');
          if (document.body?.dataset.bridgeHydrated === 'true' && select) break;
          await wait(50);
        }
        if (!select) return { ready: false };
        select.value = ${JSON.stringify(originalCardSize)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(100);
        return {
          ready: true,
          editorValue: document.querySelector('[data-layout-size][data-id="network"]')?.value || ''
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    restore = restoreEvaluation.result?.value || {};
    if (restoreEvaluation.exceptionDetails) restore.exception = restoreEvaluation.exceptionDetails?.exception?.description || restoreEvaluation.exceptionDetails?.text || "unknown";

    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=network&networkLayoutPersistence=restored` });
    await waitForCommittedUrl(cdp, "networkLayoutPersistence=restored");
    const restoredEvaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 10000;
        let root = null;
        while (Date.now() < deadline) {
          root = document.getElementById('dashboard-inline-widget');
          if (document.body?.dataset.bridgeHydrated === 'true' && root?.querySelector('.network-command-shell')) break;
          await wait(50);
        }
        return { ready: Boolean(root?.querySelector('.network-command-shell')), rootCardSize: root?.dataset.cardSize || '' };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    restored = restoredEvaluation.result?.value || {};
    if (restoredEvaluation.exceptionDetails) restored.exception = restoredEvaluation.exceptionDetails?.exception?.description || restoredEvaluation.exceptionDetails?.text || "unknown";
  }

  assert(changed.ready && changed.editorValue === changedCardSize && changed.rootCardSize === changedCardSize && changed.pickerCardSize === changedCardSize && changed.gridColumnCount === (changedCardSize === "compact" ? 1 : 4), `Layout Editor did not apply the Network card size to the rendered panel: ${JSON.stringify(changed)}`);
  assert(persisted.ready && persisted.rootCardSize === changedCardSize && persisted.pickerCardSize === changedCardSize, `Network card size did not persist across dashboard reload: ${JSON.stringify(persisted)}`);
  assert(restore.ready && restore.editorValue === originalCardSize && restored.ready && restored.rootCardSize === originalCardSize, `Network card-size persistence test did not restore its isolated setting: ${JSON.stringify({ restore, restored })}`);
  console.log("rendered Layout Editor Network card-size apply, reload persistence, and restoration: passed");
}

async function validateForcedColorsProductSurfaces(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 2560,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "forced-colors", value: "active" }]
  });
  let audit = {};
  try {
    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=home&forcedColorsSurfaceAudit=1` });
    await waitForCommittedUrl(cdp, "forcedColorsSurfaceAudit=1");
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const seen = new Set();
        const results = [];

        async function auditCurrentSurface() {
          const active = document.querySelector('#dashboard-widget-picker [data-widget-id].is-active')
            || document.querySelector('#dashboard-widget-picker [data-widget-id][aria-current="true"]');
          const id = active?.getAttribute('data-widget-id')
            || (document.querySelector('[data-destination="home"]')?.getAttribute('aria-pressed') === 'true' ? 'home' : '')
            || (document.querySelector('[data-destination="scenes"]')?.getAttribute('aria-pressed') === 'true' ? 'scenes' : '');
          if (!id || seen.has(id)) return;
          seen.add(id);
          const settleDeadline = Date.now() + 5000;
          while (Date.now() < settleDeadline && !document.getElementById('dashboard-widget-loading')?.classList.contains('is-hidden')) await wait(50);
          await wait(250);
          const root = document.getElementById('dashboard-inline-widget');
          const buttons = root ? Array.from(root.querySelectorAll('button')).filter(visible) : [];
          const borderlessButtons = buttons.filter(button => {
            const style = getComputedStyle(button);
            return style.borderTopStyle === 'none' || (parseFloat(style.borderTopWidth) || 0) < 1;
          }).map(button => button.getAttribute('aria-label') || button.textContent.trim() || button.outerHTML.slice(0, 120));
          const forcedColorOptOuts = root ? Array.from(root.querySelectorAll('*')).filter(element => getComputedStyle(element).forcedColorAdjust === 'none').map(element => element.className || element.tagName).slice(0, 20) : [];
          results.push({
            id,
            status: document.getElementById('dashboard-widget-source')?.textContent?.trim() || '',
            buttonCount: buttons.length,
            borderlessButtons,
            forcedColorOptOuts,
            overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1 || (root ? root.scrollWidth > root.clientWidth + 1 : false),
            fatal: /Dashboard failed|Dashboard runtime error/i.test(document.body?.innerText || '')
          });
        }

        for (const destination of ['home', 'scenes', 'library', 'settings']) {
          document.querySelector('[data-destination="' + destination + '"]')?.click();
          await wait(250);
          await auditCurrentSurface();
        }
        document.getElementById('dashboard-panels-toggle')?.click(); await wait(50);
        const ids = Array.from(document.querySelectorAll('#dashboard-widget-picker [data-widget-id]')).filter(visible).map(element => element.getAttribute('data-widget-id'));
        document.querySelector('#dashboard-panels-drawer [data-panels-close]')?.click();
        for (const id of ids) {
          if (seen.has(id)) continue;
          document.getElementById('dashboard-panels-toggle')?.click(); await wait(50);
          document.querySelector('#dashboard-widget-picker [data-widget-id="' + id + '"]')?.click();
          await wait(250);
          await auditCurrentSurface();
        }

        return {
          results,
          mediaActive: matchMedia('(forced-colors: active)').matches,
          ambientHidden: Array.from(document.querySelectorAll('.dashboard-ambient-canvas, .dashboard-ambient-layer')).every(element => getComputedStyle(element).display === 'none'),
          viewport: { width: innerWidth, height: innerHeight }
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    audit = evaluation.result?.value || {};
  } finally {
    await cdp.send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [{ name: "forced-colors", value: "none" }]
    });
  }

  const expectedIds = [
    "audio", "calendar", "clipboard", "display-controls", "frigate", "game-mode", "home", "hue",
    "installer", "layout-editor", "marketplace", "network", "privacy", "quick-actions", "remote",
    "scenes", "setup", "shortcuts", "streaming", "system", "theme-studio", "updates", "weather"
  ];
  const actualIds = (audit.results || []).map(result => result.id).sort();
  assert(audit.mediaActive && audit.ambientHidden, `forced-colors dashboard media contract failed: ${JSON.stringify(audit)}`);
  assert(audit.viewport?.width === 2560 && audit.viewport?.height === 720, `forced-colors audit did not run at 2560x720: ${JSON.stringify(audit.viewport || null)}`);
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `forced-colors product-surface inventory changed: ${JSON.stringify(audit)}`);
  for (const result of audit.results || []) {
    assert(result.status && !/Loading|Refreshing/.test(result.status), `${result.id}: forced-colors surface did not reach a terminal state: ${JSON.stringify(result)}`);
    assert(result.borderlessButtons.length === 0, `${result.id}: buttons lost their visible boundary in forced colors: ${result.borderlessButtons.join(', ')}`);
    assert(result.forcedColorOptOuts.length === 0, `${result.id}: elements opted out of Windows forced colors: ${result.forcedColorOptOuts.join(', ')}`);
    assert(!result.overflow && !result.fatal, `${result.id}: forced colors created overflow or a fatal state: ${JSON.stringify(result)}`);
  }
  console.log(`rendered all ${actualIds.length} product surfaces in Windows forced colors at 2560x720: passed`);
}

async function validateDeletableMusicCards(cdp) {
  const marker = "deletableMusicCards=1";
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=home&${marker}` });
  await waitForCommittedUrl(cdp, marker);
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const runtimeDeadline = Date.now() + 10000;
      while (
        Date.now() < runtimeDeadline
        && (!document.body
          || document.body.dataset.bridgeHydrated !== 'true'
          || typeof window.InlineWidgets?.mountWidget !== 'function')
      ) await wait(50);
      if (!document.body
        || document.body.dataset.bridgeHydrated !== 'true'
        || typeof window.InlineWidgets?.mountWidget !== 'function') {
        throw new Error('Dashboard runtime did not finish hydrating for the music-card test.');
      }
      const originalFetch = window.fetch;
      const testRoot = document.createElement('div');
      testRoot.id = 'deletable-music-card-test';
      testRoot.style.cssText = 'position:fixed;inset:0;z-index:2147483646;overflow:auto;background:#071019;padding:20px';
      document.body.appendChild(testRoot);
      let mounted = null;
      try {
        window.fetch = async function (input, init) {
          const url = String(input && input.url ? input.url : input);
          if (/\\/api\\/media(?:$|\\?)/.test(url)) {
            return new Response(JSON.stringify({
              supported: true,
              configured: true,
              status: 'live',
              message: 'Local test media',
              source: 'Windows media session',
              appId: 'LocalPlayer.exe',
              title: 'Delete Test Track',
              artist: 'Delete Test Artist',
              albumTitle: 'Delete Test Album',
              playbackStatus: 'playing',
              canPause: true,
              canGoNext: true,
              canGoPrevious: true,
              thumbnailDataUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22150%22 height=%22150%22%3E%3Crect width=%22150%22 height=%22150%22 fill=%22%23316ea8%22/%3E%3C/svg%3E'
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (/\\/api\\/audio(?:$|\\?)/.test(url)) {
            return new Response(JSON.stringify({
              supported: true,
              configured: true,
              status: 'live',
              devices: [],
              sessions: [],
              volume: 50,
              muted: false
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return originalFetch.call(window, input, init);
        };
        mounted = window.InlineWidgets.mountWidget(
          { id: 'audio', title: 'Audio & Media' },
          testRoot,
          {
            bridgeOrigin: location.origin,
            bridgeConfig: { dashboard: { mediaMetadataVisible: true } },
            emitTouchFeedback() {},
            getNowStripMode() { return 'auto'; },
            setNowStripMode() {}
          }
        );
        const deadline = Date.now() + 10000;
        let deleteButton = null;
        while (Date.now() < deadline && !deleteButton) {
          await wait(50);
          deleteButton = testRoot.querySelector('[data-action="carousel-delete"]');
        }
        const artworkDeadline = Date.now() + 3000;
        let artwork = testRoot.querySelector('.audio-album-cover img');
        while (Date.now() < artworkDeadline && artwork && !artwork.complete) await wait(50);
        const beforeDelete = testRoot.querySelectorAll('.audio-album-card').length;
        const cardRect = testRoot.querySelector('.audio-album-card')?.getBoundingClientRect();
        const rect = deleteButton?.getBoundingClientRect();
        const deleteLabel = deleteButton?.getAttribute('aria-label') || '';
        deleteButton?.click();
        const deleteDeadline = Date.now() + 3000;
        while (Date.now() < deleteDeadline && testRoot.querySelectorAll('.audio-album-card').length >= beforeDelete) await wait(50);
        const afterDelete = testRoot.querySelectorAll('.audio-album-card').length;
        const emptyAfterDelete = Boolean(testRoot.querySelector('.audio-album-carousel.is-empty'));
        await wait(4500);
        const afterRefresh = testRoot.querySelectorAll('.audio-album-card').length;
        const emptyAfterRefresh = Boolean(testRoot.querySelector('.audio-album-carousel.is-empty'));
        return {
          beforeDelete,
          afterDelete,
          afterRefresh,
          emptyAfterDelete,
          emptyAfterRefresh,
          deleteWidth: rect?.width || 0,
          deleteHeight: rect?.height || 0,
          deleteLabel,
          cardWidth: cardRect?.width || 0,
          artworkLoaded: Boolean(artwork?.complete && artwork?.naturalWidth > 0)
        };
      } finally {
        mounted?.destroy?.();
        window.fetch = originalFetch;
        testRoot.remove();
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  assert(!evaluation.exceptionDetails, `music-card browser test threw: ${JSON.stringify(evaluation.exceptionDetails || null)}`);
  const result = evaluation.result?.value || {};
  assert(result.beforeDelete === 1, `music-card test did not render exactly one card: ${JSON.stringify(result)}`);
  assert(result.afterDelete === 0 && result.emptyAfterDelete, `music-card delete did not remove the card: ${JSON.stringify(result)}`);
  assert(result.afterRefresh === 0 && result.emptyAfterRefresh, `deleted music card returned on refresh: ${JSON.stringify(result)}`);
  assert(result.deleteWidth >= 44 && result.deleteHeight >= 44 && /Delete music card for/.test(result.deleteLabel), `music-card delete control is not accessible: ${JSON.stringify(result)}`);
  assert(result.cardWidth >= 190 && result.artworkLoaded, `single music card is undersized or its artwork did not render: ${JSON.stringify(result)}`);
  console.log("rendered music card deletion and refresh dismissal: passed");
}

async function validateOptionalSetupHandoffs(cdp) {
  const cases = [
    { id: "weather", inputName: "apiKey" },
    { id: "calendar", inputName: "icsUrl" }
  ];
  for (const testCase of cases) {
    const marker = `optionalSetupHandoff=${testCase.id}`;
    await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=${testCase.id}&${marker}` });
    await waitForCommittedUrl(cdp, marker);
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || document.getElementById('dashboard-widget-title')?.textContent?.trim() !== ${JSON.stringify(testCase.id === "weather" ? "Weather" : "Calendar")})) await wait(50);
        let setupButton = document.querySelector('#dashboard-inline-widget [data-action="setup"]');
        while (Date.now() < deadline && !setupButton) {
          await wait(50);
          setupButton = document.querySelector('#dashboard-inline-widget [data-action="setup"]');
        }
        setupButton?.click();
        while (Date.now() < deadline && document.getElementById('dashboard-widget-title')?.textContent?.trim() !== 'Diagnostics') await wait(50);
        while (Date.now() < deadline && document.activeElement?.getAttribute('name') !== ${JSON.stringify(testCase.inputName)}) await wait(50);
        const section = document.querySelector('[data-setup-section=${JSON.stringify(testCase.id)}]');
        const rect = section?.getBoundingClientRect();
        return {
          setupButton: !!setupButton,
          heading: document.getElementById('dashboard-widget-title')?.textContent?.trim() || '',
          active: document.querySelector('#dashboard-widget-picker [data-widget-id].is-active')?.getAttribute('data-widget-id') || '',
          form: !!document.querySelector('[data-form=${JSON.stringify(testCase.id)}]'),
          focusedName: document.activeElement?.getAttribute('name') || '',
          sectionVisible: !!rect && rect.width > 0 && rect.height > 0
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const result = evaluation.result?.value || {};
    assert(result.setupButton && result.heading === "Diagnostics" && result.active === "setup", `${testCase.id}: setup handoff did not open Diagnostics: ${JSON.stringify(result)}`);
    assert(result.form && result.sectionVisible && result.focusedName === testCase.inputName, `${testCase.id}: setup handoff did not reveal and focus the intended form: ${JSON.stringify(result)}`);
  }
  console.log("rendered Weather and Calendar direct Diagnostics handoffs: passed");
}

async function validateStandaloneFallbacks(cdp) {
  const fallbacks = [
    { name: "Audio", path: "audio-output-panel.html", status: "#status" },
    { name: "Calendar", path: "calendar-widget.html", status: "#calendar-status", widgetCore: true },
    { name: "Network", path: "network-widget.html", status: "#network-status", widgetCore: true },
    { name: "System Monitor", path: "system-monitor.html", status: "#system-status", widgetCore: true },
    { name: "Diagnostics", path: "setup-guide.html", status: "#guide-status", widgetCore: true },
    { name: "Philips Hue", path: "philips-hue-panel.html", status: "#hue-status" },
    { name: "Weather", path: "weather-widget.html", status: "#weather-source", widgetCore: true },
    { name: "Camera Detection", path: "frigate-detection-panel.html", status: "#frigate-status" }
  ];

  for (const fallback of fallbacks) {
    const marker = `standaloneRenderedTest=${encodeURIComponent(fallback.name)}`;
    await cdp.send("Page.navigate", { url: `${baseUrl}/widgets/${fallback.path}?${marker}` });
    await waitForCommittedUrl(cdp, marker);

    const deadline = Date.now() + 10000;
    let probe = {};
    while (Date.now() < deadline) {
      const evaluated = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const status = document.querySelector(${JSON.stringify(fallback.status)})?.textContent?.trim() || '';
          const finish = document.querySelector('#finish-setup');
          const hueRefresh = document.querySelector('#bridge-refresh-button');
          const bodyText = document.body?.innerText || '';
          return {
            readyState: document.readyState,
            status,
            heading: document.querySelector('h1')?.textContent?.trim() || '',
            widgetCore: typeof window.WidgetCore,
            tokenReady: typeof window.XenonSessionToken === 'string' && window.XenonSessionToken.length > 0,
            essentialRows: document.querySelectorAll('#guide-essentials .setup-row').length,
            autoReadyCount: Array.from(document.querySelectorAll('button')).filter(button => /Auto ready/i.test(button.textContent || '')).length,
            developerControls: /Copy embed|Copy URL/.test(bodyText) || Boolean(document.querySelector('#guide-iframe-snippet')),
            finishText: finish?.textContent?.trim() || '',
            currentOutputCopy: document.querySelector('#current-output-copy')?.textContent?.trim() || '',
            networkDetail: document.querySelector('#network-detail')?.textContent?.trim() || '',
            hueRefreshHeight: hueRefresh ? hueRefresh.getBoundingClientRect().height : null,
            bodyText,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            fatal: /Dashboard failed|runtime error/i.test(bodyText)
          };
        })()`,
        returnByValue: true
      });
      probe = evaluated.result?.value || {};
      if (probe.readyState === "complete" && probe.status && !/Loading|Refreshing|Measuring|Monitoring/i.test(probe.status)) break;
      await delay(100);
    }

    assert(probe.tokenReady, `${fallback.name} did not receive the native CSP session bootstrap: ${JSON.stringify(probe)}`);
    if (fallback.widgetCore) {
      assert(probe.widgetCore === "object", `${fallback.name} WidgetCore was blocked by the native CSP: ${JSON.stringify(probe)}`);
    }
    assert(probe.status && !/Loading|Refreshing|Measuring|Monitoring/i.test(probe.status), `${fallback.name} did not reach a terminal state: ${JSON.stringify(probe)}`);
    assert(!probe.horizontalOverflow && !probe.fatal, `${fallback.name} rendered an invalid fallback surface: ${JSON.stringify(probe)}`);

    if (fallback.name === "Audio") {
      assert(probe.currentOutputCopy && !/\{[0-9a-f.-]{8,}\}/i.test(probe.currentOutputCopy), `Audio exposed a raw Windows device identifier: ${JSON.stringify(probe)}`);
    } else if (fallback.name === "Calendar") {
      assert(!/Sprint standup|Design sync|Benchmarks|Publish to GitHub Pages/.test(probe.bodyText), `Calendar exposed fake sample events: ${JSON.stringify(probe)}`);
    } else if (fallback.name === "Network") {
      assert(!/Browser estimate/i.test(`${probe.status} ${probe.networkDetail}`), `Network used a browser estimate instead of native telemetry: ${JSON.stringify(probe)}`);
    } else if (fallback.name === "System Monitor") {
      assert(!/Bridge required/i.test(`${probe.status} ${probe.bodyText}`), `System Monitor ignored the available native service: ${JSON.stringify(probe)}`);
    } else if (fallback.name === "Diagnostics") {
      assert(probe.heading === "Diagnostics" && probe.essentialRows >= 4, `Diagnostics did not render its production checks: ${JSON.stringify(probe)}`);
      assert(probe.autoReadyCount === 0 && probe.finishText !== "Auto ready" && !probe.developerControls, `Diagnostics exposed obsolete or developer-only controls: ${JSON.stringify(probe)}`);
    } else if (fallback.name === "Philips Hue") {
      assert(probe.hueRefreshHeight >= 44, `Philips Hue Refresh is below the 44px touch minimum: ${JSON.stringify(probe)}`);
    }

    console.log(`rendered standalone ${fallback.name} CSP, terminal state, and 2560x720 geometry: passed`);
  }
}

assert(process.platform === "win32", "rendered dashboard test requires Windows");
assert(hostExecutable, "Release native host is missing; build app/XenonEdgeHost.sln first");
assert(browserExecutable, "System Edge or Chrome is required for rendered dashboard testing");
assert(typeof WebSocket === "function", "Node.js with built-in WebSocket support is required");

const profileRoot = mkdtempSync(join(tmpdir(), "auxora-rendered-dashboard-"));
const roaming = join(profileRoot, "Roaming");
const local = join(profileRoot, "Local");
const browserProfile = join(profileRoot, "browser");
mkdirSync(roaming, { recursive: true });
mkdirSync(local, { recursive: true });
const hostPort = await reserveLocalPort();
baseUrl = `http://127.0.0.1:${hostPort}`;
assert(!(await hostAlreadyRunning()), `test host port ${hostPort} is already in use; refusing to inspect an unrelated host`);
const configDirectory = join(roaming, "Auxora");
mkdirSync(configDirectory, { recursive: true });
writeFileSync(join(configDirectory, "config.json"), JSON.stringify({ port: hostPort }));
const debugPort = await reserveLocalPort();
const mockFrigate = await startMockFrigate();
const guardedHost = await spawnWithVisibleWindowGuard(hostExecutable, ["--safe-mode"], {
  cwd: resolve(repoRoot, "app"),
  env: {
    ...process.env,
    APPDATA: roaming,
    LOCALAPPDATA: local,
    AUXORA_ENABLE_TEST_DATA_ROOTS: "1",
    AUXORA_TEST_ROAMING_ROOT: roaming,
    AUXORA_TEST_LOCAL_ROOT: local,
    AUXORA_TEST_INSTANCE_ID: profileRoot,
    AUXORA_DISABLE_TRAY_ICON_FOR_TESTS: "1",
    AUXORA_SUPPRESS_WINDOW_FOR_TESTS: "1",
    TEMP: profileRoot,
    TMP: profileRoot
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
const host = guardedHost.child;
const hostWindowGuard = guardedHost.guard;
const readHostDiagnostics = captureChildOutput(host, join(local, "Auxora", "logs", "host.log"));
let browser;

try {
  await waitForHost(host, readHostDiagnostics);
  assert(existsSync(join(local, "Auxora", "logs", "host.log")), "rendered host did not use the explicit isolated local-data root");
  assert(existsSync(join(roaming, "Auxora", "config.json")), "rendered host did not use the explicit isolated roaming-data root");
  await waitForNativeWebView(host, readHostDiagnostics);
  await validateEmbeddedProductCss();
  await validateEmbeddedNetworkCss();
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
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__auxoraRenderedRuntimeErrors = [];
        window.addEventListener('error', event => {
          window.__auxoraRenderedRuntimeErrors.push({
            type: 'error',
            message: String(event.error?.stack || event.error?.message || event.message || 'runtime error'),
            source: String(event.filename || ''),
            line: Number(event.lineno || 0),
            column: Number(event.colno || 0)
          });
        });
        window.addEventListener('unhandledrejection', event => {
          window.__auxoraRenderedRuntimeErrors.push({
            type: 'unhandledrejection',
            message: String(event.reason?.stack || event.reason?.message || event.reason || 'unhandled rejection')
          });
        });
      })()`
    });
    if (surfaceOnlyViewport) {
      await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: surfaceOnlyViewport.width, height: surfaceOnlyViewport.height, deviceScaleFactor: 1, mobile: false
      });
      await validateAllVisibleProductSurfaces(cdp, surfaceOnlyViewport);
    } else {
    if (!process.argv.includes("--quick-controls-only")) await validateFavoritesNavigation(cdp);
    if (!process.argv.includes("--favorites-only") && !process.argv.includes("--quick-controls-only")) await validateCompactChrome(cdp);
    if (!process.argv.includes("--favorites-only") && !process.argv.includes("--compact-only")) await validateQuickControls(cdp);
    if (!process.argv.includes("--compact-only") && !process.argv.includes("--favorites-only") && !process.argv.includes("--quick-controls-only")) {
    await validateSettingsInteractionSafety(cdp);
    for (const viewport of viewports) {
      await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false
      });
      const renderedWidget = ["portrait-phone", "ultrawide"].includes(viewport.name) ? "game-mode" : "privacy";
      await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=${renderedWidget}&renderedTest=1` });
      await waitForCommittedUrl(cdp, `widget=${renderedWidget}&renderedTest=1`);
      const probe = await waitForProbe(cdp, viewport);
      validateProbe(probe, viewport);
      console.log(`rendered ${viewport.name} ${viewport.width}x${viewport.height}: passed`);
    }
    for (const viewport of surfaceAuditViewports) {
      await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await validateAllVisibleProductSurfaces(cdp, viewport);
    }
    await validateNetworkLayoutEditorPersistence(cdp);
    await validateDeletableMusicCards(cdp);
    await validateForcedColorsProductSurfaces(cdp);
    await validateOptionalSetupHandoffs(cdp);
    await validateTouchLockIsolation(cdp);
    await validateFocusedInlineWidgetReconciliation(cdp);
    await validateStableRuntimeIsolation(cdp);
    await validateHomeRefreshStability(cdp);
    await validateSurfaceStatusOwnership(cdp);
    await validateNonTouchScrollClickAndRailStatus(cdp);
    await validateBackgroundTerminalStatuses(cdp);
    await validateResetConfirmationExpiry(cdp);
    await validateUpdateDowngradeGuard(cdp);
    await validateProductSurfaceSemantics(cdp);
    await validateNetworkSuccessContrast(cdp);
    await validateActionConfirmationExpiry(cdp);
    await validateCameraDetection(cdp, mockFrigate);
    await validateColdBoots(cdp, 100);
    const resetEvaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const recoveryResponse = await fetch('/api/recovery', {
          headers: {
            'X-Xenon-Session': window.XenonSessionToken
          }
        });
        const recovery = await recoveryResponse.json();
        const response = await fetch('/api/config/reset', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Xenon-Session': window.XenonSessionToken
          },
          body: '{}'
        });
        return {
          status: response.status,
          receipt: await response.json(),
          recoveryHttpStatus: recoveryResponse.status,
          recovery
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const resetResult = resetEvaluation.result?.value;
    const webViewStep = resetResult?.receipt?.steps?.find(step => step.id === "webview-data");
    assert(resetResult?.status === 200 && resetResult?.receipt?.ok === true, `initialized-host reset must complete successfully: ${JSON.stringify(resetResult || null)}`);
    assert(resetResult?.recoveryHttpStatus === 200, `native host recovery state was unavailable before reset: ${JSON.stringify(resetResult || null)}`);
    assert(
      ["ready", "waiting-for-companion-display"].includes(resetResult?.recovery?.status),
      `native host published an unexpected recovery state before reset: ${JSON.stringify(resetResult?.recovery || null)}`
    );
    // This isolated hidden-host fixture initializes WebView2 even without a companion
    // display. Recovery reports display availability, not WebView profile readiness.
    assert(
      webViewStep?.status === "cleared"
        && webViewStep?.message === "Cleared the active WebView profile browsing data.",
      `initialized WebView reset was not cleared: ${JSON.stringify(webViewStep || null)}`
    );
    console.log("initialized WebView browsing data reset: passed");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 2560,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });
    await validateStandaloneFallbacks(cdp);
    }
    }
  } finally {
    try {
      await cdp.send("Browser.close");
    } catch {
      // Edge may close the protocol socket before acknowledging Browser.close.
    }
    cdp.close();
  }
  console.log(surfaceOnlyViewport
    ? `launched isolated hidden native host and checked all 23 product surfaces at ${surfaceOnlyViewport.width}x${surfaceOnlyViewport.height}`
    : process.argv.includes("--quick-controls-only")
    ? "launched isolated hidden native host and checked direct Quick controls with hardware-isolated fixtures at four viewports"
    : process.argv.includes("--favorites-only")
    ? "launched isolated native host and checked editable favorites and All panels at four viewports"
    : process.argv.includes("--compact-only")
    ? "launched isolated native host and checked compact chrome at 800x480/720x480 and portrait options at 390x844"
    : `launched isolated native host and checked rendered DOM geometry, focus, activation, touch targets, and names at ${viewports.length} viewports`);
} finally {
  await stopProcessTree(browser);
  try {
    await stopProcessTree(host);
  } finally {
    await stopVisibleWindowGuard(hostWindowGuard, "rendered native host");
  }
  await mockFrigate.close();
  try {
    rmSync(profileRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    console.warn(`isolated rendered-test profile cleanup deferred for ${profileRoot}: ${error.code || error.message}`);
  }
}
