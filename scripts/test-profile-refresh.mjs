// A routine configuration refresh can be the first to see that the host changed Profile.
// It must apply that Profile's look, because the evaluation reply that follows finds nothing to change.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");
const first = dashboard.indexOf("  function applyBridgeState(");
const last = dashboard.indexOf("  function handleBridgeOffline(", first);
assert(first >= 0 && last > first, "applyBridgeState must exist and be followed by handleBridgeOffline");
const source = dashboard.slice(first, last);

const profiles = [
  { id: "scene-work", name: "Work", themeId: "focus" },
  { id: "scene-wow-forever", name: "WoW Forever", themeId: "horde" }
];
const config = activeSceneId => ({ scenes: { activeSceneId, defaultSceneId: "scene-work", automationEnabled: true, profiles } });

function harness({ explicitTheme = false } = {}) {
  const applied = [];
  const context = {
    document: { body: { dataset: {} } },
    bridgeCapabilities: {}, bridgeConfig: {}, bridgeApp: null, bridgeSetup: null,
    defaultSettings: { city: "", units: "metric" }, onboardingVersion: 1,
    initialScenePresentationApplied: false,
    hadExplicitStoredThemeSelection: explicitTheme,
    migrateLegacyModeLayouts() {}, createBootSetupSummary: () => ({}), syncSettingsFromBridgeConfig() {},
    applyScenePresentation: scene => applied.push(scene.id),
    applyDashboardPresentation: () => applied.push("repaint")
  };
  runInNewContext(source, context);
  return { context, applied };
}

test("the first load applies the active Profile's look once", () => {
  const h = harness();
  h.context.applyBridgeState({}, config("scene-work"));
  assert.deepEqual(h.applied, ["scene-work"]);
});

test("a refresh that sees no Profile change only repaints", () => {
  const h = harness();
  h.context.applyBridgeState({}, config("scene-work"));
  h.context.applyBridgeState({}, config("scene-work"));
  assert.deepEqual(h.applied, ["scene-work", "repaint"]);
});

test("a refresh that sees the host's Profile change applies the new Profile's look", () => {
  const h = harness();
  h.context.applyBridgeState({}, config("scene-wow-forever"));
  // The game exits; the host returns to Work and this refresh is handled before the evaluation's reply.
  h.context.applyBridgeState({}, config("scene-work"));
  assert.deepEqual(h.applied, ["scene-wow-forever", "scene-work"]);
  assert.equal(h.context.document.body.dataset.scene, "scene-work");
});

test("a theme the user picked by hand is kept on first load, and a later Profile change still applies", () => {
  const h = harness({ explicitTheme: true });
  h.context.applyBridgeState({}, config("scene-work"));
  assert.deepEqual(h.applied, ["repaint"], "the first load must not replace a hand-picked theme");
  h.context.applyBridgeState({}, config("scene-wow-forever"));
  assert.deepEqual(h.applied, ["repaint", "scene-wow-forever"]);
});
