import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "config.json");
const exampleConfigPath = path.join(__dirname, "config.example.json");
const audioControlPath = path.join(__dirname, "audio-control.ps1");
const dashboardOnboardingVersion = 1;
let config = loadConfig();
const statusCache = {
  system: createStatusCache(15000),
  network: createStatusCache(15000),
  audio: createStatusCache(2000),
  weather: createStatusCache(10 * 60 * 1000),
  hue: createStatusCache(30000)
};
const systemCollector = createSystemCollector();
const networkCollector = createNetworkCollector();
let collectorsStarted = false;
let collectorsStopping = false;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

function createStatusCache(ttlMs) {
  return {
    ttlMs,
    timestamp: 0,
    value: null,
    promise: null
  };
}

function getDefaultDashboardConfig() {
  return {
    onboardingCompleted: false,
    onboardingCompletedAt: "",
    onboardingVersion: dashboardOnboardingVersion
  };
}

function normalizeDashboardConfig(rawValue) {
  const source = rawValue || {};
  const version = Number(source.onboardingVersion);

  return {
    onboardingCompleted: Boolean(source.onboardingCompleted),
    onboardingCompletedAt: typeof source.onboardingCompletedAt === "string" ? source.onboardingCompletedAt : "",
    onboardingVersion: Number.isFinite(version) && version > 0
      ? Math.round(version)
      : dashboardOnboardingVersion
  };
}

function normalizeConfig(rawConfig) {
  const loaded = rawConfig || {};

  return {
    port: loaded.port || 8976,
    weather: loaded.weather || {},
    calendar: loaded.calendar || {},
    hue: {
      bridgeIp: loaded.hue?.bridgeIp || "",
      appKey: loaded.hue?.appKey || "",
      clientKey: loaded.hue?.clientKey || ""
    },
    dashboard: normalizeDashboardConfig(loaded.dashboard)
  };
}

function loadConfig() {
  const sourcePath = fs.existsSync(configPath) ? configPath : exampleConfigPath;
  const loaded = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  return normalizeConfig(loaded);
}

function saveConfig(nextConfig) {
  config = normalizeConfig(nextConfig);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function json(response, statusCode, payload, corsOrigin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
    headers.Vary = "Origin";
  }

  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
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
    if (parsed.protocol === "http:" && port === config.port && (hostname === "127.0.0.1" || hostname === "localhost")) {
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
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(text);
}

function safeResolveStaticPath(requestUrl) {
  const pathname = new URL(requestUrl, `http://127.0.0.1:${config.port}`).pathname;
  const relativePath = pathname === "/" ? "dashboard.html" : pathname.replace(/^\/+/, "");
  const resolvedPath = path.resolve(rootDir, relativePath);

  if (!resolvedPath.startsWith(rootDir)) {
    return null;
  }

  return resolvedPath;
}

function serveStaticFile(requestUrl, response) {
  const filePath = safeResolveStaticPath(requestUrl);

  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypes[extension] || "application/octet-stream";

  response.writeHead(200, {
    "Content-Type": mimeType,
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(response);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createLocalUrl(requestUrl = "/") {
  return new URL(requestUrl, `http://127.0.0.1:${config.port}`);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const raw = await readRequestBody(request);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

function createSetupItem(id, label, state, required, nextStep) {
  return {
    id,
    label,
    state,
    required,
    nextStep
  };
}

async function getCachedStatus(cache, resolver) {
  const now = Date.now();

  if (cache.value && now - cache.timestamp < cache.ttlMs) {
    return cache.value;
  }

  if (cache.value) {
    refreshCachedStatus(cache, resolver);
    return cache.value;
  }

  return refreshCachedStatus(cache, resolver);
}

function refreshCachedStatus(cache, resolver) {
  if (cache.promise) {
    return cache.promise;
  }

  cache.promise = Promise.resolve()
    .then(resolver)
    .then((value) => {
      cache.value = value;
      cache.timestamp = Date.now();
      cache.promise = null;
      return value;
    }, (error) => {
      const value = {
        ok: false,
        error: error.message || "Validation failed"
      };
      cache.value = value;
      cache.timestamp = Date.now();
      cache.promise = null;
      return value;
    });

  return cache.promise;
}

function invalidateCachedStatus(cache) {
  cache.timestamp = 0;
  cache.value = null;
  cache.promise = null;
}

function createDefaultSystemSnapshot() {
  return {
    cpu: 0,
    gpu: 0,
    ram: 0,
    disk: 0,
    cpuTemp: null,
    gpuTemp: null,
    topProcesses: [],
    source: "local bridge"
  };
}

function createDefaultNetworkSnapshot() {
  return {
    download: 0,
    upload: 0,
    ping: 0,
    type: "unknown",
    source: "local bridge"
  };
}

function createSystemCollector() {
  return {
    started: false,
    snapshot: createDefaultSystemSnapshot(),
    stopFns: [],
    cpuSample: null,
    logicalCores: Math.max(1, os.cpus().length),
    processSample: new Map(),
    processTimestamp: 0
  };
}

function createNetworkCollector() {
  return {
    started: false,
    snapshot: createDefaultNetworkSnapshot(),
    stopFns: []
  };
}

function roundNumber(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

function cloneSystemSnapshot() {
  return {
    ...systemCollector.snapshot,
    topProcesses: Array.isArray(systemCollector.snapshot.topProcesses)
      ? systemCollector.snapshot.topProcesses.map((entry) => ({ ...entry }))
      : []
  };
}

function cloneNetworkSnapshot() {
  return {
    ...networkCollector.snapshot
  };
}

function readCpuSample() {
  const cpus = os.cpus();
  return cpus.reduce((accumulator, cpu) => {
    const times = cpu.times || {};
    const idle = Number(times.idle || 0);
    const total = Object.values(times).reduce((sum, value) => sum + Number(value || 0), 0);
    return {
      idle: accumulator.idle + idle,
      total: accumulator.total + total
    };
  }, { idle: 0, total: 0 });
}

function parseTypeperfCsvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed === "\uFEFF") {
    return null;
  }

  if (/^Exiting/i.test(trimmed) || /^The command completed successfully/i.test(trimmed)) {
    return null;
  }

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).split("\",\"");
  }

  return trimmed.split(",");
}

function parseTypeperfNumber(value) {
  if (typeof value !== "string") {
    return 0;
  }

  const normalized = value.replace(/"/g, "").trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startTypeperfWatcher(args, onSample) {
  const child = spawn("typeperf.exe", args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let header = null;
  let buffer = "";

  function flushBuffer() {
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      const fields = parseTypeperfCsvLine(line);
      if (!fields || !fields.length) {
        newlineIndex = buffer.indexOf("\n");
        continue;
      }

      if (!header) {
        header = fields;
      } else {
        onSample(header, fields);
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    flushBuffer();
  });

  child.stderr.on("data", () => {
  });

  child.on("error", () => {
  });

  return () => {
    if (!child.killed) {
      child.kill();
    }
  };
}

async function findNvidiaSmiPath() {
  try {
    const { stdout } = await execFileAsync("where.exe", ["nvidia-smi.exe"], {
      windowsHide: true,
      maxBuffer: 1024 * 128
    });
    const candidate = stdout.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean);
    if (candidate) {
      return candidate;
    }
  } catch (error) {
  }

  const candidate = process.env.ProgramFiles
    ? path.join(process.env.ProgramFiles, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe")
    : "";

  return candidate && fs.existsSync(candidate) ? candidate : "";
}

function sampleSystemCpuAndMemory() {
  const currentSample = readCpuSample();
  const previousSample = systemCollector.cpuSample;

  if (previousSample) {
    const totalDiff = currentSample.total - previousSample.total;
    const idleDiff = currentSample.idle - previousSample.idle;
    const cpu = totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : systemCollector.snapshot.cpu;
    systemCollector.snapshot.cpu = roundNumber(clamp(cpu, 0, 100), 1);
  }

  systemCollector.cpuSample = currentSample;

  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const ram = totalMemory > 0 ? (1 - (freeMemory / totalMemory)) * 100 : 0;
  systemCollector.snapshot.ram = roundNumber(clamp(ram, 0, 100), 1);
}

async function sampleSystemProcesses() {
  const output = await runWindowsPowerShell(`
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Id -gt 0 -and $_.ProcessName } |
      Select-Object Id, ProcessName, CPU, WorkingSet64 |
      ConvertTo-Json -Compress
  `);

  const parsed = output ? JSON.parse(output) : [];
  const entries = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  const nextTimestamp = Date.now();
  const elapsedMs = systemCollector.processTimestamp > 0
    ? Math.max(1, nextTimestamp - systemCollector.processTimestamp)
    : 0;
  const totalMemory = os.totalmem();
  const nextProcessSample = new Map();

  const topProcesses = entries.map((entry) => {
    const pid = Number(entry.Id || 0);
    const cpuTotalMs = Math.max(0, Number(entry.CPU || 0) * 1000);
    const workingSet = Math.max(0, Number(entry.WorkingSet64 || 0));
    const previous = systemCollector.processSample.get(pid);
    const cpuDelta = previous ? Math.max(0, cpuTotalMs - previous.cpuTotalMs) : 0;
    const cpu = elapsedMs > 0
      ? clamp((cpuDelta / elapsedMs / systemCollector.logicalCores) * 100, 0, 100)
      : 0;

    nextProcessSample.set(pid, {
      cpuTotalMs
    });

    return {
      name: String(entry.ProcessName || "Unknown"),
      pid,
      cpu: roundNumber(cpu, 1),
      memoryMB: Math.round(workingSet / 1024 / 1024),
      memoryPercent: totalMemory > 0 ? roundNumber((workingSet / totalMemory) * 100, 1) : 0
    };
  }).sort((left, right) => {
    if (right.cpu !== left.cpu) {
      return right.cpu - left.cpu;
    }
    if (right.memoryMB !== left.memoryMB) {
      return right.memoryMB - left.memoryMB;
    }
    return left.name.localeCompare(right.name);
  }).slice(0, 5);

  systemCollector.processSample = nextProcessSample;
  systemCollector.processTimestamp = nextTimestamp;
  systemCollector.snapshot.topProcesses = topProcesses;
}

async function sampleHardwareTemperatures() {
  const output = await runWindowsPowerShell(`
    function Test-MatchAny([string]$Value, [string[]]$Patterns) {
      foreach ($pattern in $Patterns) {
        if ($Value -match $pattern) {
          return $true
        }
      }

      return $false
    }

    function Get-HardwareMonitorTemperature([string]$Namespace, [string[]]$Patterns) {
      try {
        $sensor = Get-CimInstance -Namespace $Namespace -ClassName Sensor -ErrorAction Stop |
          Where-Object {
            $_.SensorType -eq 'Temperature' -and (
              (Test-MatchAny ([string]$_.Name) $Patterns) -or
              (Test-MatchAny ([string]$_.Identifier) $Patterns) -or
              (Test-MatchAny ([string]$_.Parent) $Patterns)
            )
          } |
          Sort-Object Value -Descending |
          Select-Object -First 1

        if ($sensor -and $null -ne $sensor.Value) {
          return [double]$sensor.Value
        }
      } catch {
      }

      return $null
    }

    $cpuTemp = Get-HardwareMonitorTemperature 'root\\LibreHardwareMonitor' @('CPU Package', 'Core Average', 'Tctl', 'Tdie', 'cpu')
    if ($null -eq $cpuTemp) {
      $cpuTemp = Get-HardwareMonitorTemperature 'root\\OpenHardwareMonitor' @('CPU Package', 'Core Average', 'Tctl', 'Tdie', 'cpu')
    }

    $gpuTemp = Get-HardwareMonitorTemperature 'root\\LibreHardwareMonitor' @('GPU Core', 'GPU Temperature', 'GPU Hot Spot', 'gpu')
    if ($null -eq $gpuTemp) {
      $gpuTemp = Get-HardwareMonitorTemperature 'root\\OpenHardwareMonitor' @('GPU Core', 'GPU Temperature', 'GPU Hot Spot', 'gpu')
    }

    [PSCustomObject]@{
      cpuTemp = if ($null -ne $cpuTemp) { [math]::Round($cpuTemp, 1) } else { $null }
      gpuTemp = if ($null -ne $gpuTemp) { [math]::Round($gpuTemp, 1) } else { $null }
    } | ConvertTo-Json -Compress
  `);

  const temperatures = output ? JSON.parse(output) : {};
  systemCollector.snapshot.cpuTemp = temperatures.cpuTemp == null ? null : roundNumber(Number(temperatures.cpuTemp), 1);
  if (temperatures.gpuTemp != null) {
    systemCollector.snapshot.gpuTemp = roundNumber(Number(temperatures.gpuTemp), 1);
  }
}

function startSystemPerformanceCounters() {
  return startTypeperfWatcher([
    "\\PhysicalDisk(_Total)\\% Idle Time",
    "\\GPU Engine(*)\\Utilization Percentage",
    "-si",
    "2",
    "-f",
    "CSV",
    "-y"
  ], (header, fields) => {
    const values = header.slice(1).map((name, index) => ({
      name,
      value: parseTypeperfNumber(fields[index + 1])
    }));

    const diskCounter = values.find((entry) => /\\PhysicalDisk\(_Total\)\\% Idle Time$/i.test(entry.name));
    if (diskCounter) {
      systemCollector.snapshot.disk = roundNumber(clamp(100 - diskCounter.value, 0, 100), 1);
    }

    const gpuCounters = values.filter((entry) => /\\GPU Engine\(.+\)\\Utilization Percentage$/i.test(entry.name));
    if (gpuCounters.length) {
      const gpu = gpuCounters.reduce((maximum, entry) => Math.max(maximum, entry.value), 0);
      systemCollector.snapshot.gpu = roundNumber(clamp(gpu, 0, 100), 1);
    }
  });
}

async function startNvidiaSmiCollector() {
  const nvidiaSmiPath = await findNvidiaSmiPath();
  if (!nvidiaSmiPath) {
    return () => {
    };
  }

  const child = spawn(nvidiaSmiPath, [
    "--query-gpu=temperature.gpu,utilization.gpu",
    "--format=csv,noheader,nounits",
    "-l",
    "5"
  ], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let buffer = "";

  function flushBuffer() {
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "").trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const [temperatureText, utilizationText] = line.split(",").map((entry) => entry.trim());
        const temperature = Number(temperatureText);
        const utilization = Number(utilizationText);

        if (Number.isFinite(utilization)) {
          systemCollector.snapshot.gpu = roundNumber(clamp(utilization, 0, 100), 1);
        }

        if (Number.isFinite(temperature)) {
          systemCollector.snapshot.gpuTemp = roundNumber(temperature, 1);
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    flushBuffer();
  });

  child.stderr.on("data", () => {
  });

  child.on("error", () => {
  });

  return () => {
    if (!child.killed) {
      child.kill();
    }
  };
}

async function sampleNetworkAdapterType() {
  const output = await runWindowsPowerShell(`
    $adapter = Get-NetAdapter |
      Where-Object { $_.Status -eq 'Up' } |
      Sort-Object LinkSpeed -Descending |
      Select-Object -First 1

    $type = if ($null -eq $adapter) {
      'unknown'
    } elseif ($adapter.InterfaceDescription -match 'Wi-?Fi|Wireless|802.11') {
      'wifi'
    } else {
      'ethernet'
    }

    [PSCustomObject]@{
      type = $type
    } | ConvertTo-Json -Compress
  `);

  const payload = output ? JSON.parse(output) : {};
  networkCollector.snapshot.type = payload.type || "unknown";
}

async function sampleNetworkPing() {
  try {
    const { stdout } = await execFileAsync("ping.exe", ["-n", "1", "-w", "1000", "1.1.1.1"], {
      windowsHide: true,
      maxBuffer: 1024 * 64
    });
    const match = stdout.match(/Average = (\d+)ms/i) || stdout.match(/time[=<](\d+)ms/i);
    networkCollector.snapshot.ping = match ? Number(match[1]) : 0;
  } catch (error) {
    networkCollector.snapshot.ping = 0;
  }
}

function startNetworkPerformanceCounters() {
  return startTypeperfWatcher([
    "\\Network Interface(*)\\Bytes Received/sec",
    "\\Network Interface(*)\\Bytes Sent/sec",
    "-si",
    "2",
    "-f",
    "CSV",
    "-y"
  ], (header, fields) => {
    const values = header.slice(1).map((name, index) => ({
      name,
      value: parseTypeperfNumber(fields[index + 1])
    }));

    const received = values
      .filter((entry) => /\\Bytes Received\/sec$/i.test(entry.name))
      .reduce((sum, entry) => sum + entry.value, 0);
    const sent = values
      .filter((entry) => /\\Bytes Sent\/sec$/i.test(entry.name))
      .reduce((sum, entry) => sum + entry.value, 0);

    networkCollector.snapshot.download = roundNumber((received * 8) / 1024 / 1024, 2);
    networkCollector.snapshot.upload = roundNumber((sent * 8) / 1024 / 1024, 2);
  });
}

async function startSystemCollector() {
  if (systemCollector.started) {
    return;
  }

  systemCollector.started = true;
  sampleSystemCpuAndMemory();
  const cpuIntervalId = setInterval(sampleSystemCpuAndMemory, 2000);
  systemCollector.stopFns.push(() => clearInterval(cpuIntervalId));

  await Promise.allSettled([
    sampleSystemProcesses(),
    sampleHardwareTemperatures()
  ]);

  const processIntervalId = setInterval(() => {
    sampleSystemProcesses().catch(() => {
    });
  }, 5000);
  const temperatureIntervalId = setInterval(() => {
    sampleHardwareTemperatures().catch(() => {
    });
  }, 15000);

  systemCollector.stopFns.push(() => clearInterval(processIntervalId));
  systemCollector.stopFns.push(() => clearInterval(temperatureIntervalId));

  systemCollector.stopFns.push(startSystemPerformanceCounters());
  systemCollector.stopFns.push(await startNvidiaSmiCollector());
}

async function startNetworkCollector() {
  if (networkCollector.started) {
    return;
  }

  networkCollector.started = true;

  await Promise.allSettled([
    sampleNetworkAdapterType(),
    sampleNetworkPing()
  ]);

  const adapterIntervalId = setInterval(() => {
    sampleNetworkAdapterType().catch(() => {
    });
  }, 30000);
  const pingIntervalId = setInterval(() => {
    sampleNetworkPing().catch(() => {
    });
  }, 5000);

  networkCollector.stopFns.push(() => clearInterval(adapterIntervalId));
  networkCollector.stopFns.push(() => clearInterval(pingIntervalId));

  networkCollector.stopFns.push(startNetworkPerformanceCounters());
}

async function startBackgroundCollectors() {
  if (collectorsStarted) {
    return;
  }

  collectorsStarted = true;
  await Promise.all([
    startSystemCollector(),
    startNetworkCollector()
  ]);
}

function stopBackgroundCollectors() {
  collectorsStopping = true;

  [systemCollector, networkCollector].forEach((collector) => {
    while (collector.stopFns.length) {
      const stop = collector.stopFns.pop();
      try {
        stop();
      } catch (error) {
      }
    }
  });
}

function normalizeBridgeIp(rawValue) {
  const input = String(rawValue || "").trim();
  if (!input) {
    return "";
  }

  try {
    const parsed = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    return parsed.hostname;
  } catch (error) {
    return input.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
}

function extractHueError(payload) {
  if (!Array.isArray(payload)) {
    return "";
  }

  const entry = payload.find((item) => item && item.error);
  return entry ? entry.error.description || "Hue bridge request failed" : "";
}

function hueRequest(bridgeIp, pathname, options = {}) {
  const hostname = normalizeBridgeIp(bridgeIp);
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : "";

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname,
      port: 443,
      path: pathname,
      method,
      rejectUnauthorized: false,
      timeout: 10000,
      headers: {
        Accept: "application/json",
        ...(body ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        } : {})
      }
    }, (response) => {
      const chunks = [];

      response.on("data", (chunk) => {
        chunks.push(chunk);
      });

      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let payload = raw;

        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch (error) {
          payload = raw;
        }

        if (response.statusCode >= 400) {
          reject(new Error(typeof payload === "string" ? payload : `Hue bridge request failed with status ${response.statusCode}`));
          return;
        }

        const hueError = extractHueError(payload);
        if (hueError) {
          reject(new Error(hueError));
          return;
        }

        resolve(payload);
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Hue bridge request timed out"));
    });
    request.on("error", reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

async function runWindowsPowerShell(script) {
  const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });

  if (stderr && stderr.trim()) {
    throw new Error(stderr.trim());
  }

  return stdout.trim();
}

async function runWindowsPowerShellFile(filePath, args = []) {
  const { stdout, stderr } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    filePath,
    ...args
  ], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });

  if (stderr && stderr.trim()) {
    throw new Error(stderr.trim());
  }

  return stdout.trim();
}

async function runAudioControl(action, options = {}) {
  const args = ["-Action", action];

  if (options.deviceId) {
    args.push("-DeviceId", String(options.deviceId));
  }

  if (options.sessionId) {
    args.push("-SessionId", String(options.sessionId));
  }

  if (options.volume != null) {
    args.push("-Volume", String(options.volume));
  }

  if (options.muted != null) {
    args.push("-Muted", String(options.muted));
  }

  const output = await runWindowsPowerShellFile(audioControlPath, args);

  try {
    return output ? JSON.parse(output) : {};
  } catch (error) {
    throw new Error(`Audio bridge returned invalid JSON: ${error.message}`);
  }
}

async function getSystemSnapshot() {
  await startBackgroundCollectors();
  return cloneSystemSnapshot();
}

async function getNetworkSnapshot() {
  await startBackgroundCollectors();
  return cloneNetworkSnapshot();
}

async function getAudioSnapshot() {
  return runAudioControl("snapshot");
}

async function getLiveAudioSnapshot() {
  const snapshot = await getCachedStatus(statusCache.audio, getAudioSnapshot);

  if (snapshot && snapshot.ok === false) {
    throw new Error(snapshot.error || "Audio routing is unavailable");
  }

  return snapshot;
}

async function getWeatherSnapshot(url) {
  const apiKey = config.weather?.apiKey;
  const requestUrl = createLocalUrl(url);
  const city = requestUrl.searchParams.get("city") || config.weather?.city || "";
  const units = requestUrl.searchParams.get("units") || config.weather?.units || "metric";

  if (!apiKey) {
    return {
      configured: false,
      message: "OpenWeather API key missing",
      city,
      units
    };
  }

  const currentUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=${encodeURIComponent(units)}&appid=${encodeURIComponent(apiKey)}`;
  const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&units=${encodeURIComponent(units)}&appid=${encodeURIComponent(apiKey)}`;
  const [currentResponse, forecastResponse] = await Promise.all([
    fetch(currentUrl),
    fetch(forecastUrl)
  ]);
  const [current, forecast] = await Promise.all([
    currentResponse.json(),
    forecastResponse.json()
  ]);

  if (!currentResponse.ok) {
    throw new Error(current.message || "Weather request failed");
  }

  if (!forecastResponse.ok) {
    throw new Error(forecast.message || "Forecast request failed");
  }

  const hourly = forecast.list.slice(0, 5).map((entry) => ({
    hour: new Date(entry.dt * 1000).toLocaleTimeString([], { hour: "numeric" }),
    temp: Math.round(entry.main.temp),
    condition: entry.weather[0].main,
    icon: entry.weather[0].icon
  }));

  const dailyBuckets = new Map();
  forecast.list.forEach((entry) => {
    const date = new Date(entry.dt * 1000);
    const key = date.toISOString().slice(0, 10);
    const condition = entry.weather[0].main;
    const icon = entry.weather[0].icon;

    if (!dailyBuckets.has(key)) {
      dailyBuckets.set(key, {
        day: date.toLocaleDateString([], { weekday: "short" }),
        high: entry.main.temp,
        low: entry.main.temp,
        conditionCounts: new Map(),
        iconCounts: new Map()
      });
    }

    const bucket = dailyBuckets.get(key);
    bucket.high = Math.max(bucket.high, entry.main.temp);
    bucket.low = Math.min(bucket.low, entry.main.temp);
    bucket.conditionCounts.set(condition, (bucket.conditionCounts.get(condition) || 0) + 1);
    bucket.iconCounts.set(icon, (bucket.iconCounts.get(icon) || 0) + 1);
  });

  const daily = Array.from(dailyBuckets.values()).slice(0, 5).map((bucket) => {
    const condition = Array.from(bucket.conditionCounts.entries()).sort((left, right) => right[1] - left[1])[0][0];
    const icon = Array.from(bucket.iconCounts.entries()).sort((left, right) => right[1] - left[1])[0][0];

    return {
      day: bucket.day,
      high: Math.round(bucket.high),
      low: Math.round(bucket.low),
      condition,
      icon
    };
  });

    return {
      configured: true,
      city: current.name,
      temperature: Math.round(current.main.temp),
      condition: current.weather[0].description,
      icon: current.weather[0].icon,
      units,
      hourly,
      daily,
      forecast: hourly,
      source: "openweathermap"
  };
}

function parseIcsDate(rawValue) {
  if (!rawValue) {
    return null;
  }

  if (/^\d{8}$/.test(rawValue)) {
    return new Date(`${rawValue.slice(0, 4)}-${rawValue.slice(4, 6)}-${rawValue.slice(6, 8)}T00:00:00`);
  }

  if (/^\d{8}T\d{6}Z$/.test(rawValue)) {
    return new Date(`${rawValue.slice(0, 4)}-${rawValue.slice(4, 6)}-${rawValue.slice(6, 8)}T${rawValue.slice(9, 11)}:${rawValue.slice(11, 13)}:${rawValue.slice(13, 15)}Z`);
  }

  if (/^\d{8}T\d{6}$/.test(rawValue)) {
    return new Date(`${rawValue.slice(0, 4)}-${rawValue.slice(4, 6)}-${rawValue.slice(6, 8)}T${rawValue.slice(9, 11)}:${rawValue.slice(11, 13)}:${rawValue.slice(13, 15)}`);
  }

  return new Date(rawValue);
}

function parseIcs(icsText) {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const events = [];
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);

  for (const block of blocks) {
    const eventText = block.split("END:VEVENT")[0];
    const lines = eventText.split(/\r?\n/);
    const event = {};

    for (const line of lines) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).split(";")[0];
      const value = line.slice(separatorIndex + 1).trim();
      event[key] = value;
    }

    if (event.DTSTART && event.SUMMARY) {
      events.push({
        title: event.SUMMARY,
        detail: event.LOCATION || "",
        start: parseIcsDate(event.DTSTART)
      });
    }
  }

  const now = Date.now();
  return events
    .filter((event) => event.start && event.start.getTime() >= now - 60 * 60 * 1000)
    .sort((left, right) => left.start - right.start)
    .slice(0, 3)
    .map((event) => ({
      time: event.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      title: event.title,
      detail: event.detail || "Calendar event"
    }));
}

async function getCalendarSnapshot() {
  const icsUrl = config.calendar?.icsUrl;

  if (!icsUrl) {
    return {
      configured: false,
      entries: []
    };
  }

  const response = await fetch(icsUrl);
  if (!response.ok) {
    throw new Error("Calendar feed request failed");
  }
  const text = await response.text();

  return {
    configured: true,
    entries: parseIcs(text),
    source: "ics"
  };
}

function getHueConfigSnapshot() {
  const hue = config.hue || {};
  return {
    bridgeIp: normalizeBridgeIp(hue.bridgeIp),
    appKey: hue.appKey || "",
    clientKey: hue.clientKey || ""
  };
}

async function linkHueBridge(bridgeIp) {
  const normalizedIp = normalizeBridgeIp(bridgeIp || getHueConfigSnapshot().bridgeIp);
  if (!normalizedIp) {
    throw new Error("Hue bridge IP is required");
  }

  const payload = await hueRequest(normalizedIp, "/api", {
    method: "POST",
    body: {
      devicetype: "xeneon_widgets#dashboard",
      generateclientkey: true
    }
  });

  const success = Array.isArray(payload) && payload[0] && payload[0].success;
  if (!success || !success.username) {
    throw new Error("Hue link button has not been pressed yet");
  }

  saveConfig({
    ...config,
    hue: {
      bridgeIp: normalizedIp,
      appKey: success.username,
      clientKey: success.clientkey || ""
    }
  });

  return {
    bridgeIp: normalizedIp,
    appKey: success.username,
    clientKey: success.clientkey || "",
    linked: true
  };
}

function normalizeHueLights(rawLights) {
  return Object.entries(rawLights || {}).map(([id, light]) => ({
    id,
    name: light.name,
    on: Boolean(light.state?.on),
    brightness: light.state?.bri == null ? 0 : Math.round((light.state.bri / 254) * 100),
    reachable: light.state?.reachable !== false,
    type: light.productname || light.type || "Hue light",
    colorMode: light.state?.colormode || "",
    hue: typeof light.state?.hue === "number" ? light.state.hue : null,
    saturation: typeof light.state?.sat === "number" ? Math.round((light.state.sat / 254) * 100) : null,
    colorTemperature: typeof light.state?.ct === "number" ? light.state.ct : null
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeHueGroups(rawGroups) {
  return Object.entries(rawGroups || {})
    .filter(([, group]) => ["Room", "Zone", "LightGroup"].includes(group.type))
    .map(([id, group]) => ({
      id,
      name: group.name,
      on: Boolean(group.action?.on),
      brightness: group.action?.bri == null ? 0 : Math.round((group.action.bri / 254) * 100),
      type: group.type,
      lights: Array.isArray(group.lights) ? group.lights.length : 0,
      colorMode: group.action?.colormode || "",
      hue: typeof group.action?.hue === "number" ? group.action.hue : null,
      saturation: typeof group.action?.sat === "number" ? Math.round((group.action.sat / 254) * 100) : null,
      colorTemperature: typeof group.action?.ct === "number" ? group.action.ct : null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function getHueSnapshot() {
  const hue = getHueConfigSnapshot();

  if (!hue.bridgeIp) {
    return {
      configured: false,
      linked: false,
      bridgeIp: "",
      bridgeName: "",
      lights: [],
      groups: [],
      source: "Hue not configured",
      message: "Enter your Hue Bridge IP and press the physical link button."
    };
  }

  if (!hue.appKey) {
    return {
      configured: false,
      linked: false,
      bridgeIp: hue.bridgeIp,
      bridgeName: "",
      lights: [],
      groups: [],
      source: "Hue awaiting link",
      message: "Press the bridge link button, then link from the dashboard."
    };
  }

  try {
    const [bridgeInfo, lights, groups] = await Promise.all([
      hueRequest(hue.bridgeIp, `/api/${hue.appKey}/config`),
      hueRequest(hue.bridgeIp, `/api/${hue.appKey}/lights`),
      hueRequest(hue.bridgeIp, `/api/${hue.appKey}/groups`)
    ]);

    return {
      configured: true,
      linked: true,
      bridgeIp: hue.bridgeIp,
      bridgeName: bridgeInfo.name || "Hue Bridge",
      lights: normalizeHueLights(lights),
      groups: normalizeHueGroups(groups),
      source: "Hue local bridge"
    };
  } catch (error) {
    if (/unauthorized user/i.test(error.message)) {
      return {
        configured: false,
        linked: false,
        bridgeIp: hue.bridgeIp,
        bridgeName: "",
        lights: [],
        groups: [],
        source: "Hue relink required",
        message: "Stored Hue credentials are no longer accepted. Press the link button and re-link."
      };
    }

    throw error;
  }
}

function getHueActionContext() {
  const hue = getHueConfigSnapshot();
  if (!hue.bridgeIp || !hue.appKey) {
    throw new Error("Hue bridge is not linked");
  }

  return hue;
}

async function getSystemSetupItem() {
  const probe = await getCachedStatus(statusCache.system, async () => {
    const snapshot = await getSystemSnapshot();
    return {
      ok: true,
      cpuTemp: snapshot.cpuTemp,
      gpuTemp: snapshot.gpuTemp
    };
  });

  if (!probe.ok) {
    return createSetupItem(
      "system",
      "System Monitor",
      "Needs Setup",
      true,
      "Local Windows telemetry is not responding. Restart the bridge and check PowerShell access."
    );
  }

  if (probe.cpuTemp == null) {
    return createSetupItem(
      "system",
      "System Monitor",
      "Ready",
      true,
      "CPU, GPU, RAM, and disk are live. CPU temperature is optional on this PC."
    );
  }

  return createSetupItem(
    "system",
    "System Monitor",
    "Ready",
    true,
    "CPU, GPU, RAM, disk, and temperature telemetry are live."
  );
}

async function getNetworkSetupItem() {
  const probe = await getCachedStatus(statusCache.network, async () => {
    const snapshot = await getNetworkSnapshot();
    return {
      ok: true,
      type: snapshot.type
    };
  });

  if (!probe.ok) {
    return createSetupItem(
      "network",
      "Network Monitor",
      "Needs Setup",
      true,
      "Network telemetry is not responding. Restart the bridge and verify the active adapter."
    );
  }

  return createSetupItem(
    "network",
    "Network Monitor",
    "Ready",
    true,
    probe.type === "wifi"
      ? "Wi-Fi throughput and latency telemetry are live."
      : "Throughput and latency telemetry are live."
  );
}

async function getAudioSetupItem() {
  const probe = await getCachedStatus(statusCache.audio, async () => {
    const snapshot = await getAudioSnapshot();
    return {
      ok: true,
      devices: Array.isArray(snapshot.devices) ? snapshot.devices.length : 0,
      sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions.length : 0
    };
  });

  if (!probe.ok) {
    return createSetupItem(
      "audio",
      "Audio Control",
      "Needs Setup",
      false,
      "Windows audio routing is not responding. Restart the bridge and re-open the Audio tab."
    );
  }

  return createSetupItem(
    "audio",
    "Audio Control",
    "Ready",
    false,
    probe.sessions > 0
      ? `Playback routing is live with ${probe.devices} outputs and ${probe.sessions} tracked sessions.`
      : `Playback routing is live with ${probe.devices} outputs available.`
  );
}

async function getWeatherSetupItem() {
  const weather = config.weather || {};

  if (!weather.apiKey) {
    return createSetupItem(
      "weather",
      "Weather",
      "Optional",
      false,
      "Add an OpenWeather key if you want the Weather widget."
    );
  }

  const probe = await getCachedStatus(statusCache.weather, async () => {
    const snapshot = await getWeatherSnapshot("/api/weather");
    if (!snapshot.configured) {
      throw new Error(snapshot.message || "Weather is not configured");
    }

    return {
      ok: true,
      city: snapshot.city,
      condition: snapshot.condition,
      units: snapshot.units
    };
  });

  if (!probe.ok) {
    return createSetupItem(
      "weather",
      "Weather",
      "Needs Setup",
      false,
      "Weather is configured but the OpenWeather request failed. Check the API key and city."
    );
  }

  return createSetupItem(
    "weather",
    "Weather",
    "Ready",
    false,
    `Configured for ${probe.city} in ${probe.units === "imperial" ? "imperial" : "metric"} units.`
  );
}

async function getHueSetupItem() {
  const hue = getHueConfigSnapshot();

  if (!hue.bridgeIp && !hue.appKey) {
    return createSetupItem(
      "hue",
      "Philips Hue",
      "Optional",
      false,
      "Add your Hue Bridge only if you want local light control."
    );
  }

  if (hue.bridgeIp && !hue.appKey) {
    return createSetupItem(
      "hue",
      "Philips Hue",
      "Needs Setup",
      false,
      "Press the Hue bridge button, then link it from Diagnostics."
    );
  }

  const probe = await getCachedStatus(statusCache.hue, async () => {
    const snapshot = await getHueSnapshot();
    if (!snapshot.linked) {
      throw new Error(snapshot.message || "Hue link is incomplete");
    }

    return {
      ok: true,
      bridgeName: snapshot.bridgeName || "Hue Bridge"
    };
  });

  if (!probe.ok) {
    return createSetupItem(
      "hue",
      "Philips Hue",
      "Needs Setup",
      false,
      "Hue was linked before but needs attention. Re-link the bridge from Diagnostics."
    );
  }

  return createSetupItem(
    "hue",
    "Philips Hue",
    "Ready",
    false,
    `Linked to ${probe.bridgeName}.`
  );
}

async function getSetupSummary() {
  const items = {
    bridge: createSetupItem(
      "bridge",
      "Local bridge",
      "Ready",
      true,
      `Running at http://127.0.0.1:${config.port}.`
    )
  };

  const results = await Promise.all([
    getSystemSetupItem(),
    getNetworkSetupItem(),
    getAudioSetupItem(),
    getWeatherSetupItem(),
    getHueSetupItem()
  ]);

  results.forEach((item) => {
    items[item.id] = item;
  });

  const essentialsReady = ["bridge", "system", "network"].every((key) => items[key].state === "Ready");
  const onboarding = normalizeDashboardConfig(config.dashboard);

  return {
    essentialsReady,
    onboardingCompleted: onboarding.onboardingCompleted,
    onboardingCompletedAt: onboarding.onboardingCompletedAt,
    onboardingVersion: onboarding.onboardingVersion,
    needsAttention: Object.values(items).some((item) => item.state === "Needs Setup"),
    items
  };
}

function getConfigSnapshot() {
  const weather = config.weather || {};
  const hue = getHueConfigSnapshot();
  const dashboard = normalizeDashboardConfig(config.dashboard);

  return {
    port: config.port,
    weather: {
      configured: Boolean(weather.apiKey),
      city: weather.city || "",
      units: weather.units || "metric"
    },
    hue: {
      bridgeIp: hue.bridgeIp,
      configured: Boolean(hue.bridgeIp),
      linked: Boolean(hue.appKey)
    },
    dashboard: {
      onboardingCompleted: dashboard.onboardingCompleted,
      onboardingCompletedAt: dashboard.onboardingCompletedAt,
      onboardingVersion: dashboard.onboardingVersion
    }
  };
}

function saveWeatherConfig(input) {
  const nextWeather = {
    apiKey: typeof input.apiKey === "string" && input.apiKey.trim()
      ? input.apiKey.trim()
      : (config.weather?.apiKey || ""),
    city: typeof input.city === "string" && input.city.trim()
      ? input.city.trim()
      : (config.weather?.city || ""),
    units: input.units === "imperial" ? "imperial" : "metric"
  };

  saveConfig({
    ...config,
    weather: nextWeather
  });

  return getConfigSnapshot();
}

function saveDashboardConfig(input) {
  const nextVersion = Number(input.onboardingVersion);
  const dashboard = normalizeDashboardConfig({
    ...(config.dashboard || {}),
    onboardingVersion: Number.isFinite(nextVersion) && nextVersion > 0
      ? Math.round(nextVersion)
      : dashboardOnboardingVersion
  });

  if (input.onboardingCompleted === true) {
    dashboard.onboardingCompleted = true;
    dashboard.onboardingCompletedAt = new Date().toISOString();
  }

  if (input.onboardingCompleted === false) {
    dashboard.onboardingCompleted = false;
    dashboard.onboardingCompletedAt = "";
  }

  saveConfig({
    ...config,
    dashboard
  });

  return getConfigSnapshot();
}

async function setHueLightState(lightId, payload) {
  const hue = getHueActionContext();
  await hueRequest(hue.bridgeIp, `/api/${hue.appKey}/lights/${encodeURIComponent(lightId)}/state`, {
    method: "PUT",
    body: payload
  });
}

async function setHueGroupState(groupId, payload) {
  const hue = getHueActionContext();
  await hueRequest(hue.bridgeIp, `/api/${hue.appKey}/groups/${encodeURIComponent(groupId)}/action`, {
    method: "PUT",
    body: payload
  });
}

async function setAudioDefaultDevice(deviceId) {
  if (!deviceId) {
    throw new Error("Audio device ID is required");
  }

  await runAudioControl("set-default", { deviceId });
  invalidateCachedStatus(statusCache.audio);
  return getLiveAudioSnapshot();
}

async function setAudioMasterVolume(volume) {
  await runAudioControl("set-master-volume", {
    volume: clamp(Number(volume), 0, 100)
  });
  invalidateCachedStatus(statusCache.audio);
  return getLiveAudioSnapshot();
}

async function setAudioMasterMute(muted) {
  await runAudioControl("set-master-mute", {
    muted: Boolean(muted)
  });
  invalidateCachedStatus(statusCache.audio);
  return getLiveAudioSnapshot();
}

async function setAudioSessionVolume(sessionId, volume) {
  if (!sessionId) {
    throw new Error("Audio session ID is required");
  }

  await runAudioControl("set-session-volume", {
    sessionId,
    volume: clamp(Number(volume), 0, 100)
  });
  invalidateCachedStatus(statusCache.audio);
  return getLiveAudioSnapshot();
}

async function setAudioSessionMute(sessionId, muted) {
  if (!sessionId) {
    throw new Error("Audio session ID is required");
  }

  await runAudioControl("set-session-mute", {
    sessionId,
    muted: Boolean(muted)
  });
  invalidateCachedStatus(statusCache.audio);
  return getLiveAudioSnapshot();
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    json(response, 400, { error: "Invalid request" });
    return;
  }

  const corsOrigin = corsOriginForRequest(request);
  if (corsOrigin === null) {
    json(response, 403, { error: "Origin not allowed" });
    return;
  }

  applyCorsHeaders(response, corsOrigin);

  if (request.method === "OPTIONS") {
    json(response, 204, {}, corsOrigin);
    return;
  }

  const requestUrl = createLocalUrl(request.url);

  try {
    if (requestUrl.pathname === "/api/health") {
      const setup = await getSetupSummary();
      json(response, 200, {
        ok: true,
        capabilities: {
          system: true,
          network: true,
          audio: true,
          weather: Boolean(config.weather?.apiKey),
          calendar: Boolean(config.calendar?.icsUrl),
          media: false,
          hue: Boolean(config.hue?.appKey)
        },
        setup
      });
      return;
    }

    if (requestUrl.pathname === "/api/config" && request.method === "GET") {
      json(response, 200, getConfigSnapshot());
      return;
    }

    if (requestUrl.pathname === "/api/config/dashboard" && request.method === "POST") {
      const body = await readJsonBody(request);
      json(response, 200, saveDashboardConfig(body));
      return;
    }

    if (requestUrl.pathname === "/api/config/weather" && request.method === "POST") {
      const body = await readJsonBody(request);
      json(response, 200, saveWeatherConfig(body));
      return;
    }

    if (requestUrl.pathname === "/api/system") {
      json(response, 200, await getSystemSnapshot());
      return;
    }

    if (requestUrl.pathname === "/api/network") {
      json(response, 200, await getNetworkSnapshot());
      return;
    }

    if (requestUrl.pathname === "/api/audio" && request.method === "GET") {
      json(response, 200, await getLiveAudioSnapshot());
      return;
    }

    if (requestUrl.pathname === "/api/audio/default-device" && request.method === "POST") {
      const body = await readJsonBody(request);
      json(response, 200, await setAudioDefaultDevice(body.deviceId));
      return;
    }

    if (requestUrl.pathname === "/api/audio/master-volume" && request.method === "POST") {
      const body = await readJsonBody(request);
      json(response, 200, await setAudioMasterVolume(body.volume));
      return;
    }

    if (requestUrl.pathname === "/api/audio/master-mute" && request.method === "POST") {
      const body = await readJsonBody(request);
      json(response, 200, await setAudioMasterMute(body.muted));
      return;
    }

    if (requestUrl.pathname === "/api/audio/session-volume" && request.method === "POST") {
      const body = await readJsonBody(request);
      json(response, 200, await setAudioSessionVolume(body.sessionId, body.volume));
      return;
    }

    if (requestUrl.pathname === "/api/audio/session-mute" && request.method === "POST") {
      const body = await readJsonBody(request);
      json(response, 200, await setAudioSessionMute(body.sessionId, body.muted));
      return;
    }

    if (requestUrl.pathname === "/api/weather") {
      json(response, 200, await getWeatherSnapshot(request.url));
      return;
    }

    if (requestUrl.pathname === "/api/calendar") {
      json(response, 200, await getCalendarSnapshot());
      return;
    }

    if (requestUrl.pathname === "/api/media") {
      json(response, 501, {
        configured: false,
        message: "Windows media session support is not configured in this bridge yet."
      });
      return;
    }

    if (requestUrl.pathname === "/api/hue" && request.method === "GET") {
      json(response, 200, await getHueSnapshot());
      return;
    }

    if (requestUrl.pathname === "/api/hue/link" && request.method === "POST") {
      const body = await readJsonBody(request);
      json(response, 200, await linkHueBridge(body.bridgeIp));
      return;
    }

    const lightToggleMatch = requestUrl.pathname.match(/^\/api\/hue\/lights\/([^/]+)\/toggle$/);
    if (lightToggleMatch && request.method === "POST") {
      const body = await readJsonBody(request);
      await setHueLightState(lightToggleMatch[1], {
        on: Boolean(body.state)
      });
      json(response, 200, { ok: true });
      return;
    }

    const lightBrightnessMatch = requestUrl.pathname.match(/^\/api\/hue\/lights\/([^/]+)\/brightness$/);
    if (lightBrightnessMatch && request.method === "POST") {
      const body = await readJsonBody(request);
      const brightness = clamp(Number(body.brightness || 0), 0, 100);
      await setHueLightState(lightBrightnessMatch[1], {
        on: brightness > 0,
        bri: clamp(Math.round((brightness / 100) * 254), 1, 254)
      });
      json(response, 200, { ok: true });
      return;
    }

    const groupToggleMatch = requestUrl.pathname.match(/^\/api\/hue\/groups\/([^/]+)\/toggle$/);
    if (groupToggleMatch && request.method === "POST") {
      const body = await readJsonBody(request);
      await setHueGroupState(groupToggleMatch[1], {
        on: Boolean(body.state)
      });
      json(response, 200, { ok: true });
      return;
    }

    const groupBrightnessMatch = requestUrl.pathname.match(/^\/api\/hue\/groups\/([^/]+)\/brightness$/);
    if (groupBrightnessMatch && request.method === "POST") {
      const body = await readJsonBody(request);
      const brightness = clamp(Number(body.brightness || 0), 0, 100);
      await setHueGroupState(groupBrightnessMatch[1], brightness > 0
        ? {
            on: true,
            bri: clamp(Math.round((brightness / 100) * 254), 1, 254)
          }
        : {
            on: false
          });
      json(response, 200, { ok: true });
      return;
    }

    serveStaticFile(request.url, response);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

process.once("SIGINT", () => {
  stopBackgroundCollectors();
  process.exit(0);
});

process.once("SIGTERM", () => {
  stopBackgroundCollectors();
  process.exit(0);
});

process.once("exit", () => {
  stopBackgroundCollectors();
});

server.listen(config.port, "127.0.0.1", () => {
  startBackgroundCollectors().catch((error) => {
    console.warn("Background collectors failed to start", error);
  });
  console.log(`XENEON bridge listening on http://127.0.0.1:${config.port}`);
});
