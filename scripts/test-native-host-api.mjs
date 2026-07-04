import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readWorkspaceFile(relativePath) {
  const filePath = resolve(process.cwd(), relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`${relativePath} does not exist`);
  }

  return readFileSync(filePath, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const apiRouter = readWorkspaceFile("app/Controllers/ApiRouter.cs");
const bridgeManager = readWorkspaceFile("app/BridgeManager.cs");
const actionController = readWorkspaceFile("app/Controllers/ActionController.cs");
const telemetryController = readWorkspaceFile("app/Controllers/TelemetryController.cs");
const configController = readWorkspaceFile("app/Controllers/ConfigController.cs");
const staticAssets = readWorkspaceFile("app/Controllers/StaticAssetController.cs");
const embeddedAssetProvider = readWorkspaceFile("app/Infrastructure/EmbeddedAssetProvider.cs");

for (const route of [
  "/api/health",
  "/api/config",
  "/api/config/dashboard",
  "/api/action-confirmations",
  "/api/quick-actions",
  "/api/system-shortcuts",
  "/api/audio/input-mute",
  "/api/clipboard",
  "/api/support/bundle",
  "/api/releases/latest",
  "/api/game/session"
]) {
  assert(apiRouter.includes(route), `native ApiRouter must expose ${route}`);
}

assert(
  /_apiRouter\.HandleAsync\(request,\s*response,\s*DashboardUri,\s*cancellationToken\)/.test(bridgeManager)
    && !/bridge\/server\.mjs/.test(apiRouter),
  "native API contract test must target the C# host route surface, not the legacy Node bridge"
);

assert(
  /IssueActionConfirmation/.test(actionController)
    && /ExecuteQuickAction/.test(actionController)
    && /ExecuteSystemShortcut/.test(actionController),
  "native action controller must expose confirmation-gated action execution"
);

assert(
  /ClipboardPrivacyOptions\.FromDashboard/.test(actionController)
    && /ClipboardPrivacyOptions\.FromDashboard/.test(telemetryController)
    && /clipboardHidePreviews/.test(configController),
  "native clipboard API must honor privacy settings across action, telemetry, and config controllers"
);

assert(
  /Content-Security-Policy/.test(staticAssets)
    && /window\.XenonSessionToken/.test(staticAssets)
    && !/xenon-session-bootstrap\.js/.test(staticAssets),
  "native static asset API must emit security headers and inline the session token into local HTML"
);

assert(
  /case "\/api\/game\/session" when request\.HttpMethod == "POST"/.test(apiRouter)
    && /GetSessionAsync/.test(readWorkspaceFile("app/Controllers/GameController.cs"))
    && /GameModeSessionService/.test(bridgeManager),
  "native Game Mode contract must expose the composed POST session endpoint through the C# host"
);

assert(
  /NormalizeResourceName/.test(embeddedAssetProvider)
    && /Replace\('\\\\',\s*'\/'\)/.test(embeddedAssetProvider)
    && /normalizedResourceName\.EndsWith\(\$"WebAssets\/\{normalizedPath\}"/.test(embeddedAssetProvider),
  "native embedded asset provider must serve split widget files from nested resource paths"
);

console.log("checked native host API contract routes");
