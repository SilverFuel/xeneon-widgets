import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  { name: "desktop", width: 1600, height: 900, expected: "standard" },
  { name: "wide-companion", width: 2048, height: 720, expected: "ultrawide" },
  { name: "ultrawide", width: 2560, height: 720, expected: "ultrawide" },
];

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
        if (setupButton && !setupButton.classList.contains('is-active')) setupButton.click();
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
      const blurTarget = document.querySelector('[data-widget-id="theme-studio"]');
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
      const pickerButton = document.querySelector('[data-widget-id="streaming"]');
      pickerButton?.focus();
      pickerButton?.click();
      await wait(150);
      const chromePreserved = !!pickerButton && pickerButton.isConnected && document.activeElement === pickerButton;
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
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (document.body?.dataset.bridgeHydrated !== 'true' || !document.querySelector('[data-settings-import]'))) await wait(50);
      await wait(750);
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')), true);
      const input = document.querySelector('[data-settings-import]');
      const refresh = document.querySelector('[data-action="refresh-diagnostics"]');
      if (!input || !refresh) return { ready: false, errors };
      input.closest('details').open = true;
      refresh.closest('details').open = true;
      await wait(50);
      input.focus();
      input.value = 'draft backup text';
      refresh.focus();
      refresh.click();
      await wait(500);
      return {
        ready: true,
        connected: input.isConnected,
        focused: document.activeElement === refresh,
        diagnosticsOpen: refresh.closest('details')?.open === true,
        activeControl: document.activeElement?.getAttribute('data-action') || document.activeElement?.tagName || '',
        valuePreserved: input.value === 'draft backup text',
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

      document.querySelector('[data-widget-id="display-controls"]')?.click();
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
        if (document.body?.dataset.bridgeHydrated === 'true' && setupButton && !setupButton.classList.contains('is-active')) setupButton.click();
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
      if (setupButton?.getAttribute('aria-pressed') !== 'true') setupButton?.click();
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

async function validateAllVisibleProductSurfaces(cdp) {
  await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=home&allSurfaceAudit=1` });
  await waitForCommittedUrl(cdp, "allSurfaceAudit=1");

  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && document.body?.dataset.bridgeHydrated !== 'true') await wait(50);

      const visible = element => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const seen = new Set();
      const results = [];
      const errors = [];
      window.addEventListener('error', event => errors.push(String(event.error?.message || event.message || 'runtime error')));
      window.addEventListener('unhandledrejection', event => errors.push(String(event.reason?.message || event.reason || 'unhandled rejection')));

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
        await wait(500);

        const root = document.getElementById('dashboard-inline-widget');
        const controls = root ? Array.from(root.querySelectorAll('button, a[href], input, select, textarea')).filter(visible) : [];
        const undersizedControls = controls.filter(element => {
          const rect = element.getBoundingClientRect();
          const label = element.id ? document.querySelector('label[for="' + element.id + '"]') : element.closest('label');
          const labelRect = label ? label.getBoundingClientRect() : null;
          return Math.max(rect.width, labelRect ? labelRect.width : 0) < 44
            || Math.max(rect.height, labelRect ? labelRect.height : 0) < 44;
        }).map(element => element.getAttribute('aria-label') || element.textContent.trim() || element.name || element.id);
        const distanceUndersizedControls = controls.filter(element => {
          const rect = element.getBoundingClientRect();
          const label = element.id ? document.querySelector('label[for="' + element.id + '"]') : element.closest('label');
          const labelRect = label ? label.getBoundingClientRect() : null;
          return Math.max(rect.width, labelRect ? labelRect.width : 0) < 54
            || Math.max(rect.height, labelRect ? labelRect.height : 0) < 54;
        }).map(element => element.getAttribute('aria-label') || element.textContent.trim() || element.name || element.id);
        const distanceSmallControlText = controls.filter(element => {
          const type = String(element.getAttribute('type') || '').toLowerCase();
          return !['range', 'checkbox', 'radio', 'color'].includes(type)
            && Number.parseFloat(getComputedStyle(element).fontSize) < 15;
        }).map(element => (element.getAttribute('aria-label') || element.textContent.trim() || element.name || element.id) + '@' + getComputedStyle(element).fontSize);
        const clippedControls = controls.filter(element => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
          .map(element => element.getAttribute('aria-label') || element.textContent.trim() || element.name || element.id);
        const unnamedControls = controls.filter(element => !(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent.trim() || element.labels && element.labels.length))
          .map(element => element.outerHTML.slice(0, 160));
        const undersizedText = root ? Array.from(root.querySelectorAll('*')).filter(element => {
          return visible(element)
            && !['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(element.tagName)
            && element.children.length === 0
            && element.textContent.trim()
            && Number.parseFloat(getComputedStyle(element).fontSize) < 12;
        }).map(element => element.className + ':' + element.textContent.trim().slice(0, 60) + '@' + getComputedStyle(element).fontSize) : [];
        const title = document.getElementById('dashboard-widget-title')?.textContent?.trim() || '';
        const duplicateTitleCount = root ? Array.from(root.querySelectorAll('h1, h2, h3')).filter(element => element.textContent.trim() === title).length : 0;

        results.push({
          id,
          title,
          status: document.getElementById('dashboard-widget-source')?.textContent?.trim() || '',
          fatal: /Dashboard failed|Dashboard runtime error/i.test(document.body?.innerText || ''),
          documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          panelOverflow: root ? root.scrollWidth > root.clientWidth + 1 : false,
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
        destinationButton?.click();
        await wait(350);
        await auditCurrentSurface();
        const ids = Array.from(document.querySelectorAll('#dashboard-widget-picker [data-widget-id]')).filter(visible).map(element => element.getAttribute('data-widget-id'));
        for (const id of ids) {
          if (seen.has(id)) continue;
          document.querySelector('#dashboard-widget-picker [data-widget-id="' + id + '"]')?.click();
          await wait(350);
          await auditCurrentSurface();
        }
      }

      return { results, errors, viewport: { width: innerWidth, height: innerHeight } };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const audit = evaluation.result?.value || {};
  const expectedIds = [
    "audio", "calendar", "clipboard", "display-controls", "frigate", "game-mode", "home", "hue",
    "installer", "layout-editor", "marketplace", "network", "privacy", "quick-actions", "remote",
    "scenes", "setup", "shortcuts", "streaming", "system", "theme-studio", "updates", "weather"
  ];
  const actualIds = (audit.results || []).map(result => result.id).sort();
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `visible product-surface inventory changed: ${JSON.stringify(audit)}`);
  assert(audit.viewport?.width === 2560 && audit.viewport?.height === 720, `product-surface audit did not run at 2560x720: ${JSON.stringify(audit.viewport || null)}`);
  assert((audit.errors || []).length === 0, `product-surface audit emitted runtime errors: ${JSON.stringify(audit.errors)}`);
  for (const result of audit.results || []) {
    assert(result.status && !/Loading|Refreshing/.test(result.status), `${result.id}: surface status did not reach a terminal state: ${JSON.stringify(result)}`);
    assert(!result.fatal && !result.documentOverflow && !result.panelOverflow, `${result.id}: invalid 2560x720 geometry or fatal state: ${JSON.stringify(result)}`);
    assert(result.undersizedControls.length === 0, `${result.id}: controls below 44x44: ${result.undersizedControls.join(", ")}`);
    assert(result.distanceUndersizedControls.length === 0, `${result.id}: distance controls below 54x54: ${result.distanceUndersizedControls.join(", ")}`);
    assert(result.distanceSmallControlText.length === 0, `${result.id}: distance control labels below 15px: ${result.distanceSmallControlText.join(", ")}`);
    assert(result.clippedControls.length === 0, `${result.id}: clipped controls: ${result.clippedControls.join(", ")}`);
    assert(result.unnamedControls.length === 0, `${result.id}: unnamed controls: ${result.unnamedControls.join(", ")}`);
    assert(result.undersizedText.length === 0, `${result.id}: text below 12px: ${result.undersizedText.join(", ")}`);
    assert(result.duplicateTitleCount === 0, `${result.id}: repeats the outer panel title inside the content`);
    if (result.id === "weather" || result.id === "calendar") {
      assert(result.hasSetupAction, `${result.id}: optional unconfigured surface has no direct Diagnostics handoff`);
    }
    if (result.id === "hue") {
      assert(result.hasHueLinkForm, "hue: optional unconfigured surface has no local bridge setup form");
    }
    if (result.id === "clipboard") {
      assert(result.clipboardPrivacyToggle === "Show previews", `clipboard: previews were not hidden by default: ${JSON.stringify(result)}`);
      assert(result.clipboardUnsafePreviews.length === 0, `clipboard: private preview text rendered before opt-in: ${JSON.stringify(result.clipboardUnsafePreviews)}`);
    }
  }
  console.log(`rendered all ${actualIds.length} visible product surfaces at 2560x720 with terminal status, touch, text, naming, and overflow checks: passed`);
}

async function validateForcedColorsProductSurfaces(cdp) {
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
          const ids = Array.from(document.querySelectorAll('#dashboard-widget-picker [data-widget-id]')).filter(visible).map(element => element.getAttribute('data-widget-id'));
          for (const id of ids) {
            if (seen.has(id)) continue;
            document.querySelector('#dashboard-widget-picker [data-widget-id="' + id + '"]')?.click();
            await wait(250);
            await auditCurrentSurface();
          }
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
const host = spawn(hostExecutable, ["--safe-mode"], {
  cwd: resolve(repoRoot, "app"),
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
const readHostDiagnostics = captureChildOutput(host, join(local, "Auxora", "logs", "host.log"));
let browser;

try {
  await waitForHost(host, readHostDiagnostics);
  assert(existsSync(join(local, "Auxora", "logs", "host.log")), "rendered host did not use the explicit isolated local-data root");
  assert(existsSync(join(roaming, "Auxora", "config.json")), "rendered host did not use the explicit isolated roaming-data root");
  await validateEmbeddedProductCss();
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
      const renderedWidget = ["portrait-phone", "ultrawide"].includes(viewport.name) ? "game-mode" : "privacy";
      await cdp.send("Page.navigate", { url: `${baseUrl}/dashboard.html?widget=${renderedWidget}&renderedTest=1` });
      await waitForCommittedUrl(cdp, `widget=${renderedWidget}&renderedTest=1`);
      const probe = await waitForProbe(cdp, viewport);
      validateProbe(probe, viewport);
      console.log(`rendered ${viewport.name} ${viewport.width}x${viewport.height}: passed`);
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 2560,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });
    await validateAllVisibleProductSurfaces(cdp);
    await validateDeletableMusicCards(cdp);
    await validateForcedColorsProductSurfaces(cdp);
    await validateOptionalSetupHandoffs(cdp);
    await validateSettingsInteractionSafety(cdp);
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
    if (resetResult?.recovery?.status === "waiting-for-companion-display") {
      assert(
        webViewStep?.status === "unavailable"
          && webViewStep?.message === "The WebView profile was not initialized, so no profile deletion was claimed.",
        `display-deferred WebView reset was not reported truthfully: ${JSON.stringify(webViewStep || null)}`
      );
      console.log("display-deferred WebView browsing data reset receipt: passed");
    } else {
      assert(resetResult?.recovery?.status === "ready", `native host published an unexpected recovery state before reset: ${JSON.stringify(resetResult?.recovery || null)}`);
      assert(
        webViewStep?.status === "cleared"
          && webViewStep?.message === "Cleared the active WebView profile browsing data.",
        `initialized WebView reset was not cleared: ${JSON.stringify(webViewStep || null)}`
      );
      console.log("initialized WebView browsing data reset: passed");
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 2560,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });
    await validateStandaloneFallbacks(cdp);
  } finally {
    try {
      await cdp.send("Browser.close");
    } catch {
      // Edge may close the protocol socket before acknowledging Browser.close.
    }
    cdp.close();
  }
  console.log(`launched isolated native host and checked rendered DOM geometry, focus, activation, touch targets, and names at ${viewports.length} viewports`);
} finally {
  await stopProcessTree(browser);
  await stopProcessTree(host);
  await mockFrigate.close();
  try {
    rmSync(profileRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    console.warn(`isolated rendered-test profile cleanup deferred: ${error.code || error.message}`);
  }
}
