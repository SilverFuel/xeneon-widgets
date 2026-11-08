import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const html = read("dashboard.html"), product = read("js/widgets/product.js"), actions = read("js/widgets/actions.js");
const section = (name, next) => product.slice(product.indexOf("  function " + name + "("), product.indexOf("  function " + next + "("));
const settle = () => new Promise(resolve => setImmediate(resolve));

test("Common actions have one visible owner instead of repeated buttons and settings", () => {
  assert.match(html, /<span\b[^>]*id="dashboard-status"[^>]*role="status"/);
  assert.doesNotMatch(html, /id="dashboard-now-strip"|data-now-strip-action/);
  assert.doesNotMatch(section("mountThemeStudioWidget", "mountLayoutEditorWidget"), /name="themeVariant"/);
  assert.doesNotMatch(section("mountScenesWidget", "monitorInputLabel"), /data-scene-resume/);
  assert.doesNotMatch(section("mountStreamingWidget", "mountMarketplaceWidget"), /data-action="(?:open-media|stream-profile)"/);
  assert.match(read("js/dashboard.js"), /data-quick-night=/);
  assert.match(html, /id="dashboard-quick-media"/);
});

test("Windows action labels identify their real destination and retain confirmation rules", () => {
  const source = actions.slice(actions.indexOf("  function renderActionButton("), actions.indexOf("  function normalizeLaunchersPayload("));
  const context = { text: (value, fallback) => value || fallback, escapeHtml: String,
    requiresServerConfirmation: id => ["empty-recycle-bin", "sleep", "restart", "shutdown"].includes(id) };
  runInNewContext(source, context);
  for (const [id, label] of [["dark-mode", "Windows theme"], ["night-light", "Night Light settings"], ["lock-workstation", "Lock PC"], ["open-settings", "Windows Settings"], ["empty-recycle-bin", "Empty Recycle Bin"]]) {
    const item = { id, label: "Old ambiguous label", enabled: true };
    const output = context.renderActionButton(item, "execute", "", false);
    assert.ok(output.includes(`<strong>${label}</strong>`));
    assert.ok(output.includes(`data-id="${id}"`));
    assert.equal(item.label, "Old ambiguous label", "Do not mutate native data");
  }
  const confirmed = context.renderActionButton({ id: "empty-recycle-bin" }, "execute", "empty-recycle-bin", false);
  assert.match(confirmed, /Confirm Empty Recycle Bin/);
  assert.match(confirmed, /data-confirmation-required="true"/);
  assert.match(confirmed, /Tap again within 8 seconds/);
});

test("Recent app buttons appear on Home instead of repeating on every panel", () => {
  const source = read("js/dashboard.js");
  const predicate = source.slice(source.indexOf("  function shouldShowLauncherDock("), source.indexOf("  function setLauncherDockVisible("));
  const context = { launcherDockNode: {}, bridgeReachable: true, bridgeCapabilities: { launchers: true }, launcherDockEntries: [{}], isLocalBridgeBlockedByPageOrigin: () => false, currentWidgetId: "home" };
  runInNewContext(predicate, context);
  const model = {}; runInNewContext(read("js/dashboard-navigation.js"), model);
  for (const id of model.AuxoraNavigation.sections.flatMap(section => section.tabs.map(tab => tab.id))) {
    context.currentWidgetId = id;
    assert.equal(context.shouldShowLauncherDock(), id === "home", id);
  }
  context.currentWidgetId = "home"; context.bridgeReachable = false;
  assert.equal(context.shouldShowLauncherDock(), false);
  context.bridgeReachable = true; context.launcherDockEntries = [];
  assert.equal(context.shouldShowLauncherDock(), false);
});

function modesHarness(active = "scene-work") {
  const handlers = new Map(), requests = [], receipts = [];
  const container = { html: "" };
  const profiles = [{ id: "scene-work", name: "Work", isBuiltIn: true, widgets: ["home"] }, { id: "custom-focus", name: "My focus", isBuiltIn: false, widgets: ["home"] }];
  const snapshot = { activeSceneId: active, activeScene: profiles.find(p => p.id === active), profiles, automaticSwitchingActive: true };
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const context = {
    window: { setTimeout: () => 1, clearTimeout() {} },
    addListener(cleanups, _node, type, fn) { handlers.set(type, fn); cleanups.push(() => handlers.delete(type)); },
    runCleanups: cleanups => cleanups.splice(0).forEach(fn => fn()),
    text: (value, fallback) => value || fallback, escapeHtml: String,
    settingValue: (_env, _key, fallback) => fallback, friendlyChoice: String,
    patchStableDom: (node, markup) => { node.html = markup; }, productShell: (...args) => args.at(-1), initXnSlider() {},
    buildBridgeUrl: (_env, path) => path,
    FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } },
    requestJson(url, options) {
      if (!options.method) return Promise.resolve(url === "/api/scenes" ? snapshot : { displays: [] });
      requests.push({ url, body: options.body }); return pending;
    }
  };
  runInNewContext(section("mountScenesWidget", "monitorInputLabel"), context);
  const controller = context.mountScenesWidget({}, container, {
    applySceneSnapshot: (value, preserveUnchanged) => { assert.equal(preserveUnchanged, true); receipts.push(value); },
    activateScene: () => { throw new Error("Editing a Mode must not issue an activation"); }
  });
  function click(attribute, id) {
    const target = { closest: selector => selector === `[${attribute}]` ? target : null, getAttribute: key => key === attribute ? id : null };
    handlers.get("click")({ target });
  }
  return { container, controller, handlers, requests, receipts, snapshot, resolve, click };
}

test("Duplicate Mode sends one request and applies its receipt without activating again", async () => {
  const h = modesHarness(); await settle();
  h.click("data-scene-duplicate", "scene-work"); h.click("data-scene-duplicate", "scene-work");
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, "/api/scenes/duplicate");
  h.resolve(h.snapshot); await settle();
  assert.deepEqual(h.receipts, [h.snapshot]);
  assert.equal(h.snapshot.automaticSwitchingActive, true);
  h.controller.destroy();
});

test("Saving the active custom Mode updates its presentation without reactivating it", async () => {
  const h = modesHarness("custom-focus"); await settle();
  const form = { closest() { return this; }, getAttribute: () => "custom-focus", values: { name: "New focus", themeId: "focus", density: "comfortable", performanceBudget: "balanced", animationIntensity: "25" } };
  h.handlers.get("submit")({ target: form, preventDefault() {} });
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, "/api/scenes");
  h.resolve(h.snapshot); await settle();
  assert.deepEqual(h.receipts, [h.snapshot]);
  h.controller.destroy();
});

test("Deleting a Mode requires confirmation and applies the server fallback without another activation", async () => {
  const h = modesHarness("custom-focus"); await settle();
  h.click("data-scene-delete", "custom-focus"); assert.equal(h.requests.length, 0);
  h.click("data-scene-delete", "custom-focus"); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/api/scenes/delete");
  const fallback = { ...h.snapshot, activeSceneId: "scene-work", activeScene: h.snapshot.profiles[0], profiles: h.snapshot.profiles.filter(profile => profile.id !== "custom-focus") };
  h.resolve(fallback); await settle();
  assert.deepEqual(h.receipts, [fallback]);
  h.controller.destroy();
});
