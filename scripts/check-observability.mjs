import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const nativeBridge = readWorkspaceFile("app/BridgeManager.cs");
const legacyBridge = readWorkspaceFile("bridge/server.mjs");

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
  /response\.Headers\["X-Request-ID"\]\s*=\s*requestId/.test(nativeBridge)
    && /LogRequestBoundary\(requestId,\s*method,\s*path,\s*response\.StatusCode/.test(nativeBridge),
  "native host must emit request IDs and structured request boundary logs"
);

assert(
  /eventName\s*=\s*"http_request"/.test(nativeBridge)
    && /durationMs\s*=\s*Math\.Round/.test(nativeBridge),
  "native host request logs must include structured event name and duration"
);

assert(
  /response\.setHeader\("X-Request-ID",\s*requestId\)/.test(legacyBridge)
    && /writeStructuredLog\("http_request"/.test(legacyBridge),
  "legacy bridge must emit request IDs and structured request boundary logs"
);

assert(
  /sensitiveQueryPattern/.test(legacyBridge)
    && /sanitizeLogPath/.test(legacyBridge),
  "legacy bridge request logs must sanitize sensitive query values"
);

console.log("checked local HTTP observability");
