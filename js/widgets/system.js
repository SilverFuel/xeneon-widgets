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
  var formatPercent = runtime.formatPercent;
  var formatTemp = runtime.formatTemp;
  var optionalNumber = runtime.optionalNumber;
  var patchStableDom = runtime.patchStableDom;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var statusPill = runtime.statusPill;
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

  function primaryDisplayFromSystem(data) {
    return (data && (data.primaryDisplay || data.display)) || {};
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

  function buildSystemHealth(data, gpuPower, displayDiagnostics) {
    var alerts = [];
    var warnings = [];
    var cpu = optionalNumber(data && data.cpu);
    var gpu = optionalNumber(data && data.gpu);
    var ram = optionalNumber(data && data.ram);
    var cpuTemp = optionalNumber(data && data.cpuTemp);
    var gpuTemp = optionalNumber(data && data.gpuTemp);

    if (data && data.stale) {
      warnings.push("Telemetry is stale");
    }
    if (cpu != null && cpu >= 92) {
      alerts.push("CPU pressure");
    } else if (cpu != null && cpu >= 78) {
      warnings.push("CPU climbing");
    }
    if (gpu != null && gpu >= 92) {
      alerts.push("GPU pressure");
    } else if (gpu != null && gpu >= 82) {
      warnings.push("GPU climbing");
    }
    if (ram != null && ram >= 90) {
      alerts.push("Memory pressure");
    } else if (ram != null && ram >= 78) {
      warnings.push("Memory climbing");
    }
    if (cpuTemp != null && cpuTemp >= 90) {
      alerts.push("CPU heat");
    }
    if (gpuTemp != null && gpuTemp >= 86) {
      alerts.push("GPU heat");
    }
    if (gpuPower && gpuPower.alerts && gpuPower.alerts.length) {
      alerts.push("GPU power alert");
    }
    if (displayDiagnostics && !displayTargetReady(displayDiagnostics)) {
      warnings.push("Display selection needed");
    }

    if (alerts.length) {
      return { label: "Needs Attention", tone: "danger", detail: alerts.slice(0, 2).join(" / ") };
    }
    if (warnings.length) {
      return { label: "Watch", tone: "warn", detail: warnings.slice(0, 2).join(" / ") };
    }
    return { label: "Healthy", tone: "good", detail: "No active pressure detected" };
  }

  function renderSystemTrend(values, tone) {
    var samples = Array.isArray(values) ? values.slice(-30) : [];
    if (!samples.length) {
      return '<div class="system-trend is-empty"><span></span></div>';
    }

    return '<div class="system-trend" data-tone="' + escapeHtml(tone || "muted") + '">' + samples.map(function (value) {
      var height = 5 + clamp(optionalNumber(value) || 0, 0, 100) * 0.16;
      return '<span style="height:' + height.toFixed(1) + 'px"></span>';
    }).join("") + '</div>';
  }

  function renderSystemStatCard(label, value, detail, percent, tone, trend) {
    var progress = optionalNumber(percent);
    return '' +
      '<article class="system-stat-card" data-ui-key="system-stat-' + escapeHtml(String(label || "metric").toLowerCase()) + '" data-tone="' + escapeHtml(tone || "muted") + '">' +
        '<div class="metric-label">' + escapeHtml(label) + '</div>' +
        '<div class="system-stat-value">' + escapeHtml(value) + '</div>' +
        (progress == null ? "" : '<div class="inline-progress"><span class="inline-progress__bar" style="width:' + clamp(progress, 0, 100) + '%"></span></div>') +
        '<div class="router-inline-copy">' + escapeHtml(detail) + '</div>' +
        renderSystemTrend(trend, tone) +
      '</article>';
  }

  function renderSystemToolsPanel(busy) {
    return '' +
      '<article class="system-panel system-tools-panel">' +
        '<div class="system-panel-head">' +
          '<div><div class="metric-label">System tools</div><strong>Privacy-safe telemetry</strong></div>' +
          '<div class="system-panel-actions">' +
            '<button class="inline-button" type="button" data-action="system-refresh"' + (busy ? " disabled" : "") + '>Refresh</button>' +
            '<button class="inline-button" type="button" data-action="system-task-manager"' + (busy ? " disabled" : "") + '>Task Manager</button>' +
          '</div>' +
        '</div>' +
        '<p class="router-inline-copy">Auxora reports overall CPU, GPU, and memory pressure without listing running applications or process IDs. Open Task Manager when you need app-level detail.</p>' +
      '</article>';
  }

  function renderSystemDisplayPanel(data, displayDiagnostics) {
    var primaryDisplay = primaryDisplayFromSystem(data || {});
    var selected = selectedDisplayFromDiagnostics(displayDiagnostics);
    var edgeReady = displayTargetReady(displayDiagnostics);
    var selectedLabel = selected
      ? text(displayDiagnostics && displayDiagnostics.selectedDisplayName, text(selected.label, "Companion display"))
      : "No active companion display";
    var primaryLabel = text(primaryDisplay.name || primaryDisplay.deviceName, "Primary display");
    var selectedHz = selected && selected.refreshRate != null ? formatHz(selected.refreshRate) : "--";
    var selectedSize = selected && selected.boundsWidth && selected.boundsHeight
      ? selected.boundsWidth + "x" + selected.boundsHeight
      : "--";

    return '' +
      '<article class="system-panel system-display-panel">' +
        '<div class="system-panel-head">' +
          '<div><div class="metric-label">Companion Display Health</div><strong>' + escapeHtml(edgeReady ? "Companion display ready" : "Waiting for companion display") + '</strong></div>' +
          statusPill(edgeReady ? "Ready" : "Check", edgeReady ? "good" : "warn") +
        '</div>' +
        '<div class="system-display-grid">' +
          '<div><span>Target</span><strong>' + escapeHtml(selectedLabel) + '</strong></div>' +
          '<div><span>Refresh</span><strong>' + escapeHtml(selectedHz) + '</strong></div>' +
          '<div><span>Size</span><strong>' + escapeHtml(selectedSize) + '</strong></div>' +
          '<div><span>Reserved primary</span><strong>' + escapeHtml(primaryLabel) + '</strong></div>' +
        '</div>' +
      '</article>';
  }

  function renderSystemSensorPanel(data, gpuPower) {
    var hasTemps = data && (data.cpuTemp != null || data.gpuTemp != null);
    var hasGpuPower = gpuPower && (gpuPower.totalPower || gpuPower.pins.length || gpuPower.rails.length || gpuPower.power.length);
    var sensorTone = gpuPower && gpuPower.alerts.length ? "danger" : (hasTemps || hasGpuPower ? "good" : "warn");
    var sensorLabel = gpuPower && gpuPower.alerts.length ? "Power alert" : (hasTemps || hasGpuPower ? "Live" : "Limited");
    var powerValue = sensorValue(gpuPower && gpuPower.totalPower, "Unavailable");

    return '' +
      '<article class="system-panel system-sensor-panel">' +
        '<div class="system-panel-head">' +
          '<div><div class="metric-label">Thermal / Power</div><strong>' + escapeHtml(sensorLabel) + '</strong></div>' +
          statusPill(sensorLabel, sensorTone) +
        '</div>' +
        '<div class="system-sensor-grid">' +
          '<div><span>CPU temp</span><strong>' + escapeHtml(formatTemp(data && data.cpuTemp)) + '</strong></div>' +
          '<div><span>GPU temp</span><strong>' + escapeHtml(formatTemp(data && data.gpuTemp)) + '</strong></div>' +
          '<div><span>GPU power</span><strong>' + escapeHtml(powerValue) + '</strong></div>' +
          '<div><span>Sensor source</span><strong>' + escapeHtml(text(gpuPower && gpuPower.source, hasTemps ? "Hardware monitor" : "Not linked")) + '</strong></div>' +
        '</div>' +
      '</article>';
  }

  function renderSystemWidget(data, statusText, statusTone, history, displayDiagnostics, busy) {
    var gpuPower = data.gpuPower || normalizeGpuPowerPayload({});
    var display = selectedDisplayFromDiagnostics(displayDiagnostics);
    var displayHz = display && display.refreshRate != null ? display.refreshRate : displayRefreshRate(display);
    var health = buildSystemHealth(data || {}, gpuPower, displayDiagnostics);
    var selectedDisplayLabel = display
      ? text(displayDiagnostics && displayDiagnostics.selectedDisplayName, text(display.label, text(display.name, "Companion display")))
      : "No active companion display";

    return '' +
      '<div class="inline-widget-shell inline-widget-shell--system">' +
        '<div class="system-monitor-cockpit">' +
          '<section class="system-health-strip">' +
            '<article class="system-health-card" data-tone="' + escapeHtml(health.tone) + '">' +
              '<div class="metric-label">Overall</div>' +
              '<strong>' + escapeHtml(health.label) + '</strong>' +
              '<span>' + escapeHtml(health.detail) + '</span>' +
            '</article>' +
            renderSystemStatCard("CPU", formatPercent(data.cpu), data.cpuTemp != null ? formatTemp(data.cpuTemp) : "System load", data.cpu, systemMetricTone(data.cpu, 78, 92), history.cpu) +
            renderSystemStatCard("GPU", formatPercent(data.gpu), data.gpuTemp != null ? formatTemp(data.gpuTemp) : "GPU load", data.gpu, systemMetricTone(data.gpu, 82, 92), history.gpu) +
            renderSystemStatCard("RAM", formatPercent(data.ram), "Memory used", data.ram, systemMetricTone(data.ram, 78, 90), history.ram) +
            renderSystemStatCard("Display", formatHz(displayHz), selectedDisplayLabel, displayHz == null ? null : Math.min(displayHz, 240) / 240 * 100, displayTargetReady(displayDiagnostics) ? "good" : "warn", []) +
          '</section>' +
          '<section class="system-detail-grid">' +
            renderSystemToolsPanel(busy) +
            renderSystemDisplayPanel(data, displayDiagnostics) +
            renderSystemSensorPanel(data, gpuPower) +
          '</section>' +
        '</div>' +
      '</div>';
  }

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

      if (action === "system-refresh") {
        loop.refresh();
      } else if (action === "system-task-manager") {
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
