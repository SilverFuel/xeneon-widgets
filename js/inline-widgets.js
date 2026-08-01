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

  function stableNodeKey(node) {
    var explicitKey;
    if (!node || node.nodeType !== 1) {
      return "";
    }

    explicitKey = node.getAttribute("data-ui-key");
    if (explicitKey) {
      return "key:" + explicitKey;
    }
    if (node.id) {
      return "id:" + node.id;
    }
    explicitKey = node.getAttribute("data-action");
    if (explicitKey) {
      return "action:" + node.tagName + ":" + explicitKey;
    }
    explicitKey = node.getAttribute("name");
    if (explicitKey && node.matches("input, textarea, select, button")) {
      if (node.matches('input[type="checkbox"], input[type="radio"]')) {
        return "name:" + node.tagName + ":" + explicitKey + ":" + text(node.value, "on");
      }
      return "name:" + node.tagName + ":" + explicitKey;
    }
    return "";
  }

  function compatibleStableNodes(currentNode, nextNode) {
    return Boolean(currentNode && nextNode
      && currentNode.nodeType === nextNode.nodeType
      && (currentNode.nodeType !== 1 || currentNode.tagName === nextNode.tagName));
  }

  function dirtyFormControl(node) {
    var options;

    if (!node || !node.matches || !node.matches("input, textarea, select")) {
      return false;
    }
    if (node.matches('input[type="checkbox"], input[type="radio"]')) {
      return node.checked !== node.defaultChecked;
    }
    if (node.matches('input[type="file"]')) {
      return false;
    }
    if (node.matches("select")) {
      options = Array.prototype.slice.call(node.options || []);
      return options.some(function (option) {
        return option.selected !== option.defaultSelected;
      });
    }
    return node.value !== node.defaultValue;
  }

  function captureFormControlState(node) {
    if (node.matches('input[type="checkbox"], input[type="radio"]')) {
      return { node: node, kind: "checked", checked: node.checked };
    }
    if (node.matches("select")) {
      return {
        node: node,
        kind: "select",
        selectedValues: Array.prototype.slice.call(node.options || []).filter(function (option) {
          return option.selected;
        }).map(function (option) {
          return option.value;
        })
      };
    }
    return { node: node, kind: "value", value: node.value };
  }

  function restoreFormControlState(state) {
    if (!state.node.isConnected) {
      return;
    }
    if (state.kind === "checked") {
      state.node.checked = state.checked;
      return;
    }
    if (state.kind === "select") {
      Array.prototype.slice.call(state.node.options || []).forEach(function (option) {
        option.selected = state.selectedValues.indexOf(option.value) !== -1;
      });
      return;
    }
    if (!state.node.matches('input[type="file"]')) {
      state.node.value = state.value;
    }
  }

  function syncStableAttributes(currentNode, nextNode, activeNode) {
    var preserveValue = currentNode === activeNode;
    var nextNames = {};

    Array.prototype.slice.call(nextNode.attributes || []).forEach(function (attribute) {
      nextNames[attribute.name] = true;
      if (preserveValue && (attribute.name === "value" || attribute.name === "checked" || attribute.name === "selected")) {
        return;
      }
      if (currentNode.getAttribute(attribute.name) !== attribute.value) {
        currentNode.setAttribute(attribute.name, attribute.value);
      }
    });

    Array.prototype.slice.call(currentNode.attributes || []).forEach(function (attribute) {
      if (!nextNames[attribute.name]
          && !(preserveValue && (attribute.name === "value" || attribute.name === "checked" || attribute.name === "selected"))) {
        currentNode.removeAttribute(attribute.name);
      }
    });

    if (!preserveValue && currentNode.matches && currentNode.matches("input, textarea, select")) {
      if (currentNode.value !== nextNode.value) {
        currentNode.value = nextNode.value;
      }
      if (currentNode.matches('input[type="checkbox"], input[type="radio"]')) {
        currentNode.checked = nextNode.checked;
      }
    }
  }

  function reconcileStableNode(currentNode, nextNode, activeNode) {
    var currentChildren;
    var usedChildren = [];

    if (!compatibleStableNodes(currentNode, nextNode)) {
      return nextNode.cloneNode(true);
    }

    if (currentNode.nodeType === 3 || currentNode.nodeType === 8) {
      if (currentNode.nodeValue !== nextNode.nodeValue) {
        currentNode.nodeValue = nextNode.nodeValue;
      }
      return currentNode;
    }

    syncStableAttributes(currentNode, nextNode, activeNode);
    currentChildren = Array.prototype.slice.call(currentNode.childNodes);

    Array.prototype.slice.call(nextNode.childNodes).forEach(function (desiredChild, desiredIndex) {
      var desiredKey = stableNodeKey(desiredChild);
      var match = null;
      var referenceNode = currentNode.childNodes[desiredIndex] || null;

      if (desiredKey) {
        match = currentChildren.filter(function (candidate) {
          return usedChildren.indexOf(candidate) === -1 && stableNodeKey(candidate) === desiredKey;
        })[0] || null;
      } else if (referenceNode
          && usedChildren.indexOf(referenceNode) === -1
          && !stableNodeKey(referenceNode)
          && compatibleStableNodes(referenceNode, desiredChild)) {
        match = referenceNode;
      } else {
        match = currentChildren.filter(function (candidate) {
          return usedChildren.indexOf(candidate) === -1
            && !stableNodeKey(candidate)
            && compatibleStableNodes(candidate, desiredChild);
        })[0] || null;
      }

      if (!match) {
        match = desiredChild.cloneNode(true);
      } else {
        match = reconcileStableNode(match, desiredChild, activeNode);
      }

      referenceNode = currentNode.childNodes[desiredIndex] || null;
      if (referenceNode && referenceNode.parentNode !== currentNode) {
        referenceNode = null;
      }
      if (match !== referenceNode) {
        currentNode.insertBefore(match, referenceNode);
      }
      usedChildren.push(match);
    });

    Array.prototype.slice.call(currentNode.childNodes).forEach(function (child) {
      if (usedChildren.indexOf(child) === -1 && child.parentNode === currentNode) {
        currentNode.removeChild(child);
      }
    });
    return currentNode;
  }

  function patchStableDom(container, html) {
    var activeNode = document.activeElement && container.contains(document.activeElement) ? document.activeElement : null;
    var formControlStates = [];
    var detailsStates = [];
    var selection = null;
    var scrollStates = [];
    var fragment;
    var nextContainer;

    if (activeNode && typeof activeNode.selectionStart === "number") {
      selection = {
        start: activeNode.selectionStart,
        end: activeNode.selectionEnd,
        direction: activeNode.selectionDirection
      };
    }

    [container].concat(Array.prototype.slice.call(container.querySelectorAll("*"))).forEach(function (node) {
      if (node.scrollTop || node.scrollLeft) {
        scrollStates.push({ node: node, top: node.scrollTop, left: node.scrollLeft });
      }
    });

    Array.prototype.slice.call(container.querySelectorAll("input, textarea, select")).forEach(function (node) {
      if (node === activeNode || dirtyFormControl(node)) {
        formControlStates.push(captureFormControlState(node));
      }
    });

    Array.prototype.slice.call(container.querySelectorAll("details[data-preserve-open]")).forEach(function (node) {
      detailsStates.push({ node: node, open: node.open });
    });

    var range = document.createRange();
    range.selectNodeContents(container);
    fragment = range.createContextualFragment(String(html || "").trim());
    nextContainer = container.cloneNode(false);
    nextContainer.appendChild(fragment);
    if (container.innerHTML === nextContainer.innerHTML) {
      return container.firstElementChild;
    }
    reconcileStableNode(container, nextContainer, activeNode);

    formControlStates.forEach(restoreFormControlState);

    detailsStates.forEach(function (state) {
      if (state.node.isConnected) {
        state.node.open = state.open;
      }
    });

    scrollStates.forEach(function (state) {
      if (state.node.isConnected) {
        state.node.scrollTop = state.top;
        state.node.scrollLeft = state.left;
      }
    });

    if (activeNode && activeNode.isConnected && document.activeElement !== activeNode) {
      try {
        activeNode.focus({ preventScroll: true });
      } catch (error) {
        activeNode.focus();
      }
    }
    if (selection && activeNode && activeNode.isConnected && typeof activeNode.setSelectionRange === "function") {
      try {
        activeNode.setSelectionRange(selection.start, selection.end, selection.direction || "none");
      } catch (error) {
        // Some input types expose selectionStart but do not accept setSelectionRange.
      }
    }
    return container.firstElementChild;
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
    patchStableDom(container, '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Panel unavailable</div>' +
            '<h3 class="inline-title">' + escapeHtml(text(widget.title, widget.id)) + '</h3>' +
            '<p class="inline-copy">This panel could not be loaded. The rest of Auxora is still available.</p>' +
          '</div>' +
          statusPill("Unavailable", "danger") +
        '</div>' +
        '<article class="list-card inline-card">' + emptyState("Panel renderer unavailable", "Open another panel, then restart Auxora. If this keeps happening, use Recovery to open logs or repair the installed copy.") + '</article>' +
      '</div>');

    return {
      refresh: function () {
        return Promise.resolve();
      },
      destroy: function () {
        patchStableDom(container, "");
      }
    };
  }

  var fallbackProductThemes = [
    { id: "focus", name: "Focus", accent: "#46bce8", secondary: "#7f9fb3", copy: "Calm charcoal surfaces and restrained cyan." },
    { id: "gaming", name: "Gaming", accent: "#9a7cff", secondary: "#36c8f0", copy: "Deep black, purple, and cyan performance energy." },
    { id: "warm", name: "Warm", accent: "#d9a35f", secondary: "#ce7d86", copy: "Muted amber and rose for comfortable sessions." }
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
      '<div class="inline-widget-shell product-shell" aria-label="' + escapeHtml(title) + '">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">' + escapeHtml(kicker) + '</div>' +
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
    var mountRoot = document.createElement("div");
    var controller;
    var destroyed = false;

    mountRoot.className = "inline-widget-mount";
    mountRoot.setAttribute("data-inline-widget-mount", text(widget && widget.id, "unknown"));
    container.appendChild(mountRoot);

    try {
      controller = renderer(widget || { id: "unknown", title: "Widget" }, mountRoot, env || {});
    } catch (error) {
      if (mountRoot.parentNode === container) {
        container.removeChild(mountRoot);
      }
      throw error;
    }

    return {
      refresh: function () {
        if (destroyed || !controller || typeof controller.refresh !== "function") {
          return Promise.resolve();
        }
        return controller.refresh();
      },
      destroy: function () {
        if (destroyed) {
          return;
        }
        destroyed = true;
        if (controller && typeof controller.destroy === "function") {
          controller.destroy();
        }
        if (mountRoot.parentNode === container) {
          container.removeChild(mountRoot);
        }
      }
    };
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
    patchStableDom: patchStableDom,
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
