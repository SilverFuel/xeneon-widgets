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

const dashboard = read("js/dashboard.js");
const setup = read("js/widgets/setup.js");
const inlineWidgets = read("js/inline-widgets.js");

// Exercise the real initial-route controller and section renderer without a browser.
// A saved destination or hidden rail section must not override an explicit Frigate link.
function routeFunction(name, nextMarker) {
  const start = dashboard.indexOf(`function ${name}(`);
  const end = dashboard.indexOf(nextMarker, start);
  assert(start >= 0 && end > start, `Camera Detection route function is missing: ${name}`);
  return dashboard.slice(start, end);
}
const navigationContext = vm.createContext({});
vm.runInContext(read("js/dashboard-navigation.js"), navigationContext);
const routeSource = [
  routeFunction("resolveInitialWidget", "function selectWidget("),
  routeFunction("renderPrimaryNavigation", "function selectDestination("),
  routeFunction("refreshBridgeState", "function checkBridgeAndRender("),
  routeFunction("checkBridgeAndRender", 'window.addEventListener("error"')
].join("\n");
for (const fixture of [{ destination: "settings", hidden: false }, { destination: "library", hidden: true }]) {
  const persisted = [];
  const paints = [];
  const headings = new Map();
  const rail = { html: "" };
  const context = vm.createContext({
    navigation: navigationContext.AuxoraNavigation,
    primaryDestination: fixture.destination,
    destinationPanels: { settings: "updates", library: "audio", "smart-home": "hue" },
    currentWidgetId: "updates",
    bridgeSetup: { onboardingCompleted: false },
    bridgeReachable: false,
    lastBridgeSnapshotKey: "",
    lastPrimaryWidgetStorageKey: "last-widget",
    perfMode: false,
    primaryNavNode: rail,
    settingsToggleNode: { classList: { toggle() {} }, setAttribute() {} },
    document: { body: { dataset: {} } },
    getSetting: key => key === "hiddenSections" ? JSON.stringify(fixture.hidden ? ["smart-home"] : []) : "[]",
    readStoredWidget: () => "audio",
    getWidgetById: id => ({ id, destination: "library" }),
    fetchBridgeHealth: async () => ({ setup: { onboardingCompleted: true } }),
    fetchBridgeConfig: async () => ({}),
    applyBridgeState: health => { context.bridgeSetup = health.setup; },
    persistWidgetChoice: id => persisted.push(id),
    patchDashboardDom: (node, html) => { node.html = html; },
    setText: (id, value) => headings.set(id, value),
    escapeHtml: String,
    renderHeaderModes() {},
    renderOriginStatus() {},
    updateWidgetMeta() {},
    refreshLauncherDock() {},
    renderCurrentSelection: reload => paints.push({ id: context.currentWidgetId, section: context.primaryDestination, reload }),
    handleBridgeOffline: () => { throw new Error("Camera Detection route fixture unexpectedly failed hydration"); }
  });
  vm.runInContext(routeSource, context);
  const hydration = context.checkBridgeAndRender("frigate", true);
  assert(context.currentWidgetId === "frigate" && context.primaryDestination === "smart-home", "explicit Camera Detection routes must override stale destinations and pending onboarding, including a hidden Smart Home section");
  await hydration;
  assert(persisted.join(",") === "frigate" && paints.length === 1 && paints[0].id === "frigate" && paints[0].section === "smart-home" && paints[0].reload === true
    && context.document.body.dataset.section === "smart-home" && headings.get("dashboard-section-title") === "Smart Home"
    && rail.html.includes('data-section-id="smart-home"') === !fixture.hidden,
  "hydrated Camera Detection deep links must persist their selection and repaint the owning section while preserving rail visibility preferences");
}

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

console.log("checked Camera Detection deep-link routing and five setup feedback scenarios");
