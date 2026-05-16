import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const bridgeScript = resolve(repoRoot, "bridge/server.mjs");
const testPort = 19876;
const tempDir = mkdtempSync(join(tmpdir(), "xenon-bridge-api-"));
const configPath = join(tempDir, "config.json");
const baseUrl = `http://127.0.0.1:${testPort}`;
let serverProcess;

writeFileSync(configPath, JSON.stringify({
  port: testPort,
  weather: {},
  calendar: {},
  hue: {},
  dashboard: {
    onboardingCompleted: false,
    onboardingCompletedAt: "",
    onboardingVersion: 1
  }
}, null, 2));

function fail(message) {
  throw new Error(message);
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await request("/api/health");
      if (response.ok) {
        return response;
      }
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error(`bridge did not become healthy: ${lastError?.message || "unknown error"}`);
}

async function assertResponse(label, response, expectedStatus) {
  if (response.status !== expectedStatus) {
    const text = await response.text();
    fail(`${label} returned ${response.status}, expected ${expectedStatus}: ${text}`);
  }
}

try {
  serverProcess = spawn(process.execPath, [bridgeScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      XENON_BRIDGE_CONFIG: configPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stderr = [];
  serverProcess.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  serverProcess.on("exit", (code, signal) => {
    if (code && code !== 0) {
      stderr.push(`bridge exited with code ${code}${signal ? ` (${signal})` : ""}`);
    }
  });

  await Promise.race([
    waitForHealth(),
    once(serverProcess, "exit").then(() => {
      throw new Error(`bridge exited before health check: ${stderr.join("").trim()}`);
    })
  ]);

  const health = await request("/api/health");
  await assertResponse("health", health, 200);
  if (!health.headers.get("x-request-id")) {
    fail("health response did not include X-Request-ID");
  }
  const healthPayload = await health.json();
  if (healthPayload.ok !== true) {
    fail("health payload was not ok");
  }
  if (healthPayload.setup?.items?.provisioning?.state !== "Ready") {
    fail("health payload did not report browser bridge provisioning as ready");
  }
  if (healthPayload.setup?.items?.display?.state !== "Optional") {
    fail("health payload did not report browser bridge display diagnostics as optional");
  }

  const rejectedOrigin = await request("/api/health", {
    headers: {
      Origin: "http://example.com"
    }
  });
  await assertResponse("bad origin", rejectedOrigin, 403);

  const invalidJson = await request("/api/config/dashboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "{"
  });
  await assertResponse("invalid JSON", invalidJson, 400);

  const oversizedJson = await request("/api/config/dashboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ value: "x".repeat((256 * 1024) + 1) })
  });
  await assertResponse("oversized JSON", oversizedJson, 413);

  const dashboardUpdate = await request("/api/config/dashboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl
    },
    body: JSON.stringify({
      onboardingCompleted: true,
      onboardingVersion: 1
    })
  });
  await assertResponse("dashboard update", dashboardUpdate, 200);
  if (!dashboardUpdate.headers.get("access-control-allow-origin")) {
    fail("dashboard update did not include CORS response header for allowed origin");
  }

  console.log("checked bridge local API integration");
} finally {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await Promise.race([
      once(serverProcess, "exit"),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))
    ]).catch(() => {});
  }
  rmSync(tempDir, { recursive: true, force: true });
}
