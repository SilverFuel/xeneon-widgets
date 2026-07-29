(function () {
  var params = new URLSearchParams(window.location.search);
  var bridgeOrigin = params.get("bridge") || "http://127.0.0.1:8976";
  var widgetBase = params.get("widgetBase") || bridgeOrigin;
  var perfMode = params.get("perf") === "1";
  var assetRevision = params.get("v") || "";
  var onboardingVersion = 1;
  var showAdvanced = params.get("advanced") === "1";
  var stageWidth = 2560;
  var stageHeight = 720;
  var widgetStorageKey = "xeneon-dashboard-widget";
  var lastPrimaryWidgetStorageKey = "xeneon-dashboard-last-widget";
  var primaryDestinationStorageKey = "auxora-dashboard-destination";
  var settingsStorageKey = "xeneon-dashboard-settings";
  var pickerNode = null;
  var inlineViewerNode = null;
  var loadingNode = null;
  var settingsNode = null;
  var emptyNode = null;
  var retryNode = null;
  var diagnosticsRailNode = null;
  var diagnosticsInlineNode = null;
  var settingsPanelNode = null;
  var settingsToggleNode = null;
  var touchLockToggleNode = null;
  var touchUnlockNode = null;
  var launcherDockNode = null;
  var nowStripNode = null;
  var touchFeedbackNode = null;
  var primaryNavNode = null;
  var quickDrawerNode = null;
  var quickToggleNode = null;
  var primaryDestination = "home";
  var inlineWidgetController = null;
  var activeInlineWidgetId = "";
  var lastBridgeSnapshotKey = "";
  var currentWidgetId = "";
  var gameActivity = null;
  var gameFacePreviousWidgetId = "";
  var gameFaceLastActiveId = "";
  var gameFaceAutoOpenedGameId = "";
  var gameFaceSuppressedGameId = "";
  var pendingGameFaceAutoOpenId = "";
  var pendingGameFaceTimerId = 0;
  var dashboardInteractionActive = false;
  var dashboardInteractionTimerId = 0;
  var fatalDashboardReloadTimerId = 0;
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
    unifi: true,
    gameActivity: false
  };
  var bridgeConfig = {
    weather: {
      configured: false,
      city: "",
      units: "metric"
    },
    calendar: {
      configured: false,
      icsUrlConfigured: false,
      icsHost: ""
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
    unifi: {
      configured: false,
      linked: false,
      host: "",
      site: "default"
    },
    dashboard: {
      onboardingCompleted: false,
      onboardingCompletedAt: "",
      onboardingVersion: onboardingVersion,
      launcherReviewRequired: true,
      autoApplyLauncherSuggestions: false,
      foregroundAppTrackingEnabled: false,
      preferredDisplayId: "",
      preferredDisplayDeviceName: "",
      performanceBudget: "balanced",
      gameModeAutoTune: true,
      themeReadability: "normal",
      releaseChannel: "stable",
      updateRollbackEnabled: true
    },
    scenes: {
      activeSceneId: "scene-work",
      automationEnabled: true,
      profiles: []
    }
  };
  var bridgeSetup = createBootSetupSummary();
  var settingsDrawerOpen = false;
  var touchFeedbackTimerId = 0;
  var updateAvailabilityChecked = false;
  var lastSceneEvaluationAt = 0;
  var nowStripTimerId = 0;
  var launcherDockTimerId = 0;
  var launcherDockEntries = [];
  var launcherDockSnapshotKey = "";
  var launcherDockRenderKey = "";
  var launcherDockLaunchingId = "";
  var launcherDockExpanded = false;
  var defaultSettings = {
    dashboardOpacity: "100",
    profileId: "command",
    themeId: "edge",
    animationIntensity: "25",
    accentColor: "",
    touchLockMode: "0",
    layoutOrder: "",
    pinnedWidgets: "",
    hiddenWidgets: "",
    cardSizes: "{}",
    gameModeProfile: "custom",
    gameModeGame: "",
    gameModeThemeId: "",
    gameModeAccent: "",
    gameModeSecondary: "",
    gameModeMood: "",
    performanceBudget: "balanced",
    gameModeAutoTune: "1",
    gameModeAutoFace: "1",
    themeReadability: "normal",
    releaseChannel: "stable",
    updateChannel: "stable",
    updateNotifications: "0",
    city: "",
    units: "metric",
    unifiNetworkEndpoint: ""
  };
  var settingSchemas = {
    weather: {
      title: "Weather",
      copy: "Optional city and units for the weather widget.",
      fields: [
        {
          key: "city",
          label: "City",
          placeholder: "City or ZIP",
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
    "unifi-network": {
      title: "UniFi Network",
      copy: "Folded into Network Monitor with local UniFi linking.",
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
      copy: "High-energy cyan, green, and amber motion for an Auxora touch panel."
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
  var localProductWidgetIds = ["game-mode"];

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
        launchers: createSetupItem("Recent apps", "Needs Setup", false, "Waiting for the bridge."),
        "quick-actions": createSetupItem("Quick Actions", "Needs Setup", false, "Waiting for the bridge."),
        shortcuts: createSetupItem("System Shortcuts", "Needs Setup", false, "Waiting for the bridge."),
        audio: createSetupItem("Audio & Media", "Needs Setup", false, "Waiting for the bridge."),
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
        display: createSetupItem("Auxora display", "Needs Setup", true, "Start the local bridge to choose a touch display."),
        system: createSetupItem("System Monitor", "Needs Setup", true, "System telemetry depends on the local bridge."),
        network: createSetupItem("Network Monitor", "Needs Setup", true, "Network telemetry depends on the local bridge."),
        launchers: createSetupItem("Recent apps", "Needs Setup", false, "App launching depends on the local bridge."),
        "quick-actions": createSetupItem("Quick Actions", "Needs Setup", false, "Quick actions depend on the local bridge."),
        shortcuts: createSetupItem("System Shortcuts", "Needs Setup", false, "System shortcuts depend on the local bridge."),
        audio: createSetupItem("Audio & Media", "Needs Setup", false, "Audio and media controls depend on the local bridge."),
        clipboard: createSetupItem("Clipboard History", "Needs Setup", false, "Clipboard history depends on the local bridge."),
        calendar: createSetupItem("Calendar", bridgeConfig.calendar && bridgeConfig.calendar.configured ? "Needs Setup" : "Optional", false, bridgeConfig.calendar && bridgeConfig.calendar.configured ? "Calendar was configured before. Start the bridge, then re-check it." : "Add an ICS feed if you want the Calendar widget."),
        weather: createSetupItem("Weather", bridgeConfig.weather && bridgeConfig.weather.configured ? "Needs Setup" : "Optional", false, bridgeConfig.weather && bridgeConfig.weather.configured ? "Weather was configured before. Start the bridge, then re-check it." : "Add an OpenWeather key if you want the Weather widget."),
        hue: createSetupItem("Philips Hue", bridgeConfig.hue && bridgeConfig.hue.configured ? "Needs Setup" : "Optional", false, bridgeConfig.hue && bridgeConfig.hue.configured ? "Hue was configured before. Start the bridge, then re-check it." : "Link your Hue Bridge only if you want local lighting controls."),
        unifi: createSetupItem("UniFi Network", "Checking", false, "Auxora checks for UniFi in the background.")
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
    var profile = window.AuxoraLayout.classifyViewport(window.innerWidth, window.innerHeight);
    var browserLayout = !perfMode && profile.browser;

    if (document.body) {
      document.body.classList.toggle("dashboard-native-page--browser", browserLayout);
      document.body.classList.toggle("dashboard-native-page--adaptive", !perfMode);
      document.body.classList.toggle("dashboard-native-page--layout-compact", profile.compact);
      document.body.classList.toggle("dashboard-native-page--layout-portrait", profile.portrait);
      document.body.classList.toggle("dashboard-native-page--layout-ultrawide", profile.ultrawide);
      document.body.dataset.layoutClass = profile.layoutClass;
    }

    if (!perfMode) {
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
    var ambientGraphicsEnabled = getPerformanceBudget() !== "battery" && getAnimationIntensityPercent() > 0;

    if (!ambientGraphicsEnabled && canvas) {
      canvas.style.display = "none";
      return;
    }

    if (!canvas || !shell || perfMode || reducedMotion || getAnimationIntensityPercent() === 0) {
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

  function normalizeChoice(value, fallback, allowed) {
    var normalized = String(value || "").trim().toLowerCase();
    return allowed.indexOf(normalized) >= 0 ? normalized : fallback;
  }

  function getPerformanceBudget() {
    return normalizeChoice(getSetting("performanceBudget"), "balanced", ["balanced", "battery", "game", "max"]);
  }

  function getThemeReadability() {
    return normalizeChoice(getSetting("themeReadability"), "normal", ["normal", "clean", "high-contrast", "visor"]);
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
    var gameAccent = hasValue("gameModeGame") ? parseHexColor(getSetting("gameModeAccent")) : null;
    var gameSecondary = hasValue("gameModeGame") ? parseHexColor(getSetting("gameModeSecondary")) : null;
    var accent = gameAccent || parseHexColor(getSetting("accentColor")) || theme.accent;
    var secondary = gameSecondary || theme.secondary;
    var intensity = getAnimationIntensityPercent();
    var budget = getPerformanceBudget();
    var readability = getThemeReadability();
    var effectiveIntensity = intensity;

    if (budget === "battery") {
      effectiveIntensity = Math.min(effectiveIntensity, 18);
    } else if (budget === "game") {
      effectiveIntensity = Math.min(effectiveIntensity, 32);
    }

    applyDashboardOpacity();
    document.documentElement.style.setProperty("--color-accent", accent);
    document.documentElement.style.setProperty("--color-accent-soft", rgbaFromHex(accent, 0.18));
    document.documentElement.style.setProperty("--dashboard-accent", accent);
    document.documentElement.style.setProperty("--dashboard-secondary", secondary);
    document.documentElement.style.setProperty("--dashboard-warm", theme.warm);
    document.documentElement.style.setProperty("--dashboard-accent-glow", rgbaFromHex(accent, 0.12));
    document.documentElement.style.setProperty("--dashboard-secondary-glow", rgbaFromHex(secondary, 0.1));
    document.documentElement.style.setProperty("--dashboard-warm-glow", rgbaFromHex(theme.warm, 0.1));
    document.documentElement.style.setProperty("--dashboard-theme-bg", theme.background);
    document.documentElement.style.setProperty("--dashboard-aura-opacity", String(effectiveIntensity / 100));

    if (document.body) {
      document.body.setAttribute("data-theme", theme.id);
      document.body.setAttribute("data-performance-budget", budget);
      document.body.setAttribute("data-readability", readability);
      document.body.classList.toggle("dashboard-native-page--motion-low", effectiveIntensity > 0 && effectiveIntensity <= 35);
      document.body.classList.toggle("dashboard-native-page--motion-off", effectiveIntensity === 0);
      document.body.classList.toggle("dashboard-native-page--budget-battery", budget === "battery");
      document.body.classList.toggle("dashboard-native-page--budget-game", budget === "game");
      document.body.classList.toggle("dashboard-native-page--budget-max", budget === "max");
      document.body.classList.toggle("dashboard-native-page--readability-clean", readability === "clean");
      document.body.classList.toggle("dashboard-native-page--readability-high-contrast", readability === "high-contrast");
      document.body.classList.toggle("dashboard-native-page--readability-visor", readability === "visor");
    }

    renderDashboardChromeState();
  }

  function getParam(name) {
    var value = params.get(name);
    return value == null || value === "" ? "" : value;
  }

  function loadAssetRevision() {
    if (assetRevision) {
      return Promise.resolve(assetRevision);
    }

    return fetch("./assets/revision.json", {
      cache: "no-store"
    }).then(function (response) {
      return response.ok ? response.json() : {};
    }).then(function (payload) {
      assetRevision = text(payload && payload.assetRevision, "local");
      return assetRevision;
    }, function () {
      assetRevision = "local";
      return assetRevision;
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function text(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

  function isTouchLockEnabled() {
    return String(getSetting("touchLockMode") || "") === "1";
  }

  function isGameFocusActive() {
    return currentWidgetId === "game-mode"
      && gameActivity
      && gameActivity.active
      && gameActivity.activeGame;
  }

  function renderDashboardChromeState() {
    var locked = isTouchLockEnabled();
    if (locked) {
      settingsDrawerOpen = false;
    }

    if (document.body) {
      document.body.classList.toggle("dashboard-native-page--settings-open", settingsDrawerOpen && !locked);
      document.body.classList.toggle("dashboard-native-page--settings-closed", !settingsDrawerOpen || locked);
      document.body.classList.toggle("dashboard-native-page--touch-locked", locked);
      document.body.classList.toggle("dashboard-native-page--game-focus-active", isGameFocusActive());
    }

    if (settingsPanelNode) {
      settingsPanelNode.classList.toggle("is-open", settingsDrawerOpen && !locked);
      settingsPanelNode.classList.toggle("is-collapsed", !settingsDrawerOpen || locked);
    }

    if (settingsToggleNode) {
      settingsToggleNode.textContent = settingsDrawerOpen && !locked ? "Hide Settings" : "Settings";
      settingsToggleNode.setAttribute("aria-expanded", settingsDrawerOpen && !locked ? "true" : "false");
      settingsToggleNode.classList.toggle("is-active", settingsDrawerOpen && !locked);
    }

    if (touchLockToggleNode) {
      touchLockToggleNode.textContent = locked ? "Touch Locked" : "Touch Lock";
      touchLockToggleNode.classList.toggle("is-active", locked);
      touchLockToggleNode.setAttribute("data-tone", locked ? "good" : "muted");
    }

    if (touchUnlockNode) {
      touchUnlockNode.classList.toggle("is-hidden", !locked);
    }
  }

  function setTouchLockEnabled(enabled) {
    dashboardSettings.touchLockMode = enabled ? "1" : "0";
    storedSettings.touchLockMode = dashboardSettings.touchLockMode;
    persistSettings();
    renderDashboardChromeState();
    showTouchFeedback(enabled ? "Touch locked" : "Touch unlocked");
    if (!enabled) {
      maybeOpenPendingGameFace();
    }
  }

  function toggleSettingsDrawer() {
    if (isTouchLockEnabled()) {
      return;
    }
    settingsDrawerOpen = !settingsDrawerOpen;
    renderDashboardChromeState();
    showTouchFeedback(settingsDrawerOpen ? "Settings open" : "Settings tucked away");
    if (!settingsDrawerOpen) {
      maybeOpenPendingGameFace();
    }
  }

  function showTouchFeedback(message) {
    if (!message) {
      return;
    }

    if (!touchFeedbackNode) {
      touchFeedbackNode = document.getElementById("dashboard-touch-feedback");
    }
    if (!touchFeedbackNode) {
      return;
    }

    window.clearTimeout(touchFeedbackTimerId);
    touchFeedbackNode.textContent = message;
    touchFeedbackNode.classList.remove("is-hidden");
    touchFeedbackNode.classList.remove("is-active");
    void touchFeedbackNode.offsetWidth;
    touchFeedbackNode.classList.add("is-active");

    touchFeedbackTimerId = window.setTimeout(function () {
      touchFeedbackNode.classList.remove("is-active");
      touchFeedbackNode.classList.add("is-hidden");
    }, 1100);
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

    scheduleFatalDashboardReload();
  }

  function scheduleFatalDashboardReload() {
    if (fatalDashboardReloadTimerId) {
      return;
    }

    fatalDashboardReloadTimerId = window.setTimeout(function () {
      try {
        window.location.reload();
      } catch (error) {
        console.warn("Dashboard self-heal reload failed", error);
      }
    }, 60000);
  }

  function reportBackgroundDashboardError(title, error) {
    console.warn(title + ": " + formatDashboardError(error), error);
    showTouchFeedback("Background task failed");
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

  function postJson(url, body, timeoutMs) {
    return withTimeout(fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body || {})
    }).then(function (response) {
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
    }), timeoutMs || 8000);
  }

  function fetchBridgeHealth() {
    return fetchJson(buildUrl(bridgeOrigin, "/api/health"), 5000);
  }

  function fetchBridgeConfig() {
    return fetchJson(buildUrl(bridgeOrigin, "/api/config"), 5000);
  }

  function maybeCheckForAvailableUpdate() {
    var channel;
    if (updateAvailabilityChecked || getSetting("updateNotifications") !== "1" || bridgeReachable !== true) {
      return;
    }

    updateAvailabilityChecked = true;
    channel = getSetting("updateChannel") || (bridgeConfig.dashboard && bridgeConfig.dashboard.releaseChannel) || "stable";
    fetchJson(buildUrl(bridgeOrigin, "/api/releases/latest", { channel: channel }), 8500).then(function (payload) {
      if (payload && payload.status === "live" && payload.updateAvailable) {
        showTouchFeedback("Update " + text(payload.latestVersion, "available") + " is ready in Updates");
      }
    }).catch(function (error) {
      console.warn("Background update check failed", error);
    });
  }

  function fetchGameActivity() {
    return fetchJson(buildUrl(bridgeOrigin, "/api/game/activity"), 4200);
  }

  function fetchLaunchers() {
    return fetchJson(buildUrl(bridgeOrigin, "/api/launchers"), 4200);
  }

  function getBridgeRefreshInterval() {
    var budget = getPerformanceBudget();
    if (budget === "battery") {
      return 60000;
    }
    if (budget === "game") {
      return 45000;
    }
    if (budget === "max") {
      return 15000;
    }
    return 30000;
  }

  function scheduleBridgeRefreshLoop() {
    window.setTimeout(function () {
      refreshBridgeState({
        skipFrameReload: true
      }).catch(function (error) {
        reportBackgroundDashboardError(
          "Dashboard refresh failed",
          error
        );
      }).then(function () {
        scheduleBridgeRefreshLoop();
      });
    }, getBridgeRefreshInterval());
  }

  function getGameActivityRefreshInterval() {
    var budget = getPerformanceBudget();
    if (budget === "battery") {
      return 12000;
    }
    if (budget === "max" || budget === "game") {
      return 4000;
    }
    return 8000;
  }

  function getNowStripRefreshInterval() {
    var budget = getPerformanceBudget();
    if (budget === "battery") {
      return 15000;
    }
    if (budget === "game") {
      return 12000;
    }
    if (budget === "max") {
      return 5000;
    }
    return 8000;
  }

  function getLauncherDockRefreshInterval() {
    var budget = getPerformanceBudget();
    if (budget === "battery") {
      return 60000;
    }
    if (budget === "game") {
      return 45000;
    }
    if (budget === "max") {
      return 15000;
    }
    return 30000;
  }

  function activeGameIdFromPayload(payload) {
    var activeGame = payload && payload.active && payload.activeGame ? payload.activeGame : null;
    if (!activeGame) {
      return "";
    }

    return String(activeGame.id || activeGame.appId || activeGame.processName || activeGame.name || "");
  }

  function isGameFaceAutoOpenEnabled() {
    return String(getSetting("gameModeAutoFace") || "1") !== "0";
  }

  function clearPendingGameFaceAutoOpen() {
    window.clearTimeout(pendingGameFaceTimerId);
    pendingGameFaceTimerId = 0;
    pendingGameFaceAutoOpenId = "";
  }

  function markDashboardInteractionActive() {
    dashboardInteractionActive = true;
    window.clearTimeout(dashboardInteractionTimerId);
  }

  function markDashboardInteractionIdleSoon() {
    window.clearTimeout(dashboardInteractionTimerId);
    dashboardInteractionTimerId = window.setTimeout(function () {
      dashboardInteractionActive = false;
      maybeOpenPendingGameFace();
    }, 180);
  }

  function isDashboardBusyForGameFaceAutoOpen() {
    return dashboardInteractionActive || settingsDrawerOpen || isTouchLockEnabled();
  }

  function openGameFaceForActiveId(activeId) {
    if (!activeId
      || !isGameFaceAutoOpenEnabled()
      || gameFaceSuppressedGameId === activeId
      || gameFaceAutoOpenedGameId === activeId
      || currentWidgetId === "setup") {
      return false;
    }

    if (currentWidgetId === "game-mode") {
      gameFaceAutoOpenedGameId = activeId;
      clearPendingGameFaceAutoOpen();
      return true;
    }

    gameFacePreviousWidgetId = currentWidgetId || getFallbackPrimaryWidget();
    gameFaceAutoOpenedGameId = activeId;
    clearPendingGameFaceAutoOpen();
    selectWidget("game-mode", false);
    showTouchFeedback("Game focus");
    return true;
  }

  function schedulePendingGameFaceAutoOpen(activeId) {
    if (!activeId) {
      clearPendingGameFaceAutoOpen();
      return;
    }

    pendingGameFaceAutoOpenId = activeId;
    window.clearTimeout(pendingGameFaceTimerId);
    pendingGameFaceTimerId = window.setTimeout(maybeOpenPendingGameFace, 260);
  }

  function maybeOpenPendingGameFace() {
    var activeId;

    if (!pendingGameFaceAutoOpenId) {
      return;
    }

    activeId = activeGameIdFromPayload(gameActivity);
    if (!gameActivity || !gameActivity.active || !activeId || activeId !== pendingGameFaceAutoOpenId) {
      clearPendingGameFaceAutoOpen();
      return;
    }

    if (gameFaceSuppressedGameId === activeId
      || gameFaceAutoOpenedGameId === activeId
      || !isGameFaceAutoOpenEnabled()
      || currentWidgetId === "setup") {
      clearPendingGameFaceAutoOpen();
      return;
    }

    if (isDashboardBusyForGameFaceAutoOpen()) {
      if (dashboardInteractionActive) {
        schedulePendingGameFaceAutoOpen(activeId);
      }
      return;
    }

    openGameFaceForActiveId(activeId);
  }

  function restorePreGamePerformanceBudget() {
    var previousBudget = normalizeChoice(getSetting("preGameBudget"), "", ["balanced", "battery", "max"]);
    if (!previousBudget || getPerformanceBudget() !== "game") {
      return;
    }

    saveDashboardSettings({
      performanceBudget: previousBudget,
      preGameBudget: ""
    });
  }

  function handleGameActivity(payload) {
    var activeGame;
    var activeId;

    gameActivity = payload || null;
    activeGame = gameActivity && gameActivity.active && gameActivity.activeGame ? gameActivity.activeGame : null;
    activeId = activeGameIdFromPayload(gameActivity);

    if (!activeGame || !activeId) {
      restorePreGamePerformanceBudget();
      gameFaceLastActiveId = "";
      gameFaceAutoOpenedGameId = "";
      gameFaceSuppressedGameId = "";
      clearPendingGameFaceAutoOpen();
      renderDashboardChromeState();
      return;
    }

    if (activeId !== gameFaceLastActiveId) {
      gameFaceLastActiveId = activeId;
      gameFaceAutoOpenedGameId = "";
      gameFaceSuppressedGameId = "";
      clearPendingGameFaceAutoOpen();
    }

    if (!isGameFaceAutoOpenEnabled()
      || gameFaceSuppressedGameId === activeId
      || gameFaceAutoOpenedGameId === activeId
      || currentWidgetId === "setup") {
      clearPendingGameFaceAutoOpen();
      renderDashboardChromeState();
      return;
    }

    if (currentWidgetId === "game-mode") {
      gameFaceAutoOpenedGameId = activeId;
      clearPendingGameFaceAutoOpen();
      renderDashboardChromeState();
      return;
    }

    if (isDashboardBusyForGameFaceAutoOpen()) {
      schedulePendingGameFaceAutoOpen(activeId);
      renderDashboardChromeState();
      return;
    }

    openGameFaceForActiveId(activeId);
    renderDashboardChromeState();
  }

  function refreshGameActivity() {
    if (bridgeReachable !== true || isLocalBridgeBlockedByPageOrigin()) {
      return Promise.resolve();
    }

    return fetchGameActivity().then(function (payload) {
      handleGameActivity(payload);
      evaluateSceneContext(payload);
    }, function () {
      gameActivity = null;
      renderDashboardChromeState();
    });
  }

  function evaluateSceneContext(activityPayload) {
    var now = Date.now();
    var activeGame = activityPayload && activityPayload.active && activityPayload.activeGame ? activityPayload.activeGame : null;
    if (now - lastSceneEvaluationAt < 20000) {
      return;
    }
    lastSceneEvaluationAt = now;
    fetchJson(buildUrl(bridgeOrigin, "/api/media"), 2600).catch(function () { return {}; }).then(function (media) {
      return postJson(buildUrl(bridgeOrigin, "/api/scenes/evaluate"), {
        activeGame: activeGame ? (activeGame.name || activeGame.processName || activeGame.id || "Game") : "",
        foregroundProcess: activeGame ? (activeGame.processName || "") : "",
        mediaPlaying: Boolean(media && (media.playing || String(media.playbackStatus || media.status || "").toLowerCase() === "playing")),
        sampledAt: new Date().toISOString()
      }, 5000);
    }).then(function (payload) {
      var previousId = bridgeConfig.scenes && bridgeConfig.scenes.activeSceneId;
      bridgeConfig.scenes = payload;
      if (payload.activeSceneId && payload.activeSceneId !== previousId) {
        applyScenePresentation(payload.activeScene);
        renderQuickDrawer();
        showTouchFeedback((payload.activeScene && payload.activeScene.name ? payload.activeScene.name : "Scene") + " activated automatically");
      }
    }).catch(function (error) {
      console.warn("Scene evaluation failed", error);
    });
  }

  function scheduleGameActivityLoop() {
    window.setTimeout(function () {
      refreshGameActivity().then(function () {
        scheduleGameActivityLoop();
      }, function () {
        scheduleGameActivityLoop();
      });
    }, getGameActivityRefreshInterval());
  }

  function shouldSuppressNowStrip() {
    return currentWidgetId === "audio"
      || currentWidgetId === "quick-actions"
      || currentWidgetId === "shortcuts"
      || currentWidgetId === "game-mode";
  }

  function setNowStrip(targetWidget, label, title, detail) {
    if (!nowStripNode) {
      return;
    }

    nowStripNode.dataset.targetWidget = targetWidget || "";
    nowStripNode.innerHTML = '' +
      '<span class="dashboard-now-strip__label">' + escapeHtml(label || "Now") + '</span>' +
      '<strong>' + escapeHtml(title || "Ready") + '</strong>' +
      '<small>' + escapeHtml(detail || "") + '</small>';
    nowStripNode.classList.remove("is-hidden");
    document.body.classList.add("dashboard-native-page--now-strip-visible");
  }

  function hideNowStrip() {
    if (nowStripNode) {
      nowStripNode.classList.add("is-hidden");
      nowStripNode.dataset.targetWidget = "";
    }
    document.body.classList.remove("dashboard-native-page--now-strip-visible");
  }

  function findAudioDeviceName(payload) {
    var devices = Array.isArray(payload && payload.devices) ? payload.devices : [];
    var defaultId = payload && payload.defaultDeviceId ? String(payload.defaultDeviceId) : "";
    var device = devices.filter(function (entry) {
      return entry && ((defaultId && String(entry.id || "") === defaultId) || entry.isDefault);
    })[0] || devices[0] || {};
    return text(device.name || payload && payload.defaultDeviceName, "System audio");
  }

  function updateNowPlayingStrip() {
    var activeGame = gameActivity && gameActivity.active && gameActivity.activeGame ? gameActivity.activeGame : null;
    if (!nowStripNode || bridgeReachable === false || isLocalBridgeBlockedByPageOrigin() || shouldSuppressNowStrip()) {
      hideNowStrip();
      return;
    }

    if (activeGame && currentWidgetId !== "game-mode") {
      setNowStrip(
        "game-mode",
        "Game",
        text(activeGame.name, "Game running"),
        text(activeGame.platform, text(activeGame.source, "Active now"))
      );
      return;
    }

    fetchJson(buildUrl(bridgeOrigin, "/api/media"), 2600).then(function (payload) {
      var title = text(payload && payload.title, "");
      var artist = text(payload && payload.artist, "");
      var status = text(payload && payload.playbackStatus, text(payload && payload.status, ""));
      if (title || artist) {
        setNowStrip(
          "audio",
          status && status !== "idle" ? status.replace(/-/g, " ") : "Media controls",
          title || artist,
          artist && title ? artist : text(payload && payload.message, "Media controls ready")
        );
        return;
      }

      throw new Error("No active media");
    }).catch(function () {
      return fetchJson(buildUrl(bridgeOrigin, "/api/audio"), 2600).then(function (payload) {
        var parsedVolume = Number(payload && payload.masterVolume);
        var volume = Number.isFinite(parsedVolume) ? parsedVolume : null;
        var muted = Boolean(payload && payload.muted);
        var volumeText = muted ? "Muted" : (volume == null ? "Ready" : Math.round(volume) + "%");
        setNowStrip("audio", "Audio", findAudioDeviceName(payload), volumeText);
      }, function () {
        hideNowStrip();
      });
    });
  }

  function initNowPlayingStrip() {
    if (!nowStripNode) {
      return;
    }

    nowStripNode.addEventListener("click", function () {
      var targetWidget = nowStripNode.dataset.targetWidget || "";
      if (targetWidget) {
        selectWidget(targetWidget, true);
        showTouchFeedback(targetWidget === "game-mode" ? "Game Mode opened" : "Audio & Media opened");
      }
    });

    scheduleNowPlayingStripLoop();
  }

  function scheduleNowPlayingStripLoop() {
    window.clearTimeout(nowStripTimerId);
    updateNowPlayingStrip();
    nowStripTimerId = window.setTimeout(scheduleNowPlayingStripLoop, getNowStripRefreshInterval());
  }

  function normalizeLauncherDockEntries(payload) {
    return (Array.isArray(payload && payload.entries) ? payload.entries : []).map(function (entry) {
      return {
        id: text(entry && entry.id, ""),
        displayName: text(entry && entry.displayName, "App"),
        iconUrl: text(entry && entry.iconUrl, ""),
        tileLabel: text(entry && entry.tileLabel, "?"),
        source: text(entry && entry.source, ""),
        executablePath: text(entry && entry.executablePath, ""),
        arguments: text(entry && entry.arguments, "")
      };
    }).filter(function (entry) {
      return entry.id !== "";
    });
  }

  function launcherDockTargetLabel(entry) {
    var target = text(entry && entry.executablePath, "");
    var normalized;
    var parts;
    if (!target) {
      return text(entry && entry.source, "Recent app");
    }

    if (/^shell:AppsFolder\\/i.test(target)) {
      return "Windows app";
    }

    normalized = target.replace(/\\/g, "/");
    parts = normalized.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : target;
  }

  function shouldShowLauncherDock() {
    return Boolean(
      launcherDockNode
      && bridgeReachable !== false
      && !isLocalBridgeBlockedByPageOrigin()
      && bridgeCapabilities.launchers === true
      && currentWidgetId
      && currentWidgetId !== "setup"
      && currentWidgetId !== "game-mode"
      && launcherDockEntries.length > 0
    );
  }

  function setLauncherDockVisible(visible) {
    if (!launcherDockNode) {
      return;
    }

    launcherDockNode.classList.toggle("is-hidden", !visible);
    document.body.classList.toggle("dashboard-native-page--launcher-dock", visible);
    document.body.classList.toggle("dashboard-native-page--launcher-dock-expanded", visible && launcherDockExpanded);
    if (!visible) {
      launcherDockNode.classList.remove("is-expanded");
    }
  }

  function hideLauncherDock() {
    setLauncherDockVisible(false);
  }

  function renderLauncherDock() {
    var visibleEntries;
    var hasMore;
    var renderKey;
    if (!launcherDockNode || !shouldShowLauncherDock()) {
      hideLauncherDock();
      return;
    }

    if (launcherDockEntries.length <= 8) {
      launcherDockExpanded = false;
    }

    visibleEntries = launcherDockEntries.slice(0, launcherDockExpanded ? 24 : 8);
    hasMore = launcherDockEntries.length > 8;
    renderKey = JSON.stringify({
      expanded: launcherDockExpanded,
      launching: launcherDockLaunchingId,
      entries: visibleEntries
    });
    if (renderKey === launcherDockRenderKey) {
      setLauncherDockVisible(true);
      return;
    }

    launcherDockRenderKey = renderKey;
    launcherDockNode.classList.toggle("is-expanded", launcherDockExpanded);
    launcherDockNode.innerHTML = '' +
      '<div class="dashboard-launcher-dock__head">' +
        '<span>Apps</span>' +
        '<strong>' + escapeHtml(String(launcherDockEntries.length)) + '</strong>' +
      '</div>' +
      '<div class="dashboard-launcher-dock__apps">' + visibleEntries.map(function (entry) {
        var launching = launcherDockLaunchingId === entry.id;
        var detail = entry.source ? entry.source + " · " + launcherDockTargetLabel(entry) : launcherDockTargetLabel(entry);
        return '' +
          '<button class="dashboard-launcher-dock__app" type="button" data-launcher-dock-id="' + escapeHtml(entry.id) + '" title="' + escapeHtml(entry.displayName + " - " + detail) + '"' + (launching ? " disabled" : "") + '>' +
            '<span class="dashboard-launcher-dock__icon">' + (entry.iconUrl
              ? '<img src="' + escapeHtml(entry.iconUrl) + '" alt="">'
              : '<span>' + escapeHtml(entry.tileLabel) + '</span>') + '</span>' +
            '<span class="dashboard-launcher-dock__copy">' +
              '<strong>' + escapeHtml(entry.displayName) + '</strong>' +
              '<small>' + escapeHtml(launching ? "Opening" : detail) + '</small>' +
            '</span>' +
          '</button>';
      }).join("") + '</div>' +
      (hasMore
        ? '<button class="dashboard-launcher-dock__more" type="button" data-launcher-dock-action="toggle-expanded" aria-expanded="' + (launcherDockExpanded ? "true" : "false") + '">' + (launcherDockExpanded ? "Less" : "More") + '</button>'
        : '');
    setLauncherDockVisible(true);
  }

  function refreshLauncherDock() {
    if (!launcherDockNode || bridgeReachable === false || isLocalBridgeBlockedByPageOrigin()) {
      hideLauncherDock();
      return Promise.resolve();
    }

    return fetchLaunchers().then(function (payload) {
      var nextEntries = normalizeLauncherDockEntries(payload);
      var nextKey = JSON.stringify(nextEntries);
      if (nextKey !== launcherDockSnapshotKey) {
        launcherDockEntries = nextEntries;
        launcherDockSnapshotKey = nextKey;
        launcherDockRenderKey = "";
      }
      renderLauncherDock();
    }, function () {
      launcherDockEntries = [];
      launcherDockSnapshotKey = "";
      launcherDockRenderKey = "";
      hideLauncherDock();
    });
  }

  function launchDockApp(entryId) {
    if (!entryId || launcherDockLaunchingId) {
      return;
    }

    launcherDockLaunchingId = entryId;
    renderLauncherDock();
    postJson(buildUrl(bridgeOrigin, "/api/launchers/launch"), {
      id: entryId
    }, 8000).then(function (payload) {
      launcherDockLaunchingId = "";
      showTouchFeedback(text(payload && payload.message, "App opened"));
      return refreshLauncherDock();
    }, function (error) {
      launcherDockLaunchingId = "";
      renderLauncherDock();
      showTouchFeedback(error && error.message ? error.message : "Launch failed");
    });
  }

  function initLauncherDock() {
    if (!launcherDockNode) {
      return;
    }

    launcherDockNode.addEventListener("click", function (event) {
      var target = event.target && event.target.closest
        ? event.target.closest("[data-launcher-dock-id],[data-launcher-dock-action]")
        : null;
      if (!target) {
        return;
      }

      if (target.getAttribute("data-launcher-dock-action") === "toggle-expanded") {
        launcherDockExpanded = !launcherDockExpanded;
        renderLauncherDock();
        showTouchFeedback(launcherDockExpanded ? "Showing recent apps" : "Showing top apps");
        return;
      }

      launchDockApp(target.getAttribute("data-launcher-dock-id") || "");
    });

    scheduleLauncherDockLoop();
  }

  function scheduleLauncherDockLoop() {
    window.clearTimeout(launcherDockTimerId);
    refreshLauncherDock().then(function () {
      launcherDockTimerId = window.setTimeout(scheduleLauncherDockLoop, getLauncherDockRefreshInterval());
    }, function () {
      launcherDockTimerId = window.setTimeout(scheduleLauncherDockLoop, getLauncherDockRefreshInterval());
    });
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
    if (!bridgeConfig) {
      return;
    }

    if (bridgeConfig.weather && !Object.prototype.hasOwnProperty.call(storedSettings, "city")) {
      dashboardSettings.city = bridgeConfig.weather.city || defaultSettings.city;
    }

    if (bridgeConfig.weather && !Object.prototype.hasOwnProperty.call(storedSettings, "units")) {
      dashboardSettings.units = bridgeConfig.weather.units || defaultSettings.units;
    }

    if (!bridgeConfig.dashboard) {
      return;
    }

    [
      "performanceBudget",
      "themeReadability",
      "releaseChannel"
    ].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(storedSettings, key) && bridgeConfig.dashboard[key] != null) {
        dashboardSettings[key] = String(bridgeConfig.dashboard[key] || defaultSettings[key]);
      }
    });

    if (!Object.prototype.hasOwnProperty.call(storedSettings, "updateChannel") && bridgeConfig.dashboard.releaseChannel) {
      dashboardSettings.updateChannel = String(bridgeConfig.dashboard.releaseChannel || defaultSettings.updateChannel);
    }

    if (!Object.prototype.hasOwnProperty.call(storedSettings, "gameModeAutoTune")) {
      dashboardSettings.gameModeAutoTune = bridgeConfig.dashboard.gameModeAutoTune === false ? "0" : "1";
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

  function getUniFiNetworkEndpoint() {
    return hasValue("unifiNetworkEndpoint")
      ? getSetting("unifiNetworkEndpoint")
      : buildUrl(bridgeOrigin, "/api/unifi/network");
  }

  function isWidgetConfigured(widgetId) {
    if (widgetId === "weather" || widgetId === "hue" || widgetId === "calendar") {
      return getWidgetState(widgetId) !== "Optional";
    }

    if (widgetId === "unifi-network") {
      return true;
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
      return getSetupItem("unifi").state || "Optional";
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
      return bridgeCapabilities.audio === true || bridgeCapabilities.media === true;
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
    if (widget.id === "home" || widget.id === "scenes") {
      return true;
    }
    if (widget.id === "setup") {
      return !perfMode && (currentWidgetId === "setup" || !bridgeSetup.onboardingCompleted || bridgeSetup.needsAttention);
    }

    if (widget.tier === "product") {
      return isLocalProductWidget(widget.id);
    }

    if (isLocalProductWidget(widget.id)) {
      return true;
    }

    if (widget.id === "system" || widget.id === "network") {
      return isWidgetSupported(widget.id);
    }

    if (widget.id === "audio") {
      return isWidgetSupported("audio");
    }

    if (widget.id === "quick-actions" || widget.id === "shortcuts") {
      return isWidgetSupported(widget.id);
    }

    if (widget.id === "clipboard") {
      return false;
    }

    if (widget.id === "media") {
      return isWidgetSupported("media");
    }

    if (widget.id === "weather" || widget.id === "hue" || widget.id === "calendar") {
      return isWidgetSupported(widget.id) && getWidgetState(widget.id) !== "Optional";
    }

    if (widget.tier === "advanced") {
      return isWidgetConfigured(widget.id);
    }

    return true;
  }

  function getVisibleWidgets() {
    return sortWidgetsByLayout(widgets.filter(function (widget) {
      return shouldShowWidget(widget);
    }));
  }

  function sceneWidgetIds() {
    var scenes = bridgeConfig && bridgeConfig.scenes ? bridgeConfig.scenes : {};
    var profiles = Array.isArray(scenes.profiles) ? scenes.profiles : [];
    var active = profiles.filter(function (scene) {
      return scene && scene.id === scenes.activeSceneId;
    })[0];
    var base = active && Array.isArray(active.widgets) ? active.widgets : ["home", "system", "network", "audio"];
    var pinned = String(getSetting("pinnedWidgets") || "").split(",").filter(Boolean);
    var hidden = String(getSetting("hiddenWidgets") || "").split(",").filter(Boolean);
    return base.concat(pinned).filter(function (id, index, list) {
      return hidden.indexOf(id) === -1 && list.indexOf(id) === index;
    });
  }

  function getDestinationWidgets(destination) {
    var target = destination || primaryDestination;
    var settingsIds = ["setup", "theme-studio", "layout-editor", "remote", "updates", "privacy", "installer"];
    var ids;
    if (target === "home") {
      ids = ["home"].concat(sceneWidgetIds().filter(function (id) { return id !== "home"; }));
    } else if (target === "scenes") {
      ids = ["scenes"];
    } else if (target === "settings") {
      ids = settingsIds;
    } else {
      ids = widgets.map(function (widget) { return widget.id; }).filter(function (id) {
        return id !== "home" && id !== "scenes" && settingsIds.indexOf(id) === -1;
      });
    }

    return ids.map(getWidgetById).filter(function (widget, index, list) {
      return widget && list.indexOf(widget) === index;
    });
  }

  function getWidgetById(widgetId) {
    if (widgetId === "media") {
      widgetId = "audio";
    }

    return widgets.filter(function (entry) {
      return entry.id === widgetId;
    })[0] || widgets[0];
  }

  function hasWidgetId(widgetId) {
    if (widgetId === "media") {
      widgetId = "audio";
    }

    return widgets.some(function (entry) {
      return entry.id === widgetId;
    });
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
        id: "home",
        title: "Home",
        requiresBridge: true,
        tier: "product",
        kicker: "Smart Glance",
        copy: "The most important information and actions for the active Mode.",
        viewerLabel: "Auxora"
      },
      {
        id: "scenes",
        title: "Modes",
        requiresBridge: true,
        tier: "product",
        kicker: "Adaptive experience",
        copy: "Switch the entire touch surface between Work, Gaming, Media, Night, and Home.",
        viewerLabel: "Manual + automatic"
      },
      {
        id: "setup",
        requiresBridge: true,
        getTitle: function () {
          return bridgeSetup.onboardingCompleted ? "Diagnostics" : "Auto Setup";
        },
        getKicker: function () {
          return bridgeSetup.onboardingCompleted ? "Diagnostics" : "Auto provisioning";
        },
        getCopy: function () {
          return bridgeSetup.onboardingCompleted
            ? "Auto-detected services, optional permissions, and repair steps."
            : "Auxora scans this PC and prepares safe defaults automatically.";
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
            advanced: showAdvanced ? "1" : "",
            onboardingVersion: onboardingVersion
          });
        }
      },
      {
        id: "game-mode",
        title: "Game Mode",
        requiresBridge: true,
        tier: "product",
        kicker: "Launch mode",
        copy: "Launch games, then let the touch surface switch into a focused in-game HUD.",
        viewerLabel: "Game focus"
      },
      {
        id: "theme-studio",
        title: "Theme Studio",
        requiresBridge: false,
        tier: "product",
        kicker: "Visual style",
        copy: "Theme, readability, performance budget, and Game Mode tuning for the touch surface.",
        viewerLabel: "Display tuning"
      },
      {
        id: "updates",
        title: "Updates",
        requiresBridge: true,
        tier: "product",
        kicker: "Release safety",
        copy: "Stable, beta, and nightly release checks with rollback state from the local host.",
        viewerLabel: "Release channel"
      },
      {
        id: "layout-editor",
        title: "Layout Editor",
        requiresBridge: false,
        tier: "product",
        kicker: "Edit mode",
        copy: "Reorder and pin the cards that belong on your active Mode.",
        viewerLabel: "Local layout"
      },
      {
        id: "streaming",
        title: "Streaming",
        requiresBridge: false,
        tier: "product",
        kicker: "Creator controls",
        copy: "Local OBS connectivity, audio, media, and stream-ready Scene controls.",
        viewerLabel: "Creator beta"
      },
      {
        id: "marketplace",
        title: "Extensions",
        requiresBridge: true,
        tier: "product",
        kicker: "Signed Library",
        copy: "Curated packs and locally inspected signed extensions with declared permissions.",
        viewerLabel: "Trust enforced"
      },
      {
        id: "privacy",
        title: "Privacy & Backup",
        requiresBridge: true,
        tier: "product",
        kicker: "Trust and portability",
        copy: "Local settings, sanitized diagnostics, backup, reset, and recovery.",
        viewerLabel: "Local-first"
      },
      {
        id: "remote",
        title: "Phone Remote",
        requiresBridge: true,
        tier: "product",
        kicker: "Unavailable in this beta",
        copy: "Phone Remote is not included in 0.3.0-beta.1. Auxora does not open a phone-control listener.",
        viewerLabel: "Unavailable"
      },
      {
        id: "installer",
        title: "Recovery",
        requiresBridge: true,
        tier: "product",
        kicker: "Install health",
        copy: "Retry the dashboard, repair an installed copy, restart in Safe Mode, open logs, or quit.",
        viewerLabel: "Customer recovery"
      },
      {
        id: "system",
        title: "System Monitor",
        requiresBridge: true,
        copy: "CPU, GPU, and RAM telemetry from the local bridge.",
        getViewerLabel: function () {
          return "Local bridge";
        },
        buildSrc: function () {
          return buildUrl(widgetBase, "/widgets/system-monitor.html", {
            size: "full",
            rev: assetRevision,
            endpoint: buildUrl(bridgeOrigin, "/api/system"),
            gpuPowerEndpoint: buildUrl(bridgeOrigin, "/api/gpu-power")
          });
        }
      },
        {
          id: "network",
          title: "Network",
          requiresBridge: true,
          copy: "Gaming latency, throughput, local adapter state, and optional UniFi gateway detail.",
          getViewerLabel: function () {
            return getWidgetState("unifi-network") === "Ready" ? "UniFi linked" : "Network health";
          },
          buildSrc: function () {
            return buildUrl(widgetBase, "/widgets/network-widget.html", {
              size: "full",
              rev: assetRevision,
              endpoint: buildUrl(bridgeOrigin, "/api/network"),
              unifiEndpoint: getUniFiNetworkEndpoint(),
              unifiLinkEndpoint: buildUrl(bridgeOrigin, "/api/unifi/network/link"),
              unifiDisconnectEndpoint: buildUrl(bridgeOrigin, "/api/unifi/network/disconnect")
            });
          }
        },
      {
        id: "audio",
        title: "Audio & Media",
        requiresBridge: true,
        copy: "Volume, output switching, active app audio, and now-playing controls in one place.",
        getViewerLabel: function () {
          return "Sound and playback";
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
        id: "quick-actions",
        title: "Quick Actions",
        requiresBridge: true,
        copy: "Dark mode, Night Light, locking, Task Manager, Settings, and Recycle Bin actions.",
        getViewerLabel: function () {
          return "Windows shell";
        }
      },
      {
        id: "shortcuts",
        title: "System Shortcuts",
        requiresBridge: true,
        copy: "Power actions, notifications, and display controls Windows exposes on this PC.",
        getViewerLabel: function () {
          return "Windows shell";
        }
      },
      {
        id: "display-controls",
        title: "Display Controls",
        requiresBridge: true,
        copy: "Brightness, contrast, input, and power controls for monitors that expose DDC/CI.",
        getViewerLabel: function () {
          return "Windows DDC/CI";
        }
      },
      {
        id: "clipboard",
        title: "Clipboard",
        requiresBridge: true,
        copy: "Recent clipboard history with one-tap restore.",
        getViewerLabel: function () {
          return "Windows clipboard";
        }
      },
      {
        id: "weather",
        title: "Weather",
        requiresBridge: true,
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
        requiresBridge: true,
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
        id: "hue",
        title: "Philips Hue",
        requiresBridge: true,
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
    var destinationWidgets = getDestinationWidgets();
    var categories = ["System", "Media", "Productivity", "Gaming", "Smart Home", "More"];
    function categoryFor(widget) {
      if (["system", "network", "shortcuts", "display-controls", "updates"].indexOf(widget.id) !== -1) { return "System"; }
      if (["audio", "streaming"].indexOf(widget.id) !== -1) { return "Media"; }
      if (["calendar", "quick-actions", "clipboard", "weather"].indexOf(widget.id) !== -1) { return "Productivity"; }
      if (widget.id === "game-mode") { return "Gaming"; }
      if (["hue", "automation", "plex", "nas", "unifi-camera", "unifi-network"].indexOf(widget.id) !== -1) { return "Smart Home"; }
      return "More";
    }
    function buttonFor(widget) {
      var activeClass = widget.id === currentWidgetId ? " is-active" : "";
      var state = getWidgetState(widget.id);
      return '' +
        '<button class="router-picker__button' + activeClass + '" data-widget-id="' + widget.id + '" aria-pressed="' + (widget.id === currentWidgetId ? "true" : "false") + '" title="' + escapeHtml(getWidgetCopy(widget)) + '">' +
          '<span class="router-picker__title">' + escapeHtml(getWidgetTitle(widget)) + '</span>' +
          '<span class="router-picker__meta" data-state="' + escapeHtml(state.toLowerCase().replace(/\s+/g, "-")) + '">' + escapeHtml(state) + '</span>' +
        '</button>';
    }
    pickerNode.innerHTML = primaryDestination === "library"
      ? categories.map(function (category) {
          var items = destinationWidgets.filter(function (widget) { return categoryFor(widget) === category; });
          return items.length ? '<div class="router-picker__category"><span>' + escapeHtml(category) + '</span>' + items.map(buttonFor).join("") + '</div>' : '';
        }).join("")
      : destinationWidgets.map(buttonFor).join("");

    pickerNode.querySelectorAll("[data-widget-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectWidget(button.getAttribute("data-widget-id"), true);
      });
    });
  }

  function renderPrimaryNavigation() {
    if (!primaryNavNode) {
      return;
    }
    primaryNavNode.querySelectorAll("[data-destination]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-destination") === primaryDestination ? "true" : "false");
    });
  }

  function selectDestination(destination) {
    var allowed = ["home", "scenes", "library", "settings"];
    primaryDestination = allowed.indexOf(destination) === -1 ? "home" : destination;
    try {
      window.localStorage.setItem(primaryDestinationStorageKey, primaryDestination);
    } catch (error) {
      console.warn("Unable to persist primary destination", error);
    }
    renderPrimaryNavigation();
    var available = getDestinationWidgets(primaryDestination);
    var preferred = primaryDestination === "home" ? "home" : primaryDestination === "scenes" ? "scenes" : available[0] && available[0].id;
    if (preferred) {
      currentWidgetId = preferred;
      renderCurrentSelection(true);
    }
  }

  function applyScenePresentation(scene) {
    if (!scene) {
      return;
    }
    saveDashboardSettings({
      profileId: scene.id || "scene-work",
      themeId: scene.themeId || "edge",
      accentColor: scene.accentColor || "",
      animationIntensity: String(scene.animationIntensity == null ? 25 : scene.animationIntensity),
      performanceBudget: scene.performanceBudget || "balanced",
      layoutOrder: Array.isArray(scene.widgets) ? scene.widgets.join(",") : ""
    });
    document.body.dataset.scene = scene.id || "scene-work";
    document.body.dataset.density = scene.density || "comfortable";
  }

  function activateScene(sceneId, manualOverrideMinutes) {
    return postJson(buildUrl(bridgeOrigin, "/api/scenes/activate"), {
      sceneId: sceneId,
      manualOverrideMinutes: manualOverrideMinutes == null ? 120 : manualOverrideMinutes
    }, 7000).then(function (payload) {
      bridgeConfig.scenes = payload;
      applyScenePresentation(payload.activeScene);
      renderQuickDrawer();
      showTouchFeedback((payload.activeScene && payload.activeScene.name ? payload.activeScene.name : "Scene") + " active");
      return payload;
    });
  }

  function resumeSceneAutomation() {
    return postJson(buildUrl(bridgeOrigin, "/api/scenes/resume"), {}, 7000).then(function (payload) {
      bridgeConfig.scenes = payload;
      applyScenePresentation(payload.activeScene);
      renderQuickDrawer();
      showTouchFeedback("Automatic Scenes resumed");
      return payload;
    });
  }

  function renderQuickDrawer() {
    var scenesNode = document.getElementById("dashboard-quick-scenes");
    var sceneConfig = bridgeConfig && bridgeConfig.scenes ? bridgeConfig.scenes : {};
    var profiles = Array.isArray(sceneConfig.profiles) ? sceneConfig.profiles : [];
    if (!scenesNode) {
      return;
    }
    scenesNode.innerHTML = profiles.map(function (scene) {
      return '<button type="button" data-quick-scene="' + escapeHtml(scene.id) + '" class="' + (scene.id === sceneConfig.activeSceneId ? "is-active" : "") + '">' + escapeHtml(scene.name) + '</button>';
    }).join("");
  }

  function setQuickDrawerOpen(open) {
    if (!quickDrawerNode || !quickToggleNode) {
      return;
    }
    quickDrawerNode.classList.toggle("is-hidden", !open);
    quickToggleNode.classList.toggle("is-hidden", open);
    quickToggleNode.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      renderQuickDrawer();
    }
  }

  function widgetRequiresBridge(widget) {
    return Boolean(widget && widget.requiresBridge);
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

  function persistNativeDashboardSettings(values) {
    var payload = {};
    var hasPayload = false;
    var channel;

    if (!bridgeReachable) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(values || {}, "performanceBudget")) {
      payload.performanceBudget = normalizeChoice(values.performanceBudget, "balanced", ["balanced", "battery", "game", "max"]);
      hasPayload = true;
    }

    if (Object.prototype.hasOwnProperty.call(values || {}, "themeReadability")) {
      payload.themeReadability = normalizeChoice(values.themeReadability, "normal", ["normal", "clean", "high-contrast", "visor"]);
      hasPayload = true;
    }

    if (Object.prototype.hasOwnProperty.call(values || {}, "releaseChannel") || Object.prototype.hasOwnProperty.call(values || {}, "updateChannel")) {
      channel = normalizeChoice(values.releaseChannel || values.updateChannel, "stable", ["stable", "beta", "nightly"]);
      payload.releaseChannel = channel;
      hasPayload = true;
    }

    if (Object.prototype.hasOwnProperty.call(values || {}, "gameModeAutoTune")) {
      payload.gameModeAutoTune = String(values.gameModeAutoTune || "0") !== "0";
      hasPayload = true;
    }

    if (Object.prototype.hasOwnProperty.call(values || {}, "foregroundAppTrackingEnabled")) {
      payload.foregroundAppTrackingEnabled = String(values.foregroundAppTrackingEnabled || "0") !== "0";
      hasPayload = true;
    }

    if (!hasPayload) {
      return;
    }

    postJson(buildUrl(bridgeOrigin, "/api/config/dashboard"), payload, 6000).catch(function (error) {
      console.warn("Unable to persist native dashboard settings", error);
    });
  }

  function saveDashboardSettings(values) {
    Object.keys(values || {}).forEach(function (key) {
      dashboardSettings[key] = String(values[key] || "");
      storedSettings[key] = dashboardSettings[key];
    });

    if (Object.prototype.hasOwnProperty.call(values || {}, "releaseChannel")) {
      dashboardSettings.updateChannel = dashboardSettings.releaseChannel;
      storedSettings.updateChannel = dashboardSettings.releaseChannel;
    } else if (Object.prototype.hasOwnProperty.call(values || {}, "updateChannel")) {
      dashboardSettings.releaseChannel = dashboardSettings.updateChannel;
      storedSettings.releaseChannel = dashboardSettings.updateChannel;
    }

    persistNativeDashboardSettings(values || {});
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
    renderSettings(getWidgetById(currentWidgetId || "system"));
  }

  function clearDashboardBrowserStorage() {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch (error) {
      console.warn("Unable to clear dashboard browser storage", error);
    }

    storedSettings = {};
    dashboardSettings = Object.assign({}, defaultSettings);
    currentWidgetId = "setup";
    lastBridgeSnapshotKey = "";
    applyDashboardPresentation();
  }

  function resetAllLocalData() {
    return postJson(buildUrl(bridgeOrigin, "/api/config/reset"), {}, 15000).then(function (receipt) {
      if (!receipt || receipt.ok !== true) {
        throw new Error(receipt && receipt.message ? receipt.message : "Required app data could not be cleared.");
      }
      clearDashboardBrowserStorage();
      return refreshBridgeState({
        resolveInitialWidget: true,
        preferredWidgetId: "setup",
        explicitWidgetParam: true,
        reloadLocalSettings: true
      });
    });
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
      showAdvanced: showAdvanced,
      bridgeSetup: bridgeSetup,
      bridgeConfig: bridgeConfig,
      gameActivity: gameActivity,
      gameFaceHomeWidget: gameFacePreviousWidgetId || getFallbackPrimaryWidget(),
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
      resetAllLocalData: resetAllLocalData,
      activateScene: activateScene,
      resumeSceneAutomation: resumeSceneAutomation,
      selectWidget: selectWidget,
      returnHomeFromGameFace: function () {
        var activeId = activeGameIdFromPayload(gameActivity);
        var targetWidget = gameFacePreviousWidgetId || getFallbackPrimaryWidget();
        if (targetWidget === "game-mode") {
          targetWidget = getFallbackPrimaryWidget();
        }
        if (activeId) {
          gameFaceSuppressedGameId = activeId;
        }
        selectWidget(targetWidget, true);
        showTouchFeedback("Home");
      },
      showTouchFeedback: showTouchFeedback,
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
      copy = "Core widgets stay visible. Optional panels appear only after they are set up.";
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

    if (widget.id === "quick-actions" || widget.id === "shortcuts" || widget.id === "clipboard") {
      return "This widget manages its own native settings and actions directly inside the panel.";
    }

    if (widget.id === "calendar") {
      return "Use Diagnostics to set or repair the ICS calendar feed.";
    }

    if (widget.id === "hue") {
      return "Use Diagnostics to link or repair the Hue bridge.";
    }

    if (widget.tier === "product" || isLocalProductWidget(widget.id)) {
      return "Game Mode keeps its recent Steam choice on this dashboard.";
    }

    return "This widget uses bridge defaults and does not need local dashboard settings.";
  }

  function renderGlobalSettings() {
    var opacity = getDashboardOpacityPercent();
    var readability = getThemeReadability();
    var budget = getPerformanceBudget();
    var autoTune = String(getSetting("gameModeAutoTune") || "1") !== "0";
    var autoFace = String(getSetting("gameModeAutoFace") || "1") !== "0";
    return '' +
      '<section class="router-settings__global">' +
        '<div class="router-settings__global-head">' +
          '<div>' +
            '<div class="router-settings__global-title">Display opacity</div>' +
            '<div class="router-settings__global-copy">Lower this to see through the dashboard while keeping controls usable.</div>' +
          '</div>' +
          '<div id="dashboard-opacity-value" class="router-settings__global-value">' + opacity + '%</div>' +
        '</div>' +
        '<input id="dashboard-opacity-slider" class="router-settings__slider" type="range" min="35" max="100" step="1" aria-label="Dashboard opacity" value="' + opacity + '">' +
        '<div class="router-settings__global-controls">' +
          '<label class="router-settings__field"><span>Readability</span><select id="dashboard-readability-select" class="router-settings__select">' +
            '<option value="normal"' + (readability === "normal" ? " selected" : "") + '>Normal</option>' +
            '<option value="clean"' + (readability === "clean" ? " selected" : "") + '>Clean</option>' +
            '<option value="high-contrast"' + (readability === "high-contrast" ? " selected" : "") + '>High contrast</option>' +
            '<option value="visor"' + (readability === "visor" ? " selected" : "") + '>Visor</option>' +
          '</select></label>' +
          '<label class="router-settings__field"><span>Performance</span><select id="dashboard-budget-select" class="router-settings__select">' +
            '<option value="balanced"' + (budget === "balanced" ? " selected" : "") + '>Balanced</option>' +
            '<option value="battery"' + (budget === "battery" ? " selected" : "") + '>Quiet</option>' +
            '<option value="game"' + (budget === "game" ? " selected" : "") + '>Game</option>' +
            '<option value="max"' + (budget === "max" ? " selected" : "") + '>Max</option>' +
          '</select></label>' +
        '</div>' +
        '<div class="router-settings__global-actions">' +
          '<label class="router-settings__checkbox"><input id="dashboard-autotune-toggle" type="checkbox"' + (autoTune ? " checked" : "") + '> Game Mode auto-tune</label>' +
          '<label class="router-settings__checkbox"><input id="dashboard-autoface-toggle" type="checkbox"' + (autoFace ? " checked" : "") + '> Game Mode auto-open</label>' +
          '<button id="dashboard-opacity-reset" class="router-settings__button" type="button">Reset opacity</button>' +
        '</div>' +
      '</section>';
  }

  function bindGlobalSettings() {
    var slider = document.getElementById("dashboard-opacity-slider");
    var valueNode = document.getElementById("dashboard-opacity-value");
    var resetButton = document.getElementById("dashboard-opacity-reset");
    var readabilitySelect = document.getElementById("dashboard-readability-select");
    var budgetSelect = document.getElementById("dashboard-budget-select");
    var autoTuneToggle = document.getElementById("dashboard-autotune-toggle");
    var autoFaceToggle = document.getElementById("dashboard-autoface-toggle");
    var initXnSlider = window.InlineWidgets && window.InlineWidgets.runtime && window.InlineWidgets.runtime.initXnSlider;

    function updateOpacity(nextValue, persistValue) {
      var normalized = normalizeOpacityPercent(nextValue);
      dashboardSettings.dashboardOpacity = String(normalized);
      slider.value = String(normalized);
      valueNode.textContent = normalized + "%";
      if (typeof initXnSlider === "function") {
        initXnSlider(slider);
      }
      applyDashboardOpacity();
      if (persistValue) {
        persistSettings();
      }
    }

    if (slider && valueNode) {
      if (typeof initXnSlider === "function") {
        initXnSlider(slider);
      }

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

    if (readabilitySelect) {
      readabilitySelect.addEventListener("change", function () {
        saveDashboardSettings({
          themeReadability: normalizeChoice(readabilitySelect.value, "normal", ["normal", "clean", "high-contrast", "visor"])
        });
      });
    }

    if (budgetSelect) {
      budgetSelect.addEventListener("change", function () {
        saveDashboardSettings({
          performanceBudget: normalizeChoice(budgetSelect.value, "balanced", ["balanced", "battery", "game", "max"])
        });
      });
    }

    if (autoTuneToggle) {
      autoTuneToggle.addEventListener("change", function () {
        saveDashboardSettings({
          gameModeAutoTune: autoTuneToggle.checked ? "1" : "0"
        });
      });
    }

    if (autoFaceToggle) {
      autoFaceToggle.addEventListener("change", function () {
        saveDashboardSettings({
          gameModeAutoFace: autoFaceToggle.checked ? "1" : "0"
        });
      });
    }
  }

  function renderSettings(widget) {
    if (perfMode) {
      settingsNode.innerHTML = '<div class="router-settings__note">Display mode keeps the EDGE surface lean.</div>';
      renderDashboardChromeState();
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
        renderForegroundTrackingControl(widget) +
        '<div class="router-settings__empty">' +
          '<div class="router-settings__note">' + escapeHtml(renderNoSettingsCopy(widget)) + '</div>' +
        '</div>';
      bindGlobalSettings();
      bindForegroundTrackingControl();
      renderDashboardChromeState();
      return;
    }

    if (!schema.fields.length) {
      settingsNode.innerHTML = '' +
        renderGlobalSettings() +
        renderForegroundTrackingControl(widget) +
        '<div class="router-settings__empty">' +
          '<div class="router-settings__note">' + escapeHtml(schema.copy) + '</div>' +
        '</div>';
      bindGlobalSettings();
      bindForegroundTrackingControl();
      renderDashboardChromeState();
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
    renderDashboardChromeState();
  }

  function renderForegroundTrackingControl(widget) {
    var dashboard = bridgeConfig && bridgeConfig.dashboard ? bridgeConfig.dashboard : {};
    var enabled = Boolean(dashboard.foregroundAppTrackingEnabled);
    if (!widget || (widget.id !== "setup" && widget.id !== "privacy")) {
      return "";
    }

    return '' +
      '<div class="router-settings__form" data-foreground-tracking-panel>' +
        '<label class="router-settings__field">' +
          '<span><input type="checkbox" data-foreground-tracking-setting' + (enabled ? " checked" : "") + '> Track the foreground app to build Recent Apps</span>' +
          '<small class="router-settings__field-help">Off by default. When on, Auxora observes the active executable and stores up to 24 names, paths, sources, and last-opened times locally. Turning it off clears that history.</small>' +
        '</label>' +
        '<div class="router-settings__note" role="status" data-foreground-tracking-status>' + (enabled ? "Foreground tracking is on." : "Foreground tracking is off.") + '</div>' +
      '</div>';
  }

  function bindForegroundTrackingControl() {
    var toggle = settingsNode.querySelector("[data-foreground-tracking-setting]");
    var status = settingsNode.querySelector("[data-foreground-tracking-status]");
    if (!toggle || !status) {
      return;
    }

    toggle.addEventListener("change", function () {
      var enabled = Boolean(toggle.checked);
      toggle.disabled = true;
      status.textContent = enabled ? "Enabling foreground tracking..." : "Disabling tracking and clearing recent history...";
      postJson(buildUrl(bridgeOrigin, "/api/config/dashboard"), {
        foregroundAppTrackingEnabled: enabled
      }, 8000).then(function (payload) {
        bridgeConfig = Object.assign({}, bridgeConfig, payload || {});
        status.textContent = enabled ? "Foreground tracking is on." : "Foreground tracking is off and recent history was cleared.";
      }).catch(function (error) {
        toggle.checked = !enabled;
        status.textContent = error.message || "Foreground tracking could not be changed.";
      }).finally(function () {
        toggle.disabled = false;
      });
    });
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
    var destinationIds = getDestinationWidgets().map(function (entry) { return entry.id; });
    if (destinationIds.indexOf(widget.id) === -1 || (perfMode && widget.id === "setup")) {
      currentWidgetId = destinationIds[0] || getFallbackPrimaryWidget();
      widget = getWidgetById(currentWidgetId || "system");
    }

    updateWidgetMeta(widget);
    renderPicker();
    renderDiagnostics();
    renderSettings(widget);

    if (bridgeReachable === false && widgetRequiresBridge(widget) && widgetBase === bridgeOrigin) {
      hideLauncherDock();
      showFrameEmpty(
        "Local bridge unavailable",
        "The widget shell points at " + bridgeOrigin + ", but the localhost bridge is not responding. Start it, then retry."
      );
      setStatus("dashboard-origin-status", "Needs Setup", "warn");
      return;
    }

    setStatus("dashboard-origin-status", bridgeReachable === false ? "Needs Setup" : "Ready", bridgeReachable === false ? "warn" : "good");
    showInlineWidget(widget, reloadFrame);
    renderLauncherDock();
    updateNowPlayingStrip();
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
    var candidates = ["home", storedLastPrimary, storedWidget, "system"];
    var visibleIds = getDestinationWidgets(primaryDestination).map(function (widget) {
      return widget.id;
    });

    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index];
      if (candidate && candidate !== "setup" && visibleIds.indexOf(candidate) !== -1) {
        return candidate;
      }
    }

    return visibleIds[0] || "home";
  }

  function resolveInitialWidget(preferredWidgetId, explicitWidgetParam) {
    var preferredWidget;

    if (preferredWidgetId && !hasWidgetId(preferredWidgetId)) {
      return getFallbackPrimaryWidget();
    }

    preferredWidget = getWidgetById(preferredWidgetId || "home");

    if (explicitWidgetParam) {
      return shouldShowWidget(preferredWidget) ? preferredWidget.id : getFallbackPrimaryWidget();
    }

    if (!perfMode && !bridgeSetup.onboardingCompleted) {
      primaryDestination = "settings";
      return "setup";
    }

    primaryDestination = "home";
    return "home";
  }

  function selectWidget(widgetId, persistSelection) {
    var settingsIds = ["setup", "theme-studio", "layout-editor", "remote", "updates", "privacy", "installer"];
    if (widgetId === "home") {
      primaryDestination = "home";
    } else if (widgetId === "scenes") {
      primaryDestination = "scenes";
    } else if (settingsIds.indexOf(widgetId) !== -1) {
      primaryDestination = "settings";
    } else if (getDestinationWidgets(primaryDestination).map(function (entry) { return entry.id; }).indexOf(widgetId) === -1) {
      primaryDestination = "library";
    }
    renderPrimaryNavigation();
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
        icsUrlConfigured: false,
        icsHost: ""
      };
    }

    if (!bridgeConfig.hue) {
      bridgeConfig.hue = {
        bridgeIp: "",
        configured: false,
        linked: false
      };
    }

    if (!bridgeConfig.unifi) {
      bridgeConfig.unifi = {
        configured: false,
        linked: false,
        host: "",
        site: "default"
      };
    }

    if (!bridgeConfig.dashboard) {
      bridgeConfig.dashboard = {
        onboardingCompleted: false,
        onboardingCompletedAt: "",
        onboardingVersion: onboardingVersion
      };
    }

    bridgeConfig.dashboard = Object.assign({
      onboardingCompleted: false,
      onboardingCompletedAt: "",
      onboardingVersion: onboardingVersion,
      launcherReviewRequired: true,
      autoApplyLauncherSuggestions: false,
      foregroundAppTrackingEnabled: false,
      preferredDisplayId: "",
      preferredDisplayDeviceName: "",
      performanceBudget: "balanced",
      gameModeAutoTune: true,
      themeReadability: "normal",
      releaseChannel: "stable",
      updateRollbackEnabled: true
    }, bridgeConfig.dashboard);

    bridgeConfig.scenes = Object.assign({
      activeSceneId: "scene-work",
      defaultSceneId: "scene-work",
      automationEnabled: true,
      profiles: []
    }, bridgeConfig.scenes || {});
    var activeScene = (bridgeConfig.scenes.profiles || []).filter(function (scene) {
      return scene && scene.id === bridgeConfig.scenes.activeSceneId;
    })[0];
    if (activeScene && document.body) {
      document.body.dataset.scene = activeScene.id;
      document.body.dataset.density = activeScene.density || "comfortable";
    }

    bridgeSetup = health && health.setup ? health.setup : createBootSetupSummary();
    syncSettingsFromBridgeConfig();
  }

  function handleBridgeOffline() {
    var widget = getWidgetById(currentWidgetId || "system");
    currentWidgetId = widget.id;
    bridgeReachable = false;
    bridgeSetup = createOfflineSetupSummary();
    hideLauncherDock();

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
        renderPrimaryNavigation();
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
      refreshLauncherDock();
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
    reportBackgroundDashboardError(
      "Dashboard promise rejected",
      event ? event.reason : "Unknown promise rejection"
    );
  });

  function scheduleRenderedLayoutProbe() {
    if (getParam("renderedTest") !== "1") {
      return;
    }

    var attempts = 0;
    var runProbe = function () {
      attempts++;
      var viewport = { width: window.innerWidth, height: window.innerHeight };
      var visible = function (element) {
        var style = window.getComputedStyle(element);
        var rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      var rectOf = function (selector) {
        var element = document.querySelector(selector);
        if (!element || !visible(element)) {
          return null;
        }
        var rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      var inBounds = function (rect) {
        return rect && rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1;
      };
      var horizontallyInBounds = function (rect) {
        return rect && rect.left >= -1 && rect.right <= viewport.width + 1;
      };
      var overlaps = function (left, right) {
        return Boolean(left && right && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top);
      };
      var shell = rectOf(".dashboard-stage-shell");
      var navigation = rectOf("#dashboard-primary-nav");
      var viewer = rectOf(".router-viewer");
      var visibleControls = Array.prototype.slice.call(document.querySelectorAll("button, a[href], input, select, textarea"))
        .filter(visible);
      if ((!navigation || !viewer || visibleControls.length < 10) && attempts < 20) {
        window.setTimeout(runProbe, 400);
        return;
      }
      var unnamed = visibleControls.filter(function (element) {
        return !(element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent.trim() || element.labels && element.labels.length);
      });
      var undersized = visibleControls.filter(function (element) {
        var rect = element.getBoundingClientRect();
        return rect.width < 32 || rect.height < 32;
      });
      var settingsButton = document.querySelector('[data-destination="settings"]');
      var keyboardFocus = false;
      var keyboardActivation = false;
      if (settingsButton && visible(settingsButton)) {
        settingsButton.focus();
        keyboardFocus = document.activeElement === settingsButton;
        settingsButton.click();
        keyboardActivation = settingsButton.classList.contains("is-active")
          || settingsButton.getAttribute("aria-current") === "page"
          || settingsButton.getAttribute("aria-pressed") === "true";
      }

      var result = {
        viewport: viewport,
        layoutClass: document.body.dataset.layoutClass || "",
        shell: shell,
        navigation: navigation,
        viewer: viewer,
        shellInBounds: inBounds(shell),
        shellHorizontallyInBounds: horizontallyInBounds(shell),
        navigationInBounds: inBounds(navigation),
        navigationHorizontallyInBounds: horizontallyInBounds(navigation),
        viewerInBounds: inBounds(viewer),
        viewerHorizontallyInBounds: horizontallyInBounds(viewer),
        horizontalOverflow: document.documentElement.scrollWidth > viewport.width + 1,
        navigationViewerOverlap: overlaps(navigation, viewer),
        keyboardFocus: keyboardFocus,
        keyboardActivation: keyboardActivation,
        visibleControlCount: visibleControls.length,
        undersizedControls: undersized.map(function (element) { return element.id || element.getAttribute("aria-label") || element.textContent.trim().slice(0, 60); }),
        unnamedControls: unnamed.map(function (element) { return element.outerHTML.slice(0, 160); })
      };
      var output = document.createElement("script");
      output.id = "auxora-rendered-test-result";
      output.type = "application/json";
      output.textContent = JSON.stringify(result);
      document.body.appendChild(output);
    };
    window.setTimeout(runProbe, 600);
  }

  function bootDashboard() {
    try {
      var explicitWidgetParam = params.has("widget") && params.get("widget") !== "";
      var preferredWidgetId = getParam("widget") || readStoredWidget(widgetStorageKey) || "";

      pickerNode = document.getElementById("dashboard-widget-picker");
      primaryNavNode = document.getElementById("dashboard-primary-nav");
      inlineViewerNode = document.getElementById("dashboard-inline-widget");
      loadingNode = document.getElementById("dashboard-widget-loading");
      settingsNode = document.getElementById("dashboard-widget-settings");
      emptyNode = document.getElementById("dashboard-widget-empty");
      retryNode = document.getElementById("dashboard-widget-retry");
      diagnosticsRailNode = document.getElementById("dashboard-diagnostics-rail");
      diagnosticsInlineNode = document.getElementById("dashboard-diagnostics-inline");
      settingsPanelNode = document.getElementById("dashboard-settings-panel");
      settingsToggleNode = document.getElementById("dashboard-settings-toggle");
      touchLockToggleNode = document.getElementById("dashboard-touch-lock-toggle");
      touchUnlockNode = document.getElementById("dashboard-touch-unlock");
      launcherDockNode = document.getElementById("dashboard-launcher-dock");
      nowStripNode = document.getElementById("dashboard-now-strip");
      touchFeedbackNode = document.getElementById("dashboard-touch-feedback");
      quickDrawerNode = document.getElementById("dashboard-quick-drawer");
      quickToggleNode = document.getElementById("dashboard-quick-toggle");
      try {
        primaryDestination = window.localStorage.getItem(primaryDestinationStorageKey) || "home";
      } catch (error) {
        primaryDestination = "home";
      }
      document.body.classList.toggle("dashboard-native-page--perf", perfMode);
      dashboardSettings = buildInitialSettings();
      widgets = createWidgets();
      applyDashboardPresentation();

      document.addEventListener("pointerdown", markDashboardInteractionActive, { passive: true });
      document.addEventListener("pointerup", markDashboardInteractionIdleSoon, { passive: true });
      document.addEventListener("pointercancel", markDashboardInteractionIdleSoon, { passive: true });
      document.addEventListener("input", function () {
        markDashboardInteractionActive();
        markDashboardInteractionIdleSoon();
      }, true);
      document.addEventListener("change", function () {
        markDashboardInteractionActive();
        markDashboardInteractionIdleSoon();
      }, true);

      setScale();
      initAmbientGraphics();
      renderPrimaryNavigation();

      retryNode.addEventListener("click", function () {
        refreshBridgeState({ moveOffSetup: false });
      });

      diagnosticsRailNode.addEventListener("click", function () {
        primaryDestination = "settings";
        renderPrimaryNavigation();
        selectWidget("setup", false);
      });

      diagnosticsInlineNode.addEventListener("click", function () {
        primaryDestination = "settings";
        renderPrimaryNavigation();
        selectWidget("setup", false);
      });

      if (primaryNavNode) {
        primaryNavNode.addEventListener("click", function (event) {
          var target = event.target && event.target.closest ? event.target.closest("[data-destination]") : null;
          if (target) {
            selectDestination(target.getAttribute("data-destination"));
          }
        });
      }

      if (quickToggleNode) {
        quickToggleNode.addEventListener("click", function () { setQuickDrawerOpen(true); });
      }

      if (quickDrawerNode) {
        quickDrawerNode.addEventListener("click", function (event) {
          var close = event.target && event.target.closest ? event.target.closest("[data-quick-close]") : null;
          var scene = event.target && event.target.closest ? event.target.closest("[data-quick-scene]") : null;
          var widget = event.target && event.target.closest ? event.target.closest("[data-quick-widget]") : null;
          if (close) {
            setQuickDrawerOpen(false);
          } else if (scene) {
            activateScene(scene.getAttribute("data-quick-scene")).then(function () {
              setQuickDrawerOpen(false);
              selectDestination("home");
            }).catch(function (error) { showTouchFeedback(error.message || "Scene failed"); });
          } else if (widget) {
            setQuickDrawerOpen(false);
            primaryDestination = "library";
            renderPrimaryNavigation();
            selectWidget(widget.getAttribute("data-quick-widget"), true);
          }
        });
      }

      if (settingsToggleNode) {
        settingsToggleNode.addEventListener("click", toggleSettingsDrawer);
      }

      if (touchLockToggleNode) {
        touchLockToggleNode.addEventListener("click", function () {
          setTouchLockEnabled(!isTouchLockEnabled());
        });
      }

      if (touchUnlockNode) {
        touchUnlockNode.addEventListener("click", function () {
          setTouchLockEnabled(false);
        });
      }

      setStatus("dashboard-origin-status", "Loading", "warn");
      setText("dashboard-selection-status", "Preparing dashboard");
      setRailCopy();
      renderPicker();
      renderDiagnostics();
      scheduleRenderedLayoutProbe();

      if (isLocalBridgeBlockedByPageOrigin()) {
        showLocalhostWarning(preferredWidgetId || "system");
        window.addEventListener("resize", setScale);
        return;
      }

      checkBridgeAndRender(preferredWidgetId, explicitWidgetParam).then(function () {
        maybeCheckForAvailableUpdate();
        return refreshGameActivity();
      }).catch(function (error) {
        reportFatalDashboardError(
          "Dashboard boot failed",
          error,
          "The dashboard could not finish starting."
        );
      });
      initNowPlayingStrip();
      initLauncherDock();

      scheduleBridgeRefreshLoop();
      scheduleGameActivityLoop();

      window.addEventListener("resize", setScale);
    } catch (error) {
      reportFatalDashboardError(
        "Dashboard boot failed",
        error,
        "The dashboard could not finish starting."
      );
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadAssetRevision().then(bootDashboard, bootDashboard);
  });
}());
