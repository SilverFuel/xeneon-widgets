import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { normalizeTelemetry, newHistory, appendHistory, graphPath, bytes, renderPage } = require("../js/widgets/tmog-companion.js");
const now = 1800000000000;
const at = new Date(now).toISOString();
function system(overrides = {}) {
  return { status: "live", sampledAt: at, cpu: 0, gpu: 34.5, ram: 50, memoryUsedBytes: 32 * 1024 ** 3, memoryTotalBytes: 64 * 1024 ** 3,
    diskReadBytesPerSecond: 0, diskWriteBytesPerSecond: 2048, cpuTemp: 61, gpuTemp: 48, temperatureSampledAt: at, ...overrides };
}
function snapshot(overrides = {}) {
  return normalizeTelemetry(system(overrides), { status: "live", sampledAt: at, type: "ethernet", download: 0, upload: 10 }, {}, now);
}

test("zero stays measured zero and missing or invalid values stay unavailable", () => {
  const result = snapshot();
  assert.equal(result.values.cpu, 0);
  assert.equal(result.values.diskRead, 0);
  assert.equal(result.values.download, 0);
  assert.equal(result.memoryDetail, "32.0 GiB of 64.0 GiB");
  for (const cpu of [undefined, null, "", "0", false, NaN, Infinity, -1, 101]) {
    assert.equal(snapshot({ cpu }).values.cpu, null);
  }
});

test("stale, future, and unsupported readings are not plotted as live", () => {
  for (const overrides of [{ stale: true }, { supported: false }, { status: "starting" }, { status: "error" },
    { sampledAt: new Date(now - 11000).toISOString() }, { sampledAt: new Date(now + 5000).toISOString() }]) {
    assert.equal(snapshot(overrides).values.cpu, null);
  }
  assert.equal(snapshot({ temperatureSampledAt: new Date(now - 36000).toISOString() }).values.cpuTemp, null);
  assert.equal(snapshot({ temperatureSampledAt: undefined }).values.cpuTemp, null);
  assert.equal(normalizeTelemetry({}, { type: "none", sampledAt: at, download: 0 }, {}, now).values.download, null);
});

test("a fresh ping cannot refresh stale throughput or duplicate throughput history", () => {
  const network = { status: "live", sampledAt: at, type: "ethernet", download: 12, upload: 3 };
  for (const throughputSampledAt of [null, undefined, "invalid", new Date(now - 13000).toISOString()]) {
    const result = normalizeTelemetry({}, { ...network, throughputSampledAt }, {}, now);
    assert.equal(result.values.download, null);
    assert.equal(result.values.upload, null);
  }
  const history = newHistory();
  const measuredAt = new Date(now - 2000).toISOString();
  appendHistory(history, normalizeTelemetry({}, { ...network, throughputSampledAt: measuredAt }, {}, now), now);
  appendHistory(history, normalizeTelemetry({}, { ...network, sampledAt: new Date(now + 1000).toISOString(), throughputSampledAt: measuredAt }, {}, now + 1000), now + 1000);
  assert.deepEqual(history.download, [{ at: now - 2000, value: 12 }]);
  assert.equal(normalizeTelemetry({}, network, {}, now).values.download, 12, "older hosts retain sampledAt compatibility");
});

test("history deduplicates repeated samples and bounds memory", () => {
  const history = newHistory();
  appendHistory(history, snapshot(), now);
  appendHistory(history, snapshot(), now + 2000);
  assert.equal(history.cpu.length, 1);
  for (let index = 1; index <= 200; index++) {
    const current = now + index * 3000;
    appendHistory(history, normalizeTelemetry(system({ sampledAt: new Date(current).toISOString() }), {}, {}, current), current);
  }
  assert.ok(history.cpu.length <= 61);
  assert.ok(history.cpu[0].at >= now + 600000 - 180000);
});

test("charts break at unavailable samples and time gaps", () => {
  const path = graphPath([
    { at: now - 50000, value: 5 }, { at: now - 47000, value: 10 },
    { at: now - 44000, value: null }, { at: now - 41000, value: 0 }, { at: now, value: 12 }
  ], 100, now, 10000);
  assert.equal((path.match(/M/g) || []).length, 3);
  assert.equal((path.match(/L/g) || []).length, 1);
  assert.doesNotMatch(path, /NaN|Infinity/);
});

test("rendered content identifies the data source, escapes messages, and does not enable an absent app", () => {
  const html = renderPage({ snapshot: snapshot(), history: newHistory(), now, paused: false, opening: false,
    tmog: { installed: false, message: '<img src=x onerror="alert(1)">' }, notice: "<script>bad</script>" });
  assert.match(html, /Live readings from Auxora/);
  assert.match(html, /data-tmog-action="open" disabled/);
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /0\.0%/);
  assert.equal((html.match(/class="tmog-card"/g) || []).length, 6);
  assert.equal(bytes(null), "Unavailable");
  assert.equal(bytes(0), "0 B");
});

function mountFixture(request) {
  const calls = [];
  const renders = [];
  let html = "", click, mount, refresh;
  let disposed = false;
  const runtime = {
    registerRenderer: (id, fn) => { assert.equal(id, "tmog"); mount = fn; },
    patchStableDom: (_container, value) => { html = value; renders.push(value); },
    buildBridgeUrl: (_env, path) => path,
    addListener: (_cleanups, _container, _event, fn) => { click = fn; },
    runCleanups: () => {},
    createTimerLoop: fn => {
      let inFlight = false;
      refresh = () => {
        if (disposed || inFlight) return Promise.resolve();
        inFlight = true;
        return Promise.resolve(fn()).finally(() => { inFlight = false; });
      };
      return { start: refresh, refresh, destroy: () => { disposed = true; } };
    },
    requestJson: async (path, options) => {
      calls.push({ path, options });
      if (request) {
        const response = request(path, options);
        if (response !== undefined) return response;
      }
      if (path === "/api/system") return system({ sampledAt: new Date().toISOString(), temperatureSampledAt: new Date().toISOString() });
      if (path === "/api/tmog") return { installed: true, version: "1.1.1.0" };
      return {};
    }
  };
  runInNewContext(readFileSync(new URL("../js/widgets/tmog-companion.js", import.meta.url), "utf8"), { window: { InlineWidgets: { runtime } }, Date, Promise });
  const widget = mount({}, {}, {});
  return {
    widget, calls, renders, refresh,
    html: () => html, disposed: () => disposed,
    click: action => click({ target: { closest: () => ({ getAttribute: () => action, disabled: false }) } })
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("mount only reads telemetry; TMOG opens only after its button is pressed", async () => {
  const fixture = mountFixture();
  await settle();
  assert.equal(fixture.calls.filter(call => call.options.method === "POST").length, 0);
  fixture.click("open");
  await settle();
  const mutations = fixture.calls.filter(call => call.options.method === "POST");
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].path, "/api/quick-actions/open-tmog");
  assert.match(fixture.html(), /TMOG opened in its own window/);
  fixture.widget.destroy();
});

test("pause stops requests, resume restarts them, and destroy prevents redraws", async () => {
  const fixture = mountFixture();
  await settle();
  fixture.click("pause");
  const count = fixture.calls.length;
  await fixture.refresh();
  assert.equal(fixture.calls.length, count);
  assert.match(fixture.html(), /History paused/);
  fixture.click("pause");
  await settle();
  assert.ok(fixture.calls.length > count);
  const pending = fixture.refresh();
  fixture.widget.destroy();
  await pending;
  assert.equal(fixture.html(), "");
  assert.equal(fixture.disposed(), true);
});

test("resume discards pre-pause responses and requests a new sample before updating", async () => {
  const pending = [];
  const fixture = mountFixture(path => path === "/api/system" ? new Promise(resolve => pending.push(resolve)) : undefined);
  assert.equal(pending.length, 1);
  fixture.click("pause");
  fixture.click("pause");
  assert.equal(pending.length, 1, "the timer must coalesce resume while a request is in flight");
  pending.shift()(system({ cpu: 75, sampledAt: new Date().toISOString() }));
  await settle();
  assert.equal(pending.length, 1, "resume requests a replacement after the old batch settles");
  assert.ok(fixture.renders.every(html => !html.includes("75.0%")), "pre-pause data must never be published");
  pending.shift()(system({ cpu: 25, sampledAt: new Date().toISOString() }));
  await settle();
  assert.match(fixture.html(), /25\.0%/);
  fixture.widget.destroy();
});

test("refresh during a pending batch replaces it and retries TMOG detection", async () => {
  const pending = [];
  const fixture = mountFixture(path => path === "/api/system" ? new Promise(resolve => pending.push(resolve)) : undefined);
  fixture.click("refresh");
  pending.shift()(system({ cpu: 75, sampledAt: new Date().toISOString() }));
  await settle();
  assert.equal(pending.length, 1);
  assert.equal(fixture.calls.filter(call => call.path === "/api/tmog").length, 2);
  assert.ok(fixture.renders.every(html => !html.includes("75.0%")));
  pending.shift()(system({ cpu: 25, sampledAt: new Date().toISOString() }));
  await settle();
  assert.match(fixture.html(), /25\.0%/);
  fixture.widget.destroy();
});

test("a null TMOG response leaves telemetry usable and launching disabled", async () => {
  const fixture = mountFixture(path => path === "/api/tmog" ? Promise.resolve(null) : undefined);
  await settle();
  assert.match(fixture.html(), /0\.0%/);
  assert.match(fixture.html(), /data-tmog-action="open" disabled/);
  assert.match(fixture.html(), /requires the updated Auxora Windows host/);
  fixture.widget.destroy();
});
