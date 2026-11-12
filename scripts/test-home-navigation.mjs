import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const product = readFileSync(new URL("../js/widgets/product.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");
const home = product.slice(product.indexOf("  function mountAuxoraHomeWidget("), product.indexOf("  function mountScenesWidget("));
const setupSource = dashboard.slice(dashboard.indexOf("  function openSetupSection("), dashboard.indexOf("  function buildInlineWidgetEnv("));
const settle = () => new Promise(resolve => setImmediate(resolve));

function homeHarness() {
  const container = { html: "" }, document = {}, window = { setTimeout, clearTimeout };
  const events = new Map(), calls = [], selections = [], receipts = [];
  let resolveAction, rejectAction;
  const pending = new Promise((resolve, reject) => { resolveAction = resolve; rejectAction = reject; });
  const payloads = {
    "/api/scenes": { activeScene: { id: "scene-work", name: "Work" } },
    "/api/system": { cpu: null, ram: null }, "/api/network": { ping: null },
    "/api/calendar": { configured: false, entries: [] },
    "/api/action-chains": { chains: [{ id: "focus", name: "Focus", description: "Work Profile and quiet notifications" }] }
  };
  const context = {
    document, window, Date, Promise, Set,
    addListener(cleanups, node, type, handler) { if (node === container) events.set(type, handler); cleanups.push(() => events.delete(type)); },
    runCleanups: cleanups => cleanups.splice(0).forEach(fn => fn()),
    patchStableDom: (node, html) => { node.html = html; },
    productShell: (...args) => args.at(-1), escapeHtml: value => String(value),
    text: (value, fallback) => value == null || value === "" ? fallback : String(value),
    buildBridgeUrl: (_env, path) => path,
    requestJson(url, options) { calls.push({ url, options }); return url === "/api/action-chains/execute" ? pending : Promise.resolve(payloads[url]); }
  };
  runInNewContext(home, context);
  const controller = context.mountAuxoraHomeWidget({ id: "home" }, container, {
    selectWidget: (...args) => selections.push(args), applySceneSnapshot: receipt => receipts.push(receipt),
    activateScene: () => { throw new Error("An executed setup must not activate the Mode again"); }
  });
  function click(attribute, value) {
    const target = { closest: selector => selector === `[${attribute}]` ? target : null, getAttribute: name => name === attribute ? value : null };
    events.get("click")({ target });
  }
  return { container, controller, click, calls, selections, receipts, resolveAction, rejectAction };
}

test("Home cards are labeled native buttons and open their matching panels", async () => {
  const h = homeHarness(); await settle();
  for (const [label, id] of [["View performance", "system"], ["Open Network", "network"], ["Open Calendar", "calendar"]]) {
    assert.match(h.container.html, new RegExp(`data-home-open="${id}"[\\s\\S]*?${label}`));
    h.click("data-home-open", id);
    assert.deepEqual(h.selections.at(-1), [id, true]);
  }
  assert.match(h.container.html, /<button type="button" class="metric-card/);
  assert.equal((h.container.html.match(/data-home-open="system"/g) || []).length, 1, "CPU and memory share one Performance destination");
  assert.match(h.container.html, /Memory Used/);
  assert.match(h.container.html, /<details[^>]*data-ui-key="home-setups"/);
  assert.doesNotMatch(h.container.html, /<details[^>]*\sopen(?:[\s=>])/);
  assert.match(h.container.html, /Not connected/);
  assert.doesNotMatch(h.container.html, /metric-value">0%/);
  h.controller.destroy();
});

test("One-tap setup blocks repeated input, applies its receipt once, and displays completion", async () => {
  const h = homeHarness(); await settle();
  h.click("data-action-chain", "focus"); h.click("data-action-chain", "focus");
  assert.equal(h.calls.filter(call => call.url.endsWith("/execute")).length, 1);
  assert.match(h.container.html, /data-action-chain="focus" disabled/);
  const scene = { activeScene: { id: "scene-work" } };
  h.resolveAction({ scene, message: "Setup applied" }); await settle();
  assert.equal(h.receipts.length, 1); assert.equal(h.receipts[0], scene);
  assert.match(h.container.html, /role="status">Setup applied/);
  assert.doesNotMatch(h.container.html, /data-action-chain="focus" disabled/);
  h.controller.destroy();
});

test("Failed one-tap setup announces the failure and restores its controls", async () => {
  const h = homeHarness(); await settle(); h.click("data-action-chain", "focus");
  h.rejectAction(new Error("Could not apply setup")); await settle();
  assert.match(h.container.html, /role="status">Could not apply setup/);
  assert.doesNotMatch(h.container.html, /data-action-chain="focus" disabled/);
  assert.equal(h.receipts.length, 0);
  h.controller.destroy();
});

function setupHarness() {
  const calls = [];
  const context = {
    requestedSetupSection: "", isTouchLockEnabled: () => context.locked,
    selectWidget: (...args) => calls.push([...args, context.requestedSetupSection])
  };
  runInNewContext(setupSource, context);
  return { context, calls };
}
test("Integration setup actions select the correct form, preserve the route, and clear the one-time request", () => {
  for (const id of ["weather", "calendar", "hue", "frigate"]) {
    const h = setupHarness(); h.context.openSetupSection(id);
    assert.deepEqual(h.calls, [["setup", true, id]]);
    assert.equal(h.context.requestedSetupSection, "");
  }
});
test("Touch Lock blocks integration setup navigation", () => {
  const locked = setupHarness(); locked.context.locked = true; locked.context.openSetupSection("frigate");
  assert.equal(locked.calls.length, 0);
});
