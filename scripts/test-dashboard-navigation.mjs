import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const navigation = require("../js/dashboard-navigation.js");
const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");
const modelSource = readFileSync(new URL("../js/dashboard-navigation.js", import.meta.url), "utf8");
const sectionIds = ["home", "gaming", "media", "pc", "smart-home"];
const expectedTabs = {
  home: [["home", "Overview"], ["calendar", "Calendar"], ["weather", "Weather"]],
  gaming: [["game-mode", "Game Mode"], ["wow-forever", "WoW Forever"]],
  media: [["audio", "Audio & Media"], ["streaming", "Streaming"]],
  pc: [["system", "Performance"], ["tmog", "Graphs (TMOG)"], ["network", "Network"], ["display-controls", "Display"], ["shortcuts", "Windows controls"], ["quick-actions", "Windows tools"], ["clipboard", "Clipboard"]],
  "smart-home": [["hue", "Lights"], ["frigate", "Cameras"]],
  settings: [["theme-studio", "Appearance"], ["layout-editor", "Layout"], ["scenes", "Modes & automation"], ["game-blocklist", "Game blocklist"], ["updates", "Updates"], ["privacy", "Privacy & Backup"], ["remote", "Phone Remote"], ["marketplace", "Widget Packs"], ["setup", "Setup & status"], ["installer", "Repair & recovery"]]
};
const canonicalIds = Object.values(expectedTabs).flat().map(([id]) => id);

function extractBetween(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `real dashboard source markers must exist: ${start}, ${end}`);
  return source.slice(first, last);
}

function realCatalogIds() {
  const contracts = extractBetween(dashboard, "  var surfaceContracts = {", "  function createSetupItem(");
  const createWidgets = extractBetween(dashboard, "  function createWidgets()", "  function renderPicker(");
  const ids = runInNewContext(contracts + createWidgets + "\ncreateWidgets().map(function (widget) { return widget.id; });", {
    navigation,
    window: { AuxoraNavigation: navigation }
  });
  return Array.from(ids);
}

test("section metadata keeps all 26 tabs and a separate Recovery item", () => {
  assert.deepEqual(navigation.sections.map(section => [section.id, section.label]), [
    ["home", "Home"], ["gaming", "Gaming"], ["media", "Media"], ["pc", "PC"], ["smart-home", "Smart Home"], ["settings", "Settings"]
  ]);
  for (const section of navigation.sections) {
    assert.deepEqual(section.tabs.map(tab => [tab.id, tab.label]), expectedTabs[section.id]);
    for (const tab of section.tabs) assert.equal(navigation.sectionForWidget(tab.id), section.id);
  }
  assert.equal(canonicalIds.length, 26);
  assert.equal(new Set(canonicalIds).size, 26);
});

test("navigation exactly covers the executed real dashboard catalog", () => {
  const actual = realCatalogIds();
  assert.equal(actual.length, 26);
  assert.equal(navigation.validateCatalog(actual), true);
  assert.deepEqual([...actual].sort(), [...canonicalIds].sort());
});

test("catalog validation diagnoses duplicate, missing, and extra IDs together", () => {
  const corrupted = realCatalogIds().filter(id => id !== "installer");
  corrupted.push("audio", "future-widget");
  assert.throws(() => navigation.validateCatalog(corrupted), error => {
    assert.match(error.message, /duplicate: audio/);
    assert.match(error.message, /missing: installer/);
    assert.match(error.message, /extra: future-widget/);
    return true;
  });
  assert.throws(() => navigation.validateCatalog([...canonicalIds, "media"]), /extra: media/);
  assert.throws(() => navigation.validateCatalog([...canonicalIds, null]), /extra: <non-string>/);
  assert.throws(() => navigation.validateCatalog({}), /must be an array/);
});

test("browser global works without DOM or storage and metadata cannot be corrupted", () => {
  const context = { window: {} };
  runInNewContext(modelSource, context);
  const browserApi = context.window.AuxoraNavigation;
  assert.equal(browserApi.sectionForWidget("wow-forever"), "gaming");
  assert.equal(browserApi.resolveNavigation({ requestedWidget: "installer" }).widgetId, "installer");
  assert.throws(() => navigation.sections.push({}), TypeError);
  assert.throws(() => { navigation.sections[0].tabs[0].id = "changed"; }, TypeError);
  assert.throws(() => navigation.tabsForSection("pc").pop(), TypeError);
});

test("lookups reject unknown/prototype names while retaining the media widget alias", () => {
  for (const value of ["", "missing", "constructor", "__proto__", "toString", null, undefined, 42, {}]) {
    assert.equal(navigation.sectionForWidget(value), null);
    assert.deepEqual(navigation.tabsForSection(value), []);
  }
  assert.equal(navigation.sectionForWidget("media"), "media");
  assert.equal(navigation.sectionForWidget("installer"), "settings");
});

test("section layout deduplicates valid IDs, fills omissions, and never hides Settings", () => {
  const order = ["pc", "pc", "settings", "bogus", "gaming"];
  const hidden = ["settings", "gaming", "gaming", "__proto__", "pc"];
  const before = structuredClone({ order, hidden });
  assert.deepEqual(navigation.normalizeSectionLayout(order, hidden), {
    order: ["pc", "gaming", "home", "media", "smart-home"], hidden: ["gaming", "pc"]
  });
  assert.deepEqual({ order, hidden }, before);
  assert.deepEqual(navigation.normalizeSectionLayout([], []), { order: sectionIds, hidden: [] });
});

test("persisted JSON layout settings normalize safely without mutating shared defaults", () => {
  assert.deepEqual(navigation.normalizeSectionLayout('["smart-home","media"]', '["home","settings"]'), {
    order: ["smart-home", "media", "home", "gaming", "pc"], hidden: ["home"]
  });
  for (const malformed of [undefined, null, {}, 7, "not-json", '"pc"', '{"pc":true}', '[["pc"],null,12]']) {
    assert.deepEqual(navigation.normalizeSectionLayout(malformed, malformed), { order: sectionIds, hidden: [] });
  }
  const result = navigation.normalizeSectionLayout([], []);
  result.order.pop();
  assert.deepEqual(navigation.normalizeSectionLayout([], []).order, sectionIds);
});

test("legacy destinations migrate without making the old Modes route a new section", () => {
  assert.equal(navigation.migrateDestination("home", "audio"), "home");
  assert.equal(navigation.migrateDestination("scenes", "scenes"), "home");
  assert.equal(navigation.migrateDestination("settings", "system"), "settings");
  for (const id of canonicalIds) assert.equal(navigation.migrateDestination("library", id), navigation.sectionForWidget(id));
  assert.equal(navigation.migrateDestination("library", "media"), "media");
  assert.equal(navigation.migrateDestination("library", "unknown"), "pc");
  for (const id of sectionIds) assert.equal(navigation.migrateDestination(id, "audio"), id);
  for (const id of ["unknown", "__proto__", null, undefined]) assert.equal(navigation.migrateDestination(id, "audio"), null);
});

test("every explicit deep link wins over onboarding, stale destinations, and remembered panels", () => {
  for (const id of canonicalIds) {
    assert.deepEqual(navigation.resolveNavigation({
      requestedWidget: id, lastWidget: "system", storedDestination: "settings", onboardingCompleted: false,
      sectionPanels: { settings: "updates" }
    }), { sectionId: navigation.sectionForWidget(id), widgetId: id });
  }
  assert.deepEqual(navigation.resolveNavigation({ requestedWidget: "media" }), { sectionId: "media", widgetId: "audio" });
});

test("first run selects Diagnostics unless an explicit valid route was requested", () => {
  for (const options of [undefined, null, {}, { requestedWidget: "missing" }, { lastWidget: "wow-forever", storedDestination: "gaming", onboardingCompleted: false }]) {
    assert.deepEqual(navigation.resolveNavigation(options), { sectionId: "settings", widgetId: "setup" });
  }
});

test("section memory must belong to that section and does not consume inherited properties", () => {
  const base = { storedDestination: "pc", onboardingCompleted: true, lastWidget: "system" };
  assert.deepEqual(navigation.resolveNavigation({ ...base, sectionPanels: { pc: "tmog" } }), { sectionId: "pc", widgetId: "tmog" });
  for (const sectionPanels of [{ pc: "audio" }, { pc: "unknown" }, Object.create({ pc: "tmog" }), ["tmog"], null]) {
    assert.deepEqual(navigation.resolveNavigation({ ...base, sectionPanels }), { sectionId: "pc", widgetId: "system" });
  }
  assert.deepEqual(navigation.resolveNavigation({ storedDestination: "media", onboardingCompleted: true, sectionPanels: { media: "media" } }), { sectionId: "media", widgetId: "audio" });
});

test("completed onboarding restores valid last widgets and section defaults", () => {
  for (const id of canonicalIds) {
    assert.deepEqual(navigation.resolveNavigation({ lastWidget: id, onboardingCompleted: true }), { sectionId: navigation.sectionForWidget(id), widgetId: id });
  }
  for (const section of navigation.sections) {
    assert.deepEqual(navigation.resolveNavigation({ storedDestination: section.id, lastWidget: "missing", onboardingCompleted: true }), { sectionId: section.id, widgetId: section.tabs[0].id });
  }
  assert.deepEqual(navigation.resolveNavigation({ requestedWidget: "missing", storedDestination: "unknown", lastWidget: "unknown", onboardingCompleted: true }), { sectionId: "home", widgetId: "home" });
});

test("legacy startup destination precedence and same-section fallback remain deterministic", () => {
  assert.deepEqual(navigation.resolveNavigation({ storedDestination: "scenes", lastWidget: "scenes", onboardingCompleted: true, sectionPanels: { scenes: "scenes", home: "calendar" } }), { sectionId: "home", widgetId: "calendar" });
  assert.deepEqual(navigation.resolveNavigation({ storedDestination: "library", lastWidget: "wow-forever", onboardingCompleted: true, sectionPanels: { library: "system" } }), { sectionId: "gaming", widgetId: "wow-forever" });
  assert.deepEqual(navigation.resolveNavigation({ storedDestination: "library", lastWidget: "unknown", onboardingCompleted: true }), { sectionId: "pc", widgetId: "system" });
  assert.deepEqual(navigation.resolveNavigation({ storedDestination: "settings", lastWidget: "audio", onboardingCompleted: true }), { sectionId: "settings", widgetId: "theme-studio" });
});

test("real stored-panel loading preserves legacy Library last-panel migration", () => {
  const defaults = dashboard.match(/  var destinationPanels =[^;]+;/)?.[0];
  assert.ok(defaults, "real destination panel initialization must exist");
  const loader = extractBetween(dashboard, "  function readStoredWidget(", "  function persistDestinationPanel(");
  for (const [lastWidget, persistedPanels] of [["network", null], ["wow-forever", null], ["network", '{"library":"network"}'], ["wow-forever", '{"library":"wow-forever"}'], ["network", "malformed"]]) {
    const sectionPanels = runInNewContext(defaults + loader + "\nreadDestinationPanels();", {
      navigation,
      destinationPanelsStorageKey: "auxora-dashboard-panels-v1",
      primaryDestinationStorageKey: "auxora-dashboard-destination",
      lastPrimaryWidgetStorageKey: "xeneon-dashboard-last-widget",
      widgetStorageKey: "xeneon-dashboard-widget",
      window: { localStorage: { getItem: key => ({ "auxora-dashboard-panels-v1": persistedPanels, "auxora-dashboard-destination": "library", "xeneon-dashboard-last-widget": lastWidget, "xeneon-dashboard-widget": lastWidget })[key] ?? null } }
    });
    assert.deepEqual(navigation.resolveNavigation({ storedDestination: "library", lastWidget, onboardingCompleted: true, sectionPanels }), {
      sectionId: navigation.sectionForWidget(lastWidget), widgetId: lastWidget
    }, `real stored-panel loader displaced ${lastWidget} with ${persistedPanels}`);
  }
});

test("hiding every configurable section preserves all deep links and automatic game routes", () => {
  const layout = navigation.normalizeSectionLayout(sectionIds, [...sectionIds, "settings"]);
  assert.deepEqual(layout.hidden, sectionIds);
  for (const id of canonicalIds) {
    const route = navigation.resolveNavigation({ requestedWidget: id, onboardingCompleted: true, hiddenSections: layout.hidden });
    assert.deepEqual(route, { sectionId: navigation.sectionForWidget(id), widgetId: id });
    assert.ok(navigation.tabsForSection(route.sectionId).some(tab => tab.id === route.widgetId));
  }
  for (const id of ["wow-forever", "game-mode"]) {
    assert.deepEqual(navigation.resolveNavigation({ lastWidget: id, storedDestination: "gaming", onboardingCompleted: true }), { sectionId: "gaming", widgetId: id });
  }
  assert.deepEqual(navigation.normalizeSectionLayout().hidden, []);
});

function selectionHarness(panel) {
  const context = {
    navigation, widgets: canonicalIds.map(id => ({ id })),
    currentWidgetId: panel, primaryDestination: navigation.sectionForWidget(panel), destinationPanels: {},
    perfMode: false, bridgeReachable: true, bridgeOrigin: "http://127.0.0.1:8976", widgetBase: "http://127.0.0.1:8976",
    lastPrimaryWidgetStorageKey: "last", widgetStorageKey: "current", lastBridgeSnapshotKey: "", bridgeSetup: { onboardingCompleted: false },
    readStoredWidget: () => panel, rendered: [], selected: [], feedback: [], gameFacePreviousWidgetId: "", gameActivity: { activeGameId: "fixture-game" },
    gameFaceSuppressedGameId: "", activeGameIdFromPayload: () => "fixture-game",
    storage: {},
    window: { localStorage: { setItem(key, value) { context.storage[key] = value; } } }, console,
    primaryDestinationStorageKey: "section", persistDestinationPanel() {}, renderPrimaryNavigation() {},
    setQueryParam(key, value) { context.query = { key, value }; }, markDashboardInteractionIdleSoon() {},
    updateWidgetMeta(widget) { context.metadata = widget.id; },
    renderPicker() {}, renderDiagnostics() {}, renderSettings() {}, renderOriginStatus() {}, renderLauncherDock() {}, updateNowPlayingStrip() {},
    widgetRequiresBridge: () => false,
    showInlineWidget(widget) { context.rendered.push(widget.id); },
    fetchBridgeHealth: async () => ({}), fetchBridgeConfig: async () => ({}),
    applyBridgeState() { context.bridgeSetup.onboardingCompleted = true; }, refreshLauncherDock() {},
    showTouchFeedback(message) { context.feedback.push(message); },

  };
  const functions = extractBetween(dashboard, "  function getWidgetById(", "  function getSchemaForWidget(")
    + extractBetween(dashboard, "  function renderCurrentSelection(", "  function resolveInitialWidget(")
    + extractBetween(dashboard, "  function resolveInitialWidget(", "  function showLocalhostWarning(")
    + extractBetween(dashboard, "  function refreshBridgeState(", '  window.addEventListener("error"');
  runInNewContext(functions, context);
  return context;
}

test("finishing setup moves to Home and updates the active section", async () => {
  const context = selectionHarness("setup");
  await context.refreshBridgeState({ moveOffSetup: true });
  assert.equal(context.currentWidgetId, "home");
  assert.equal(context.primaryDestination, "home");
  assert.equal(context.metadata, "home");
  assert.equal(context.storage.section, "home");
  assert.equal(context.query.value, "home");
  assert.deepEqual(context.rendered, ["home"]);
});

test("Game Mode's Home action leaves the Gaming section when there is no previous panel", () => {
  const context = selectionHarness("game-mode");
  const start = dashboard.indexOf("returnHomeFromGameFace: function () {");
  const end = dashboard.indexOf("\n      showTouchFeedback: showTouchFeedback", start);
  assert.ok(start >= 0 && end > start, "real Game Mode return action must exist");
  const callback = dashboard.slice(start, end).replace("returnHomeFromGameFace: function", "function returnHomeFromGameFace").replace(/,\s*$/, "");
  runInNewContext(callback + "\nreturnHomeFromGameFace();", context);
  assert.equal(context.currentWidgetId, "home");
  assert.equal(context.primaryDestination, "home");
  assert.equal(context.gameFaceSuppressedGameId, "fixture-game");
  assert.deepEqual(context.rendered, ["home"]);
  assert.equal(context.storage.section, "home");
});

test("rendering a known panel derives its section instead of displacing the requested panel", () => {
  for (const id of canonicalIds) {
    const context = selectionHarness(id);
    context.primaryDestination = "settings";
    context.renderCurrentSelection(true);
    assert.equal(context.currentWidgetId, id);
    assert.equal(context.primaryDestination, navigation.sectionForWidget(id));
    assert.deepEqual(context.rendered, [id]);
  }
  const invalid = selectionHarness("missing");
  invalid.renderCurrentSelection(true);
  assert.equal(invalid.currentWidgetId, "home");
  assert.equal(invalid.primaryDestination, "home");
});

test("host hydration preserves saved startup intent across the temporary setup screen", async () => {
  for (const [destination, lastWidget, section, panel] of [
    ["scenes", "scenes", "home", "home"],
    ["library", "audio", "media", "audio"],
    ["library", "wow-forever", "gaming", "wow-forever"],
    ["settings", "updates", "settings", "updates"],
    ["home", "system", "home", "home"]
  ]) {
    const context = selectionHarness(lastWidget);
    context.primaryDestination = destination;
    await context.checkBridgeAndRender(lastWidget, false);
    assert.equal(context.currentWidgetId, panel, destination);
    assert.equal(context.primaryDestination, section, destination);
    assert.deepEqual(context.rendered, [panel]);
  }
  const deepLink = selectionHarness("network");
  deepLink.primaryDestination = "settings";
  await deepLink.checkBridgeAndRender("network", true);
  assert.equal(deepLink.currentWidgetId, "network");
  assert.equal(deepLink.primaryDestination, "pc");
  const incomplete = selectionHarness("home");
  incomplete.applyBridgeState = () => {};
  await incomplete.checkBridgeAndRender("home", false);
  assert.equal(incomplete.currentWidgetId, "setup");
  assert.equal(incomplete.primaryDestination, "settings");
});
