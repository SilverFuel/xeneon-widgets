import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../js/widgets/product.js", import.meta.url), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
const pending = { status: "pending", supported: false, displays: [], primaryExcluded: true, scope: "companion-only", message: "Checking companion controls; the primary display is excluded." };
const ready = { status: "ready", supported: true, message: "Companion controls ready", displays: [{ index: 0, name: "Fixture companion", brightnessSupported: true, brightness: 42, contrastSupported: true, contrast: 60, inputSupported: true, inputSource: 17, powerSupported: true }] };

function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(initial = pending) {
  let now = 0, nextTimer = 0, active = 0, maxActive = 0;
  const timers = new Map(), listeners = new Map(), renderers = new Map();
  const responses = [initial], calls = [], statuses = [];
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  const root = {
    innerHTML: "", nodes: [], ownerDocument: document,
    contains(node) { return this.nodes.includes(node); },
    querySelectorAll(selector) { return this.nodes.filter(node => selector.split(",").some(part => node.matches(part.trim()))); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  function render(html) {
    // Replacing nodes drops focus like removing the real pending/ready subtree.
    // Production's stable reconciler can retain nodes; this is the stricter case.
    if (root.contains(document.activeElement)) document.activeElement = document.body;
    root.innerHTML = html;
    root.nodes = [...html.matchAll(/<(?:div|input|button)\b([^>]+)>/g)].map(([, attributes]) => {
      const values = new Map([...attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? ""]));
      return {
        getAttribute: name => values.get(name) ?? null,
        hasAttribute: name => values.has(name),
        matches(selector) { const match = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/); return !!match && values.has(match[1]) && (match[2] === undefined || values.get(match[1]) === match[2]); },
        focus() { document.activeElement = this; }
      };
    });
  }
  const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const window = {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    InlineWidgets: { runtime: {
      registerRenderer: (id, renderer) => renderers.set(id, renderer),
      addListener(cleanups, _root, type, handler) { listeners.set(type, handler); cleanups.push(() => listeners.delete(type)); },
      runCleanups(cleanups) { while (cleanups.length) cleanups.pop()(); },
      buildBridgeUrl: (_env, path) => path,
      escapeHtml,
      text: (value, fallback) => value == null || value === "" ? fallback : String(value),
      patchStableDom: (_container, html) => { render(html); },
      productShell: (_kicker, _title, copy, status, _tone, body) => `${copy}<strong>${escapeHtml(status)}</strong>${body}`,
      statusPill: value => `<span>${escapeHtml(value)}</span>`,
      initXnSlider() {},
      requestJson(path, options, timeout) {
        assert.equal(path, "/api/displays/controls");
        assert.equal(timeout, 8000);
        assert.ok(options.signal instanceof AbortSignal);
        calls.push({ method: options.method || "GET", body: options.body, signal: options.signal });
        active += 1;
        maxActive = Math.max(maxActive, active);
        const response = responses.length ? responses.shift() : pending;
        // Held requests deliberately ignore abort, exercising late-result ownership.
        const result = response instanceof Error ? Promise.reject(response) : Promise.resolve(response?.promise || response);
        return result.finally(() => { active -= 1; });
      }
    } }
  };
  class FakeDate extends Date { static now() { return now; } }
  // No real fetch, timer, native bridge, browser, or hardware exists in this VM.
  vm.runInNewContext(source, { window, Date: FakeDate, AbortController, Promise }, { filename: "widgets/product.js" });
  const controller = renderers.get("display-controls")({}, root, { publishStatus: (...status) => statuses.push(status) });
  return {
    root, document, calls, statuses, timers, listeners, controller,
    get maxActive() { return maxActive; },
    queue(value) { responses.push(value); },
    fire(type, attributes, value) {
      const target = {
        value,
        hasAttribute: name => Object.hasOwn(attributes, name),
        getAttribute: name => attributes[name] ?? null,
        closest(selector) { return this.hasAttribute(selector.slice(1, -1)) ? this : null; }
      };
      listeners.get(type)?.({ target });
    },
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const entry = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!entry) break;
        const [id, timer] = entry;
        timers.delete(id);
        now = timer.due;
        timer.callback();
        await flush();
      }
      now = target;
      await flush();
    }
  };
}

let passed = 0;
async function check(name, test, initial) {
  const harness = createHarness(initial);
  try {
    await flush();
    await test(harness);
    assert.equal(harness.maxActive, 1, "requests must never overlap");
    passed += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  } finally {
    harness.controller.destroy();
  }
}

await check("pending becomes ready without hardware writes", async h => {
  assert.equal(h.statuses.at(-1)[0], "Checking");
  assert.match(h.root.innerHTML, /Checking companion controls/);
  assert.match(h.root.innerHTML, /role="status" aria-live="polite"/);
  assert.doesNotMatch(h.root.innerHTML, /Unavailable|No companion DDC\/CI controls found|data-monitor-control/);
  assert.equal(h.timers.size, 1);
  h.queue(ready);
  await h.advance(1000);
  assert.equal(h.statuses.at(-1)[0], "Ready");
  assert.match(h.root.innerHTML, /Brightness 42%/);
  assert.match(h.root.innerHTML, /Contrast 60%/);
  assert.match(h.root.innerHTML, /Input source: HDMI 1/);
  assert.match(h.root.innerHTML, /Turn off Fixture companion/);
  assert.equal(h.timers.size, 0);
  await h.advance(30000);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.method === "GET"));
});

await check("pending must not render stale controls", async h => {
  assert.equal(h.statuses.at(-1)[0], "Checking");
  assert.doesNotMatch(h.root.innerHTML, /data-monitor-control|data-monitor-power/);
}, { ...pending, displays: ready.displays });

await check("terminal limited capabilities remain usable", async h => {
  assert.equal(h.statuses.at(-1)[0], "Limited");
  assert.match(h.root.innerHTML, /Input source: HDMI 1/);
  assert.match(h.root.innerHTML, /data-monitor-power/);
  assert.doesNotMatch(h.root.innerHTML, /data-monitor-control="brightness"|data-monitor-control="contrast"/);
  assert.equal(h.timers.size, 0);
}, { ...ready, supported: false, displays: [{ ...ready.displays[0], brightnessSupported: false, contrastSupported: false }] });

await check("a later fresh query gets a new bounded checking window", async h => {
  await h.advance(60000);
  h.queue(pending);
  await h.controller.refresh();
  assert.equal(h.statuses.at(-1)[0], "Checking");
  assert.equal(h.timers.size, 1);
  h.queue(ready);
  await h.advance(1000);
  assert.equal(h.statuses.at(-1)[0], "Ready");
  assert.equal(h.timers.size, 0);
}, ready);

for (const terminal of [
  { status: "unavailable", supported: false, displays: [], message: "Monitor query could not be completed" },
  { status: "unsupported", supported: false, displays: [], message: "No supported companion controls" }
]) {
  await check(`pending becomes ${terminal.status}`, async h => {
    h.queue(terminal);
    await h.advance(1000);
    assert.equal(h.statuses.at(-1)[0], "Unavailable");
    assert.match(h.root.innerHTML, new RegExp(terminal.message));
    if (terminal.status === "unavailable") {
      assert.match(h.root.innerHTML, /Companion controls unavailable/);
      assert.doesNotMatch(h.root.innerHTML, /No companion DDC\/CI controls found/);
    }
    assert.equal(h.timers.size, 0);
    await h.advance(30000);
    assert.equal(h.calls.length, 2);
  });
}

await check("request failure stops polling and allows explicit retry", async h => {
  h.queue(new Error("Fixture query failed"));
  await h.advance(1000);
  assert.equal(h.statuses.at(-1)[0], "Unavailable");
  assert.match(h.root.innerHTML, /Companion controls unavailable/);
  assert.match(h.root.innerHTML, /Fixture query failed/);
  assert.match(h.root.innerHTML, /data-monitor-retry/);
  assert.doesNotMatch(h.root.innerHTML, /No companion DDC\/CI controls found|Checking companion controls/);
  assert.equal(h.timers.size, 0);
  await h.advance(30000);
  assert.equal(h.calls.length, 2);
  h.queue(ready);
  h.fire("click", { "data-monitor-retry": "" });
  await flush();
  assert.equal(h.statuses.at(-1)[0], "Ready");
});

await check("bounded polling pauses until manual retry", async h => {
  await h.advance(60000);
  assert.ok(h.calls.length > 1 && h.calls.length <= 16);
  assert.equal(h.timers.size, 0);
  assert.equal(h.statuses.at(-1)[0], "Still checking");
  assert.match(h.root.innerHTML, /Automatic checks have paused/);
  assert.match(h.root.innerHTML, /data-monitor-retry/);
  const count = h.calls.length;
  await h.controller.refresh();
  await h.advance(60000);
  assert.equal(h.calls.length, count, "incidental refresh must not restart exhausted polling");
  h.fire("click", { "data-monitor-retry": "" });
  await flush();
  assert.equal(h.calls.length, count + 1);
  assert.equal(h.statuses.at(-1)[0], "Checking");
  assert.equal(h.timers.size, 1);
  h.queue(ready);
  await h.advance(1000);
  assert.equal(h.statuses.at(-1)[0], "Ready");
});

await check("destroy cancels a queued retry", async h => {
  const count = h.statuses.length;
  h.controller.destroy();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  await h.advance(30000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.statuses.length, count);
  assert.equal(h.root.innerHTML, "");
});

for (const outcome of ["resolve", "reject"]) {
  await check(`destroy ignores late ${outcome}`, async h => {
    const held = deferred();
    h.queue(held);
    await h.advance(1000);
    const request = h.controller.refresh();
    assert.equal(request, h.controller.refresh());
    assert.equal(h.calls.length, 2);
    assert.equal(h.timers.size, 0);
    h.controller.destroy();
    assert.equal(h.calls.at(-1).signal.aborted, true);
    const count = h.statuses.length;
    held[outcome](outcome === "resolve" ? ready : new Error("Late fixture failure"));
    await request;
    assert.equal(h.statuses.length, count);
    assert.equal(h.timers.size, 0);
    assert.equal(h.root.innerHTML, "");
  });
}

await check("successful write pending response rechecks without claiming stale values", async h => {
  const held = deferred();
  h.queue(held);
  h.root.querySelector('[data-monitor-control="brightness"]').focus();
  h.fire("change", { "data-monitor-control": "brightness", "data-monitor-index": "0" }, "65");
  const request = h.controller.refresh();
  assert.match(h.root.innerHTML, /Applying monitor change/);
  assert.doesNotMatch(h.root.innerHTML, /data-monitor-control|data-monitor-power/);
  assert.equal(h.document.activeElement.hasAttribute("data-monitor-status"), true);
  h.fire("change", { "data-monitor-control": "brightness", "data-monitor-index": "0" }, "66");
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].method, "POST");
  assert.equal(h.calls[1].body.value, 65);
  held.resolve(pending);
  await request;
  assert.equal(h.statuses.at(-1)[0], "Checking");
  assert.doesNotMatch(h.root.innerHTML, /brightness updated|Brightness 42%|data-monitor-control/);
  assert.equal(h.timers.size, 1);
  h.queue({ ...ready, displays: [{ ...ready.displays[0], brightness: 65 }] });
  await h.advance(1000);
  assert.equal(h.statuses.at(-1)[0], "Ready");
  assert.match(h.root.innerHTML, /Brightness 65%/);
  assert.equal(h.document.activeElement.getAttribute("data-monitor-control"), "brightness");
  assert.equal(h.calls.filter(call => call.method === "POST").length, 1);
}, ready);

await check("pending completion does not steal focus after user moves away", async h => {
  h.root.querySelector('[data-monitor-control="contrast"]').focus();
  h.queue(pending);
  h.fire("change", { "data-monitor-control": "contrast", "data-monitor-index": "0" }, "70");
  await flush();
  assert.equal(h.document.activeElement.hasAttribute("data-monitor-status"), true);
  const otherControl = {};
  h.document.activeElement = otherControl;
  h.queue(ready);
  await h.advance(1000);
  assert.equal(h.document.activeElement, otherControl);
}, ready);

await check("focused manual retry has a visible focus destination through pending", async h => {
  await h.advance(30000);
  h.root.querySelector("[data-monitor-retry]").focus();
  h.fire("click", { "data-monitor-retry": "" });
  await flush();
  assert.equal(h.document.activeElement.hasAttribute("data-monitor-status"), true);
  h.queue(ready);
  await h.advance(1000);
  assert.equal(h.document.activeElement.hasAttribute("data-monitor-control"), true);
});

console.log(`checked ${passed} isolated Display Controls pending/lifecycle regressions`);
