import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = new Map();

function readWorkspaceFile(relativePath) {
  if (files.has(relativePath)) {
    return files.get(relativePath);
  }

  const filePath = resolve(process.cwd(), relativePath);
  try {
    if (!existsSync(filePath)) {
      throw new Error("file does not exist");
    }

    const text = readFileSync(filePath, "utf8");
    files.set(relativePath, text);
    return text;
  } catch (error) {
    console.error(`Unable to read ${relativePath} at ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function readWorkspaceJson(relativePath) {
  try {
    return JSON.parse(readWorkspaceFile(relativePath));
  } catch (error) {
    throw new Error(`${relativePath} must contain valid JSON: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const assetRevisionPayload = readWorkspaceJson("assets/revision.json");
const currentAssetRevision = String(assetRevisionPayload.assetRevision || "").trim();
assert(/^20\d{6}-\d{2}$/.test(currentAssetRevision), "assets/revision.json must define the current dashboard asset revision");

const bridgeManager = readWorkspaceFile("app/BridgeManager.cs");
const apiRouter = readWorkspaceFile("app/Controllers/ApiRouter.cs");
const actionController = readWorkspaceFile("app/Controllers/ActionController.cs");
const staticAssetController = readWorkspaceFile("app/Controllers/StaticAssetController.cs");
const configController = readWorkspaceFile("app/Controllers/ConfigController.cs");
const gameController = readWorkspaceFile("app/Controllers/GameController.cs");
const releaseController = readWorkspaceFile("app/Controllers/ReleaseController.cs");
const supportController = readWorkspaceFile("app/Controllers/SupportController.cs");
const telemetryController = readWorkspaceFile("app/Controllers/TelemetryController.cs");
const systemMetricsService = readWorkspaceFile("app/Services/SystemMetricsService.cs");
const gamePerformanceService = readWorkspaceFile("app/Services/GamePerformanceService.cs");
const hueService = readWorkspaceFile("app/Services/HueService.cs");
const uniFiService = readWorkspaceFile("app/Services/UniFiService.cs");
const calendarService = readWorkspaceFile("app/Services/CalendarService.cs");
const weatherService = readWorkspaceFile("app/Services/WeatherService.cs");
const endpointGuard = readWorkspaceFile("app/Infrastructure/NetworkEndpointGuard.cs");
const legacyBridge = readWorkspaceFile("bridge/server.mjs");
const electronMain = readWorkspaceFile("desktop/electron/src/main.cjs");
const dashboardJs = readWorkspaceFile("js/dashboard.js");
const inlineWidgets = readWorkspaceFile("js/inline-widgets.js");
const homelabWidget = readWorkspaceFile("js/widgets/homelab.js");
const systemWidget = readWorkspaceFile("js/widgets/system.js");
const networkWidget = readWorkspaceFile("js/widgets/network.js");
const audioWidget = readWorkspaceFile("js/widgets/audio.js");
const setupWidget = readWorkspaceFile("js/widgets/setup.js");
const productWidget = readWorkspaceFile("js/widgets/product.js");
const actionsWidget = readWorkspaceFile("js/widgets/actions.js");
const integrationsWidget = readWorkspaceFile("js/widgets/integrations.js");
const gameModeWidget = readWorkspaceFile("js/widgets/game-mode.js");
const bridgeExampleConfig = readWorkspaceFile("bridge/config.example.json");

assert(
  /SessionHeaderName\s*=\s*"X-Xenon-Session"/.test(bridgeManager)
    && /TryAuthorizeNoOriginMutation/.test(bridgeManager)
    && /InjectSessionToken/.test(staticAssetController),
  "native bridge must protect no-origin mutating requests with an injected session token"
);

const genericNativeCatch = bridgeManager.match(/catch\s*\(Exception\s+error\)\s*\{\s*_logger\.Error\("Failed to process request\."[\s\S]*?WriteJsonAsync\(context\.Response,\s*500[\s\S]*?\n\s*\}/)?.[0] || "";
assert(
  /new\s*\{\s*error\s*=\s*"Request failed\.",\s*requestId\s*\}/.test(genericNativeCatch)
    && !/error\.Message/.test(genericNativeCatch),
  "native bridge must not expose raw internal exception messages on HTTP 500"
);

assert(
  /InvalidJsonBodyException/.test(bridgeManager)
    && /catch\s*\(InvalidJsonBodyException\s+error\)/.test(bridgeManager)
    && !/catch\s*\(JsonException\s+error\)\s*\{\s*_logger/.test(bridgeManager),
  "native bridge must only map request-body JSON failures to HTTP 400"
);

assert(
  /NormalizeLocalHttpsAuthority\(input,\s*"Hue bridge"\)/.test(hueService)
    && /NormalizeLocalHttpsAuthority\(input,\s*"UniFi console"\)/.test(uniFiService)
    && /IsLocalOrPrivateHost/.test(endpointGuard),
  "Hue and UniFi inputs must be constrained to local/private endpoints"
);

assert(
  /NormalizeRemoteHttpUrl\(.*Calendar ICS URL/.test(configController)
    && /MaxIcsBytes\s*=\s*512\s*\*\s*1024/.test(calendarService)
    && /HttpCompletionOption\.ResponseHeadersRead/.test(calendarService),
  "calendar ICS fetches must validate remote URL shape and cap response size"
);

assert(
  /if\s*\(!currentResponse\.IsSuccessStatusCode\)/.test(weatherService)
    && /ParseUpstreamJson/.test(weatherService)
    && /ReadErrorMessage/.test(weatherService),
  "weather upstream errors must not be misclassified as request-body JSON errors"
);

assert(
  /sessionHeaderName\s*=\s*"X-Xenon-Session"/.test(legacyBridge)
    && /authorizeNoOriginMutation/.test(legacyBridge)
    && /injectSessionToken/.test(legacyBridge)
    && /sessionHeaderName\s*=\s*"X-Xenon-Session"/.test(electronMain)
    && /authorizeNoOriginMutation/.test(electronMain)
    && /injectSessionToken/.test(electronMain),
  "legacy and Electron hosts must match the native no-origin mutation boundary"
);

assert(
  !/"apiKey"\s*:/.test(bridgeExampleConfig)
    && !/"appKey"\s*:/.test(bridgeExampleConfig)
    && !/"clientKey"\s*:/.test(bridgeExampleConfig)
    && /stripConfigSecrets/.test(legacyBridge),
  "legacy bridge example and save path must not persist integration secrets in config JSON"
);

for (const relativePath of [
  "js/hosted-dashboard.js",
  "widgets/weather-widget.html",
  "widgets/plex-server-monitor.html",
  "widgets/nas-storage-monitor.html",
  "widgets/frigate-detection-panel.html"
]) {
  const text = readWorkspaceFile(relativePath);
  assert(/function\s+escapeHtml/.test(text), `${relativePath} must define HTML escaping for innerHTML rendering`);
}

const unsafeWidgetPatterns = [
  ["widgets/weather-widget.html", /\+\s*entry\.(?:label|condition)\s*\+/],
  ["widgets/plex-server-monitor.html", /\+\s*stream\.(?:title|user|device|quality|state)\s*\+/],
  ["widgets/nas-storage-monitor.html", /\+\s*(?:pool|drive)\.(?:name|health|status|usedLabel|totalLabel|freeLabel)\s*\+/],
  ["widgets/frigate-detection-panel.html", /\+\s*(?:alert|last)\.(?:label|camera|zone)\s*\+/],
  ["js/hosted-dashboard.js", /\+\s*entry\.(?:hour|condition|temp)\s*\+/]
];

for (const [relativePath, pattern] of unsafeWidgetPatterns) {
  assert(!pattern.test(readWorkspaceFile(relativePath)), `${relativePath} must escape endpoint-controlled innerHTML fields`);
}

assert(
  /StaticAssetController/.test(bridgeManager)
    && /LoadDashboardAssetRevision/.test(staticAssetController)
    && /assets\/revision\.json/.test(staticAssetController)
    && /loadAssetRevision\(webRoot\)/.test(electronMain)
    && /path\.join\(root,\s*"assets",\s*"revision\.json"\)/.test(electronMain)
    && /function\s+loadAssetRevision/.test(dashboardJs)
    && /assets\/revision\.json/.test(dashboardJs),
  "native, Electron, and dashboard JS must read asset revision from assets/revision.json"
);

assert(
  /StaticAssetController/.test(staticAssetController)
    && /TryHandleAsync/.test(staticAssetController)
    && /InjectSessionToken/.test(staticAssetController)
    && /_staticAssets\.TryHandleAsync/.test(apiRouter),
  "native static asset serving must stay outside the BridgeManager route switch"
);

assert(
  /ApiRouter/.test(apiRouter)
    && /switch\s*\(path\)/.test(apiRouter)
    && /_apiRouter\.HandleAsync\(request,\s*response,\s*DashboardUri,\s*cancellationToken\)/.test(bridgeManager)
    && !/switch\s*\(path\)/.test(bridgeManager)
    && !/ReadJsonAsync/.test(bridgeManager)
    && !/GetQueryValue/.test(bridgeManager),
  "native API dispatch and request body parsing must live in ApiRouter instead of BridgeManager"
);

assert(
  /GameController/.test(gameController)
    && /GetSteamGames/.test(gameController)
    && /GetPerformance/.test(gameController)
    && /EnsurePerformanceSession/.test(gameController)
    && /_gameController\.GetSteamGames/.test(apiRouter)
    && /_gameController\.GetPerformance/.test(apiRouter),
  "Steam and Game Mode endpoints must route through GameController"
);

assert(
  /ConfigController/.test(configController)
    && /GetSnapshot/.test(configController)
    && /UpdateDashboard/.test(configController)
    && /GetDisplayDiagnostics/.test(configController)
    && /_configController\.UpdateDashboard/.test(apiRouter)
    && /_configController\.GetDisplayDiagnostics/.test(apiRouter)
    && !/HandleDashboardConfigUpdateAsync/.test(bridgeManager)
    && !/BuildConfigSnapshot/.test(bridgeManager),
  "configuration and display endpoints must route through ConfigController"
);

assert(
  /TelemetryController/.test(telemetryController)
    && /BuildHealthPayloadAsync/.test(telemetryController)
    && /GetSystemSnapshot/.test(telemetryController)
    && /GetNetworkSnapshot/.test(telemetryController)
    && /GetAudioAsync/.test(telemetryController)
    && /_telemetryController\.BuildHealthPayloadAsync/.test(apiRouter)
    && /_telemetryController\.GetSystemSnapshot/.test(apiRouter)
    && /_telemetryController\.GetAudioAsync/.test(apiRouter)
    && !/HandleAudioDefaultDeviceAsync/.test(bridgeManager)
    && !/BuildHealthPayloadAsync\(CancellationToken/.test(bridgeManager),
  "health, system, network, UniFi, and audio endpoints must route through TelemetryController"
);

assert(
  /ActionController/.test(actionController)
    && /GetLaunchers/.test(actionController)
    && /TryExecuteQuickAction/.test(actionController)
    && /TryExecuteSystemShortcut/.test(actionController)
    && /TryExecuteHueActionAsync/.test(actionController)
    && /_actionController\.GetLaunchers/.test(apiRouter)
    && /_actionController\.TryExecuteQuickAction/.test(apiRouter)
    && /_actionController\.TryExecuteHueActionAsync/.test(apiRouter)
    && !/TryHandleQuickActionAsync/.test(bridgeManager)
    && !/TryHandleHueActionAsync/.test(bridgeManager),
  "launcher, quick action, shortcut, Hue, media, and clipboard endpoints must route through ActionController"
);

assert(
  /ReleaseController/.test(releaseController)
    && /GetLatestAsync/.test(releaseController)
    && /BuildRollbackPayload/.test(releaseController)
    && /_releaseController\.GetLatestAsync/.test(apiRouter)
    && /_releaseController\.BuildRollbackPayload/.test(apiRouter)
    && !/_releaseService\.GetLatestReleaseAsync/.test(apiRouter)
    && !/public sealed class RollbackPayload/.test(bridgeManager),
  "release latest and rollback routes must route through ReleaseController, with rollback DTO outside BridgeManager"
);

assert(
  /SupportController/.test(supportController)
    && /BuildSupportBundleAsync/.test(supportController)
    && /RunAutoRepairAsync/.test(supportController)
    && /BuildRollbackPayload/.test(supportController)
    && /SanitizeText/.test(supportController)
    && /WindowsUserPathPattern/.test(supportController)
    && /SensitiveQueryPattern/.test(supportController)
    && /_supportController\.BuildSupportBundleAsync/.test(apiRouter)
    && /_supportController\.RunAutoRepairAsync/.test(apiRouter)
    && /_supportController\.SanitizeText\(path\)/.test(bridgeManager)
    && !/ReadRecentLogLines/.test(bridgeManager)
    && !/SanitizeSupportObject/.test(bridgeManager),
  "support bundle, auto repair, rollback, and request log redaction must route through SupportController"
);

for (const relativePath of [
  "dashboard.html",
  "hosted-dashboard.html",
  "index.html",
  "start-xeneon.ps1",
  "bridge/install-bridge.ps1",
  "widgets/weather-widget.html",
  "widgets/network-widget.html",
  "widgets/media-widget.html",
  "widgets/setup-guide.html"
]) {
  const revisions = [...readWorkspaceFile(relativePath).matchAll(/\b20\d{6}-\d{2}\b/g)].map(match => match[0]);
  assert(revisions.length > 0, `${relativePath} must include cache-busting dashboard asset revisions`);
  assert(revisions.every(revision => revision === currentAssetRevision), `${relativePath} must use ${currentAssetRevision} for dashboard asset revisions`);
}

assert(
  readWorkspaceFile("app/XenonEdgeHost.csproj").includes(`0.2.0+${currentAssetRevision.slice(0, 8)}`),
  "native assembly informational version must match the current release date"
);

assert(
  /path\.relative\(rootDir,\s*resolvedPath\)/.test(legacyBridge)
    && /relative\.startsWith\(".."\)/.test(legacyBridge)
    && /path\.isAbsolute\(relative\)/.test(legacyBridge),
  "legacy bridge static file guard must use path.relative instead of sibling-prefix startsWith"
);

assert(
  /function\s+isAllowedExternalUrl/.test(electronMain)
    && /protocol === "https:"/.test(electronMain)
    && /protocol === "http:"/.test(electronMain)
    && /protocol === "mailto:"/.test(electronMain)
    && /openExternalIfAllowed/.test(electronMain),
  "Electron external navigation must use an explicit protocol allowlist"
);

assert(
  !/DangerousAcceptAnyServerCertificateValidator/.test(uniFiService)
    && /ValidateUniFiCertificate/.test(uniFiService)
    && /UniFiCertificateTrustRequiredException/.test(uniFiService)
    && /CertificateThumbprint/.test(uniFiService)
    && /TrustedCertificateThumbprint/.test(readWorkspaceFile("app/Models/AppConfig.cs"))
    && /certificateTrustRequired/.test(homelabWidget)
    && /network-certificate-review/.test(networkWidget)
    && /trustCertificate:\s*Boolean/.test(networkWidget)
    && /trustedCertificateThumbprint/.test(networkWidget),
  "UniFi local API must use certificate trust-on-first-use instead of accepting every certificate"
);

assert(
  /Interlocked\.Exchange\(ref _usageSampling,\s*1\)/.test(systemMetricsService)
    && /Interlocked\.Exchange\(ref _temperatureSampling,\s*1\)/.test(systemMetricsService),
  "native system metrics timers must guard against overlapping samples"
);

assert(
  /case "\/api\/game\/performance" when request\.HttpMethod == "GET":[\s\S]*?_gameController\.GetPerformance/.test(apiRouter)
    && /case "\/api\/game\/performance\/session" when request\.HttpMethod == "POST":[\s\S]*?_gameController\.EnsurePerformanceSession/.test(apiRouter)
    && /public GamePerformanceSnapshot EnsureSession/.test(gamePerformanceService),
  "Game Mode FPS capture must split POST session mutation from GET performance reads"
);

assert(
  /NeedsAdmin/.test(gamePerformanceService)
    && /RestartAsAdminEndpoint/.test(gamePerformanceService)
    && /RestartHostAsAdministrator/.test(actionController)
    && /case "\/api\/system\/restart-admin" when request\.HttpMethod == "POST"/.test(apiRouter)
    && /restart-game-admin/.test(gameModeWidget)
    && /Telemetry readiness/.test(gameModeWidget),
  "Game Mode telemetry readiness must expose FPS source, admin capture state, and an elevated restart action"
);

assert(
  /requiresBridge:\s*true/.test(dashboardJs)
    && /function\s+widgetRequiresBridge\(widget\)\s*\{\s*return Boolean\(widget && widget\.requiresBridge\);\s*\}/.test(dashboardJs),
  "bridge-dependent widgets must declare requiresBridge in their widget config"
);

assert(
  /runtime:\s*runtime/.test(inlineWidgets)
    && /registerRenderer/.test(inlineWidgets)
    && !/function\s+mount(?!PlaceholderWidget\b)[A-Z][A-Za-z0-9_]*Widget/.test(inlineWidgets)
    && /function\s+patchGameFocusMetric/.test(gameModeWidget)
    && /function\s+patchGameFocusScene/.test(gameModeWidget)
    && /data-game-focus-metric/.test(gameModeWidget)
    && /data-game-focus-active-id/.test(gameModeWidget)
    && !/container\.getAttribute\("data-game-focus-intro"\)\s*===/.test(gameModeWidget)
    && /runtime\.registerRenderer\("game-mode",\s*mountGameModeWidget\)/.test(gameModeWidget),
  "active Game Mode HUD must patch mounted metric nodes instead of redrawing the full scene on every poll"
);

assert(
  /css\/widgets\/game-mode\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/game-mode\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && !/mountGameModeWidget/.test(inlineWidgets),
  "Game Mode JS and CSS must stay split from the shared inline widget runtime"
);

assert(
  /css\/widgets\/homelab\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/homelab\.js\?v=[\s\S]*js\/widgets\/system\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/homelab\.js\?v=[\s\S]*js\/widgets\/network\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /runtime\.registerHelpers\(\{\s*normalizeUnifiSnapshot:\s*normalizeUnifiSnapshot\s*\}\)/.test(homelabWidget)
    && /runtime\.registerRenderer\("unifi-camera",\s*mountCameraWidget\)/.test(homelabWidget)
    && /runtime\.registerRenderer\("unifi-network",\s*mountUniFiNetworkWidget\)/.test(homelabWidget)
    && /runtime\.registerRenderer\("plex",\s*mountPlexWidget\)/.test(homelabWidget)
    && /runtime\.registerRenderer\("nas",\s*mountNasWidget\)/.test(homelabWidget)
    && /runtime\.registerRenderer\("automation",\s*mountAutomationWidget\)/.test(homelabWidget)
    && !/mountCameraWidget/.test(inlineWidgets)
    && !/mountUniFiNetworkWidget/.test(inlineWidgets)
    && !/mountPlexWidget/.test(inlineWidgets)
    && !/mountNasWidget/.test(inlineWidgets)
    && !/mountAutomationWidget/.test(inlineWidgets)
    && !/normalizeUniFiNetworkPayload/.test(inlineWidgets)
    && !/normalizeCameraPayload/.test(integrationsWidget)
    && !/inline-media__video|inline-media__placeholder/.test(readWorkspaceFile("css/widgets.css")),
  "Homelab widgets, UniFi normalizer, and camera media CSS must stay split from the shared inline widget runtime"
);

assert(
  /css\/widgets\/system\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /css\/widgets\/network\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /css\/widgets\/audio\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/system\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/network\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/audio\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /runtime\.registerRenderer\("system",\s*mountSystemWidget\)/.test(systemWidget)
    && /runtime\.registerRenderer\("network",\s*mountNetworkWidget\)/.test(networkWidget)
    && /runtime\.registerRenderer\("audio",\s*mountAudioWidget\)/.test(audioWidget)
    && /function\s+normalizeGpuPowerPayload/.test(systemWidget)
    && /function\s+formatMemoryMb/.test(systemWidget)
    && /runtime\.registerHelpers/.test(networkWidget)
    && /runtime\.registerHelpers/.test(audioWidget)
    && !/mountSystemWidget/.test(inlineWidgets)
    && !/mountNetworkWidget/.test(inlineWidgets)
    && !/mountAudioWidget/.test(inlineWidgets)
    && !/normalizeGpuPowerPayload/.test(inlineWidgets)
    && !/gpu-power-list|gpu-power-sensor/.test(readWorkspaceFile("css/widgets.css"))
    && !/system-|network-command|audio-/.test(readWorkspaceFile("css/widgets.css")),
  "System, Network, and Audio widget JS/CSS must stay split from the shared inline widget runtime"
);

assert(
  /css\/widgets\/actions\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/actions\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /runtime\.registerRenderer\("launchers",\s*mountLaunchersWidget\)/.test(actionsWidget)
    && /runtime\.registerRenderer\("quick-actions",\s*mountQuickActionsWidget\)/.test(actionsWidget)
    && /runtime\.registerRenderer\("shortcuts",\s*mountSystemShortcutsWidget\)/.test(actionsWidget)
    && /runtime\.registerRenderer\("clipboard",\s*mountClipboardWidget\)/.test(actionsWidget)
    && !/mountLaunchersWidget/.test(inlineWidgets)
    && !/mountQuickActionsWidget/.test(inlineWidgets)
    && !/mountSystemShortcutsWidget/.test(inlineWidgets)
    && !/mountClipboardWidget/.test(inlineWidgets)
    && !/inline-action-grid|inline-launcher-grid|inline-clipboard-preview/.test(readWorkspaceFile("css/widgets.css")),
  "Launcher, quick action, shortcut, and clipboard widget JS/CSS must stay split from the shared inline widget runtime"
);

assert(
  /css\/widgets\/setup\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/setup\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /runtime\.registerRenderer\("setup",\s*mountSetupWidget\)/.test(setupWidget)
    && /runtime\.registerRenderer\("calendar",\s*mountCalendarWidget\)/.test(setupWidget)
    && !/mountSetupWidget/.test(inlineWidgets)
    && !/mountCalendarWidget/.test(inlineWidgets)
    && !/setup-diagnostics-grid|setup-launcher-suggestions|setup-display-target/.test(readWorkspaceFile("css/widgets.css")),
  "Setup diagnostics and Calendar widget JS/CSS must stay split from the shared inline widget runtime"
);

assert(
  /css\/widgets\/product\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/product\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /runtime\.registerRenderer\("theme-studio",\s*mountThemeStudioWidget\)/.test(productWidget)
    && /runtime\.registerRenderer\("layout-editor",\s*mountLayoutEditorWidget\)/.test(productWidget)
    && /runtime\.registerRenderer\("updates",\s*mountUpdatesWidget\)/.test(productWidget)
    && /runtime\.registerRenderer\("streaming",\s*mountStreamingWidget\)/.test(productWidget)
    && /runtime\.registerRenderer\("marketplace",\s*mountMarketplaceWidget\)/.test(productWidget)
    && /runtime\.registerRenderer\("installer",\s*mountInstallerWidget\)/.test(productWidget)
    && /runtime\.registerRenderer\("privacy",\s*mountPrivacyWidget\)/.test(productWidget)
    && !/mountThemeStudioWidget/.test(inlineWidgets)
    && !/mountLayoutEditorWidget/.test(inlineWidgets)
    && !/mountUpdatesWidget/.test(inlineWidgets)
    && !/mountStreamingWidget/.test(inlineWidgets)
    && !/mountMarketplaceWidget/.test(inlineWidgets)
    && !/mountInstallerWidget/.test(inlineWidgets)
    && !/mountPrivacyWidget/.test(inlineWidgets)
    && !/productProfiles/.test(inlineWidgets)
    && !/productPacks/.test(inlineWidgets)
    && !/product-theme-grid|product-layout-row|product-checklist|product-control-panel/.test(readWorkspaceFile("css/widgets.css")),
  "Product panels and shared product widget CSS must stay split from the shared inline widget runtime"
);

assert(
  /css\/widgets\/integrations\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/integrations\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /runtime\.registerRenderer\("weather",\s*mountWeatherWidget\)/.test(integrationsWidget)
    && /runtime\.registerRenderer\("hue",\s*mountHueWidget\)/.test(integrationsWidget)
    && /runtime\.registerRenderer\("media",\s*mountMediaWidget\)/.test(integrationsWidget)
    && !/runtime\.registerRenderer\("media",\s*mountAudioWidget\)/.test(audioWidget)
    && !/mountWeatherWidget/.test(inlineWidgets)
    && !/mountHueWidget/.test(inlineWidgets)
    && !/mountMediaWidget/.test(inlineWidgets)
    && !/inline-media-hero|inline-media-art|inline-media-copy/.test(readWorkspaceFile("css/widgets.css")),
  "Weather, Hue, and standalone Media widget JS/CSS must stay split from the shared inline widget runtime"
);

console.log("checked audit regression guards");
