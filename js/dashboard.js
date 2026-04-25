(function () {
  var params = new URLSearchParams(window.location.search);
  var bridgeOrigin = params.get("bridge") || "http://127.0.0.1:8976";
  var widgetBase = params.get("widgetBase") || bridgeOrigin;
  var perfMode = params.get("perf") === "1";
  var assetRevision = "20260425-4";
  var onboardingVersion = 1;
  var showAdvanced = params.get("advanced") === "1";
  var stageWidth = 2560;
  var stageHeight = 720;
  var widgetStorageKey = "xeneon-dashboard-widget";
  var lastPrimaryWidgetStorageKey = "xeneon-dashboard-last-widget";
  var settingsStorageKey = "xeneon-dashboard-settings";
  var pickerNode = null;
  var inlineViewerNode = null;
  var loadingNode = null;
  var settingsNode = null;
  var emptyNode = null;
  var retryNode = null;
  var diagnosticsRailNode = null;
  var diagnosticsInlineNode = null;
  var inlineWidgetController = null;
  var activeInlineWidgetId = "";
  var lastBridgeSnapshotKey = "";
  var currentWidgetId = "";
  var widgets = [];
  var dashboardSettings = {};
  var storedSettings = {};
  var bridgeReachable = null;
  var bridgeCapabilities = {
    system: true,
    network: true,
    launchers: false,
    quickActions: false,
    shortcuts: false,
    audio: false,
    calendar: false,
    media: false,
    clipboard: false,
    weather: true,
    hue: false,
    unifi: true
  };
  var bridgeConfig = {
    weather: {
      configured: false,
      city: "Indianapolis",
      units: "metric"
    },
    calendar: {
      configured: false,
      icsUrl: ""
    },
    launchers: {
      configured: false,
      count: 0
    },
    hue: {
      bridgeIp: "",
      configured: false,
      linked: false
    },
    dashboard: {
      onboardingCompleted: false,
      onboardingCompletedAt: "",
      onboardingVersion: onboardingVersion
    }
  };
  var bridgeSetup = createBootSetupSummary();
  var defaultSettings = {
    dashboardOpacity: "100",
    profileId: "command",
    themeId: "edge",
    animationIntensity: "100",
    accentColor: "",
    layoutOrder: "",
    marketplacePack: "core",
    updateChannel: "stable",
    obsEndpoint: "ws://127.0.0.1:4455",
    streamScene: "Main",
    gameModeEnabled: "false",
    gameModeGame: "",
    installerEdition: "unsigned",
    privacyConsent: "local-only",
    city: "Indianapolis",
    units: "metric",
    unifiCameraEndpoint: "",
    unifiCameraFeed: "",
    unifiCameraRelayUrl: "",
    unifiCameraSnapshot: "",
    unifiCameraName: "",
    unifiCameraLocation: "",
    unifiCameraFeedType: "",
    unifiNetworkEndpoint: "",
    plexEndpoint: "",
    plexUplink: "",
    nasEndpoint: "",
    automationEndpoint: "",
    automationActionEndpoint: ""
  };
  var settingSchemas = {
    weather: {
      title: "Weather",
      copy: "Optional city and units for the weather widget.",
      fields: [
        {
          key: "city",
          label: "City",
          placeholder: "Indianapolis",
          help: "Sent to the bridge weather endpoint."
        },
        {
          key: "units",
          label: "Units",
          type: "select",
          options: [
            { value: "metric", label: "Metric (C)" },
            { value: "imperial", label: "Imperial (F)" }
          ],
          help: "Matches the bridge weather units."
        }
      ]
    },
    "unifi-camera": {
      title: "UniFi Camera",
      copy: "Native camera connector is planned. The normal setup no longer asks for relay URLs.",
      fields: []
    },
    "unifi-network": {
      title: "UniFi Network",
      copy: "Built in. Xenon detects the local UniFi console through the native host.",
      fields: []
    },
    plex: {
      title: "Plex Server",
      copy: "Native Plex connector is planned. No local JSON service is required in the normal setup.",
      fields: []
    },
    nas: {
      title: "NAS Storage",
      copy: "Native NAS connector is planned. The normal setup stays endpoint-free.",
      fields: []
    },
    automation: {
      title: "Home Automation",
      copy: "Native Home Assistant style connector is planned. Endpoint setup is no longer part of first run.",
      fields: []
    }
  };
  var productThemePresets = [
    {
      id: "edge",
      name: "Edge Neon",
      accent: "#00e0ff",
      secondary: "#44f0c2",
      warm: "#ffb547",
      background: "#070d13",
      copy: "High-energy cyan, green, and amber motion for the XENEON panel."
    },
    {
      id: "afterburn",
      name: "Afterburn",
      accent: "#ff4d8d",
      secondary: "#f5a623",
      warm: "#44f0c2",
      background: "#120910",
      copy: "A warmer stream-ready look with rose and amber highlights."
    },
    {
      id: "deepcore",
      name: "Deep Core",
      accent: "#7a5cff",
      secondary: "#00e0ff",
      warm: "#f5a623",
      background: "#090b16",
      copy: "Dark, quieter control-room contrast for long sessions."
    },
    {
      id: "verdant",
      name: "Verdant",
      accent: "#44f0c2",
      secondary: "#00e0ff",
      warm: "#ff4d8d",
      background: "#06110f",
      copy: "Green-forward telemetry with brighter status accents."
    }
  ];
  var localProductWidgetIds = [
    "profiles",
    "theme-studio",
    "layout-editor",
    "updates",
    "streaming",
    "game-mode",
    "marketplace",
    "installer",
    "privacy"
  ];

  function createSetupItem(label, state, required, nextStep) {
    return { label: label, state: state, required: required, nextStep: nextStep };
  }

  function createBootSetupSummary() {
    return {
      essentialsReady: false,
      onboardingCompleted: false,
      onboardingCompletedAt: "",
      onboardingVersion: onboardingVersion,
      needsAttention: true,
      items: {
        bridge: createSetupItem("Local bridge", "Needs Setup", true, "Checking the bridge state."),
        system: createSetupItem("System Monitor", "Needs Setup", true, "Waiting for the bridge."),
        network: createSetupItem("Network Monitor", "Needs Setup", true, "Waiting for the bridge."),
        launchers: createSetupItem("App Launcher", "Needs Setup", false, "Waiting for the bridge."),
        "quick-actions": createSetupItem("Quick Actions", "Needs Setup", false, "Waiting for the bridge."),
        shortcuts: createSetupItem("System Shortcuts", "Needs Setup", false, "Waiting for the bridge."),
        audio: createSetupItem("Audio Control", "Needs Setup", false, "Waiting for the bridge."),
        clipboard: createSetupItem("Clipboard History", "Needs Setup", false, "Waiting for the bridge."),
        weather: createSetupItem("Weather", "Optional", false, "Add an OpenWeather key if you want the Weather widget."),
        calendar: createSetupItem("Calendar", "Optional", false, "Add an ICS feed if you want the Calendar widget."),
        hue: createSetupItem("Philips Hue", "Optional", false, "Link your Hue Bridge only if you want local lighting controls.")
      }
    };
  }

  function createOfflineSetupSummary() {
    return {
      essentialsReady: false,
      onboardingCompleted: Boolean(bridgeConfig.dashboard && bridgeConfig.dashboard.onboardingCompleted),
      onboardingCompletedAt: bridgeConfig.dashboard && bridgeConfig.dashboard.onboardingCompletedAt ? bridgeConfig.dashboard.onboardingCompletedAt : "",
      onboardingVersion: bridgeConfig.dashboard && bridgeConfig.dashboard.onboardingVersion ? bridgeConfig.dashboard.onboardingVersion : onboardingVersion,
      needsAttention: true,
      items: {
        bridge: createSetupItem("Local bridge", "Needs Setup", true, "Start the localhost bridge to load the dashboard."),
        system: createSetupItem("System Monitor", "Needs Setup", true, "System telemetry depends on the local bridge."),
        network: createSetupItem("Network Monitor", "Needs Setup", true, "Network telemetry depends on the local bridge."),
        launchers: createSetupItem("App Launcher", "Needs Setup", false, "App launching depends on the local bridge."),
        "quick-actions": createSetupItem("Quick Actions", "Needs Setup", false, "Quick actions depend on the local bridge."),
        shortcuts: createSetupItem("System Shortcuts", "Needs Setup", false, "System shortcuts depend on the local bridge."),
        audio: createSetupItem("Audio Control", "Needs Setup", false, "Audio routing depends on the local bridge."),
        media: createSetupItem("Media Transport", "Needs Setup", false, "Media transport depends on the local bridge."),
        clipboard: createSetupItem("Clipboard History", "Needs Setup", false, "Clipboard history depends on the local bridge."),
        calendar: createSetupItem("Calendar", bridgeConfig.calendar && bridgeConfig.calendar.configured ? "Needs Setup" : "Optional", false, bridgeConfig.calendar && bridgeConfig.calendar.configured ? "Calendar was configured before. Start the bridge, then re-check it." : "Add an ICS feed if you want the Calendar widget."),
        weather: createSetupItem("Weather", bridgeConfig.weather && bridgeConfig.weather.configured ? "Needs Setup" : "Optional", false, bridgeConfig.weather && bridgeConfig.weather.configured ? "Weather was configured before. Start the bridge, then re-check it." : "Add an OpenWeather key if you want the Weather widget."),
        hue: createSetupItem("Philips Hue", bridgeConfig.hue && bridgeConfig.hue.configured ? "Needs Setup" : "Optional", false, bridgeConfig.hue && bridgeConfig.hue.configured ? "Hue was configured before. Start the bridge, then re-check it." : "Link your Hue Bridge only if you want local lighting controls."),
        unifi: createSetupItem("UniFi Network", "Checking", false, "Xenon checks for UniFi in the background.")
      }
    };
  }

  function getSetupItem(itemId) {
    return bridgeSetup && bridgeSetup.items && bridgeSetup.items[itemId]
      ? bridgeSetup.items[itemId]
      : createSetupItem(itemId, "Optional", false, "");
  }

  function isLocalBridgeBlockedByPageOrigin() {
    return window.location.protocol === "https:" && /^http:\/\/127\.0\.0\.1:\d+$/i.test(bridgeOrigin);
  }

  function setScale() {
    if (perfMode) {
      document.documentElement.style.setProperty("--dashboard-scale", "1");
      return;
    }

    var scale = Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight);
    document.documentElement.style.setProperty("--dashboard-scale", String(scale));
  }

  function initAmbientGraphics() {
    var canvas = document.getElementById("dashboard-ambient-canvas");
    var shell = document.getElementById("dashboard-stage-shell");
    var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var context;
    var width = 0;
    var height = 0;
    var deviceRatio = 1;
    var lanes = [];
    var pulses = [];
    var rafId = 0;

    if (!canvas || !shell || perfMode || reducedMotion) {
      return;
    }

    context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return;
    }

    function buildScene() {
      var laneCount = Math.max(9, Math.round(width / 210));
      var pulseCount = Math.max(24, Math.round(width / 84));
      lanes = [];
      pulses = [];

      for (var laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
        lanes.push({
          x: (laneIndex / Math.max(1, laneCount - 1)) * width,
          drift: 0.6 + ((laneIndex % 5) * 0.18),
          phase: laneIndex * 0.71,
          hue: laneIndex % 4
        });
      }

      for (var pulseIndex = 0; pulseIndex < pulseCount; pulseIndex += 1) {
        pulses.push({
          x: (pulseIndex * 157) % Math.max(1, width),
          y: 48 + ((pulseIndex * 89) % Math.max(1, height - 96)),
          speed: 0.28 + ((pulseIndex % 7) * 0.045),
          length: 42 + ((pulseIndex % 5) * 18),
          phase: pulseIndex * 0.41,
          hue: pulseIndex % 5
        });
      }
    }

    function resizeCanvas() {
      var bounds = shell.getBoundingClientRect();
      var nextWidth = Math.max(1, Math.round(bounds.width));
      var nextHeight = Math.max(1, Math.round(bounds.height));
      var nextRatio = Math.min(2, window.devicePixelRatio || 1);

      if (nextWidth === width && nextHeight === height && nextRatio === deviceRatio) {
        return;
      }

      width = nextWidth;
      height = nextHeight;
      deviceRatio = nextRatio;
      canvas.width = Math.round(width * deviceRatio);
      canvas.height = Math.round(height * deviceRatio);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      context.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
      buildScene();
    }

    function laneColor(index, alpha) {
      var colors = [
        "rgba(0, 224, 255, " + alpha + ")",
        "rgba(71, 255, 186, " + alpha + ")",
        "rgba(255, 77, 141, " + alpha + ")",
        "rgba(245, 166, 35, " + alpha + ")",
        "rgba(133, 117, 255, " + alpha + ")"
      ];
      return colors[index % colors.length];
    }

    function draw(timestamp) {
      var time = timestamp * 0.001;
      resizeCanvas();
      context.clearRect(0, 0, width, height);

      context.save();
      context.globalCompositeOperation = "screen";

      lanes.forEach(function (lane, index) {
        var sway = Math.sin(time * lane.drift + lane.phase) * 38;
        var startX = lane.x + sway;
        var gradient = context.createLinearGradient(startX, 0, startX + 120, height);
        gradient.addColorStop(0, laneColor(lane.hue, 0));
        gradient.addColorStop(0.36, laneColor(lane.hue, 0.14));
        gradient.addColorStop(1, laneColor(lane.hue + 1, 0));

        context.strokeStyle = gradient;
        context.lineWidth = index % 3 === 0 ? 2 : 1;
        context.beginPath();
        context.moveTo(startX - 180, height + 30);
        context.lineTo(startX + 160, -30);
        context.stroke();
      });

      pulses.forEach(function (pulse) {
        var travel = (pulse.x + (time * 140 * pulse.speed)) % (width + 180);
        var y = pulse.y + Math.sin(time * 1.4 + pulse.phase) * 18;
        var alpha = 0.16 + (Math.sin(time * 2 + pulse.phase) + 1) * 0.07;

        context.fillStyle = laneColor(pulse.hue, alpha);
        context.fillRect(travel - pulse.length, y, pulse.length, 2);
        context.fillStyle = laneColor(pulse.hue + 1, alpha * 0.7);
        context.fillRect(travel + 8, y + 10, Math.max(10, pulse.length * 0.38), 1);
      });

      context.strokeStyle = "rgba(255, 255, 255, 0.08)";
      context.lineWidth = 1;
      context.beginPath();
      for (var point = 0; point <= 72; point += 1) {
        var x = (point / 72) * width;
        var wave = height * 0.5
          + Math.sin(point * 0.36 + time * 1.3) * 26
          + Math.sin(point * 0.11 - time * 0.7) * 42;
        if (point === 0) {
          context.moveTo(x, wave);
        } else {
          context.lineTo(x, wave);
        }
      }
      context.stroke();

      context.restore();
      rafId = window.requestAnimationFrame(draw);
    }

    resizeCanvas();
    rafId = window.requestAnimationFrame(draw);
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("pagehide", function () {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    });
  }

  function normalizeOpacityPercent(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 100;
    }
    return Math.max(35, Math.min(100, Math.round(parsed)));
  }

  function normalizeAnimationPercent(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 100;
    }
    return Math.max(0, Math.min(140, Math.round(parsed)));
  }

  function getDashboardOpacityPercent() {
    return normalizeOpacityPercent(getSetting("dashboardOpacity"));
  }

  function getAnimationIntensityPercent() {
    return normalizeAnimationPercent(getSetting("animationIntensity"));
  }

  function getProductTheme(themeId) {
    var requested = String(themeId || getSetting("themeId") || defaultSettings.themeId);
    return productThemePresets.filter(function (preset) {
      return preset.id === requested;
    })[0] || productThemePresets[0];
  }

  function parseHexColor(value) {
    var match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
    if (!match) {
      return null;
    }

    return "#" + match[1].toLowerCase();
  }

  function hexToRgb(value) {
    var normalized = parseHexColor(value);
    if (!normalized) {
      return null;
    }

    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16)
    };
  }

  function rgbaFromHex(value, alpha) {
    var rgb = hexToRgb(value);
    if (!rgb) {
      return "rgba(0, 224, 255, " + alpha + ")";
    }

    return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + alpha + ")";
  }

  function applyDashboardOpacity() {
    var ratio = getDashboardOpacityPercent() / 100;
    document.documentElement.style.setProperty("--dashboard-surface-opacity", String(ratio));
    document.documentElement.style.setProperty("--dashboard-widget-opacity", String(ratio));
  }

  function applyDashboardPresentation() {
    var theme = getProductTheme();
    var accent = parseHexColor(getSetting("accentColor")) || theme.accent;
    var intensity = getAnimationIntensityPercent();

    applyDashboardOpacity();
    document.documentElement.style.setProperty("--color-accent", accent);
    document.documentElement.style.setProperty("--color-accent-soft", rgbaFromHex(accent, 0.18));
    document.documentElement.style.setProperty("--dashboard-accent", accent);
    document.documentElement.style.setProperty("--dashboard-secondary", theme.secondary);
    document.documentElement.style.setProperty("--dashboard-warm", theme.warm);
    document.documentElement.style.setProperty("--dashboard-accent-glow", rgbaFromHex(accent, 0.12));
    document.documentElement.style.setProperty("--dashboard-secondary-glow", rgbaFromHex(theme.secondary, 0.1));
    document.documentElement.style.setProperty("--dashboard-warm-glow", rgbaFromHex(theme.warm, 0.1));
    document.documentElement.style.setProperty("--dashboard-theme-bg", theme.background);
    document.documentElement.style.setProperty("--dashboard-aura-opacity", String(intensity / 100));

    if (document.body) {
      document.body.setAttribute("data-theme", theme.id);
      document.body.classList.toggle("dashboard-native-page--motion-low", intensity > 0 && intensity <= 35);
      document.body.classList.toggle("dashboard-native-page--motion-off", intensity === 0);
    }
  }

  function getParam(name) {
    var value = params.get(name);
    return value == null || value === "" ? "" : value;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setText(nodeId, value) {
    var node = document.getElementById(nodeId);
    if (node) {
      node.textContent = value;
    }
  }

  function setStatus(nodeId, text, tone) {
    var node = document.getElementById(nodeId);
    if (!node) {
      return;
    }
    node.textContent = text;
    if (tone) {
      node.setAttribute("data-tone", tone);
    } else {
      node.removeAttribute("data-tone");
    }
  }

  function formatDashboardError(error) {
    if (!error) {
      return "Unknown dashboard error.";
    }

    if (typeof error === "string") {
      return error;
    }

    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }

    try {
      return JSON.stringify(error);
    } catch (jsonError) {
      return String(error);
    }
  }

  function reportFatalDashboardError(title, error, copy) {
    var detail = formatDashboardError(error);
    var loading = loadingNode || document.getElementById("dashboard-widget-loading");
    var empty = emptyNode || document.getElementById("dashboard-widget-empty");

    console.error(title + ": " + detail, error);

    if (loading) {
      loading.classList.add("is-hidden");
    }

    setStatus("dashboard-origin-status", "Error", "danger");
    setText("dashboard-selection-status", "Dashboard error");
    setText("dashboard-widget-kicker", "Dashboard error");
    setText("dashboard-widget-title", "Dashboard failed");
    setText("dashboard-widget-copy", copy || "The dashboard hit a client-side error while rendering.");
    setText("dashboard-widget-source", "Unavailable");
    setText("dashboard-widget-empty-title", title);
    setText("dashboard-widget-empty-copy", detail);

    if (empty) {
      empty.classList.remove("is-hidden");
    }
  }

  function setQueryParam(name, value) {
    try {
      var nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set(name, value);
      window.history.replaceState({}, "", nextUrl.toString());
    } catch (error) {
      console.warn("Unable to persist query param", error);
    }
  }

  function buildUrl(base, pathname, query) {
    var url = new URL(pathname, base);
    Object.keys(query || {}).forEach(function (key) {
      var value = query[key];
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  function withTimeout(promise, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timerId = window.setTimeout(function () {
        reject(new Error("Request timed out"));
      }, timeoutMs);

      Promise.resolve(promise).then(function (value) {
        window.clearTimeout(timerId);
        resolve(value);
      }, function (error) {
        window.clearTimeout(timerId);
        reject(error);
      });
    });
  }

  function fetchJson(url, timeoutMs) {
    return withTimeout(fetch(url, {
      cache: "no-store"
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Request failed with status " + response.status);
      }
      return response.json();
    }), timeoutMs || 5000);
  }

  function fetchBridgeHealth() {
    return fetchJson(buildUrl(bridgeOrigin, "/api/health"), 5000);
  }

  function fetchBridgeConfig() {
    return fetchJson(buildUrl(bridgeOrigin, "/api/config"), 5000);
  }

  function readStoredSettings() {
    try {
      var raw = window.localStorage.getItem(settingsStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn("Unable to read stored dashboard settings", error);
      return {};
    }
  }

  function readStoredWidget(storageKey) {
    try {
      return window.localStorage.getItem(storageKey) || "";
    } catch (error) {
      return "";
    }
  }

  function persistSettings() {
    try {
      window.localStorage.setItem(settingsStorageKey, JSON.stringify(dashboardSettings));
    } catch (error) {
      console.warn("Unable to persist dashboard settings", error);
    }
  }

  function getDefaultSettingValue(key) {
    if (params.has(key) && params.get(key) !== "") {
      return params.get(key);
    }
    return defaultSettings[key] == null ? "" : defaultSettings[key];
  }

  function buildInitialSettings() {
    storedSettings = readStoredSettings();
    var merged = Object.assign({}, defaultSettings, storedSettings);

    Object.keys(defaultSettings).forEach(function (key) {
      merged[key] = params.has(key) && params.get(key) !== "" ? params.get(key) : (merged[key] == null ? defaultSettings[key] : merged[key]);
    });

    return merged;
  }

  function reloadDashboardSettings() {
    dashboardSettings = buildInitialSettings();
    syncSettingsFromBridgeConfig();
    applyDashboardPresentation();
  }

  function syncSettingsFromBridgeConfig() {
    if (!bridgeConfig || !bridgeConfig.weather) {
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(storedSettings, "city")) {
      dashboardSettings.city = bridgeConfig.weather.city || defaultSettings.city;
    }

    if (!Object.prototype.hasOwnProperty.call(storedSettings, "units")) {
      dashboardSettings.units = bridgeConfig.weather.units || defaultSettings.units;
    }
  }

  function applyWeatherDefaultsFromBridgeConfig() {
    if (!bridgeConfig || !bridgeConfig.weather) {
      return;
    }

    dashboardSettings.city = bridgeConfig.weather.city || defaultSettings.city;
    dashboardSettings.units = bridgeConfig.weather.units || defaultSettings.units;
    storedSettings.city = dashboardSettings.city;
    storedSettings.units = dashboardSettings.units;
    persistSettings();
  }

  function getSetting(key) {
    return dashboardSettings[key] == null ? "" : dashboardSettings[key];
  }

  function hasValue(key) {
    return String(getSetting(key) || "").trim() !== "";
  }

  function hasUniFiCameraConfig() {
    return hasValue("unifiCameraEndpoint") ||
      hasValue("unifiCameraFeed") ||
      hasValue("unifiCameraRelayUrl") ||
      hasValue("unifiCameraSnapshot");
  }

  function getUniFiNetworkEndpoint() {
    return hasValue("unifiNetworkEndpoint")
      ? getSetting("unifiNetworkEndpoint")
      : buildUrl(bridgeOrigin, "/api/unifi/network");
  }

  function isWidgetConfigured(widgetId) {
    if (widgetId === "weather" || widgetId === "hue" || widgetId === "calendar") {
      return getWidgetState(widgetId) !== "Optional";
    }

    if (widgetId === "unifi-camera") {
      return hasUniFiCameraConfig();
    }

    if (widgetId === "unifi-network") {
      return true;
    }

    if (widgetId === "plex") {
      return hasValue("plexEndpoint");
    }

    if (widgetId === "nas") {
      return hasValue("nasEndpoint");
    }

    if (widgetId === "automation") {
      return hasValue("automationEndpoint") || hasValue("automationActionEndpoint");
    }

    return true;
  }

  function getWidgetState(widgetId) {
    if (widgetId === "setup") {
      return (!bridgeSetup.onboardingCompleted || bridgeSetup.needsAttention) ? "Needs Setup" : "Ready";
    }

    if (widgetId === "system" || widgetId === "network" || widgetId === "launchers" || widgetId === "quick-actions" || widgetId === "shortcuts" || widgetId === "audio" || widgetId === "media" || widgetId === "clipboard" || widgetId === "weather" || widgetId === "calendar" || widgetId === "hue") {
      return getSetupItem(widgetId).state;
    }

    if (widgetId === "unifi-network") {
      return getSetupItem("unifi").state || "Built in";
    }

    return isWidgetConfigured(widgetId) ? "Ready" : "Optional";
  }

  function getStateTone(state) {
    if (state === "Ready" || state === "Detected" || state === "Built in") {
      return "good";
    }
    if (state === "Unsupported" || state === "Checking" || state === "Later") {
      return "muted";
    }
    if (state === "Needs Setup") {
      return "warn";
    }
    return "muted";
  }

  function isWidgetSupported(widgetId) {
    if (widgetId === "system") {
      return bridgeCapabilities.system !== false;
    }

    if (widgetId === "network") {
      return bridgeCapabilities.network !== false;
    }

    if (widgetId === "audio") {
      return bridgeCapabilities.audio === true;
    }

    if (widgetId === "launchers") {
      return bridgeCapabilities.launchers === true;
    }

    if (widgetId === "quick-actions") {
      return bridgeCapabilities.quickActions === true;
    }

    if (widgetId === "shortcuts") {
      return bridgeCapabilities.shortcuts === true;
    }

    if (widgetId === "calendar") {
      return bridgeCapabilities.calendar === true;
    }

    if (widgetId === "media") {
      return bridgeCapabilities.media === true;
    }

    if (widgetId === "clipboard") {
      return bridgeCapabilities.clipboard === true;
    }

    if (widgetId === "weather") {
      return bridgeCapabilities.weather === true;
    }

    if (widgetId === "hue") {
      return bridgeCapabilities.hue === true;
    }

    return true;
  }

  function isLocalProductWidget(widgetId) {
    return localProductWidgetIds.indexOf(widgetId) !== -1;
  }

  function parseLayoutOrder() {
    return String(getSetting("layoutOrder") || "")
      .split(",")
      .map(function (item) {
        return item.trim();
      })
      .filter(Boolean);
  }

  function sortWidgetsByLayout(widgetList) {
    var order = parseLayoutOrder();
    if (!order.length) {
      return widgetList;
    }

    return widgetList.slice().sort(function (left, right) {
      var leftIndex = order.indexOf(left.id);
      var rightIndex = order.indexOf(right.id);

      leftIndex = leftIndex === -1 ? 10000 : leftIndex;
      rightIndex = rightIndex === -1 ? 10000 : rightIndex;

      if (leftIndex === rightIndex) {
        return 0;
      }

      return leftIndex - rightIndex;
    });
  }

  function shouldShowWidget(widget) {
    if (widget.id === "setup") {
      return !perfMode && (!bridgeSetup.onboardingCompleted || bridgeSetup.needsAttention);
    }

    if (widget.tier === "product" || isLocalProductWidget(widget.id)) {
      return true;
    }

    if (widget.id === "system" || widget.id === "network") {
      return isWidgetSupported(widget.id);
    }

    if (widget.id === "audio") {
      return isWidgetSupported("audio");
    }

    if (widget.id === "launchers" || widget.id === "quick-actions" || widget.id === "shortcuts" || widget.id === "clipboard") {
      return isWidgetSupported(widget.id);
    }

    if (widget.id === "media") {
      return isWidgetSupported("media");
    }

    if (widget.id === "weather" || widget.id === "hue" || widget.id === "calendar") {
      return isWidgetSupported(widget.id) && getWidgetState(widget.id) !== "Optional";
    }

    if (widget.tier === "advanced") {
      return showAdvanced || isWidgetConfigured(widget.id);
    }

    return true;
  }

  function getVisibleWidgets() {
    return sortWidgetsByLayout(widgets.filter(function (widget) {
      return shouldShowWidget(widget);
    }));
  }

  function getWidgetById(widgetId) {
    return widgets.filter(function (entry) {
      return entry.id === widgetId;
    })[0] || widgets[0];
  }

  function getSchemaForWidget(widgetId) {
    return settingSchemas[widgetId] || null;
  }

  function getWidgetTitle(widget) {
    return typeof widget.getTitle === "function" ? widget.getTitle() : widget.title;
  }

  function getWidgetCopy(widget) {
    return typeof widget.getCopy === "function" ? widget.getCopy() : widget.copy;
  }

  function getWidgetKicker(widget) {
    return typeof widget.getKicker === "function" ? widget.getKicker() : (widget.kicker || "Active widget");
  }

  function getViewerLabel(widget) {
    return typeof widget.getViewerLabel === "function" ? widget.getViewerLabel() : (widget.viewerLabel || "Dashboard");
  }

  function createWidgets() {
    return [
      {
        id: "setup",
        getTitle: function () {
          return bridgeSetup.onboardingCompleted ? "Diagnostics" : "Setup Guide";
        },
        getKicker: function () {
          return bridgeSetup.onboardingCompleted ? "Diagnostics" : "First run";
        },
        getCopy: function () {
          return bridgeSetup.onboardingCompleted
            ? "Bridge health, optional integrations, and repair steps."
            : "Finish the essentials once. Weather and Hue can wait until later.";
        },
        getViewerLabel: function () {
          return (!bridgeSetup.onboardingCompleted || bridgeSetup.needsAttention) ? "Needs Setup" : "Ready";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/setup-guide.html", {
            size: "full",
            rev: assetRevision,
            healthEndpoint: buildUrl(bridgeOrigin, "/api/health"),
            configEndpoint: buildUrl(bridgeOrigin, "/api/config"),
            dashboardConfigEndpoint: buildUrl(bridgeOrigin, "/api/config/dashboard"),
            weatherConfigEndpoint: buildUrl(bridgeOrigin, "/api/config/weather"),
            hueEndpoint: buildUrl(bridgeOrigin, "/api/hue"),
            hueLinkEndpoint: buildUrl(bridgeOrigin, "/api/hue/link"),
            dashboardUrl: buildUrl(bridgeOrigin, "/dashboard.html", { v: assetRevision }),
            advancedUrl: buildUrl(bridgeOrigin, "/dashboard.html", { v: assetRevision, advanced: "1" }),
            onboardingVersion: onboardingVersion
          });
        }
      },
      {
        id: "profiles",
        title: "Profiles",
        tier: "product",
        kicker: "Product layer",
        copy: "Switch the dashboard between gaming, streaming, work, home-lab, and minimal modes.",
        viewerLabel: "Local profile"
      },
      {
        id: "theme-studio",
        title: "Theme Studio",
        tier: "product",
        kicker: "Visual polish",
        copy: "Tune the dashboard theme, accent color, opacity, and animation intensity.",
        viewerLabel: "Local style"
      },
      {
        id: "layout-editor",
        title: "Layout Editor",
        tier: "product",
        kicker: "Control surface",
        copy: "Reorder dashboard panels and save the exact picker flow for the current install.",
        viewerLabel: "Local layout"
      },
      {
        id: "updates",
        title: "Updates",
        tier: "product",
        kicker: "Release channel",
        copy: "Choose a release channel and check the GitHub release feed before shipping.",
        viewerLabel: "GitHub releases"
      },
      {
        id: "streaming",
        title: "Streaming",
        tier: "product",
        kicker: "OBS panel",
        copy: "Keep stream status, scene intent, and OBS connection health on the EDGE.",
        viewerLabel: "Local OBS"
      },
      {
        id: "game-mode",
        title: "Game Mode",
        tier: "product",
        kicker: "Launch mode",
        copy: "Prepare a focused dashboard profile for games, telemetry, audio, and launchers.",
        viewerLabel: "Local preset"
      },
      {
        id: "marketplace",
        title: "Widget Packs",
        tier: "product",
        kicker: "Expansion",
        copy: "Apply curated packs for core telemetry, streaming, creator, and home-lab setups.",
        viewerLabel: "Local packs"
      },
      {
        id: "installer",
        title: "Installer",
        tier: "product",
        kicker: "Packaging",
        copy: "Track the setup EXE, install path, shortcuts, signing, and selling readiness.",
        viewerLabel: "Windows setup"
      },
      {
        id: "privacy",
        title: "Privacy",
        tier: "product",
        kicker: "Trust",
        copy: "Show what stays local, what optional services are used, and reset local settings.",
        viewerLabel: "Local trust"
      },
      {
        id: "system",
        title: "System Monitor",
        copy: "CPU, GPU, RAM, and disk telemetry from the local bridge.",
        getViewerLabel: function () {
          return "Local bridge";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/system-monitor.html", {
            size: "full",
            rev: assetRevision,
            endpoint: buildUrl(bridgeOrigin, "/api/system")
          });
        }
      },
        {
          id: "network",
          title: "Network Monitor",
          copy: "Throughput, ping, and UniFi detection from the local bridge.",
          getViewerLabel: function () {
            return "Local bridge + UniFi";
          },
          buildSrc: function () {
            return buildUrl(widgetBase, "/widgets/network-widget.html", {
              size: "full",
              rev: assetRevision,
              endpoint: buildUrl(bridgeOrigin, "/api/network"),
              unifiEndpoint: getUniFiNetworkEndpoint()
            });
          }
        },
      {
        id: "audio",
        title: "Audio",
        copy: "Switch playback outputs, set master volume, and trim live app sessions from the local bridge.",
        getViewerLabel: function () {
          return "Local bridge";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/audio-output-panel.html", {
            size: "full",
            rev: assetRevision,
            endpoint: buildUrl(bridgeOrigin, "/api/audio"),
            actionBase: buildUrl(bridgeOrigin, "/api/audio")
          });
        }
      },
      {
        id: "media",
        title: "Media",
        copy: "Now playing, artwork, and transport controls for the current Windows media session.",
        getViewerLabel: function () {
          return "Windows session";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/media-session-panel.html", {
            size: "full",
            rev: assetRevision,
            endpoint: buildUrl(bridgeOrigin, "/api/media"),
            actionBase: buildUrl(bridgeOrigin, "/api/media")
          });
        }
      },
      {
        id: "launchers",
        title: "App Launcher",
        copy: "Pinned apps and shortcuts for one-tap launches from the EDGE display.",
        getViewerLabel: function () {
          return getWidgetState("launchers") === "Ready"
            ? (bridgeConfig.launchers && bridgeConfig.launchers.count ? bridgeConfig.launchers.count + " pinned" : "Configured")
            : "Setup";
        }
      },
      {
        id: "quick-actions",
        title: "Quick Actions",
        copy: "Dark mode, Night Light, locking, Task Manager, Settings, and Recycle Bin actions.",
        getViewerLabel: function () {
          return "Windows shell";
        }
      },
      {
        id: "shortcuts",
        title: "System Shortcuts",
        copy: "Power actions, brightness, and do-not-disturb controls for the local PC.",
        getViewerLabel: function () {
          return "Windows shell";
        }
      },
      {
        id: "clipboard",
        title: "Clipboard",
        copy: "Recent clipboard history with one-tap restore.",
        getViewerLabel: function () {
          return "Windows clipboard";
        }
      },
      {
        id: "weather",
        title: "Weather",
        copy: "Current, hourly, and five-day weather from the bridge.",
        getViewerLabel: function () {
          return getWidgetState("weather") === "Optional" ? "Optional" : (getSetting("city") + " / " + getSetting("units"));
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/weather-widget.html", {
            size: "full",
            rev: assetRevision,
            endpoint: buildUrl(bridgeOrigin, "/api/weather", {
              city: getSetting("city"),
              units: getSetting("units")
            })
          });
        }
      },
      {
        id: "calendar",
        title: "Calendar",
        copy: "Upcoming events from the configured ICS feed.",
        getViewerLabel: function () {
          return getWidgetState("calendar") === "Optional" ? "Optional" : "ICS feed";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/calendar-upcoming.html", {
            size: "full",
            rev: assetRevision,
            endpoint: buildUrl(bridgeOrigin, "/api/calendar")
          });
        }
      },
      {
        id: "unifi-camera",
        title: "UniFi Camera",
        tier: "advanced",
        copy: "Full-screen browser relay or snapshot view.",
        getViewerLabel: function () {
          return isWidgetConfigured("unifi-camera") ? "Configured endpoint" : "Optional";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/unifi-camera-viewer.html", {
            size: "full",
            rev: assetRevision,
            endpoint: getSetting("unifiCameraEndpoint"),
            feed: getSetting("unifiCameraFeed"),
            relayUrl: getSetting("unifiCameraRelayUrl"),
            snapshot: getSetting("unifiCameraSnapshot"),
            name: getSetting("unifiCameraName"),
            location: getSetting("unifiCameraLocation"),
            feedType: getSetting("unifiCameraFeedType")
          });
        }
      },
      {
        id: "unifi-network",
        title: "UniFi Network",
          tier: "advanced",
          copy: "Gateway, WAN trends, AP health, clients, and app activity.",
          getViewerLabel: function () {
            return hasValue("unifiNetworkEndpoint") ? "Custom endpoint" : "Built in";
          },
          buildSrc: function () {
            return buildUrl(widgetBase, "/widgets/unifi-network-dashboard.html", {
              size: "full",
              rev: assetRevision,
              endpoint: getUniFiNetworkEndpoint()
            });
          }
        },
      {
        id: "plex",
        title: "Plex Server",
        tier: "advanced",
        copy: "Active streams, bandwidth load, and transcode pressure.",
        getViewerLabel: function () {
          return isWidgetConfigured("plex") ? "Configured endpoint" : "Optional";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/plex-server-monitor.html", {
            size: "full",
            rev: assetRevision,
            endpoint: getSetting("plexEndpoint"),
            uplink: getSetting("plexUplink")
          });
        }
      },
      {
        id: "nas",
        title: "NAS Storage",
        tier: "advanced",
        copy: "Pool usage, drive health, and temperatures.",
        getViewerLabel: function () {
          return isWidgetConfigured("nas") ? "Configured endpoint" : "Optional";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/nas-storage-monitor.html", {
            size: "full",
            rev: assetRevision,
            endpoint: getSetting("nasEndpoint")
          });
        }
      },
      {
        id: "automation",
        title: "Home Automation",
        tier: "advanced",
        copy: "Touch controls for lights, switches, and scenes.",
        getViewerLabel: function () {
          return isWidgetConfigured("automation") ? "Configured endpoint" : "Optional";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/home-automation-panel.html", {
            size: "full",
            rev: assetRevision,
            endpoint: getSetting("automationEndpoint"),
            actionEndpoint: getSetting("automationActionEndpoint")
          });
        }
      },
      {
        id: "hue",
        title: "Philips Hue",
        copy: "Direct local light control with compact bridge diagnostics.",
        getViewerLabel: function () {
          return bridgeConfig.hue.linked ? "Local bridge" : "Optional";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/philips-hue-panel.html", {
            size: "full",
            rev: assetRevision,
            endpoint: buildUrl(bridgeOrigin, "/api/hue"),
            linkEndpoint: buildUrl(bridgeOrigin, "/api/hue/link"),
            actionBase: buildUrl(bridgeOrigin, "/api/hue")
          });
        }
      }
    ];
  }

  function renderPicker() {
    pickerNode.innerHTML = getVisibleWidgets().map(function (widget) {
      var activeClass = widget.id === currentWidgetId ? " is-active" : "";
      var state = getWidgetState(widget.id);
      return '' +
        '<button class="router-picker__button' + activeClass + '" data-widget-id="' + widget.id + '" title="' + escapeHtml(getWidgetCopy(widget)) + '">' +
          '<span class="router-picker__title">' + escapeHtml(getWidgetTitle(widget)) + '</span>' +
          '<span class="router-picker__meta" data-state="' + escapeHtml(state.toLowerCase().replace(/\s+/g, "-")) + '">' + escapeHtml(state) + '</span>' +
        '</button>';
    }).join("");

    pickerNode.querySelectorAll("[data-widget-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectWidget(button.getAttribute("data-widget-id"), true);
      });
    });
  }

  function widgetRequiresBridge(widget) {
    return widget.id === "setup"
      || widget.id === "system"
      || widget.id === "network"
      || widget.id === "audio"
      || widget.id === "media"
      || widget.id === "weather"
      || widget.id === "calendar"
      || widget.id === "hue";
  }

  function clearInlineWidget() {
    if (inlineWidgetController && typeof inlineWidgetController.destroy === "function") {
      inlineWidgetController.destroy();
    }

    inlineWidgetController = null;
    activeInlineWidgetId = "";

    if (inlineViewerNode) {
      inlineViewerNode.classList.add("is-hidden");
      inlineViewerNode.innerHTML = "";
    }
  }

  function saveDashboardSettings(values) {
    Object.keys(values || {}).forEach(function (key) {
      dashboardSettings[key] = String(values[key] || "");
      storedSettings[key] = dashboardSettings[key];
    });

    persistSettings();
    applyDashboardPresentation();
    widgets = createWidgets();

    var currentWidget = getWidgetById(currentWidgetId || "system");
    updateWidgetMeta(currentWidget);
    renderPicker();
    renderDiagnostics();
    renderSettings(currentWidget);
  }

  function resetLocalDashboardSettings() {
    storedSettings = {};
    dashboardSettings = Object.assign({}, defaultSettings);
    persistSettings();
    applyDashboardPresentation();
    widgets = createWidgets();
    renderPicker();
    renderDiagnostics();
    renderSettings(getWidgetById(currentWidgetId || "privacy"));
  }

  function summarizeInlineWidget(widget) {
    return {
      id: widget.id,
      title: getWidgetTitle(widget),
      copy: getWidgetCopy(widget),
      state: getWidgetState(widget.id),
      tier: widget.tier || "core",
      requiresBridge: widgetRequiresBridge(widget)
    };
  }

  function handleInlineSetupUpdate(kind) {
    return refreshBridgeState({
      forceWeatherDefaults: kind === "weather",
      moveOffSetup: kind === "dashboard",
      reloadLocalSettings: kind === "local-settings"
    });
  }

  function buildInlineWidgetEnv() {
    return {
      bridgeOrigin: bridgeOrigin,
      assetRevision: assetRevision,
      onboardingVersion: onboardingVersion,
      bridgeSetup: bridgeSetup,
      bridgeConfig: bridgeConfig,
      getSetting: getSetting,
      getSettings: function () {
        return Object.assign({}, dashboardSettings);
      },
      getVisibleWidgets: function () {
        return getVisibleWidgets().map(summarizeInlineWidget);
      },
      productThemes: productThemePresets.slice(),
      saveSettings: saveDashboardSettings,
      resetSettings: resetLocalDashboardSettings,
      selectWidget: selectWidget,
      handleSetupUpdate: handleInlineSetupUpdate
    };
  }

  function showInlineWidget(widget, reloadView) {
    if (!inlineViewerNode) {
      return;
    }

    var shouldRemount = reloadView !== false
      || activeInlineWidgetId !== widget.id
      || !inlineWidgetController;

    loadingNode.classList.add("is-hidden");
    emptyNode.classList.add("is-hidden");

    if (shouldRemount) {
      clearInlineWidget();
      inlineViewerNode.classList.remove("is-hidden");
      inlineViewerNode.scrollTop = 0;

      if (!window.InlineWidgets || typeof window.InlineWidgets.mountWidget !== "function") {
        showFrameEmpty(
          "Inline runtime unavailable",
          "The inline widget runtime could not be loaded. Reload the dashboard to restore native rendering."
        );
        return;
      }

      try {
        inlineWidgetController = window.InlineWidgets.mountWidget(widget, inlineViewerNode, buildInlineWidgetEnv());
        activeInlineWidgetId = widget.id;
      } catch (error) {
        reportFatalDashboardError(
          "Inline widget failed",
          error,
          "The selected widget crashed while mounting."
        );
      }
      return;
    }

    inlineViewerNode.classList.remove("is-hidden");
    if (inlineWidgetController && typeof inlineWidgetController.refresh === "function") {
      try {
        inlineWidgetController.refresh();
      } catch (error) {
        reportFatalDashboardError(
          "Inline widget refresh failed",
          error,
          "The selected widget crashed while refreshing."
        );
      }
    }
  }

  function showFrameEmpty(title, copy) {
    clearInlineWidget();
    loadingNode.classList.add("is-hidden");
    setText("dashboard-widget-empty-title", title);
    setText("dashboard-widget-empty-copy", copy);
    emptyNode.classList.remove("is-hidden");
  }

  function updateWidgetMeta(widget) {
    setText("dashboard-widget-kicker", getWidgetKicker(widget));
    setText("dashboard-widget-title", getWidgetTitle(widget));
    setText("dashboard-widget-copy", getWidgetCopy(widget));
    setText("dashboard-widget-source", getViewerLabel(widget));
    setText("dashboard-selection-status", "Selected: " + getWidgetTitle(widget));
  }

  function setRailCopy() {
    var copy = !bridgeSetup.onboardingCompleted
      ? "Finish the essentials once. Optional integrations stay tucked away until you need them."
      : bridgeSetup.needsAttention
        ? "System and Network stay available. Diagnostics is promoted only when something needs attention."
        : "System and Network stay front and center. Diagnostics remains available if anything changes.";

    if (showAdvanced) {
      copy = "Advanced mode is open. Core widgets stay visible while optional and advanced panels can be configured.";
    }

    setText("dashboard-rail-copy", copy);
  }

  function renderDiagnostics() {
    if (perfMode) {
      diagnosticsInlineNode.classList.add("is-hidden");
      diagnosticsRailNode.classList.add("is-hidden");
      diagnosticsInlineNode.classList.remove("is-active");
      diagnosticsRailNode.classList.remove("is-active");
      setRailCopy();
      return;
    }

    var needsSetup = bridgeReachable === false || !bridgeSetup.onboardingCompleted || bridgeSetup.needsAttention;
    var summary = bridgeReachable === false
      ? "Bridge is offline."
      : !bridgeSetup.onboardingCompleted
        ? "Finish bridge, system, and network once."
        : bridgeSetup.needsAttention
          ? "Something needs attention."
          : "Open Diagnostics if something breaks.";

    diagnosticsInlineNode.textContent = needsSetup ? "Diagnostics" : "Open Diagnostics";
    diagnosticsInlineNode.setAttribute("data-tone", needsSetup ? "warn" : "good");
    diagnosticsInlineNode.classList.toggle("is-active", currentWidgetId === "setup");

    diagnosticsRailNode.classList.toggle("is-hidden", !needsSetup);
    diagnosticsRailNode.classList.toggle("is-active", currentWidgetId === "setup");
    diagnosticsRailNode.setAttribute("data-state", needsSetup ? "needs-setup" : "ready");
    setText("dashboard-diagnostics-rail-state", needsSetup ? "Needs Setup" : "Ready");
    setText("dashboard-diagnostics-rail-copy", summary);
    setRailCopy();
  }

  function renderNoSettingsCopy(widget) {
    if (widget.id === "setup") {
      return "Diagnostics covers first-run setup, bridge health, and repairs.";
    }

    if (widget.id === "system" || widget.id === "network" || widget.id === "audio" || widget.id === "media") {
      return "This widget is ready without extra dashboard settings.";
    }

    if (widget.id === "launchers" || widget.id === "quick-actions" || widget.id === "shortcuts" || widget.id === "clipboard") {
      return "This widget manages its own native settings and actions directly inside the panel.";
    }

    if (widget.id === "calendar") {
      return "Use Diagnostics to set or repair the ICS calendar feed.";
    }

    if (widget.id === "hue") {
      return "Use Diagnostics to link or repair the Hue bridge.";
    }

    if (widget.tier === "product" || isLocalProductWidget(widget.id)) {
      return "This product panel stores its choices locally and works even when the bridge is offline.";
    }

    return "This widget uses bridge defaults and does not need local dashboard settings.";
  }

  function renderGlobalSettings() {
    var opacity = getDashboardOpacityPercent();
    return '' +
      '<section class="router-settings__global">' +
        '<div class="router-settings__global-head">' +
          '<div>' +
            '<div class="router-settings__global-title">Display opacity</div>' +
            '<div class="router-settings__global-copy">Lower this to see through the dashboard while keeping controls usable.</div>' +
          '</div>' +
          '<div id="dashboard-opacity-value" class="router-settings__global-value">' + opacity + '%</div>' +
        '</div>' +
        '<input id="dashboard-opacity-slider" class="router-settings__slider" type="range" min="35" max="100" step="1" value="' + opacity + '">' +
        '<div class="router-settings__global-actions">' +
          '<button id="dashboard-opacity-reset" class="router-settings__button" type="button">Reset opacity</button>' +
        '</div>' +
      '</section>';
  }

  function bindGlobalSettings() {
    var slider = document.getElementById("dashboard-opacity-slider");
    var valueNode = document.getElementById("dashboard-opacity-value");
    var resetButton = document.getElementById("dashboard-opacity-reset");

    function updateOpacity(nextValue, persistValue) {
      var normalized = normalizeOpacityPercent(nextValue);
      dashboardSettings.dashboardOpacity = String(normalized);
      slider.value = String(normalized);
      valueNode.textContent = normalized + "%";
      applyDashboardOpacity();
      if (persistValue) {
        persistSettings();
      }
    }

    if (slider && valueNode) {
      slider.addEventListener("input", function () {
        updateOpacity(slider.value, false);
      });

      slider.addEventListener("change", function () {
        updateOpacity(slider.value, true);
      });
    }

    if (resetButton) {
      resetButton.addEventListener("click", function () {
        updateOpacity(defaultSettings.dashboardOpacity, true);
      });
    }
  }

  function renderSettings(widget) {
    if (perfMode) {
      settingsNode.innerHTML = '<div class="router-settings__note">Display mode keeps the EDGE surface lean. Use the tray icon or <code>?advanced=1</code> for full configuration.</div>';
      return;
    }

    var schema = getSchemaForWidget(widget.id);
    var widgetState = getWidgetState(widget.id);

    setText("dashboard-settings-title", schema ? schema.title : "Widget settings");
    setText("dashboard-settings-copy", schema ? schema.copy : renderNoSettingsCopy(widget));
    setStatus("dashboard-config-status", widgetState, getStateTone(widgetState));

    if (!schema) {
      settingsNode.innerHTML = '' +
        renderGlobalSettings() +
        '<div class="router-settings__empty">' +
          '<div class="router-settings__note">' + escapeHtml(renderNoSettingsCopy(widget)) + '</div>' +
          (showAdvanced ? '' : '<div class="router-settings__note">Advanced panels stay hidden until they are useful. Built-in connectors appear automatically when Xenon can detect them.</div>') +
        '</div>';
      bindGlobalSettings();
      return;
    }

    if (!schema.fields.length) {
      settingsNode.innerHTML = '' +
        renderGlobalSettings() +
        '<div class="router-settings__empty">' +
          '<div class="router-settings__note">' + escapeHtml(schema.copy) + '</div>' +
        '</div>';
      bindGlobalSettings();
      return;
    }

    settingsNode.innerHTML = '' +
      renderGlobalSettings() +
      '<form id="dashboard-settings-form" class="router-settings__form">' +
        '<div class="router-settings__grid">' +
          schema.fields.map(function (field) {
            var value = getSetting(field.key);
            var inputHtml = field.type === "select"
              ? '<select name="' + field.key + '">' +
                  field.options.map(function (option) {
                    var selected = option.value === value ? ' selected' : '';
                    return '<option value="' + escapeHtml(option.value) + '"' + selected + '>' + escapeHtml(option.label) + '</option>';
                  }).join("") +
                '</select>'
              : '<input type="' + (field.type || "text") + '" name="' + field.key + '" value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(field.placeholder || "") + '">';

            return '' +
              '<label class="router-settings__field">' +
                '<span>' + escapeHtml(field.label) + '</span>' +
                inputHtml +
                (field.help ? '<small class="router-settings__field-help">' + escapeHtml(field.help) + '</small>' : "") +
              '</label>';
          }).join("") +
        '</div>' +
        '<div class="router-settings__actions">' +
          '<button class="router-settings__button is-primary" type="submit">Save settings</button>' +
          '<button id="dashboard-settings-reset" class="router-settings__button" type="button">Reset section</button>' +
        '</div>' +
        '<div class="router-settings__note">Saved locally in this browser for the real-time dashboard.</div>' +
      '</form>';

    bindGlobalSettings();
    bindSettingsForm(widget, schema);
  }

  function bindSettingsForm(widget, schema) {
    var form = document.getElementById("dashboard-settings-form");
    var resetButton = document.getElementById("dashboard-settings-reset");

    if (!form || !resetButton) {
      return;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var formData = new FormData(form);

      schema.fields.forEach(function (field) {
        dashboardSettings[field.key] = String(formData.get(field.key) || "");
      });

      persistSettings();
      renderPicker();
      selectWidget(widget.id, false);
    });

    resetButton.addEventListener("click", function () {
      schema.fields.forEach(function (field) {
        dashboardSettings[field.key] = getDefaultSettingValue(field.key);
      });

      persistSettings();
      renderPicker();
      selectWidget(widget.id, false);
    });
  }

  function renderCurrentSelection(reloadFrame) {
    var widget = getWidgetById(currentWidgetId || "system");
    if (!shouldShowWidget(widget) || (perfMode && widget.id === "setup")) {
      currentWidgetId = getFallbackPrimaryWidget();
      widget = getWidgetById(currentWidgetId || "system");
    }

    updateWidgetMeta(widget);
    renderPicker();
    renderDiagnostics();
    renderSettings(widget);

    if (bridgeReachable === false && widgetRequiresBridge(widget) && widgetBase === bridgeOrigin) {
      showFrameEmpty(
        "Local bridge unavailable",
        "The widget shell points at " + bridgeOrigin + ", but the localhost bridge is not responding. Start it, then retry."
      );
      setStatus("dashboard-origin-status", "Needs Setup", "warn");
      return;
    }

    setStatus("dashboard-origin-status", bridgeReachable === false ? "Needs Setup" : "Ready", bridgeReachable === false ? "warn" : "good");
    showInlineWidget(widget, reloadFrame);
  }

  function persistWidgetChoice(widgetId) {
    try {
      window.localStorage.setItem(widgetStorageKey, widgetId);
      if (widgetId !== "setup") {
        window.localStorage.setItem(lastPrimaryWidgetStorageKey, widgetId);
      }
    } catch (error) {
      console.warn("Unable to persist dashboard selection", error);
    }
  }

  function getFallbackPrimaryWidget() {
    var storedLastPrimary = readStoredWidget(lastPrimaryWidgetStorageKey);
    var storedWidget = readStoredWidget(widgetStorageKey);
    var candidates = [storedLastPrimary, storedWidget, "system"];
    var visibleIds = getVisibleWidgets().map(function (widget) {
      return widget.id;
    });

    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index];
      if (candidate && candidate !== "setup" && visibleIds.indexOf(candidate) !== -1) {
        return candidate;
      }
    }

    return visibleIds[0] || "system";
  }

  function resolveInitialWidget(preferredWidgetId, explicitWidgetParam) {
    var preferredWidget = getWidgetById(preferredWidgetId || "system");

    if (explicitWidgetParam) {
      return shouldShowWidget(preferredWidget) ? preferredWidget.id : getFallbackPrimaryWidget();
    }

    if (!perfMode && !bridgeSetup.onboardingCompleted) {
      return "setup";
    }

    return getFallbackPrimaryWidget();
  }

  function selectWidget(widgetId, persistSelection) {
    currentWidgetId = getWidgetById(widgetId).id;
    renderCurrentSelection(true);

    if (persistSelection) {
      persistWidgetChoice(currentWidgetId);
      setQueryParam("widget", currentWidgetId);
    }
  }

  function showLocalhostWarning(widgetId) {
    var widget = getWidgetById(widgetId);
    document.getElementById("dashboard-bridge-warning").classList.remove("is-hidden");
    currentWidgetId = widget.id;
    renderPicker();
    renderDiagnostics();
    renderSettings(widget);
    setStatus("dashboard-origin-status", "Needs Setup", "warn");
    setText("dashboard-selection-status", "Bridge blocked by HTTPS");
    setText("dashboard-widget-kicker", "Localhost required");
    setText("dashboard-widget-title", "Localhost required");
    setText("dashboard-widget-copy", "Open the dashboard from the localhost bridge to load live widgets.");
    setText("dashboard-widget-source", "Unavailable");
    showFrameEmpty(
      "Localhost required",
      "Live widgets are blocked from an HTTPS page when the bridge is HTTP on localhost. Open the localhost dashboard URL instead."
    );
  }

  function applyBridgeState(health, configSnapshot) {
    bridgeCapabilities = Object.assign({}, bridgeCapabilities, (health && health.capabilities) || {});
    bridgeConfig = Object.assign({}, bridgeConfig, configSnapshot || {});

    if (!bridgeConfig.weather) {
      bridgeConfig.weather = {
        configured: false,
        city: defaultSettings.city,
        units: defaultSettings.units
      };
    }

    if (!bridgeConfig.calendar) {
      bridgeConfig.calendar = {
        configured: false,
        icsUrl: ""
      };
    }

    if (!bridgeConfig.hue) {
      bridgeConfig.hue = {
        bridgeIp: "",
        configured: false,
        linked: false
      };
    }

    if (!bridgeConfig.dashboard) {
      bridgeConfig.dashboard = {
        onboardingCompleted: false,
        onboardingCompletedAt: "",
        onboardingVersion: onboardingVersion
      };
    }

    bridgeSetup = health && health.setup ? health.setup : createBootSetupSummary();
    syncSettingsFromBridgeConfig();
  }

  function handleBridgeOffline() {
    var widget = getWidgetById(currentWidgetId || "system");
    currentWidgetId = widget.id;
    bridgeReachable = false;
    bridgeSetup = createOfflineSetupSummary();

    if (!widgetRequiresBridge(widget)) {
      renderCurrentSelection(true);
      return;
    }

    updateWidgetMeta(widget);
    renderPicker();
    renderDiagnostics();
    renderSettings(widget);
    setStatus("dashboard-origin-status", "Needs Setup", "warn");
    setText("dashboard-selection-status", "Diagnostics available");
    setText("dashboard-widget-source", "Unavailable");
    showFrameEmpty(
      "Local bridge unavailable",
      "Start the local bridge and retry. Diagnostics stays available so you can see what is missing."
    );
  }

  function refreshBridgeState(options) {
    var settings = options || {};
    var wasReachable = bridgeReachable;
    var shouldReloadFrame = true;

    return Promise.all([
      fetchBridgeHealth(),
      fetchBridgeConfig()
    ]).then(function (results) {
      var nextBridgeSnapshotKey = JSON.stringify(results);
      var bridgeStateChanged = nextBridgeSnapshotKey !== lastBridgeSnapshotKey || wasReachable !== true;

      lastBridgeSnapshotKey = nextBridgeSnapshotKey;
      bridgeReachable = true;
      applyBridgeState(results[0], results[1]);

      if (settings.forceWeatherDefaults) {
        applyWeatherDefaultsFromBridgeConfig();
      }

      if (settings.reloadLocalSettings) {
        reloadDashboardSettings();
      }

      if (settings.resolveInitialWidget) {
        currentWidgetId = resolveInitialWidget(settings.preferredWidgetId, settings.explicitWidgetParam);
        persistWidgetChoice(currentWidgetId);
      } else if (settings.moveOffSetup && currentWidgetId === "setup" && bridgeSetup.onboardingCompleted) {
        currentWidgetId = getFallbackPrimaryWidget();
        persistWidgetChoice(currentWidgetId);
      }

      if (!bridgeStateChanged
        && settings.skipFrameReload
        && settings.resolveInitialWidget !== true
        && settings.moveOffSetup !== true
        && settings.forceWeatherDefaults !== true
        && settings.reloadLocalSettings !== true) {
        return;
      }

      shouldReloadFrame = !(settings.skipFrameReload && wasReachable === true);
      updateWidgetMeta(getWidgetById(currentWidgetId || "system"));
      renderCurrentSelection(shouldReloadFrame);
    }, function () {
      handleBridgeOffline();
    });
  }

  function checkBridgeAndRender(preferredWidgetId, explicitWidgetParam) {
    setStatus("dashboard-origin-status", "Loading", "warn");
    currentWidgetId = resolveInitialWidget(preferredWidgetId, explicitWidgetParam);
    return refreshBridgeState({
      resolveInitialWidget: true,
      preferredWidgetId: preferredWidgetId,
      explicitWidgetParam: explicitWidgetParam
    });
  }

  window.addEventListener("error", function (event) {
    if (event && event.target && event.target !== window) {
      console.warn("Dashboard asset failed to load", event.target.src || event.target.href || event.target.tagName || "asset");
      return;
    }

    reportFatalDashboardError(
      "Dashboard runtime error",
      event && (event.error || event.message),
      "The dashboard hit a client-side exception."
    );
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    reportFatalDashboardError(
      "Dashboard promise rejected",
      event ? event.reason : "Unknown promise rejection",
      "An async dashboard task failed."
    );
  });

  document.addEventListener("DOMContentLoaded", function () {
    try {
      var explicitWidgetParam = params.has("widget") && params.get("widget") !== "";
      var preferredWidgetId = getParam("widget") || readStoredWidget(widgetStorageKey) || "";

      pickerNode = document.getElementById("dashboard-widget-picker");
      inlineViewerNode = document.getElementById("dashboard-inline-widget");
      loadingNode = document.getElementById("dashboard-widget-loading");
      settingsNode = document.getElementById("dashboard-widget-settings");
      emptyNode = document.getElementById("dashboard-widget-empty");
      retryNode = document.getElementById("dashboard-widget-retry");
      diagnosticsRailNode = document.getElementById("dashboard-diagnostics-rail");
      diagnosticsInlineNode = document.getElementById("dashboard-diagnostics-inline");
      document.body.classList.toggle("dashboard-native-page--perf", perfMode);
      dashboardSettings = buildInitialSettings();
      widgets = createWidgets();
      applyDashboardPresentation();

      setScale();
      initAmbientGraphics();

      retryNode.addEventListener("click", function () {
        refreshBridgeState({ moveOffSetup: false });
      });

      diagnosticsRailNode.addEventListener("click", function () {
        selectWidget("setup", false);
      });

      diagnosticsInlineNode.addEventListener("click", function () {
        selectWidget("setup", false);
      });

      setStatus("dashboard-origin-status", "Loading", "warn");
      setText("dashboard-selection-status", "Preparing dashboard");
      setRailCopy();
      renderPicker();
      renderDiagnostics();

      if (isLocalBridgeBlockedByPageOrigin()) {
        showLocalhostWarning(preferredWidgetId || "system");
        window.addEventListener("resize", setScale);
        return;
      }

      checkBridgeAndRender(preferredWidgetId, explicitWidgetParam).catch(function (error) {
        reportFatalDashboardError(
          "Dashboard boot failed",
          error,
          "The dashboard could not finish starting."
        );
      });

      window.setInterval(function () {
        refreshBridgeState({
          skipFrameReload: true
        }).catch(function (error) {
          reportFatalDashboardError(
            "Dashboard refresh failed",
            error,
            "A background dashboard refresh crashed."
          );
        });
      }, 30000);

      window.addEventListener("resize", setScale);
    } catch (error) {
      reportFatalDashboardError(
        "Dashboard boot failed",
        error,
        "The dashboard could not finish starting."
      );
    }
  });
}());
