import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "config.json");
const exampleConfigPath = path.join(__dirname, "config.example.json");
const config = loadConfig();
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

function loadConfig() {
  const sourcePath = fs.existsSync(configPath) ? configPath : exampleConfigPath;
  return JSON.parse(fs.readFileSync(sourcePath, "utf8"));
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
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

async function getSystemSnapshot() {
  const output = await runWindowsPowerShell(`
    $cpu = (Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue
    $gpu = ((Get-Counter '\\GPU Engine(*)\\Utilization Percentage').CounterSamples | Measure-Object -Property CookedValue -Sum).Sum
    $os = Get-CimInstance Win32_OperatingSystem
    $ram = (1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100
    $disk = (Get-Counter '\\PhysicalDisk(_Total)\\% Disk Time').CounterSamples[0].CookedValue
    [PSCustomObject]@{
      cpu = [math]::Round([math]::Min([math]::Max($cpu, 0), 100), 1)
      gpu = [math]::Round([math]::Min([math]::Max($gpu, 0), 100), 1)
      ram = [math]::Round([math]::Min([math]::Max($ram, 0), 100), 1)
      disk = [math]::Round([math]::Min([math]::Max($disk, 0), 100), 1)
      cpuTemp = $null
      gpuTemp = $null
      source = 'local bridge'
    } | ConvertTo-Json -Compress
  `);

  return JSON.parse(output);
}

async function getNetworkSnapshot() {
  const output = await runWindowsPowerShell(`
    $counters = Get-Counter '\\Network Interface(*)\\Bytes Received/sec','\\Network Interface(*)\\Bytes Sent/sec'
    $rx = ($counters.CounterSamples | Where-Object {$_.Path -like '*Bytes Received/sec'} | Measure-Object -Property CookedValue -Sum).Sum
    $tx = ($counters.CounterSamples | Where-Object {$_.Path -like '*Bytes Sent/sec'} | Measure-Object -Property CookedValue -Sum).Sum
    $adapter = Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Sort-Object LinkSpeed -Descending | Select-Object -First 1
    $ping = Test-Connection 1.1.1.1 -Count 1 | Select-Object -First 1 -ExpandProperty Latency
    $type = if ($null -eq $adapter) { 'unknown' } elseif ($adapter.InterfaceDescription -match 'Wi-?Fi|Wireless|802.11') { 'wifi' } else { 'ethernet' }
    [PSCustomObject]@{
      download = [math]::Round((($rx) * 8) / 1MB, 2)
      upload = [math]::Round((($tx) * 8) / 1MB, 2)
      ping = [int]$ping
      type = $type
      source = 'local bridge'
    } | ConvertTo-Json -Compress
  `);

  return JSON.parse(output);
}

async function getWeatherSnapshot(url) {
  const apiKey = config.weather?.apiKey;
  const requestUrl = new URL(url, `http://127.0.0.1:${config.port}`);
  const city = requestUrl.searchParams.get("city") || config.weather?.city || "Indianapolis";
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

  return {
    configured: true,
    city: current.name,
    temperature: Math.round(current.main.temp),
    condition: current.weather[0].description,
    icon: current.weather[0].icon,
    forecast: forecast.list.slice(0, 3).map((entry) => ({
      hour: new Date(entry.dt * 1000).toLocaleTimeString([], { hour: "numeric" }),
      temp: Math.round(entry.main.temp),
      condition: entry.weather[0].main
    })),
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

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    json(response, 400, { error: "Invalid request" });
    return;
  }

  if (request.method === "OPTIONS") {
    json(response, 204, {});
    return;
  }

  try {
    if (request.url === "/api/health") {
      json(response, 200, {
        ok: true,
        capabilities: {
          system: true,
          network: true,
          weather: Boolean(config.weather?.apiKey),
          calendar: Boolean(config.calendar?.icsUrl),
          media: false
        }
      });
      return;
    }

    if (request.url.startsWith("/api/system")) {
      json(response, 200, await getSystemSnapshot());
      return;
    }

    if (request.url.startsWith("/api/network")) {
      json(response, 200, await getNetworkSnapshot());
      return;
    }

    if (request.url.startsWith("/api/weather")) {
      json(response, 200, await getWeatherSnapshot(request.url));
      return;
    }

    if (request.url.startsWith("/api/calendar")) {
      json(response, 200, await getCalendarSnapshot());
      return;
    }

    if (request.url.startsWith("/api/media")) {
      json(response, 501, {
        configured: false,
        message: "Windows media session support is not configured in this bridge yet."
      });
      return;
    }

    serveStaticFile(request.url, response);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`XENEON bridge listening on http://127.0.0.1:${config.port}`);
});
