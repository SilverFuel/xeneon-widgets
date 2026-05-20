import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const supportController = readWorkspaceFile("app/Controllers/SupportController.cs");

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
  /SanitizeSupportObject\(health,\s*config\)/.test(supportController)
    && /ReadRecentLogLines\(120,\s*config\)/.test(supportController),
  "support bundle must sanitize health payloads and recent logs"
);

assert(
  /RedactClipboardEntries/.test(supportController)
    && /entriesRedacted/.test(supportController)
    && /previewsRedacted/.test(supportController)
    && !/health\s*,?\s*\n\s*\}/.test(supportController.match(/RunAutoRepairAsync[\s\S]*?return new[\s\S]*?\n\s*\};/)?.[0] || ""),
  "support bundle and repair payloads must redact clipboard entries and previews"
);

assert(
  /sessionsRedacted/.test(supportController)
    && /metadataRedacted/.test(supportController)
    && /HasSourceShape\(element,\s*"core audio"\)/.test(supportController)
    && /HasSourceShape\(element,\s*"media session"\)/.test(supportController),
  "support bundle diagnostics must minimize audio sessions and media metadata"
);

assert(
  /WindowsUserPathPattern/.test(supportController)
    && /MacUserPathPattern/.test(supportController)
    && /EmailPattern/.test(supportController)
    && /PrivateIpPattern/.test(supportController)
    && /SensitiveQueryPattern/.test(supportController),
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
    supportController.includes(replacement),
    `support bundle redaction must include ${replacement}`
  );
}

console.log("checked support bundle redaction guards");
