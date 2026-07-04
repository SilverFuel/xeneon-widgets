(function () {
  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime || typeof runtime.registerRenderer !== "function") {
    return;
  }

  var addListener = runtime.addListener;
  var buildBridgeUrl = runtime.buildBridgeUrl;
  var clamp = runtime.clamp;
  var createTimerLoop = runtime.createTimerLoop;
  var emptyState = runtime.emptyState;
  var escapeHtml = runtime.escapeHtml;
  var formatAge = runtime.formatAge;
  var formatDurationMs = runtime.formatDurationMs;
  var formatMediaAppLabel = runtime.formatMediaAppLabel;
  var formatPercent = runtime.formatPercent;
  var initXnSlider = runtime.initXnSlider;
  var metricCard = runtime.metricCard;
  var normalizeMediaPayload = runtime.normalizeMediaPayload;
  var optionalNumber = runtime.optionalNumber;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var settingValue = runtime.settingValue;
  var statusTextFromPayload = runtime.statusTextFromPayload;
  var statusToneFromPayload = runtime.statusToneFromPayload;
  var text = runtime.text;

  function getSetting(env, key) {
    return settingValue(env, key, "");
  }

  function setupUpdate(env, kind) {
    if (env && typeof env.handleSetupUpdate === "function") {
      return env.handleSetupUpdate(kind);
    }
    return Promise.resolve();
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
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Current", data.temperature == null ? "--" : Math.round(data.temperature) + "°", /imperial/i.test(data.units) ? "Imperial" : "Metric") +
          metricCard("Source", data.source, state.statusText || "Bridge weather feed") +
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
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Bridge", data.bridgeIp || "--", state.statusText || data.bridgeName || "Philips Hue") +
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
                  '<div class="inline-slider-row"><strong>' + escapeHtml(formatPercent(light.brightness)) + '</strong><input class="inline-range" type="range" min="0" max="100" aria-label="Brightness for ' + escapeHtml(text(light.name, "light")) + '" value="' + Math.round(optionalNumber(light.brightness) || 0) + '" data-action="brightness-light" data-id="' + escapeHtml(text(light.id, "")) + '"' + (controlsEnabled && light.reachable !== false ? "" : " disabled") + '></div>' +
                '</div>';
            }).join("") : emptyState("No Hue lights", data.configured ? "No Hue lights were returned by the bridge." : "Enter the bridge IP and try linking again.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Diagnostics</div><div class="router-inline-copy">Press the hardware bridge button, then link here.</div></div></div>' +
            '<form class="inline-form" data-form="hue-link">' +
              '<div class="inline-form-grid">' +
                '<label class="inline-field"><span>Bridge IP</span><input class="inline-input" type="text" name="bridgeIp" value="' + escapeHtml(data.bridgeIp) + '" placeholder="Local bridge IP"></label>' +
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
                  '<div class="inline-slider-row"><strong>' + escapeHtml(formatPercent(group.brightness)) + '</strong><input class="inline-range" type="range" min="0" max="100" aria-label="Brightness for ' + escapeHtml(text(group.name, "group")) + '" value="' + Math.round(optionalNumber(group.brightness) || 0) + '" data-action="brightness-group" data-id="' + escapeHtml(text(group.id, "")) + '"' + (controlsEnabled ? "" : " disabled") + '></div>' +
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
      initXnSlider(container);
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
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Playback", hasSession ? playbackLabel : "Idle", text(data.source, "Windows media session"), progressPercent) +
          metricCard("Source", formatMediaAppLabel(data.appId), data.albumTitle ? data.albumTitle : "Foreground media app") +
          metricCard("Status", state.statusText, formatAge(data.sampledAt) || (data.stale ? "Sample is stale" : "Fresh snapshot")) +
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

  runtime.registerRenderer("weather", mountWeatherWidget);
  runtime.registerRenderer("hue", mountHueWidget);
  runtime.registerRenderer("media", mountMediaWidget);
}());
