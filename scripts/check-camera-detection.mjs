import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

function read(relativePath) {
  const path = resolve(process.cwd(), relativePath);
  if (!existsSync(path)) {
    throw new Error(`camera detection contract file is missing: ${relativePath}`);
  }
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const model = read("app/Models/AppConfig.cs");
const configStore = read("app/Infrastructure/ConfigStore.cs");
const networkGuard = read("app/Infrastructure/NetworkEndpointGuard.cs");
const service = read("app/Services/FrigateService.cs");
const router = read("app/Controllers/ApiRouter.cs");
const bridge = read("app/BridgeManager.cs");
const configController = read("app/Controllers/ConfigController.cs");
const localDataReset = read("app/Services/LocalDataResetService.cs");
const telemetry = read("app/Controllers/TelemetryController.cs");
const dashboard = read("js/dashboard.js");
const integrations = read("js/widgets/integrations.js");
const setup = read("js/widgets/setup.js");
const inlineWidgets = read("js/inline-widgets.js");
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
assert(/id: "frigate"/.test(dashboard) && /frigate-detection-panel\.html/.test(dashboard), "Camera Detection must be registered in the production dashboard");
assert(!/hidden until configured/i.test(dashboard), "Camera Detection copy must not contradict its discoverable setup state");
assert(/widget\.id === "frigate"/.test(dashboard) && /return isWidgetSupported\(widget\.id\)/.test(dashboard), "supported Camera Detection must remain discoverable before configuration");
assert(/frigateState === "Optional" \? "Setup" : frigateState/.test(dashboard), "unconfigured Camera Detection must publish an actionable Setup state");
assert(/primaryDestination = preferredWidget\.destination \|\| "home"/.test(dashboard), "explicit Camera Detection routes must switch to the widget's owning navigation destination");
assert(/persistWidgetChoice\(currentWidgetId\);\s*renderPrimaryNavigation\(\);/.test(dashboard), "hydrated deep links must repaint the owning navigation destination");
assert(/registerRenderer\("frigate", mountFrigateWidget\)/.test(integrations) && /\/api\/frigate/.test(integrations), "Camera Detection must have a native production renderer backed by the Frigate API");
assert(/inline-camera-preview/.test(integrations) && /Recent detections/.test(integrations), "Camera Detection must render a snapshot and recent event history");
assert(/Cached after connection loss/.test(integrations) && /last successful local update/.test(integrations), "Camera Detection must label retained events as cached after a failed refresh");
assert(/data\.sampledAt \? "Fresh Frigate sample" : \(data\.configured \? "Waiting for connection" : "Waiting for setup"\)/.test(integrations), "Camera Detection must never label a missing sample as fresh");
assert(/if \(action === "refresh"\) \{\s*loop\.refresh\(\);/.test(integrations), "Camera Detection manual and automatic refreshes must share one serialized loop");
assert(/createTimerLoop\(refresh, 30000, function \(\) \{\s*return !state\.data\.configured;/.test(integrations), "Camera Detection must pause background polling until it is configured while keeping manual Refresh immediate");
assert(/refresh:\s*"30000"/.test(dashboard), "legacy Camera Detection route must use the same 30-second cadence as the inline runtime");
assert(/shouldPause:\s*function \(\) \{\s*return Boolean\(lastData && !lastData\.configured\);/.test(panel) && /Math\.max\(30000, getNumberParam\("refresh", 30000\)\)/.test(panel), "standalone Camera Detection must also stop automatic requests while unconfigured");
assert(/refresh: function \(\) \{\s*return state\.data\.configured \? loop\.refresh\(\) : Promise\.resolve\(\);/.test(integrations), "dashboard health refreshes must not bypass the unconfigured Camera Detection polling pause");
assert(/Set up Camera Detection/.test(integrations) && /env\.openSetupSection\("frigate"\)/.test(integrations), "Camera Detection must request its exact Diagnostics setup section");
assert(/if \(!data\.configured\)[\s\S]*?data-frigate-setup-state[\s\S]*?Camera Detection needs setup/.test(integrations), "unconfigured Camera Detection must render one focused setup state");
assert(/if \(!data\.configured\)[\s\S]*?return productShell[\s\S]*?Set up Camera Detection[\s\S]*?Refresh/.test(integrations), "unconfigured Camera Detection must keep explicit setup and manual refresh actions");
assert(!/Camera Detection stay hidden until you ask for them/.test(setup), "Diagnostics must not claim discoverable Camera Detection is hidden");
assert(/requestedSetupSection: requestedSetupSection/.test(dashboard) && /openSetupSection: openSetupSection/.test(dashboard), "the dashboard must pass targeted setup requests into the mounted Diagnostics panel");
assert(/showOptional: \["weather", "calendar", "hue", "frigate"\]\.indexOf\(requestedSection\) !== -1/.test(setup) && /data-setup-section="frigate"/.test(setup) && /data-setup-section=/.test(setup) && /state\.focusSection/.test(setup) && /input\.focus\(\{ preventScroll: true \}\)/.test(setup), "Camera Detection setup handoff must reveal, scroll to, and focus the Frigate form");
assert(/var refreshPromise = null/.test(setup) && /if \(refreshPromise\)/.test(setup), "Diagnostics refreshes must serialize instead of racing older health and Camera Detection state");
assert(/data-form="frigate"/.test(setup) && /\/api\/config\/frigate/.test(setup), "Diagnostics must configure or remove Camera Detection");
assert(/\/api\/frigate\/test/.test(setup) && /Camera connected/.test(setup) && /Camera saved; test failed/.test(setup), "Diagnostics must test saved Frigate settings and distinguish saved configuration from verified connectivity");
assert(/data-frigate-feedback' \+ liveRegionAttributes\(state\.frigateFeedbackTone === "danger" \? "alert" : "status"\)/.test(setup) && /Settings were saved and tested/.test(setup), "Camera Detection setup must show and announce form-local save, test, and error feedback");
assert(/frigateTestCompleted/.test(setup) && /Camera status refresh failed/.test(setup), "Camera Detection must not mislabel a post-test Diagnostics refresh failure as a failed connection test");
assert(/event\.preventDefault\(\);\s*if \(state\.busy\)/.test(setup), "Diagnostics must cancel duplicate form submissions before rejecting them while busy");
assert(/name="username"/.test(setup) && /name="password"/.test(setup) && /authenticationConfigured/.test(setup), "Diagnostics must support authenticated Frigate without redisplaying the saved password");
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

// Exercise the production renderer, shared live-region helper, and submit flow.
// Only transport and DOM insertion are replaced; no native app or network runs.
async function checkSetupFeedback(scenario) {
  const window = {};
  const context = vm.createContext({
    window,
    FormData: class {
      constructor(form) { this.values = form.values; }
      get(name) { return this.values[name] || ""; }
    }
  });
  vm.runInContext(inlineWidgets, context, { filename: "js/inline-widgets.js" });
  const runtime = window.InlineWidgets.runtime;
  const listeners = new Map();
  const requests = [];
  const container = { html: "", querySelector: () => null };
  let mountSetup;
  Object.assign(runtime, {
    registerRenderer: (id, renderer) => { if (id === "setup") mountSetup = renderer; },
    addListener: (_cleanups, _target, type, listener) => listeners.set(type, listener),
    patchStableDom: (target, html) => { target.html = html; },
    buildBridgeUrl: (_env, path) => path,
    requestJson: async (path, options) => {
      requests.push({ path, options });
      if (path === "/api/config/frigate") {
        if (scenario.saveError) throw new Error(scenario.saveError);
        return {};
      }
      if (path === "/api/frigate/test") {
        if (scenario.testError) throw new Error(scenario.testError);
        return scenario.connection || { configured: true, connected: true, state: "Ready" };
      }
      assert(["/api/health", "/api/config", "/api/hue", "/api/provisioning"].includes(path), `unexpected Camera Detection request: ${path}`);
      return {};
    }
  });
  vm.runInContext(setup, context, { filename: "js/widgets/setup.js" });
  assert(typeof mountSetup === "function", "Diagnostics renderer must register before feedback can be tested");
  const controller = mountSetup({ id: "setup" }, container, { requestedSetupSection: "frigate" });
  await controller.refresh();

  function assertFeedback(expected, role) {
    const form = container.html.match(/<form\b[^>]*data-form="frigate"[^>]*>[\s\S]*?<\/form>/)?.[0];
    const feedback = form?.match(/<div\b([^>]*\bdata-frigate-feedback\b[^>]*)>([\s\S]*?)<\/div>/);
    assert(feedback, `${scenario.name}: feedback must be rendered inside the Camera Detection form`);
    const [, attributes, message] = feedback;
    assert(attributes.includes(`role="${role}"`) && attributes.includes(`aria-live="${role === "alert" ? "assertive" : "polite"}"`) && attributes.includes('aria-atomic="true"'), `${scenario.name}: form feedback must expose ${role} announcement semantics`);
    assert(expected.test(message), `${scenario.name}: incorrect form feedback: ${message}`);
    assert((container.html.match(/aria-live="(?:assertive|polite)"/g) || []).length === 1, `${scenario.name}: Camera Detection must announce feedback in one place only`);
  }

  let prevented = 0;
  const event = {
    target: {
      getAttribute: name => name === "data-form" ? "frigate" : null,
      values: { baseUrl: scenario.remove ? "" : "https://frigate.example.test", camera: "garage" }
    },
    preventDefault: () => { prevented += 1; }
  };
  listeners.get("submit")(event);
  assertFeedback(/Saving and testing Camera Detection settings\./, "status");
  listeners.get("submit")(event);
  assert(prevented === 2, `${scenario.name}: active and duplicate form submissions must both be cancelled`);
  await new Promise(resolve => setImmediate(resolve));
  assertFeedback(scenario.expected, scenario.role);
  assert(requests.filter(request => request.path === "/api/config/frigate").length === 1, `${scenario.name}: duplicate submission must not save twice`);
  assert(requests.filter(request => request.path === "/api/frigate/test").length === (scenario.remove || scenario.saveError ? 0 : 1), `${scenario.name}: connection tests must follow a successful nonempty save only`);
  controller.destroy();
}

for (const scenario of [
  { name: "saved and connected", expected: /Camera connected\. Settings were saved and tested\./, role: "status" },
  { name: "removed", remove: true, expected: /Camera Detection was removed\./, role: "status" },
  { name: "save rejected", saveError: "Use a local/private address <only>", expected: /Use a local\/private address &lt;only&gt;/, role: "alert" },
  { name: "test request failed", testError: "Connection refused", expected: /Settings were saved, but the connection test failed\. Connection refused/, role: "alert" },
  { name: "test reports disconnected", connection: { configured: true, connected: false, message: "Authentication rejected" }, expected: /Authentication rejected/, role: "alert" }
]) {
  await checkSetupFeedback(scenario);
}

console.log("checked local-only authenticated Frigate camera detection, protected credentials, production UI wiring, snapshot safety, and five setup feedback scenarios");
