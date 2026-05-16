import { readFileSync } from "node:fs";

const nativeBridge = readFileSync("app/BridgeManager.cs", "utf8");
const legacyBridge = readFileSync("bridge/server.mjs", "utf8");

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
