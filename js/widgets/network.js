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
  var formatRate = runtime.formatRate;
  var formatValue = runtime.formatValue;
  var getUniFiNetworkEndpoint = runtime.getUniFiNetworkEndpoint;
  var metricCard = runtime.metricCard;
  var normalizeUnifiSnapshot = runtime.normalizeUnifiSnapshot;
  var optionalNumber = runtime.optionalNumber;
  var patchStableDom = runtime.patchStableDom;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var statusPill = runtime.statusPill;
  var statusTextFromPayload = runtime.statusTextFromPayload;
  var statusToneFromPayload = runtime.statusToneFromPayload;
  var text = runtime.text;
  var toneForState = runtime.toneForState;

  function normalizeNetworkSnapshot(raw) {
    var data = raw || {};
    return {
      supported: data.supported !== false,
      status: text(data.status, ""),
      stale: Boolean(data.stale),
      source: text(data.source, "native host"),
      message: text(data.message, ""),
      download: optionalNumber(data.download),
      upload: optionalNumber(data.upload),
      ping: optionalNumber(data.ping),
      type: text(data.type, "unknown"),
      name: text(data.name, ""),
      description: text(data.description, ""),
      linkSpeedMbps: optionalNumber(data.linkSpeedMbps),
      ipAddress: text(data.ipAddress, ""),
      gateway: text(data.gateway, ""),
      dnsServers: Array.isArray(data.dnsServers) ? data.dnsServers.filter(Boolean).map(String) : [],
      healthTarget: text(data.healthTarget, ""),
      healthTargetSource: text(data.healthTargetSource, "")
    };
  }

  function networkQualityScore(bridgeData, unifiData) {
    var ping = optionalNumber(bridgeData && bridgeData.ping);
    var score = 100;
    if (!bridgeData || bridgeData.supported === false) {
      score -= 45;
    }
    if (bridgeData && bridgeData.stale) {
      score -= 18;
    }
    if (ping == null) {
      score -= 32;
    } else if (ping >= 120) {
      score -= 34;
    } else if (ping >= 80) {
      score -= 22;
    } else if (ping >= 55) {
      score -= 10;
    }
    if (unifiData && unifiData.configured && !unifiData.linked) {
      score -= 10;
    }
    return clamp(Math.round(score), 0, 100);
  }

  function networkQualityTone(score) {
    if (score < 55) {
      return "danger";
    }
    if (score < 78) {
      return "warn";
    }
    return "good";
  }

  function networkQualityLabel(score, bridgeData) {
    if (score < 55) {
      return "Needs attention";
    }
    if (score < 78) {
      return "Fair";
    }
    var source = text(bridgeData && bridgeData.healthTargetSource, "").toLowerCase();
    if (source === "gateway" || source === "dns") {
      return "Local link ready";
    }
    if (source === "configured") {
      return "Target ready";
    }
    return "Game ready";
  }

  function networkPingLabel(bridgeData) {
    var source = text(bridgeData && bridgeData.healthTargetSource, "").toLowerCase();
    if (source === "gateway") {
      return "Router";
    }
    if (source === "dns") {
      return "DNS";
    }
    if (source === "configured") {
      return "Target";
    }
    return "Ping";
  }

  function networkTypeLabel(value) {
    var normalized = text(value, "unknown").toLowerCase();
    if (normalized === "wifi") {
      return "Wi-Fi";
    }
    if (normalized === "ethernet") {
      return "Ethernet";
    }
    return normalized === "unknown" ? "--" : normalized;
  }

  function networkLinkSpeed(value) {
    var parsed = optionalNumber(value);
    if (parsed == null || parsed <= 0) {
      return "--";
    }
    return parsed >= 1000 ? (parsed / 1000).toFixed(parsed >= 10000 ? 0 : 1) + " Gbps" : Math.round(parsed) + " Mbps";
  }

  function networkPill(label, value, detail, tone) {
    return '' +
      '<div class="network-pill" data-tone="' + escapeHtml(tone || "muted") + '">' +
        '<span>' + escapeHtml(label) + '</span>' +
        '<strong>' + escapeHtml(value) + '</strong>' +
        '<small>' + escapeHtml(detail || "") + '</small>' +
      '</div>';
  }

  function renderNetworkQualityCard(bridgeData, unifiData) {
    var score = networkQualityScore(bridgeData, unifiData);
    var tone = networkQualityTone(score);
    var label = networkQualityLabel(score, bridgeData);
    var ping = optionalNumber(bridgeData.ping);
    var pingLabel = networkPingLabel(bridgeData);
    var detail = ping == null ? "No " + pingLabel.toLowerCase() + " sample" : Math.round(ping) + " ms " + pingLabel.toLowerCase() + " response";
    return '' +
      '<article class="list-card inline-card network-quality-card" data-tone="' + escapeHtml(tone) + '">' +
        '<div class="network-quality-score">' +
          '<span>Readiness</span>' +
          '<strong>' + escapeHtml(String(score)) + '</strong>' +
          '<small>' + escapeHtml(label) + '</small>' +
        '</div>' +
        '<div class="network-quality-details">' +
          networkPill(pingLabel, ping == null ? "--" : Math.round(ping) + " ms", detail, ping == null ? "warn" : ping >= 100 ? "danger" : ping >= 60 ? "warn" : "good") +
          networkPill("Link", networkTypeLabel(bridgeData.type), networkLinkSpeed(bridgeData.linkSpeedMbps), bridgeData.type === "wifi" ? "warn" : "good") +
          networkPill("Gateway", bridgeData.gateway || "Not detected", bridgeData.gateway ? (bridgeData.ipAddress || "Local adapter") : (bridgeData.ipAddress ? "PC " + bridgeData.ipAddress : "No local address"), bridgeData.gateway ? "good" : "warn") +
        '</div>' +
      '</article>';
  }

  function renderUniFiConnectCard(unifiData, state) {
    var draft = state.unifiDraft || {};
    function draftField(name, fallback) {
      return Object.prototype.hasOwnProperty.call(draft, name) ? String(draft[name] == null ? "" : draft[name]) : fallback;
    }

    var trust = state.unifiTrust || (unifiData.certificateTrustRequired ? {
      thumbprint: text(unifiData.certificateThumbprint, ""),
      subject: text(unifiData.certificateSubject, ""),
      message: text(unifiData.certificateMessage, text(unifiData.message, "Review the UniFi certificate fingerprint."))
    } : null);
    var trustThumbprint = trust && trust.thumbprint ? String(trust.thumbprint) : "";
    var host = text(unifiData.gatewayIp, text(unifiData.host, ""));
    var formHost = draftField("host", host);
    var formSite = draftField("site", text(unifiData.site, "default"));
    var formUsername = draftField("username", "");
    var formPassword = draftField("password", "");
    var linked = Boolean(unifiData.linked);
    var detected = Boolean(unifiData.detected);
    var configured = Boolean(unifiData.configured);
    var linkState = trustThumbprint ? "review" : linked ? "linked" : "connect";
    var disabled = state.connecting ? " disabled" : "";
    var title = trustThumbprint ? "Review certificate" : linked ? "UniFi linked" : detected ? "UniFi detected" : configured ? "Reconnect UniFi" : "Connect UniFi";
    var copy = trustThumbprint
      ? text(trust.message, "Review the UniFi certificate fingerprint.")
      : linked
      ? unifiData.gateway
      : detected
        ? text(unifiData.gatewayCopy, "Local console found")
        : "Local account";
    var status = trustThumbprint ? statusPill("Review", "warn") : linked ? statusPill("Linked", "good") : detected ? statusPill("Detected", "good") : statusPill(configured ? "Reconnect" : "Optional", configured ? "warn" : "muted");
    var certificateReview = trustThumbprint ? '' +
      '<div class="network-certificate-review" data-tone="warn">' +
        '<span>Certificate fingerprint</span>' +
        '<strong>' + escapeHtml(trustThumbprint) + '</strong>' +
        '<small>' + escapeHtml(text(trust.subject, "UniFi console certificate")) + '</small>' +
      '</div>' : '';
    var submitLabel = state.connecting ? "Connecting" : trustThumbprint ? "Trust and connect" : linked ? "Update link" : "Connect";
    var kpis = '' +
      '<div class="network-unifi-kpis" data-ui-key="network-unifi-kpis">' +
        networkPill("Clients", String(unifiData.clients.total), unifiData.clients.wifi + " Wi-Fi / " + unifiData.clients.wired + " wired", linked ? "good" : "muted") +
        networkPill("APs", String(unifiData.aps.length), unifiData.site ? "Site " + unifiData.site : "Access points", linked ? "good" : "muted") +
        networkPill("Console", host || "--", unifiData.provider || "UniFi", detected || linked ? "good" : "muted") +
      '</div>';
    var form = '' +
      '<form class="network-unifi-form" data-ui-key="network-unifi-form" data-action="unifi-connect">' +
        '<div class="inline-form-grid inline-form-grid--2">' +
          '<label class="inline-field"><span>Host</span><input class="inline-input" type="text" name="host" value="' + escapeHtml(formHost) + '" placeholder="192.168.1.1"' + disabled + '></label>' +
          '<label class="inline-field"><span>Site</span><input class="inline-input" type="text" name="site" value="' + escapeHtml(formSite) + '" placeholder="default"' + disabled + '></label>' +
          '<label class="inline-field"><span>Username</span><input class="inline-input" type="text" name="username" autocomplete="username" value="' + escapeHtml(formUsername) + '" placeholder="local UniFi user"' + disabled + '></label>' +
          '<label class="inline-field"><span>Password</span><input class="inline-input" type="password" name="password" autocomplete="current-password" value="' + escapeHtml(formPassword) + '" placeholder="' + (linked ? "saved" : "password") + '"' + disabled + '></label>' +
        '</div>' +
        certificateReview +
        (trustThumbprint ? '<input type="hidden" name="trustedCertificateThumbprint" value="' + escapeHtml(trustThumbprint) + '">' : '') +
        '<div class="inline-actions network-unifi-actions">' +
          '<button class="inline-button is-primary" type="submit"' + disabled + '>' + submitLabel + '</button>' +
          (linked || configured ? '<button class="inline-button" type="button" data-action="unifi-disconnect"' + disabled + '>Forget</button>' : '') +
          '<button class="inline-button" type="button" data-action="refresh"' + disabled + '>Refresh</button>' +
        '</div>' +
        (state.formMessage ? '<div class="network-form-message" data-tone="' + escapeHtml(state.formTone || "muted") + '">' + escapeHtml(state.formMessage) + '</div>' : '') +
      '</form>';

    return '' +
      '<article class="list-card inline-card network-unifi-card" data-link-state="' + escapeHtml(linkState) + '">' +
        '<div class="inline-card-header">' +
          '<div>' +
            '<div class="metric-label">' + escapeHtml(title) + '</div>' +
            '<div class="router-inline-copy">' + escapeHtml(copy) + '</div>' +
          '</div>' +
          status +
        '</div>' +
        (linked ? kpis + form : form + kpis) +
      '</article>';
  }

  function renderNetworkListCard(title, copy, rows, emptyTitle, emptyCopy, extraClass) {
    return '' +
      '<article class="list-card inline-card network-list-card ' + escapeHtml(extraClass || "") + '">' +
        '<div class="inline-card-header"><div><div class="metric-label">' + escapeHtml(title) + '</div><div class="router-inline-copy">' + escapeHtml(copy) + '</div></div></div>' +
        '<div class="inline-list network-compact-list">' + (rows.length ? rows.join("") : emptyState(emptyTitle, emptyCopy)) + '</div>' +
      '</article>';
  }

  function renderNetworkWidget(bridgeData, unifiData, statusText, statusTone, state) {
    var topClients = (unifiData.topClients || []).slice(0, 4).map(function (client) {
      return '<div class="inline-list-item inline-list-item--split" data-ui-key="network-client-' + escapeHtml(text(client.id, text(client.mac, text(client.ip, text(client.name, "unknown"))))) + '"><div><div class="inline-list-title">' + escapeHtml(text(client.name, "Client")) + '</div><div class="inline-list-copy">' + escapeHtml(text(client.ip, text(client.connection, "Client"))) + '</div></div><div class="inline-list-meta">' + escapeHtml(text(client.usage, text(client.rate, "--"))) + '</div></div>';
    });
    var apRows = (unifiData.aps || []).slice(0, 4).map(function (ap) {
      return '<div class="inline-list-item inline-list-item--split" data-ui-key="network-ap-' + escapeHtml(text(ap.id, text(ap.mac, text(ap.name, "unknown")))) + '"><div><div class="inline-list-title">' + escapeHtml(text(ap.name, "Access Point")) + '</div><div class="inline-list-copy">' + escapeHtml(text(ap.status, "online") + (ap.channel ? " / " + ap.channel : "")) + '</div></div><div class="inline-list-meta">' + escapeHtml(String(optionalNumber(ap.clients) || 0) + " clients") + '</div></div>';
    });
    var dns = bridgeData.dnsServers.length ? bridgeData.dnsServers.join(", ") : "--";

    return '' +
      '<div class="inline-widget-shell network-command-shell">' +
        '<div class="network-command-grid">' +
          renderNetworkQualityCard(bridgeData, unifiData) +
          '<section class="network-kpi-grid">' +
            metricCard("Download", formatRate(bridgeData.download), "Live throughput") +
            metricCard("Upload", formatRate(bridgeData.upload), "Live throughput") +
            metricCard("Ping", formatValue(bridgeData.ping, " ms"), "Round trip") +
            metricCard("Adapter", networkTypeLabel(bridgeData.type), networkLinkSpeed(bridgeData.linkSpeedMbps)) +
          '</section>' +
          renderUniFiConnectCard(unifiData, state || {}) +
          '<article class="list-card inline-card network-adapter-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Local path</div><div class="router-inline-copy">' + escapeHtml(text(bridgeData.name, bridgeData.source)) + '</div></div></div>' +
            '<div class="network-path-grid">' +
              networkPill("PC IP", bridgeData.ipAddress || "--", bridgeData.description || "Adapter", bridgeData.ipAddress ? "good" : "warn") +
              networkPill("Gateway", bridgeData.gateway || "Not detected", "Router", bridgeData.gateway ? "good" : "warn") +
              networkPill("DNS", dns, "Resolvers", bridgeData.dnsServers.length ? "good" : "muted") +
            '</div>' +
          '</article>' +
          renderNetworkListCard("Top clients", "UniFi usage", topClients, unifiData.linked ? "No client data" : "Link UniFi", unifiData.linked ? "Controller returned no clients." : "Clients appear after UniFi is linked.", "network-list-card--clients") +
          renderNetworkListCard("Access points", "UniFi radios", apRows, unifiData.linked ? "No AP data" : "Link UniFi", unifiData.linked ? "Controller returned no access points." : "APs appear after UniFi is linked.", "network-list-card--aps") +
        '</div>' +
      '</div>';
  }

  function mountNetworkWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      bridge: normalizeNetworkSnapshot({}),
      unifi: normalizeUnifiSnapshot({}),
      statusText: "Loading",
      statusTone: "warn",
      connecting: false,
      formMessage: "",
      formTone: "muted",
      unifiDraft: {},
      unifiTrust: null
    };

    function redraw() {
      patchStableDom(container, renderNetworkWidget(state.bridge, state.unifi, state.statusText, state.statusTone, state));
    }

    function getCertificateTrust(snapshot) {
      if (!snapshot || !snapshot.certificateTrustRequired || !snapshot.certificateThumbprint) {
        return null;
      }

      return {
        thumbprint: String(snapshot.certificateThumbprint),
        subject: text(snapshot.certificateSubject, ""),
        message: text(snapshot.certificateMessage, text(snapshot.message, "Review the UniFi certificate fingerprint."))
      };
    }

    function readUniFiDraft(form) {
      var data = new FormData(form);
      state.unifiDraft = {
        host: String(data.get("host") || ""),
        site: String(data.get("site") || ""),
        username: String(data.get("username") || ""),
        password: String(data.get("password") || "")
      };
      return state.unifiDraft;
    }

    function isUniFiFormActive() {
      var active = document.activeElement;
      var inputType;
      var tagName;
      if (!active || !container.contains(active) || !active.closest || !active.matches || !active.closest('form[data-action="unifi-connect"]')) {
        return false;
      }

      if (active.disabled || active.readOnly) {
        return false;
      }

      if (active.isContentEditable) {
        return true;
      }

      tagName = String(active.tagName || "").toLowerCase();
      if (tagName === "textarea" || tagName === "select") {
        return true;
      }

      if (tagName !== "input") {
        return false;
      }

      inputType = String(active.getAttribute("type") || "text").toLowerCase();
      return ["email", "number", "password", "search", "tel", "text", "url"].indexOf(inputType) !== -1;
    }

    function redrawWhenFormIdle() {
      if (!isUniFiFormActive()) {
        redraw();
      }
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
        state.bridge = normalizeNetworkSnapshot(results[0] || {});
        state.unifi = results[1] || normalizeUnifiSnapshot({});
        state.unifiTrust = getCertificateTrust(state.unifi);
        state.statusText = state.unifiTrust ? "Review certificate" : state.unifi.linked ? "UniFi linked" : state.unifi.detected ? "UniFi detected" : statusTextFromPayload(state.bridge, "Live");
        state.statusTone = state.unifiTrust ? "warn" : state.unifi.linked || state.unifi.detected ? toneForState(state.unifi.status || "live") : statusToneFromPayload(state.bridge, "live");
        redrawWhenFormIdle();
      }, function (error) {
        state.bridge = normalizeNetworkSnapshot({ source: error.message || "Unavailable", status: "error" });
        state.unifi = normalizeUnifiSnapshot({});
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redrawWhenFormIdle();
      });
    }

    function connect(form) {
      if (state.connecting) {
        return Promise.resolve();
      }

      var draft = readUniFiDraft(form);
      var trustedCertificateThumbprint = state.unifiTrust && state.unifiTrust.thumbprint ? state.unifiTrust.thumbprint : String(new FormData(form).get("trustedCertificateThumbprint") || "");
      state.connecting = true;
      state.formMessage = "";
      redraw();
      return requestJson(buildBridgeUrl(env, "/api/unifi/network/link"), {
        method: "POST",
        body: {
          host: draft.host,
          username: draft.username,
          password: draft.password,
          site: draft.site,
          trustCertificate: Boolean(trustedCertificateThumbprint),
          trustedCertificateThumbprint: trustedCertificateThumbprint
        }
      }, 12000).then(function (payload) {
        state.unifi = normalizeUnifiSnapshot(payload);
        state.unifiTrust = getCertificateTrust(state.unifi);
        if (state.unifiTrust) {
          state.unifiDraft = draft;
          state.statusText = "Review certificate";
          state.statusTone = "warn";
          state.formMessage = state.unifiTrust.message;
          state.formTone = "warn";
          return;
        }

        state.unifiDraft = {
          host: text(state.unifi.gatewayIp, text(state.unifi.host, draft.host)),
          site: text(state.unifi.site, draft.site || "default"),
          username: draft.username,
          password: ""
        };
        state.statusText = "UniFi linked";
        state.statusTone = "good";
        state.formMessage = "Linked locally";
        state.formTone = "good";
      }, function (error) {
        state.formMessage = error.message || "UniFi link failed";
        state.formTone = "danger";
        state.statusText = "Link failed";
        state.statusTone = "danger";
      }).finally(function () {
        state.connecting = false;
        redraw();
      });
    }

    function disconnect() {
      if (state.connecting) {
        return Promise.resolve();
      }

      state.connecting = true;
      state.formMessage = "";
      redraw();
      return requestJson(buildBridgeUrl(env, "/api/unifi/network/disconnect"), {
        method: "POST",
        body: {}
      }, 5000).then(function (payload) {
        state.unifi = normalizeUnifiSnapshot(payload);
        state.unifiDraft = {};
        state.unifiTrust = null;
        state.statusText = "UniFi optional";
        state.statusTone = "muted";
        state.formMessage = "UniFi forgotten";
        state.formTone = "muted";
      }, function (error) {
        state.formMessage = error.message || "Forget failed";
        state.formTone = "danger";
      }).finally(function () {
        state.connecting = false;
        redraw();
      });
    }

    addListener(cleanups, container, "submit", function (event) {
      var form = event.target && event.target.closest ? event.target.closest('form[data-action="unifi-connect"]') : null;
      if (!form) {
        return;
      }
      event.preventDefault();
      if (state.connecting) {
        return;
      }
      connect(form);
    });

    addListener(cleanups, container, "input", function (event) {
      var form = event.target && event.target.closest ? event.target.closest('form[data-action="unifi-connect"]') : null;
      if (form) {
        readUniFiDraft(form);
      }
    });

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      if (!target || state.connecting) {
        return;
      }
      if (target.getAttribute("data-action") === "refresh") {
        refresh();
      }
      if (target.getAttribute("data-action") === "unifi-disconnect") {
        disconnect();
      }
    });

    var loop = createTimerLoop(refresh, 4000, isUniFiFormActive);
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

  runtime.registerHelpers({
    networkLinkSpeed: networkLinkSpeed,
    networkQualityLabel: networkQualityLabel,
    networkQualityScore: networkQualityScore,
    networkQualityTone: networkQualityTone,
    networkTypeLabel: networkTypeLabel,
    normalizeNetworkSnapshot: normalizeNetworkSnapshot
  });
  runtime.registerRenderer("network", mountNetworkWidget);
  runtime.registerRenderer("unifi-network", mountNetworkWidget);
}());
