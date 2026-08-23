import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const nativeBridge = readWorkspaceFile("app/BridgeManager.cs");
const telemetryController = readWorkspaceFile("app/Controllers/TelemetryController.cs");
const audioService = readWorkspaceFile("app/Services/AudioService.cs");
const calendarService = readWorkspaceFile("app/Services/CalendarService.cs");
const hueService = readWorkspaceFile("app/Services/HueService.cs");
const mediaService = readWorkspaceFile("app/Services/MediaService.cs");
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
  /dashboardAssetRevision\s*=\s*_dashboardAssetRevision/.test(telemetryController)
    && /name\s*=\s*"Auxora"/.test(telemetryController),
  "native health must expose authoritative product and embedded asset revision identity"
);

assert(
  /var audio = _audioService\.GetCachedSnapshot\(\)/.test(telemetryController)
    && /var calendar = _calendarService\.GetCachedSnapshot\(config\)/.test(telemetryController)
    && /var media = _mediaService\.GetCachedSnapshot\(\)/.test(telemetryController)
    && /var hue = _hueService\.GetCachedSnapshot\(config\)/.test(telemetryController)
    && !/BuildHealthPayloadAsync[\s\S]+?await _(?:audio|calendar|media|hue)Service\.GetSnapshotAsync/.test(telemetryController)
    && /GetCachedSnapshot\(\)/.test(audioService)
    && /GetCachedSnapshot\(AppConfig config\)/.test(calendarService)
    && /GetCachedSnapshot\(AppConfig config\)/.test(hueService)
    && /GetCachedSnapshot\(\)/.test(mediaService),
  "native health must use cached integration snapshots and never block bridge availability on optional live probes"
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

assert(
  /_refreshTimeoutReported/.test(mediaService)
    && /timedOutRefreshStillRunning/.test(mediaService)
    && /suppressing duplicate timeout reports/.test(mediaService)
    && /RequestAsync\(\)[\s\S]+?\.AsTask\(cancellationToken\)/.test(mediaService)
    && /TryGetMediaPropertiesAsync\(\)[\s\S]+?\.AsTask\(cancellationToken\)/.test(mediaService)
    && /refreshCancellation\?\.Cancel\(\)/.test(mediaService),
  "Windows media polling must cancel timed-out WinRT work and suppress duplicate timeout loops"
);

console.log("checked local HTTP observability");
