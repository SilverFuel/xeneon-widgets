(function () {
  "use strict";

  var WINDOW_MS = 180000;
  var KEYS = ["cpu", "gpu", "ram", "diskRead", "diskWrite", "download", "upload", "cpuTemp", "gpuTemp"];

  function number(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }

  function escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function fresh(payload, now, ttl, timestamp) {
    var at = Date.parse(arguments.length > 3 ? timestamp : payload.sampledAt);
    return payload.supported !== false && payload.stale !== true
      && ["error", "unsupported", "starting", "stale"].indexOf(payload.status) === -1
      && Number.isFinite(at) && at <= now + 1000 && now - at <= ttl;
  }

  function normalizeTelemetry(system, network, power, now) {
    system = system || {};
    network = network || {};
    power = power || {};
    var systemReady = fresh(system, now, 10000);
    // Ping samples have their own cadence and cannot freshen throughput readings.
    var networkAt = Object.prototype.hasOwnProperty.call(network, "throughputSampledAt")
      ? network.throughputSampledAt : network.sampledAt;
    var networkReady = network.type !== "none" && fresh(network, now, 12000, networkAt);
    var thermalReady = Boolean(system.temperatureSampledAt)
      && fresh({ sampledAt: system.temperatureSampledAt }, now, 35000);
    var values = {};
    var times = {};
    function collect(key, value, ready, at, maximum) {
      var parsed = number(value);
      values[key] = ready && (maximum == null || parsed <= maximum) ? parsed : null;
      times[key] = Date.parse(at);
    }
    ["cpu", "gpu", "ram"].forEach(function (key) { collect(key, system[key], systemReady, system.sampledAt, 100); });
    collect("diskRead", system.diskReadBytesPerSecond, systemReady, system.sampledAt);
    collect("diskWrite", system.diskWriteBytesPerSecond, systemReady, system.sampledAt);
    collect("download", network.download, networkReady, networkAt);
    collect("upload", network.upload, networkReady, networkAt);
    collect("cpuTemp", system.cpuTemp, thermalReady, system.temperatureSampledAt, 150);
    collect("gpuTemp", system.gpuTemp, thermalReady, system.temperatureSampledAt, 150);
    var used = systemReady ? number(system.memoryUsedBytes) : null;
    var total = systemReady ? number(system.memoryTotalBytes) : null;
    return {
      values: values,
      times: times,
      memoryDetail: used != null && total != null && used <= total ? bytes(used) + " of " + bytes(total) : "Physical memory in use",
      gpuWatts: fresh(power, now, 15000) ? number(power.totalPower && power.totalPower.value) : null,
      available: KEYS.filter(function (key) { return values[key] != null; }).length
    };
  }

  function newHistory() {
    var history = {};
    KEYS.forEach(function (key) { history[key] = []; });
    return history;
  }

  function appendHistory(history, snapshot, now) {
    KEYS.forEach(function (key) {
      var samples = history[key];
      var value = snapshot.values[key];
      var at = value == null ? now : snapshot.times[key];
      var last = samples[samples.length - 1];
      // A repeated server snapshot is not a new measurement.
      if (Number.isFinite(at) && (!last || at > last.at)) samples.push({ at: at, value: value });
      while (samples.length && (samples[0].at < now - WINDOW_MS || samples.length > 96)) samples.shift();
    });
  }

  function graphPath(samples, maximum, now, gapMs) {
    var previous = null;
    return samples.map(function (sample) {
      if (number(sample.value) == null || sample.at < now - WINDOW_MS || sample.at > now + 1000) {
        previous = null;
        return "";
      }
      var x = Math.max(0, Math.min(400, 400 * (sample.at - now + WINDOW_MS) / WINDOW_MS));
      var y = 94 - Math.min(sample.value / maximum, 1) * 88;
      var command = !previous || sample.at - previous.at > gapMs ? "M" : "L";
      previous = sample;
      return command + x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ");
  }

  function bytes(value) {
    if (number(value) == null) return "Unavailable";
    var units = ["B", "KiB", "MiB", "GiB", "TiB"];
    var index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
    return value.toFixed(index ? 1 : 0) + " " + units[index];
  }

  function percent(value) { return value == null ? "Unavailable" : value.toFixed(1) + "%"; }
  function temperature(value) { return value == null ? "Unavailable" : value.toFixed(1) + " °C"; }
  function rate(value) { return value == null ? "Unavailable" : value.toFixed(1) + " Mbps"; }
  function diskRate(value) { return value == null ? "Unavailable" : bytes(value) + "/s"; }

  function renderPage(state) {
    var snapshot = state.snapshot;
    var values = snapshot.values;
    var cards = [
      { id: "cpu", title: "CPU", keys: ["cpu"], labels: ["Utilization"], format: percent, max: 100, detail: "Total processor load" },
      { id: "gpu", title: "GPU", keys: ["gpu"], labels: ["Utilization"], format: percent, max: 100, detail: snapshot.gpuWatts == null ? "Graphics engine load" : snapshot.gpuWatts.toFixed(1) + " W GPU power" },
      { id: "ram", title: "Memory", keys: ["ram"], labels: ["In use"], format: percent, max: 100, detail: snapshot.memoryDetail },
      { id: "disk", title: "Disk activity", keys: ["diskRead", "diskWrite"], labels: ["Read", "Write"], format: diskRate, detail: "All physical disks" },
      { id: "network", title: "Network", keys: ["download", "upload"], labels: ["Download", "Upload"], format: rate, detail: "Active primary adapter" },
      { id: "thermal", title: "Temperature", keys: ["cpuTemp", "gpuTemp"], labels: ["CPU", "GPU"], format: temperature, max: 120, detail: "Available hardware sensors", gapMs: 35000 }
    ];
    var status = state.paused ? "Paused" : snapshot.available ? "Live" : "Waiting for telemetry";
    var tmog = state.tmog || {};
    return '<div class="tmog-companion">' +
      '<header class="tmog-toolbar"><div><p class="tmog-eyebrow">Performance at a glance</p><h2>TMOG Companion</h2>' +
      '<p class="tmog-source">Live readings from Auxora. Open TMOG for processes and advanced tools.</p></div>' +
      '<div class="tmog-controls"><span class="tmog-status" data-live="' + (!state.paused && snapshot.available > 0) + '">' + status + '</span>' +
      '<button type="button" class="inline-button" data-tmog-action="pause" aria-pressed="' + state.paused + '">' + (state.paused ? "Resume" : "Pause") + '</button>' +
      '<button type="button" class="inline-button" data-tmog-action="refresh"' + (state.paused ? " disabled" : "") + '>Refresh</button>' +
      '<button type="button" class="inline-button tmog-open" data-tmog-action="open"' + (tmog.installed !== true || state.opening ? " disabled" : "") + '>' + (state.opening ? "Opening..." : "Open TMOG") + '</button></div></header>' +
      '<div class="tmog-notice" role="status" aria-live="polite">' + escape(state.notice || "") + '</div>' +
      '<section class="tmog-grid" aria-label="System performance">' + cards.map(function (card) {
        var maximum = card.max || Math.max.apply(Math, [1].concat(card.keys.flatMap(function (key) {
          return state.history[key].map(function (sample) { return sample.value || 0; });
        })));
        var scale = card.max ? card.format(card.max) : card.format(maximum);
        var hasHistory = card.keys.some(function (key) { return state.history[key].some(function (sample) { return sample.value != null; }); });
        return '<article class="tmog-card" data-ui-key="tmog-' + card.id + '"><div class="tmog-card-head"><h3>' + card.title + '</h3><span>' + (card.max ? "" : "Auto scale · ") + escape(scale) + '</span></div>' +
          '<div class="tmog-readings">' + card.keys.map(function (key, index) {
            return '<div class="tmog-reading tmog-series-' + index + '"><span>' + card.labels[index] + '</span><strong' + (values[key] == null ? ' class="tmog-unavailable"' : "") + '>' + escape(card.format(values[key])) + '</strong></div>';
          }).join("") + '</div><div class="tmog-graph">' +
          '<svg viewBox="0 0 400 100" preserveAspectRatio="none" role="img" aria-label="' + card.title + ' history, last three minutes"><path class="tmog-gridlines" d="M0 6H400 M0 50H400 M0 94H400 M100 6V94 M200 6V94 M300 6V94"/>' +
          card.keys.map(function (key, index) {
            return '<path class="tmog-line tmog-series-' + index + '" d="' + graphPath(state.history[key], maximum, state.now, card.gapMs || 10000) + '"/>';
          }).join("") + '</svg>' + (!hasHistory ? '<span class="tmog-empty">Waiting for samples</span>' : "") +
          '</div><div class="tmog-card-footer"><span>' + escape(card.detail) + '</span><span>3 min</span></div></article>';
      }).join("") + '</section><footer class="tmog-footer"><span>' + escape(tmog.installed === true ? "TMOG " + (tmog.version || "installed") + " available on this PC" : tmog.message || "Checking for TMOG...") + '</span>' +
      '<span>' + (state.paused ? "History paused" : "Updates every 3 seconds") + ' · Gaps mean no measurement</span></footer></div>';
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { normalizeTelemetry: normalizeTelemetry, newHistory: newHistory, appendHistory: appendHistory, graphPath: graphPath, bytes: bytes, renderPage: renderPage };
    return;
  }

  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime) return;

  function mountCompanion(widget, container, env) {
    var cleanups = [];
    var disposed = false;
    var refreshGeneration = 0;
    var state = { snapshot: normalizeTelemetry({}, {}, {}, Date.now()), history: newHistory(), now: Date.now(), paused: false, opening: false, notice: "", tmog: {}, tmogCheckedAt: 0 };
    function redraw() { if (!disposed) runtime.patchStableDom(container, renderPage(state)); }
    function get(path) {
      return runtime.requestJson(runtime.buildBridgeUrl(env, path), {}, 4500).catch(function () { return {}; });
    }
    function refresh() {
      if (state.paused || disposed) return Promise.resolve();
      var generation = refreshGeneration;
      var tmogRequest = Date.now() - state.tmogCheckedAt > 30000 ? get("/api/tmog") : Promise.resolve(state.tmog);
      return Promise.all([get("/api/system"), get("/api/network"), get("/api/gpu-power"), tmogRequest]).then(function (payloads) {
        if (disposed || state.paused) return;
        // The timer coalesces concurrent requests. Replace a pre-pause or manually
        // invalidated request before publishing it when the user resumes/refreshes.
        if (generation !== refreshGeneration) return refresh();
        state.now = Date.now();
        state.snapshot = normalizeTelemetry(payloads[0], payloads[1], payloads[2], state.now);
        appendHistory(state.history, state.snapshot, state.now);
        if (payloads[3] !== state.tmog) state.tmogCheckedAt = state.now;
        state.tmog = payloads[3] || {};
        if (typeof state.tmog.installed !== "boolean") state.tmog = { installed: false, message: "TMOG integration requires the updated Auxora Windows host." };
        redraw();
      });
    }
    var loop = runtime.createTimerLoop(refresh, 3000, function () { return state.paused; });
    runtime.addListener(cleanups, container, "click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-tmog-action]") : null;
      if (!button || button.disabled) return;
      var action = button.getAttribute("data-tmog-action");
      if (action === "pause") {
        refreshGeneration += 1;
        state.paused = !state.paused;
        redraw();
        if (!state.paused) loop.refresh();
      } else if (action === "refresh") {
        refreshGeneration += 1;
        state.tmogCheckedAt = 0;
        loop.refresh();
      } else if (action === "open" && state.tmog.installed === true && !state.opening) {
        state.opening = true;
        state.notice = "";
        redraw();
        runtime.requestJson(runtime.buildBridgeUrl(env, "/api/quick-actions/open-tmog"), { method: "POST" }, 6000).then(function () {
          state.notice = "TMOG opened in its own window.";
        }, function (error) {
          state.notice = error.message || "TMOG could not be opened.";
        }).finally(function () { state.opening = false; redraw(); });
      }
    });
    redraw();
    loop.start();
    return {
      refresh: loop.refresh,
      destroy: function () {
        disposed = true;
        loop.destroy();
        runtime.runCleanups(cleanups);
        runtime.patchStableDom(container, "");
      }
    };
  }
  runtime.registerRenderer("tmog", mountCompanion);
}());
