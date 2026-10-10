import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnWithVisibleWindowGuard, stopVisibleWindowGuard } from "./lib/visible-window-guard.mjs";

const repoRoot = process.cwd();
let baseUrl = "";
const settingsStorageKey = "xeneon-dashboard-settings";
const hostExecutable = resolve(repoRoot, "app/bin/x64/Release/net8.0-windows10.0.19041.0/win-x64/XenonEdgeHost.exe");
const artifactDirectory = resolve(process.env.AUXORA_THEME_ARTIFACT_DIR || join(tmpdir(), "auxora-theme-rendered"));
const browserExecutable = [
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.LOCALAPPDATA || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe")
].find(candidate => candidate && existsSync(candidate));

const themes = ["focus", "gaming", "warm"];
const viewports = [
  { name: "compact", width: 1280, height: 400, expectedLayout: "ultrawide" },
  { name: "standard", width: 1440, height: 900, expectedLayout: "standard" },
  { name: "ultrawide", width: 2560, height: 720, expectedLayout: "ultrawide" },
  { name: "portrait", width: 800, height: 1280, expectedLayout: "portrait" }
];
const requiredTokens = [
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
  "--theme-hover-surface",
  "--theme-pressed-surface",
  "--theme-focus-ring",
  "--theme-ambient-primary",
  "--theme-ambient-secondary",
  "--theme-ambient-rim",
  "--theme-vignette",
  "--theme-panel-shadow",
  "--theme-inner-highlight",
  "--theme-motion-scale",
  "--theme-glow-intensity",
  "--theme-night-brightness",
  "--theme-night-glow",
  "--theme-panel-radius",
  "--theme-panel-blur",
  "--status-success-text",
  "--status-success-surface",
  "--status-success-border",
  "--status-warning-text",
  "--status-warning-surface",
  "--status-warning-border",
  "--status-danger-text",
  "--status-danger-surface",
  "--status-danger-border"
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

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "browser evaluation failed");
  }
  return response.result?.value;
}

async function waitForCondition(cdp, expression, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await evaluate(cdp, `Boolean(${expression})`);
      if (result) return;
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) throw error;
    }
    await delay(250);
  }
  const state = await evaluate(cdp, `({ url: location.href, ready: document.readyState, theme: document.documentElement.dataset.theme, variant: document.documentElement.dataset.themeVariant, layout: document.body?.dataset.layoutClass, bridgeHydrated: document.body?.dataset.bridgeHydrated })`);
  throw new Error(`${label} did not become ready within ${timeoutMs}ms: ${JSON.stringify(state)}`);
}

async function navigateAndWait(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitForCondition(cdp, `location.href === ${JSON.stringify(new URL(url).href)} && document.readyState === 'complete'`, `navigation to ${url}`);
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false
  });
}

async function seedSettings(cdp, settings) {
  await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  // Use a same-origin static response so no dashboard timers can overwrite the
  // fixture between localStorage seeding and the tested navigation.
  await navigateAndWait(cdp, `${baseUrl}/assets/revision.json?renderedThemeSeed=1`);
  await evaluate(cdp, `localStorage.setItem(${JSON.stringify(settingsStorageKey)}, ${JSON.stringify(JSON.stringify(settings))})`);
}

function parseColor(value) {
  const text = String(value || "").trim().toLowerCase();
  const shortHex = text.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return {
      r: parseInt(shortHex[1][0] + shortHex[1][0], 16),
      g: parseInt(shortHex[1][1] + shortHex[1][1], 16),
      b: parseInt(shortHex[1][2] + shortHex[1][2], 16),
      a: 1
    };
  }
  const hex = text.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
      a: hex[2] ? parseInt(hex[2], 16) / 255 : 1
    };
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)%?)?\s*\)$/i);
  if (rgb) {
    let alpha = rgb[4] == null ? 1 : Number(rgb[4]);
    if (rgb[4] && rgb[0].includes("%")) alpha /= 100;
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
  }
  throw new Error(`unsupported color value: ${value}`);
}

function composite(foreground, background) {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha
  };
}

function relativeLuminance(color) {
  const channel = value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(foregroundValue, backgroundValue, underlayValue = "#000000") {
  const underlay = parseColor(underlayValue);
  const background = composite(parseColor(backgroundValue), underlay);
  const foreground = composite(parseColor(foregroundValue), background);
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function colorsEqual(leftValue, rightValue) {
  const left = parseColor(leftValue);
  const right = parseColor(rightValue);
  return Math.round(left.r) === Math.round(right.r)
    && Math.round(left.g) === Math.round(right.g)
    && Math.round(left.b) === Math.round(right.b)
    && Math.abs(left.a - right.a) < 0.01;
}

function validateContrast(tokens, label) {
  const surfaceNames = ["--theme-page", "--theme-surface-primary", "--theme-surface-secondary", "--theme-surface-elevated"];
  for (const surfaceName of surfaceNames) {
    const ratio = contrastRatio(tokens["--theme-text"], tokens[surfaceName], tokens["--theme-page"]);
    assert(ratio >= 4.5, `${label}: primary text contrast on ${surfaceName} is ${ratio.toFixed(2)}:1`);
    const mutedRatio = contrastRatio(tokens["--theme-text-muted"], tokens[surfaceName], tokens["--theme-page"]);
    assert(mutedRatio >= 4.5, `${label}: muted text contrast on ${surfaceName} is ${mutedRatio.toFixed(2)}:1`);
    const accentTextRatio = contrastRatio(tokens["--theme-accent-text"], tokens[surfaceName], tokens["--theme-page"]);
    assert(accentTextRatio >= 4.5, `${label}: accent text contrast on ${surfaceName} is ${accentTextRatio.toFixed(2)}:1`);
  }
  const accentRatio = contrastRatio(tokens["--theme-on-accent"], tokens["--theme-accent"], tokens["--theme-page"]);
  assert(accentRatio >= 4.5, `${label}: on-accent contrast is ${accentRatio.toFixed(2)}:1`);
  for (const status of ["success", "warning", "danger"]) {
    const ratio = contrastRatio(
      tokens[`--status-${status}-text`],
      tokens[`--status-${status}-surface`],
      tokens["--theme-surface-primary"]
    );
    assert(ratio >= 4.5, `${label}: ${status} status contrast is ${ratio.toFixed(2)}:1`);
  }
}

const browserProbeExpression = `(() => {
  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const rect = element => {
    if (!visible(element)) return null;
    const value = element.getBoundingClientRect();
    return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
  };
  const intersects = (left, right) => Boolean(left && right && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top);
  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = getComputedStyle(document.body);
  const requiredTokens = ${JSON.stringify(requiredTokens)};
  const rootTokens = Object.fromEntries(requiredTokens.map(name => [name, rootStyle.getPropertyValue(name).trim()]));
  const bodyTokens = Object.fromEntries(requiredTokens.map(name => [name, bodyStyle.getPropertyValue(name).trim()]));
  const meaningfulControls = Array.from(document.querySelectorAll('button:not(:disabled), a[href], input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [role="button"]:not([aria-disabled="true"])'))
    .filter(visible)
    .filter(element => !element.closest('[aria-hidden="true"]'));
  const undersized = meaningfulControls.filter(element => {
    if (element.hasAttribute("data-touch-size-exempt")) return false;
    const value = element.getBoundingClientRect();
    return value.width < 44 || value.height < 44;
  }).map(element => {
    const value = element.getBoundingClientRect();
    return { label: element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent.trim().slice(0, 60) || element.outerHTML.slice(0, 80), width: value.width, height: value.height };
  });
  const shell = rect(document.querySelector('.dashboard-stage-shell'));
  const navigation = rect(document.querySelector('#dashboard-primary-nav'));
  const viewer = rect(document.querySelector('.router-viewer'));
  const content = document.querySelector('.router-inline-widget');
  const contentRect = rect(content);
  const overlays = ['.dashboard-now-strip:not(.is-hidden)', '.dashboard-quick-toggle:not(.is-hidden)', '.dashboard-launcher-dock:not(.is-hidden)']
    .map(selector => {
      const element = document.querySelector(selector);
      const position = element ? getComputedStyle(element).position : '';
      return { selector, position, rect: rect(element) };
    })
    .filter(item => item.rect && ['absolute', 'fixed', 'sticky'].includes(item.position));
  const contentTargets = content ? Array.from(content.querySelectorAll('button, a[href], input, select, textarea, .inline-card, .product-shell')).filter(visible).map(element => ({ label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 48), rect: rect(element) })) : [];
  const overlayIntersections = [];
  overlays.forEach(overlay => contentTargets.forEach(target => {
    if (intersects(overlay.rect, target.rect)) overlayIntersections.push({ overlay: overlay.selector, target: target.label });
  }));
  return {
    ready: Boolean(shell && navigation && viewer && meaningfulControls.length),
    theme: document.documentElement.dataset.theme || '',
    bodyTheme: document.body.dataset.theme || '',
    variant: document.documentElement.dataset.themeVariant || '',
    bodyVariant: document.body.dataset.themeVariant || '',
    layoutClass: document.body.dataset.layoutClass || '',
    rootTokens,
    bodyTokens,
    shell,
    navigation,
    viewer,
    content: contentRect,
    navigationViewerOverlap: intersects(navigation, viewer),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    verticalDocumentOverflow: document.documentElement.scrollHeight > innerHeight + 1,
    shellInBounds: Boolean(shell && shell.left >= -1 && shell.top >= -1 && shell.right <= innerWidth + 1 && shell.bottom <= innerHeight + 1),
    meaningfulControlCount: meaningfulControls.length,
    undersized,
    overlayIntersections,
    bodyOpacity: bodyStyle.opacity,
    contentOpacity: content ? getComputedStyle(content).opacity : '',
    surfaceOpacity: rootStyle.getPropertyValue('--dashboard-surface-opacity').trim(),
    widgetOpacity: rootStyle.getPropertyValue('--dashboard-widget-opacity').trim()
  };
})()`;

function validateProbe(probe, theme, variant, viewport) {
  const label = `${theme}-${variant}-${viewport.name}`;
  assert(probe.ready, `${label}: dashboard did not render meaningful content`);
  assert(probe.theme === theme && probe.bodyTheme === theme, `${label}: html/body theme mismatch: ${probe.theme}/${probe.bodyTheme}`);
  assert(probe.variant === variant && probe.bodyVariant === variant, `${label}: html/body variant mismatch: ${probe.variant}/${probe.bodyVariant}`);
  assert(probe.layoutClass === viewport.expectedLayout, `${label}: expected layout ${viewport.expectedLayout}, got ${probe.layoutClass}`);
  assert(probe.shellInBounds, `${label}: shell escaped viewport: ${JSON.stringify(probe.shell)}`);
  assert(!probe.navigationViewerOverlap, `${label}: navigation overlaps viewer`);
  assert(!probe.horizontalOverflow, `${label}: document has horizontal overflow`);
  assert(!probe.verticalDocumentOverflow, `${label}: document has vertical overflow`);
  assert(probe.meaningfulControlCount > 0, `${label}: no meaningful controls were visible`);
  assert(probe.undersized.length === 0, `${label}: controls below 44x44px: ${JSON.stringify(probe.undersized)}`);
  assert(probe.overlayIntersections.length === 0, `${label}: overlays obscure content: ${JSON.stringify(probe.overlayIntersections.slice(0, 12))}`);
  for (const token of requiredTokens) {
    assert(probe.rootTokens[token], `${label}: root token ${token} is empty`);
    assert(probe.bodyTokens[token] === probe.rootTokens[token], `${label}: body shadows ${token}: root=${probe.rootTokens[token]} body=${probe.bodyTokens[token]}`);
  }
  assert(probe.bodyOpacity === "1", `${label}: body opacity must remain 1, got ${probe.bodyOpacity}`);
  assert(probe.contentOpacity === "1", `${label}: content opacity must remain 1, got ${probe.contentOpacity}`);
  validateContrast(probe.rootTokens, label);
  if (variant === "night") {
    assert(Number(probe.rootTokens["--theme-motion-scale"]) === 0, `${label}: Night must disable nonessential motion`);
    assert(Number(probe.rootTokens["--theme-night-brightness"]) < 1, `${label}: Night brightness multiplier must be below 1`);
    assert(Number(probe.rootTokens["--theme-night-glow"]) < 1, `${label}: Night glow multiplier must be below 1`);
  }
}

async function waitForRenderedTheme(cdp, theme, variant) {
  await waitForCondition(
    cdp,
    `document.querySelector('.dashboard-stage-shell') && document.querySelector('#dashboard-primary-nav') && document.documentElement.dataset.theme === ${JSON.stringify(theme)} && document.documentElement.dataset.themeVariant === ${JSON.stringify(variant)}`,
    `${theme} ${variant} dashboard`
  );
  await delay(600);
}

async function captureScreenshot(cdp, filename) {
  const capture = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  assert(capture.data, `screenshot ${filename} returned no image data`);
  writeFileSync(join(artifactDirectory, filename), Buffer.from(capture.data, "base64"));
}

async function assertReducedMotion(cdp, label) {
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  await delay(100);
  const reducedProbe = await evaluate(cdp, `(() => {
    const selectors = ['.dashboard-ambient-canvas', '.dashboard-ambient-layer', '.dashboard-stage-shell', '.router-rail', '.router-viewer', '.product-swatch', '.xn-slider'];
    const pseudoSelectors = [
      ['.router-picker__button', '::before'],
      ['.product-card--button', '::after'],
      ['.product-swatch', '::after'],
      ['.product-layout-row', '::after']
    ];
    const seconds = value => String(value || '').split(',').reduce((max, part) => {
      const text = part.trim();
      const number = parseFloat(text) || 0;
      return Math.max(max, text.endsWith('ms') ? number / 1000 : number);
    }, 0);
    const elementOffenders = selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).filter(element => {
      const style = getComputedStyle(element);
      return seconds(style.animationDuration) > 0 || seconds(style.transitionDuration) > 0;
    }).map(element => ({ selector, animation: getComputedStyle(element).animationDuration, transition: getComputedStyle(element).transitionDuration })));
    const pseudoOffenders = pseudoSelectors.flatMap(([selector, pseudo]) => Array.from(document.querySelectorAll(selector)).filter(element => {
      const style = getComputedStyle(element, pseudo);
      return seconds(style.animationDuration) > 0 || seconds(style.transitionDuration) > 0;
    }).map(element => ({ selector: selector + pseudo, animation: getComputedStyle(element, pseudo).animationDuration, transition: getComputedStyle(element, pseudo).transitionDuration })));
    const canvas = document.querySelector('#dashboard-ambient-canvas');
    return {
      offenders: elementOffenders.concat(pseudoOffenders),
      ambientMotion: canvas ? canvas.dataset.ambientMotion || '' : 'missing'
    };
  })()`);
  assert(reducedProbe.offenders.length === 0, `${label}: reduced motion left animated elements: ${JSON.stringify(reducedProbe.offenders)}`);
  assert(reducedProbe.ambientMotion === "paused", `${label}: ambient renderer remained active after reduced-motion changed at runtime: ${JSON.stringify(reducedProbe)}`);
  await cdp.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await delay(100);
  const resumedMotion = await evaluate(cdp, "document.querySelector('#dashboard-ambient-canvas')?.dataset.ambientMotion || 'missing'");
  assert(resumedMotion === "running", `${label}: ambient renderer did not resume after reduced-motion was disabled: ${resumedMotion}`);
}

async function assertHighContrastReadability(cdp, theme) {
  const viewport = viewports.find(entry => entry.name === "ultrawide");
  await setViewport(cdp, viewport);
  await seedSettings(cdp, {
    themeSchemaVersion: "2",
    themeId: theme,
    accentMode: "custom",
    customAccentColor: "#1a2b3c",
    themeVariant: "standard",
    themeReadability: "high-contrast",
    dashboardOpacity: "100",
    animationIntensity: "25"
  });
  await navigateAndWait(cdp, `${baseUrl}/dashboard.html?widget=home&renderedThemeTest=1&highContrast=${theme}`);
  await waitForRenderedTheme(cdp, theme, "standard");
  await waitForCondition(cdp, "document.body?.dataset.readability === 'high-contrast'", `${theme} high-contrast readability`);
  await evaluate(cdp, "document.activeElement?.blur() || true");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await delay(50);
  const probe = await evaluate(cdp, `(() => {
    const bodyStyle = getComputedStyle(document.body);
    const tokens = Object.fromEntries(${JSON.stringify(requiredTokens)}.map(name => [name, bodyStyle.getPropertyValue(name).trim()]));
    const active = document.querySelector('.auxora-primary-nav button[aria-pressed="true"]');
    const inactive = document.querySelector('.auxora-primary-nav button[aria-pressed="false"]');
    const focusTarget = document.activeElement;
    const focusStyle = focusTarget && focusTarget !== document.body ? getComputedStyle(focusTarget) : null;
    const activeStyle = active ? getComputedStyle(active) : null;
    const inactiveStyle = inactive ? getComputedStyle(inactive) : null;
    const ambient = Array.from(document.querySelectorAll('.dashboard-ambient-canvas, .dashboard-ambient-layer'));
    return {
      tokens,
      readability: document.body?.dataset.readability || '',
      ambientHidden: ambient.every(element => getComputedStyle(element).display === 'none'),
      pseudoBeforeContent: getComputedStyle(document.querySelector('.dashboard-stage-shell'), '::before').content,
      pseudoAfterContent: getComputedStyle(document.querySelector('.dashboard-stage-shell'), '::after').content,
      focus: focusStyle ? { label: focusTarget.getAttribute('aria-label') || focusTarget.textContent.trim(), width: focusStyle.outlineWidth, style: focusStyle.outlineStyle, color: focusStyle.outlineColor, visible: focusTarget.matches(':focus-visible') } : null,
      selectedBorder: activeStyle?.borderTopColor || '',
      unselectedBorder: inactiveStyle?.borderTopColor || '',
      selectedBackground: activeStyle?.backgroundColor || '',
      unselectedBackground: inactiveStyle?.backgroundColor || ''
    };
  })()`);
  assert(probe.readability === "high-contrast", `${theme}: high-contrast mode was not applied`);
  assert(probe.ambientHidden && ["none", "normal"].includes(probe.pseudoBeforeContent) && ["none", "normal"].includes(probe.pseudoAfterContent), `${theme}: high-contrast decorations remained active: ${JSON.stringify(probe)}`);
  assert(probe.tokens["--theme-panel-shadow"] === "none" && probe.tokens["--theme-panel-blur"] === "0px" && Number(probe.tokens["--theme-glow-intensity"]) === 0, `${theme}: high-contrast effects remained enabled`);
  for (const surfaceName of ["--theme-page", "--theme-surface-primary", "--theme-surface-secondary", "--theme-surface-elevated"]) {
    const textRatio = contrastRatio(probe.tokens["--theme-text"], probe.tokens[surfaceName], probe.tokens["--theme-page"]);
    const mutedRatio = contrastRatio(probe.tokens["--theme-text-muted"], probe.tokens[surfaceName], probe.tokens["--theme-page"]);
    const accentTextRatio = contrastRatio(probe.tokens["--theme-accent-text"], probe.tokens[surfaceName], probe.tokens["--theme-page"]);
    assert(textRatio >= 7 && mutedRatio >= 7, `${theme}: high-contrast text on ${surfaceName} is ${textRatio.toFixed(2)}:1/${mutedRatio.toFixed(2)}:1`);
    assert(accentTextRatio >= 4.5, `${theme}: custom accent text on ${surfaceName} is ${accentTextRatio.toFixed(2)}:1`);
  }
  for (const borderName of ["--theme-border", "--theme-border-strong", "--theme-accent-border"]) {
    const ratio = contrastRatio(probe.tokens[borderName], probe.tokens["--theme-surface-primary"], probe.tokens["--theme-page"]);
    assert(ratio >= 3, `${theme}: ${borderName} boundary contrast is ${ratio.toFixed(2)}:1`);
  }
  for (const status of ["success", "warning", "danger"]) {
    const ratio = contrastRatio(probe.tokens[`--status-${status}-border`], probe.tokens[`--status-${status}-surface`], probe.tokens["--theme-surface-primary"]);
    assert(ratio >= 3, `${theme}: ${status} boundary contrast is ${ratio.toFixed(2)}:1`);
  }
  assert(probe.focus && probe.focus.visible && parseFloat(probe.focus.width) >= 3 && probe.focus.style !== "none", `${theme}: high-contrast focus indicator is missing: ${JSON.stringify(probe.focus)}`);
  const focusRatio = contrastRatio(probe.focus.color, probe.tokens["--theme-surface-elevated"], probe.tokens["--theme-page"]);
  assert(focusRatio >= 3, `${theme}: high-contrast focus indicator is ${focusRatio.toFixed(2)}:1`);
  const selectedBorderRatio = contrastRatio(probe.selectedBorder, probe.tokens["--theme-surface-primary"], probe.tokens["--theme-page"]);
  assert(selectedBorderRatio >= 3 && probe.selectedBorder !== probe.unselectedBorder, `${theme}: selected navigation boundary is not distinct: ${JSON.stringify(probe)}`);
  await captureScreenshot(cdp, `${theme}-high-contrast-${viewport.width}x${viewport.height}.png`);
  console.log(`rendered ${theme} high contrast ${viewport.width}x${viewport.height}: captured`);
}

function installQuickControlsForcedColorsFixture() {
  if (!location.search.includes("quickControlsForcedColors=1")) return;
  const originalFetch = window.fetch;
  const fixture = window.__quickControlsForcedColorsFixture = { reads: { audio: 0, media: 0 }, blocked: [], scenes: null, sceneEvaluations: 0 };
  const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = function (input, options) {
    const url = new URL(typeof input === "string" ? input : input.url || input, location.href);
    const method = String(options?.method || input?.method || "GET").toUpperCase();
    if (url.origin === location.origin && url.pathname === "/api/config" && method === "GET") {
      return originalFetch.apply(this, arguments).then(async result => {
        const payload = await result.json();
        fixture.scenes = payload.scenes;
        return response(payload, result.status);
      });
    }
    if (url.origin === location.origin && url.pathname === "/api/scenes/evaluate" && method === "POST") {
      // Synthetic playback must not activate a real mode in the isolated host
      // and contaminate the next theme case. Keep its observed scene unchanged.
      fixture.sceneEvaluations += 1;
      return Promise.resolve(response(fixture.scenes || { message: "Scene fixture not hydrated" }, fixture.scenes ? 200 : 503));
    }
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
      const state = kind === "audio"
        ? { masterVolume: 42, muted: false, defaultDeviceId: "theme-fixture-speakers", devices: [], sessions: [] }
        : { playbackStatus: "playing", canPlay: true, canPause: true };
      return Promise.resolve(response({ supported: true, configured: true, status: "live", stale: false, sampledAt: new Date().toISOString(), ...state }));
    }
    // This appearance probe never operates Windows audio or another player's
    // transport. Even an accidental mutation is blocked before leaving the page.
    fixture.blocked.push({ path: url.pathname, method });
    return Promise.resolve(response({ message: "Read-only theme fixture blocked an unexpected audio/media request" }, 400));
  };
}

async function probeForcedColorsQuickControls() {
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const drawer = document.getElementById("dashboard-quick-drawer");
  const toggle = document.getElementById("dashboard-quick-toggle");
  const media = document.getElementById("dashboard-quick-media");
  const volume = document.getElementById("dashboard-quick-volume");
  const controls = [volume, document.getElementById("dashboard-quick-mute"), document.getElementById("dashboard-quick-playback")];
  const fixture = window.__quickControlsForcedColorsFixture;
  if (!drawer || !toggle || !media || !fixture || controls.some(control => !control)) throw new Error("Quick controls forced-colors fixture or markup is missing");
  const backgroundFor = element => {
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const color = getComputedStyle(ancestor).backgroundColor;
      if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const labelFits = element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const label = range.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return label.width > 0 && label.left >= bounds.left - 1 && label.right <= bounds.right + 1 && label.top >= bounds.top - 1 && label.bottom <= bounds.bottom + 1 && element.scrollWidth <= element.clientWidth + 1;
  };
  toggle.focus(); toggle.click();
  try {
    const deadline = Date.now() + 10000;
    while (controls.some(control => control.disabled) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (controls.some(control => control.disabled)) throw new Error("Fresh read-only fixture did not enable Quick controls");
    await frames();
    const result = {
      minimum: innerWidth >= 1800 && innerHeight >= 600 ? 54 : 44,
      focusContained: drawer.contains(document.activeElement),
      volume: volume.value,
      controls: [],
      text: [],
      optOuts: [drawer, ...drawer.querySelectorAll("*")].filter(element => getComputedStyle(element).forcedColorAdjust === "none").map(element => element.id || element.className),
      overflow: document.documentElement.scrollWidth > innerWidth + 1 || drawer.scrollWidth > drawer.clientWidth + 1
    };
    for (const control of controls) {
      control.scrollIntoView({ block: "center", inline: "nearest" });
      control.focus();
      await frames();
      const bounds = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      const name = control.getAttribute("aria-label") || [...(control.labels || [])].map(label => label.textContent).join(" ") || control.textContent.trim();
      result.controls.push({
        id: control.id, name, width: bounds.width, height: bounds.height,
        reachable: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1 && !!hit && (control === hit || control.contains(hit)),
        focusVisible: document.activeElement === control && control.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 3,
        labelFits: control.tagName !== "BUTTON" || labelFits(control),
        fontSize: parseFloat(style.fontSize),
        borderVisible: control.tagName !== "BUTTON" || style.borderTopStyle !== "none" && parseFloat(style.borderTopWidth) >= 1,
        color: style.color, background: backgroundFor(control)
      });
    }
    for (const element of media.querySelectorAll("strong, label, output, p")) {
      element.scrollIntoView({ block: "center", inline: "nearest" });
      await frames();
      const style = getComputedStyle(element);
      result.text.push({ id: element.id || element.tagName, text: element.textContent.trim(), labelFits: labelFits(element), color: style.color, background: backgroundFor(element), fontSize: parseFloat(style.fontSize) });
    }
    result.slider = { background: backgroundFor(volume) };
    result.reads = { ...fixture.reads };
    result.blocked = [...fixture.blocked];
    return result;
  } catch (error) {
    drawer.querySelector("[data-quick-close]").click();
    throw error;
  }
}

async function readForcedColorSliderMarkers(cdp) {
  // Chromium's getComputedStyle(input, '::-webkit-slider-thumb') returns the
  // input host's style, not the rendered UA shadow node. Inspect those actual
  // rendered nodes so marker dimensions and contrast cannot pass by proxy.
  await evaluate(cdp, `(async () => { document.getElementById('dashboard-quick-volume').scrollIntoView({ block: 'center', inline: 'nearest' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()`, true);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const descendants = node => [node, ...(node.children || []).flatMap(descendants), ...(node.shadowRoots || []).flatMap(descendants), ...(node.pseudoElements || []).flatMap(descendants)];
  const attributes = node => Object.fromEntries(Array.from({ length: (node.attributes || []).length / 2 }, (_, index) => [node.attributes[index * 2], node.attributes[index * 2 + 1]]));
  const input = descendants(root).find(node => attributes(node).id === "dashboard-quick-volume");
  assert(input, "Quick volume range was missing from the rendered DOM");
  const nodes = (input.shadowRoots || []).flatMap(descendants);
  const marker = pseudo => nodes.find(node => attributes(node).pseudo === pseudo || node.pseudoType === pseudo);
  const track = marker("-webkit-slider-runnable-track");
  const thumb = marker("-webkit-slider-thumb") || nodes.find(node => attributes(node).id === "thumb");
  assert(track && thumb, `Quick volume rendered slider markers were not found: ${JSON.stringify(nodes.map(node => ({ nodeName: node.nodeName, attributes: attributes(node), pseudoType: node.pseudoType })))}`);
  const read = async node => {
    const { computedStyle } = await cdp.send("CSS.getComputedStyleForNode", { nodeId: node.nodeId });
    const style = Object.fromEntries(computedStyle.map(property => [property.name, property.value]));
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId });
    const width = Math.max(model.border[0], model.border[2], model.border[4], model.border[6]) - Math.min(model.border[0], model.border[2], model.border[4], model.border[6]);
    const height = Math.max(model.border[1], model.border[3], model.border[5], model.border[7]) - Math.min(model.border[1], model.border[3], model.border[5], model.border[7]);
    return { color: style["background-color"], width, height, forcedColorAdjust: style["forced-color-adjust"] };
  };
  const trackStyle = await read(track);
  const thumbStyle = await read(thumb);
  assert(trackStyle.forcedColorAdjust !== "none" && thumbStyle.forcedColorAdjust !== "none", "Quick volume rendered slider markers opted out of forced colors");
  return { track: trackStyle.color, thumb: thumbStyle.color, trackHeight: trackStyle.height, thumbWidth: thumbStyle.width, thumbHeight: thumbStyle.height };
}

async function assertForcedColors(cdp, label) {
  const fixtureUrl = await evaluate(cdp, `(() => { const url = new URL(location.href); url.searchParams.set('quickControlsForcedColors', '1'); return url.href; })()`);
  await navigateAndWait(cdp, fixtureUrl);
  await waitForCondition(cdp, "document.body?.dataset.bridgeHydrated === 'true' && window.__quickControlsForcedColorsFixture", `${label} read-only fixture hydration`);
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "forced-colors", value: "active" }]
  });
  await delay(100);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  const probe = await evaluate(cdp, `(() => {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const controls = Array.from(document.querySelectorAll('.auxora-primary-nav button, #dashboard-favorites button, #dashboard-panels-toggle, #dashboard-widget-picker button, #dashboard-inline-widget button')).filter(visible);
    const controlBorders = controls.map(element => {
      const style = getComputedStyle(element);
      return {
        label: element.getAttribute('aria-label') || element.textContent.trim(),
        style: style.borderTopStyle,
        width: parseFloat(style.borderTopWidth) || 0,
        color: style.color,
        background: style.backgroundColor
      };
    });
    const active = document.querySelector('.auxora-primary-nav button[aria-pressed="true"]');
    const inactive = document.querySelector('.auxora-primary-nav button[aria-pressed="false"]');
    const activeStyle = active ? getComputedStyle(active) : null;
    const inactiveStyle = inactive ? getComputedStyle(inactive) : null;
    const focusTarget = document.activeElement;
    const focusStyle = focusTarget ? getComputedStyle(focusTarget) : null;
    return {
      mediaActive: matchMedia('(forced-colors: active)').matches,
      ambientHidden: Array.from(document.querySelectorAll('.dashboard-ambient-canvas, .dashboard-ambient-layer')).every(element => getComputedStyle(element).display === 'none'),
      controlBorders,
      activeDistinct: !!activeStyle && !!inactiveStyle && (activeStyle.backgroundColor !== inactiveStyle.backgroundColor || activeStyle.color !== inactiveStyle.color),
      focusVisible: !!focusTarget && focusTarget !== document.body && focusTarget.matches(':focus-visible') && focusStyle.outlineStyle !== 'none' && (parseFloat(focusStyle.outlineWidth) || 0) >= 3,
      forcedColorOptOuts: Array.from(document.querySelectorAll('body.dashboard-native-page *')).filter(element => getComputedStyle(element).forcedColorAdjust === 'none').map(element => element.className || element.tagName).slice(0, 20),
      overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1,
      fatal: /Dashboard failed|Dashboard runtime error/i.test(document.body?.innerText || '')
    };
  })()`);
  const catalogProbe = await evaluate(cdp, `(async () => {
    const toggle = document.getElementById('dashboard-panels-toggle');
    toggle.focus(); toggle.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const drawer = document.getElementById('dashboard-panels-drawer');
    const buttons = [...drawer.querySelectorAll('button')];
    const kept = drawer.querySelector('[data-favorite-widget][aria-pressed="true"]');
    const unkept = drawer.querySelector('[data-favorite-widget][aria-pressed="false"]');
    const selectionDistinct = !!kept && !!unkept && (getComputedStyle(kept).backgroundColor !== getComputedStyle(unkept).backgroundColor || getComputedStyle(kept).color !== getComputedStyle(unkept).color);
    const result = {
      panelCount: drawer.querySelectorAll('[data-widget-id]').length,
      buttonCount: buttons.length,
      borderless: buttons.filter(button => getComputedStyle(button).borderTopStyle === 'none' || parseFloat(getComputedStyle(button).borderTopWidth) < 1).map(button => button.getAttribute('aria-label') || button.textContent),
      selectionDistinct,
      focusContained: drawer.contains(document.activeElement),
      focusOutlined: getComputedStyle(document.activeElement).outlineStyle !== 'none' && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 3
    };
    drawer.querySelector('[data-panels-close]').click();
    result.focusReturned = document.activeElement === toggle;
    return result;
  })()`, true);
  for (const viewport of [
    { width: 800, height: 480, expectedLayout: "compact" },
    { width: 720, height: 480, expectedLayout: "compact" },
    { width: 390, height: 844, expectedLayout: "portrait" },
    { width: 2560, height: 720, expectedLayout: "ultrawide" }
  ]) {
    await setViewport(cdp, viewport);
    await waitForCondition(cdp, `document.body?.dataset.layoutClass === ${JSON.stringify(viewport.expectedLayout)}`, `${label} ${viewport.width}x${viewport.height} layout`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    let quick;
    try {
      quick = await evaluate(cdp, `(${probeForcedColorsQuickControls.toString()})()`, true);
      quick.slider = { ...quick.slider, ...await readForcedColorSliderMarkers(cdp) };
      await captureScreenshot(cdp, `${label}-quick-${viewport.width}x${viewport.height}.png`);
    } finally {
      const closed = await evaluate(cdp, `(async () => {
        const drawer = document.getElementById('dashboard-quick-drawer');
        const toggle = document.getElementById('dashboard-quick-toggle');
        if (!drawer.classList.contains('is-hidden')) drawer.querySelector('[data-quick-close]').click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return drawer.classList.contains('is-hidden') && document.activeElement === toggle;
      })()`, true);
      assert(closed, `${label}: Quick controls did not close and restore focus after the forced-colors probe`);
    }
    const quickLabel = `${label} Quick controls ${viewport.width}x${viewport.height}`;
    assert(quick.focusContained && quick.volume === "42" && quick.controls.length === 3, `${quickLabel}: fresh controls or modal focus were incomplete: ${JSON.stringify(quick)}`);
    assert(quick.controls.every(control => control.name && control.width >= quick.minimum && control.height >= quick.minimum && control.reachable && control.focusVisible && control.labelFits && control.borderVisible && (control.id === "dashboard-quick-volume" || control.fontSize >= (quick.minimum === 54 ? 15 : 12))), `${quickLabel}: control bounds, labels, focus, or boundaries failed: ${JSON.stringify(quick.controls)}`);
    assert(quick.text.length === 5 && quick.text.every(item => item.text && item.labelFits && item.fontSize >= (quick.minimum === 54 ? 14 : 12)), `${quickLabel}: volume, labels, or status text was clipped or unreadable: ${JSON.stringify(quick.text)}`);
    for (const item of [...quick.controls, ...quick.text]) {
      assert(contrastRatio(item.color, item.background) >= 4.5, `${quickLabel}: ${item.id} text did not retain 4.5:1 contrast: ${JSON.stringify(item)}`);
    }
    assert(quick.slider.trackHeight >= 10 && quick.slider.thumbWidth >= 28 && quick.slider.thumbHeight >= 28 && contrastRatio(quick.slider.track, quick.slider.background) >= 3 && contrastRatio(quick.slider.thumb, quick.slider.background) >= 3, `${quickLabel}: slider markers lost size or contrast: ${JSON.stringify(quick.slider)}`);
    assert(!quick.overflow && quick.optOuts.length === 0 && quick.reads.audio > 0 && quick.reads.media > 0 && quick.blocked.length === 0, `${quickLabel}: overflow, forced-color opt-out, or unexpected mutation: ${JSON.stringify(quick)}`);
  }
  await cdp.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "forced-colors", value: "none" }] });
  assert(probe.mediaActive, `${label}: forced-colors emulation did not activate`);
  assert(probe.ambientHidden, `${label}: decorative ambient layers remained visible in forced colors`);
  assert(probe.controlBorders.length >= 8, `${label}: forced-colors control inventory was incomplete: ${JSON.stringify(probe)}`);
  assert(probe.controlBorders.every(control => control.style !== "none" && control.width >= 1), `${label}: controls lost their visible boundary in forced colors: ${JSON.stringify(probe.controlBorders)}`);
  assert(probe.activeDistinct, `${label}: active navigation lost its forced-colors selection state`);
  assert(probe.focusVisible, `${label}: keyboard focus was not visibly outlined in forced colors`);
  assert(probe.forcedColorOptOuts.length === 0, `${label}: elements opted out of Windows forced colors: ${JSON.stringify(probe.forcedColorOptOuts)}`);
  assert(!probe.overflow && !probe.fatal, `${label}: forced colors created overflow or a fatal state: ${JSON.stringify(probe)}`);
  assert(catalogProbe.panelCount === 23 && catalogProbe.buttonCount === 47 && catalogProbe.borderless.length === 0 && catalogProbe.selectionDistinct && catalogProbe.focusContained && catalogProbe.focusOutlined && catalogProbe.focusReturned, `${label}: All panels lost inventory, control boundaries, kept state, or keyboard focus in forced colors: ${JSON.stringify(catalogProbe)}`);
}

async function runThemeMatrix(cdp) {
  const fingerprints = new Map();
  const matrixFailures = [];
  for (const theme of themes) {
    for (const viewport of viewports) {
      await setViewport(cdp, viewport);
      const settings = {
        themeSchemaVersion: "2",
        themeId: theme,
        accentMode: "preset",
        customAccentColor: "",
        themeVariant: "standard",
        dashboardOpacity: viewport.name === "standard" ? "35" : "100",
        animationIntensity: "25"
      };
      await seedSettings(cdp, settings);
      await navigateAndWait(cdp, `${baseUrl}/dashboard.html?widget=home&renderedThemeTest=1`);
      await waitForRenderedTheme(cdp, theme, "standard");
      const probe = await evaluate(cdp, browserProbeExpression);
      await captureScreenshot(cdp, `${theme}-${viewport.width}x${viewport.height}.png`);
      try {
        validateProbe(probe, theme, "standard", viewport);
        if (viewport.name === "standard") {
          assert(Number(probe.surfaceOpacity) === 0.35 && Number(probe.widgetOpacity) === 0.35, `${theme}: 35% opacity did not reach surface tokens`);
        }
      } catch (error) {
        matrixFailures.push(error.message);
      }
      if (viewport.name === "ultrawide") {
        fingerprints.set(theme, probe.rootTokens);
        try {
          await assertReducedMotion(cdp, `${theme}-reduced-motion`);
          await assertForcedColors(cdp, `${theme}-forced-colors`);
        } catch (error) {
          matrixFailures.push(error.message);
          console.warn(`${theme} accessibility probe: ${error.message}`);
        } finally {
          await cdp.send("Emulation.setEmulatedMedia", { media: "screen", features: [] });
        }
      }
      console.log(`rendered ${theme} ${viewport.width}x${viewport.height}: captured`);
    }

    const viewport = viewports.find(entry => entry.name === "ultrawide");
    await setViewport(cdp, viewport);
    await seedSettings(cdp, {
      themeSchemaVersion: "2",
      themeId: theme,
      accentMode: "preset",
      customAccentColor: "",
      themeVariant: "night",
      dashboardOpacity: "100",
      animationIntensity: "25"
    });
    await navigateAndWait(cdp, `${baseUrl}/dashboard.html?widget=home&renderedThemeTest=1`);
    await waitForRenderedTheme(cdp, theme, "night");
    const nightProbe = await evaluate(cdp, browserProbeExpression);
    await captureScreenshot(cdp, `${theme}-night-${viewport.width}x${viewport.height}.png`);
    try {
      validateProbe(nightProbe, theme, "night", viewport);
    } catch (error) {
      matrixFailures.push(error.message);
    }
    console.log(`rendered ${theme} night ${viewport.width}x${viewport.height}: captured`);
    await assertHighContrastReadability(cdp, theme);
  }

  const structuralTokens = requiredTokens.filter(token => !token.includes("accent") && !token.startsWith("--status-") && !token.includes("night"));
  for (let leftIndex = 0; leftIndex < themes.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < themes.length; rightIndex++) {
      const left = themes[leftIndex];
      const right = themes[rightIndex];
      const differences = structuralTokens.filter(token => fingerprints.get(left)[token] !== fingerprints.get(right)[token]);
      if (differences.length < 6) {
        matrixFailures.push(`${left}/${right}: themes differ in only ${differences.length} non-accent structural tokens`);
      }
    }
  }
  if (matrixFailures.length) {
    throw new Error(`rendered theme matrix failed with ${matrixFailures.length} issue${matrixFailures.length === 1 ? "" : "s"}:\n${matrixFailures.map((failure, index) => `${index + 1}. ${failure}`).join("\n")}`);
  }
}

async function readPersistedSettings(cdp) {
  return evaluate(cdp, `JSON.parse(localStorage.getItem(${JSON.stringify(settingsStorageKey)}) || '{}')`);
}

async function openThemeStudio(cdp) {
  await waitForCondition(cdp, "document.querySelector('[data-destination=\"settings\"]')", "Settings destination");
  await evaluate(cdp, "document.querySelector('[data-destination=\"settings\"]').click()");
  await evaluate(cdp, "document.getElementById('dashboard-panels-toggle').click()");
  await waitForCondition(cdp, "document.querySelector('[data-widget-id=\"theme-studio\"]')", "Theme Studio picker entry");
  await evaluate(cdp, "document.querySelector('#dashboard-widget-picker [data-widget-id=\"theme-studio\"]').click()");
  await waitForCondition(
    cdp,
    "document.querySelectorAll('.product-swatch[data-theme]').length === 3 && document.querySelector('[name=\"accentMode\"]')",
    "Theme Studio controls"
  );
  const themeControlContract = await evaluate(cdp, `({
    themeCards: document.querySelectorAll('.product-swatch[data-theme][role="radio"]').length,
    redundantThemeSelects: document.querySelectorAll('select[name="themeId"]').length
  })`);
  assert(themeControlContract.themeCards === 3 && themeControlContract.redundantThemeSelects === 0, `Theme Studio exposed redundant Theme controls: ${JSON.stringify(themeControlContract)}`);
}

async function runLegacyBrowserMigration(cdp) {
  const viewport = viewports.find(entry => entry.name === "standard");
  await setViewport(cdp, viewport);
  const mappings = [
    ["edge", "#00e0ff", "focus"],
    ["deepcore", "#7a5cff", "gaming"],
    ["afterburn", "#ff4d8d", "warm"],
    ["verdant", "#44f0c2", "focus"],
    ["unknown-theme", "", "focus"]
  ];
  for (const [legacyTheme, legacyAccent, expectedTheme] of mappings) {
    await seedSettings(cdp, { themeId: legacyTheme, accentColor: legacyAccent, themeVariant: "standard" });
    await navigateAndWait(cdp, `${baseUrl}/dashboard.html?widget=theme-studio&renderedThemeTest=1`);
    await waitForRenderedTheme(cdp, expectedTheme, "standard");
    await waitForCondition(
      cdp,
      "document.querySelector('[data-form=\"theme-studio\"]') && document.querySelectorAll('.product-swatch[data-theme]').length === 3",
      `${legacyTheme} Theme Studio readiness`
    );
    const settings = await readPersistedSettings(cdp);
    assert(settings.themeSchemaVersion === "2", `${legacyTheme}: migration did not persist schema 2`);
    assert(settings.themeId === expectedTheme, `${legacyTheme}: expected ${expectedTheme}, got ${settings.themeId}`);
    assert(settings.accentMode === "preset", `${legacyTheme}: legacy preset accent must migrate to preset mode`);
    assert(!settings.customAccentColor && !settings.accentColor, `${legacyTheme}: legacy preset accent was not cleared`);
  }
  console.log("browser legacy theme migrations: passed");
}

async function runLegacyMigrationProbe(cdp) {
  const viewport = viewports.find(entry => entry.name === "standard");
  await setViewport(cdp, viewport);
  await seedSettings(cdp, { themeId: "edge", accentColor: "#00e0ff", themeVariant: "standard" });
  const seeded = await readPersistedSettings(cdp);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const key = ${JSON.stringify(settingsStorageKey)};
      const original = Storage.prototype.setItem;
      window.__auxoraThemeWrites = [];
      Storage.prototype.setItem = function (name, value) {
        if (this === window.localStorage && name === key) {
          window.__auxoraThemeWrites.push({ value: String(value), stack: String(new Error().stack || "") });
        }
        return original.call(this, name, value);
      };
    })()`
  });
  await navigateAndWait(cdp, `${baseUrl}/dashboard.html?widget=theme-studio&renderedThemeTest=1&legacyProbe=1`);
  const samples = [];
  for (const milliseconds of [0, 50, 100, 250, 500, 1000, 2000]) {
    if (milliseconds) {
      await delay(milliseconds);
    }
    samples.push(await evaluate(cdp, `({
      elapsedAfterPreviousSample: ${milliseconds},
      rootTheme: document.documentElement.dataset.theme || "",
      bodyTheme: document.body?.dataset.theme || "",
      stored: JSON.parse(localStorage.getItem(${JSON.stringify(settingsStorageKey)}) || "{}"),
      writes: window.__auxoraThemeWrites || []
    })`));
  }
  const nativeConfig = await evaluate(cdp, "fetch('/api/config').then(response => response.json())");
  const loadedDashboardSource = await evaluate(cdp, `fetch('/js/dashboard.js').then(response => response.text()).then(text => ({
    edgeMapsToFocus: /edge:\\s*[\"']focus[\"']/.test(text),
    bytes: text.length
  }))`);
  console.log(JSON.stringify({ seeded, nativeDashboard: nativeConfig.dashboard, loadedDashboardSource, samples }, null, 2));
}

async function runThemeSelectionState(cdp) {
  const viewport = viewports.find(entry => entry.name === "standard");
  await setViewport(cdp, viewport);
  await seedSettings(cdp, {
    themeSchemaVersion: "2",
    themeId: "focus",
    accentMode: "custom",
    customAccentColor: "#1a2b3c",
    themeVariant: "standard"
  });
  await navigateAndWait(cdp, `${baseUrl}/dashboard.html?widget=theme-studio&renderedThemeTest=1`);
  await waitForRenderedTheme(cdp, "focus", "standard");
  await openThemeStudio(cdp);

  const focusedRedraw = await evaluate(cdp, `(() => {
    window.__auxoraThemeRuntimeErrors = [];
    window.addEventListener('error', event => {
      window.__auxoraThemeRuntimeErrors.push(String(event.error?.message || event.message || 'runtime error'));
    }, true);
    const select = document.querySelector('select[name="accentMode"]');
    select.focus();
    select.value = 'custom';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      activeControlPreserved: document.activeElement === select,
      controlStillConnected: select.isConnected
    };
  })()`);
  await delay(100);
  const focusedRedrawResult = await evaluate(cdp, `({
    errors: window.__auxoraThemeRuntimeErrors || [],
    fatalVisible: /Dashboard failed|Dashboard runtime error/.test(document.body.innerText || '')
  })`);
  assert(focusedRedraw.activeControlPreserved && focusedRedraw.controlStillConnected, `Theme Studio replaced its focused control during redraw: ${JSON.stringify(focusedRedraw)}`);
  assert(focusedRedrawResult.errors.length === 0 && !focusedRedrawResult.fatalVisible, `Theme Studio focused redraw crashed: ${JSON.stringify(focusedRedrawResult)}`);

  for (const theme of themes) {
    await evaluate(cdp, `document.querySelector('.product-swatch[data-theme=${JSON.stringify(theme)}]').click()`);
    await waitForCondition(cdp, `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, `${theme} swatch selection`);
    let settings = await readPersistedSettings(cdp);
    assert(settings.themeId === theme && settings.accentMode === "preset" && !settings.customAccentColor, `${theme}: swatch did not atomically reset custom accent: ${JSON.stringify(settings)}`);

  }

  await waitForCondition(cdp, "document.querySelector('[name=\"accentMode\"]') && document.querySelector('[name=\"customAccentColor\"]')", "explicit custom accent controls");
  await evaluate(cdp, `(() => {
    const mode = document.querySelector('[name="accentMode"]');
    mode.value = 'custom';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitForCondition(cdp, "document.querySelector('[name=\"customAccentColor\"]:not(:disabled)')", "enabled custom accent control");
  for (const accent of ["#000000", "#767676", "#ffffff", "#1a2b3c"]) {
    await evaluate(cdp, `(() => {
      const color = document.querySelector('[name="customAccentColor"]');
      color.value = ${JSON.stringify(accent)};
      color.dispatchEvent(new Event('input', { bubbles: true }));
      color.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitForCondition(
      cdp,
      `JSON.parse(localStorage.getItem('xeneon-dashboard-settings')).accentMode === 'custom' && JSON.parse(localStorage.getItem('xeneon-dashboard-settings')).customAccentColor === ${JSON.stringify(accent)}`,
      `${accent} custom accent persistence`
    );
    const customProbe = await evaluate(cdp, `(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const names = ${JSON.stringify(requiredTokens)};
      const tokens = Object.fromEntries(names.map(name => [name, rootStyle.getPropertyValue(name).trim()]));
      const eyebrow = document.querySelector('.eyebrow');
      return {
        tokens,
        eyebrowColor: eyebrow ? getComputedStyle(eyebrow).color : ''
      };
    })()`);
    assert(colorsEqual(customProbe.tokens["--theme-accent"], accent), `${accent}: raw custom accent was not preserved`);
    for (const surfaceName of ["--theme-page", "--theme-surface-primary", "--theme-surface-secondary", "--theme-surface-elevated"]) {
      const ratio = contrastRatio(customProbe.tokens["--theme-accent-text"], customProbe.tokens[surfaceName], customProbe.tokens["--theme-page"]);
      assert(ratio >= 4.5, `${accent}: accent text contrast on ${surfaceName} is ${ratio.toFixed(2)}:1`);
    }
    const onAccentRatio = contrastRatio(customProbe.tokens["--theme-on-accent"], customProbe.tokens["--theme-accent"]);
    assert(onAccentRatio >= 4.5, `${accent}: on-accent contrast is ${onAccentRatio.toFixed(2)}:1`);
    assert(customProbe.eyebrowColor && colorsEqual(customProbe.eyebrowColor, customProbe.tokens["--theme-accent-text"]), `${accent}: eyebrow did not use the contrast-safe accent foreground`);
  }
  const customSettings = await readPersistedSettings(cdp);
  assert(customSettings.customAccentColor === "#1a2b3c", `custom accent did not persist normalized value: ${JSON.stringify(customSettings)}`);
  const customAccent = await evaluate(cdp, "getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim().toLowerCase()");
  assert(["#1a2b3c", "rgb(26, 43, 60)"].includes(customAccent), `explicit custom accent did not reach semantic token: ${customAccent}`);
  await navigateAndWait(cdp, `${baseUrl}/dashboard.html?widget=theme-studio&renderedThemeTest=1&reloadCheck=1`);
  await waitForCondition(cdp, "document.documentElement.dataset.theme && document.querySelector('[name=\"accentMode\"]')", "custom theme reload");
  const reloadedSettings = await readPersistedSettings(cdp);
  assert(reloadedSettings.accentMode === "custom" && reloadedSettings.customAccentColor === "#1a2b3c", "custom accent did not survive reload");
  console.log("theme preset reset and explicit custom accent state: passed");
}

assert(process.platform === "win32", "rendered theme test requires Windows");
assert(existsSync(hostExecutable), "Release native host is missing; build app/XenonEdgeHost.sln first");
assert(browserExecutable, "System Edge or Chrome is required for rendered theme testing");
assert(typeof WebSocket === "function", "Node.js with built-in WebSocket support is required");
mkdirSync(artifactDirectory, { recursive: true });

const profileRoot = mkdtempSync(join(tmpdir(), "auxora-theme-rendered-profile-"));
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
  assert(existsSync(join(local, "Auxora", "logs", "host.log")), "theme host did not use the explicit isolated local-data root");
  assert(existsSync(join(roaming, "Auxora", "config.json")), "theme host did not use the explicit isolated roaming-data root");
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
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installQuickControlsForcedColorsFixture.toString()})()` });
    if (process.argv.includes("--probe-legacy-migration")) {
      await runLegacyMigrationProbe(cdp);
    } else {
      await runLegacyBrowserMigration(cdp);
      await runThemeSelectionState(cdp);
      await runThemeMatrix(cdp);
    }
  } finally {
    try {
      await cdp.send("Browser.close");
    } catch {
      // Edge may close the protocol socket before acknowledging Browser.close.
    }
    cdp.close();
  }
  console.log(`rendered 15 required theme/viewport combinations plus 3 high-contrast variants; screenshots: ${artifactDirectory}`);
} finally {
  await stopProcessTree(browser);
  try {
    await stopProcessTree(host);
  } finally {
    await stopVisibleWindowGuard(hostWindowGuard, "theme native host");
  }
  await delay(1500);
  try {
    rmSync(profileRoot, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  } catch (error) {
    console.warn(`isolated theme profile cleanup deferred: ${error.code || error.message}`);
  }
}
