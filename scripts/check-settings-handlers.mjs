import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");

function sourceFor(name) {
  const start = dashboard.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `Missing dashboard function ${name}`);
  const end = dashboard.indexOf("\n  function ", start + 1);
  return dashboard.slice(start, end === -1 ? undefined : end);
}

// Retain each control between bindings, as patchStableDom does during refreshes.
class Control extends EventTarget {
  value = "";
  checked = false;
  disabled = false;
  textContent = "";
  values = {};

  dispatchEvent(event) {
    const result = super.dispatchEvent(event);
    const handler = this[`on${event.type}`];
    if (typeof handler === "function") handler.call(this, event);
    return result && !event.defaultPrevented;
  }

  fire(type) {
    return this.dispatchEvent(new Event(type, { cancelable: true }));
  }
}

const ids = [
  "dashboard-opacity-slider", "dashboard-opacity-value", "dashboard-opacity-reset",
  "dashboard-readability-select", "dashboard-budget-select", "dashboard-autotune-toggle",
  "dashboard-autoface-toggle", "dashboard-settings-form", "dashboard-settings-reset"
];
const controls = new Map(ids.map(id => [id, new Control()]));
const trackingToggle = new Control();
const trackingStatus = new Control();
const calls = { persist: 0, opacity: 0, saves: [], posts: [], selections: [], picker: 0, patches: 0 };
let trackingFailure = false;
const settingsNode = {
  contains: node => [...controls.values(), trackingToggle].includes(node),
  querySelector: selector => selector === "[data-foreground-tracking-setting]" ? trackingToggle : trackingStatus
};
const document = { getElementById: id => controls.get(id), activeElement: null };
const context = vm.createContext({
  document,
  window: {},
  settingsNode,
  dashboardSettings: {},
  defaultSettings: { dashboardOpacity: "100" },
  normalizeOpacityPercent: value => Math.max(35, Math.min(100, Number(value))),
  normalizeChoice: (value, fallback, choices) => choices.includes(value) ? value : fallback,
  applyDashboardOpacity: () => { calls.opacity += 1; },
  persistSettings: () => { calls.persist += 1; },
  saveDashboardSettings: values => { calls.saves.push({ ...values }); },
  bridgeConfig: {},
  bridgeOrigin: "http://localhost",
  buildUrl: (origin, path) => origin + path,
  postJson: (url, payload) => {
    calls.posts.push({ url, payload: { ...payload } });
    return trackingFailure ? Promise.reject(new Error("Tracking unavailable")) : Promise.resolve({ dashboard: payload });
  },
  FormData: class {
    constructor(form) { this.values = form.values; }
    get(key) { return this.values[key] ?? null; }
  },
  renderPicker: () => { calls.picker += 1; },
  selectWidget: id => { calls.selections.push(id); },
  getDefaultSettingValue: key => `default-${key}`,
  settingsRenderInProgress: false,
  pendingSettingsWidgetId: "",
  perfMode: false,
  schedulePendingSettingsRender: () => { throw new Error("Unexpected reentrant render"); },
  getSchemaForWidget: () => null,
  getWidgetState: () => "Ready",
  setText: () => {},
  setStatus: () => {},
  getStateTone: () => "good",
  renderNoSettingsCopy: () => "Ready",
  renderGlobalSettings: () => "global controls",
  renderForegroundTrackingControl: () => "",
  replaceSettingsMarkup: () => { calls.patches += 1; },
  escapeHtml: value => value,
  renderDashboardChromeState: () => {}
});
vm.runInContext([
  "bindGlobalSettings", "bindForegroundTrackingControl", "bindSettingsForm",
  "settingsContainsActiveControl", "renderSettings"
].map(sourceFor).join("\n"), context);

for (let index = 0; index < 3; index += 1) context.bindGlobalSettings();
const slider = controls.get("dashboard-opacity-slider");
slider.value = "62";
slider.fire("input");
assert.equal(calls.opacity, 1, "One opacity input must apply once after repeated bindings");
assert.equal(calls.persist, 0, "Opacity dragging must not persist before change");
slider.fire("change");
assert.equal(calls.persist, 1, "One opacity change must save once");
assert.equal(context.dashboardSettings.dashboardOpacity, "62");
controls.get("dashboard-opacity-reset").fire("click");
assert.equal(calls.persist, 2, "One opacity reset must save once");
assert.equal(slider.value, "100");

for (const [id, value, key] of [
  ["dashboard-readability-select", "clean", "themeReadability"],
  ["dashboard-budget-select", "game", "performanceBudget"],
  ["dashboard-autotune-toggle", "0", "gameModeAutoTune"],
  ["dashboard-autoface-toggle", "1", "gameModeAutoFace"]
]) {
  const control = controls.get(id);
  control.value = value;
  control.checked = value === "1";
  const count = calls.saves.length;
  control.fire("change");
  assert.equal(calls.saves.length, count + 1, `${id} must save once after repeated bindings`);
  assert.deepEqual(calls.saves.at(-1), { [key]: value });
}

for (let index = 0; index < 3; index += 1) context.bindForegroundTrackingControl();
trackingToggle.checked = true;
trackingToggle.fire("change");
assert.equal(calls.posts.length, 1, "One tracking change must make one request");
assert.equal(trackingToggle.disabled, true, "Tracking toggle must disable while saving");
await new Promise(resolve => setImmediate(resolve));
assert.equal(trackingToggle.disabled, false);
assert.equal(trackingStatus.textContent, "Foreground tracking is on.");
assert.equal(context.bridgeConfig.dashboard.foregroundAppTrackingEnabled, true);
trackingFailure = true;
context.bindForegroundTrackingControl();
trackingToggle.checked = false;
trackingToggle.fire("change");
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls.posts.length, 2, "A rebound tracking toggle must still make one request");
assert.equal(trackingToggle.checked, true, "Failed tracking changes must restore the prior value");
assert.equal(trackingToggle.disabled, false);
assert.equal(trackingStatus.textContent, "Tracking unavailable");

const firstSchema = { fields: [{ key: "weatherCity" }] };
const nextSchema = { fields: [{ key: "clockFormat" }] };
const form = controls.get("dashboard-settings-form");
form.values = { weatherCity: "Indianapolis" };
for (let index = 0; index < 3; index += 1) context.bindSettingsForm({ id: "weather" }, firstSchema);
let persistBefore = calls.persist;
assert.equal(form.fire("submit"), false, "Settings submit must prevent browser navigation");
assert.equal(calls.persist, persistBefore + 1, "One form submit must save once after repeated bindings");
assert.equal(context.dashboardSettings.weatherCity, "Indianapolis");
assert.deepEqual(calls.selections, ["weather"]);

// A stable form and reset button can be reused for another widget's schema.
form.values = { clockFormat: "24h" };
context.bindSettingsForm({ id: "clock" }, nextSchema);
persistBefore = calls.persist;
form.fire("submit");
assert.equal(calls.persist, persistBefore + 1, "Switching schemas must replace the old submit handler");
assert.equal(context.dashboardSettings.weatherCity, "Indianapolis", "Obsolete schema must not erase its saved value");
assert.equal(context.dashboardSettings.clockFormat, "24h");
assert.deepEqual(calls.selections, ["weather", "clock"], "Submit must select only the current widget");
persistBefore = calls.persist;
controls.get("dashboard-settings-reset").fire("click");
assert.equal(calls.persist, persistBefore + 1, "Section reset must save once after schema switching");
assert.equal(context.dashboardSettings.weatherCity, "Indianapolis", "Reset must not touch the old schema");
assert.equal(context.dashboardSettings.clockFormat, "default-clockFormat");
assert.deepEqual(calls.selections, ["weather", "clock", "clock"]);
assert.equal(calls.picker, 3, "Each form action must refresh the picker only once");

document.activeElement = slider;
context.renderSettings({ id: "system" });
assert.equal(calls.patches, 0, "Refreshing settings must preserve an active control");
assert.equal(context.pendingSettingsWidgetId, "system");
document.activeElement = null;
context.renderSettings({ id: "system" });
assert.equal(calls.patches, 1, "Settings must render after focus leaves the controls");
assert.equal(context.pendingSettingsWidgetId, "");
persistBefore = calls.persist;
slider.fire("change");
assert.equal(calls.persist, persistBefore + 1, "Rendering the retained controls must not duplicate handlers");

console.log("dashboard settings bindings passed: repeated binding, one action/one save, schema switching, tracking recovery, and active-control preservation");
