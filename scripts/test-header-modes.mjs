import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");
function between(start, end) {
  const first = dashboard.indexOf("  function " + start + "(");
  const last = dashboard.indexOf("  function " + end + "(", first);
  assert(first >= 0 && last > first, "Production function boundaries must exist");
  return dashboard.slice(first, last);
}
const source = between("normalizeThemeVariantPreference", "getProductTheme")
  + between("resolveThemeVariant", "isLiveGameThemeActive")
  + between("sceneContext", "scheduleGameActivityLoop")
  + between("activateScene", "resumeSceneAutomation");

function harness(preference, nativeVariant) {
  const settings = { themeVariant: preference };
  const writes = [], requests = [], feedback = [], presentations = [];
  const scenes = { activeSceneId: "scene-work", activeScene: { id: "scene-work", name: "Work" }, themeVariant: nativeVariant, automationEnabled: true, automaticSwitchingActive: true, manualOverrideActive: false };
  const context = {
    bridgeOrigin: "http://example.invalid", bridgeConfig: { scenes },
    gameActivity: null, gameForAutoOpen: payload => payload, lastSceneMediaPlaying: false,
    getSetting: key => settings[key],
    saveDashboardSettings(values) { writes.push({ ...values }); Object.assign(settings, values); },
    renderQuickDrawer() {}, showTouchFeedback: value => feedback.push(value),
    renderHeaderModes() {},
    applyScenePresentation: value => presentations.push(value),
    buildUrl: (origin, path) => origin + path,
    postJson(url, body) {
      requests.push({ url, body });
      return Promise.resolve(body.sceneId === "scene-night"
        ? { ...scenes, themeVariant: scenes.themeVariant === "night" ? "standard" : "night" }
        : { ...scenes, activeSceneId: body.sceneId, activeScene: { id: body.sceneId, name: "Gaming" }, manualOverrideActive: true });
    }
  };
  runInNewContext(source, context);
  return { context, scenes, settings, writes, requests, feedback, presentations };
}

for (const preference of ["auto", "night", "standard"]) {
  for (const nativeVariant of ["night", "standard"]) {
    test("Night toggles effective " + preference + " preference over native " + nativeVariant + " without changing base Mode", async () => {
      const h = harness(preference, nativeVariant);
      const before = h.context.resolveThemeVariant();
      const expected = before === "night" ? "standard" : "night";
      await h.context.activateScene("scene-night");
      assert.equal(h.context.resolveThemeVariant(), expected, "First tap must change the displayed variant");
      assert.equal(h.settings.themeVariant, expected, "Use the same explicit preference as Quick display controls");
      assert.equal(h.context.bridgeConfig.scenes, h.scenes, "Keep native base Mode, variant, and automation untouched");
      assert.equal(h.requests.length, 0, "Night must not call the native scene toggle");
      assert.equal(h.presentations.length, 0, "Night must not replace the current palette or Mode layout");
      assert.equal(h.feedback.at(-1), "Night display " + (expected === "night" ? "on" : "off"));
      await h.context.activateScene("scene-night");
      assert.equal(h.context.resolveThemeVariant(), before, "Second tap restores the displayed variant");
      assert.equal(h.writes.length, 2, "Each tap saves exactly once");
    });
  }
}

test("Base Mode activation retains the existing native request and presentation receipt", async () => {
  const h = harness("auto", "standard");
  await h.context.activateScene("scene-gaming");
  assert.equal(h.requests.length, 1);
  const { sampledAt, ...sent } = h.requests[0].body;
  assert.equal(h.requests[0].url.endsWith("/api/scenes/remember"), true, "a hand-picked Profile is remembered, not held on a timer");
  assert.deepEqual(sent, { activeGame: "", activeGameKey: "", foregroundProcess: "", mediaPlaying: false, sceneId: "scene-gaming" });
  assert.equal(typeof sampledAt, "string");
  assert.equal(h.context.bridgeConfig.scenes.activeSceneId, "scene-gaming");
  assert.equal(h.presentations.length, 1);
  assert.equal(h.writes.length, 0);
});

test("A Profile picked during a game is sent with that game, and the toast says what it is remembered for", async () => {
  const h = harness("auto", "standard");
  h.context.gameActivity = { name: "Battlefield 6", gameKey: "steam:2807960", processName: "bf6" };
  h.context.postJson = (url, body) => { h.requests.push({ url, body }); return Promise.resolve({ ...h.scenes, activeSceneId: body.sceneId, activeScene: { id: body.sceneId, name: "Media" }, lastActivationReason: "Remembered for this game" }); };
  await h.context.activateScene("scene-media");
  const { sampledAt, ...sent } = h.requests[0].body;
  assert.deepEqual(sent, { activeGame: "Battlefield 6", activeGameKey: "steam:2807960", foregroundProcess: "bf6", mediaPlaying: false, sceneId: "scene-media" });
  assert.equal(h.feedback.at(-1), "Media for Battlefield 6 from now on");

  h.context.gameActivity = null;
  h.context.postJson = (url, body) => Promise.resolve({ ...h.scenes, activeSceneId: body.sceneId, activeScene: { id: body.sceneId, name: "Gaming" }, lastActivationReason: "Everyday Profile chosen" });
  await h.context.activateScene("scene-gaming");
  assert.equal(h.feedback.at(-1), "Gaming is now your everyday Profile");

  h.context.lastSceneMediaPlaying = true;
  h.context.postJson = (url, body) => { h.requests.push({ url, body }); return Promise.resolve({ ...h.scenes, activeSceneId: body.sceneId, activeScene: { id: body.sceneId, name: "Work" }, lastActivationReason: "Remembered for this media rule" }); };
  await h.context.activateScene("scene-work");
  assert.equal(h.requests.at(-1).body.mediaPlaying, true);
  assert.equal(h.feedback.at(-1), "Work while music plays from now on");
});

test("Mode editing preserves personal appearance when the active profile did not change", () => {
  const h = harness("auto", "standard");
  const receipt = { ...h.scenes, profiles: [{ id: "new-copy" }] };
  h.context.applySceneSnapshot(receipt, true);
  assert.equal(h.presentations.length, 0);
  assert.equal(h.context.bridgeConfig.scenes, receipt, "New profiles still reach the Mode selector");
  const changed = { ...receipt, activeScene: { ...receipt.activeScene, animationIntensity: 40 } };
  h.context.applySceneSnapshot(changed, true);
  assert.equal(h.presentations.length, 1, "A changed active profile still applies its new presentation");
  assert.equal(h.requests.length, 0, "Receipt synchronization never issues another native request");
});

function pickerHarness() {
  const node = { value: "", disabled: false, attributes: {}, html: "", handlers: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; }, removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(type, handler) { assert.equal(type, "change"); this.handlers.push(handler); },
    choose(value) { this.value = value; for (const handler of this.handlers) handler(); }
  };
  const calls = [], feedback = [];
  let resolve, reject, stateText = "";
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const context = {
    document: { getElementById: () => node }, bridgeReachable: true, modeActivationPending: false,
    gameActivity: null, gameForAutoOpen: payload => payload,
    bridgeConfig: { scenes: { activeSceneId: "scene-work", defaultSceneId: "scene-work", automaticSwitchingActive: true,
      profiles: [{ id: "scene-work", name: "Work" }, { id: "scene-gaming", name: "Gaming" }, { id: "custom-focus", name: "My focus" }, { id: "scene-night", name: "Night", themeVariant: "night" }] } },
    escapeHtml: value => String(value), patchDashboardDom: (node, html) => { node.html = html; },
    setText(id, value) { if (id === "dashboard-mode-state") stateText = value; }, markDashboardInteractionIdleSoon() {}, isTouchLockEnabled: () => context.locked,
    activateScene(id) { calls.push(id); return pending; },
    showTouchFeedback: text => feedback.push(text)
  };
  runInNewContext(between("renderHeaderModes", "renderQuickDrawer"), context);
  context.renderHeaderModes(); context.bindHeaderModeControl();
  return { context, node, calls, feedback, resolve, reject, state: () => stateText };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("One labeled selector lists the Profiles and says what the current one is for; Night stays in Quick controls", () => {
  const h = pickerHarness();
  assert.match(h.node.html, /value="custom-focus"/);
  assert.doesNotMatch(h.node.html, /value="automatic"/, "there is no manual mode to leave, so no Automatic choice");
  assert.doesNotMatch(h.node.html, /value="scene-night"/);
  assert.equal(h.node.value, "scene-work");
  assert.equal(h.state(), "Everyday");
  h.context.gameActivity = { name: "Battlefield 6", gameKey: "steam:2807960" };
  h.context.renderHeaderModes();
  assert.equal(h.state(), "For Battlefield 6");
  h.context.gameActivity = null;
  h.context.bridgeConfig.scenes.lastActivationReason = "Automatic media rule";
  h.context.renderHeaderModes();
  assert.equal(h.state(), "While music plays");
  h.context.bridgeConfig.scenes.lastActivationReason = "";
  h.context.bridgeConfig.scenes.activeSceneId = "scene-gaming";
  h.context.renderHeaderModes();
  assert.equal(h.state(), "Automatic");
});

test("Mode picker blocks duplicate changes and restores the confirmed value after a failed request", async () => {
  const h = pickerHarness();
  h.node.choose("scene-gaming");
  assert.deepEqual(h.calls, ["scene-gaming"]);
  assert.equal(h.node.getAttribute("aria-disabled"), "true");
  assert.equal(h.node.disabled, false, "Keep keyboard focus on the pending selector");
  assert.equal(h.node.value, "scene-gaming", "Keep the requested Mode visible while it is applying");
  h.node.choose("custom-focus");
  assert.equal(h.calls.length, 1);
  h.reject(new Error("Mode unavailable")); await settle();
  assert.equal(h.node.disabled, false);
  assert.equal(h.node.value, "scene-work");
  assert.deepEqual(h.feedback, ["Mode unavailable"]);
});

test("Profile picker shows the confirmed Profile once the choice is remembered", async () => {
  const h = pickerHarness();
  h.node.choose("scene-gaming");
  assert.deepEqual(h.calls, ["scene-gaming"]);
  assert.equal(h.state(), "Applying");
  h.context.bridgeConfig.scenes.activeSceneId = "scene-gaming";
  h.context.bridgeConfig.scenes.defaultSceneId = "scene-gaming";
  h.resolve(); await settle();
  assert.equal(h.node.value, "scene-gaming");
  assert.equal(h.node.disabled, false);
  assert.equal(h.state(), "Everyday");
});

test("Mode picker rejects Night, unknown IDs, locked input, and offline input", () => {
  const h = pickerHarness();
  h.node.choose("scene-night"); h.node.choose("missing");
  h.context.locked = true; h.node.choose("scene-gaming");
  h.context.locked = false; h.context.bridgeReachable = false; h.context.renderHeaderModes();
  h.node.choose("scene-gaming");
  assert.equal(h.node.disabled, true);
  assert.equal(h.calls.length, 0);
});
