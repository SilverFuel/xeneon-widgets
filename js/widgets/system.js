(function () {
  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime || typeof runtime.registerRenderer !== "function") {
    return;
  }

  var addListener = runtime.addListener;
  var buildBridgeUrl = runtime.buildBridgeUrl;
  var clamp = runtime.clamp;
  var createTimerLoop = runtime.createTimerLoop;
  var escapeHtml = runtime.escapeHtml;
  var optionalNumber = runtime.optionalNumber;
  var patchStableDom = runtime.patchStableDom;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var statusTextFromPayload = runtime.statusTextFromPayload;
  var statusToneFromPayload = runtime.statusToneFromPayload;
  var text = runtime.text;

  function normalizeGpuPowerPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      status: text(payload.status, "starting"),
      stale: Boolean(payload.stale),
      source: text(payload.source, "Waiting for GPU sensor source"),
      message: text(payload.message, ""),
      gpuNames: Array.isArray(payload.gpuNames) ? payload.gpuNames : [],
      rtx50SeriesDetected: Boolean(payload.rtx50SeriesDetected),
      sensors: Array.isArray(payload.sensors) ? payload.sensors : [],
      pins: Array.isArray(payload.pins) ? payload.pins : [],
      rails: Array.isArray(payload.rails) ? payload.rails : [],
      power: Array.isArray(payload.power) ? payload.power : [],
      temperatures: Array.isArray(payload.temperatures) ? payload.temperatures : [],
      alerts: Array.isArray(payload.alerts) ? payload.alerts : [],
      totalPower: payload.totalPower || null,
      hottestTemperature: payload.hottestTemperature || null
    };
  }

  function sensorValue(sensor, fallback) {
    if (!sensor) {
      return fallback || "--";
    }

    return text(sensor.displayValue, text(sensor.rawValue, optionalNumber(sensor.value) == null ? (fallback || "--") : String(sensor.value)));
  }

  function formatHz(value) {
    var parsed = runtime.nullableNumber(value);
    return parsed == null ? "--" : Math.round(parsed) + " Hz";
  }

  function displayRefreshRate(display) {
    return runtime.nullableNumber(display && (display.refreshRate != null ? display.refreshRate : display.fps));
  }

  function systemMetricTone(value, warn, danger) {
    var parsed = optionalNumber(value);
    if (parsed == null) {
      return "muted";
    }
    if (parsed >= danger) {
      return "danger";
    }
    if (parsed >= warn) {
      return "warn";
    }
    return "good";
  }

  function selectedDisplayFromDiagnostics(displayDiagnostics) {
    var displays = displayDiagnostics && Array.isArray(displayDiagnostics.displays) ? displayDiagnostics.displays : [];
    var selectedId = text(displayDiagnostics && displayDiagnostics.selectedDisplayId, "");
    return displays.filter(function (display) {
      return display && !display.primary
        && (display.preferred || (selectedId && (display.id === selectedId || display.deviceName === selectedId || display.deviceId === selectedId)));
    })[0] || null;
  }

  function displayTargetReady(displayDiagnostics) {
    var companionCount = optionalNumber(displayDiagnostics && displayDiagnostics.companionDisplayCount);
    return text(displayDiagnostics && displayDiagnostics.status, "").toLowerCase() === "ready"
      && companionCount != null
      && companionCount > 0
      && Boolean(selectedDisplayFromDiagnostics(displayDiagnostics));
  }

  // One plain line on how the PC is doing, and what to look at if it is not fine.
  function buildSystemHealth(data, gpuPower, displayDiagnostics) {
    var alerts = [];
    var warnings = [];
    var cpu = optionalNumber(data && data.cpu);
    var gpu = optionalNumber(data && data.gpu);
    var ram = optionalNumber(data && data.ram);
    var cpuTemp = optionalNumber(data && data.cpuTemp);
    var gpuTemp = optionalNumber(data && data.gpuTemp);

    if (cpu == null && gpu == null && ram == null) {
      return { label: "No readings yet", tone: "warn", detail: "Waiting for this PC's readings." };
    }
    if (data && data.stale) {
      warnings.push("Readings are out of date");
    }
    if (cpu != null && cpu >= 92) {
      alerts.push("CPU is maxed out");
    } else if (cpu != null && cpu >= 78) {
      warnings.push("CPU is busy");
    }
    if (gpu != null && gpu >= 92) {
      alerts.push("GPU is maxed out");
    } else if (gpu != null && gpu >= 82) {
      warnings.push("GPU is busy");
    }
    if (ram != null && ram >= 90) {
      alerts.push("Memory is nearly full");
    } else if (ram != null && ram >= 78) {
      warnings.push("Memory is filling up");
    }
    if (cpuTemp != null && cpuTemp >= 90) {
      alerts.push("CPU is hot");
    }
    if (gpuTemp != null && gpuTemp >= 86) {
      alerts.push("GPU is hot");
    }
    if (gpuPower && gpuPower.alerts && gpuPower.alerts.length) {
      alerts.push("GPU power problem");
    }
    if (displayDiagnostics && !displayTargetReady(displayDiagnostics)) {
      warnings.push("Second screen not found");
    }

    if (alerts.length) {
      return { label: "Needs attention", tone: "danger", detail: alerts.slice(0, 2).join(". ") + "." };
    }
    if (warnings.length) {
      return { label: "Keep an eye on it", tone: "warn", detail: warnings.slice(0, 2).join(". ") + "." };
    }
    return { label: "All good", tone: "good", detail: "Nothing is running hot or full." };
  }

  // "61°C", or nothing when the PC does not report it.
  function temperatureLabel(value) {
    var parsed = runtime.nullableNumber(value);
    return parsed == null || parsed <= 0 ? "" : Math.round(parsed) + "°C";
  }

  // "18.4 of 64 GB", or nothing when the host did not send both figures.
  function memoryLabel(usedBytes, totalBytes) {
    var used = runtime.nullableNumber(usedBytes);
    var total = runtime.nullableNumber(totalBytes);
    if (used == null || total == null || total <= 0 || used < 0) {
      return "";
    }
    var gigabyte = 1024 * 1024 * 1024;
    var totalGb = total / gigabyte;
    return (used / gigabyte).toFixed(1) + " of " + (totalGb >= 10 ? String(Math.round(totalGb)) : totalGb.toFixed(1)) + " GB";
  }

  // "Reading 12 MB/s, writing 3 MB/s", "Idle", or nothing when the host sent neither figure.
  function diskLabel(readBytesPerSecond, writeBytesPerSecond) {
    var read = runtime.nullableNumber(readBytesPerSecond);
    var write = runtime.nullableNumber(writeBytesPerSecond);
    if (read == null && write == null) {
      return "";
    }
    var megabyte = 1024 * 1024;
    var rate = function (value) {
      var megabytes = Math.max(0, value || 0) / megabyte;
      return megabytes >= 10 ? String(Math.round(megabytes)) : megabytes.toFixed(1);
    };
    var parts = [];
    if (read != null && read / megabyte >= 0.05) {
      parts.push("reading " + rate(read) + " MB/s");
    }
    if (write != null && write / megabyte >= 0.05) {
      parts.push("writing " + rate(write) + " MB/s");
    }
    if (!parts.length) {
      return "Idle";
    }
    var line = parts.join(", ");
    return line.charAt(0).toUpperCase() + line.slice(1);
  }

  // Thirty slots, four seconds apart: the last two minutes, newest on the right.
  function renderSystemTrend(values, tone) {
    var samples = Array.isArray(values) ? values.slice(-30) : [];
    var bars = "";
    for (var slot = 0; slot < 30; slot += 1) {
      var index = slot - (30 - samples.length);
      if (index < 0) {
        bars += '<span class="is-empty"></span>';
      } else {
        bars += '<span style="height:' + Math.max(2, clamp(optionalNumber(samples[index]) || 0, 0, 100)).toFixed(0) + '%"></span>';
      }
    }
    return '<div class="system-trend" data-tone="' + escapeHtml(tone || "muted") + '" aria-hidden="true">' + bars + '</div>';
  }

  function renderSystemStatCard(label, percent, side, tone, trend) {
    var parsed = optionalNumber(percent);
    return '' +
      '<article class="system-stat-card" data-ui-key="system-stat-' + escapeHtml(String(label || "metric").toLowerCase()) + '" data-tone="' + escapeHtml(tone || "muted") + '">' +
        '<div class="system-stat-head">' +
          '<span class="system-stat-label">' + escapeHtml(label) + '</span>' +
          (side ? '<span class="system-stat-side">' + escapeHtml(side) + '</span>' : "") +
        '</div>' +
        '<div class="system-stat-value">' + (parsed == null ? "--" : escapeHtml(String(Math.round(clamp(parsed, 0, 100)))) + '<small>%</small>') + '</div>' +
        renderSystemTrend(trend, tone) +
        '<div class="system-trend-caption">Last 2 minutes</div>' +
      '</article>';
  }

  // The second screen Auxora draws on, in one line. Never the Windows primary display.
  function companionScreenLabel(displayDiagnostics) {
    var selected = selectedDisplayFromDiagnostics(displayDiagnostics);
    if (!selected || !displayTargetReady(displayDiagnostics)) {
      return "Not found";
    }
    var parts = [text(displayDiagnostics && displayDiagnostics.selectedDisplayName, text(selected.label, text(selected.name, "Second screen")))];
    var refresh = selected.refreshRate != null ? selected.refreshRate : displayRefreshRate(selected);
    if (runtime.nullableNumber(refresh) != null) {
      parts.push(formatHz(refresh));
    }
    return parts.join(", ");
  }

  function renderSystemFact(label, value) {
    return value ? '<div class="system-fact"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>' : "";
  }

  function renderSystemSide(data, gpuPower, displayDiagnostics, busy) {
    var health = buildSystemHealth(data || {}, gpuPower, displayDiagnostics);
    var hasTemps = Boolean(temperatureLabel(data && data.cpuTemp) || temperatureLabel(data && data.gpuTemp));
    return '' +
      '<aside class="system-side">' +
        '<article class="system-health-card" data-tone="' + escapeHtml(health.tone) + '">' +
          '<strong>' + escapeHtml(health.label) + '</strong>' +
          '<span>' + escapeHtml(health.detail) + '</span>' +
        '</article>' +
        '<div class="system-facts">' +
          renderSystemFact("GPU power", gpuPower && gpuPower.totalPower ? sensorValue(gpuPower.totalPower, "") : "") +
          renderSystemFact("Disk", diskLabel(data && data.diskReadBytesPerSecond, data && data.diskWriteBytesPerSecond)) +
          renderSystemFact("Second screen", displayDiagnostics ? companionScreenLabel(displayDiagnostics) : "") +
          renderSystemFact("Temperatures", hasTemps ? "" : "Not reported by this PC") +
        '</div>' +
        '<div class="system-side-foot">' +
          '<button class="inline-button" type="button" data-action="system-task-manager"' + (busy ? " disabled" : "") + '>Task Manager</button>' +
          '<p>Auxora shows totals only, without listing running applications or process IDs.</p>' +
        '</div>' +
      '</aside>';
  }

  function renderSystemWidget(data, statusText, statusTone, history, displayDiagnostics, busy) {
    data = data || {};
    history = history || {};
    var gpuPower = data.gpuPower || normalizeGpuPowerPayload({});

    return '' +
      '<div class="inline-widget-shell inline-widget-shell--system">' +
        '<div class="system-monitor-cockpit">' +
          '<section class="system-health-strip">' +
            renderSystemStatCard("CPU", data.cpu, temperatureLabel(data.cpuTemp), systemMetricTone(data.cpu, 78, 92), history.cpu) +
            renderSystemStatCard("GPU", data.gpu, temperatureLabel(data.gpuTemp), systemMetricTone(data.gpu, 82, 92), history.gpu) +
            renderSystemStatCard("Memory", data.ram, memoryLabel(data.memoryUsedBytes, data.memoryTotalBytes), systemMetricTone(data.ram, 78, 90), history.ram) +
          '</section>' +
          renderSystemSide(data, gpuPower, displayDiagnostics, busy) +
        '</div>' +
      '</div>';
  }

  runtime.registerHelpers({
    buildSystemHealth: buildSystemHealth,
    renderSystemWidget: renderSystemWidget,
    systemDiskLabel: diskLabel,
    systemMemoryLabel: memoryLabel,
    systemTemperatureLabel: temperatureLabel
  });

  function mountSystemWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: {},
      gpuPower: normalizeGpuPowerPayload({}),
      display: null,
      history: {
        cpu: [],
        gpu: [],
        ram: []
      },
      statusText: "Loading",
      statusTone: "warn",
      busy: false
    };

    function pushHistoryValue(list, value) {
      var parsed = optionalNumber(value);
      if (parsed == null) {
        return;
      }
      list.push(clamp(parsed, 0, 100));
      while (list.length > 30) {
        list.shift();
      }
    }

    function updateHistory(payload) {
      pushHistoryValue(state.history.cpu, payload && payload.cpu);
      pushHistoryValue(state.history.gpu, payload && payload.gpu);
      pushHistoryValue(state.history.ram, payload && payload.ram);
    }

    function redraw() {
      state.data.gpuPower = state.gpuPower;
      patchStableDom(container, renderSystemWidget(state.data, state.statusText, state.statusTone, state.history, state.display, state.busy));
    }

    function refresh() {
      var systemRequest = requestJson(buildBridgeUrl(env, "/api/system"), {}, 5000).then(function (payload) {
        state.data = payload || {};
        updateHistory(state.data);
        state.statusText = statusTextFromPayload(payload, "Live");
        state.statusTone = statusToneFromPayload(payload, "live");
      }, function (error) {
        state.data = {
          source: error.message || "Unavailable"
        };
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
      });

      var gpuPowerRequest = requestJson(buildBridgeUrl(env, "/api/gpu-power"), {}, 5000).then(function (payload) {
        state.gpuPower = normalizeGpuPowerPayload(payload);
        if (state.gpuPower.alerts.length) {
          state.statusText = "GPU Alert";
          state.statusTone = "danger";
        }
      }, function (error) {
        state.gpuPower = normalizeGpuPowerPayload({
          status: "error",
          message: error.message || "GPU power unavailable"
        });
      });

      var displayRequest = requestJson(buildBridgeUrl(env, "/api/display/diagnostics"), {}, 5000).then(function (payload) {
        state.display = payload || null;
      }, function () {
        state.display = null;
      });

      return Promise.all([systemRequest, gpuPowerRequest, displayRequest]).then(function () {
        redraw();
      });
    }

    var loop = createTimerLoop(refresh, 4000);
    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var action = target ? target.getAttribute("data-action") : "";
      if (!action || state.busy) {
        return;
      }

      if (action === "system-task-manager") {
        state.busy = true;
        redraw();
        requestJson(buildBridgeUrl(env, "/api/quick-actions/open-task-manager"), {
          method: "POST"
        }, 5000).then(function () {
          state.statusText = "Task Manager";
          state.statusTone = "good";
        }, function (error) {
          state.statusText = error.message || "Action failed";
          state.statusTone = "danger";
        }).finally(function () {
          state.busy = false;
          redraw();
        });
      }
    });
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        patchStableDom(container, "");
      }
    };
  }

  runtime.registerRenderer("system", mountSystemWidget);
}());
