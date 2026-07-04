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

const appCsproj = readWorkspaceFile("app/XenonEdgeHost.csproj");
const appVersion = appCsproj.match(/<Version>([^<]+)<\/Version>/)?.[1]?.trim() || "";
assert(appVersion, "app/XenonEdgeHost.csproj must define <Version>");

const bridgeManager = readWorkspaceFile("app/BridgeManager.cs");
const mainWindow = readWorkspaceFile("app/MainWindow.xaml.cs");
const installScript = readWorkspaceFile("app/install.ps1");
const installerScript = readWorkspaceFile("app/installer/Install-XenonEdgeHost.ps1");
const repairScript = readWorkspaceFile("app/repair.ps1");
const freeBetaReleaseScript = readWorkspaceFile("scripts/prepare-free-beta-release.ps1");
const apiRouter = readWorkspaceFile("app/Controllers/ApiRouter.cs");
const actionController = readWorkspaceFile("app/Controllers/ActionController.cs");
const staticAssetController = readWorkspaceFile("app/Controllers/StaticAssetController.cs");
const configController = readWorkspaceFile("app/Controllers/ConfigController.cs");
const gameController = readWorkspaceFile("app/Controllers/GameController.cs");
const releaseController = readWorkspaceFile("app/Controllers/ReleaseController.cs");
const supportController = readWorkspaceFile("app/Controllers/SupportController.cs");
const telemetryController = readWorkspaceFile("app/Controllers/TelemetryController.cs");
const programCs = readWorkspaceFile("app/Program.cs");
const appLaunchOptions = readWorkspaceFile("app/AppLaunchOptions.cs");
const systemMetricsService = readWorkspaceFile("app/Services/SystemMetricsService.cs");
const gpuPowerMonitorService = readWorkspaceFile("app/Services/GpuPowerMonitorService.cs");
const networkMetricsService = readWorkspaceFile("app/Services/NetworkMetricsService.cs");
const audioService = readWorkspaceFile("app/Services/AudioService.cs");
const mediaService = readWorkspaceFile("app/Services/MediaService.cs");
const steamService = readWorkspaceFile("app/Services/SteamService.cs");
const gameActivityService = readWorkspaceFile("app/Services/GameActivityService.cs");
const gamePerformanceService = readWorkspaceFile("app/Services/GamePerformanceService.cs");
const gameModeSessionService = readWorkspaceFile("app/Services/GameModeSessionService.cs");
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
const gameFocusPatchBody = gameModeWidget.match(/function\s+patchGameFocusScene\([\s\S]*?\n  function\s+renderGameModeProfilePanel/);
const unhandledRejectionHandler = dashboardJs.match(/window\.addEventListener\("unhandledrejection"[\s\S]*?\n\s*\}\);/);
const bridgeExampleConfig = readWorkspaceFile("bridge/config.example.json");
const appConfig = readWorkspaceFile("app/Models/AppConfig.cs");
const launcherService = readWorkspaceFile("app/Services/LauncherService.cs");
const launcherTargetValidator = readWorkspaceFile("app/Infrastructure/LauncherTargetValidator.cs");
const systemActionsService = readWorkspaceFile("app/Services/SystemActionsService.cs");
const clipboardHistoryService = readWorkspaceFile("app/Services/ClipboardHistoryService.cs");
const releaseService = readWorkspaceFile("app/Services/ReleaseService.cs");
const hostLogger = readWorkspaceFile("app/Infrastructure/HostLogger.cs");
const releaseWorkflow = readWorkspaceFile(".github/workflows/release.yml");
const buildStamp = readWorkspaceFile("build/build-stamp.props");

assert(
  /SessionHeaderName\s*=\s*"X-Xenon-Session"/.test(bridgeManager)
    && /TryAuthorizeMutationSession/.test(bridgeManager)
    && !/TryAuthorizeNoOriginMutation/.test(bridgeManager)
    && /request\.Headers\[SessionHeaderName\]/.test(bridgeManager)
    && /BuildSessionBootstrapScript/.test(staticAssetController)
    && /window\.XenonSessionToken/.test(staticAssetController)
    && !/WriteSessionBootstrapAsync/.test(staticAssetController)
    && !/xenon-session-bootstrap\.js/.test(staticAssetController),
  "native bridge must require the session header for mutations and inline the local HTML session bootstrap"
);

assert(
  /Content-Security-Policy/.test(staticAssetController)
    && /nonce-/.test(staticAssetController)
    && /X-Content-Type-Options/.test(staticAssetController)
    && /Referrer-Policy/.test(staticAssetController)
    && !/meta name="xenon-session-token"/.test(staticAssetController),
  "native static HTML must use CSP/security headers and must not inject the session token into a meta tag"
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
    && /icsUrlConfigured/.test(configController)
    && /GetDisplayHost/.test(configController)
    && !/icsUrl\s*=\s*config\.Calendar\.IcsUrl/.test(configController)
    && /MaxIcsBytes\s*=\s*512\s*\*\s*1024/.test(calendarService)
    && /HttpCompletionOption\.ResponseHeadersRead/.test(calendarService),
  "calendar ICS fetches must validate remote URL shape, cap response size, and avoid returning bearer feed URLs from config"
);

assert(
  /if\s*\(!currentResponse\.IsSuccessStatusCode\)/.test(weatherService)
    && /ParseUpstreamJson/.test(weatherService)
    && /ReadErrorMessage/.test(weatherService),
  "weather upstream errors must not be misclassified as request-body JSON errors"
);

assert(
  /sessionHeaderName\s*=\s*"X-Xenon-Session"/.test(legacyBridge)
    && /authorizeMutationSession/.test(legacyBridge)
    && !/authorizeNoOriginMutation/.test(legacyBridge)
    && /injectSessionToken/.test(legacyBridge)
    && /securityHeaders/.test(legacyBridge)
    && /window\.XenonSessionToken/.test(legacyBridge)
    && !/xenon-session-bootstrap\.js/.test(legacyBridge)
    && /sessionHeaderName\s*=\s*"X-Xenon-Session"/.test(electronMain)
    && /authorizeMutationSession/.test(electronMain)
    && !/authorizeNoOriginMutation/.test(electronMain)
    && /injectSessionToken/.test(electronMain)
    && /securityHeaders/.test(electronMain)
    && /window\.XenonSessionToken/.test(electronMain)
    && !/xenon-session-bootstrap\.js/.test(electronMain),
  "legacy and Electron hosts must match the native no-origin mutation and local HTML security boundary"
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
    && /InjectSessionBootstrap/.test(staticAssetController)
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
    && /TryMatchQuickAction/.test(actionController)
    && /TryMatchSystemShortcut/.test(actionController)
    && /TryExecuteHueActionAsync/.test(actionController)
    && /_actionController\.GetLaunchers/.test(apiRouter)
    && /_actionController\.TryMatchQuickAction/.test(apiRouter)
    && /_actionController\.TryExecuteHueActionAsync/.test(apiRouter)
    && !/TryHandleQuickActionAsync/.test(bridgeManager)
    && !/TryHandleHueActionAsync/.test(bridgeManager),
  "launcher, quick action, shortcut, Hue, media, and clipboard endpoints must route through ActionController"
);

assert(
  /ActionConfirmationRequest/.test(appConfig)
    && /IssueConfirmation/.test(systemActionsService)
    && /PendingActionConfirmation/.test(systemActionsService)
    && /TryRemove\(token\.Trim\(\)/.test(systemActionsService)
    && /case "\/api\/action-confirmations" when request\.HttpMethod == "POST"/.test(apiRouter)
    && /requestActionConfirmation/.test(actionsWidget)
    && /requiresServerConfirmation/.test(actionsWidget),
  "dangerous local actions must require short-lived server-issued confirmation tokens"
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
  /Programs\\XenonEdgeHost\\XenonEdgeHost\.exe/.test(readWorkspaceFile("start-xeneon.ps1"))
    && /publish\\XenonEdgeHost\.exe/.test(readWorkspaceFile("start-xeneon.ps1"))
    && /api\/health/.test(readWorkspaceFile("start-xeneon.ps1"))
    && !/dashboard\.html/.test(readWorkspaceFile("start-xeneon.ps1")),
  "start-xeneon.ps1 must launch the installed app first and avoid opening the raw dashboard URL"
);

assert(
  assetRevisionPayload.informationalVersion === `${appVersion}+${currentAssetRevision.slice(0, 8)}`,
  "native assembly informational version must match the current release date"
);

assert(
  buildStamp.includes(`<XenonAssetRevision>${currentAssetRevision}</XenonAssetRevision>`)
    && buildStamp.includes(`<XenonInformationalVersion>${assetRevisionPayload.informationalVersion}</XenonInformationalVersion>`)
    && appCsproj.includes("$(XenonInformationalVersion)")
    && assetRevisionPayload.informationalVersion === `${appVersion}+${currentAssetRevision.slice(0, 8)}`,
  "native informational version and asset revision must share build/build-stamp.props"
);

assert(
  /\$version\s*=\s*"0\.0\.0"/.test(installerScript)
    && /\$version\s*=\s*"0\.0\.0"/.test(repairScript)
    && !/"1\.0\.0"/.test(installerScript)
    && !/"1\.0\.0"/.test(repairScript)
    && /\$appVersion/.test(freeBetaReleaseScript)
    && /XENEON Edge Host \$appVersion Free Public Beta/.test(freeBetaReleaseScript)
    && /install\.prev\.log/.test(installerScript)
    && /512KB/.test(installerScript),
  "installer and release scripts must single-source versions, use a neutral fallback, and rotate the install transcript"
);

assert(
  /LauncherTargetValidator/.test(launcherService)
    && /\.exe/.test(launcherTargetValidator)
    && /\.lnk/.test(launcherTargetValidator)
    && /steam:\/\/rungameid/.test(launcherTargetValidator)
    && /AllowedUriSchemes/.test(launcherTargetValidator)
    && /ValidateAndNormalizeTarget\(entry\.ExecutablePath,\s*entry\.Arguments\)/.test(launcherService)
    && /TryValidateAndNormalizeTarget/.test(readWorkspaceFile("app/Infrastructure/ConfigStore.cs")),
  "launcher entries must validate targets at save and launch time"
);

assert(
  /path\.relative\(rootDir,\s*resolvedPath\)/.test(legacyBridge)
    && /relative\.startsWith\(".."\)/.test(legacyBridge)
    && /path\.isAbsolute\(relative\)/.test(legacyBridge),
  "legacy bridge static file guard must use path.relative instead of sibling-prefix startsWith"
);

assert(
  /forceLegacyBridge\s*=\s*process\.argv\.includes\("--force"\)/.test(legacyBridge)
    && /isNativeHostHealthPayload/.test(legacyBridge)
    && /readNativeHostHealth/.test(legacyBridge)
    && /config\.port === 8976/.test(legacyBridge)
    && /Native XENEON Edge Host is already running/.test(legacyBridge)
    && /await startBridgeServer\(\)/.test(legacyBridge),
  "legacy bridge must refuse to bind over the native host on port 8976 unless explicitly forced"
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
  /ActiveRequestWindow\s*=\s*TimeSpan\.FromSeconds\(60\)/.test(gpuPowerMonitorService)
    && /HwInfoDiscoveryCacheDuration\s*=\s*TimeSpan\.FromMinutes\(5\)/.test(gpuPowerMonitorService)
    && /_lastSnapshotRequestedAt\s*=\s*DateTimeOffset\.UtcNow/.test(gpuPowerMonitorService)
    && /ShouldSampleNow/.test(gpuPowerMonitorService)
    && /ReadHwInfoCsvReviewLines/.test(gpuPowerMonitorService)
    && /ReadFileChunkLines/.test(gpuPowerMonitorService)
    && !/File\.ReadLines\(filePath\)/.test(gpuPowerMonitorService),
  "GPU power sampling must be demand-driven, cache HWiNFO discovery, and avoid full CSV reads"
);

assert(
  /SystemEvents\.DisplaySettingsChanged\s*\+=\s*HandleDisplaySettingsChanged/.test(mainWindow)
    && /SystemEvents\.DisplaySettingsChanged\s*-=\s*HandleDisplaySettingsChanged/.test(mainWindow)
    && /ScheduleDisplayRecovery\("startup display backoff"\)/.test(mainWindow)
    && /ScheduleDisplayRecovery\("display topology changed"\)/.test(mainWindow)
    && /TryRecoverDisplayPlacementAsync/.test(mainWindow)
    && /ApplyWaitingForEdgeWindow/.test(mainWindow)
    && /RestoreDisplayWindowToTaskbar/.test(mainWindow)
    && /_waitingForEdgeDisplay/.test(mainWindow)
    && /edgeCandidateCount == 0/.test(mainWindow)
    && /\$trigger\.Delay\s*=\s*"PT20S"/.test(installScript),
  "reboot display recovery must delay startup, retry non-persistent placement, and avoid fullscreen takeover when the EDGE display is absent"
);

assert(
  /File\.AppendAllText/.test(hostLogger)
    && /File\.AppendAllText[\s\S]*TrimLogFile\(\)/.test(hostLogger)
    && /MaxLogBytes/.test(hostLogger)
    && /MaxLogLines/.test(hostLogger),
  "host logging must trim rolling files after writes, not only on startup"
);

assert(
  /case "\/api\/game\/performance" when request\.HttpMethod == "GET":[\s\S]*?_gameController\.GetPerformance/.test(apiRouter)
    && /case "\/api\/game\/performance\/session" when request\.HttpMethod == "POST":[\s\S]*?_gameController\.EnsurePerformanceSession/.test(apiRouter)
    && /public GamePerformanceSnapshot EnsureSession/.test(gamePerformanceService),
  "Game Mode FPS capture must split POST session mutation from GET performance reads"
);

assert(
  /case "\/api\/game\/session" when request\.HttpMethod == "POST"/.test(apiRouter)
    && /GameModeSessionService/.test(bridgeManager)
    && /GetSnapshotAsync\(GameModeSessionRequest/.test(gameModeSessionService)
    && /CollectorTimings/.test(gameModeSessionService)
    && /OverBudget/.test(gameModeSessionService)
    && /refreshGameModeSession/.test(gameModeWidget)
    && /\/api\/game\/session/.test(gameModeWidget)
    && /createTimerLoop\(function \(\) \{[\s\S]*refreshGameModeSession/.test(gameModeWidget)
    && !/var systemLoop = createTimerLoop/.test(gameModeWidget)
    && !/var performanceLoop = createTimerLoop/.test(gameModeWidget),
  "Game Mode must use one budgeted native session snapshot instead of independent UI polling loops"
);

assert(
  /CacheDuration\s*=\s*TimeSpan\.FromSeconds\(6\)/.test(gameActivityService)
    && /WmiProcessScanCooldown\s*=\s*TimeSpan\.FromSeconds\(30\)/.test(gameActivityService)
    && /_lastWmiProcessScanAt/.test(gameActivityService)
    && /inaccessibleProcessModules > 0/.test(gameActivityService)
    && /AddWmiProcesses\(results\)/.test(gameActivityService),
  "Game activity scans must use a longer cache and throttle WMI fallback to avoid constant process churn"
);

assert(
  /PruneTelemetryFiles/.test(gamePerformanceService)
    && /MaxTelemetryDirectoryBytes/.test(gamePerformanceService)
    && /MaxTelemetryFileAge/.test(gamePerformanceService)
    && /GameTelemetryDiagnosticsRetention/.test(gamePerformanceService)
    && /CleanupCaptureFile/.test(gamePerformanceService)
    && /TryDeleteFile/.test(gamePerformanceService),
  "PresentMon FPS telemetry files must be deleted or size/age capped unless diagnostics retention is enabled"
);

assert(
  /\[JsonIgnore\][\s\S]*ProcessId/.test(gameActivityService)
    && /\[JsonIgnore\][\s\S]*ExecutablePath/.test(gameActivityService)
    && /HasRuntimeIdentity/.test(gameActivityService)
    && /CanPin/.test(gameActivityService)
    && /foregroundAppActive/.test(gameModeWidget)
    && !/data-process-id/.test(gameModeWidget),
  "Game activity API must keep raw PIDs and executable paths out of default JSON while preserving capability flags"
);

assert(
  /steam-library-index\.json/.test(steamService)
    && /BuildManifestSignatures/.test(steamService)
    && /TryReadLibraryIndex/.test(steamService)
    && /SaveLibraryIndex/.test(steamService)
    && /ResolveRunningGame\(games\)/.test(steamService),
  "Steam scans must persist a manifest index and separate active-process checks from full library refresh"
);

assert(
  /NetworkConfig/.test(appConfig)
    && /HealthTarget/.test(appConfig)
    && /UpdateNetwork/.test(configController)
    && /case "\/api\/config\/network" when request\.HttpMethod == "POST"/.test(apiRouter)
    && /Interlocked\.Exchange\(ref _pingSampling,\s*1\)/.test(networkMetricsService)
    && /ResolveHealthTarget/.test(networkMetricsService)
    && /ResolvePingDelay/.test(networkMetricsService)
    && !/SendPingAsync\("1\.1\.1\.1"/.test(networkMetricsService),
  "network health checks must be configurable, prefer local targets, and guard against overlapping ping samples"
);

assert(
  /MediaMetadataVisible/.test(appConfig)
    && /AudioSessionLabelsVisible/.test(appConfig)
    && /MediaMetadataVisible/.test(mediaService)
    && /AudioSessionLabelsVisible/.test(audioService)
    && /DefaultInputDeviceId/.test(audioService)
    && /InputMuted/.test(audioService)
    && /SetInputMuteAsync/.test(audioService)
    && /case "\/api\/audio\/input-mute" when request\.HttpMethod == "POST"/.test(apiRouter)
    && /SetAudioInputMuteAsync/.test(telemetryController)
    && /metadataRedacted/.test(supportController)
    && /sessionsRedacted/.test(supportController),
  "audio/media APIs must expose minimal mic controls while support bundles minimize private listening/watching context by default"
);

assert(
  /NeedsAdmin/.test(gamePerformanceService)
    && /RestartAsAdminEndpoint/.test(gamePerformanceService)
    && /--restart_as_admin/.test(gamePerformanceService)
    && /_captureNeedsAdminRestart/.test(gamePerformanceService)
    && /_captureUsesElevatedBootstrap\s*=\s*false/.test(gamePerformanceService)
    && /--process_name/.test(gamePerformanceService)
    && /ResolveCaptureTargetName/.test(gamePerformanceService)
    && /AnalyzeCaptureRows/.test(gamePerformanceService)
    && /TimeInSeconds/.test(gamePerformanceService)
    && /ElevatedBootstrapGrace/.test(gamePerformanceService)
    && /Waiting for Windows to approve elevated FPS capture/.test(gamePerformanceService)
    && /Windows is still waiting for elevated FPS capture approval/.test(gamePerformanceService)
    && /RestartHostAsAdministrator/.test(actionController)
    && /case "\/api\/system\/restart-admin" when request\.HttpMethod == "POST"/.test(apiRouter)
    && /--wait-for-previous-instance/.test(systemActionsService)
    && /WaitForPreviousInstance/.test(appLaunchOptions)
    && /TryAcquireInstanceMutex\(LaunchOptions\.WaitForPreviousInstance\)/.test(programCs)
    && /PreviousInstanceExitWait/.test(programCs)
    && /restart-game-admin/.test(gameModeWidget)
    && /Fix FPS \(admin\)/.test(gameModeWidget)
    && /performanceSession:\s*options\.performanceSession === true/.test(gameModeWidget)
    && !/performanceSession:\s*options\.performanceSession !== false/.test(gameModeWidget)
    && /function\s+gameFocusCanFixFps/.test(gameModeWidget)
    && /Telemetry readiness/.test(gameModeWidget),
  "Game Mode telemetry readiness must expose FPS source, elevated PresentMon capture, admin capture state, and an elevated restart action"
);

assert(
  gameFocusPatchBody
    && /performanceRestarting/.test(gameFocusPatchBody[0])
    && !/\bstate\./.test(gameFocusPatchBody[0]),
  "Game Mode focus patcher must not reference widget state outside its closure during mute/redraw refreshes"
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
  /renderGameFocusHudItem\("FPS"[\s\S]*renderGameFocusHudItem\("Audio"[\s\S]*renderGameFocusHudItem\("Mic"[\s\S]*renderGameFocusHudItem\("Network"[\s\S]*renderGameFocusHudItem\("Pressure"/.test(gameModeWidget)
    && /game-focus-mic-toggle/.test(gameModeWidget)
    && /\/api\/audio\/input-mute/.test(gameModeWidget)
    && /GAME_FOCUS_TOUCH_GRASS_MS/.test(gameModeWidget)
    && /Go touch grass/.test(gameModeWidget)
    && /game-focus-card--art/.test(gameModeWidget)
    && /game-focus-card--session/.test(gameModeWidget)
    && !/renderGameFocusHudItem\("Main FPS"|renderGameFocusHudItem\("Frame"|renderGameFocusHudItem\("Ping"|frame-time|game-focus-top-status|game-focus-status-grid|game-focus-footer|renderGameFocusFact|gameFocusStateLabel|gameFocusVoiceLabel|<span>Match/.test(gameModeWidget)
    && !/game-focus-top-status|game-focus-status-grid|game-focus-footer|game-focus-fact/.test(readWorkspaceFile("css/widgets/game-mode.css")),
  "active Game Mode HUD must keep FPS, Audio, Mic, Network, Pressure, larger artwork, and the separate 3-hour session nudge without duplicate state, frame, ping, footer, or utility status panels"
);

assert(
  /"ms-teams"/.test(gameActivityService)
    && /"msteams"/.test(gameActivityService)
    && /LauncherProcessNames/.test(gameActivityService)
    && /LauncherExecutablePathFragments/.test(gameActivityService)
    && /"galaxyclient"/.test(gameActivityService)
    && /"galaxycommunication"/.test(gameActivityService)
    && /"gog galaxy notifications renderer"/.test(gameActivityService)
    && /"steamservice"/.test(gameActivityService)
    && /"epicgameslauncher"/.test(gameActivityService)
    && /"riotclientservices"/.test(gameActivityService)
    && /IgnoredExecutablePathFragments/.test(gameActivityService)
    && /ContainsGameKeyword/.test(gameActivityService)
    && /ContainsKeywordWithBoundaries/.test(gameActivityService)
    && !/GameKeywordFragments\.Any\(fragment\s*=>\s*combined\.Contains/.test(gameActivityService)
    && !/GameKeywordFragments\.Any\(fragment\s*=>\s*lowerPath\.Contains/.test(gameActivityService),
  "Game activity detection must ignore Teams/comms apps and launcher processes while matching game keywords with token boundaries"
);

assert(
  /Pinned game/.test(gameActivityService)
    && /Recent app candidate/.test(gameActivityService)
    && /confidence:\s*knownGamePath \|\| explicitGamePin \? 78 : 55/.test(gameActivityService)
    && /confidence:\s*knownGamePath \|\| explicitGamePin \? 68 : 55/.test(gameActivityService)
    && /IsExplicitGamePin/.test(gameActivityService)
    && !/foreach\s*\(var blizzardName in new\[\]/.test(gameActivityService),
  "Game activity keyword-only matches must stay below the active threshold while explicit game pins and known library paths can activate"
);

assert(
  /function\s+reportBackgroundDashboardError/.test(dashboardJs)
    && unhandledRejectionHandler
    && /reportBackgroundDashboardError/.test(unhandledRejectionHandler[0])
    && !/reportFatalDashboardError/.test(unhandledRejectionHandler[0])
    && /scheduleFatalDashboardReload/.test(dashboardJs)
    && /window\.location\.reload/.test(dashboardJs),
  "dashboard background promise failures must not replace the whole UI, while fatal panels self-heal"
);

assert(
  /function\s+restorePreGamePerformanceBudget/.test(dashboardJs)
    && /preGameBudget/.test(dashboardJs)
    && /values\.preGameBudget = currentBudget/.test(gameModeWidget)
    && /function\s+getNowStripRefreshInterval/.test(dashboardJs)
    && /function\s+getLauncherDockRefreshInterval/.test(dashboardJs)
    && /scheduleNowPlayingStripLoop/.test(dashboardJs)
    && /scheduleLauncherDockLoop/.test(dashboardJs)
    && /launcherDockRenderKey/.test(dashboardJs)
    && /currentWidgetId === "game-mode"/.test(dashboardJs),
  "dashboard must restore pre-game performance budget and make now-strip/launcher dock polling budget-aware"
);

assert(
  /input\[type="range"\]:focus-visible/.test(readWorkspaceFile("css/widgets.css"))
    && /aria-label="Display brightness"/.test(actionsWidget)
    && /aria-label="Master volume"/.test(audioWidget)
    && /aria-label="Dashboard opacity"/.test(dashboardJs)
    && /aria-label="Brightness for/.test(homelabWidget)
    && /aria-label="Brightness for/.test(integrationsWidget)
    && /aria-label="Animation intensity"/.test(productWidget)
    && /aria-pressed/.test(dashboardJs),
  "generated range controls must keep accessible names and a visible keyboard focus baseline"
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
    && !/runtime\.registerRenderer\("launchers"/.test(actionsWidget)
    && /id="dashboard-launcher-dock"/.test(readWorkspaceFile("dashboard.html"))
    && /data-launcher-dock-action="toggle-expanded"/.test(dashboardJs)
    && /dashboard-native-page--launcher-dock-expanded/.test(readWorkspaceFile("css/widgets.css"))
    && /runtime\.registerRenderer\("quick-actions",\s*mountQuickActionsWidget\)/.test(actionsWidget)
    && /runtime\.registerRenderer\("shortcuts",\s*mountSystemShortcutsWidget\)/.test(actionsWidget)
    && /runtime\.registerRenderer\("clipboard",\s*mountClipboardWidget\)/.test(actionsWidget)
    && !/mountLaunchersWidget/.test(inlineWidgets)
    && !/mountQuickActionsWidget/.test(inlineWidgets)
    && !/mountSystemShortcutsWidget/.test(inlineWidgets)
    && !/mountClipboardWidget/.test(inlineWidgets)
    && !/inline-action-grid|inline-launcher-grid|inline-clipboard-preview/.test(readWorkspaceFile("css/widgets.css")),
  "Launcher dock, quick action, shortcut, and clipboard JS/CSS must stay split from the shared inline widget runtime"
);

assert(
  /ClipboardHidePreviews/.test(appConfig)
    && /ClipboardWidgetPaused/.test(appConfig)
    && /ClipboardExcludeFromDiagnostics/.test(appConfig)
    && /ClipboardPrivacyOptions/.test(clipboardHistoryService)
    && /PreviewHidden/.test(clipboardHistoryService)
    && /RedactClipboardEntries/.test(supportController)
    && /toggle-hide-previews/.test(actionsWidget)
    && /toggle-pause-widget/.test(actionsWidget)
    && /toggle-exclude-diagnostics/.test(actionsWidget),
  "clipboard widget must expose privacy controls and diagnostics must redact entries/previews"
);

assert(
  /css\/widgets\/setup\.css\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /js\/widgets\/setup\.js\?v=/.test(readWorkspaceFile("dashboard.html"))
    && /runtime\.registerRenderer\("setup",\s*mountSetupWidget\)/.test(setupWidget)
    && /runtime\.registerRenderer\("calendar",\s*mountCalendarWidget\)/.test(setupWidget)
    && /icsUrlConfigured/.test(setupWidget)
    && /icsHost/.test(setupWidget)
    && /Paste a new feed to replace/.test(setupWidget)
    && !/calendarConfig\.icsUrl\b/.test(setupWidget)
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
  /HashStatus/.test(releaseService)
    && /SignatureStatus/.test(releaseService)
    && /BuildReleaseTrust/.test(releaseService)
    && /Verify Windows signing policy/.test(releaseWorkflow)
    && /Public stable releases require a valid Authenticode signature/.test(releaseWorkflow)
    && /signature-status\.txt/.test(releaseWorkflow)
    && /hashStatus/.test(productWidget)
    && /signatureStatus/.test(productWidget),
  "release payloads and CI must surface/enforce installer hash and signature status"
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
