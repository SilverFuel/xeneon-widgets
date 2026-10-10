import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const dashboard = readFileSync("js/dashboard.js", "utf8");
const inlineWidgets = readFileSync("js/inline-widgets.js", "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `Unable to isolate ${startMarker.trim()}`);
  return source.slice(start, end);
}

function loadFetchWithTimeout(source, nextFunctionName, fakeFetch) {
  const functionSource = sourceBetween(
    source,
    "  function fetchWithTimeout(",
    `\n\n  function ${nextFunctionName}`
  );
  const context = {
    AbortController,
    fetch: fakeFetch,
    window: {
      clearTimeout,
      setTimeout
    }
  };
  vm.runInNewContext(`${functionSource}\nthis.fetchWithTimeoutUnderTest = fetchWithTimeout;`, context);
  return context.fetchWithTimeoutUnderTest;
}

async function verifyAbortableTimeout(source, nextFunctionName, label) {
  const signals = [];
  const fakeFetch = (_url, options) => {
    signals.push(options.signal);
    return new Promise((_resolve, reject) => {
      const rejectForAbort = () => reject(options.signal.reason || new Error("aborted"));
      if (options.signal.aborted) {
        rejectForAbort();
      } else {
        options.signal.addEventListener("abort", rejectForAbort, { once: true });
      }
    });
  };
  const fetchWithTimeout = loadFetchWithTimeout(source, nextFunctionName, fakeFetch);

  await assert.rejects(
    fetchWithTimeout("https://example.invalid/slow", {}, 15),
    error => error?.message === "Request timed out",
    `${label} must retain its timeout error`
  );
  assert.equal(signals.length, 1, `${label} must start exactly one request`);
  assert.equal(signals[0].aborted, true, `${label} must abort the underlying request on timeout`);

  const callerController = new AbortController();
  const callerReason = new Error("caller stopped");
  const callerPromise = fetchWithTimeout(
    "https://example.invalid/caller-abort",
    { signal: callerController.signal },
    1000
  );
  await Promise.resolve();
  callerController.abort(callerReason);
  await assert.rejects(
    callerPromise,
    error => error === callerReason,
    `${label} must preserve caller aborts`
  );
  assert.notEqual(signals[1], callerController.signal, `${label} must keep ownership of its timeout controller`);
  assert.equal(signals[1].aborted, true, `${label} must forward the caller abort to fetch`);
  assert.equal(signals[1].reason, callerReason, `${label} must preserve the caller abort reason`);

  let completedSignal;
  const completedFetch = loadFetchWithTimeout(source, nextFunctionName, (_url, options) => {
    completedSignal = options.signal;
    return Promise.resolve({ ok: true });
  });
  const completedCaller = new AbortController();
  await completedFetch(
    "https://example.invalid/completed",
    { signal: completedCaller.signal },
    1000
  );
  completedCaller.abort(new Error("too late"));
  assert.equal(completedSignal.aborted, false, `${label} must detach the caller signal after completion`);
}

function createRequestHarness(kind, fakeFetch) {
  const source = kind === "inline" ? inlineWidgets : dashboard;
  const helpers = sourceBetween(source, "  function fetchWithTimeout(", kind === "inline"
    ? "\n\n  function addListener("
    : "\n\n  function fetchBridgeHealth(");
  const timers = new Map();
  const requests = [];
  let nextTimerId = 1;
  const context = {
    AbortController,
    fetch(url, options) {
      requests.push({ url, options });
      return fakeFetch(url, options);
    },
    window: {
      XenonSessionToken: "test-session",
      setTimeout(callback, delay) {
        const id = nextTimerId++;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) { timers.delete(id); }
    }
  };
  vm.runInNewContext(helpers, context);
  return {
    context,
    requests,
    timers,
    request(signal) {
      const options = signal ? { signal } : {};
      if (kind === "inline") {
        return context.requestJson("https://example.invalid/request", {
          ...options, method: "POST", body: { enabled: true }
        }, 20);
      }
      if (kind === "post") {
        return context.postJson("https://example.invalid/request", { enabled: true }, 20, options);
      }
      return context.fetchJson("https://example.invalid/request", 20, options);
    },
    expire(delay = 20) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert(entry, `Expected a pending ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
    }
  };
}

function trackedCaller() {
  const controller = new AbortController();
  const listeners = new Set();
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (type, listener, options) => {
    if (type === "abort") listeners.add(listener);
    add(type, listener, options);
  };
  controller.signal.removeEventListener = (type, listener, options) => {
    if (type === "abort") listeners.delete(listener);
    remove(type, listener, options);
  };
  return { controller, listeners };
}

async function flushMicrotasks() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

async function verifyJsonRequestLifetime(kind) {
  const statuses = kind === "get" ? [200] : [200, 503];
  for (const status of statuses) {
    for (const cancellation of ["timeout", "caller"]) {
      let bodyStarted = false;
      let releaseBody;
      const harness = createRequestHarness(kind, (_url, options) => Promise.resolve({
        ok: status === 200,
        status,
        json() {
          bodyStarted = true;
          return new Promise((resolve, reject) => {
            releaseBody = resolve;
            // Model fetch body cancellation, including parsers that catch that rejection.
            options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
          });
        }
      }));
      const caller = trackedCaller();
      const pending = harness.request(caller.controller.signal);
      const reason = new Error("caller stopped reading body");
      const rejection = assert.rejects(pending, error => cancellation === "timeout"
        ? error?.message === "Request timed out"
        : error === reason, `${kind} ${status} must preserve ${cancellation} during body reads`);
      await flushMicrotasks();
      assert(bodyStarted, `${kind} ${status} test must reach the response body`);
      assert.equal(harness.timers.size, 1, `${kind} must retain its deadline after headers arrive`);
      assert.equal(caller.listeners.size, 1, `${kind} must retain caller cancellation after headers arrive`);
      if (cancellation === "timeout") harness.expire();
      else caller.controller.abort(reason);
      await rejection;
      assert.equal(harness.requests.length, 1, `${kind} must never retry a timed-out mutation`);
      assert.equal(harness.requests[0].options.signal.aborted, true, `${kind} must abort the underlying body`);
      assert.equal(harness.timers.size, 0, `${kind} must clear its deadline after cancellation`);
      assert.equal(caller.listeners.size, 0, `${kind} must detach caller cancellation after failure`);
      releaseBody({ late: true });
      await flushMicrotasks();
      assert.equal(harness.requests.length, 1, `${kind} late body completion must not trigger another request`);
    }
  }

  const payload = { enabled: true };
  let completeBody;
  const success = createRequestHarness(kind, () => Promise.resolve({
    ok: true,
    json: () => new Promise(resolve => { completeBody = resolve; })
  }));
  const caller = trackedCaller();
  const successfulRequest = success.request(caller.controller.signal);
  await flushMicrotasks();
  assert.equal(success.timers.size, 1, `${kind} deadline must cover delayed successful bodies`);
  completeBody(payload);
  assert.equal(await successfulRequest, payload, `${kind} must return the parsed payload`);
  assert.equal(success.timers.size, 0, `${kind} must clear its deadline after parsing`);
  assert.equal(caller.listeners.size, 0, `${kind} must detach caller cancellation after parsing`);
  caller.controller.abort(new Error("too late"));
  assert.equal(success.requests[0].options.signal.aborted, false, `${kind} completed requests must stay completed`);
  assert.equal(success.requests.length, 1);
  assert.equal(success.requests[0].options.cache, "no-store");
  if (kind !== "get") {
    assert.equal(success.requests[0].options.method, "POST");
    assert.equal(success.requests[0].options.body, JSON.stringify(payload));
    assert.equal(success.requests[0].options.headers["Content-Type"], "application/json");
  }
  if (kind === "post") assert.equal(success.requests[0].options.headers["X-Xenon-Session"], "test-session");

  const parseFailure = new SyntaxError("malformed JSON");
  const invalid = createRequestHarness(kind, () => Promise.resolve({
    ok: true, json: () => Promise.reject(parseFailure)
  }));
  if (kind === "get") await assert.rejects(invalid.request(), error => error === parseFailure);
  else assert.equal(JSON.stringify(await invalid.request()), "{}", `${kind} must retain its empty-body fallback`);
  assert.equal(invalid.timers.size, 0);

  for (const errorPayload of [{ error: "service error" }, { message: "service message" }, null]) {
    let bodyReads = 0;
    const failed = createRequestHarness(kind, () => Promise.resolve({
      ok: false,
      status: 503,
      json() {
        bodyReads += 1;
        return errorPayload ? Promise.resolve(errorPayload) : Promise.reject(parseFailure);
      }
    }));
    const expected = kind !== "get" && errorPayload
      ? (errorPayload.error || errorPayload.message) : "Request failed with status 503";
    await assert.rejects(failed.request(), error => error?.message === expected, `${kind} HTTP errors must keep their message`);
    assert.equal(bodyReads, kind === "get" ? 0 : 1, `${kind} must preserve its HTTP body handling`);
    assert.equal(failed.timers.size, 0);
  }

  const abortedCaller = trackedCaller();
  const stopped = new Error("already cancelled");
  abortedCaller.controller.abort(stopped);
  const neverStarted = createRequestHarness(kind, () => { throw new Error("must not send"); });
  await assert.rejects(neverStarted.request(abortedCaller.controller.signal), error => error === stopped);
  assert.equal(neverStarted.requests.length, 0, `${kind} must not send an already-cancelled request`);
  assert.equal(neverStarted.timers.size, 0);
  assert.equal(abortedCaller.listeners.size, 0);

  for (const failureMode of ["throw", "reject"]) {
    const networkFailure = new Error("offline");
    const failed = createRequestHarness(kind, () => {
      if (failureMode === "throw") throw networkFailure;
      return Promise.reject(networkFailure);
    });
    const failedCaller = trackedCaller();
    await assert.rejects(failed.request(failedCaller.controller.signal), error => error === networkFailure);
    assert.equal(failed.timers.size, 0, `${kind} must clean up ${failureMode} failures`);
    assert.equal(failedCaller.listeners.size, 0);
  }
  console.log(`${kind} JSON request lifetime: body deadlines, caller cancellation, cleanup, payload/error semantics, and single-send mutations passed`);
}

async function verifyPollingRecovery() {
  let attempt = 0;
  const failures = [];
  const harness = createRequestHarness("inline", () => {
    attempt += 1;
    return Promise.resolve({
      ok: true,
      json: () => attempt === 1 ? new Promise(() => {}) : Promise.resolve({ recovered: true })
    });
  });
  const pollingSource = sourceBetween(inlineWidgets, "  function createTimerLoop(", "\n\n  function ");
  harness.context.document = { hidden: false };
  harness.context.console = { error: (...args) => failures.push(args) };
  vm.runInNewContext(pollingSource, harness.context);
  const loop = harness.context.createTimerLoop(() => harness.request(), 100);
  const firstRefresh = loop.refresh(true);
  await flushMicrotasks();
  await loop.refresh(true);
  assert.equal(attempt, 1, "polling must not overlap a pending body read");
  harness.expire();
  await firstRefresh;
  assert.equal(failures.length, 1, "polling must report the failed request once");
  assert.equal(failures[0][1].message, "Request timed out");
  harness.expire(100);
  await flushMicrotasks();
  assert.equal(attempt, 2, "polling must resume after a stalled response body times out");
  assert.equal(harness.timers.size, 1, "successful polling must schedule only its next refresh");
  loop.destroy();
  assert.equal(harness.timers.size, 0, "disposing polling must clear its next refresh");
  console.log("inline polling recovery after a stalled response body: passed");
}

function createAmbientHarness(reducedMotion) {
  const functionSource = sourceBetween(
    dashboard,
    "  function initAmbientGraphics()",
    "\n\n  function normalizeOpacityPercent"
  );
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  let hidden = false;
  let draws = 0;
  let clock = 0;
  let nextTimerId = 1;
  function scheduleTimer(callback, delayMs = 0) {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, {
      callback,
      due: clock + Math.max(0, Number(delayMs) || 0),
      id
    });
    return id;
  }
  function cancelTimer(id) {
    timers.delete(id);
  }
  function advance(milliseconds) {
    const target = clock + milliseconds;
    while (true) {
      const next = Array.from(timers.values())
        .filter(timer => timer.due <= target)
        .sort((left, right) => left.due - right.due || left.id - right.id)[0];
      if (!next) break;
      timers.delete(next.id);
      clock = next.due;
      next.callback();
    }
    clock = target;
  }
  const drawingContext = {
    beginPath() {},
    clearRect() { draws += 1; },
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setTransform() {},
    stroke() {}
  };
  const canvas = {
    dataset: {},
    getContext() { return drawingContext; },
    style: {}
  };
  const shell = {
    getBoundingClientRect() {
      return { width: 1280, height: 720 };
    }
  };
  const documentObject = {
    get hidden() { return hidden; },
    addEventListener(type, handler) { documentListeners.set(type, handler); },
    getElementById(id) {
      if (id === "dashboard-ambient-canvas") return canvas;
      if (id === "dashboard-stage-shell") return shell;
      return null;
    }
  };
  const windowObject = {
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    cancelAnimationFrame: cancelTimer,
    clearTimeout: cancelTimer,
    devicePixelRatio: 1,
    matchMedia() { return { matches: reducedMotion }; },
    requestAnimationFrame(callback) {
      return scheduleTimer(() => callback(clock), 1);
    },
    setTimeout: scheduleTimer
  };
  const context = {
    ambientCanvasPalette: ["#ffffff"],
    document: documentObject,
    getAnimationIntensityPercent() { return 100; },
    getPerformanceBudget() { return "balanced"; },
    parseHexColor() { return [255, 255, 255]; },
    perfMode: false,
    rgbaFromHex() { return "rgba(255, 255, 255, 0.1)"; },
    window: windowObject
  };
  vm.runInNewContext(`${functionSource}\nthis.initAmbientGraphicsUnderTest = initAmbientGraphics;`, context);

  return {
    advance,
    dispatchDocument(type) { documentListeners.get(type)?.(); },
    dispatchWindow(type) { windowListeners.get(type)?.(); },
    drawCount() { return draws; },
    init: context.initAmbientGraphicsUnderTest,
    setHidden(value) { hidden = value; }
  };
}

await verifyAbortableTimeout(dashboard, "fetchJson", "dashboard fetch");
await verifyAbortableTimeout(inlineWidgets, "requestJson", "inline widget fetch");
for (const kind of ["get", "post", "inline"]) await verifyJsonRequestLifetime(kind);
await verifyPollingRecovery();

assert.match(dashboard, /function fetchJson\(url, timeoutMs, options\)[\s\S]*?fetchWithTimeout\(/, "dashboard reads must use the abortable timeout helper");
assert.match(dashboard, /function postJson\(url, body, timeoutMs, options\)[\s\S]*?fetchWithTimeout\(/, "dashboard writes must use the abortable timeout helper");
assert.match(inlineWidgets, /settings\.signal[\s\S]*?fetchOptions\.signal = settings\.signal/, "inline requests must preserve caller signals");
assert.doesNotMatch(dashboard, /function withTimeout\(/, "dashboard must not leave timed-out fetches running in the background");
assert.match(dashboard, /var ambientFrameIntervalMs = 1000 \/ 15;/, "ambient canvas must be capped at 15 FPS");
assert.match(dashboard, /document\.addEventListener\("visibilitychange"[\s\S]*?pauseAnimation\(\)/, "ambient canvas must pause when the document is hidden");

const ambient = createAmbientHarness(false);
ambient.init();
ambient.advance(420);
const activeDraws = ambient.drawCount();
assert(activeDraws >= 3, `ambient canvas visuals stopped unexpectedly (${activeDraws} frames)`);
assert(activeDraws <= 8, `ambient canvas exceeded its 15 FPS budget (${activeDraws} frames in 420ms)`);

ambient.setHidden(true);
ambient.dispatchDocument("visibilitychange");
const hiddenDraws = ambient.drawCount();
ambient.advance(180);
assert.equal(ambient.drawCount(), hiddenDraws, "ambient canvas must stop drawing while hidden");

ambient.setHidden(false);
ambient.dispatchDocument("visibilitychange");
ambient.advance(180);
assert(ambient.drawCount() > hiddenDraws, "ambient canvas must resume after becoming visible");
ambient.dispatchWindow("pagehide");
const pageHiddenDraws = ambient.drawCount();
ambient.advance(120);
assert.equal(ambient.drawCount(), pageHiddenDraws, "ambient canvas must stop after pagehide");

const reducedMotionAmbient = createAmbientHarness(true);
reducedMotionAmbient.init();
reducedMotionAmbient.advance(100);
assert.equal(reducedMotionAmbient.drawCount(), 0, "reduced-motion mode must keep ambient animation disabled");

console.log("frontend request cancellation and ambient rendering budget: passed");
