const { app, BrowserWindow, Menu, clipboard, safeStorage, shell, screen } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");

const productName = "XENEON Edge Host";
const defaultPort = 8976;
const assetRevision = "20260425-25";
const maxJsonBodyBytes = 256 * 1024;
const releasesUrl = "https://github.com/SilverFuel/xeneon-widgets/releases";
const latestReleaseApiUrl = "https://api.github.com/repos/SilverFuel/xeneon-widgets/releases/latest";

let mainWindow = null;
let server = null;
let activePort = defaultPort;
let configPath = "";
let secretsPath = "";
let webRoot = "";

function createDefaultConfig() {
  return {
    port: defaultPort,
    weather: {
      city: "",
      units: "metric"
    },
    calendar: {
      icsUrl: ""
    },
    hue: {
      bridgeIp: ""
    },
    dashboard: {
      onboardingCompleted: false,
      onboardingCompletedAt: "",
      onboardingVersion: 1
    },
    launchers: []
  };
}

function ensureDataPaths() {
  const userData = app.getPath("userData");
  fs.mkdirSync(userData, { recursive: true });
  configPath = path.join(userData, "config.json");
  secretsPath = path.join(userData, "protected-secrets.json");
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeConfig(input) {
  const fallback = createDefaultConfig();
  const config = input && typeof input === "object" ? input : {};
  return {
    port: Number.isInteger(config.port) && config.port > 0 ? config.port : fallback.port,
    weather: {
      city: text(config.weather && config.weather.city, fallback.weather.city),
      units: text(config.weather && config.weather.units, fallback.weather.units) === "imperial" ? "imperial" : "metric"
    },
    calendar: {
      icsUrl: text(config.calendar && config.calendar.icsUrl, "")
    },
    hue: {
      bridgeIp: text(config.hue && config.hue.bridgeIp, "")
    },
    dashboard: {
      onboardingCompleted: Boolean(config.dashboard && config.dashboard.onboardingCompleted),
      onboardingCompletedAt: text(config.dashboard && config.dashboard.onboardingCompletedAt, ""),
      onboardingVersion: Number.isInteger(config.dashboard && config.dashboard.onboardingVersion)
        ? config.dashboard.onboardingVersion
        : fallback.dashboard.onboardingVersion
    },
    launchers: Array.isArray(config.launchers)
      ? config.launchers.map(normalizeLauncher).filter((entry) => entry.id && entry.displayName)
      : []
  };
}

function loadConfig() {
  const config = normalizeConfig(readJsonFile(configPath, createDefaultConfig()));
  writeJsonFile(configPath, config);
  return config;
}

function saveConfig(config) {
  const normalized = normalizeConfig(config);
  writeJsonFile(configPath, normalized);
  return normalized;
}

function resetLocalData(keepPort) {
  const port = keepPort ? activePort : defaultPort;
  saveSecrets({});
  return saveConfig({
    ...createDefaultConfig(),
    port
  });
}

function normalizeLauncher(entry) {
  const displayName = text(entry && entry.displayName, "");
  const executablePath = text(entry && entry.executablePath, "");
  const id = text(entry && entry.id, displayName || executablePath || "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  return {
    id,
    displayName,
    iconPath: text(entry && entry.iconPath, ""),
    executablePath,
    arguments: text(entry && entry.arguments, "")
  };
}

function loadSecrets() {
  return readJsonFile(secretsPath, {});
}

function saveSecrets(secrets) {
  writeJsonFile(secretsPath, secrets || {});
}

function canEncrypt() {
  return Boolean(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
}

function protectSecret(value) {
  if (!value || !canEncrypt()) {
    return null;
  }
  return {
    mode: "safeStorage",
    value: safeStorage.encryptString(value).toString("base64")
  };
}

function readSecret(name) {
  const secrets = loadSecrets();
  const entry = secrets && secrets[name];
  if (!entry || entry.mode !== "safeStorage" || !entry.value || !canEncrypt()) {
    return "";
  }

  try {
    return safeStorage.decryptString(Buffer.from(entry.value, "base64"));
  } catch {
    return "";
  }
}

function writeSecret(name, value) {
  const secrets = loadSecrets();
  if (!value) {
    delete secrets[name];
  } else {
    const protectedValue = protectSecret(value);
    if (!protectedValue) {
      throw new Error("Secure storage is unavailable on this Mac.");
    }
    secrets[name] = protectedValue;
  }
  saveSecrets(secrets);
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function setupItem(id, label, state, required, nextStep) {
  return { id, label, state, required, nextStep };
}

function findReleaseAsset(assets, predicate) {
  return assets.find(predicate) || null;
}

async function releaseSnapshot() {
  const currentVersion = app.getVersion();

  try {
    const response = await fetch(latestReleaseApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `XenonEdgeHost/${currentVersion}`
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const assets = Array.isArray(payload.assets)
      ? payload.assets
        .filter((asset) => asset && asset.name && asset.browser_download_url)
        .map((asset) => ({
          name: String(asset.name),
          downloadUrl: String(asset.browser_download_url),
          size: Number.isFinite(asset.size) ? asset.size : 0
        }))
      : [];
    const windowsAsset = findReleaseAsset(assets, (asset) => /setup/i.test(asset.name) && /\.exe$/i.test(asset.name));
    const macAsset = findReleaseAsset(assets, (asset) => /\.dmg$/i.test(asset.name) || /mac|darwin/i.test(asset.name));
    const latestVersion = String(payload.tag_name || payload.name || "");

    return {
      supported: true,
      configured: true,
      status: "live",
      currentVersion,
      latestVersion,
      htmlUrl: String(payload.html_url || releasesUrl),
      installerUrl: windowsAsset ? windowsAsset.downloadUrl : "",
      macUrl: macAsset ? macAsset.downloadUrl : "",
      assets,
      source: "GitHub Releases",
      sampledAt: nowIso(),
      message: latestVersion ? `Latest public release is ${latestVersion}.` : "Release feed is reachable, but no public release tag was found."
    };
  } catch (error) {
    return {
      supported: true,
      configured: true,
      status: "error",
      currentVersion,
      latestVersion: "",
      htmlUrl: releasesUrl,
      installerUrl: "",
      macUrl: "",
      assets: [],
      source: "GitHub Releases",
      sampledAt: nowIso(),
      message: error && error.message ? error.message : "Release check failed."
    };
  }
}

function buildConfigSnapshot() {
  const config = loadConfig();
  const weatherKey = readSecret("weatherApiKey");
  const hueAppKey = readSecret("hueAppKey");
  return {
    port: activePort,
    weather: {
      configured: Boolean(weatherKey),
      city: config.weather.city,
      units: config.weather.units,
      secureStorage: canEncrypt() ? "Electron safeStorage" : "Unavailable"
    },
    calendar: {
      configured: Boolean(config.calendar.icsUrl),
      icsUrl: config.calendar.icsUrl
    },
    launchers: {
      configured: config.launchers.length > 0,
      count: config.launchers.length
    },
    hue: {
      bridgeIp: config.hue.bridgeIp,
      configured: Boolean(config.hue.bridgeIp),
      linked: Boolean(hueAppKey),
      secureStorage: canEncrypt() ? "Electron safeStorage" : "Unavailable"
    },
    unifi: {
      configured: false,
      endpoint: "/api/unifi/network",
      localOnly: true
    },
    dashboard: config.dashboard
  };
}

function buildHealthPayload() {
  const config = loadConfig();
  const snapshot = buildConfigSnapshot();
  const audioReady = false;
  const hueNeedsLink = Boolean(config.hue.bridgeIp) && !snapshot.hue.linked;

  return {
    ok: true,
    capabilities: {
      system: true,
      network: true,
      launchers: true,
      quickActions: false,
      shortcuts: false,
      audio: false,
      weather: true,
      calendar: true,
      media: false,
      clipboard: true,
      hue: true,
      unifi: true
    },
    setup: {
      essentialsReady: true,
      onboardingCompleted: config.dashboard.onboardingCompleted,
      onboardingCompletedAt: config.dashboard.onboardingCompletedAt,
      onboardingVersion: config.dashboard.onboardingVersion,
      needsAttention: hueNeedsLink,
      items: {
        bridge: setupItem("bridge", "Local bridge", "Ready", true, `Running at http://127.0.0.1:${activePort}.`),
        system: setupItem("system", "System Monitor", "Ready", true, "Mac host telemetry is available."),
        network: setupItem("network", "Network Monitor", "Ready", true, "Mac host network status is available."),
        launchers: setupItem(
          "launchers",
          "App Launcher",
          config.launchers.length ? "Ready" : "Needs Setup",
          false,
          config.launchers.length ? "Pinned launchers are ready." : "Add apps or shortcuts to build your launcher grid."
        ),
        "quick-actions": setupItem("quick-actions", "Quick Actions", "Optional", false, "Windows quick actions are not in the Mac beta yet."),
        shortcuts: setupItem("shortcuts", "System Shortcuts", "Optional", false, "Power and brightness shortcuts are Windows-only in this beta."),
        audio: setupItem("audio", "Audio Control", audioReady ? "Ready" : "Optional", false, "Audio routing is Windows-only in this beta."),
        weather: setupItem(
          "weather",
          "Weather",
          snapshot.weather.configured ? "Ready" : "Optional",
          false,
          snapshot.weather.configured ? `Configured for ${config.weather.city}.` : "Add an OpenWeather key if you want weather."
        ),
        calendar: setupItem(
          "calendar",
          "Calendar",
          snapshot.calendar.configured ? "Ready" : "Optional",
          false,
          snapshot.calendar.configured ? "Calendar feed is configured." : "Add an ICS feed if you want calendar."
        ),
        media: setupItem("media", "Media Transport", "Optional", false, "Media transport is Windows-only in this beta."),
        clipboard: setupItem("clipboard", "Clipboard History", "Ready", false, "Clipboard text snapshot is available."),
        hue: setupItem(
          "hue",
          "Philips Hue",
          snapshot.hue.linked ? "Ready" : snapshot.hue.configured ? "Needs Setup" : "Optional",
          false,
          snapshot.hue.linked ? "Hue bridge is linked." : "Hue linking is planned for the Mac beta."
        ),
        unifi: setupItem("unifi", "UniFi Network", "Optional", false, "UniFi auto-discovery is planned for the Mac beta.")
      }
    }
  };
}

function unsupported(message) {
  return {
    supported: false,
    configured: false,
    status: "unsupported",
    source: "macOS beta host",
    message,
    sampledAt: nowIso(),
    stale: false,
    error: message
  };
}

function primaryDisplaySnapshot() {
  try {
    const display = screen.getPrimaryDisplay();
    const bounds = display && display.bounds ? display.bounds : {};
    const refreshRate = Number.isFinite(Number(display && display.displayFrequency))
      ? Number(display.displayFrequency)
      : null;
    return {
      supported: true,
      status: refreshRate ? "live" : "partial",
      name: text(display && (display.label || display.name), "Primary display"),
      deviceName: String(display && display.id ? display.id : ""),
      primary: true,
      width: Number.isFinite(Number(bounds.width)) ? Number(bounds.width) : null,
      height: Number.isFinite(Number(bounds.height)) ? Number(bounds.height) : null,
      refreshRate,
      fps: refreshRate,
      bitsPerPixel: Number.isFinite(Number(display && display.colorDepth)) ? Number(display.colorDepth) : null,
      scaleFactor: Number.isFinite(Number(display && display.scaleFactor)) ? Number(display.scaleFactor) : null,
      source: "Electron display API",
      sampledAt: nowIso(),
      message: refreshRate
        ? "Primary display FPS is the current display refresh rate."
        : "This Mac beta host did not report a display refresh rate."
    };
  } catch (error) {
    return {
      supported: false,
      status: "unavailable",
      name: "Primary display",
      primary: true,
      refreshRate: null,
      fps: null,
      source: "Electron display API",
      sampledAt: nowIso(),
      message: error && error.message ? error.message : "Primary display is unavailable."
    };
  }
}

function systemSnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    supported: true,
    configured: true,
    status: "live",
    sampledAt: nowIso(),
    stale: false,
    source: "macOS beta host",
    cpu: null,
    gpu: null,
    cpuTemp: null,
    gpuTemp: null,
    ram: total ? Math.round(((total - free) / total) * 100) : null,
    disk: null,
    primaryDisplay: primaryDisplaySnapshot(),
    topProcesses: [],
    platform: `${os.type()} ${os.release()}`
  };
}

function networkSnapshot() {
  const interfaces = Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) => (entries || []).map((entry) => ({ name, entry })))
    .filter((item) => item.entry.family === "IPv4" && !item.entry.internal);
  const first = interfaces[0];
  return {
    supported: true,
    configured: true,
    status: "live",
    sampledAt: nowIso(),
    stale: false,
    source: "macOS beta host",
    interfaceName: first ? first.name : "macOS",
    downloadMbps: 0,
    uploadMbps: 0,
    latencyMs: null,
    packetLossPercent: null,
    adapters: interfaces.map((item) => ({
      name: item.name
    }))
  };
}

async function weatherSnapshot(requestUrl) {
  const config = loadConfig();
  const apiKey = readSecret("weatherApiKey");
  const query = requestUrl.searchParams;
  const city = text(query.get("city"), config.weather.city);
  const units = text(query.get("units"), config.weather.units) === "imperial" ? "imperial" : "metric";

  if (!apiKey) {
    return {
      supported: true,
      configured: false,
      status: "setup",
      city,
      units,
      source: "OpenWeather",
      message: "Add an OpenWeather key in Diagnostics to enable weather.",
      sampledAt: nowIso(),
      stale: false,
      hourly: [],
      daily: []
    };
  }

  const endpoint = new URL("https://api.openweathermap.org/data/2.5/weather");
  endpoint.searchParams.set("q", city);
  endpoint.searchParams.set("appid", apiKey);
  endpoint.searchParams.set("units", units);

  const response = await fetch(endpoint);
  if (!response.ok) {
    return {
      supported: true,
      configured: true,
      status: "error",
      city,
      units,
      source: "OpenWeather",
      message: `OpenWeather returned ${response.status}.`,
      sampledAt: nowIso(),
      stale: false,
      hourly: [],
      daily: []
    };
  }

  const payload = await response.json();
  return {
    supported: true,
    configured: true,
    status: "live",
    city: payload.name || city,
    units,
    source: "OpenWeather",
    temperature: payload.main && payload.main.temp,
    feelsLike: payload.main && payload.main.feels_like,
    condition: payload.weather && payload.weather[0] ? payload.weather[0].description : "Weather",
    humidity: payload.main && payload.main.humidity,
    windSpeed: payload.wind && payload.wind.speed,
    sampledAt: nowIso(),
    stale: false,
    hourly: [],
    daily: []
  };
}

function calendarSnapshot() {
  const config = loadConfig();
  return {
    supported: true,
    configured: Boolean(config.calendar.icsUrl),
    status: config.calendar.icsUrl ? "idle" : "setup",
    stale: false,
    sampledAt: nowIso(),
    source: config.calendar.icsUrl ? "ics" : "Needs setup",
    message: config.calendar.icsUrl ? "ICS feed is configured. Event parsing is planned for the Mac beta." : "Calendar ICS URL missing.",
    entries: []
  };
}

function launchersSnapshot() {
  const config = loadConfig();
  return {
    supported: true,
    configured: config.launchers.length > 0,
    status: config.launchers.length > 0 ? "live" : "setup",
    stale: false,
    sampledAt: nowIso(),
    source: "config",
    message: config.launchers.length ? "Pinned launchers are ready." : "Add apps or shortcuts to build your launcher grid.",
    entries: config.launchers
  };
}

function steamGamesSnapshot() {
  return {
    supported: false,
    configured: false,
    status: "optional",
    stale: false,
    sampledAt: nowIso(),
    source: "macOS beta host",
    message: "Local Steam game scanning is available in the Windows host. Mac Steam scanning is planned for the Mac beta.",
    steamDetected: false,
    libraryCount: 0,
    games: []
  };
}

function clipboardSnapshot() {
  const value = clipboard.readText();
  return {
    supported: true,
    configured: true,
    status: value ? "live" : "idle",
    stale: false,
    sampledAt: nowIso(),
    source: "macOS clipboard",
    message: value ? "Clipboard text is available." : "Clipboard is empty or non-text.",
    entries: value
      ? [{
          id: "current",
          label: "Current text",
          preview: value.slice(0, 160),
          time: "Now"
        }]
      : []
  };
}

function hueSnapshot() {
  const config = loadConfig();
  return {
    supported: true,
    configured: Boolean(config.hue.bridgeIp),
    linked: Boolean(readSecret("hueAppKey")),
    status: config.hue.bridgeIp ? "setup" : "optional",
    sampledAt: nowIso(),
    stale: false,
    bridgeIp: config.hue.bridgeIp,
    source: "macOS beta host",
    message: "Hue control is planned for the Mac beta.",
    lights: [],
    groups: []
  };
}

function unifiSnapshot() {
  return {
    supported: true,
    configured: false,
    detected: false,
    status: "optional",
    sampledAt: nowIso(),
    stale: false,
    source: "macOS beta host",
    message: "UniFi auto-discovery is planned for the Mac beta.",
    gatewayIp: "",
    metrics: [
      { label: "Mac host", value: 65 },
      { label: "Local API", value: 100 }
    ],
    clients: [],
    aps: [],
    applications: []
  };
}

function quickActionsSnapshot() {
  return unsupported("Windows quick actions are not available in the Mac beta.");
}

function shortcutsSnapshot() {
  return {
    ...unsupported("Windows power, brightness, and notification shortcuts are not available in the Mac beta."),
    brightnessSupported: false,
    brightness: null,
    dndEnabled: false,
    toggles: []
  };
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxJsonBodyBytes) {
      throw Object.assign(new Error("Request body too large."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(request, response, requestUrl) {
  const config = loadConfig();
  const method = request.method || "GET";
  const route = requestUrl.pathname;

  if (route === "/api/health") {
    return sendJson(response, 200, buildHealthPayload());
  }

  if (route === "/api/config" && method === "GET") {
    return sendJson(response, 200, buildConfigSnapshot());
  }

  if (route === "/api/config/dashboard" && method === "POST") {
    const body = await readBody(request);
    config.dashboard.onboardingCompleted = Boolean(body.onboardingCompleted);
    config.dashboard.onboardingVersion = Number.isInteger(body.onboardingVersion) ? body.onboardingVersion : config.dashboard.onboardingVersion;
    config.dashboard.onboardingCompletedAt = config.dashboard.onboardingCompleted ? nowIso() : "";
    saveConfig(config);
    return sendJson(response, 200, buildConfigSnapshot());
  }

  if (route === "/api/config/reset" && method === "POST") {
    resetLocalData(true);
    return sendJson(response, 200, {
      ok: true,
      message: "Local settings and protected secrets were reset.",
      config: buildConfigSnapshot(),
      health: buildHealthPayload()
    });
  }

  if (route === "/api/releases/latest") {
    return sendJson(response, 200, await releaseSnapshot());
  }

  if (route === "/api/config/weather" && method === "POST") {
    const body = await readBody(request);
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      writeSecret("weatherApiKey", body.apiKey.trim());
    }
    config.weather.city = text(body.city, config.weather.city);
    config.weather.units = text(body.units, config.weather.units) === "imperial" ? "imperial" : "metric";
    saveConfig(config);
    return sendJson(response, 200, buildConfigSnapshot());
  }

  if (route === "/api/config/calendar" && method === "POST") {
    const body = await readBody(request);
    config.calendar.icsUrl = text(body.icsUrl, "");
    saveConfig(config);
    return sendJson(response, 200, buildConfigSnapshot());
  }

  if (route === "/api/system") {
    return sendJson(response, 200, systemSnapshot());
  }

  if (route === "/api/network") {
    return sendJson(response, 200, networkSnapshot());
  }

  if (route === "/api/weather") {
    return sendJson(response, 200, await weatherSnapshot(requestUrl));
  }

  if (route === "/api/calendar") {
    return sendJson(response, 200, calendarSnapshot());
  }

  if (route === "/api/unifi/network") {
    return sendJson(response, 200, unifiSnapshot());
  }

  if (route === "/api/audio") {
    return sendJson(response, 200, unsupported("Audio routing is Windows-only in this beta."));
  }

  if (route === "/api/media") {
    return sendJson(response, 200, unsupported("Media transport controls are Windows-only in this beta."));
  }

  if (route === "/api/hue" && method === "GET") {
    return sendJson(response, 200, hueSnapshot());
  }

  if (route === "/api/hue/link" && method === "POST") {
    const body = await readBody(request);
    config.hue.bridgeIp = text(body.bridgeIp, config.hue.bridgeIp);
    saveConfig(config);
    return sendJson(response, 200, hueSnapshot());
  }

  if (route === "/api/launchers" && method === "GET") {
    return sendJson(response, 200, launchersSnapshot());
  }

  if (route === "/api/launchers" && method === "POST") {
    const body = await readBody(request);
    config.launchers = Array.isArray(body.entries)
      ? body.entries.map(normalizeLauncher).filter((entry) => entry.id && entry.displayName)
      : [];
    saveConfig(config);
    return sendJson(response, 200, launchersSnapshot());
  }

  if (route === "/api/launchers/launch" && method === "POST") {
    const body = await readBody(request);
    const launcher = config.launchers.find((entry) => entry.id === body.id);
    if (!launcher || !launcher.executablePath) {
      return sendJson(response, 404, { ok: false, message: "Launcher not found." });
    }
    const error = await shell.openPath(launcher.executablePath);
    return sendJson(response, error ? 500 : 200, { ok: !error, message: error || "Launcher opened." });
  }

  if (route === "/api/steam/games" && method === "GET") {
    return sendJson(response, 200, steamGamesSnapshot());
  }

  if (route === "/api/steam/games/launch" && method === "POST") {
    return sendJson(response, 501, {
      ok: false,
      message: "Steam game launch is available in the Windows host. Mac Steam launch support is planned for the Mac beta."
    });
  }

  if (route === "/api/quick-actions") {
    return sendJson(response, 200, quickActionsSnapshot());
  }

  if (route === "/api/system-shortcuts") {
    return sendJson(response, 200, shortcutsSnapshot());
  }

  if (route === "/api/clipboard" && method === "GET") {
    return sendJson(response, 200, clipboardSnapshot());
  }

  if (route === "/api/clipboard/copy" && method === "POST") {
    const body = await readBody(request);
    if (body.id === "current") {
      return sendJson(response, 200, { ok: true });
    }
    return sendJson(response, 404, { ok: false, message: "Clipboard item not found." });
  }

  if (route.startsWith("/api/")) {
    return sendJson(response, 501, unsupported("This endpoint is not available in the Mac beta yet."));
  }

  return false;
}

function sendJson(response, statusCode, payload, corsOrigin = "") {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store"
  };

  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
    headers.Vary = "Origin";
  }

  response.writeHead(statusCode, headers);
  response.end(body);
  return true;
}

function corsOriginForRequest(request) {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin.trim() : "";
  if (!origin) {
    return "";
  }

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? Number(parsed.port) : 80;
    if (parsed.protocol === "http:" && port === activePort && (hostname === "127.0.0.1" || hostname === "localhost")) {
      return parsed.origin;
    }
  } catch {
  }

  return null;
}

function applyCorsHeaders(response, corsOrigin) {
  if (!corsOrigin) {
    return;
  }

  response.setHeader("Access-Control-Allow-Origin", corsOrigin);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Vary", "Origin");
}

function sendText(response, statusCode, body) {
  const bytes = Buffer.from(body, "utf8");
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": bytes.length,
    "Cache-Control": "no-store"
  });
  response.end(bytes);
  return true;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };
  return types[ext] || "application/octet-stream";
}

function resolveStaticPath(requestUrl) {
  const requestedPath = decodeURIComponent(requestUrl.pathname === "/" ? "/dashboard.html" : requestUrl.pathname);
  const normalized = path.normalize(requestedPath).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const candidate = path.join(webRoot, normalized);
  const root = path.resolve(webRoot);
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

async function handleRequest(request, response) {
  try {
    const corsOrigin = corsOriginForRequest(request);
    if (corsOrigin === null) {
      return sendJson(response, 403, { ok: false, error: "Origin not allowed." });
    }

    applyCorsHeaders(response, corsOrigin);

    if (request.method === "OPTIONS") {
      return sendJson(response, 204, {}, corsOrigin);
    }

    const requestUrl = new URL(request.url || "/", `http://127.0.0.1:${activePort}`);
    const apiHandled = await handleApi(request, response, requestUrl);
    if (apiHandled) {
      return;
    }

    const filePath = resolveStaticPath(requestUrl);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return sendText(response, 404, "Not found");
    }

    const body = fs.readFileSync(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": body.length,
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      ok: false,
      error: error.message || "Request failed."
    });
  }
}

function startServer(preferredPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const candidate = http.createServer(handleRequest);
      candidate.on("error", (error) => {
        if (error.code === "EADDRINUSE" && port < preferredPort + 10) {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      candidate.listen(port, "127.0.0.1", () => {
        server = candidate;
        activePort = port;
        resolve(port);
      });
    };

    tryPort(preferredPort);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    title: productName,
    backgroundColor: "#070912",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${activePort}/`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${activePort}/dashboard.html?v=${assetRevision}`);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  ensureDataPaths();
  const config = loadConfig();
  webRoot = app.isPackaged ? path.join(process.resourcesPath, "web") : path.resolve(__dirname, "../../..");
  await startServer(config.port || defaultPort);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (server) {
    server.close();
    server = null;
  }
});
