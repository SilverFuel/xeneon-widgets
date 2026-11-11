import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const themes = createRequire(import.meta.url)("../js/themes.js");
const product = readFileSync(new URL("../js/widgets/product.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");
function sourceFor(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `Missing production function ${name}`);
  const end = source.indexOf("\n  }\n", start + 1);
  assert.ok(end > start, `Missing end of production function ${name}`);
  return source.slice(start, end + 4);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function container() {
  const handlers = new Map();
  return {
    html: "", renders: 0,
    contains: node => Boolean(node?.owned),
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
    fire(type, target) { for (const fn of [...(handlers.get(type) || [])]) fn({ type, target, preventDefault() {} }); },
    count(type) { return handlers.get(type)?.size || 0; }
  };
}
const settings = { themeId: "focus", accentMode: "custom", customAccentColor: "#d4ac63", dashboardOpacity: "100" };
const saves = [];
const timers = new Map();
let timerId = 0;
let requestImpl = () => Promise.resolve({ log: [] });
const document = { activeElement: null };
const context = vm.createContext({
  document,
  window: { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } },
  addListener(cleanups, target, type, fn) { target.addEventListener(type, fn); cleanups.push(() => target.removeEventListener(type, fn)); },
  runCleanups: cleanups => cleanups.splice(0).forEach(remove => remove()),
  patchStableDom(target, html) { target.html = html; target.renders++; },
  productShell(kicker, title, copy, status, tone, html) { return `<output>${status}</output>${html}`; },
  productThemes: () => themes.list,
  findById: (list, id) => list.find(item => item.id === id) || list[0],
  settingValue: (env, key, fallback) => settings[key] ?? fallback,
  saveSettings(env, values) { saves.push({ ...values }); Object.assign(settings, values); },
  escapeHtml: value => String(value ?? ""), text: (value, fallback) => value || fallback,
  initXnSlider() {}, statusPill: () => "", buildBridgeUrl: (env, path) => path,
  requestJson: (...args) => requestImpl(...args), Promise
});
vm.runInContext(sourceFor(product, "mountThemeStudioWidget") + "\n" + sourceFor(product, "mountPrivacyWidget"), context);

// Mount production Appearance once, then refresh the stable DOM repeatedly.
const appearance = container();
const controller = context.mountThemeStudioWidget({ id: "theme-studio" }, appearance, { bridgeConfig: { dashboard: {} } });
for (let i = 0; i < 3; i++) await controller.refresh();
assert.equal(appearance.count("input"), 1);
assert.equal(appearance.count("change"), 1);
for (const name of ["dashboardOpacity", "themeReadability", "performanceBudget", "gameModeAutoTune", "gameModeAutoFace"]) {
  assert.ok(appearance.html.includes(`name="${name}"`), `${name} remains available in Appearance`);
}
const form = { getAttribute: key => key === "data-form" ? "theme-studio" : null,
  elements: { accentMode: { value: "custom" }, customAccentColor: { value: "#d4ac63", disabled: false } } };
const body = { owned: false, getAttribute: key => key === "data-theme" ? "focus" : null };
const field = (name, value) => ({ name, value, form, owned: true, matches: () => true,
  closest: selector => selector === "[data-theme]" ? body : null });
const opacity = field("dashboardOpacity", "62");
appearance.fire("click", opacity);
assert.equal(saves.length, 0, "A control under themed body must not select a preset or reset custom accent");
appearance.fire("input", opacity);
assert.equal(saves.length, 1, "One opacity input saves once after repeated refreshes");
assert.deepEqual(saves.at(-1), { dashboardOpacity: "62" });
for (const [name, value] of [["themeReadability", "clean"], ["performanceBudget", "game"], ["gameModeAutoTune", "0"], ["gameModeAutoFace", "1"]]) {
  const before = saves.length;
  appearance.fire("change", field(name, value));
  assert.equal(saves.length, before + 1, `${name} saves exactly once`);
  assert.deepEqual(saves.at(-1), { [name]: value });
}
const preset = { owned: true, getAttribute: key => key === "data-theme" ? "focus" : null };
preset.closest = selector => /data-theme/.test(selector) ? preset : null;
const beforePreset = saves.length;
appearance.fire("click", preset);
assert.equal(saves.length, beforePreset + 1, "A real preset remains selectable once");
assert.equal(settings.accentMode, "preset");
// The picker is driven by the theme table: one swatch per theme, one tap applies and saves.
const swatchIds = [...appearance.html.matchAll(/class="product-swatch[^"]*"[^>]*data-theme="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(swatchIds, themes.list.map(theme => theme.id), "Appearance shows one swatch per theme, in table order");
for (const theme of themes.list) {
  const swatch = { owned: true, getAttribute: key => key === "data-theme" ? theme.id : null };
  swatch.closest = selector => /data-theme/.test(selector) ? swatch : null;
  const beforeSwatch = saves.length;
  appearance.fire("click", swatch);
  assert.equal(saves.length, beforeSwatch + 1, `${theme.name} applies with one tap`);
  assert.equal(saves.at(-1).themeId, theme.id);
  assert.match(appearance.html, new RegExp(`class="product-swatch is-selected"[^>]*data-theme="${theme.id}"`), `${theme.name} shows as selected after the tap`);
}
themes.list.push({ id: "example-17", name: "Example", scheme: "dark", page: "#101014", surface: "#1a1a22", text: "#f0f0f5", accent: "#7cc4ff", secondary: "#ffd27c" });
try {
  await controller.refresh();
  assert.match(appearance.html, /data-theme="example-17"/, "A theme added to the table appears in the picker with no other change");
} finally {
  themes.list.pop();
  await controller.refresh();
}
assert.match(appearance.html, /data-opacity-reset/, "Reset opacity remains reachable after sidebar removal");
const resetOpacity = { owned: true, hasAttribute: name => name === "data-opacity-reset", getAttribute: name => name === "data-opacity-reset" ? "" : null };
resetOpacity.closest = selector => /data-opacity-reset/.test(selector) ? resetOpacity : null;
const beforeReset = saves.length;
appearance.fire("click", resetOpacity);
assert.equal(saves.length, beforeReset + 1, "Reset opacity saves exactly once");
assert.deepEqual(saves.at(-1), { dashboardOpacity: "100" });
document.activeElement = opacity;
const beforeRefresh = appearance.renders;
await controller.refresh(); await controller.refresh();
assert.equal(appearance.renders, beforeRefresh, "Focused Appearance controls survive background refresh");
document.activeElement = null;
appearance.fire("focusout", opacity);
for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
assert.equal(appearance.renders, beforeRefresh + 1, "Deferred redraw resumes once focus leaves");
controller.destroy();
const beforeDestroyInput = saves.length;
appearance.fire("input", opacity);
assert.equal(saves.length, beforeDestroyInput, "Destroyed Appearance handlers cannot save");
assert.equal(timers.size, 0);

const privacy = container();
const privacyEnv = { bridgeConfig: { dashboard: { foregroundAppTrackingEnabled: false } } };
const privacyController = context.mountPrivacyWidget({ id: "privacy" }, privacy, privacyEnv);
await flush();
for (let i = 0; i < 3; i++) await privacyController.refresh();
const posts = [];
let resolvePost, rejectPost;
requestImpl = (url, options) => { posts.push({ url, body: { ...options.body } }); return new Promise((resolve, reject) => { resolvePost = resolve; rejectPost = reject; }); };
const tracking = { checked: true, hasAttribute: name => name === "data-foreground-tracking", owned: true };
privacy.fire("change", tracking);
assert.equal(posts.length, 1, "One tracking change makes one request after repeated refreshes");
assert.deepEqual(posts[0], { url: "/api/config/dashboard", body: { foregroundAppTrackingEnabled: true } });
assert.match(privacy.html, /data-foreground-tracking[^>]*disabled/, "Tracking is disabled while saving");
resolvePost({ dashboard: { foregroundAppTrackingEnabled: true } }); await flush();
assert.equal(privacyEnv.bridgeConfig.dashboard.foregroundAppTrackingEnabled, true);
assert.match(privacy.html, /Foreground tracking enabled/);
assert.doesNotMatch(privacy.html, /data-foreground-tracking[^>]*disabled/);
tracking.checked = false;
privacy.fire("change", tracking);
assert.equal(posts.length, 2);
rejectPost(new Error("Tracking unavailable")); await flush();
assert.match(privacy.html, /data-foreground-tracking checked/, "Failed tracking update restores the last confirmed value");
assert.match(privacy.html, /Tracking unavailable/);
assert.doesNotMatch(privacy.html, /data-foreground-tracking[^>]*disabled/);
privacyController.destroy(); privacy.fire("change", tracking);
assert.equal(posts.length, 2, "Destroyed Privacy handlers cannot send requests");

// Repeated binding and schema switching still apply to Weather's local form.
class Control extends EventTarget {
  values = {};
  dispatchEvent(event) { const result = super.dispatchEvent(event); this[`on${event.type}`]?.call(this, event); return result && !event.defaultPrevented; }
  fire(type) { return this.dispatchEvent(new Event(type, { cancelable: true })); }
}
const localForm = new Control(), reset = new Control(), localSettings = {}, selected = [];
let persisted = 0, renders = 0;
const localContext = vm.createContext({
  document: { getElementById: id => id === "dashboard-settings-form" ? localForm : id === "dashboard-settings-reset" ? reset : null },
  FormData: class { constructor(control) { this.values = control.values; } get(key) { return this.values[key] ?? null; } },
  dashboardSettings: localSettings, persistSettings: () => persisted++, renderPicker: () => renders++, renderSectionNavigation: () => renders++,
  selectWidget: id => selected.push(id), getDefaultSettingValue: key => `default-${key}`
});
vm.runInContext(sourceFor(dashboard, "bindSettingsForm"), localContext);
localForm.values = { city: "Indianapolis" };
for (let i = 0; i < 3; i++) localContext.bindSettingsForm({ id: "weather" }, { fields: [{ key: "city" }] });
assert.equal(localForm.fire("submit"), false, "Local form prevents browser navigation");
assert.equal(persisted, 1); assert.equal(localSettings.city, "Indianapolis");
localForm.values = { units: "imperial" };
localContext.bindSettingsForm({ id: "weather" }, { fields: [{ key: "units" }] }); localForm.fire("submit");
assert.equal(persisted, 2); assert.equal(localSettings.city, "Indianapolis"); assert.equal(localSettings.units, "imperial");
reset.fire("click");
assert.equal(persisted, 3, "Reset acts only once on the current schema");
assert.equal(localSettings.city, "Indianapolis"); assert.equal(localSettings.units, "default-units");
assert.deepEqual(selected, ["weather", "weather", "weather"]); assert.equal(renders, 3);
console.log("settings handlers passed: mounted Appearance/Privacy, one event/one action, accent ancestry, focus deferral, cleanup, tracking recovery, and local schema rebinding");
