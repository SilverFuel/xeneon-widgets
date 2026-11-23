// Release-only source-text guards.
//
// Every assertion here reads a source file as text. They were moved, unchanged
// in meaning, out of scripts that now run in the everyday `npm run check`
// (check-ui-remediation, check-camera-detection) or that were retired
// (check-dashboard-visual-a11y). They cover native C#, standalone widget pages
// and release documents, which the Phase 1 test diet left alone.
//
// Do not add to this file. New protection belongs in a behaviour test: run the
// code or render the page. When a phase changes code a guard here pins, replace
// that guard with a behaviour test instead of editing the regex. See docs/TESTS.md.
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// --- Native routes and trust boundaries (from check-dashboard-visual-a11y) ---
{
  const apiRouter = read("app/Controllers/ApiRouter.cs");
  const telemetryController = read("app/Controllers/TelemetryController.cs");
  const supportController = read("app/Controllers/SupportController.cs");
  const configController = read("app/Controllers/ConfigController.cs");
  const sceneService = read("app/Services/SceneService.cs");

  assert(
    /Manual selection/.test(sceneService)
      && /Automatic \{match\.Rule\.Type\} rule/.test(sceneService)
      && /case "\/api\/scenes\/activate"/.test(apiRouter),
    "native Modes must report manual and automatic activation and expose the activate route"
  );

  assert(
    /foregroundAppTrackingEnabled/.test(configController),
    "the config API must expose the foreground app tracking privacy setting"
  );

  assert(
    /displayDiagnostics\.Status,\s*"ready"/.test(telemetryController)
      && /essentialsReady\s*=\s*string\.Equals\(displayDiagnostics\.Status,\s*"ready"/.test(telemetryController)
      && /state\s*=\s*string\.Equals\(display\.Status,\s*"ready"/.test(supportController),
    "native display diagnostics must report readiness from the saved display status"
  );

  assert(
    /case "\/api\/config" when request\.HttpMethod == "GET"/.test(apiRouter)
      && /case "\/api\/system":[\s\S]*?_telemetryController\.GetSystemSnapshot/.test(apiRouter)
      && /case "\/api\/network":[\s\S]*?_telemetryController\.GetNetworkSnapshot/.test(apiRouter)
      && /case "\/api\/audio" when request\.HttpMethod == "GET"/.test(apiRouter)
      && /case "\/api\/unifi\/network":[\s\S]*?_telemetryController\.GetUniFiNetworkAsync/.test(apiRouter)
      && /case "\/api\/game\/performance\/session" when request\.HttpMethod == "POST"/.test(apiRouter)
      && /case "\/api\/system\/restart-admin" when request\.HttpMethod == "POST"/.test(apiRouter)
      && /GetDisplayDiagnostics/.test(configController)
      && /GetNetworkSnapshot/.test(telemetryController),
    "native API routes for config, telemetry, UniFi and Game Mode must stay wired through controllers"
  );
}

// --- Camera Detection: native connector, standalone panel, receipts (from check-camera-detection) ---
{
  const model = read("app/Models/AppConfig.cs");
  const configStore = read("app/Infrastructure/ConfigStore.cs");
  const networkGuard = read("app/Infrastructure/NetworkEndpointGuard.cs");
  const service = read("app/Services/FrigateService.cs");
  const router = read("app/Controllers/ApiRouter.cs");
  const bridge = read("app/BridgeManager.cs");
  const configController = read("app/Controllers/ConfigController.cs");
  const localDataReset = read("app/Services/LocalDataResetService.cs");
  const telemetry = read("app/Controllers/TelemetryController.cs");
  const panel = read("widgets/frigate-detection-panel.html");
  const tests = read("app/tests/FrigateServiceTests.cs");
  const receiptVerifier = read("scripts/Test-FrigateQualificationReceipt.ps1");
  const receiptFixtures = read("scripts/test-frigate-qualification-receipt.ps1");
  const certification = read("docs/release/FRIGATE-CERTIFICATION.md");

  assert(/public FrigateConfig Frigate/.test(model) && /class FrigateConfigRequest/.test(model), "Frigate configuration model and request are required");
  assert(/normalized\.Frigate \?\?= new FrigateConfig/.test(configStore) && /NormalizeFrigateCamera/.test(configStore), "Frigate config must be normalized during every persistence path");
  assert(/frigate\.password/.test(configStore) && /config\.Frigate\.Password = ""/.test(configStore), "Frigate passwords must use protected storage and stay out of config.json");
  assert(/NormalizeLocalHttpBaseUrl/.test(networkGuard) && /ConnectLocalHttpHostAsync/.test(networkGuard), "Frigate destinations must be restricted to local/private HTTP(S)");
  assert(/addresses\.Any\(address => !IsLocalOrPrivateAddress\(address\)\)/.test(networkGuard), "Frigate connection-time DNS results must fail closed outside the local network");
  assert(/MaxEventsResponseBytes/.test(service) && /MaxSnapshotResponseBytes/.test(service), "Frigate events and images must have response-size limits");
  assert(/api\/login/.test(service) && /AuthenticationHeaderValue\("Bearer"/.test(service) && /StatusCode != HttpStatusCode\.Unauthorized/.test(service), "Frigate authenticated API access must login, send the bearer token, and reauthenticate once after HTTP 401");
  assert(/Authenticated Frigate connections require HTTPS/.test(service) && /ValidateAuthenticationTransport/.test(configController), "authenticated Frigate credentials must never cross a non-loopback plaintext HTTP connection");
  assert(/false_positive/.test(service) && /has_snapshot/.test(service) && /api\/events/.test(service), "Frigate event normalization must use the official event fields");
  assert(/NormalizeEventId/.test(service) && /AllowedImageTypes/.test(service), "Frigate snapshots must validate event IDs and image types");
  assert(/EventLookback/.test(service) && /MaximumFutureClockSkew/.test(service) && /entry\.Camera\.Equals\(camera, StringComparison\.OrdinalIgnoreCase\)/.test(service), "Frigate responses must be filtered locally to the configured camera and truthful time window");
  assert(/current\.Alerts\.Any\(entry => entry\.HasSnapshot/.test(service) && /current filtered Camera Detection results/.test(service), "snapshot proxy access must be bound to a current event allowed by the configured camera filter");
  assert(/authentication succeeded without returning a usable token/.test(service), "authenticated Frigate must fail closed when login returns no usable token");
  assert(/case "\/api\/frigate"/.test(router) && /case "\/api\/frigate\/test"/.test(router) && /case "\/api\/frigate\/snapshot"/.test(router) && /case "\/api\/config\/frigate"/.test(router), "native Frigate API, connection test, snapshot, and config routes are required");
  assert(/private, no-store/.test(router), "camera snapshots must not be stored in the browser cache");
  assert(/catch \(FrigateSnapshotUnavailableException error\)/.test(router) && /WriteJsonAsync\(response, 404/.test(router), "invalid or filter-bypassing snapshot requests must return a non-proxying not-found response");
  assert(/CreateFrigateHttpHandler/.test(bridge) && /ConnectCallback = NetworkEndpointGuard\.ConnectLocalHttpAsync/.test(bridge), "production Frigate HTTP must use the local-network connector");
  assert(/UseCookies = true/.test(bridge) && /CookieContainer = new CookieContainer/.test(bridge), "production Frigate authentication must retain secure login cookies");
  assert(/UpdateFrigate/.test(configController) && /localOnly = true/.test(configController), "Frigate config must be exposed as an explicit local-only integration");
  assert(/frigate = true/.test(telemetry) && /\["frigate"\] = frigateItem/.test(telemetry), "health must publish Frigate capability and truthful optional setup state");
  assert(/GetConnectionStatus\(config\)/.test(telemetry) && /connected = frigateConnection\.Connected/.test(telemetry), "health must distinguish saved Frigate settings from a verified live connection");
  assert(/shouldPause:\s*function \(\) \{\s*return Boolean\(lastData && !lastData\.configured\);/.test(panel) && /Math\.max\(30000, getNumberParam\("refresh", 30000\)\)/.test(panel), "standalone Camera Detection must also stop automatic requests while unconfigured");
  assert(!/native connector is added/i.test(panel), "Camera Detection must not claim its implemented native connector is still missing");
  assert(/Seen cameras/.test(panel) && /recent/.test(panel), "Frigate event history must not be mislabeled as active alerts");
  assert(/LocalConnectionBoundary_RejectsDnsRebinding/.test(tests) && /Events_MapsOfficialFrigatePayload/.test(tests), "camera connector regressions must cover DNS rebinding and event mapping");
  assert(/Events_AuthenticatesWithFrigateAndUsesReturnedBearerToken/.test(tests) && /Events_ReauthenticatesOnceWhenFrigateTokenExpires/.test(tests), "camera connector regressions must cover authenticated Frigate and token renewal");
  assert(/ConcurrentExpiredRequests_ShareOneTokenRenewal/.test(tests) && /_authenticationGeneration != rejectedGeneration/.test(service), "concurrent expired Camera Detection requests must share one token renewal");
  assert(/ClearSensitiveState/.test(service) && /_bearerToken = ""/.test(service) && /_cachedPayload = null/.test(service), "Camera Detection must clear in-memory authentication and detection state");
  assert(/_sensitiveStateCancellation/.test(service) && /CancelAndDisposeAsync\(priorCancellation\)/.test(service) && !/_authenticationLock\.Wait\(\)/.test(service), "Camera Detection state clearing must cancel old requests without waiting for an in-flight login");
  assert(/_clearFrigateRuntimeState\?\.Invoke\(\)/.test(configController) && /_clearIntegrationRuntimeState\?\.Invoke\(\)/.test(localDataReset) && (bridge.match(/_frigateService\.ClearSensitiveState/g) || []).length >= 2, "Camera removal and local-data reset must purge Camera Detection runtime state");
  assert(/ClearSensitiveState_DropsTokenCacheDetectionCacheAndConnectionReceipt/.test(tests), "Camera runtime-state clearing must force fresh authentication and event reads");
  assert(/ClearSensitiveState_CancelsInFlightAuthenticationWithoutBlockingConfigMutation/.test(tests), "Camera runtime-state clearing must prove in-flight credential use is cancelled without blocking configuration changes");
  assert(/Events_EnforcesConfiguredCameraAndOneHourWindowLocally/.test(tests) && /EventSnapshot_RejectsEventOutsideCurrentFilteredResults/.test(tests), "camera connector regressions must cover hostile upstream filter responses and snapshot filter bypass attempts");
  assert(/Events_RejectsSuccessfulAuthenticationWithoutToken/.test(tests), "camera connector regressions must cover empty-token authentication responses");
  assert(/physicalFrigateServer/.test(receiptVerifier) && /realCamera/.test(receiptVerifier) && /windowsTrustedTls/.test(receiptVerifier), "physical Frigate receipts must fail closed on fixtures and untrusted authentication transport");
  assert(/installerFileName/.test(receiptVerifier) && /installerSha256/.test(receiptVerifier) && /release-manifest\.json/.test(receiptVerifier), "Frigate qualification evidence must bind the exact release candidate");
  assert(/Assert-NoSecrets/.test(receiptVerifier) && /disconnectDetected/.test(receiptVerifier) && /reconnectRecovered/.test(receiptVerifier), "Frigate receipts must reject secrets and require recovery evidence");
  assert(/secret-bearing receipt/.test(receiptFixtures) && /plaintext authenticated endpoint/.test(receiptFixtures) && /stale event/.test(receiptFixtures), "Frigate receipt fixtures must exercise secret, transport, and freshness rejection");
  assert(/Qualification sequence/.test(certification) && /(?:expire|revoke).+Frigate session/i.test(certification) && /events from a different camera/i.test(certification), "Frigate certification must cover authentication renewal and camera filtering on physical hardware");
  assert(/ConnectionTest_ReportsReadyAfterAuthenticatedEventsRequest/.test(tests) && /ConnectionTest_PreservesSettingsAndReportsRejectedCredentials/.test(tests), "camera connector regressions must cover truthful connection success and saved-setting failure states");
}

// --- Native Modes, privacy-safe telemetry and standalone widget pages (from check-ui-remediation) ---
{
  const sceneService = read("app/Services/SceneService.cs");
  const systemMetrics = read("app/Services/SystemMetricsService.cs");
  const appConfig = read("app/Models/AppConfig.cs");
  const configStore = read("app/Infrastructure/ConfigStore.cs");
  const configController = read("app/Controllers/ConfigController.cs");
  const bridgeManager = read("app/BridgeManager.cs");
  const supportController = read("app/Controllers/SupportController.cs");
  const standaloneSystem = read("widgets/system-monitor.html");
  const standaloneSetup = read("widgets/setup-guide.html");
  const standaloneAudio = read("widgets/audio-output-panel.html");
  const standaloneCalendar = read("widgets/calendar-widget.html");
  const standaloneNetwork = read("widgets/network-widget.html");
  const standaloneHue = read("widgets/philips-hue-panel.html");
  const standaloneWeather = read("widgets/weather-widget.html");
  const standaloneAutomation = read("widgets/home-automation-panel.html");
  const standaloneNas = read("widgets/nas-storage-monitor.html");
  const standalonePlex = read("widgets/plex-server-monitor.html");

  assert(!/Process\.GetProcesses|TopProcesses|SystemProcessSnapshot/.test(systemMetrics), "System telemetry must not enumerate or expose running applications");
  assert(!/topProcesses|Top apps right now|What is using resources\?|PID /.test(standaloneSystem), "System Monitor must not render application or process identity");
  assert(/<h1>Diagnostics<\/h1>/.test(standaloneSetup) && !/Auto setup & diagnostics|Auto ready/.test(standaloneSetup), "standalone Diagnostics must use the same stable name and omit the obsolete disabled completion control");
  assert(/id="finish-setup-slot"/.test(standaloneSetup) && /finishSlot\.appendChild\(finishButton\)/.test(standaloneSetup), "standalone Diagnostics must render manual completion only when it is actionable");
  assert(!/Copy embed|Copy URL|guide-iframe-snippet|dashboardUrl|renderSnippets|copyText/.test(standaloneSetup), "standalone Diagnostics must not expose developer embed controls or a self-referential display URL");
  assert(/params\.get\("endpoint"\) \|\| "\/api\/calendar"/.test(standaloneCalendar) && !/Sprint standup|Design sync|Benchmarks|Publish to GitHub Pages/.test(standaloneCalendar), "standalone Calendar must use the native calendar service and never present fake sample meetings");
  assert(/params\.get\("endpoint"\) \|\| "\/api\/network"/.test(standaloneNetwork), "standalone Network must use the native network service by default");
  assert(/params\.get\("endpoint"\) \|\| "\/api\/system"/.test(standaloneSystem) && /params\.get\("gpuPowerEndpoint"\) \|\| "\/api\/gpu-power"/.test(standaloneSystem), "standalone System Monitor must use native system and GPU telemetry by default");
  assert(!/current\.deviceType \|\| current\.id/.test(standaloneAudio) && /label\(current\.deviceType, "Windows default device"\)/.test(standaloneAudio), "standalone Audio must never expose a raw Windows device identifier as user-facing copy");
  assert(/\.action-button\s*\{\s*min-height:\s*44px;/.test(standaloneHue), "standalone Hue actions must meet the 44px touch-target minimum");
  assert(/\.action-button:focus-visible,[\s\S]*?\.toggle-button:focus-visible[\s\S]*?outline:\s*3px solid var\(--theme-focus-ring\)/.test(standaloneHue), "standalone Hue controls must retain a 3px theme-aware keyboard focus indicator");
  assert(/\.field input:focus-visible,[\s\S]*?\.field select:focus-visible[\s\S]*?outline:\s*3px solid var\(--theme-focus-ring\)/.test(standaloneSetup), "standalone Diagnostics fields must retain a 3px theme-aware keyboard focus indicator");
  assert(/id="volume"[^>]*aria-label="Master volume"/.test(standaloneAudio), "standalone Audio master-volume slider must expose an accessible name");
  assert(/data-action="brightness"[^>]*aria-label="Light brightness for ' \+ escapeHtml\(light\.name\)/.test(standaloneAutomation), "standalone Home Automation brightness sliders must include the light name");
  assert(/data-action="brightness-light"[^>]*aria-label="Light brightness for ' \+ escapeHtml\(light\.name\)/.test(standaloneHue)
    && /data-action="brightness-group"[^>]*aria-label="Room brightness for ' \+ escapeHtml\(group\.name\)/.test(standaloneHue), "standalone Hue brightness sliders must include the light or room name");
  assert(/id="download-detail"[^>]*>Live throughput<\/div>/.test(standaloneNetwork)
    && /estimated:\s*Boolean\(connection\)/.test(standaloneNetwork)
    && /download:\s*downlink === null \? null : downlink \* 1000 \* 1000 \/ 8/.test(standaloneNetwork)
    && /snapshot\.estimated \? "Browser connection estimate"/.test(standaloneNetwork)
    && /snapshot\.estimated \? "Not reported by browser"/.test(standaloneNetwork), "standalone Network must distinguish browser connection estimates from live throughput");
  for (const [name, source] of [["Home Automation", standaloneAutomation], ["NAS", standaloneNas], ["Plex", standalonePlex]]) {
    assert(/html\[data-size="large"\][\s\S]*?overflow-y:\s*auto/.test(source)
      && /\[data-size="large"\] body,[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible/.test(source)
      && /\[data-size="large"\] \.widget,[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*calc\(100vh - 20px\)/.test(source)
      && /\[data-size="large"\] \.layout,[\s\S]*?height:\s*auto/.test(source), `${name} responsive standalone layout must grow and remain vertically scrollable`);
  }
  assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.toggle-button,[\s\S]*?\.scene-button[\s\S]*?transition:\s*none/.test(standaloneAutomation), "standalone Home Automation controls must honor reduced motion");
  for (const [name, source] of [["Calendar", standaloneCalendar], ["System Monitor", standaloneSystem], ["Weather", standaloneWeather]]) {
    assert(!/fonts\.googleapis|fonts\.gstatic/.test(source), `${name} standalone fallback must not depend on CSP-blocked remote fonts`);
  }
  for (const [name, source] of [["app config", appConfig], ["config normalization", configStore], ["config API", configController], ["display selection", bridgeManager], ["support API", supportController]]) {
    assert(!/UpdateRollbackEnabled|updateRollbackEnabled|LastKnownGood|lastKnownGood|RollbackEnabled|rollbackEnabled/.test(source), `${name} must not retain unusable automatic-rollback metadata`);
  }
  assert(/\.Where\(scene => !string\.Equals\(scene\.ThemeVariant, "night", StringComparison\.OrdinalIgnoreCase\)\)/.test(sceneService), "Night display variants must remain separate from the native base Mode profile inventory");
  assert(/ThemeVariant = config\.Scenes\.ThemeVariant/.test(sceneService) || !/config\.Scenes\.ThemeVariant = "standard";[\s\S]{0,120}Automatic switching resumed/.test(sceneService), "resuming Mode automation must preserve Night");
  assert(/SetDisplayAssignment[\s\S]*?string\.IsNullOrWhiteSpace\(normalizedSceneId\)[\s\S]*?RemoveAll/.test(sceneService), "empty sceneId must support display unassignment");
  assert(/manualOverrideActive/.test(sceneService) && /automaticSwitchingActive/.test(sceneService), "Mode snapshot must expose truthful automation state");
}
