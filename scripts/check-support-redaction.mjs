import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const bridgeManager = readWorkspaceFile("app/BridgeManager.cs");

function readWorkspaceFile(relativePath) {
  const filePath = resolve(process.cwd(), relativePath);
  try {
    if (!existsSync(filePath)) {
      throw new Error("file does not exist");
    }

    return readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`Unable to read ${relativePath} at ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  /SanitizeSupportObject\(health,\s*config\)/.test(bridgeManager)
    && /ReadRecentLogLines\(120,\s*config\)/.test(bridgeManager),
  "support bundle must sanitize health payloads and recent logs"
);

assert(
  /WindowsUserPathPattern/.test(bridgeManager)
    && /MacUserPathPattern/.test(bridgeManager)
    && /EmailPattern/.test(bridgeManager)
    && /PrivateIpPattern/.test(bridgeManager)
    && /SensitiveQueryPattern/.test(bridgeManager),
  "support bundle redaction must cover user paths, emails, private IPs, and sensitive query strings"
);

for (const replacement of [
  "<weather-location>",
  "<calendar-feed-url>",
  "<local-ip>",
  "<unifi-user>",
  "<launcher-path>",
  "<launcher-icon-path>",
  "<launcher-arguments>",
  "<redacted>"
]) {
  assert(
    bridgeManager.includes(replacement),
    `support bundle redaction must include ${replacement}`
  );
}

console.log("checked support bundle redaction guards");
