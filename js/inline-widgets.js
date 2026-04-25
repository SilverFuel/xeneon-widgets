(function () {
  var advancedSetupSchemas = [
    {
      id: "unifi-network",
      title: "UniFi Network",
      copy: "Built in. Xenon detects the local UniFi console through the native host.",
      state: "Built in",
      fields: []
    },
    {
      id: "unifi-camera",
      title: "UniFi Camera",
      copy: "Native camera connector is planned. The normal setup no longer asks for relay URLs.",
      state: "Later",
      fields: []
    },
    {
      id: "plex",
      title: "Plex Server",
      copy: "Native Plex connector is planned. No local JSON service is required in the normal setup.",
      state: "Later",
      fields: []
    },
    {
      id: "nas",
      title: "NAS Storage",
      copy: "Native NAS connector is planned. The normal setup stays endpoint-free.",
      state: "Later",
      fields: []
    },
    {
      id: "automation",
      title: "Home Automation",
      copy: "Native Home Assistant style connector is planned. Endpoint setup is no longer part of first run.",
      state: "Later",
      fields: []
    }
  ];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function text(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function optionalNumber(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatPercent(value) {
    if (window.WidgetCore && typeof window.WidgetCore.formatPercent === "function") {
      return window.WidgetCore.formatPercent(value);
    }
    return optionalNumber(value) == null ? "--" : Math.round(value) + "%";
  }

  function formatRate(value) {
    if (window.WidgetCore && typeof window.WidgetCore.formatBytesPerSecond === "function") {
      return window.WidgetCore.formatBytesPerSecond(value);
    }
    return optionalNumber(value) == null ? "--" : value.toFixed(1) + " Mbps";
  }

  function formatTemp(value) {
    var parsed = optionalNumber(value);
    return parsed == null ? "--" : Math.round(parsed) + " C";
  }

  function formatValue(value, suffix) {
    var parsed = optionalNumber(value);
    return parsed == null ? "--" : Math.round(parsed) + (suffix || "");
  }

  function formatStorage(value, unit) {
    var parsed = optionalNumber(value);
    return parsed == null ? "--" : parsed.toFixed(parsed >= 100 ? 0 : 1) + " " + (unit || "GB");
  }

  function formatWhen(value) {
    if (!value) {
      return "--";
    }

    try {
      return new Date(value).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (error) {
      return String(value);
    }
  }

  function formatAge(value) {
    if (!value) {
      return "--";
    }

    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "--";
    }

    var diffMs = Date.now() - date.getTime();
    var diffMinutes = Math.max(0, Math.round(diffMs / 60000));
    if (diffMinutes < 1) {
      return "Just now";
    }
    if (diffMinutes < 60) {
      return diffMinutes + " min ago";
    }

    var diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return diffHours + " hr ago";
    }

    return Math.round(diffHours / 24) + " d ago";
  }

  function formatDurationMs(value) {
    var totalMs = optionalNumber(value);
    var totalSeconds;
    var minutes;
    var seconds;
    var hours;
    if (totalMs == null) {
      return "--";
    }
    totalSeconds = Math.max(0, Math.round(totalMs / 1000));
    hours = Math.floor(totalSeconds / 3600);
    minutes = Math.floor((totalSeconds % 3600) / 60);
    seconds = totalSeconds % 60;
    if (hours > 0) {
      return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }
    return minutes + ":" + String(seconds).padStart(2, "0");
  }

  function formatMediaAppLabel(appId) {
    var value = text(appId, "");
    var parts;
    if (!value) {
      return "Windows media session";
    }
    parts = value.split(/[!_.]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : value;
  }

  function toneForState(state) {
    var value = String(state || "").toLowerCase();
    if (value.indexOf("ready") !== -1 || value.indexOf("good") !== -1 || value.indexOf("live") !== -1 || value.indexOf("healthy") !== -1 || value.indexOf("writable") !== -1 || value.indexOf("built") !== -1) {
      return "good";
    }
    if (value.indexOf("detected") !== -1) {
      return "good";
    }
    if (value.indexOf("unsupported") !== -1 || value.indexOf("later") !== -1 || value.indexOf("optional") !== -1 || value.indexOf("checking") !== -1) {
      return "muted";
    }
    if (value.indexOf("error") !== -1 || value.indexOf("fail") !== -1 || value.indexOf("danger") !== -1 || value.indexOf("critical") !== -1) {
      return "danger";
    }
    return "warn";
  }

  function statusTextFromPayload(payload, fallback) {
    var status = text(payload && payload.status, "");
    if (status === "live") {
      return fallback || "Live";
    }
    if (status === "stale") {
      return "Stale";
    }
    if (status === "idle") {
      return fallback || "Idle";
    }
    if (status === "setup") {
      return "Setup";
    }
    if (status === "error") {
      return "Error";
    }
    if (status === "unsupported") {
      return "Unsupported";
    }
    if (status === "starting") {
      return "Starting";
    }
    if (status === "detected") {
      return "Detected";
    }
    return text(payload && payload.message, text(payload && payload.source, fallback || "--"));
  }

  function statusToneFromPayload(payload, fallback) {
    if (payload && payload.supported === false) {
      return "muted";
    }
    if (payload && payload.stale) {
      return "warn";
    }
    return toneForState(text(payload && payload.status, fallback || ""));
  }

  function buildBridgeUrl(env, path, query) {
    var url = new URL(path, env.bridgeOrigin);
    Object.keys(query || {}).forEach(function (key) {
      var value = query[key];
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  function getUniFiNetworkEndpoint(env) {
    return getSetting(env, "unifiNetworkEndpoint") || buildBridgeUrl(env, "/api/unifi/network");
  }

  function requestJson(url, options, timeoutMs) {
    var settings = options || {};
    var headers = Object.assign({}, settings.headers || {});
    var fetchOptions = {
      method: settings.method || "GET",
      cache: settings.cache || "no-store",
      headers: headers
    };

    if (settings.body !== undefined) {
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      fetchOptions.body = typeof settings.body === "string" ? settings.body : JSON.stringify(settings.body);
    }

    return new Promise(function (resolve, reject) {
      var timerId = window.setTimeout(function () {
        reject(new Error("Request timed out"));
      }, timeoutMs || 5000);

      fetch(url, fetchOptions).then(function (response) {
        if (!response.ok) {
          return response.json().catch(function () {
            return {};
          }).then(function (payload) {
            throw new Error(payload.error || payload.message || ("Request failed with status " + response.status));
          });
        }

        return response.json().catch(function () {
          return {};
        });
      }).then(function (payload) {
        window.clearTimeout(timerId);
        resolve(payload);
      }, function (error) {
        window.clearTimeout(timerId);
        reject(error);
      });
    });
  }

  function addListener(cleanups, target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanups.push(function () {
      target.removeEventListener(type, handler, options);
    });
  }

  function runCleanups(cleanups) {
    while (cleanups.length) {
      cleanups.pop()();
    }
  }

  function createTimerLoop(refreshFn, intervalMs, shouldPauseFn) {
    var timerId = 0;
    var disposed = false;
    var inFlight = false;

    function clearTimer() {
      if (timerId) {
        window.clearTimeout(timerId);
        timerId = 0;
      }
    }

    function schedule() {
      clearTimer();
      if (disposed || !intervalMs) {
        return;
      }

      timerId = window.setTimeout(function () {
        refresh(false);
      }, intervalMs);
    }

    function refresh(force) {
      if (disposed || inFlight) {
        return Promise.resolve();
      }

      if (!force && (document.hidden || (typeof shouldPauseFn === "function" && shouldPauseFn()))) {
        schedule();
        return Promise.resolve();
      }

      clearTimer();
      inFlight = true;

      return Promise.resolve(refreshFn()).catch(function (error) {
        console.error("Inline widget refresh failed", error);
      }).finally(function () {
        inFlight = false;
        schedule();
      });
    }

    return {
      start: function () {
        return refresh(true);
      },
      refresh: function () {
        return refresh(true);
      },
      destroy: function () {
        disposed = true;
        clearTimer();
      }
    };
  }

  function getSetting(env, key) {
    return typeof env.getSetting === "function" ? env.getSetting(key) : "";
  }

  function saveSettings(env, values) {
    if (typeof env.saveSettings === "function") {
      env.saveSettings(values);
    }
  }

  function setupUpdate(env, kind) {
    if (typeof env.handleSetupUpdate === "function") {
      return env.handleSetupUpdate(kind);
    }
    return Promise.resolve();
  }

  function statusPill(textValue, tone) {
    return '<div class="widget-status" data-tone="' + escapeHtml(tone || "muted") + '">' + escapeHtml(textValue || "--") + "</div>";
  }

  function emptyState(title, copy) {
    return '' +
      '<div class="inline-empty">' +
        '<strong>' + escapeHtml(title) + '</strong>' +
        '<span>' + escapeHtml(copy) + '</span>' +
      '</div>';
  }

  function renderActionButton(item, action, confirmId, disabled) {
    var itemId = text(item && item.id, "");
    var isConfirm = confirmId && confirmId === itemId;
    var buttonLabel = isConfirm ? "Tap again" : text(item && item.label, "Action");
    var buttonCopy = isConfirm
      ? "Confirm " + text(item && item.label, "action").toLowerCase()
      : text(item && item.detail, text(item && item.state, "Ready"));
    return '' +
      '<button class="inline-action-button" type="button" data-action="' + escapeHtml(action) + '" data-id="' + escapeHtml(itemId) + '" data-style="' + escapeHtml(text(item && item.style, "command")) + '"' + (isConfirm ? ' data-state="confirm"' : "") + (((disabled || !item || item.enabled === false) ? " disabled" : "")) + '>' +
        '<strong>' + escapeHtml(buttonLabel) + '</strong>' +
        '<span class="inline-action-button__detail">' + escapeHtml(buttonCopy) + '</span>' +
        '<span class="inline-action-button__state">' + escapeHtml(text(item && item.state, "Ready")) + '</span>' +
      '</button>';
  }

  function metricCard(label, value, detail, percent, extraClass) {
    var progress = optionalNumber(percent);
    return '' +
      '<article class="metric-card inline-card' + (extraClass ? " " + extraClass : "") + '">' +
        '<div class="metric-label">' + escapeHtml(label) + '</div>' +
        '<div class="metric-value">' + escapeHtml(value) + '</div>' +
        (progress == null ? "" : '<div class="inline-progress"><span class="inline-progress__bar" style="width:' + clamp(progress, 0, 100) + '%"></span></div>') +
        '<div class="router-inline-copy">' + escapeHtml(detail) + '</div>' +
      '</article>';
  }

  function readSetupItems(setup) {
    var items = setup && setup.items ? setup.items : {};
    return [
      items.bridge || { label: "Local bridge", state: "Needs Setup", nextStep: "Waiting for bridge." },
      items.system || { label: "System Monitor", state: "Needs Setup", nextStep: "Waiting for telemetry." },
      items.network || { label: "Network Monitor", state: "Needs Setup", nextStep: "Waiting for telemetry." }
    ];
  }

  function renderSystemWidget(data, statusText, statusTone) {
    var processes = Array.isArray(data.topProcesses) ? data.topProcesses.slice(0, 6) : [];
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Local bridge</div>' +
            '<h3 class="inline-title">System monitor</h3>' +
            '<p class="inline-copy">Native CPU, GPU, RAM, and disk telemetry without the iframe layer.</p>' +
          '</div>' +
          statusPill(statusText, statusTone) +
        '</div>' +
        '<div class="inline-grid inline-grid--4">' +
          metricCard("CPU", formatPercent(data.cpu), formatTemp(data.cpuTemp), data.cpu) +
          metricCard("GPU", formatPercent(data.gpu), data.gpuTemp != null ? formatTemp(data.gpuTemp) : "Unavailable", data.gpu) +
          metricCard("RAM", formatPercent(data.ram), text(data.source, "Memory pressure"), data.ram) +
          metricCard("Disk", formatPercent(data.disk), data.disk == null ? "Unavailable" : "Active utilization", data.disk) +
        '</div>' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header">' +
            '<div>' +
              '<div class="metric-label">Top Processes</div>' +
              '<div class="router-inline-copy">' + escapeHtml(text(data.source, "Live process breakdown")) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="inline-list">' + (processes.length ? processes.map(function (process) {
            var cpu = optionalNumber(process.cpu);
            var memory = optionalNumber(process.memoryMB);
            return '' +
              '<div class="inline-list-item inline-list-item--split">' +
                '<div>' +
                  '<div class="inline-list-title">' + escapeHtml(text(process.name, "Unknown")) + '</div>' +
                  '<div class="inline-list-copy">CPU ' + escapeHtml(cpu == null ? "--" : Math.round(cpu) + "%") + '</div>' +
                '</div>' +
                '<div class="inline-list-meta">' + escapeHtml(memory == null ? "--" : Math.round(memory) + " MB") + '</div>' +
              '</div>';
          }).join("") : emptyState("No process data", "Process telemetry is unavailable for this source.")) + '</div>' +
        '</article>' +
      '</div>';
  }

  function mountSystemWidget(widget, container, env) {
    var state = {
      data: {},
      statusText: "Loading",
      statusTone: "warn"
    };

    function redraw() {
      container.innerHTML = renderSystemWidget(state.data, state.statusText, state.statusTone);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/system"), {}, 5000).then(function (payload) {
        state.data = payload || {};
        state.statusText = statusTextFromPayload(payload, "Live");
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.data = {
          source: error.message || "Unavailable",
          topProcesses: []
        };
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    var loop = createTimerLoop(refresh, 4000);
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        container.innerHTML = "";
      }
    };
  }

  function normalizeUnifiSnapshot(raw) {
    var data = raw || {};
    var clients = data.clients || {};
    return {
      gateway: text(data.gateway, "UniFi Gateway"),
      source: text(data.source, "UniFi network"),
      status: text(data.status, ""),
      message: text(data.message, ""),
      detected: Boolean(data.detected),
      latencyMs: optionalNumber(data.latencyMs),
      packetLoss: optionalNumber(data.packetLoss),
      provider: text(data.provider, ""),
      monthlyUsageGb: optionalNumber(data.monthlyUsageGb),
      clients: {
        total: optionalNumber(clients.total) || 0,
        wifi: optionalNumber(clients.wifi) || 0,
        wired: optionalNumber(clients.wired) || 0,
        guests: optionalNumber(clients.guests) || 0
      },
      aps: Array.isArray(data.aps) ? data.aps : [],
      topClients: Array.isArray(data.topClients) ? data.topClients : [],
      topApps: Array.isArray(data.topApps) ? data.topApps : []
    };
  }

  function renderNetworkWidget(bridgeData, unifiData, statusText, statusTone) {
    var aps = unifiData && Array.isArray(unifiData.aps) ? unifiData.aps.slice(0, 4) : [];
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Connectivity</div>' +
            '<h3 class="inline-title">Network monitor</h3>' +
            '<p class="inline-copy">' + escapeHtml(unifiData ? "Local bridge throughput plus UniFi gateway context." : "Live throughput and latency from the native host.") + '</p>' +
          '</div>' +
          statusPill(statusText, statusTone) +
        '</div>' +
        '<div class="inline-grid inline-grid--4">' +
          metricCard("Download", formatRate(bridgeData.download), text(bridgeData.source, "Live throughput")) +
          metricCard("Upload", formatRate(bridgeData.upload), text(bridgeData.type, "Live throughput")) +
          metricCard("Ping", formatValue(bridgeData.ping, " ms"), "Round-trip latency") +
          metricCard("Connection", text(bridgeData.type, "--"), unifiData && unifiData.provider ? unifiData.provider : text(bridgeData.source, "Bridge telemetry")) +
        '</div>' +
        '<div class="inline-grid inline-grid--2">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Site Overview</div>' +
                '<div class="router-inline-copy">' + escapeHtml(unifiData ? unifiData.gateway : "Native host only") + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="inline-kpis">' +
              '<div class="inline-kpi"><strong>' + escapeHtml(unifiData ? String(unifiData.clients.total) : "--") + '</strong><span>Clients</span></div>' +
              '<div class="inline-kpi"><strong>' + escapeHtml(unifiData ? String(unifiData.clients.wifi) : "--") + '</strong><span>Wi-Fi</span></div>' +
              '<div class="inline-kpi"><strong>' + escapeHtml(unifiData ? String(unifiData.clients.wired) : "--") + '</strong><span>Wired</span></div>' +
              '<div class="inline-kpi"><strong>' + escapeHtml(unifiData && unifiData.monthlyUsageGb != null ? Math.round(unifiData.monthlyUsageGb) + " GB" : "--") + '</strong><span>Usage</span></div>' +
            '</div>' +
            '<div class="inline-list">' + (aps.length ? aps.map(function (ap) {
              return '' +
                '<div class="inline-list-item inline-list-item--split">' +
                  '<div>' +
                    '<div class="inline-list-title">' + escapeHtml(text(ap.name, "Access Point")) + '</div>' +
                    '<div class="inline-list-copy">' + escapeHtml(text(ap.status, "online")) + '</div>' +
                  '</div>' +
                  '<div class="inline-list-meta">' + escapeHtml(String(optionalNumber(ap.clients) || 0) + " clients") + '</div>' +
                '</div>';
            }).join("") : emptyState("UniFi is checking", "Gateway details appear automatically when Xenon can see the local UniFi console.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Latency</div>' +
                '<div class="router-inline-copy">' + escapeHtml(unifiData && unifiData.latencyMs != null ? Math.round(unifiData.latencyMs) + " ms gateway latency" : "ICMP latency from the native host.") + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="inline-list">' +
              '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">Ping</div><div class="inline-list-copy">Bridge telemetry</div></div><div class="inline-list-meta">' + escapeHtml(formatValue(bridgeData.ping, " ms")) + '</div></div>' +
              '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">Packet loss</div><div class="inline-list-copy">Gateway sample</div></div><div class="inline-list-meta">' + escapeHtml(unifiData && unifiData.packetLoss != null ? unifiData.packetLoss.toFixed(1) + "%" : "--") + '</div></div>' +
              '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">Top clients</div><div class="inline-list-copy">Heavy talkers</div></div><div class="inline-list-meta">' + escapeHtml(unifiData ? String(unifiData.topClients.length) : "--") + '</div></div>' +
              '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">Top apps</div><div class="inline-list-copy">Traffic categories</div></div><div class="inline-list-meta">' + escapeHtml(unifiData ? String(unifiData.topApps.length) : "--") + '</div></div>' +
            '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountNetworkWidget(widget, container, env) {
    var state = {
      bridge: {},
      unifi: null,
      statusText: "Loading",
      statusTone: "warn"
    };

    function redraw() {
      container.innerHTML = renderNetworkWidget(state.bridge, state.unifi, state.statusText, state.statusTone);
    }

    function refresh() {
      var bridgeRequest = requestJson(buildBridgeUrl(env, "/api/network"), {}, 5000);
      var unifiEndpoint = getUniFiNetworkEndpoint(env);
      var unifiRequest = unifiEndpoint
        ? requestJson(unifiEndpoint, {}, 5000).then(normalizeUnifiSnapshot).catch(function () {
          return null;
        })
        : Promise.resolve(null);

      return Promise.all([bridgeRequest, unifiRequest]).then(function (results) {
        state.bridge = results[0] || {};
        state.unifi = results[1];
        state.statusText = state.unifi ? (state.unifi.detected ? "UniFi detected" : "Bridge + UniFi") : statusTextFromPayload(state.bridge, "Live");
        state.statusTone = state.unifi ? toneForState(state.unifi.status || "live") : statusToneFromPayload(state.bridge, "live");
        redraw();
      }, function (error) {
        state.bridge = { source: error.message || "Unavailable" };
        state.unifi = null;
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    var loop = createTimerLoop(refresh, 4000);
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        container.innerHTML = "";
      }
    };
  }

  function getAdvancedSchemaState(schema, env) {
    if (!schema.fields.length) {
      return schema.state || "Later";
    }

    if (schema.id === "unifi-camera") {
      return getSetting(env, "unifiCameraEndpoint") || getSetting(env, "unifiCameraFeed") || getSetting(env, "unifiCameraRelayUrl") || getSetting(env, "unifiCameraSnapshot")
        ? "Ready"
        : "Optional";
    }

    if (schema.id === "automation") {
      return getSetting(env, "automationEndpoint") || getSetting(env, "automationActionEndpoint")
        ? "Ready"
        : "Optional";
    }

    return getSetting(env, schema.fields[0].key) ? "Ready" : "Optional";
  }

  function renderAdvancedSetupForms(env) {
    return advancedSetupSchemas.map(function (schema) {
      var state = getAdvancedSchemaState(schema, env);
      return '' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header">' +
            '<div>' +
              '<div class="metric-label">' + escapeHtml(schema.title) + '</div>' +
              '<div class="router-inline-copy">' + escapeHtml(schema.copy) + '</div>' +
            '</div>' +
            statusPill(state, toneForState(state)) +
          '</div>' +
          (!schema.fields.length
            ? '<div class="router-inline-copy">' + escapeHtml(schema.copy) + '</div>'
            :
          '<form class="inline-form" data-form="advanced:' + escapeHtml(schema.id) + '">' +
            '<div class="inline-form-grid">' +
              schema.fields.map(function (field) {
                return '' +
                  '<label class="inline-field">' +
                    '<span>' + escapeHtml(field.label) + '</span>' +
                    '<input class="inline-input" type="text" name="' + escapeHtml(field.key) + '" value="' + escapeHtml(getSetting(env, field.key)) + '" placeholder="' + escapeHtml(field.placeholder || "") + '">' +
                  '</label>';
              }).join("") +
            '</div>' +
            '<div class="inline-actions">' +
              '<button class="inline-button is-primary" type="submit">Save</button>' +
            '</div>' +
          '</form>') +
        '</article>';
    }).join("");
  }

  function renderSetupWidget(state, env) {
    var health = state.health || {};
    var setup = health.setup || env.bridgeSetup || {};
    var config = state.config || env.bridgeConfig || {};
    var hue = state.hue || { bridgeIp: "", message: "" };
    var items = readSetupItems(setup);
    var optionalItems = setup.items || {};
    var mediaItem = optionalItems.media || { label: "Media Transport", state: "Ready", nextStep: "Windows media transport is ready." };
    var weatherItem = optionalItems.weather || { label: "Weather", state: "Optional", nextStep: "Add an OpenWeather key if you want weather." };
    var calendarItem = optionalItems.calendar || { label: "Calendar", state: "Optional", nextStep: "Add an ICS feed if you want the Calendar widget." };
    var hueItem = optionalItems.hue || { label: "Philips Hue", state: "Optional", nextStep: "Link Hue only if you want lighting controls." };
    var uniFiItem = optionalItems.unifi || { label: "UniFi Network", state: "Optional", nextStep: "Xenon can auto-detect UniFi locally." };
    var essentialsReady = Boolean(setup.essentialsReady);
    var onboardingCompleted = Boolean(setup.onboardingCompleted);
    var weatherConfig = config.weather || {};
    var calendarConfig = config.calendar || {};
    var advancedSetupUrl = buildBridgeUrl(env, "/dashboard.html", {
      widget: "setup",
      advanced: "1",
      v: env.assetRevision || ""
    });
    var advancedSetupBlock = env.showAdvanced
      ? '<div class="inline-grid inline-grid--2">' + renderAdvancedSetupForms(env) + '</div>'
      : '<article class="list-card inline-card">' +
          '<div class="inline-card-header">' +
            '<div>' +
              '<div class="metric-label">Advanced connectors</div>' +
              '<div class="router-inline-copy">Hidden from normal setup.</div>' +
            '</div>' +
            statusPill("Optional", "muted") +
          '</div>' +
          '<div class="inline-actions">' +
            '<a class="inline-button" href="' + escapeHtml(advancedSetupUrl) + '">Open advanced</a>' +
          '</div>' +
        '</article>';

    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Diagnostics</div>' +
            '<h3 class="inline-title">Setup and diagnostics</h3>' +
            '<p class="inline-copy">Install, open, finish setup. Optional extras can wait until the dashboard is working.</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            '<button class="inline-button is-primary" type="button" data-action="finish-setup"' + (essentialsReady && !onboardingCompleted ? "" : " disabled") + '>' + (onboardingCompleted ? "Completed" : "Finish setup") + '</button>' +
            '<button class="inline-button" type="button" data-action="reset-local-data"' + (state.busy ? " disabled" : "") + '>' + (state.confirmReset ? "Confirm reset" : "Reset local data") + '</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--4">' +
          items.map(function (item) {
            return '' +
              '<article class="metric-card inline-card">' +
                '<div class="metric-label">' + escapeHtml(item.label) + '</div>' +
                '<div class="metric-value">' + escapeHtml(item.state) + '</div>' +
                '<div class="router-inline-copy">' + escapeHtml(item.nextStep) + '</div>' +
              '</article>';
          }).join("") +
          '<article class="metric-card inline-card">' +
            '<div class="metric-label">' + escapeHtml(mediaItem.label) + '</div>' +
            '<div class="metric-value">' + escapeHtml(mediaItem.state) + '</div>' +
            '<div class="router-inline-copy">' + escapeHtml(mediaItem.nextStep) + '</div>' +
          '</article>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Weather</div>' +
                '<div class="router-inline-copy">' + escapeHtml(weatherItem.nextStep) + '</div>' +
              '</div>' +
              statusPill(weatherItem.state, toneForState(weatherItem.state)) +
            '</div>' +
            '<form class="inline-form" data-form="weather">' +
              '<div class="inline-form-grid inline-form-grid--2">' +
                '<label class="inline-field"><span>API key</span><input class="inline-input" type="password" name="apiKey" value="" placeholder="Leave blank to keep the current key"></label>' +
                '<label class="inline-field"><span>Units</span><select class="inline-select" name="units"><option value="metric"' + ((weatherConfig.units || "metric") === "metric" ? " selected" : "") + '>Metric (C)</option><option value="imperial"' + ((weatherConfig.units || "metric") === "imperial" ? " selected" : "") + '>Imperial (F)</option></select></label>' +
              '</div>' +
              '<div class="inline-form-grid">' +
                '<label class="inline-field"><span>City</span><input class="inline-input" type="text" name="city" value="' + escapeHtml(text(weatherConfig.city, "Indianapolis")) + '" placeholder="Indianapolis"></label>' +
              '</div>' +
              '<div class="inline-actions"><button class="inline-button is-primary" type="submit">Save weather</button></div>' +
            '</form>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Calendar</div>' +
                '<div class="router-inline-copy">' + escapeHtml(calendarItem.nextStep) + '</div>' +
              '</div>' +
              statusPill(calendarItem.state, toneForState(calendarItem.state)) +
            '</div>' +
            '<form class="inline-form" data-form="calendar">' +
              '<div class="inline-form-grid">' +
                '<label class="inline-field"><span>ICS feed URL</span><input class="inline-input" type="url" name="icsUrl" value="' + escapeHtml(text(calendarConfig.icsUrl, "")) + '" placeholder="https://calendar.example.com/feed.ics"></label>' +
              '</div>' +
              '<div class="router-inline-copy">Paste any reachable ICS feed. Leave it blank and save to remove the current calendar feed.</div>' +
              '<div class="inline-actions"><button class="inline-button is-primary" type="submit">Save calendar</button></div>' +
            '</form>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">UniFi Network</div>' +
                '<div class="router-inline-copy">' + escapeHtml(uniFiItem.nextStep) + '</div>' +
              '</div>' +
              statusPill(uniFiItem.state, toneForState(uniFiItem.state)) +
            '</div>' +
            '<div class="router-inline-copy">No separate JSON server needed. Xenon checks the local UniFi console automatically and richer stats can be connected later.</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Philips Hue</div>' +
                '<div class="router-inline-copy">' + escapeHtml(text(hue.message, hueItem.nextStep)) + '</div>' +
              '</div>' +
              statusPill(hueItem.state, toneForState(hueItem.state)) +
            '</div>' +
            '<form class="inline-form" data-form="hue">' +
              '<div class="inline-form-grid">' +
                '<label class="inline-field"><span>Bridge IP</span><input class="inline-input" type="text" name="bridgeIp" value="' + escapeHtml(text(hue.bridgeIp, "")) + '" placeholder="192.168.1.50"></label>' +
              '</div>' +
              '<div class="inline-actions"><button class="inline-button is-primary" type="submit">Link bridge</button></div>' +
            '</form>' +
          '</article>' +
        '</div>' +
        advancedSetupBlock +
      '</div>';
  }

  function mountSetupWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      health: { setup: env.bridgeSetup || {} },
      config: env.bridgeConfig || {},
      hue: (env.bridgeConfig && env.bridgeConfig.hue) || {},
      statusText: "Loading",
      statusTone: "warn",
      busy: false,
      confirmReset: false
    };

    function redraw() {
      container.innerHTML = renderSetupWidget(state, env);
    }

    function refresh() {
      return Promise.all([
        requestJson(buildBridgeUrl(env, "/api/health"), {}, 5000),
        requestJson(buildBridgeUrl(env, "/api/config"), {}, 5000),
        requestJson(buildBridgeUrl(env, "/api/hue"), {}, 5000)
      ]).then(function (results) {
        state.health = results[0] || {};
        state.config = results[1] || {};
        state.hue = results[2] || {};
        state.statusText = state.health.setup && (!state.health.setup.onboardingCompleted || state.health.setup.needsAttention) ? "Needs Setup" : "Ready";
        state.statusTone = state.statusText === "Ready" ? "good" : "warn";
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var action = event.target && event.target.getAttribute("data-action");
      if (!action || state.busy) {
        return;
      }

      if (action === "refresh") {
        state.confirmReset = false;
        refresh();
        return;
      }

      if (action === "finish-setup") {
        state.busy = true;
        state.statusText = "Saving";
        state.statusTone = "warn";
        redraw();
        requestJson(buildBridgeUrl(env, "/api/config/dashboard"), {
          method: "POST",
          body: {
            onboardingCompleted: true,
            onboardingVersion: env.onboardingVersion || 1
          }
        }, 8000).then(function () {
          return setupUpdate(env, "dashboard");
        }).then(function () {
          state.busy = false;
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Save failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (action === "reset-local-data") {
        if (!state.confirmReset) {
          state.confirmReset = true;
          state.statusText = "Tap again";
          state.statusTone = "warn";
          redraw();
          return;
        }

        if (typeof env.resetAllLocalData !== "function") {
          state.statusText = "Reset unavailable";
          state.statusTone = "danger";
          state.confirmReset = false;
          redraw();
          return;
        }

        state.busy = true;
        state.statusText = "Resetting";
        state.statusTone = "warn";
        redraw();
        env.resetAllLocalData().then(function () {
          state.busy = false;
          state.confirmReset = false;
          return refresh();
        }, function (error) {
          state.busy = false;
          state.confirmReset = false;
          state.statusText = error.message || "Reset failed";
          state.statusTone = "danger";
          redraw();
        });
      }
    });

    addListener(cleanups, container, "submit", function (event) {
      var form = event.target;
      var formId = form && form.getAttribute("data-form");
      var formData;
      var payload;
      var values = {};

      if (!formId || state.busy) {
        return;
      }

      event.preventDefault();
      formData = new FormData(form);
      state.busy = true;
      state.statusText = "Saving";
      state.statusTone = "warn";
      redraw();

      if (formId === "weather") {
        payload = {
          apiKey: String(formData.get("apiKey") || ""),
          city: String(formData.get("city") || ""),
          units: String(formData.get("units") || "metric")
        };
        requestJson(buildBridgeUrl(env, "/api/config/weather"), {
          method: "POST",
          body: payload
        }, 8000).then(function () {
          return setupUpdate(env, "weather");
        }).then(function () {
          state.busy = false;
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Save failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (formId === "calendar") {
        payload = {
          icsUrl: String(formData.get("icsUrl") || "")
        };
        requestJson(buildBridgeUrl(env, "/api/config/calendar"), {
          method: "POST",
          body: payload
        }, 8000).then(function () {
          return setupUpdate(env, "calendar");
        }).then(function () {
          state.busy = false;
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Save failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (formId === "hue") {
        payload = {
          bridgeIp: String(formData.get("bridgeIp") || "")
        };
        requestJson(buildBridgeUrl(env, "/api/hue/link"), {
          method: "POST",
          body: payload
        }, 8000).then(function () {
          return setupUpdate(env, "hue");
        }).then(function () {
          state.busy = false;
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Link failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (formId.indexOf("advanced:") === 0) {
        formData.forEach(function (value, key) {
          values[key] = String(value || "");
        });
        saveSettings(env, values);
        state.busy = false;
        state.statusText = "Saved";
        state.statusTone = "good";
        redraw();
      }
    });

    redraw();
    refresh();

    return {
      refresh: refresh,
      destroy: function () {
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeAudioPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: payload.configured !== false,
      status: text(payload.status, "starting"),
      message: text(payload.message, ""),
      source: text(payload.source, "Local bridge"),
      defaultDeviceId: text(payload.defaultDeviceId, ""),
      masterVolume: clamp(optionalNumber(payload.masterVolume) || 0, 0, 100),
      muted: Boolean(payload.muted),
      devices: Array.isArray(payload.devices) ? payload.devices : [],
      sessions: Array.isArray(payload.sessions) ? payload.sessions : []
    };
  }

  function renderAudioWidget(state) {
    var data = state.data;
    var devices = data.devices.slice(0, 6);
    var sessions = data.sessions.slice(0, 6);
    var defaultDevice = devices.filter(function (device) {
      return device.isDefault;
    })[0] || null;

    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Audio</div>' +
            '<h3 class="inline-title">Output routing</h3>' +
            '<p class="inline-copy">' + escapeHtml(text(data.source, "Switch playback devices and adjust app mix.")) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--2">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Master output</div>' +
                '<div class="router-inline-copy">' + escapeHtml(defaultDevice ? defaultDevice.name : "No default playback device") + '</div>' +
              '</div>' +
              '<button class="inline-button" type="button" data-action="master-mute">' + (data.muted ? "Unmute" : "Mute") + '</button>' +
            '</div>' +
            '<div class="inline-slider-row"><strong>' + escapeHtml(Math.round(data.masterVolume) + "%") + '</strong><input class="inline-range" type="range" min="0" max="100" value="' + Math.round(data.masterVolume) + '" data-action="master-volume"></div>' +
            '<div class="inline-list">' + (devices.length ? devices.map(function (device) {
              return '' +
                '<div class="inline-list-item inline-list-item--split">' +
                  '<div>' +
                    '<div class="inline-list-title">' + escapeHtml(text(device.name, "Output")) + '</div>' +
                    '<div class="inline-list-copy">' + escapeHtml(text(device.kind || device.state, "Playback device")) + '</div>' +
                  '</div>' +
                  '<button class="inline-button' + (device.isDefault ? "" : " is-primary") + '" type="button" data-action="switch-device" data-device-id="' + escapeHtml(text(device.id, "")) + '"' + (device.isDefault ? " disabled" : "") + '>' + (device.isDefault ? "Current" : "Use") + '</button>' +
                '</div>';
            }).join("") : emptyState("Audio routing unavailable", "Native audio routing is not implemented yet in this host.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Sessions</div>' +
                '<div class="router-inline-copy">Trim app volumes without leaving the dashboard.</div>' +
              '</div>' +
            '</div>' +
            '<div class="inline-list">' + (sessions.length ? sessions.map(function (session) {
              return '' +
                '<div class="inline-list-item">' +
                  '<div class="inline-list-item--split">' +
                    '<div>' +
                      '<div class="inline-list-title">' + escapeHtml(text(session.name, "Application")) + '</div>' +
                      '<div class="inline-list-copy">' + escapeHtml(session.active ? "Live session" : text(session.state, "Tracked")) + '</div>' +
                    '</div>' +
                    '<button class="inline-button" type="button" data-action="session-mute" data-session-id="' + escapeHtml(text(session.id, "")) + '">' + (session.muted ? "Unmute" : "Mute") + '</button>' +
                  '</div>' +
                  '<div class="inline-slider-row"><strong>' + escapeHtml(formatPercent(session.volume)) + '</strong><input class="inline-range" type="range" min="0" max="100" value="' + Math.round(optionalNumber(session.volume) || 0) + '" data-action="session-volume" data-session-id="' + escapeHtml(text(session.id, "")) + '"></div>' +
                '</div>';
            }).join("") : emptyState("No live sessions", "No application audio sessions are active right now.")) + '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountAudioWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeAudioPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      busy: false,
      interacting: false
    };

    function redraw() {
      container.innerHTML = renderAudioWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/audio"), {}, 5000).then(function (payload) {
        state.data = normalizeAudioPayload(payload);
        state.statusText = statusTextFromPayload(payload, state.data.configured ? "Live" : "Setup");
        state.statusTone = statusToneFromPayload(payload, state.data.configured ? "live" : "setup");
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commit(path, body) {
      state.busy = true;
      state.statusText = "Applying";
      state.statusTone = "warn";
      redraw();
      return requestJson(buildBridgeUrl(env, path), {
        method: "POST",
        body: body
      }, 8000).then(function () {
        state.busy = false;
        return refresh();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Action failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");

      if (!action || state.busy) {
        return;
      }

      if (action === "refresh") {
        refresh();
        return;
      }

      if (action === "master-mute") {
        commit("/api/audio/master-mute", {
          muted: !state.data.muted
        });
        return;
      }

      if (action === "switch-device") {
        commit("/api/audio/default-device", {
          deviceId: String(target.getAttribute("data-device-id") || "")
        });
        return;
      }

      if (action === "session-mute") {
        commit("/api/audio/session-mute", {
          sessionId: String(target.getAttribute("data-session-id") || ""),
          muted: String(target.textContent || "").toLowerCase() === "mute"
        });
      }
    });

    addListener(cleanups, container, "input", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");
      if (action !== "master-volume" && action !== "session-volume") {
        return;
      }

      state.interacting = true;
      var row = target.parentNode;
      var valueNode = row ? row.querySelector("strong") : null;
      if (valueNode) {
        valueNode.textContent = Math.round(optionalNumber(target.value) || 0) + "%";
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");
      state.interacting = false;

      if (state.busy) {
        return;
      }

      if (action === "master-volume") {
        commit("/api/audio/master-volume", {
          volume: clamp(optionalNumber(target.value) || 0, 0, 100)
        });
        return;
      }

      if (action === "session-volume") {
        commit("/api/audio/session-volume", {
          sessionId: String(target.getAttribute("data-session-id") || ""),
          volume: clamp(optionalNumber(target.value) || 0, 0, 100)
        });
      }
    });

    addListener(cleanups, container, "pointerup", function () {
      state.interacting = false;
    });

    addListener(cleanups, container, "pointercancel", function () {
      state.interacting = false;
    });

    var loop = createTimerLoop(refresh, 4000, function () {
      return state.busy || state.interacting;
    });
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeWeatherPayload(payload, env) {
    payload = payload || {};
    return {
      configured: payload.configured !== false,
      city: text(payload.city, text(getSetting(env, "city"), "Local Weather")),
      temperature: optionalNumber(payload.temperature),
      condition: text(payload.condition, payload.message || "Weather unavailable"),
      units: text(payload.units, text(getSetting(env, "units"), "metric")),
      source: text(payload.source, "Bridge weather"),
      hourly: Array.isArray(payload.hourly) ? payload.hourly.slice(0, 5) : [],
      daily: Array.isArray(payload.daily) ? payload.daily.slice(0, 5) : []
    };
  }

  function renderWeatherWidget(state) {
    var data = state.data;
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Weather</div>' +
            '<h3 class="inline-title">' + escapeHtml(data.city) + '</h3>' +
            '<p class="inline-copy">' + escapeHtml(data.condition) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Current", data.temperature == null ? "--" : Math.round(data.temperature) + "°", /imperial/i.test(data.units) ? "Imperial" : "Metric") +
          metricCard("Source", data.source, "Bridge weather feed") +
          metricCard("Forecast", String(data.daily.length), "Next 5 days") +
        '</div>' +
        '<div class="inline-grid inline-grid--2">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Hourly</div><div class="router-inline-copy">Next five hours</div></div></div>' +
            '<div class="inline-list">' + (data.hourly.length ? data.hourly.map(function (entry, index) {
              return '' +
                '<div class="inline-list-item inline-list-item--split">' +
                  '<div><div class="inline-list-title">' + escapeHtml(text(entry.hour || entry.time || entry.label, "Hour " + (index + 1))) + '</div><div class="inline-list-copy">' + escapeHtml(text(entry.condition, "Unknown")) + '</div></div>' +
                  '<div class="inline-list-meta">' + escapeHtml((optionalNumber(entry.temp != null ? entry.temp : entry.temperature) == null ? "--" : Math.round(optionalNumber(entry.temp != null ? entry.temp : entry.temperature)) + "°")) + '</div>' +
                '</div>';
            }).join("") : emptyState("No hourly data", "Hourly weather data is unavailable.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">5 day</div><div class="router-inline-copy">High and low</div></div></div>' +
            '<div class="inline-list">' + (data.daily.length ? data.daily.map(function (entry, index) {
              var high = optionalNumber(entry.high != null ? entry.high : entry.tempHigh != null ? entry.tempHigh : entry.temp);
              var low = optionalNumber(entry.low != null ? entry.low : entry.tempLow != null ? entry.tempLow : high);
              return '' +
                '<div class="inline-list-item inline-list-item--split">' +
                  '<div><div class="inline-list-title">' + escapeHtml(text(entry.day || entry.label, "Day " + (index + 1))) + '</div><div class="inline-list-copy">' + escapeHtml(text(entry.condition, "Unknown")) + '</div></div>' +
                  '<div class="inline-list-meta">' + escapeHtml((high == null ? "--" : Math.round(high) + "°") + " / " + (low == null ? "--" : Math.round(low) + "°")) + '</div>' +
                '</div>';
            }).join("") : emptyState("No daily data", "Daily weather data is unavailable.")) + '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountWeatherWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeWeatherPayload({}, env),
      statusText: "Loading",
      statusTone: "warn"
    };

    function redraw() {
      container.innerHTML = renderWeatherWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/weather", {
        city: getSetting(env, "city"),
        units: getSetting(env, "units")
      }), {}, 8000).then(function (payload) {
        state.data = normalizeWeatherPayload(payload, env);
        state.statusText = statusTextFromPayload(payload, state.data.configured ? "Live" : "Setup");
        state.statusTone = statusToneFromPayload(payload, state.data.configured ? "live" : "setup");
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      if (event.target && event.target.getAttribute("data-action") === "refresh") {
        refresh();
      }
    });

    var loop = createTimerLoop(refresh, 600000);
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeHuePayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: Boolean(payload.configured),
      linked: Boolean(payload.linked),
      status: text(payload.status, "setup"),
      bridgeIp: text(payload.bridgeIp, ""),
      bridgeName: text(payload.bridgeName, "Philips Hue"),
      source: text(payload.source, "Hue"),
      message: text(payload.message, "Bridge status unavailable."),
      lights: Array.isArray(payload.lights) ? payload.lights : [],
      groups: Array.isArray(payload.groups) ? payload.groups : []
    };
  }

  function renderHueWidget(state) {
    var data = state.data;
    var controlsEnabled = data.configured && data.linked && !state.busy;
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Philips Hue</div>' +
            '<h3 class="inline-title">' + escapeHtml(data.bridgeIp ? data.bridgeIp : "Bridge setup") + '</h3>' +
            '<p class="inline-copy">' + escapeHtml(data.message) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Bridge", data.bridgeIp || "--", data.bridgeName || "Philips Hue") +
          metricCard("Lights", String(data.lights.length), data.linked ? "Writable bulbs" : "Setup required") +
          metricCard("Groups", String(data.groups.length), data.linked ? "Writable rooms" : "Link pending") +
        '</div>' +
        '<div class="inline-grid inline-grid--2">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Lights</div><div class="router-inline-copy">Tap and drag brightness.</div></div></div>' +
            '<div class="inline-list">' + (data.lights.length ? data.lights.slice(0, 8).map(function (light) {
              return '' +
                '<div class="inline-list-item">' +
                  '<div class="inline-list-item--split">' +
                    '<div><div class="inline-list-title">' + escapeHtml(text(light.name, "Light")) + '</div><div class="inline-list-copy">' + escapeHtml(text(light.type, light.on ? "On" : "Off")) + '</div></div>' +
                    '<button class="inline-button' + (light.on ? " is-primary" : "") + '" type="button" data-action="toggle-light" data-id="' + escapeHtml(text(light.id, "")) + '"' + (controlsEnabled && light.reachable !== false ? "" : " disabled") + '>' + (light.on ? "On" : "Off") + '</button>' +
                  '</div>' +
                  '<div class="inline-slider-row"><strong>' + escapeHtml(formatPercent(light.brightness)) + '</strong><input class="inline-range" type="range" min="0" max="100" value="' + Math.round(optionalNumber(light.brightness) || 0) + '" data-action="brightness-light" data-id="' + escapeHtml(text(light.id, "")) + '"' + (controlsEnabled && light.reachable !== false ? "" : " disabled") + '></div>' +
                '</div>';
            }).join("") : emptyState("No Hue lights", data.configured ? "No Hue lights were returned by the bridge." : "Enter the bridge IP and try linking again.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Diagnostics</div><div class="router-inline-copy">Press the hardware bridge button, then link here.</div></div></div>' +
            '<form class="inline-form" data-form="hue-link">' +
              '<div class="inline-form-grid">' +
                '<label class="inline-field"><span>Bridge IP</span><input class="inline-input" type="text" name="bridgeIp" value="' + escapeHtml(data.bridgeIp) + '" placeholder="192.168.1.50"></label>' +
              '</div>' +
              '<div class="inline-actions"><button class="inline-button is-primary" type="submit">' + (data.linked ? "Relink bridge" : "Link bridge") + '</button></div>' +
            '</form>' +
            '<div class="inline-list">' + (data.groups.length ? data.groups.slice(0, 6).map(function (group) {
              return '' +
                '<div class="inline-list-item">' +
                  '<div class="inline-list-item--split">' +
                    '<div><div class="inline-list-title">' + escapeHtml(text(group.name, "Room")) + '</div><div class="inline-list-copy">' + escapeHtml(text(group.type, "Group")) + '</div></div>' +
                    '<button class="inline-button' + (group.on ? " is-primary" : "") + '" type="button" data-action="toggle-group" data-id="' + escapeHtml(text(group.id, "")) + '"' + (controlsEnabled ? "" : " disabled") + '>' + (group.on ? "On" : "Off") + '</button>' +
                  '</div>' +
                  '<div class="inline-slider-row"><strong>' + escapeHtml(formatPercent(group.brightness)) + '</strong><input class="inline-range" type="range" min="0" max="100" value="' + Math.round(optionalNumber(group.brightness) || 0) + '" data-action="brightness-group" data-id="' + escapeHtml(text(group.id, "")) + '"' + (controlsEnabled ? "" : " disabled") + '></div>' +
                '</div>';
            }).join("") : emptyState("No groups", "Rooms and zones appear here after the bridge is linked.")) + '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountHueWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeHuePayload({}),
      statusText: "Loading",
      statusTone: "warn",
      busy: false
    };

    function redraw() {
      container.innerHTML = renderHueWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/hue"), {}, 5000).then(function (payload) {
        state.data = normalizeHuePayload(payload);
        state.statusText = statusTextFromPayload(payload, state.data.linked ? "Ready" : (state.data.configured ? "Link needed" : "Setup"));
        state.statusTone = statusToneFromPayload(payload, state.data.linked ? "live" : "setup");
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commit(path, body) {
      state.busy = true;
      state.statusText = "Applying";
      state.statusTone = "warn";
      redraw();
      return requestJson(buildBridgeUrl(env, path), {
        method: "POST",
        body: body
      }, 8000).then(function () {
        state.busy = false;
        return refresh();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Action failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");
      var item;
      if (!action || state.busy) {
        return;
      }

      if (action === "refresh") {
        refresh();
        return;
      }

      if (action === "toggle-light") {
        item = state.data.lights.filter(function (light) {
          return text(light.id, "") === text(target.getAttribute("data-id"), "");
        })[0];
        if (item) {
          commit("/api/hue/lights/" + encodeURIComponent(item.id) + "/toggle", {
            state: !item.on
          });
        }
        return;
      }

      if (action === "toggle-group") {
        item = state.data.groups.filter(function (group) {
          return text(group.id, "") === text(target.getAttribute("data-id"), "");
        })[0];
        if (item) {
          commit("/api/hue/groups/" + encodeURIComponent(item.id) + "/toggle", {
            state: !item.on
          });
        }
      }
    });

    addListener(cleanups, container, "input", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");
      if (action !== "brightness-light" && action !== "brightness-group") {
        return;
      }

      var row = target.parentNode;
      var valueNode = row ? row.querySelector("strong") : null;
      if (valueNode) {
        valueNode.textContent = Math.round(optionalNumber(target.value) || 0) + "%";
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");
      var item;

      if (state.busy) {
        return;
      }

      if (action === "brightness-light") {
        item = state.data.lights.filter(function (light) {
          return text(light.id, "") === text(target.getAttribute("data-id"), "");
        })[0];
        if (item) {
          commit("/api/hue/lights/" + encodeURIComponent(item.id) + "/brightness", {
            brightness: clamp(optionalNumber(target.value) || 0, 0, 100)
          });
        }
        return;
      }

      if (action === "brightness-group") {
        item = state.data.groups.filter(function (group) {
          return text(group.id, "") === text(target.getAttribute("data-id"), "");
        })[0];
        if (item) {
          commit("/api/hue/groups/" + encodeURIComponent(item.id) + "/brightness", {
            brightness: clamp(optionalNumber(target.value) || 0, 0, 100)
          });
        }
      }
    });

    addListener(cleanups, container, "submit", function (event) {
      var form = event.target;
      var formId = form && form.getAttribute("data-form");
      var formData;

      if (formId !== "hue-link" || state.busy) {
        return;
      }

      event.preventDefault();
      formData = new FormData(form);
      state.busy = true;
      state.statusText = "Linking";
      state.statusTone = "warn";
      redraw();

      requestJson(buildBridgeUrl(env, "/api/hue/link"), {
        method: "POST",
        body: {
          bridgeIp: String(formData.get("bridgeIp") || "")
        }
      }, 8000).then(function () {
        return setupUpdate(env, "hue");
      }).then(function () {
        state.busy = false;
        return refresh();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Link failed";
        state.statusTone = "danger";
        redraw();
      });
    });

    var loop = createTimerLoop(refresh, 8000, function () {
      return state.busy;
    });
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function detectCameraFeedType(data) {
    var explicit = text(data.feedType, "").toLowerCase();
    var url = text(data.feedUrl || data.relayUrl, "").toLowerCase();
    if (explicit) {
      return explicit;
    }
    if (url.indexOf("rtsp://") === 0) {
      return "rtsp";
    }
    if (/\.m3u8($|\?)/i.test(url)) {
      return "hls";
    }
    if (/\.mp4($|\?)/i.test(url)) {
      return "browser";
    }
    if (data.snapshotUrl) {
      return "snapshot";
    }
    return "browser";
  }

  function normalizeCameraPayload(payload, env) {
    payload = payload || {};
    var feedUrl = text(payload.feedUrl || payload.url, text(getSetting(env, "unifiCameraFeed"), ""));
    var relayUrl = text(payload.relayUrl, text(getSetting(env, "unifiCameraRelayUrl"), ""));
    var snapshotUrl = text(payload.snapshotUrl || payload.snapshot, text(getSetting(env, "unifiCameraSnapshot"), ""));
    return {
      name: text(payload.name || payload.cameraName, text(getSetting(env, "unifiCameraName"), "UniFi Camera")),
      location: text(payload.location || payload.site, text(getSetting(env, "unifiCameraLocation"), "Camera feed")),
      feedType: detectCameraFeedType({
        feedType: payload.feedType || getSetting(env, "unifiCameraFeedType"),
        feedUrl: feedUrl,
        relayUrl: relayUrl,
        snapshotUrl: snapshotUrl
      }),
      feedUrl: feedUrl,
      relayUrl: relayUrl,
      snapshotUrl: snapshotUrl,
      connection: text(payload.connection || payload.status, feedUrl || relayUrl || snapshotUrl ? "online" : "setup").toLowerCase(),
      latencyMs: optionalNumber(payload.latencyMs),
      timestamp: payload.timestamp || payload.updatedAt || new Date().toISOString(),
      source: text(payload.source, feedUrl || relayUrl || snapshotUrl ? "Manual config" : "Needs setup"),
      note: text(payload.note, feedUrl || relayUrl || snapshotUrl ? "" : "Add a relay URL, feed URL, or snapshot URL in settings.")
    };
  }

  function renderCameraWidget(state) {
    var data = state.data;
    var playableUrl = data.relayUrl || data.feedUrl;
    var rawRtsp = data.feedType === "rtsp" && !data.relayUrl;
    var snapshotUrl = data.snapshotUrl
      ? data.snapshotUrl + (data.snapshotUrl.indexOf("?") === -1 ? "?" : "&") + "_ts=" + Date.now()
      : "";
    var mediaHtml = snapshotUrl
      ? '<img class="inline-media__image" src="' + escapeHtml(snapshotUrl) + '" alt="' + escapeHtml(data.name) + '">'
      : '<div class="inline-media__placeholder">No snapshot configured</div>';

    if (playableUrl && !rawRtsp) {
      mediaHtml = '<video class="inline-media__video" src="' + escapeHtml(playableUrl) + '" autoplay muted playsinline controls></video>';
    }

    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">UniFi Camera</div>' +
            '<h3 class="inline-title">' + escapeHtml(data.name) + '</h3>' +
            '<p class="inline-copy">' + escapeHtml(data.location) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            (state.canRefresh ? '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' : "") +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Connection", data.connection, data.source) +
          metricCard("Latency", formatValue(data.latencyMs, " ms"), "Upstream sample") +
          metricCard("Updated", formatAge(data.timestamp), formatWhen(data.timestamp)) +
        '</div>' +
        '<div class="inline-grid inline-grid--2">' +
          '<article class="list-card inline-card inline-card--span-2">' +
            '<div class="inline-card-header"><div><div class="metric-label">Live feed</div><div class="router-inline-copy">' + escapeHtml(rawRtsp ? "Raw RTSP needs a browser relay. Snapshot fallback is shown instead." : (data.note || "Browser-playable video or snapshot fallback.")) + '</div></div></div>' +
            '<div class="inline-media">' + mediaHtml + '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountCameraWidget(widget, container, env) {
    var cleanups = [];
    var endpoint = getSetting(env, "unifiCameraEndpoint");
    var state = {
      data: normalizeCameraPayload({}, env),
      statusText: endpoint ? "Loading" : "Ready",
      statusTone: endpoint ? "warn" : "good",
      canRefresh: Boolean(endpoint)
    };

    function redraw() {
      container.innerHTML = renderCameraWidget(state);
    }

    function refresh() {
      if (!endpoint) {
        state.data = normalizeCameraPayload({}, env);
        state.statusText = state.data.feedUrl || state.data.relayUrl || state.data.snapshotUrl ? "Ready" : "Setup";
        state.statusTone = state.statusText === "Ready" ? "good" : "warn";
        redraw();
        return Promise.resolve();
      }

      return requestJson(endpoint, {}, 8000).then(function (payload) {
        state.data = normalizeCameraPayload(payload, env);
        state.statusText = "Live";
        state.statusTone = "good";
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      if (event.target && event.target.getAttribute("data-action") === "refresh") {
        refresh();
      }
    });

    var loop = createTimerLoop(refresh, endpoint ? 8000 : 0);
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeUniFiNetworkPayload(payload) {
    payload = payload || {};
    var wan = payload.wan || {};
    var clients = payload.clients || {};
    return {
      gateway: text(payload.gateway || payload.gatewayCopy, "UniFi Gateway"),
      source: text(payload.source, "UniFi endpoint"),
      status: text(payload.status, ""),
      message: text(payload.message, ""),
      detected: Boolean(payload.detected),
      provider: text(payload.provider, ""),
      monthlyUsageGb: optionalNumber(payload.monthlyUsageGb),
      latencyMs: optionalNumber(payload.latencyMs),
      packetLoss: optionalNumber(payload.packetLoss),
      wan: {
        downloadMbps: optionalNumber(wan.downloadMbps),
        uploadMbps: optionalNumber(wan.uploadMbps),
        capacityDownMbps: optionalNumber(wan.capacityDownMbps),
        capacityUpMbps: optionalNumber(wan.capacityUpMbps)
      },
      clients: {
        total: optionalNumber(clients.total) || 0,
        wifi: optionalNumber(clients.wifi) || 0,
        wired: optionalNumber(clients.wired) || 0,
        guests: optionalNumber(clients.guests) || 0
      },
      aps: Array.isArray(payload.aps) ? payload.aps : [],
      topClients: Array.isArray(payload.topClients) ? payload.topClients : [],
      topApps: Array.isArray(payload.topApps) ? payload.topApps : []
    };
  }

  function renderUniFiNetworkWidget(state) {
    var data = state.data;
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">UniFi Network</div>' +
            '<h3 class="inline-title">' + escapeHtml(data.gateway) + '</h3>' +
            '<p class="inline-copy">' + escapeHtml(data.provider || data.source) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--4">' +
          metricCard("Download", formatRate(data.wan.downloadMbps), data.wan.capacityDownMbps != null ? Math.round(data.wan.capacityDownMbps) + " Mbps capacity" : "WAN download") +
          metricCard("Upload", formatRate(data.wan.uploadMbps), data.wan.capacityUpMbps != null ? Math.round(data.wan.capacityUpMbps) + " Mbps capacity" : "WAN upload") +
          metricCard("Latency", formatValue(data.latencyMs, " ms"), data.packetLoss != null ? data.packetLoss.toFixed(1) + "% loss" : "Gateway sample") +
          metricCard("Clients", String(data.clients.total), data.clients.wifi + " Wi-Fi / " + data.clients.wired + " wired") +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Access points</div><div class="router-inline-copy">Health and client load</div></div></div>' +
            '<div class="inline-list">' + (data.aps.length ? data.aps.slice(0, 6).map(function (ap) {
              return '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">' + escapeHtml(text(ap.name, "Access Point")) + '</div><div class="inline-list-copy">' + escapeHtml(text(ap.status, "online")) + '</div></div><div class="inline-list-meta">' + escapeHtml(String(optionalNumber(ap.clients) || 0) + " clients") + '</div></div>';
            }).join("") : emptyState("No AP data", "AP details were not returned by this endpoint.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Top clients</div><div class="router-inline-copy">Heavy talkers</div></div></div>' +
            '<div class="inline-list">' + (data.topClients.length ? data.topClients.slice(0, 6).map(function (client) {
              return '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">' + escapeHtml(text(client.name, client.hostname || "Client")) + '</div><div class="inline-list-copy">' + escapeHtml(text(client.ip, client.mac || "")) + '</div></div><div class="inline-list-meta">' + escapeHtml(text(client.usage || client.rate || "", "--")) + '</div></div>';
            }).join("") : emptyState("No client data", "Top client usage was not returned by this endpoint.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Top apps</div><div class="router-inline-copy">Traffic categories</div></div></div>' +
            '<div class="inline-list">' + (data.topApps.length ? data.topApps.slice(0, 6).map(function (app) {
              return '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">' + escapeHtml(text(app.name, "Application")) + '</div><div class="inline-list-copy">' + escapeHtml(text(app.category, "")) + '</div></div><div class="inline-list-meta">' + escapeHtml(text(app.usage || app.share || "", "--")) + '</div></div>';
            }).join("") : emptyState("No app data", "Top application usage was not returned by this endpoint.")) + '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountUniFiNetworkWidget(widget, container, env) {
    var cleanups = [];
    var endpoint = getUniFiNetworkEndpoint(env);
    var state = {
      data: normalizeUniFiNetworkPayload({}),
      statusText: endpoint ? "Loading" : "Setup",
      statusTone: endpoint ? "warn" : "warn"
    };

    function redraw() {
      container.innerHTML = renderUniFiNetworkWidget(state);
    }

    function refresh() {
      if (!endpoint) {
        redraw();
        return Promise.resolve();
      }

      return requestJson(endpoint, {}, 8000).then(function (payload) {
        state.data = normalizeUniFiNetworkPayload(payload);
        state.statusText = statusTextFromPayload(payload, "Live");
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      if (event.target && event.target.getAttribute("data-action") === "refresh") {
        refresh();
      }
    });

    var loop = createTimerLoop(refresh, endpoint ? 5000 : 0);
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizePlexPayload(payload, env) {
    payload = payload || {};
    return {
      server: text(payload.server || payload.copy, "Plex Server"),
      copy: text(payload.copy, getSetting(env, "plexEndpoint") ? "Live session telemetry." : "Native Plex connector is planned."),
      source: text(payload.source, getSetting(env, "plexEndpoint") ? "Plex connector" : "Planned"),
      uplinkLimitMbps: optionalNumber(payload.uplinkLimitMbps != null ? payload.uplinkLimitMbps : getSetting(env, "plexUplink")),
      totalBandwidthMbps: optionalNumber(payload.totalBandwidthMbps),
      transcodes: optionalNumber(payload.transcodes) || 0,
      directPlays: optionalNumber(payload.directPlays) || 0,
      activeStreams: optionalNumber(payload.activeStreams) || 0,
      remoteStreams: optionalNumber(payload.remoteStreams) || 0,
      streams: Array.isArray(payload.streams) ? payload.streams : []
    };
  }

  function renderPlexWidget(state, env) {
    var data = state.data;
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Plex Server</div>' +
            '<h3 class="inline-title">' + escapeHtml(data.server) + '</h3>' +
            '<p class="inline-copy">' + escapeHtml(data.copy) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--4">' +
          metricCard("Streams", String(data.activeStreams), "Active sessions") +
          metricCard("Transcodes", String(data.transcodes), "CPU-heavy sessions") +
          metricCard("Direct", String(data.directPlays), "Direct plays") +
          metricCard("Bandwidth", formatRate(data.totalBandwidthMbps), data.uplinkLimitMbps != null ? Math.round(data.uplinkLimitMbps) + " Mbps uplink budget" : "Live bandwidth") +
        '</div>' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header"><div><div class="metric-label">Sessions</div><div class="router-inline-copy">' + escapeHtml(data.source) + '</div></div></div>' +
          '<div class="inline-list">' + (data.streams.length ? data.streams.slice(0, 8).map(function (stream) {
            return '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">' + escapeHtml(text(stream.user, stream.title || "Stream")) + '</div><div class="inline-list-copy">' + escapeHtml(text(stream.title, text(stream.state, "Playing"))) + '</div></div><div class="inline-list-meta">' + escapeHtml(text(stream.bandwidth || stream.type || "", "--")) + '</div></div>';
          }).join("") : emptyState("No active streams", getSetting(env, "plexEndpoint") ? "The Plex server is idle right now." : "Plex will light up after the native connector is added.")) + '</div>' +
        '</article>' +
      '</div>';
  }

  function mountPlexWidget(widget, container, env) {
    var cleanups = [];
    var endpoint = getSetting(env, "plexEndpoint");
    var state = {
      data: normalizePlexPayload({}, env),
      statusText: endpoint ? "Loading" : "Setup",
      statusTone: endpoint ? "warn" : "warn"
    };

    function redraw() {
      container.innerHTML = renderPlexWidget(state, env);
    }

    function refresh() {
      if (!endpoint) {
        redraw();
        return Promise.resolve();
      }

      return requestJson(endpoint, {}, 8000).then(function (payload) {
        state.data = normalizePlexPayload(payload, env);
        state.statusText = "Live";
        state.statusTone = "good";
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      if (event.target && event.target.getAttribute("data-action") === "refresh") {
        refresh();
      }
    });

    var loop = createTimerLoop(refresh, endpoint ? 8000 : 0);
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeNasPayload(payload, env) {
    payload = payload || {};
    return {
      system: text(payload.system || payload.nas, "NAS Storage"),
      copy: text(payload.copy, getSetting(env, "nasEndpoint") ? "Pools and drive health are live." : "Native NAS connector is planned."),
      source: text(payload.source, getSetting(env, "nasEndpoint") ? "NAS connector" : "Planned"),
      pools: Array.isArray(payload.pools) ? payload.pools : [],
      drives: Array.isArray(payload.drives) ? payload.drives : []
    };
  }

  function renderNasWidget(state, env) {
    var data = state.data;
    var hottestDrive = data.drives.reduce(function (hottest, drive) {
      return !hottest || (optionalNumber(drive.tempC) || 0) > (optionalNumber(hottest.tempC) || 0) ? drive : hottest;
    }, null);
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">NAS Storage</div>' +
            '<h3 class="inline-title">' + escapeHtml(data.system) + '</h3>' +
            '<p class="inline-copy">' + escapeHtml(data.copy) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--4">' +
          metricCard("Pools", String(data.pools.length), "Storage pools") +
          metricCard("Drives", String(data.drives.length), "Physical disks") +
          metricCard("Hottest", hottestDrive ? Math.round(optionalNumber(hottestDrive.tempC) || 0) + " C" : "--", hottestDrive ? text(hottestDrive.name, "Drive") : "No drive data") +
          metricCard("Source", data.source, "Storage connector") +
        '</div>' +
        '<div class="inline-grid inline-grid--2">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Pools</div><div class="router-inline-copy">Capacity and health</div></div></div>' +
            '<div class="inline-list">' + (data.pools.length ? data.pools.map(function (pool) {
              var used = optionalNumber(pool.usedPercent);
              var summary = pool.usedTb != null && pool.totalTb != null
                ? formatStorage(pool.usedTb, "TB") + " / " + formatStorage(pool.totalTb, "TB")
                : formatPercent(used);
              return '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">' + escapeHtml(text(pool.name, "Pool")) + '</div><div class="inline-list-copy">' + escapeHtml(text(pool.health, "Healthy")) + '</div></div><div class="inline-list-meta">' + escapeHtml(summary) + '</div></div>';
            }).join("") : emptyState("No pool data", getSetting(env, "nasEndpoint") ? "Pools were not returned by this connector." : "NAS storage will light up after the native connector is added.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Drives</div><div class="router-inline-copy">Health and temperature</div></div></div>' +
            '<div class="inline-list">' + (data.drives.length ? data.drives.slice(0, 8).map(function (drive) {
              return '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">' + escapeHtml(text(drive.name, "Drive")) + '</div><div class="inline-list-copy">' + escapeHtml(text(drive.health || drive.status, "Online")) + '</div></div><div class="inline-list-meta">' + escapeHtml(formatTemp(drive.tempC)) + '</div></div>';
            }).join("") : emptyState("No drive data", getSetting(env, "nasEndpoint") ? "Drive telemetry was not returned by this connector." : "Drive health will light up after the native connector is added.")) + '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountNasWidget(widget, container, env) {
    var cleanups = [];
    var endpoint = getSetting(env, "nasEndpoint");
    var state = {
      data: normalizeNasPayload({}, env),
      statusText: endpoint ? "Loading" : "Setup",
      statusTone: endpoint ? "warn" : "warn"
    };

    function redraw() {
      container.innerHTML = renderNasWidget(state, env);
    }

    function refresh() {
      if (!endpoint) {
        redraw();
        return Promise.resolve();
      }

      return requestJson(endpoint, {}, 8000).then(function (payload) {
        state.data = normalizeNasPayload(payload, env);
        state.statusText = "Live";
        state.statusTone = "good";
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      if (event.target && event.target.getAttribute("data-action") === "refresh") {
        refresh();
      }
    });

    var loop = createTimerLoop(refresh, endpoint ? 10000 : 0);
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeAutomationPayload(payload, env) {
    payload = payload || {};
    return {
      source: text(payload.source, getSetting(env, "automationEndpoint") ? "Automation connector" : "Native smart-home connector is planned"),
      lights: Array.isArray(payload.lights) ? payload.lights : [],
      switches: Array.isArray(payload.switches) ? payload.switches : [],
      scenes: Array.isArray(payload.scenes) ? payload.scenes : []
    };
  }

  function renderAutomationWidget(state, env) {
    var data = state.data;
    var writable = Boolean(getSetting(env, "automationActionEndpoint"));
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Home Automation</div>' +
            '<h3 class="inline-title">Lights, switches, and scenes</h3>' +
            '<p class="inline-copy">' + escapeHtml(data.source) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Lights", String(data.lights.length), writable ? "Writable" : "Read only") +
          metricCard("Switches", String(data.switches.length), writable ? "Writable" : "Read only") +
          metricCard("Scenes", String(data.scenes.length), writable ? "Trigger ready" : "Read only") +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Lights</div><div class="router-inline-copy">Tap and drag brightness.</div></div></div>' +
            '<div class="inline-list">' + (data.lights.length ? data.lights.map(function (light) {
              return '' +
                '<div class="inline-list-item">' +
                  '<div class="inline-list-item--split">' +
                    '<div><div class="inline-list-title">' + escapeHtml(text(light.name, "Light")) + '</div><div class="inline-list-copy">' + escapeHtml(light.on ? "On" : "Off") + '</div></div>' +
                    '<button class="inline-button' + (light.on ? " is-primary" : "") + '" type="button" data-action="toggle-light" data-id="' + escapeHtml(text(light.id, "")) + '"' + (writable ? "" : " disabled") + '>' + (light.on ? "On" : "Off") + '</button>' +
                  '</div>' +
                  '<div class="inline-slider-row"><strong>' + escapeHtml(formatPercent(light.brightness)) + '</strong><input class="inline-range" type="range" min="0" max="100" value="' + Math.round(optionalNumber(light.brightness) || 0) + '" data-action="brightness-light" data-id="' + escapeHtml(text(light.id, "")) + '"' + (writable ? "" : " disabled") + '></div>' +
                '</div>';
            }).join("") : emptyState("No lights", getSetting(env, "automationEndpoint") ? "No light state was returned by this connector." : "Smart-home controls will light up after the native connector is added.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Switches</div><div class="router-inline-copy">Binary controls</div></div></div>' +
            '<div class="inline-list">' + (data.switches.length ? data.switches.map(function (item) {
              return '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">' + escapeHtml(text(item.name, "Switch")) + '</div><div class="inline-list-copy">' + escapeHtml(text(item.detail, item.on ? "On" : "Off")) + '</div></div><button class="inline-button' + (item.on ? " is-primary" : "") + '" type="button" data-action="toggle-switch" data-id="' + escapeHtml(text(item.id, "")) + '"' + (writable ? "" : " disabled") + '>' + (item.on ? "On" : "Off") + '</button></div>';
            }).join("") : emptyState("No switches", getSetting(env, "automationEndpoint") ? "No switch state was returned by this connector." : "Switch controls will light up after the native connector is added.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Scenes</div><div class="router-inline-copy">One-touch automations</div></div></div>' +
            '<div class="inline-list">' + (data.scenes.length ? data.scenes.slice(0, 6).map(function (scene) {
              return '<button class="inline-button is-primary inline-button--block" type="button" data-action="scene" data-id="' + escapeHtml(text(scene.id, "")) + '"' + (writable ? "" : " disabled") + '>' + escapeHtml(text(scene.name, "Scene")) + '</button>';
            }).join("") : emptyState("No scenes", getSetting(env, "automationEndpoint") ? "No scenes were returned by this connector." : "Scenes will light up after the native connector is added.")) + '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountAutomationWidget(widget, container, env) {
    var cleanups = [];
    var endpoint = getSetting(env, "automationEndpoint");
    var actionEndpoint = getSetting(env, "automationActionEndpoint");
    var state = {
      data: normalizeAutomationPayload({}, env),
      statusText: endpoint ? "Loading" : "Setup",
      statusTone: endpoint ? "warn" : "warn",
      busy: false,
      interacting: false
    };

    function redraw() {
      container.innerHTML = renderAutomationWidget(state, env);
    }

    function refresh() {
      if (!endpoint) {
        redraw();
        return Promise.resolve();
      }

      return requestJson(endpoint, {}, 8000).then(function (payload) {
        state.data = normalizeAutomationPayload(payload, env);
        state.statusText = actionEndpoint ? "Writable" : "Read only";
        state.statusTone = actionEndpoint ? "good" : "warn";
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commit(body) {
      if (!actionEndpoint) {
        state.statusText = "Read only";
        state.statusTone = "warn";
        redraw();
        return Promise.resolve();
      }

      state.busy = true;
      state.statusText = "Applying";
      state.statusTone = "warn";
      redraw();

      return requestJson(actionEndpoint, {
        method: "POST",
        body: body
      }, 8000).then(function () {
        state.busy = false;
        return refresh();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Action failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");
      var item;

      if (!action || state.busy) {
        return;
      }

      if (action === "refresh") {
        refresh();
        return;
      }

      if (action === "toggle-light") {
        item = state.data.lights.filter(function (light) {
          return text(light.id, "") === text(target.getAttribute("data-id"), "");
        })[0];
        if (item) {
          commit({
            kind: "light",
            action: "toggle",
            id: item.id,
            state: !item.on,
            brightness: item.brightness
          });
        }
        return;
      }

      if (action === "toggle-switch") {
        item = state.data.switches.filter(function (entry) {
          return text(entry.id, "") === text(target.getAttribute("data-id"), "");
        })[0];
        if (item) {
          commit({
            kind: "switch",
            action: "toggle",
            id: item.id,
            state: !item.on
          });
        }
        return;
      }

      if (action === "scene") {
        commit({
          action: "scene",
          sceneId: String(target.getAttribute("data-id") || "")
        });
      }
    });

    addListener(cleanups, container, "input", function (event) {
      var target = event.target;
      if (target && target.getAttribute("data-action") === "brightness-light") {
        state.interacting = true;
        var row = target.parentNode;
        var valueNode = row ? row.querySelector("strong") : null;
        if (valueNode) {
          valueNode.textContent = Math.round(optionalNumber(target.value) || 0) + "%";
        }
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      var item;
      state.interacting = false;
      if (!target || target.getAttribute("data-action") !== "brightness-light" || state.busy) {
        return;
      }

      item = state.data.lights.filter(function (light) {
        return text(light.id, "") === text(target.getAttribute("data-id"), "");
      })[0];

      if (item) {
        commit({
          kind: "light",
          action: "brightness",
          id: item.id,
          state: (optionalNumber(target.value) || 0) > 0,
          brightness: clamp(optionalNumber(target.value) || 0, 0, 100)
        });
      }
    });

    addListener(cleanups, container, "pointerup", function () {
      state.interacting = false;
    });

    addListener(cleanups, container, "pointercancel", function () {
      state.interacting = false;
    });

    var loop = createTimerLoop(refresh, endpoint ? 5000 : 0, function () {
      return state.busy || state.interacting;
    });
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeCalendarPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: Boolean(payload.configured),
      status: text(payload.status, payload.configured ? "idle" : "setup"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, payload.configured ? "No upcoming events in the configured feed." : "Calendar ICS URL missing"),
      source: text(payload.source, payload.configured ? "ics" : "Needs setup"),
      entries: Array.isArray(payload.entries) ? payload.entries : []
    };
  }

  function renderCalendarWidget(state, env) {
    var data = state.data;
    var entries = data.entries.slice(0, 6);
    var configuredUrl = env.bridgeConfig && env.bridgeConfig.calendar ? text(env.bridgeConfig.calendar.icsUrl, "") : "";
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Calendar</div>' +
            '<h3 class="inline-title">Upcoming events</h3>' +
            '<p class="inline-copy">' + escapeHtml(text(data.message, configuredUrl ? "ICS feed is configured." : "Add an ICS feed in Diagnostics to enable calendar.")) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Feed", data.configured ? "Connected" : "Setup", text(data.source, data.configured ? "ICS feed" : "Needs setup")) +
          metricCard("Events", String(entries.length), entries.length ? "Upcoming items" : (data.configured ? "Nothing soon" : "Waiting for feed")) +
          metricCard("Updated", formatAge(data.sampledAt), data.stale ? "Sample is stale" : "Fresh snapshot") +
        '</div>' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header">' +
            '<div>' +
              '<div class="metric-label">Next up</div>' +
              '<div class="router-inline-copy">' + escapeHtml(configuredUrl ? configuredUrl : "Configure a reachable ICS feed in Diagnostics.") + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="inline-list">' + (entries.length ? entries.map(function (entry) {
            return '' +
              '<div class="inline-list-item inline-list-item--split">' +
                '<div>' +
                  '<div class="inline-list-title">' + escapeHtml(text(entry.title, "Calendar event")) + '</div>' +
                  '<div class="inline-list-copy">' + escapeHtml(text(entry.detail, "Calendar event")) + '</div>' +
                '</div>' +
                '<div class="inline-list-meta">' + escapeHtml(text(entry.time, "--")) + '</div>' +
              '</div>';
          }).join("") : emptyState(data.configured ? "No upcoming events" : "Calendar setup needed", data.message)) + '</div>' +
        '</article>' +
      '</div>';
  }

  function mountCalendarWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeCalendarPayload({}),
      statusText: "Loading",
      statusTone: "warn"
    };

    function redraw() {
      container.innerHTML = renderCalendarWidget(state, env);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/calendar"), {}, 6000).then(function (payload) {
        state.data = normalizeCalendarPayload(payload);
        state.statusText = statusTextFromPayload(payload, state.data.entries.length ? "Live" : "Idle");
        state.statusTone = statusToneFromPayload(payload, state.data.entries.length ? "live" : state.data.status);
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      if (event.target && event.target.getAttribute("data-action") === "refresh") {
        refresh();
      }
    });

    var loop = createTimerLoop(refresh, 60000);
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeMediaPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: payload.configured !== false,
      status: text(payload.status, "starting"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, ""),
      source: text(payload.source, "windows media session"),
      appId: text(payload.appId, ""),
      title: text(payload.title, ""),
      artist: text(payload.artist, ""),
      albumTitle: text(payload.albumTitle, ""),
      albumArtist: text(payload.albumArtist, ""),
      playbackStatus: text(payload.playbackStatus, "idle"),
      positionMs: Math.max(0, optionalNumber(payload.positionMs) || 0),
      durationMs: Math.max(0, optionalNumber(payload.durationMs) || 0),
      canPlay: Boolean(payload.canPlay),
      canPause: Boolean(payload.canPause),
      canGoNext: Boolean(payload.canGoNext),
      canGoPrevious: Boolean(payload.canGoPrevious),
      thumbnailDataUrl: text(payload.thumbnailDataUrl, "")
    };
  }

  function renderMediaWidget(state) {
    var data = state.data;
    var hasSession = data.status === "live" || data.status === "stale";
    var playbackLabel = text(data.playbackStatus, "idle").replace(/-/g, " ").replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
    var progressPercent = data.durationMs > 0 ? clamp((data.positionMs / data.durationMs) * 100, 0, 100) : null;
    var primaryAction = data.playbackStatus === "playing"
      ? { action: "pause", label: "Pause", enabled: data.canPause }
      : { action: "play", label: "Play", enabled: data.canPlay || data.playbackStatus === "paused" };

    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Media</div>' +
            '<h3 class="inline-title">Now playing</h3>' +
            '<p class="inline-copy">' + escapeHtml(text(data.message, "Windows media transport controls are ready.")) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            '<button class="inline-button" type="button" data-action="previous"' + (state.busy || !hasSession || !data.canGoPrevious ? " disabled" : "") + '>Prev</button>' +
            '<button class="inline-button is-primary" type="button" data-action="' + escapeHtml(primaryAction.action) + '"' + (state.busy || !hasSession || !primaryAction.enabled ? " disabled" : "") + '>' + escapeHtml(primaryAction.label) + '</button>' +
            '<button class="inline-button" type="button" data-action="next"' + (state.busy || !hasSession || !data.canGoNext ? " disabled" : "") + '>Next</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Playback", hasSession ? playbackLabel : "Idle", text(data.source, "Windows media session"), progressPercent) +
          metricCard("Source", formatMediaAppLabel(data.appId), data.albumTitle ? data.albumTitle : "Foreground media app") +
          metricCard("Updated", formatAge(data.sampledAt), data.stale ? "Sample is stale" : "Fresh snapshot") +
        '</div>' +
        '<article class="list-card inline-card">' + (hasSession ? (
          '<div class="inline-media-hero">' +
            (data.thumbnailDataUrl
              ? '<img class="inline-media-art" src="' + escapeHtml(data.thumbnailDataUrl) + '" alt="Album art">'
              : '<div class="inline-media-art inline-media-art--placeholder">No Art</div>') +
            '<div class="inline-media-copy">' +
              '<div class="inline-card-header">' +
                '<div>' +
                  '<div class="metric-label">Track</div>' +
                  '<div class="inline-list-title">' + escapeHtml(text(data.title, "Unknown title")) + '</div>' +
                  '<div class="inline-list-copy">' + escapeHtml(text(data.artist, text(data.albumArtist, "Unknown artist"))) + '</div>' +
                '</div>' +
                '<div class="inline-list-meta">' + escapeHtml(formatDurationMs(data.positionMs) + " / " + formatDurationMs(data.durationMs)) + '</div>' +
              '</div>' +
              (progressPercent == null ? "" : '<div class="inline-progress"><span class="inline-progress__bar" style="width:' + progressPercent + '%"></span></div>') +
              '<div class="inline-grid inline-grid--2">' +
                '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">Album</div><div class="inline-list-copy">' + escapeHtml(text(data.albumTitle, "No album metadata")) + '</div></div><div class="inline-list-meta">' + escapeHtml(text(data.albumArtist, " ")) + '</div></div>' +
                '<div class="inline-list-item inline-list-item--split"><div><div class="inline-list-title">App</div><div class="inline-list-copy">' + escapeHtml(text(data.source, "Windows media session")) + '</div></div><div class="inline-list-meta">' + escapeHtml(formatMediaAppLabel(data.appId)) + '</div></div>' +
              '</div>' +
            '</div>' +
          '</div>'
        ) : emptyState("No active media session", data.message || "Start playback in a Windows media app to populate this panel.")) + '</article>' +
      '</div>';
  }

  function mountMediaWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeMediaPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      busy: false
    };

    function redraw() {
      container.innerHTML = renderMediaWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/media"), {}, 5000).then(function (payload) {
        state.data = normalizeMediaPayload(payload);
        state.statusText = statusTextFromPayload(payload, text(state.data.playbackStatus, "Idle").replace(/-/g, " "));
        state.statusTone = statusToneFromPayload(payload, state.data.playbackStatus);
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commit(action) {
      state.busy = true;
      state.statusText = "Applying";
      state.statusTone = "warn";
      redraw();
      return requestJson(buildBridgeUrl(env, "/api/media/" + action), {
        method: "POST"
      }, 8000).then(function () {
        state.busy = false;
        return refresh();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Action failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var action = event.target && event.target.getAttribute("data-action");
      if (!action || state.busy) {
        return;
      }

      if (action === "refresh") {
        refresh();
        return;
      }

      if (action === "play" || action === "pause" || action === "next" || action === "previous" || action === "play-pause") {
        commit(action);
      }
    });

    var loop = createTimerLoop(refresh, 5000, function () {
      return state.busy;
    });
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeLaunchersPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: Boolean(payload.configured),
      status: text(payload.status, payload.configured ? "live" : "setup"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, payload.configured ? "Pinned launchers are ready." : "Add apps or shortcuts to build your launcher grid."),
      source: text(payload.source, "config"),
      entries: Array.isArray(payload.entries) ? payload.entries.map(function (entry) {
        return {
          id: text(entry.id, ""),
          displayName: text(entry.displayName, "Launcher"),
          iconPath: text(entry.iconPath, ""),
          executablePath: text(entry.executablePath, ""),
          arguments: text(entry.arguments, ""),
          iconUrl: text(entry.iconUrl, ""),
          tileLabel: text(entry.tileLabel, "?")
        };
      }) : []
    };
  }

  function renderLaunchersWidget(state) {
    var data = state.data;
    var entries = data.entries.slice();
    var editing = Boolean(state.form.id);
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Command Center</div>' +
            '<h3 class="inline-title">App launcher</h3>' +
            '<p class="inline-copy">' + escapeHtml(text(data.message, "Pin apps and shortcuts for one-tap launches from the EDGE display.")) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh"' + (state.saving ? " disabled" : "") + '>Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Pinned", String(entries.length), entries.length ? "Ready to launch" : "Add your first app") +
          metricCard("Mode", editing ? "Editing" : "Adding", editing ? "Updating an existing tile" : "Create a new launcher tile") +
          metricCard("Updated", formatAge(data.sampledAt), data.stale ? "Snapshot is stale" : "Saved in config.json") +
        '</div>' +
        '<div class="inline-grid inline-grid--2">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Pinned Apps</div>' +
                '<div class="router-inline-copy">Tap a tile to launch it instantly.</div>' +
              '</div>' +
            '</div>' +
            '<div class="inline-launcher-grid">' + (entries.length ? entries.map(function (entry) {
              return '' +
                '<article class="inline-launcher-tile">' +
                  '<button class="inline-launcher-hit" type="button" data-action="launch" data-id="' + escapeHtml(entry.id) + '"' + ((state.saving || state.launchingId === entry.id) ? " disabled" : "") + '>' +
                    '<span class="inline-launcher-icon">' + (entry.iconUrl
                      ? '<img src="' + escapeHtml(entry.iconUrl) + '" alt="' + escapeHtml(entry.displayName) + '">'
                      : '<span>' + escapeHtml(entry.tileLabel) + '</span>') + '</span>' +
                    '<span class="inline-launcher-copy">' +
                      '<strong>' + escapeHtml(entry.displayName) + '</strong>' +
                      '<small>' + escapeHtml(entry.arguments ? (entry.executablePath + " " + entry.arguments) : entry.executablePath) + '</small>' +
                    '</span>' +
                  '</button>' +
                  '<div class="inline-launcher-actions">' +
                    '<button class="inline-button" type="button" data-action="edit" data-id="' + escapeHtml(entry.id) + '"' + (state.saving ? " disabled" : "") + '>Edit</button>' +
                    '<button class="inline-button" type="button" data-action="remove" data-id="' + escapeHtml(entry.id) + '"' + (state.saving ? " disabled" : "") + '>Remove</button>' +
                  '</div>' +
                '</article>';
            }).join("") : emptyState("No launchers yet", "Add apps or shortcuts on the right, then they will show up here.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">' + (editing ? "Edit Launcher" : "Add Launcher") + '</div>' +
                '<div class="router-inline-copy">Display name, executable path, optional icon, and optional arguments.</div>' +
              '</div>' +
            '</div>' +
            '<form class="inline-form" data-role="launcher-form">' +
              '<input type="hidden" name="id" value="' + escapeHtml(state.form.id) + '">' +
              '<div class="inline-form-grid inline-form-grid--2">' +
                '<label class="inline-field"><span>Display Name</span><input class="inline-input" type="text" name="displayName" value="' + escapeHtml(state.form.displayName) + '" placeholder="Discord"></label>' +
                '<label class="inline-field"><span>Executable Path</span><input class="inline-input" type="text" name="executablePath" value="' + escapeHtml(state.form.executablePath) + '" placeholder="C:\\Program Files\\Discord\\Update.exe"></label>' +
              '</div>' +
              '<div class="inline-form-grid inline-form-grid--2">' +
                '<label class="inline-field"><span>Icon Path</span><input class="inline-input" type="text" name="iconPath" value="' + escapeHtml(state.form.iconPath) + '" placeholder="C:\\Icons\\discord.ico"></label>' +
                '<label class="inline-field"><span>Arguments</span><input class="inline-input" type="text" name="arguments" value="' + escapeHtml(state.form.arguments) + '" placeholder="--processStart Discord.exe"></label>' +
              '</div>' +
              '<div class="inline-actions">' +
                '<button class="inline-button is-primary" type="submit"' + (state.saving ? " disabled" : "") + '>' + (editing ? "Save launcher" : "Add launcher") + '</button>' +
                '<button class="inline-button" type="button" data-action="cancel-edit"' + (!editing || state.saving ? " disabled" : "") + '>Cancel</button>' +
              '</div>' +
            '</form>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountLaunchersWidget(widget, container, env) {
    var cleanups = [];
    var emptyForm = {
      id: "",
      displayName: "",
      executablePath: "",
      iconPath: "",
      arguments: ""
    };
    var state = {
      data: normalizeLaunchersPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      saving: false,
      launchingId: "",
      form: Object.assign({}, emptyForm)
    };

    function redraw() {
      container.innerHTML = renderLaunchersWidget(state);
    }

    function resetForm() {
      state.form = Object.assign({}, emptyForm);
    }

    function findEntry(id) {
      return state.data.entries.filter(function (entry) {
        return text(entry.id, "") === text(id, "");
      })[0] || null;
    }

    function saveEntries(entries, successMessage) {
      state.saving = true;
      state.statusText = "Saving";
      state.statusTone = "warn";
      redraw();

      return requestJson(buildBridgeUrl(env, "/api/launchers"), {
        method: "POST",
        body: {
          entries: entries
        }
      }, 8000).then(function (payload) {
        state.data = normalizeLaunchersPayload(payload);
        state.saving = false;
        state.statusText = successMessage || "Saved";
        state.statusTone = "good";
        resetForm();
        redraw();
      }, function (error) {
        state.saving = false;
        state.statusText = error.message || "Save failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/launchers"), {}, 6000).then(function (payload) {
        state.data = normalizeLaunchersPayload(payload);
        state.statusText = statusTextFromPayload(payload, state.data.entries.length ? "Live" : "Setup");
        state.statusTone = statusToneFromPayload(payload, state.data.status);
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "submit", function (event) {
      if (!event.target || event.target.getAttribute("data-role") !== "launcher-form") {
        return;
      }

      event.preventDefault();

      var formData = new FormData(event.target);
      var entry = {
        id: String(formData.get("id") || ""),
        displayName: String(formData.get("displayName") || ""),
        executablePath: String(formData.get("executablePath") || ""),
        iconPath: String(formData.get("iconPath") || ""),
        arguments: String(formData.get("arguments") || "")
      };
      var entries = state.data.entries.map(function (current) {
        return {
          id: current.id,
          displayName: current.displayName,
          executablePath: current.executablePath,
          iconPath: current.iconPath,
          arguments: current.arguments
        };
      });
      var index = entries.findIndex(function (current) {
        return text(current.id, "") === text(entry.id, "");
      });

      if (index >= 0) {
        entries[index] = entry;
      } else {
        entry.id = "";
        entries.push(entry);
      }

      saveEntries(entries, index >= 0 ? "Launcher updated" : "Launcher added");
    });

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var entry;
      var entries;
      if (!target) {
        return;
      }

      if (target.getAttribute("data-action") === "refresh" && !state.saving) {
        refresh();
        return;
      }

      if (target.getAttribute("data-action") === "cancel-edit" && !state.saving) {
        resetForm();
        redraw();
        return;
      }

      if (state.saving) {
        return;
      }

      entry = findEntry(target.getAttribute("data-id"));
      if (target.getAttribute("data-action") === "edit" && entry) {
        state.form = {
          id: entry.id,
          displayName: entry.displayName,
          executablePath: entry.executablePath,
          iconPath: entry.iconPath,
          arguments: entry.arguments
        };
        redraw();
        return;
      }

      if (target.getAttribute("data-action") === "remove" && entry) {
        entries = state.data.entries.filter(function (current) {
          return text(current.id, "") !== entry.id;
        }).map(function (current) {
          return {
            id: current.id,
            displayName: current.displayName,
            executablePath: current.executablePath,
            iconPath: current.iconPath,
            arguments: current.arguments
          };
        });
        saveEntries(entries, "Launcher removed");
        return;
      }

      if (target.getAttribute("data-action") === "launch" && entry && !state.launchingId) {
        state.launchingId = entry.id;
        state.statusText = "Launching";
        state.statusTone = "warn";
        redraw();
        requestJson(buildBridgeUrl(env, "/api/launchers/launch"), {
          method: "POST",
          body: {
            id: entry.id
          }
        }, 8000).then(function (payload) {
          state.launchingId = "";
          state.statusText = text(payload.message, "Launched");
          state.statusTone = "good";
          redraw();
        }, function (error) {
          state.launchingId = "";
          state.statusText = error.message || "Launch failed";
          state.statusTone = "danger";
          redraw();
        });
      }
    });

    var loop = createTimerLoop(refresh, 30000, function () {
      return state.saving || Boolean(state.launchingId);
    });
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeQuickActionsPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: payload.configured !== false,
      status: text(payload.status, "live"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, "Built-in Windows quick actions are ready."),
      source: text(payload.source, "native host"),
      darkModeEnabled: Boolean(payload.darkModeEnabled),
      actions: Array.isArray(payload.actions) ? payload.actions : []
    };
  }

  function renderQuickActionsWidget(state) {
    var data = state.data;
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Command Center</div>' +
            '<h3 class="inline-title">Quick actions</h3>' +
            '<p class="inline-copy">' + escapeHtml(text(data.message, "One-tap Windows actions for the EDGE display.")) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh"' + (state.busy ? " disabled" : "") + '>Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Theme", data.darkModeEnabled ? "Dark" : "Light", "Windows app + system theme") +
          metricCard("Actions", String(data.actions.length), "Built-in commands") +
          metricCard("Updated", formatAge(data.sampledAt), data.stale ? "Snapshot is stale" : "Fresh snapshot") +
        '</div>' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header"><div><div class="metric-label">Action Pad</div><div class="router-inline-copy">Tap once for quick actions. Recycle Bin asks for confirmation.</div></div></div>' +
          '<div class="inline-action-grid">' + (data.actions.length ? data.actions.map(function (item) {
            return renderActionButton(item, "execute", state.confirmActionId, state.busy);
          }).join("") : emptyState("No quick actions", "This PC did not return any quick actions.")) + '</div>' +
        '</article>' +
      '</div>';
  }

  function mountQuickActionsWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeQuickActionsPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      busy: false,
      confirmActionId: ""
    };

    function redraw() {
      container.innerHTML = renderQuickActionsWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/quick-actions"), {}, 6000).then(function (payload) {
        state.data = normalizeQuickActionsPayload(payload);
        state.statusText = statusTextFromPayload(payload, "Ready");
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commit(actionId) {
      state.busy = true;
      state.confirmActionId = "";
      state.statusText = "Applying";
      state.statusTone = "warn";
      redraw();

      return requestJson(buildBridgeUrl(env, "/api/quick-actions/" + actionId), {
        method: "POST"
      }, 8000).then(function (payload) {
        state.data = normalizeQuickActionsPayload(payload);
        state.busy = false;
        state.statusText = text(payload.message, statusTextFromPayload(payload, "Ready"));
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Action failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var actionId;
      if (!target || state.busy) {
        return;
      }

      if (target.getAttribute("data-action") === "refresh") {
        refresh();
        return;
      }

      if (target.getAttribute("data-action") !== "execute") {
        return;
      }

      actionId = String(target.getAttribute("data-id") || "");
      if (actionId === "empty-recycle-bin" && state.confirmActionId !== actionId) {
        state.confirmActionId = actionId;
        state.statusText = "Confirm";
        state.statusTone = "warn";
        redraw();
        return;
      }

      commit(actionId);
    });

    var loop = createTimerLoop(refresh, 30000, function () {
      return state.busy;
    });
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeSystemShortcutsPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: payload.configured !== false,
      status: text(payload.status, "live"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, "System shortcuts are ready."),
      source: text(payload.source, "native host"),
      brightness: optionalNumber(payload.brightness),
      brightnessSupported: Boolean(payload.brightnessSupported),
      dndEnabled: Boolean(payload.dndEnabled),
      toggles: Array.isArray(payload.toggles) ? payload.toggles : [],
      powerActions: Array.isArray(payload.powerActions) ? payload.powerActions : []
    };
  }

  function renderSystemShortcutsWidget(state) {
    var data = state.data;
    var brightnessValue = data.brightness == null ? 0 : Math.round(data.brightness);
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Command Center</div>' +
            '<h3 class="inline-title">System shortcuts</h3>' +
            '<p class="inline-copy">' + escapeHtml(text(data.message, "Power, brightness, and DND controls for the local PC.")) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh"' + (state.busy ? " disabled" : "") + '>Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Brightness", data.brightnessSupported && data.brightness != null ? Math.round(data.brightness) + "%" : "Unavailable", data.brightnessSupported ? "Active display brightness" : "Display does not expose WMI brightness") +
          metricCard("DND", data.dndEnabled ? "On" : "Off", "Notification banners") +
          metricCard("Updated", formatAge(data.sampledAt), data.stale ? "Snapshot is stale" : "Fresh snapshot") +
        '</div>' +
        '<div class="inline-grid inline-grid--2">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Display</div><div class="router-inline-copy">Adjust brightness and notification mode.</div></div></div>' +
            '<div class="inline-list">' +
              (data.toggles.length ? data.toggles.map(function (item) {
                return renderActionButton(item, "shortcut", "", state.busy);
              }).join("") : emptyState("No toggles", "This PC did not return any system toggles.")) +
              '<div class="inline-list-item">' +
                '<div class="inline-card-header"><div><div class="inline-list-title">Brightness</div><div class="inline-list-copy">' + escapeHtml(data.brightnessSupported ? "Use the slider to adjust the active display." : "This display does not support WMI brightness control.") + '</div></div><div class="inline-list-meta">' + escapeHtml(data.brightnessSupported && data.brightness != null ? brightnessValue + "%" : "--") + '</div></div>' +
                '<input class="inline-range" type="range" min="0" max="100" step="1" value="' + brightnessValue + '" data-action="brightness"' + ((state.busy || !data.brightnessSupported) ? " disabled" : "") + '>' +
              '</div>' +
            '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Power</div><div class="router-inline-copy">Sleep, restart, and shutdown ask for confirmation.</div></div></div>' +
            '<div class="inline-action-grid">' + (data.powerActions.length ? data.powerActions.map(function (item) {
              return renderActionButton(item, "shortcut", state.confirmActionId, state.busy);
            }).join("") : emptyState("No power actions", "This PC did not return any power actions.")) + '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountSystemShortcutsWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeSystemShortcutsPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      busy: false,
      confirmActionId: "",
      interacting: false
    };

    function redraw() {
      container.innerHTML = renderSystemShortcutsWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/system-shortcuts"), {}, 6000).then(function (payload) {
        state.data = normalizeSystemShortcutsPayload(payload);
        state.statusText = statusTextFromPayload(payload, "Ready");
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commitShortcut(actionId) {
      state.busy = true;
      state.confirmActionId = "";
      state.statusText = "Applying";
      state.statusTone = "warn";
      redraw();

      return requestJson(buildBridgeUrl(env, "/api/system-shortcuts/" + actionId), {
        method: "POST"
      }, 8000).then(function (payload) {
        state.data = normalizeSystemShortcutsPayload(payload);
        state.busy = false;
        state.statusText = text(payload.message, "Ready");
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Action failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commitBrightness(value) {
      state.busy = true;
      state.statusText = "Adjusting";
      state.statusTone = "warn";
      redraw();

      return requestJson(buildBridgeUrl(env, "/api/system-shortcuts/brightness"), {
        method: "POST",
        body: {
          brightness: clamp(optionalNumber(value) || 0, 0, 100)
        }
      }, 8000).then(function (payload) {
        state.data = normalizeSystemShortcutsPayload(payload);
        state.busy = false;
        state.statusText = "Brightness updated";
        state.statusTone = "good";
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Brightness failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var actionId;
      if (!target || state.busy) {
        return;
      }

      if (target.getAttribute("data-action") === "refresh") {
        refresh();
        return;
      }

      if (target.getAttribute("data-action") !== "shortcut") {
        return;
      }

      actionId = String(target.getAttribute("data-id") || "");
      if ((actionId === "sleep" || actionId === "restart" || actionId === "shutdown") && state.confirmActionId !== actionId) {
        state.confirmActionId = actionId;
        state.statusText = "Confirm";
        state.statusTone = "warn";
        redraw();
        return;
      }

      commitShortcut(actionId);
    });

    addListener(cleanups, container, "input", function (event) {
      var target = event.target;
      if (!target || target.getAttribute("data-action") !== "brightness") {
        return;
      }

      state.interacting = true;
      state.data.brightness = clamp(optionalNumber(target.value) || 0, 0, 100);
      redraw();
    });

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      if (!target || target.getAttribute("data-action") !== "brightness" || state.busy) {
        return;
      }

      state.interacting = false;
      commitBrightness(target.value);
    });

    addListener(cleanups, container, "pointerup", function () {
      state.interacting = false;
    });

    addListener(cleanups, container, "pointercancel", function () {
      state.interacting = false;
    });

    var loop = createTimerLoop(refresh, 30000, function () {
      return state.busy || state.interacting;
    });
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function normalizeClipboardPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: Boolean(payload.configured),
      status: text(payload.status, payload.configured ? "idle" : "setup"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, payload.configured ? "Clipboard history is ready." : "Clipboard history is disabled in Windows."),
      source: text(payload.source, "windows clipboard history"),
      entries: Array.isArray(payload.entries) ? payload.entries.map(function (entry) {
        return {
          id: text(entry.id, ""),
          kind: text(entry.kind, "unknown"),
          label: text(entry.label, "Clipboard item"),
          preview: text(entry.preview, "Clipboard content"),
          canCopy: entry.canCopy !== false
        };
      }) : []
    };
  }

  function renderClipboardWidget(state) {
    var data = state.data;
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Command Center</div>' +
            '<h3 class="inline-title">Clipboard history</h3>' +
            '<p class="inline-copy">' + escapeHtml(text(data.message, "Recent clipboard entries you can restore with one tap.")) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh"' + (state.busy ? " disabled" : "") + '>Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Items", String(data.entries.length), data.entries.length ? "Recent history" : (data.configured ? "Nothing recent" : "Enable clipboard history")) +
          metricCard("Source", text(data.source, "Clipboard history"), data.configured ? "Windows 10+" : "Needs setup") +
          metricCard("Updated", formatAge(data.sampledAt), data.stale ? "Snapshot is stale" : "Fresh snapshot") +
        '</div>' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header"><div><div class="metric-label">Recent Entries</div><div class="router-inline-copy">Tap an item to copy it back to the current clipboard.</div></div></div>' +
          '<div class="inline-list">' + (data.entries.length ? data.entries.map(function (entry) {
            return '' +
              '<button class="inline-list-item inline-list-item--button" type="button" data-action="copy" data-id="' + escapeHtml(entry.id) + '"' + ((state.busy || !entry.canCopy) ? " disabled" : "") + '>' +
                '<div class="inline-list-item--split">' +
                  '<div>' +
                    '<div class="inline-list-title">' + escapeHtml(entry.label) + '</div>' +
                    '<div class="inline-list-copy inline-clipboard-preview">' + escapeHtml(entry.preview) + '</div>' +
                  '</div>' +
                  '<div class="inline-list-meta">' + escapeHtml(entry.kind) + '</div>' +
                '</div>' +
              '</button>';
          }).join("") : emptyState(data.configured ? "Clipboard history is empty" : "Clipboard history is off", data.message)) + '</div>' +
        '</article>' +
      '</div>';
  }

  function mountClipboardWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeClipboardPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      busy: false
    };

    function redraw() {
      container.innerHTML = renderClipboardWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/clipboard"), {}, 6000).then(function (payload) {
        state.data = normalizeClipboardPayload(payload);
        state.statusText = statusTextFromPayload(payload, state.data.entries.length ? "Live" : state.data.status === "setup" ? "Setup" : "Idle");
        state.statusTone = statusToneFromPayload(payload, state.data.status);
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commitCopy(id) {
      state.busy = true;
      state.statusText = "Copying";
      state.statusTone = "warn";
      redraw();

      return requestJson(buildBridgeUrl(env, "/api/clipboard/copy"), {
        method: "POST",
        body: {
          id: id
        }
      }, 8000).then(function (payload) {
        state.data = normalizeClipboardPayload(payload);
        state.busy = false;
        state.statusText = "Copied";
        state.statusTone = "good";
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Copy failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      if (!target || state.busy) {
        return;
      }

      if (target.getAttribute("data-action") === "refresh") {
        refresh();
        return;
      }

      if (target.getAttribute("data-action") === "copy") {
        commitCopy(String(target.getAttribute("data-id") || ""));
      }
    });

    var loop = createTimerLoop(refresh, 12000, function () {
      return state.busy;
    });
    redraw();
    loop.start();

    return {
      refresh: loop.refresh,
      destroy: function () {
        loop.destroy();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountPlaceholderWidget(widget, container) {
    container.innerHTML = '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Inline migration</div>' +
            '<h3 class="inline-title">' + escapeHtml(text(widget.title, widget.id)) + '</h3>' +
            '<p class="inline-copy">This panel is still being converted to the native inline runtime.</p>' +
          '</div>' +
          statusPill("In Progress", "warn") +
        '</div>' +
        '<article class="list-card inline-card">' + emptyState("Panel still moving off iframe", "The remaining widget conversions are being wired into the same dashboard DOM now.") + '</article>' +
      '</div>';

    return {
      refresh: function () {
        return Promise.resolve();
      },
      destroy: function () {
        container.innerHTML = "";
      }
    };
  }

  var fallbackProductThemes = [
    { id: "edge", name: "Edge Neon", accent: "#00e0ff", secondary: "#44f0c2", copy: "Kinetic cyan, green, and amber motion." },
    { id: "afterburn", name: "Afterburn", accent: "#ff4d8d", secondary: "#f5a623", copy: "Rose and amber stream energy." },
    { id: "deepcore", name: "Deep Core", accent: "#7a5cff", secondary: "#00e0ff", copy: "Quieter dark control-room contrast." },
    { id: "verdant", name: "Verdant", accent: "#44f0c2", secondary: "#00e0ff", copy: "Green-forward telemetry glow." }
  ];

  var productProfiles = [
    {
      id: "command",
      name: "Command",
      copy: "Balanced daily dashboard with setup, telemetry, style, and packaging close at hand.",
      themeId: "edge",
      pack: "core",
      layout: ["profiles", "system", "network", "audio", "media", "theme-studio", "layout-editor", "updates", "installer", "privacy"]
    },
    {
      id: "gaming",
      name: "Gaming",
      copy: "System pressure, network state, audio, launchers, and game mode first.",
      themeId: "deepcore",
      pack: "gaming",
      layout: ["game-mode", "system", "network", "audio", "launchers", "quick-actions", "media", "theme-studio", "profiles", "updates"]
    },
    {
      id: "streaming",
      name: "Streaming",
      copy: "OBS, media transport, audio routing, system load, and release confidence.",
      themeId: "afterburn",
      pack: "streamer",
      layout: ["streaming", "media", "audio", "system", "network", "quick-actions", "theme-studio", "profiles", "updates", "privacy"]
    },
    {
      id: "homelab",
      name: "Home Lab",
      copy: "Network, NAS, Plex, UniFi, and automation panels move forward.",
      themeId: "verdant",
      pack: "homelab",
      layout: ["network", "nas", "plex", "unifi-network", "unifi-camera", "automation", "hue", "system", "marketplace", "privacy"]
    },
    {
      id: "minimal",
      name: "Minimal",
      copy: "A clean product demo surface with the essentials and privacy visible.",
      themeId: "edge",
      pack: "core",
      layout: ["system", "network", "profiles", "theme-studio", "privacy", "installer", "updates"]
    }
  ];

  var productPacks = [
    {
      id: "core",
      name: "Core Owner",
      copy: "System, network, audio, media, setup, and trust panels for a normal install.",
      layout: ["profiles", "system", "network", "audio", "media", "theme-studio", "layout-editor", "installer", "privacy"]
    },
    {
      id: "gaming",
      name: "Gaming Desk",
      copy: "Telemetry, launchers, audio, media, and game mode for a player-focused panel.",
      layout: ["game-mode", "system", "network", "audio", "launchers", "quick-actions", "media", "profiles", "theme-studio"]
    },
    {
      id: "streamer",
      name: "Streamer",
      copy: "OBS, media, audio, quick actions, update checks, and privacy up front.",
      layout: ["streaming", "media", "audio", "quick-actions", "system", "network", "updates", "privacy", "profiles"]
    },
    {
      id: "homelab",
      name: "Home Lab",
      copy: "NAS, Plex, UniFi, cameras, automation, Hue, and network health.",
      layout: ["network", "nas", "plex", "unifi-network", "unifi-camera", "automation", "hue", "system", "marketplace"]
    }
  ];

  function productThemes(env) {
    return Array.isArray(env.productThemes) && env.productThemes.length ? env.productThemes : fallbackProductThemes;
  }

  function findById(items, id) {
    return items.filter(function (item) {
      return item.id === id;
    })[0] || items[0];
  }

  function settingValue(env, key, fallback) {
    var value = getSetting(env, key);
    return value == null || value === "" ? fallback : value;
  }

  function productShell(kicker, title, copy, statusText, statusTone, bodyHtml) {
    return '' +
      '<div class="inline-widget-shell product-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">' + escapeHtml(kicker) + '</div>' +
            '<h3 class="inline-title">' + escapeHtml(title) + '</h3>' +
            '<p class="inline-copy">' + escapeHtml(copy) + '</p>' +
          '</div>' +
          statusPill(statusText, statusTone) +
        '</div>' +
        bodyHtml +
      '</div>';
  }

  function productButtonCard(item, active, actionName, extraHtml) {
    return '' +
      '<button class="product-card product-card--button' + (active ? " is-selected" : "") + '" type="button" data-' + actionName + '="' + escapeHtml(item.id) + '">' +
        '<span class="product-card__topline">' + escapeHtml(item.name) + '</span>' +
        '<strong>' + escapeHtml(item.copy) + '</strong>' +
        (extraHtml || "") +
      '</button>';
  }

  function copyTextToClipboard(value) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(value);
    }

    return Promise.reject(new Error("Clipboard unavailable"));
  }

  function mountProfilesWidget(widget, container, env) {
    var cleanups = [];

    function redraw() {
      var activeProfile = settingValue(env, "profileId", "command");
      container.innerHTML = productShell(
        "First-run setup",
        "Profiles",
        "Pick a product-ready mode and the dashboard will retheme, reorder, and select the right widget pack.",
        findById(productProfiles, activeProfile).name,
        "good",
        '<div class="product-profile-grid">' +
          productProfiles.map(function (profile) {
            return productButtonCard(profile, profile.id === activeProfile, "profile", '<span class="product-card__meta">Theme: ' + escapeHtml(findById(productThemes(env), profile.themeId).name) + '</span>');
          }).join("") +
        '</div>'
      );
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-profile]") : null;
      var profile;
      if (!target) {
        return;
      }

      profile = findById(productProfiles, target.getAttribute("data-profile"));
      saveSettings(env, {
        profileId: profile.id,
        themeId: profile.themeId,
        accentColor: findById(productThemes(env), profile.themeId).accent,
        marketplacePack: profile.pack,
        layoutOrder: profile.layout.join(",")
      });
      redraw();
    });

    redraw();
    return {
      refresh: function () {
        redraw();
        return Promise.resolve();
      },
      destroy: function () {
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountThemeStudioWidget(widget, container, env) {
    var cleanups = [];

    function redraw() {
      var themes = productThemes(env);
      var activeTheme = settingValue(env, "themeId", "edge");
      var activePreset = findById(themes, activeTheme);
      var accent = settingValue(env, "accentColor", activePreset.accent);
      var intensity = settingValue(env, "animationIntensity", "100");
      var opacity = settingValue(env, "dashboardOpacity", "100");

      container.innerHTML = productShell(
        "Visual style",
        "Theme Studio",
        "Dial in the look customers see first: theme, accent, transparency, and motion intensity.",
        activePreset.name,
        "good",
        '<div class="product-theme-grid">' +
          themes.map(function (theme) {
            return '' +
              '<button class="product-swatch' + (theme.id === activeTheme ? " is-selected" : "") + '" type="button" data-theme="' + escapeHtml(theme.id) + '">' +
                '<span class="product-swatch__chip" style="--swatch-a:' + escapeHtml(theme.accent) + ';--swatch-b:' + escapeHtml(theme.secondary || theme.accent) + '"></span>' +
                '<strong>' + escapeHtml(theme.name) + '</strong>' +
                '<span>' + escapeHtml(theme.copy) + '</span>' +
              '</button>';
          }).join("") +
        '</div>' +
        '<form class="inline-form product-control-panel" data-form="theme-studio">' +
          '<div class="inline-form-grid inline-form-grid--2">' +
            '<label class="inline-field"><span>Accent</span><input class="inline-input product-color-input" type="color" name="accentColor" value="' + escapeHtml(accent) + '"></label>' +
            '<label class="inline-field"><span>Release look</span><select class="inline-select" name="themeId">' +
              themes.map(function (theme) {
                return '<option value="' + escapeHtml(theme.id) + '"' + (theme.id === activeTheme ? " selected" : "") + '>' + escapeHtml(theme.name) + '</option>';
              }).join("") +
            '</select></label>' +
          '</div>' +
          '<label class="inline-field product-range-field"><span>Motion ' + escapeHtml(intensity) + '%</span><input class="inline-range" type="range" name="animationIntensity" min="0" max="140" value="' + escapeHtml(intensity) + '"></label>' +
          '<label class="inline-field product-range-field"><span>Opacity ' + escapeHtml(opacity) + '%</span><input class="inline-range" type="range" name="dashboardOpacity" min="35" max="100" value="' + escapeHtml(opacity) + '"></label>' +
        '</form>'
      );
    }

    function saveForm(form) {
      var data = new FormData(form);
      saveSettings(env, {
        themeId: String(data.get("themeId") || "edge"),
        accentColor: String(data.get("accentColor") || ""),
        animationIntensity: String(data.get("animationIntensity") || "100"),
        dashboardOpacity: String(data.get("dashboardOpacity") || "100")
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-theme]") : null;
      var theme;
      if (!target) {
        return;
      }

      theme = findById(productThemes(env), target.getAttribute("data-theme"));
      saveSettings(env, {
        themeId: theme.id,
        accentColor: theme.accent
      });
      redraw();
    });

    addListener(cleanups, container, "input", function (event) {
      var form = event.target && event.target.form;
      if (form && form.getAttribute("data-form") === "theme-studio") {
        saveForm(form);
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var form = event.target && event.target.form;
      if (form && form.getAttribute("data-form") === "theme-studio") {
        saveForm(form);
        redraw();
      }
    });

    redraw();
    return {
      refresh: function () {
        redraw();
        return Promise.resolve();
      },
      destroy: function () {
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountLayoutEditorWidget(widget, container, env) {
    var cleanups = [];
    var draggingId = "";

    function widgetRows() {
      return typeof env.getVisibleWidgets === "function" ? env.getVisibleWidgets() : [];
    }

    function saveOrder(ids) {
      saveSettings(env, { layoutOrder: ids.join(",") });
      redraw();
    }

    function redraw() {
      var rows = widgetRows();
      container.innerHTML = productShell(
        "Drag and drop",
        "Layout Editor",
        "Move panels into the order that makes sense for the way this install is sold or used.",
        rows.length + " panels",
        "good",
        '<div class="product-layout-list">' +
          rows.map(function (row, index) {
            return '' +
              '<div class="product-layout-row" draggable="true" data-layout-item="' + escapeHtml(row.id) + '">' +
                '<span class="product-layout-row__handle" aria-hidden="true"></span>' +
                '<div><strong>' + escapeHtml(row.title) + '</strong><span>' + escapeHtml(row.state + (row.requiresBridge ? " / bridge" : " / local")) + '</span></div>' +
                '<div class="product-layout-row__actions">' +
                  '<button class="inline-button" type="button" data-layout-action="up" data-id="' + escapeHtml(row.id) + '"' + (index === 0 ? " disabled" : "") + '>Up</button>' +
                  '<button class="inline-button" type="button" data-layout-action="down" data-id="' + escapeHtml(row.id) + '"' + (index === rows.length - 1 ? " disabled" : "") + '>Down</button>' +
                '</div>' +
              '</div>';
          }).join("") +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button" type="button" data-layout-action="reset">Reset order</button>' +
          '<button class="inline-button is-primary" type="button" data-layout-action="profiles">Open profiles</button>' +
        '</div>'
      );
    }

    addListener(cleanups, container, "click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-layout-action]") : null;
      var action;
      var id;
      var rows;
      var ids;
      var index;
      var swap;
      if (!button) {
        return;
      }

      action = button.getAttribute("data-layout-action");
      if (action === "reset") {
        saveSettings(env, { layoutOrder: "" });
        redraw();
        return;
      }

      if (action === "profiles") {
        if (typeof env.selectWidget === "function") {
          env.selectWidget("profiles", true);
        }
        return;
      }

      id = button.getAttribute("data-id");
      rows = widgetRows();
      ids = rows.map(function (row) {
        return row.id;
      });
      index = ids.indexOf(id);
      if (index === -1) {
        return;
      }

      swap = action === "up" ? index - 1 : index + 1;
      if (swap < 0 || swap >= ids.length) {
        return;
      }

      ids.splice(index, 1);
      ids.splice(swap, 0, id);
      saveOrder(ids);
    });

    addListener(cleanups, container, "dragstart", function (event) {
      var item = event.target && event.target.closest ? event.target.closest("[data-layout-item]") : null;
      if (!item) {
        return;
      }

      draggingId = item.getAttribute("data-layout-item") || "";
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggingId);
      }
    });

    addListener(cleanups, container, "dragover", function (event) {
      if (draggingId && event.target && event.target.closest && event.target.closest("[data-layout-item]")) {
        event.preventDefault();
      }
    });

    addListener(cleanups, container, "drop", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-layout-item]") : null;
      var targetId;
      var ids;
      var fromIndex;
      var toIndex;
      if (!draggingId || !target) {
        return;
      }

      event.preventDefault();
      targetId = target.getAttribute("data-layout-item");
      ids = widgetRows().map(function (row) {
        return row.id;
      });
      fromIndex = ids.indexOf(draggingId);
      toIndex = ids.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        draggingId = "";
        return;
      }

      ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, draggingId);
      draggingId = "";
      saveOrder(ids);
    });

    redraw();
    return {
      refresh: function () {
        redraw();
        return Promise.resolve();
      },
      destroy: function () {
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountUpdatesWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      latest: "",
      latestUrl: "https://github.com/SilverFuel/xeneon-widgets/releases",
      downloadUrl: "",
      macUrl: "",
      message: "Check the release feed when you are ready to update.",
      statusText: "Ready",
      statusTone: "good",
      busy: false
    };

    function redraw() {
      var channel = settingValue(env, "updateChannel", "stable");
      container.innerHTML = productShell(
        "Auto-update foundation",
        "Updates",
        "Check the public release feed from the local host so customers have one clear update path.",
        state.statusText,
        state.statusTone,
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Current build", env.assetRevision || "local", "Dashboard asset revision", null) +
          metricCard("Latest release", state.latest || "Not checked", state.message, null) +
          metricCard("Installer", state.downloadUrl ? "Found" : "Not checked", state.macUrl ? "Windows and Mac assets" : "Windows asset expected", null) +
        '</div>' +
        '<form class="inline-form product-control-panel" data-form="updates">' +
          '<label class="inline-field"><span>Release channel</span><select class="inline-select" name="updateChannel">' +
            '<option value="stable"' + (channel === "stable" ? " selected" : "") + '>Stable</option>' +
            '<option value="preview"' + (channel === "preview" ? " selected" : "") + '>Preview</option>' +
            '<option value="internal"' + (channel === "internal" ? " selected" : "") + '>Internal</option>' +
          '</select></label>' +
        '</form>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="check-release"' + (state.busy ? " disabled" : "") + '>Check releases</button>' +
          (state.downloadUrl ? '<a class="inline-button" href="' + escapeHtml(state.downloadUrl) + '" target="_blank" rel="noreferrer">Windows installer</a>' : '') +
          (state.macUrl ? '<a class="inline-button" href="' + escapeHtml(state.macUrl) + '" target="_blank" rel="noreferrer">Mac package</a>' : '') +
          '<a class="inline-button" href="' + escapeHtml(state.latestUrl) + '" target="_blank" rel="noreferrer">Open releases</a>' +
        '</div>' +
        '<div class="product-checklist">' +
          '<span>Signed installer</span><span>Release notes</span><span>Versioned setup EXE</span><span>Rollback download</span>' +
        '</div>'
      );
    }

    function checkLatestRelease() {
      state.busy = true;
      state.statusText = "Checking";
      state.statusTone = "warn";
      redraw();

      requestJson(buildBridgeUrl(env, "/api/releases/latest"), {}, 10000).then(function (payload) {
        state.busy = false;
        state.latest = text(payload && (payload.latestVersion || payload.tag_name || payload.name), "No release tag");
        state.latestUrl = text(payload && (payload.htmlUrl || payload.html_url), state.latestUrl);
        state.downloadUrl = text(payload && payload.installerUrl, "");
        state.macUrl = text(payload && payload.macUrl, "");
        state.message = text(payload && payload.message, "Release feed checked.");
        state.statusText = payload && payload.status === "live" ? "Release feed ready" : "Check failed";
        state.statusTone = payload && payload.status === "live" ? "good" : "danger";
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Check failed";
        state.statusTone = "danger";
        state.message = state.statusText;
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      if (target && target.getAttribute("data-action") === "check-release") {
        checkLatestRelease();
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var select = event.target;
      if (select && select.name === "updateChannel") {
        saveSettings(env, { updateChannel: select.value });
        redraw();
      }
    });

    redraw();
    return {
      refresh: function () {
        redraw();
        return Promise.resolve();
      },
      destroy: function () {
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountStreamingWidget(widget, container, env) {
    var cleanups = [];
    var obsSocket = null;
    var state = {
      statusText: "Not checked",
      statusTone: "muted",
      busy: false
    };

    function closeSocket() {
      if (obsSocket) {
        try {
          obsSocket.close();
        } catch (error) {
          // Ignore socket shutdown failures.
        }
      }
      obsSocket = null;
    }

    function redraw() {
      var endpoint = settingValue(env, "obsEndpoint", "ws://127.0.0.1:4455");
      var scene = settingValue(env, "streamScene", "Main");
      container.innerHTML = productShell(
        "OBS panel",
        "Streaming",
        "Keep a stream-ready control surface on the EDGE while leaving full OBS automation for the native bridge.",
        state.statusText,
        state.statusTone,
        '<form class="inline-form product-control-panel" data-form="streaming">' +
          '<div class="inline-form-grid inline-form-grid--2">' +
            '<label class="inline-field"><span>OBS WebSocket</span><input class="inline-input" type="text" name="obsEndpoint" value="' + escapeHtml(endpoint) + '" placeholder="ws://127.0.0.1:4455"></label>' +
            '<label class="inline-field"><span>Main scene</span><input class="inline-input" type="text" name="streamScene" value="' + escapeHtml(scene) + '" placeholder="Main"></label>' +
          '</div>' +
        '</form>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Scene", scene, "Saved locally", null) +
          metricCard("OBS", state.statusText, "Connection probe", null) +
          metricCard("Mode", "Stream deck", "Quick glance controls", null) +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="probe-obs"' + (state.busy ? " disabled" : "") + '>Probe OBS</button>' +
          '<button class="inline-button" type="button" data-action="open-media">Open media</button>' +
          '<button class="inline-button" type="button" data-action="stream-profile">Use streaming profile</button>' +
        '</div>'
      );
    }

    function probeObs() {
      var endpoint = settingValue(env, "obsEndpoint", "ws://127.0.0.1:4455");
      var timerId;

      if (!window.WebSocket) {
        state.statusText = "WebSocket unavailable";
        state.statusTone = "danger";
        redraw();
        return;
      }

      closeSocket();
      state.busy = true;
      state.statusText = "Checking";
      state.statusTone = "warn";
      redraw();

      timerId = window.setTimeout(function () {
        state.busy = false;
        state.statusText = "Timed out";
        state.statusTone = "danger";
        closeSocket();
        redraw();
      }, 4000);

      try {
        obsSocket = new WebSocket(endpoint);
        obsSocket.addEventListener("open", function () {
          window.clearTimeout(timerId);
          state.busy = false;
          state.statusText = "OBS reachable";
          state.statusTone = "good";
          closeSocket();
          redraw();
        });
        obsSocket.addEventListener("error", function () {
          window.clearTimeout(timerId);
          state.busy = false;
          state.statusText = "OBS unavailable";
          state.statusTone = "danger";
          closeSocket();
          redraw();
        });
      } catch (error) {
        window.clearTimeout(timerId);
        state.busy = false;
        state.statusText = error.message || "Invalid endpoint";
        state.statusTone = "danger";
        closeSocket();
        redraw();
      }
    }

    function saveForm(form) {
      var data = new FormData(form);
      saveSettings(env, {
        obsEndpoint: String(data.get("obsEndpoint") || "ws://127.0.0.1:4455"),
        streamScene: String(data.get("streamScene") || "Main")
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var profile = findById(productProfiles, "streaming");
      if (!target) {
        return;
      }

      if (target.getAttribute("data-action") === "probe-obs") {
        probeObs();
      } else if (target.getAttribute("data-action") === "open-media" && typeof env.selectWidget === "function") {
        env.selectWidget("media", true);
      } else if (target.getAttribute("data-action") === "stream-profile") {
        saveSettings(env, {
          profileId: profile.id,
          themeId: profile.themeId,
          accentColor: findById(productThemes(env), profile.themeId).accent,
          marketplacePack: profile.pack,
          layoutOrder: profile.layout.join(",")
        });
        redraw();
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var form = event.target && event.target.form;
      if (form && form.getAttribute("data-form") === "streaming") {
        saveForm(form);
        redraw();
      }
    });

    redraw();
    return {
      refresh: function () {
        redraw();
        return Promise.resolve();
      },
      destroy: function () {
        closeSocket();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountGameModeWidget(widget, container, env) {
    var cleanups = [];

    function redraw() {
      var enabled = settingValue(env, "gameModeEnabled", "false") === "true";
      var game = settingValue(env, "gameModeGame", "Default");
      container.innerHTML = productShell(
        "Game launcher",
        "Game Mode",
        "Save a focused mode for games, launchers, telemetry, network health, and audio routing.",
        enabled ? "Enabled" : "Standby",
        enabled ? "good" : "muted",
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Mode", enabled ? "On" : "Off", "Local preset", enabled ? 100 : 0) +
          metricCard("Profile", game, "Saved target", null) +
          metricCard("Layout", "Gaming desk", "Applies launch order", null) +
        '</div>' +
        '<form class="inline-form product-control-panel" data-form="game-mode">' +
          '<div class="inline-form-grid inline-form-grid--2">' +
            '<label class="inline-field"><span>Game profile</span><input class="inline-input" type="text" name="gameModeGame" value="' + escapeHtml(game) + '" placeholder="Favorite game"></label>' +
            '<label class="inline-field"><span>Mode</span><select class="inline-select" name="gameModeEnabled">' +
              '<option value="true"' + (enabled ? " selected" : "") + '>Enabled</option>' +
              '<option value="false"' + (!enabled ? " selected" : "") + '>Standby</option>' +
            '</select></label>' +
          '</div>' +
        '</form>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="gaming-profile">Apply gaming profile</button>' +
          '<button class="inline-button" type="button" data-action="open-launchers">Open launchers</button>' +
        '</div>'
      );
    }

    function saveForm(form) {
      var data = new FormData(form);
      saveSettings(env, {
        gameModeEnabled: String(data.get("gameModeEnabled") || "false"),
        gameModeGame: String(data.get("gameModeGame") || "")
      });
    }

    addListener(cleanups, container, "change", function (event) {
      var form = event.target && event.target.form;
      if (form && form.getAttribute("data-form") === "game-mode") {
        saveForm(form);
        redraw();
      }
    });

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var profile = findById(productProfiles, "gaming");
      if (!target) {
        return;
      }

      if (target.getAttribute("data-action") === "open-launchers" && typeof env.selectWidget === "function") {
        env.selectWidget("launchers", true);
      } else if (target.getAttribute("data-action") === "gaming-profile") {
        saveSettings(env, {
          profileId: profile.id,
          themeId: profile.themeId,
          accentColor: findById(productThemes(env), profile.themeId).accent,
          marketplacePack: profile.pack,
          gameModeEnabled: "true",
          layoutOrder: profile.layout.join(",")
        });
        redraw();
      }
    });

    redraw();
    return {
      refresh: function () {
        redraw();
        return Promise.resolve();
      },
      destroy: function () {
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountMarketplaceWidget(widget, container, env) {
    var cleanups = [];

    function redraw() {
      var activePack = settingValue(env, "marketplacePack", "core");
      container.innerHTML = productShell(
        "Marketplace packs",
        "Widget Packs",
        "Apply curated dashboard bundles now; later these can become downloadable packs from a store page.",
        findById(productPacks, activePack).name,
        "good",
        '<div class="product-profile-grid">' +
          productPacks.map(function (pack) {
            return productButtonCard(pack, pack.id === activePack, "pack", '<span class="product-card__meta">' + escapeHtml(pack.layout.length + " panels") + '</span>');
          }).join("") +
        '</div>' +
        '<div class="product-checklist">' +
          '<span>Pack manifest</span><span>Screenshots</span><span>Version tags</span><span>Support link</span>' +
        '</div>'
      );
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-pack]") : null;
      var pack;
      if (!target) {
        return;
      }

      pack = findById(productPacks, target.getAttribute("data-pack"));
      saveSettings(env, {
        marketplacePack: pack.id,
        layoutOrder: pack.layout.join(",")
      });
      redraw();
    });

    redraw();
    return {
      refresh: function () {
        redraw();
        return Promise.resolve();
      },
      destroy: function () {
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountInstallerWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      statusText: "Ready",
      statusTone: "good"
    };

    function redraw() {
      var edition = settingValue(env, "installerEdition", "unsigned");
      container.innerHTML = productShell(
        "Windows setup",
        "Installer",
        "Keep the packaging story visible: setup EXE, install path, shortcuts, signing, and sales readiness.",
        state.statusText,
        state.statusTone,
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Setup EXE", "app\\dist", "Versioned setup EXE", null) +
          metricCard("Install path", "%LOCALAPPDATA%", "Per-user install", null) +
          metricCard("Edition", edition === "signed" ? "Signed" : "Unsigned", "Release status", edition === "signed" ? 100 : 55) +
        '</div>' +
        '<form class="inline-form product-control-panel" data-form="installer">' +
          '<label class="inline-field"><span>Release readiness</span><select class="inline-select" name="installerEdition">' +
            '<option value="unsigned"' + (edition === "unsigned" ? " selected" : "") + '>Unsigned local build</option>' +
            '<option value="signed"' + (edition === "signed" ? " selected" : "") + '>Signed release candidate</option>' +
          '</select></label>' +
        '</form>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="copy-installer">Copy build command</button>' +
          '<button class="inline-button" type="button" data-action="open-updates">Open updates</button>' +
        '</div>' +
        '<div class="product-checklist">' +
          '<span>Start Menu shortcut</span><span>Desktop shortcut</span><span>Auto-start</span><span>Uninstall entry</span><span>SHA256 file</span><span>Support notes</span>' +
        '</div>'
      );
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      if (!target) {
        return;
      }

      if (target.getAttribute("data-action") === "copy-installer") {
        copyTextToClipboard("powershell -ExecutionPolicy Bypass -File .\\app\\build-installer.ps1").then(function () {
          state.statusText = "Command copied";
          state.statusTone = "good";
          redraw();
        }, function (error) {
          state.statusText = error.message || "Copy failed";
          state.statusTone = "danger";
          redraw();
        });
      } else if (target.getAttribute("data-action") === "open-updates" && typeof env.selectWidget === "function") {
        env.selectWidget("updates", true);
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var select = event.target;
      if (select && select.name === "installerEdition") {
        saveSettings(env, { installerEdition: select.value });
        redraw();
      }
    });

    redraw();
    return {
      refresh: function () {
        redraw();
        return Promise.resolve();
      },
      destroy: function () {
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountPrivacyWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      statusText: "Local-only",
      statusTone: "good",
      confirmReset: false
    };

    function redraw() {
      var settings = typeof env.getSettings === "function" ? env.getSettings() : {};
      container.innerHTML = productShell(
        "Trust screen",
        "Privacy",
        "Explain the local-first model clearly so customers know what the app touches.",
        state.statusText,
        state.statusTone,
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Local settings", "Browser storage", "Theme, layout, endpoints", null) +
          metricCard("Bridge data", "127.0.0.1", "System, network, audio", null) +
          metricCard("Cloud calls", "Optional", "Weather and release checks", null) +
        '</div>' +
        '<div class="product-privacy-list">' +
          '<div><strong>Stays on this PC</strong><span>Dashboard preferences, widget endpoints, profiles, layout, OBS target, and installer readiness.</span></div>' +
          '<div><strong>Requires permission</strong><span>Weather keys, calendar feeds, Hue bridge pairing, and optional connectors you enable.</span></div>' +
          '<div><strong>Independent software</strong><span>This app is not an official CORSAIR product and is not endorsed by integration providers unless a written agreement says otherwise.</span></div>' +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="export-settings">Copy settings JSON</button>' +
          '<button class="inline-button" type="button" data-action="reset-settings">Reset local settings</button>' +
          '<button class="inline-button" type="button" data-action="reset-all-local-data">' + (state.confirmReset ? "Confirm reset" : "Reset all app data") + '</button>' +
          '<a class="inline-button" href="/support.html" target="_blank" rel="noreferrer">Support</a>' +
        '</div>' +
        '<div class="product-code-preview">' + escapeHtml(JSON.stringify(settings, null, 2).slice(0, 520)) + '</div>'
      );
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var settings;
      if (!target) {
        return;
      }

      if (target.getAttribute("data-action") === "export-settings") {
        settings = typeof env.getSettings === "function" ? env.getSettings() : {};
        copyTextToClipboard(JSON.stringify(settings, null, 2)).then(function () {
          state.statusText = "Settings copied";
          state.statusTone = "good";
          redraw();
        }, function (error) {
          state.statusText = error.message || "Copy failed";
          state.statusTone = "danger";
          redraw();
        });
      } else if (target.getAttribute("data-action") === "reset-settings" && typeof env.resetSettings === "function") {
        env.resetSettings();
        state.statusText = "Settings reset";
        state.statusTone = "warn";
        state.confirmReset = false;
        redraw();
      } else if (target.getAttribute("data-action") === "reset-all-local-data" && typeof env.resetAllLocalData === "function") {
        if (!state.confirmReset) {
          state.confirmReset = true;
          state.statusText = "Tap again";
          state.statusTone = "warn";
          redraw();
          return;
        }

        env.resetAllLocalData().then(function () {
          state.statusText = "App data reset";
          state.statusTone = "warn";
          state.confirmReset = false;
          redraw();
        }, function (error) {
          state.statusText = error.message || "Reset failed";
          state.statusTone = "danger";
          state.confirmReset = false;
          redraw();
        });
      }
    });

    redraw();
    return {
      refresh: function () {
        redraw();
        return Promise.resolve();
      },
      destroy: function () {
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  var renderers = {
    setup: mountSetupWidget,
    profiles: mountProfilesWidget,
    "theme-studio": mountThemeStudioWidget,
    "layout-editor": mountLayoutEditorWidget,
    updates: mountUpdatesWidget,
    streaming: mountStreamingWidget,
    "game-mode": mountGameModeWidget,
    marketplace: mountMarketplaceWidget,
    installer: mountInstallerWidget,
    privacy: mountPrivacyWidget,
    system: mountSystemWidget,
    network: mountNetworkWidget,
    launchers: mountLaunchersWidget,
    "quick-actions": mountQuickActionsWidget,
    shortcuts: mountSystemShortcutsWidget,
    audio: mountAudioWidget,
    calendar: mountCalendarWidget,
    media: mountMediaWidget,
    clipboard: mountClipboardWidget,
    weather: mountWeatherWidget,
    hue: mountHueWidget,
    "unifi-camera": mountCameraWidget,
    "unifi-network": mountUniFiNetworkWidget,
    plex: mountPlexWidget,
    nas: mountNasWidget,
    automation: mountAutomationWidget
  };

  function mountWidget(widget, container, env) {
    var renderer = renderers[widget && widget.id] || mountPlaceholderWidget;
    return renderer(widget || { id: "unknown", title: "Widget" }, container, env || {});
  }

  window.InlineWidgets = {
    mountWidget: mountWidget
  };
}());
