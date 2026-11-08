import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const html = readFileSync(new URL("../widgets/frigate-detection-panel.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert.ok(script, "standalone Frigate script must exist");

function harness(search = "?endpoint=%2Fapi%2Ffrigate") {
  const nodes = new Map();
  const timers = new Map();
  const events = new Map();
  const requests = [];
  const warnings = [];
  let nextTimer = 0;
  function element(id) {
    if (!nodes.has(id)) {
      const listeners = new Map();
      nodes.set(id, {
        hidden: false,
        disabled: false,
        textContent: "",
        innerHTML: "",
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, listener) { listeners.set(name, listener); },
        removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
        click() { if (!this.disabled && !this.hidden) return listeners.get("click")?.(); }
      });
    }
    return nodes.get(id);
  }
  runInNewContext(script, {
    URLSearchParams,
    console: { warn: value => warnings.push(value) },
    document: { documentElement: element("root"), getElementById: element },
    window: {
      location: { search },
      clearTimeout(id) { timers.delete(id); },
      setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
      addEventListener(name, callback) { events.set(name, callback); }
    },
    fetch(url) {
      return new Promise((resolve, reject) => requests.push({
        url,
        respond(data) { resolve({ ok: true, json: () => Promise.resolve(data) }); },
        reject
      }));
    }
  });
  return { nodes, timers, events, requests, warnings, refresh: element("frigate-refresh") };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const unconfigured = { configured: false, status: "setup", alerts: [] };
const configured = { configured: true, status: "live", source: "Frigate", alerts: [] };

test("manual refresh recovers from setup and resumes normal polling", async () => {
  const fixture = harness();
  await flush();
  assert.equal(fixture.requests.length, 1);
  fixture.requests[0].respond(unconfigured);
  await flush();
  assert.equal(fixture.timers.size, 0, "unconfigured panels must stop background polling");
  assert.equal(fixture.refresh.hidden, false);
  assert.equal(fixture.refresh.disabled, false);
  assert.match(fixture.nodes.get("alert-list").innerHTML, /After saving, select Refresh/);

  fixture.refresh.click();
  fixture.refresh.click();
  await flush();
  assert.equal(fixture.requests.length, 2, "repeated clicks must not overlap requests");
  assert.equal(fixture.refresh.disabled, true);
  assert.equal(fixture.refresh.textContent, "Refreshing");
  assert.equal(fixture.timers.size, 0);
  fixture.requests[1].respond(configured);
  await flush();
  assert.equal(fixture.nodes.get("frigate-status").textContent, "Frigate");
  assert.equal(fixture.refresh.disabled, false);
  assert.equal(fixture.refresh.textContent, "Refresh");
  assert.equal(fixture.timers.size, 1);
  assert.equal([...fixture.timers.values()][0].delay, 30000);

  fixture.refresh.click();
  await flush();
  assert.equal(fixture.timers.size, 0, "a manual request replaces the pending poll");
  fixture.requests[2].respond(configured);
  await flush();
  assert.equal(fixture.timers.size, 1, "refresh must leave only one polling loop");
});

test("one-shot refresh leaves polling paused while setup is still missing", async () => {
  const fixture = harness();
  await flush();
  fixture.requests[0].respond(unconfigured);
  await flush();
  fixture.refresh.click();
  await flush();
  fixture.requests[1].respond(unconfigured);
  await flush();
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.refresh.disabled, false);
});

test("a failed manual request releases the refresh button", async () => {
  const fixture = harness();
  await flush();
  fixture.requests[0].respond(unconfigured);
  await flush();
  fixture.refresh.click();
  await flush();
  fixture.requests[1].reject(new Error("Connection unavailable"));
  await flush();
  assert.equal(fixture.nodes.get("frigate-status").textContent, "Unavailable");
  assert.equal(fixture.refresh.disabled, false);
  assert.equal(fixture.timers.size, 0, "a failed refresh must retain the known setup pause");
  fixture.refresh.click();
  await flush();
  assert.equal(fixture.requests.length, 3);
  fixture.requests[2].respond(configured);
  await flush();
  assert.equal(fixture.timers.size, 1);
});

test("static and missing-endpoint panels do not offer a nonfunctional refresh", async () => {
  for (const search of ["", "?endpoint=%2Fapi%2Ffrigate&payload=" + encodeURIComponent(JSON.stringify(unconfigured))]) {
    const fixture = harness(search);
    await flush();
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.refresh.hidden, true);
    assert.equal(fixture.timers.size, 0);
    assert.doesNotMatch(fixture.nodes.get("alert-list").innerHTML, /select Refresh/);
  }
});

test("unloading removes refresh handling and prevents further polling", async () => {
  const fixture = harness();
  await flush();
  fixture.events.get("beforeunload")();
  fixture.requests[0].respond(configured);
  await flush();
  fixture.refresh.click();
  await flush();
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.timers.size, 0);
});
