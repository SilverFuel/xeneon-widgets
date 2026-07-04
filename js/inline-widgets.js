(function () {
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

  function nullableNumber(value) {
    return value == null || value === "" ? null : optionalNumber(value);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatPercent(value) {
    if (window.WidgetCore && typeof window.WidgetCore.formatPercent === "function") {
      return window.WidgetCore.formatPercent(value);
    }
    return nullableNumber(value) == null ? "--" : Math.round(value) + "%";
  }

  function formatRate(value) {
    if (window.WidgetCore && typeof window.WidgetCore.formatBytesPerSecond === "function") {
      return window.WidgetCore.formatBytesPerSecond(value);
    }
    var parsed = optionalNumber(value);
    return parsed == null ? "--" : parsed.toFixed(1) + " Mbps";
  }

  function formatTemp(value) {
    var parsed = nullableNumber(value);
    return parsed == null || parsed <= 0 ? "Unavailable" : Math.round(parsed) + " C";
  }

  function formatValue(value, suffix) {
    var parsed = nullableNumber(value);
    return parsed == null ? "--" : Math.round(parsed) + (suffix || "");
  }

  function formatFps(value) {
    var parsed = nullableNumber(value);
    return parsed == null ? "--" : Math.round(parsed) + " FPS";
  }

  function formatMs(value) {
    var parsed = nullableNumber(value);
    return parsed == null ? "--" : (parsed >= 10 ? Math.round(parsed) : parsed.toFixed(1)) + " ms";
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

  function emitTouchFeedback(env, message) {
    if (env && typeof env.showTouchFeedback === "function") {
      env.showTouchFeedback(message);
    }
  }

  function setupUpdate(env, kind) {
    if (typeof env.handleSetupUpdate === "function") {
      return env.handleSetupUpdate(kind);
    }
    return Promise.resolve();
  }

  function initXnSlider(node) {
    var root = node || document;
    var sliders = [];

    if (root.matches && root.matches('input[type="range"]')) {
      sliders = [root];
    } else if (root.querySelectorAll) {
      sliders = Array.prototype.slice.call(root.querySelectorAll('input[type="range"]'));
    }

    sliders.forEach(function (slider) {
      function update() {
        var min = optionalNumber(slider.min);
        var max = optionalNumber(slider.max);
        var value = optionalNumber(slider.value);
        var percent;
        var heat;

        min = min == null ? 0 : min;
        max = max == null ? 100 : max;
        value = value == null ? min : value;
        percent = max <= min ? 0 : clamp(((value - min) / (max - min)) * 100, 0, 100);
        heat = clamp((percent - 75) / 25, 0, 1);

        slider.style.setProperty("--xn-fill", percent.toFixed(2) + "%");
        slider.style.setProperty("--xn-heat", heat.toFixed(3));
        slider.classList.toggle("is-hot", percent >= 75);
      }

      slider.classList.add("xn-slider");
      update();

      if (!slider.__xnSliderBound) {
        slider.__xnSliderBound = true;
        slider.addEventListener("input", update);
        slider.addEventListener("change", update);
      }
    });

    return sliders;
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
      canSeek: Boolean(payload.canSeek),
      thumbnailDataUrl: text(payload.thumbnailDataUrl, "")
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

  var renderers = {};

  function registerRenderer(widgetId, renderer) {
    if (widgetId && typeof renderer === "function") {
      renderers[widgetId] = renderer;
    }
  }

  function registerRuntimeHelpers(helpers) {
    Object.keys(helpers || {}).forEach(function (key) {
      if (typeof helpers[key] === "function") {
        runtime[key] = helpers[key];
      }
    });
  }

  function mountWidget(widget, container, env) {
    var renderer = renderers[widget && widget.id] || mountPlaceholderWidget;
    return renderer(widget || { id: "unknown", title: "Widget" }, container, env || {});
  }

  var runtime = {
    addListener: addListener,
    buildBridgeUrl: buildBridgeUrl,
    clamp: clamp,
    createTimerLoop: createTimerLoop,
    emptyState: emptyState,
    emitTouchFeedback: emitTouchFeedback,
    escapeHtml: escapeHtml,
    findById: findById,
    formatAge: formatAge,
    formatDurationMs: formatDurationMs,
    formatFps: formatFps,
    formatMediaAppLabel: formatMediaAppLabel,
    formatMs: formatMs,
    formatPercent: formatPercent,
    formatRate: formatRate,
    formatStorage: formatStorage,
    formatTemp: formatTemp,
    formatValue: formatValue,
    formatWhen: formatWhen,
    getUniFiNetworkEndpoint: getUniFiNetworkEndpoint,
    initXnSlider: initXnSlider,
    metricCard: metricCard,
    normalizeMediaPayload: normalizeMediaPayload,
    nullableNumber: nullableNumber,
    optionalNumber: optionalNumber,
    productShell: productShell,
    productThemes: productThemes,
    registerHelpers: registerRuntimeHelpers,
    registerRenderer: registerRenderer,
    requestJson: requestJson,
    runCleanups: runCleanups,
    saveSettings: saveSettings,
    settingValue: settingValue,
    statusPill: statusPill,
    statusTextFromPayload: statusTextFromPayload,
    statusToneFromPayload: statusToneFromPayload,
    text: text,
    toneForState: toneForState
  };

  window.InlineWidgets = {
    mountWidget: mountWidget,
    registerRenderer: registerRenderer,
    runtime: runtime
  };
}());
