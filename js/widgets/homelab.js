(function () {
  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime || typeof runtime.registerRenderer !== "function") {
    return;
  }

  var addListener = runtime.addListener;
  var clamp = runtime.clamp;
  var createTimerLoop = runtime.createTimerLoop;
  var emptyState = runtime.emptyState;
  var escapeHtml = runtime.escapeHtml;
  var formatAge = runtime.formatAge;
  var formatPercent = runtime.formatPercent;
  var formatRate = runtime.formatRate;
  var formatStorage = runtime.formatStorage;
  var formatTemp = runtime.formatTemp;
  var formatValue = runtime.formatValue;
  var formatWhen = runtime.formatWhen;
  var getUniFiNetworkEndpoint = runtime.getUniFiNetworkEndpoint;
  var initXnSlider = runtime.initXnSlider;
  var metricCard = runtime.metricCard;
  var optionalNumber = runtime.optionalNumber;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var statusPill = runtime.statusPill;
  var statusTextFromPayload = runtime.statusTextFromPayload;
  var statusToneFromPayload = runtime.statusToneFromPayload;
  var text = runtime.text;

  function getSetting(env, key) {
    return env && typeof env.getSetting === "function" ? env.getSetting(key) : "";
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

  function normalizeUnifiSnapshot(raw) {
    return normalizeUniFiNetworkPayload(raw);
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
      gatewayIp: text(payload.gatewayIp, ""),
      host: text(payload.host, ""),
      site: text(payload.site, "default"),
      source: text(payload.source, "UniFi endpoint"),
      status: text(payload.status, ""),
      message: text(payload.message, ""),
      configured: Boolean(payload.configured),
      linked: Boolean(payload.linked),
      detected: Boolean(payload.detected),
      certificateTrusted: Boolean(payload.certificateTrusted),
      certificateTrustRequired: Boolean(payload.certificateTrustRequired),
      certificateThumbprint: text(payload.certificateThumbprint, ""),
      certificateSubject: text(payload.certificateSubject, ""),
      certificateMessage: text(payload.certificateMessage, ""),
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
      topApps: Array.isArray(payload.topApps) ? payload.topApps : [],
      connectivity: Array.isArray(payload.connectivity) ? payload.connectivity : []
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
                  '<div class="inline-slider-row"><strong>' + escapeHtml(formatPercent(light.brightness)) + '</strong><input class="inline-range" type="range" min="0" max="100" aria-label="Brightness for ' + escapeHtml(text(light.name, "light")) + '" value="' + Math.round(optionalNumber(light.brightness) || 0) + '" data-action="brightness-light" data-id="' + escapeHtml(text(light.id, "")) + '"' + (writable ? "" : " disabled") + '></div>' +
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
      initXnSlider(container);
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

  runtime.registerHelpers({
    normalizeUnifiSnapshot: normalizeUnifiSnapshot
  });
  runtime.registerRenderer("unifi-camera", mountCameraWidget);
  runtime.registerRenderer("unifi-network", mountUniFiNetworkWidget);
  runtime.registerRenderer("plex", mountPlexWidget);
  runtime.registerRenderer("nas", mountNasWidget);
  runtime.registerRenderer("automation", mountAutomationWidget);
}());
