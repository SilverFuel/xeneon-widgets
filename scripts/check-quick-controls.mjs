import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../js/quick-controls.js", import.meta.url), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

class Control extends EventTarget {
  disabled = true;
  textContent = "";
  value = "0";
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  fire(type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, properties);
    this.dispatchEvent(event);
    return event;
  }
}

function createHarness() {
  let now = Date.parse("2026-10-10T12:00:00Z");
  let nextTimer = 0;
  const timers = new Map();
  const nodes = new Map(["volume", "volume-value", "mute", "playback", "audio-status", "media-status"]
    .map(id => [id, new Control()]));
  const root = new Control();
  root.querySelector = selector => nodes.get(selector.replace("#dashboard-quick-", ""));
  const document = new Control();
  document.hidden = false;
  const window = new Control();
  const schedule = (callback, delay, repeat) => {
    const id = ++nextTimer;
    timers.set(id, { callback, due: now + delay, repeat });
    return id;
  };
  window.setInterval = (callback, delay) => schedule(callback, delay, delay);
  window.clearInterval = id => timers.delete(id);
  window.setTimeout = (callback, delay) => schedule(callback, delay, 0);
  class FakeDate extends Date { static now() { return now; } }
  const capabilities = { audio: true, media: true };
  const data = {
    audio: { supported: true, configured: true, status: "live", stale: false, masterVolume: 42, muted: false, defaultDeviceId: "fixture-speakers" },
    media: { supported: true, configured: true, status: "live", stale: false, playbackStatus: "playing", canPlay: true, canPause: true }
  };
  const reads = [];
  const writes = [];
  const queuedReads = { audio: [], media: [] };
  const snapshot = (kind, overrides = {}) => ({ sampledAt: new Date(now).toISOString(), ...data[kind], ...overrides });
  // There is deliberately no fetch, native bridge or real timer in this VM.
  vm.runInNewContext(source, { window, document, Date: FakeDate, AbortController, Promise, Number }, { filename: "quick-controls.js" });
  const controller = window.AuxoraQuickControls.create({
    root,
    available: kind => capabilities[kind],
    get: (path, signal) => {
      const kind = path.slice("/api/".length);
      assert.ok(kind === "audio" || kind === "media", `Unexpected read: ${path}`);
      const pending = queuedReads[kind].shift();
      reads.push({ kind, signal });
      if (pending) {
        pending.signal = signal;
        // A held request intentionally ignores abort so generation checks must
        // still reject its late response, just like an uncooperative transport.
        return pending.promise;
      }
      return Promise.resolve(snapshot(kind));
    },
    post: (path, body) => {
      const pending = deferred();
      writes.push({ path, body: { ...body }, ...pending });
      return pending.promise;
    }
  });
  return {
    root, document, window, nodes, capabilities, data, reads, writes, timers, controller, snapshot,
    node: id => nodes.get(id),
    async open() { controller.open(); await flush(); },
    async reopen() { controller.close(); controller.open(); await flush(); },
    holdRead(kind) {
      const pending = deferred();
      queuedReads[kind].push(pending);
      return pending;
    },
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const entry = [...timers.entries()].filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!entry) break;
        const [id, timer] = entry;
        now = timer.due;
        if (timer.repeat) timer.due += timer.repeat;
        else timers.delete(id);
        timer.callback();
        await flush();
      }
      now = target;
      await flush();
    },
    async settleWrite(index, kind, overrides = {}) {
      Object.assign(data[kind], overrides);
      writes[index].resolve(snapshot(kind));
      await flush();
    }
  };
}

let passed = 0;
async function check(name, test) {
  const harness = createHarness();
  try {
    await test(harness);
    passed += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  } finally {
    harness.controller.close();
  }
}
const ready = node => !node.disabled && node.getAttribute("aria-disabled") !== "true";

await check("drawer-scoped read-only polling", async h => {
  await h.advance(10000);
  assert.equal(h.reads.length, 0);
  assert.equal(h.writes.length, 0);
  await h.open();
  assert.deepEqual(h.reads.map(read => read.kind), ["audio", "media"]);
  assert.equal(h.node("volume").value, "42");
  assert.equal(h.node("mute").textContent, "Mute");
  assert.equal(h.node("playback").textContent, "Pause");
  await h.advance(5000);
  assert.ok(h.reads.length >= 6);
  assert.equal(h.writes.length, 0);
  h.controller.close();
  const count = h.reads.length;
  await h.advance(10000);
  assert.equal(h.reads.length, count);
  assert.ok(["mute", "volume", "playback"].every(id => h.node(id).disabled));
});

await check("visibility and page lifecycle", async h => {
  await h.open();
  for (const lifecycle of ["visibility", "page"]) {
    if (lifecycle === "visibility") { h.document.hidden = true; h.document.fire("visibilitychange"); }
    else h.window.fire("pagehide");
    const count = h.reads.length;
    assert.equal(h.timers.size, 0);
    assert.equal(h.node("mute").disabled, true);
    await h.advance(10000);
    assert.equal(h.reads.length, count);
    if (lifecycle === "visibility") { h.document.hidden = false; h.document.fire("visibilitychange"); }
    else h.window.fire("pageshow");
    await flush();
    assert.equal(h.reads.length, count + 2);
    assert.ok(ready(h.node("mute")));
  }
});

await check("serialize writes across reopen without optimistic success", async h => {
  await h.open();
  h.node("mute").fire("click");
  await flush();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].body, { muted: true });
  assert.equal(h.node("mute").textContent, "Mute");
  assert.equal(h.node("mute").getAttribute("aria-disabled"), "true");
  assert.equal(h.node("audio-status").textContent, "Applying…");
  assert.equal(h.node("volume").fire("keydown", { key: "ArrowRight" }).defaultPrevented, true);
  const reads = h.reads.length;
  await h.reopen();
  h.node("mute").fire("click");
  h.node("playback").fire("click");
  await h.advance(3000);
  assert.equal(h.writes.length, 1);
  assert.equal(h.reads.length, reads);
  await h.settleWrite(0, "audio", { muted: true });
  assert.equal(h.node("mute").textContent, "Unmute");
  assert.ok(ready(h.node("mute")));
});

await check("failed and unconfirmed commands never retry", async h => {
  await h.open();
  for (const outcome of ["rejected", "unchanged", "malformed"]) {
    const count = h.writes.length;
    h.node("mute").fire("click");
    h.node("mute").fire("click");
    await flush();
    assert.equal(h.writes.length, count + 1);
    if (outcome === "rejected") h.writes[count].reject(new Error("Fixture timeout"));
    else h.writes[count].resolve(outcome === "unchanged" ? h.snapshot("audio") : {});
    await flush();
    assert.equal(h.node("mute").disabled, true);
    assert.match(h.node("audio-status").textContent, /Could not confirm/);
    await h.advance(1000);
    assert.equal(h.node("mute").disabled, true);
    await h.advance(2000);
    assert.ok(ready(h.node("mute")));
    assert.equal(h.node("mute").textContent, "Mute");
    assert.equal(h.writes.length, count + 1);
  }
});

await check("volume preview and explicit playback commands", async h => {
  await h.open();
  h.node("volume").value = "67";
  h.node("volume").fire("input");
  assert.equal(h.node("volume-value").textContent, "67%");
  assert.equal(h.writes.length, 0);
  h.node("volume").fire("change");
  h.node("volume").fire("change");
  await flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].path, "/api/audio/master-volume");
  assert.deepEqual(h.writes[0].body, { volume: 67 });
  assert.equal(h.node("volume-value").textContent, "42%");
  await h.settleWrite(0, "audio", { masterVolume: 67 });
  assert.equal(h.node("volume-value").textContent, "67%");
  for (const [index, action, state, label] of [[1, "pause", "paused", "Play"], [2, "play", "playing", "Pause"]]) {
    h.node("playback").fire("click");
    await flush();
    assert.equal(h.writes[index].path, `/api/media/${action}`);
    assert.deepEqual(h.writes[index].body, {});
    await h.settleWrite(index, "media", { playbackStatus: state });
    assert.equal(h.node("playback").textContent, label);
  }
});

await check("cancel and ignore reads across close and action", async h => {
  await h.open();
  for (const operation of ["close", "action"]) {
    const oldRead = h.holdRead("audio");
    await h.advance(2000);
    assert.ok(oldRead.signal);
    if (operation === "close") {
      h.data.audio.masterVolume = 81;
      await h.reopen();
    } else {
      h.node("mute").fire("click");
      await flush();
      await h.settleWrite(0, "audio", { muted: true });
    }
    assert.equal(oldRead.signal.aborted, true);
    oldRead.resolve(h.snapshot("audio", { masterVolume: 13, muted: false }));
    await flush();
    assert.equal(h.node("volume").value, "81");
    if (operation === "action") assert.equal(h.node("mute").textContent, "Unmute");
  }
});

await check("capabilities are independent", async h => {
  h.capabilities.audio = false;
  await h.open();
  assert.deepEqual(h.reads.map(read => read.kind), ["media"]);
  assert.equal(h.node("volume").disabled, true);
  assert.ok(ready(h.node("playback")));
  h.capabilities.audio = true;
  h.capabilities.media = false;
  await h.advance(1000);
  assert.ok(ready(h.node("volume")));
  assert.equal(h.node("playback").disabled, true);
  h.node("playback").fire("click");
  assert.equal(h.writes.length, 0);
});

await check("read failures invalidate only their channel and recover", async h => {
  await h.open();
  const failedRead = h.holdRead("audio");
  await h.advance(2000);
  failedRead.reject(new Error("Fixture read failure"));
  await flush();
  assert.equal(h.node("mute").disabled, true);
  assert.equal(h.node("volume").disabled, true);
  assert.ok(ready(h.node("playback")));
  assert.match(h.node("audio-status").textContent, /Could not read audio/);
  await h.advance(2000);
  assert.ok(ready(h.node("mute")) && ready(h.node("volume")));
  assert.equal(h.writes.length, 0);
});

await check("observations expire while reads stall", async h => {
  await h.open();
  h.holdRead("audio");
  h.holdRead("media");
  await h.advance(9000);
  assert.equal(h.node("volume").disabled, true);
  assert.equal(h.node("mute").disabled, true);
  assert.ok(ready(h.node("playback")));
  h.node("mute").fire("click");
  await h.advance(12000);
  assert.equal(h.node("playback").disabled, true);
  h.node("playback").fire("click");
  assert.equal(h.writes.length, 0);
});

await check("malformed and stale snapshots cannot enable actions", async h => {
  const common = [{ supported: false }, { supported: "true" }, { configured: false }, { status: "error" }, { stale: true }, { sampledAt: null }, { sampledAt: "not-a-date" }, { sampledAt: "2026-10-10T13:00:00Z" }];
  const cases = {
    audio: [...common, { masterVolume: null }, { masterVolume: "42" }, { masterVolume: NaN }, { masterVolume: Infinity }, { masterVolume: -1 }, { masterVolume: 101 }, { muted: null }, { muted: "false" }, { defaultDeviceId: " " }, { sampledAt: "2026-10-10T11:59:51Z" }],
    media: [...common, { playbackStatus: "unknown" }, { playbackStatus: "playing", canPause: false }, { playbackStatus: "playing", canPause: "true" }, { playbackStatus: "paused", canPlay: false }, { playbackStatus: "stopped", canPlay: false }, { sampledAt: "2026-10-10T11:59:39Z" }]
  };
  for (const kind of ["audio", "media"]) {
    const good = { ...h.data[kind] };
    for (const invalid of cases[kind]) {
      h.data[kind] = { ...good, ...invalid };
      await h.reopen();
      const action = h.node(kind === "audio" ? "mute" : "playback");
      assert.equal(action.disabled, true, JSON.stringify({ kind, invalid }));
      if (kind === "audio") assert.equal(h.node("volume").disabled, true);
      action.fire("click");
    }
    h.data[kind] = good;
  }
  await h.reopen();
  assert.ok(ready(h.node("mute")) && ready(h.node("playback")));
  assert.equal(h.writes.length, 0);
});

console.log(`Quick controls regression checks passed (${passed} groups; fake clock, no network or device actions).`);
