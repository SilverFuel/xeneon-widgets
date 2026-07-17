import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const hostUrl = "http://127.0.0.1:8976";
const executable = resolve(
  process.cwd(),
  "app/bin/x64/Release/net8.0-windows10.0.19041.0/win-x64/XenonEdgeHost.exe"
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchWithTimeout(path, options = {}, timeoutMs = 3000) {
  return fetch(`${hostUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs)
  });
}

async function hostAlreadyRunning() {
  try {
    const response = await fetchWithTimeout("/api/health", {}, 1000);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHost(child, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`native host exited before becoming healthy (exit code ${child.exitCode})`);
    }
    try {
      const response = await fetchWithTimeout("/api/health");
      if (response.ok) return response;
    } catch {
      // The listener is expected to be unavailable during startup.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
  }
  throw new Error("native host did not expose /api/health within 45 seconds");
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

assert(process.platform === "win32", "launched native host test requires Windows");
assert(existsSync(executable), `Release host executable is missing: ${executable}; run npm run check:app first`);
assert(!(await hostAlreadyRunning()), "port 8976 is already serving a host; refusing to validate an unrelated process");

const profileRoot = mkdtempSync(join(tmpdir(), "auxora-native-host-test-"));
const roaming = join(profileRoot, "Roaming");
const local = join(profileRoot, "Local");
mkdirSync(roaming, { recursive: true });
mkdirSync(local, { recursive: true });

const child = spawn(executable, ["--safe-mode"], {
  cwd: resolve(process.cwd(), "app"),
  env: {
    ...process.env,
    APPDATA: roaming,
    LOCALAPPDATA: local,
    TEMP: profileRoot,
    TMP: profileRoot
  },
  stdio: "ignore",
  windowsHide: true
});

try {
  const healthResponse = await waitForHost(child);
  const health = await healthResponse.json();
  assert(health && typeof health === "object", "live /api/health must return JSON");

  const configResponse = await fetchWithTimeout("/api/config");
  assert(configResponse.ok, `live /api/config returned HTTP ${configResponse.status}`);
  const config = await configResponse.json();
  assert(config && typeof config.port === "number", "live /api/config must return the configured port");

  const dashboardResponse = await fetchWithTimeout("/dashboard.html");
  assert(dashboardResponse.ok, `live dashboard returned HTTP ${dashboardResponse.status}`);
  assert((await dashboardResponse.text()).includes("Auxora"), "live dashboard must serve embedded Auxora HTML");

  const rejectedOrigin = await fetchWithTimeout("/api/health", { headers: { Origin: "https://example.test" } });
  assert(rejectedOrigin.status === 403, `foreign Origin must be rejected; received HTTP ${rejectedOrigin.status}`);

  const rejectedMutation = await fetchWithTimeout("/api/config/dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert(rejectedMutation.status === 403, `mutation without session token must be rejected; received HTTP ${rejectedMutation.status}`);

  console.log("launched native host and verified live health, config, embedded dashboard, origin, and mutation boundaries");
} finally {
  await stopChild(child);
  rmSync(profileRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
