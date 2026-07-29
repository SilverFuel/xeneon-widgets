(function () {
  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime || typeof runtime.registerRenderer !== "function") {
    return;
  }

  var addListener = runtime.addListener;
  var buildBridgeUrl = runtime.buildBridgeUrl;
  var escapeHtml = runtime.escapeHtml;
  var findById = runtime.findById;
  var initXnSlider = runtime.initXnSlider;
  var metricCard = runtime.metricCard;
  var productShell = runtime.productShell;
  var productThemes = runtime.productThemes;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var saveSettings = runtime.saveSettings;
  var settingValue = runtime.settingValue;
  var statusPill = runtime.statusPill;
  var text = runtime.text;

  function mountThemeStudioWidget(widget, container, env) {
    var cleanups = [];

    function redraw() {
      var themes = productThemes(env);
      var activeTheme = settingValue(env, "themeId", "edge");
      var activePreset = findById(themes, activeTheme);
      var accent = settingValue(env, "accentColor", activePreset.accent);
      var intensity = settingValue(env, "animationIntensity", "100");
      var opacity = settingValue(env, "dashboardOpacity", "100");
      var dashboard = env.bridgeConfig && env.bridgeConfig.dashboard ? env.bridgeConfig.dashboard : {};
      var readability = settingValue(env, "themeReadability", text(dashboard.themeReadability, "normal"));
      var performanceBudget = settingValue(env, "performanceBudget", text(dashboard.performanceBudget, "balanced"));
      var gameModeAutoTune = settingValue(env, "gameModeAutoTune", dashboard.gameModeAutoTune === false ? "0" : "1");

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
          '<div class="inline-form-grid inline-form-grid--3">' +
            '<label class="inline-field"><span>Readability</span><select class="inline-select" name="themeReadability">' +
              '<option value="normal"' + (readability === "normal" ? " selected" : "") + '>Normal</option>' +
              '<option value="clean"' + (readability === "clean" ? " selected" : "") + '>Clean</option>' +
              '<option value="high-contrast"' + (readability === "high-contrast" ? " selected" : "") + '>High contrast</option>' +
              '<option value="visor"' + (readability === "visor" ? " selected" : "") + '>Visor</option>' +
            '</select></label>' +
            '<label class="inline-field"><span>Performance</span><select class="inline-select" name="performanceBudget">' +
              '<option value="balanced"' + (performanceBudget === "balanced" ? " selected" : "") + '>Balanced</option>' +
              '<option value="battery"' + (performanceBudget === "battery" ? " selected" : "") + '>Quiet</option>' +
              '<option value="game"' + (performanceBudget === "game" ? " selected" : "") + '>Game</option>' +
              '<option value="max"' + (performanceBudget === "max" ? " selected" : "") + '>Max</option>' +
            '</select></label>' +
            '<label class="inline-field"><span>Game tune</span><select class="inline-select" name="gameModeAutoTune">' +
              '<option value="1"' + (gameModeAutoTune !== "0" ? " selected" : "") + '>On</option>' +
              '<option value="0"' + (gameModeAutoTune === "0" ? " selected" : "") + '>Off</option>' +
            '</select></label>' +
          '</div>' +
          '<div class="product-range-grid">' +
            '<label class="inline-field product-range-field"><span>Motion ' + escapeHtml(intensity) + '%</span><input class="inline-range" type="range" name="animationIntensity" min="0" max="140" aria-label="Animation intensity" value="' + escapeHtml(intensity) + '"></label>' +
            '<label class="inline-field product-range-field"><span>Opacity ' + escapeHtml(opacity) + '%</span><input class="inline-range" type="range" name="dashboardOpacity" min="35" max="100" aria-label="Dashboard opacity" value="' + escapeHtml(opacity) + '"></label>' +
          '</div>' +
          '</form>'
      );
      initXnSlider(container);
    }

    function saveForm(form) {
      var data = new FormData(form);
      saveSettings(env, {
        themeId: String(data.get("themeId") || "edge"),
        accentColor: String(data.get("accentColor") || ""),
        animationIntensity: String(data.get("animationIntensity") || "100"),
        dashboardOpacity: String(data.get("dashboardOpacity") || "100"),
        themeReadability: String(data.get("themeReadability") || "normal"),
        performanceBudget: String(data.get("performanceBudget") || "balanced"),
        gameModeAutoTune: String(data.get("gameModeAutoTune") || "1")
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
      var pinned = settingValue(env, "pinnedWidgets", "").split(",").filter(Boolean);
      var hidden = settingValue(env, "hiddenWidgets", "").split(",").filter(Boolean);
      var sizes = {};
      try { sizes = JSON.parse(settingValue(env, "cardSizes", "{}")); } catch (error) { sizes = {}; }
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
                  '<button class="inline-button" type="button" data-layout-action="pin" data-id="' + escapeHtml(row.id) + '">' + (pinned.indexOf(row.id) !== -1 ? "Unpin" : "Pin") + '</button>' +
                  '<button class="inline-button" type="button" data-layout-action="size" data-id="' + escapeHtml(row.id) + '">Size: ' + escapeHtml(sizes[row.id] || "standard") + '</button>' +
                  '<button class="inline-button" type="button" data-layout-action="hide" data-id="' + escapeHtml(row.id) + '">' + (hidden.indexOf(row.id) !== -1 ? "Show" : "Hide") + '</button>' +
                '</div>' +
              '</div>';
          }).join("") +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button" type="button" data-layout-action="reset">Reset order</button>' +
          '<button class="inline-button is-primary" type="button" data-layout-action="theme">Open theme studio</button>' +
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

      if (action === "theme") {
        if (typeof env.selectWidget === "function") {
          env.selectWidget("theme-studio", true);
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

      if (action === "pin" || action === "hide") {
        var key = action === "pin" ? "pinnedWidgets" : "hiddenWidgets";
        var values = settingValue(env, key, "").split(",").filter(Boolean);
        values = values.indexOf(id) === -1 ? values.concat([id]) : values.filter(function (value) { return value !== id; });
        var update = {};
        update[key] = values.join(",");
        saveSettings(env, update);
        redraw();
        return;
      }

      if (action === "size") {
        var cardSizes = {};
        try { cardSizes = JSON.parse(settingValue(env, "cardSizes", "{}")); } catch (error) { cardSizes = {}; }
        var choices = ["compact", "standard", "wide"];
        var current = choices.indexOf(cardSizes[id] || "standard");
        cardSizes[id] = choices[(current + 1) % choices.length];
        saveSettings(env, { cardSizes: JSON.stringify(cardSizes) });
        redraw();
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
      current: "",
      updateAvailable: false,
      latestUrl: "https://github.com/SilverFuel/xeneon-widgets/releases",
      downloadUrl: "",
      macUrl: "",
      hashStatus: "missing",
      signatureStatus: "missing",
      trustReady: false,
      channel: "stable",
      rollback: {
        configured: false,
        message: "Rollback will be available after a healthy installed build is recorded."
      },
      message: "Check the release feed when you are ready to update.",
      statusText: "Ready",
      statusTone: "good",
      busy: false
    };

    function redraw() {
      var dashboard = env.bridgeConfig && env.bridgeConfig.dashboard ? env.bridgeConfig.dashboard : {};
      var channel = settingValue(env, "releaseChannel", settingValue(env, "updateChannel", text(dashboard.releaseChannel, "stable")));
      var updateNotifications = settingValue(env, "updateNotifications", "0") === "1";
      if (["stable", "beta", "nightly"].indexOf(channel) === -1) {
        channel = "stable";
      }
      state.channel = channel;
      container.innerHTML = productShell(
        "Auto-update foundation",
        "Updates",
        "Check the public release feed from the local host so customers have one clear update path.",
        state.statusText,
        state.statusTone,
        '<div class="inline-grid inline-grid--4">' +
          metricCard("Current build", state.current || env.assetRevision || "local", "Installed host version", null) +
          metricCard("Latest release", state.latest || "Not checked", state.updateAvailable ? "Newer than your installed build" : state.message, null) +
          metricCard("Installer", state.downloadUrl ? "Found" : "Not checked", state.macUrl ? "Windows and Mac assets" : "Windows asset expected", null) +
          metricCard("Trust", state.trustReady ? "Available" : "Not verified", "Proof files: hash " + state.hashStatus + " / signature " + state.signatureStatus + ". Presence is not verification.", null) +
          metricCard("Rollback", state.rollback.configured ? "Ready" : "Pending", state.rollback.message, null) +
        '</div>' +
        '<form class="inline-form product-control-panel" data-form="updates">' +
          '<label class="inline-field"><span>Release channel</span><select class="inline-select" name="releaseChannel">' +
            '<option value="stable"' + (channel === "stable" ? " selected" : "") + '>Stable</option>' +
            '<option value="beta"' + (channel === "beta" ? " selected" : "") + '>Beta</option>' +
            '<option value="nightly"' + (channel === "nightly" ? " selected" : "") + '>Nightly</option>' +
          '</select></label>' +
          '<label class="inline-field inline-field--checkbox"><input type="checkbox" name="updateNotifications"' + (updateNotifications ? " checked" : "") + '> <span>Check for updates when the dashboard starts</span></label>' +
        '</form>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="check-release"' + (state.busy ? " disabled" : "") + '>Check releases</button>' +
          '<button class="inline-button" type="button" data-action="check-rollback"' + (state.busy ? " disabled" : "") + '>Check rollback</button>' +
          (state.downloadUrl ? '<a class="inline-button" href="' + escapeHtml(state.downloadUrl) + '" target="_blank" rel="noreferrer">Windows installer</a>' : '') +
          (state.macUrl ? '<a class="inline-button" href="' + escapeHtml(state.macUrl) + '" target="_blank" rel="noreferrer">Mac package</a>' : '') +
          '<a class="inline-button" href="' + escapeHtml(state.latestUrl) + '" target="_blank" rel="noreferrer">Open releases</a>' +
        '</div>' +
        '<div class="product-checklist">' +
          '<span>Hash ' + escapeHtml(state.hashStatus) + '</span><span>Signature ' + escapeHtml(state.signatureStatus) + '</span><span>Versioned setup EXE</span><span>Rollback download</span>' +
        '</div>'
      );
    }

    function checkLatestRelease() {
      state.busy = true;
      state.statusText = "Checking";
      state.statusTone = "warn";
      redraw();

      requestJson(buildBridgeUrl(env, "/api/releases/latest", { channel: state.channel }), {}, 10000).then(function (payload) {
        state.busy = false;
        state.latest = text(payload && (payload.latestVersion || payload.tag_name || payload.name), "No release tag");
        state.current = text(payload && payload.currentVersion, state.current);
        state.updateAvailable = Boolean(payload && payload.updateAvailable);
        state.latestUrl = text(payload && (payload.htmlUrl || payload.html_url), state.latestUrl);
        state.downloadUrl = text(payload && payload.installerUrl, "");
        state.macUrl = text(payload && payload.macUrl, "");
        state.hashStatus = text(payload && payload.hashStatus, "missing");
        state.signatureStatus = text(payload && payload.signatureStatus, "missing");
        state.trustReady = state.hashStatus === "available" && state.signatureStatus === "available";
        state.message = text(payload && payload.message, "Release feed checked.");
        state.statusText = payload && payload.status === "live" ? (state.updateAvailable ? "Update available" : "Up to date") : "Check failed";
        state.statusTone = payload && payload.status === "live" ? (state.updateAvailable ? "warn" : "good") : "danger";
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Check failed";
        state.statusTone = "danger";
        state.message = state.statusText;
        redraw();
      });
    }

    function checkRollback() {
      state.busy = true;
      state.statusText = "Checking";
      state.statusTone = "warn";
      redraw();

      requestJson(buildBridgeUrl(env, "/api/releases/rollback"), {
        method: "POST",
        body: {}
      }, 6000).then(function (payload) {
        state.busy = false;
        state.rollback = payload || state.rollback;
        state.statusText = payload && payload.configured ? "Rollback ready" : "Rollback pending";
        state.statusTone = payload && payload.configured ? "good" : "warn";
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Rollback check failed";
        state.statusTone = "danger";
        state.rollback.message = state.statusText;
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      if (target && target.getAttribute("data-action") === "check-release") {
        checkLatestRelease();
      } else if (target && target.getAttribute("data-action") === "check-rollback") {
        checkRollback();
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var select = event.target;
      if (select && select.name === "releaseChannel") {
        saveSettings(env, {
          releaseChannel: select.value,
          updateChannel: select.value
        });
        redraw();
      } else if (select && select.name === "updateNotifications") {
        saveSettings(env, {
          updateNotifications: select.checked ? "1" : "0"
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

  var productProfiles = [
    {
      id: "glance",
      name: "Glance",
      copy: "Large, immediate system, network, audio, and Game Mode information for a quick glance.",
      themeId: "edge",
      pack: "core",
      layout: ["system", "network", "audio", "game-mode", "quick-actions", "privacy"]
    },
    {
      id: "command",
      name: "Command",
      copy: "Balanced daily dashboard with setup, telemetry, sound, style, and packaging close at hand.",
      themeId: "edge",
      pack: "core",
      layout: ["system", "network", "audio", "theme-studio", "layout-editor", "updates", "installer", "privacy"]
    },
    {
      id: "gaming",
      name: "Gaming",
      copy: "System pressure, network state, audio, and game mode first.",
      themeId: "deepcore",
      pack: "gaming",
      layout: ["game-mode", "system", "network", "audio", "quick-actions", "theme-studio", "updates"]
    },
    {
      id: "streaming",
      name: "Streaming",
      copy: "OBS, audio and media controls, system load, and release confidence.",
      themeId: "afterburn",
      pack: "streamer",
      layout: ["streaming", "audio", "system", "network", "quick-actions", "theme-studio", "updates", "privacy"]
    },
    {
      id: "homelab",
      name: "Home Lab",
      copy: "Network, NAS, Plex, cameras, and automation panels move forward.",
      themeId: "verdant",
      pack: "homelab",
      layout: ["network", "nas", "plex", "unifi-camera", "automation", "hue", "system", "marketplace", "privacy"]
    },
    {
      id: "minimal",
      name: "Minimal",
      copy: "A clean product demo surface with the essentials and privacy visible.",
      themeId: "edge",
      pack: "core",
      layout: ["system", "network", "theme-studio", "privacy", "installer", "updates"]
    }
  ];

  var productPacks = [
    {
      id: "glance",
      name: "Glance",
      copy: "Core telemetry, audio, Game Mode, and only the controls useful at a glance.",
      layout: ["system", "network", "audio", "game-mode", "quick-actions", "privacy"]
    },
    {
      id: "core",
      name: "Core Owner",
      copy: "System, network, audio/media, setup, and trust panels for a normal install.",
      layout: ["system", "network", "audio", "theme-studio", "layout-editor", "installer", "privacy"]
    },
    {
      id: "gaming",
      name: "Gaming Desk",
      copy: "Telemetry, audio/media, and game mode for a player-focused panel.",
      layout: ["game-mode", "system", "network", "audio", "quick-actions", "theme-studio"]
    },
    {
      id: "streamer",
      name: "Streamer",
      copy: "OBS, audio/media, quick actions, update checks, and privacy up front.",
      layout: ["streaming", "audio", "quick-actions", "system", "network", "updates", "privacy"]
    },
    {
      id: "homelab",
      name: "Home Lab",
      copy: "NAS, Plex, cameras, automation, Hue, and network health.",
      layout: ["network", "nas", "plex", "unifi-camera", "automation", "hue", "system", "marketplace"]
    }
  ];

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

  function mountAuxoraHomeWidget(widget, container, env) {
    var cleanups = [];
    var longPressTimer = 0;
    var state = {
      scenes: null,
      system: null,
      network: null,
      calendar: null,
      chains: null,
      loading: true,
      message: "Building your Glance briefing"
    };

    function value(value, suffix) {
      var parsed = Number(value);
      return Number.isFinite(parsed) ? Math.round(parsed) + (suffix || "") : "--";
    }

    function activeScene() {
      return state.scenes && state.scenes.activeScene ? state.scenes.activeScene : {};
    }

    function briefing() {
      var parts = [];
      var entries = state.calendar && Array.isArray(state.calendar.entries) ? state.calendar.entries : [];
      var chains = state.chains && Array.isArray(state.chains.chains) ? state.chains.chains : [];
      var cpu = Number(state.system && state.system.cpu);
      var ping = Number(state.network && state.network.ping);
      if (entries.length) {
        parts.push(entries.length + (entries.length === 1 ? " upcoming event" : " upcoming events"));
      }
      if (Number.isFinite(ping)) {
        parts.push(ping > 80 ? "network latency needs attention" : "network is responsive");
      }
      if (Number.isFinite(cpu)) {
        parts.push(cpu > 90 ? "CPU load is high" : "PC health looks good");
      }
      return parts.length ? parts.join(" · ") : "Auxora is ready for your " + text(activeScene().name, "Work") + " Scene.";
    }

    function redraw() {
      var scene = activeScene();
      var entries = state.calendar && Array.isArray(state.calendar.entries) ? state.calendar.entries : [];
      var chains = state.chains && Array.isArray(state.chains.chains) ? state.chains.chains : [];
      container.innerHTML = productShell(
        "Smart Glance",
        "Good " + (new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"),
        briefing(),
        text(scene.name, state.loading ? "Loading" : "Work"),
        state.loading ? "warn" : "good",
        '<div class="auxora-glance-hero"><div><span>Active Mode</span><strong>' + escapeHtml(text(scene.name, "Work")) + '</strong><small>' + escapeHtml(text(state.scenes && state.scenes.lastActivationReason, "Default Mode")) + '</small></div><div class="auxora-glance-clock">' + escapeHtml(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + '</div></div>' +
        '<div class="inline-grid inline-grid--4">' +
          metricCard("CPU", value(state.system && state.system.cpu, "%"), state.system && state.system.cpuTemp != null ? value(state.system.cpuTemp, "°") : "System load") +
          metricCard("Memory", value(state.system && state.system.ram, "%"), "Memory pressure") +
          metricCard("Network", state.network && state.network.ping != null ? value(state.network.ping, " ms") : "--", state.network && state.network.name ? state.network.name : "Latency") +
          metricCard("Next", entries.length ? text(entries[0].title, "Event") : "Clear", entries.length ? text(entries[0].time, text(entries[0].detail, "Upcoming")) : "No upcoming events") +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-home-open="audio">Audio & media</button>' +
          '<button class="inline-button" type="button" data-home-open="quick-actions">Quick actions</button>' +
          '<button class="inline-button" type="button" data-home-open="system">System detail</button>' +
          '<button class="inline-button" type="button" data-home-open="layout-editor">Edit Home</button>' +
        '</div>' +
        '<article class="list-card inline-card auxora-glance-chains"><div class="inline-card-header"><div><div class="metric-label">One-tap chains</div><div class="router-inline-copy">Safe local combinations for the moment you are moving into.</div></div></div><div class="inline-actions">' + chains.map(function (chain) {
          return '<button class="inline-button" type="button" data-action-chain="' + escapeHtml(chain.id) + '" title="' + escapeHtml(chain.description) + '">' + escapeHtml(chain.name) + '</button>';
        }).join("") + '</div></article>'
      );
    }

    function refresh() {
      state.loading = true;
      redraw();
      return Promise.all([
        requestJson(buildBridgeUrl(env, "/api/scenes"), {}, 6000),
        requestJson(buildBridgeUrl(env, "/api/system"), {}, 6000),
        requestJson(buildBridgeUrl(env, "/api/network"), {}, 6000),
        requestJson(buildBridgeUrl(env, "/api/calendar"), {}, 6000).catch(function () { return {}; }),
        requestJson(buildBridgeUrl(env, "/api/action-chains"), {}, 6000).catch(function () { return {}; })
      ]).then(function (payloads) {
        state.scenes = payloads[0];
        state.system = payloads[1];
        state.network = payloads[2];
        state.calendar = payloads[3];
        state.chains = payloads[4];
        state.loading = false;
        redraw();
      }, function (error) {
        state.loading = false;
        state.message = error.message || "Glance data is unavailable";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-home-open]") : null;
      var chain = event.target && event.target.closest ? event.target.closest("[data-action-chain]") : null;
      if (target && typeof env.selectWidget === "function") {
        env.selectWidget(target.getAttribute("data-home-open"), true);
      } else if (chain) {
        requestJson(buildBridgeUrl(env, "/api/action-chains/execute"), {
          method: "POST", body: { chainId: chain.getAttribute("data-action-chain") }
        }, 9000).then(function (payload) {
          state.message = text(payload.message, "Action chain complete");
          if (payload.scene && payload.scene.activeScene && typeof env.activateScene === "function") {
            return env.activateScene(payload.scene.activeScene.id, 120);
          }
        }).then(refresh, function (error) {
          state.message = error.message || "Action chain failed";
          redraw();
        });
      }
    });

    addListener(cleanups, container, "pointerdown", function (event) {
      if (event.target && event.target.closest && event.target.closest("button,a,input,select,textarea")) {
        return;
      }
      window.clearTimeout(longPressTimer);
      longPressTimer = window.setTimeout(function () {
        if (typeof env.selectWidget === "function") {
          env.selectWidget("layout-editor", true);
        }
      }, 700);
    });
    ["pointerup", "pointercancel", "pointermove"].forEach(function (type) {
      addListener(cleanups, container, type, function () { window.clearTimeout(longPressTimer); });
    });

    redraw();
    refresh();
    return {
      refresh: refresh,
      destroy: function () {
        window.clearTimeout(longPressTimer);
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }

  function mountScenesWidget(widget, container, env) {
    var cleanups = [];
    var state = { payload: null, displays: [], busy: false, message: "Loading Modes", tone: "warn" };

    function modeMessage(value, fallback) {
      return text(value, fallback).replace(/\bScenes\b/g, "Modes").replace(/\bScene\b/g, "Mode");
    }

    function redraw() {
      var profiles = state.payload && Array.isArray(state.payload.profiles) ? state.payload.profiles : [];
      var activeId = text(state.payload && state.payload.activeSceneId, "scene-work");
      var assignments = state.payload && Array.isArray(state.payload.displayAssignments) ? state.payload.displayAssignments : [];
      container.innerHTML = productShell(
        "Adaptive experience",
        "Modes",
        "Change Auxora's layout, energy, controls, and priorities in one tap.",
        state.message,
        state.tone,
        '<div class="product-profile-grid auxora-scene-grid">' + profiles.map(function (scene) {
          var active = scene.id === activeId;
          return '<article class="product-card' + (active ? " is-selected" : "") + '">' +
            '<span class="product-card__topline">' + escapeHtml(scene.icon || "scene") + (scene.isBuiltIn ? " · Built in" : " · Custom") + '</span>' +
            '<strong>' + escapeHtml(scene.name) + '</strong>' +
            '<span class="product-card__meta">' + escapeHtml((scene.widgets || []).slice(0, 5).join(" · ")) + '</span>' +
            '<div class="auxora-scene-stats"><span>' + escapeHtml(scene.density) + '</span><span>' + escapeHtml(String(scene.brightness)) + '% light</span><span>' + escapeHtml(scene.performanceBudget) + '</span></div>' +
            (state.displays.length ? '<label class="inline-field"><span>Assigned display</span><select class="inline-select" data-scene-display="' + escapeHtml(scene.id) + '"><option value="">Not assigned</option>' + state.displays.map(function (display) {
              var assignment = assignments.filter(function (item) { return item.displayId === display.id && item.sceneId === scene.id; })[0];
              return '<option value="' + escapeHtml(display.id) + '"' + (assignment ? " selected" : "") + '>' + escapeHtml(display.label) + '</option>';
            }).join("") + '</select></label>' : '') +
            '<div class="inline-actions"><button class="inline-button' + (active ? " is-primary" : "") + '" type="button" data-scene-activate="' + escapeHtml(scene.id) + '"' + (state.busy ? " disabled" : "") + '>' + (active ? "Active" : "Use Mode") + '</button><button class="inline-button" type="button" data-scene-duplicate="' + escapeHtml(scene.id) + '"' + (state.busy ? " disabled" : "") + '>Duplicate</button></div>' +
          '</article>';
        }).join("") + '</div>' +
        '<div class="inline-actions"><button class="inline-button is-primary" type="button" data-scene-resume' + (state.busy ? " disabled" : "") + '>Resume automatic switching</button><span class="inline-copy">Manual override: ' + escapeHtml(text(state.payload && state.payload.manualOverrideUntil, "off")) + '</span></div>'
      );
    }

    function refresh() {
      return Promise.all([
        requestJson(buildBridgeUrl(env, "/api/scenes"), {}, 6000),
        requestJson(buildBridgeUrl(env, "/api/display/diagnostics"), {}, 6000).catch(function () { return {}; })
      ]).then(function (payloads) {
        state.payload = payloads[0];
        state.displays = Array.isArray(payloads[1].displays) ? payloads[1].displays : [];
        state.message = modeMessage(payloads[0].message, "Modes ready");
        state.tone = "good";
        redraw();
      }, function (error) {
        state.message = modeMessage(error.message, "Modes unavailable");
        state.tone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var activate = event.target && event.target.closest ? event.target.closest("[data-scene-activate]") : null;
      var duplicate = event.target && event.target.closest ? event.target.closest("[data-scene-duplicate]") : null;
      var resume = event.target && event.target.closest ? event.target.closest("[data-scene-resume]") : null;
      var operation;
      if (activate && typeof env.activateScene === "function") {
        state.busy = true;
        operation = env.activateScene(activate.getAttribute("data-scene-activate"), 120);
      } else if (resume && typeof env.resumeSceneAutomation === "function") {
        state.busy = true;
        operation = env.resumeSceneAutomation();
      } else if (duplicate) {
        state.busy = true;
        operation = requestJson(buildBridgeUrl(env, "/api/scenes/duplicate"), {
          method: "POST", body: { sceneId: duplicate.getAttribute("data-scene-duplicate") }
        }, 7000);
      }
      if (operation) {
        Promise.resolve(operation).then(function (payload) {
          state.payload = payload;
          state.message = modeMessage(payload.message, "Mode updated");
          state.tone = "good";
        }, function (error) {
          state.message = modeMessage(error.message, "Mode update failed");
          state.tone = "danger";
        }).finally(function () {
          state.busy = false;
          redraw();
        });
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      if (!target || !target.hasAttribute("data-scene-display") || !target.value) {
        return;
      }
      state.busy = true;
      requestJson(buildBridgeUrl(env, "/api/scenes/displays"), {
        method: "POST", body: { displayId: target.value, sceneId: target.getAttribute("data-scene-display") }
      }, 7000).then(function (payload) {
        state.payload = payload;
        state.message = "Display assignment saved";
        state.tone = "good";
      }, function (error) {
        state.message = error.message || "Display assignment failed";
        state.tone = "danger";
      }).finally(function () { state.busy = false; redraw(); });
    });

    redraw();
    refresh();
    return { refresh: refresh, destroy: function () { runCleanups(cleanups); container.innerHTML = ""; } };
  }

  function monitorInputLabel(value) {
    var input = Number(value);
    var names = {
      1: "VGA 1",
      2: "VGA 2",
      3: "DVI 1",
      4: "DVI 2",
      5: "Composite 1",
      6: "Composite 2",
      7: "S-Video 1",
      8: "S-Video 2",
      9: "TV tuner 1",
      10: "TV tuner 2",
      11: "TV tuner 3",
      12: "Component 1",
      13: "Component 2",
      14: "Component 3",
      15: "DisplayPort 1",
      16: "DisplayPort 2",
      17: "HDMI 1",
      18: "HDMI 2",
      27: "USB-C"
    };
    return names[input] || "Input " + input;
  }

  function mountDisplayControlsWidget(widget, container, env) {
    var cleanups = [];
    var state = { payload: null, busy: false, confirmPowerIndex: -1, message: "Checking monitor controls", tone: "warn" };

    function redraw() {
      var displays = state.payload && Array.isArray(state.payload.displays) ? state.payload.displays : [];
      container.innerHTML = productShell(
        "Monitor control",
        "Displays",
        "Control only the capabilities each monitor reports through Windows DDC/CI.",
        state.message,
        state.tone,
        displays.length ? '<div class="inline-list">' + displays.map(function (display) {
          return '<article class="list-card inline-card"><div class="inline-card-header"><div><div class="metric-label">Display ' + escapeHtml(String(display.index + 1)) + '</div><h3 class="inline-title">' + escapeHtml(display.name) + '</h3></div>' + statusPill(display.brightnessSupported || display.contrastSupported ? "DDC/CI" : "Limited", display.brightnessSupported || display.contrastSupported ? "good" : "warn") + '</div>' +
            '<div class="inline-form-grid inline-form-grid--2">' +
              (display.brightnessSupported ? '<label class="inline-field product-range-field"><span>Brightness ' + escapeHtml(String(display.brightness)) + '%</span><input class="inline-range" type="range" min="0" max="100" value="' + escapeHtml(String(display.brightness)) + '" aria-label="Brightness for ' + escapeHtml(display.name) + '" data-monitor-control="brightness" data-monitor-index="' + display.index + '"></label>' : '') +
              (display.contrastSupported ? '<label class="inline-field product-range-field"><span>Contrast ' + escapeHtml(String(display.contrast)) + '%</span><input class="inline-range" type="range" min="0" max="100" value="' + escapeHtml(String(display.contrast)) + '" aria-label="Contrast for ' + escapeHtml(display.name) + '" data-monitor-control="contrast" data-monitor-index="' + display.index + '"></label>' : '') +
            '</div>' +
            '<div class="inline-actions">' +
              (display.inputSupported ? '<label class="inline-field"><span>Input source: ' + escapeHtml(monitorInputLabel(display.inputSource)) + '</span><input class="inline-input" type="number" min="1" max="31" value="' + escapeHtml(String(display.inputSource)) + '" data-monitor-control="input" data-monitor-index="' + display.index + '"></label>' : '') +
              (display.powerSupported ? '<button class="inline-button" type="button" data-monitor-power="' + display.index + '">' + (state.confirmPowerIndex === display.index ? "Confirm display off" : "Turn display off") + '</button>' : '') +
            '</div></article>';
        }).join("") + '</div>' : '<div class="inline-empty"><strong>No DDC/CI controls found</strong><span>Auxora hides unavailable monitor controls. Enable DDC/CI in the monitor menu if it is supported.</span></div>'
      );
      initXnSlider(container);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/displays/controls"), {}, 8000).then(function (payload) {
        state.payload = payload;
        state.message = text(payload.message, "Monitor controls checked");
        state.tone = payload.supported ? "good" : "warn";
        redraw();
      }, function (error) {
        state.message = error.message || "Monitor controls unavailable";
        state.tone = "danger";
        redraw();
      });
    }

    function setControl(index, control, value) {
      state.busy = true;
      return requestJson(buildBridgeUrl(env, "/api/displays/controls"), {
        method: "POST", body: { displayIndex: Number(index), control: control, value: Number(value) }
      }, 8000).then(function (payload) {
        state.payload = payload;
        state.message = control + " updated";
        state.tone = "good";
      }, function (error) {
        state.message = error.message || "Monitor update failed";
        state.tone = "danger";
      }).finally(function () {
        state.busy = false;
        state.confirmPowerIndex = -1;
        redraw();
      });
    }

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      if (target && target.hasAttribute("data-monitor-control")) {
        setControl(target.getAttribute("data-monitor-index"), target.getAttribute("data-monitor-control"), target.value);
      }
    });
    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-monitor-power]") : null;
      var index;
      if (!target) {
        return;
      }
      index = Number(target.getAttribute("data-monitor-power"));
      if (state.confirmPowerIndex !== index) {
        state.confirmPowerIndex = index;
        state.message = "Tap again to turn this display off";
        state.tone = "warn";
        redraw();
        return;
      }
      setControl(index, "power", 0);
    });

    redraw();
    refresh();
    return { refresh: refresh, destroy: function () { runCleanups(cleanups); container.innerHTML = ""; } };
  }

  function mountRemoteWidget(widget, container, env) {
    container.innerHTML = productShell(
      "Not included in 0.3.0-beta.1",
      "Phone Remote",
      "Phone Remote is unavailable for this beta. Auxora does not open a phone-control listener or create remote links.",
      "Unavailable",
      "muted",
      '<div class="inline-empty"><strong>No phone session is available</strong><span>There is no phone-control action in this build. Use the Auxora display on this PC.</span></div>'
    );
    return { refresh: function () { return Promise.resolve(); }, destroy: function () { container.innerHTML = ""; } };
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
        "Keep a stream-ready control surface nearby. This beta only verifies local OBS reachability; it does not issue OBS commands.",
        state.statusText,
        state.statusTone,
        '<form class="inline-form product-control-panel" data-form="streaming">' +
          '<div class="inline-form-grid inline-form-grid--2">' +
            '<label class="inline-field"><span>OBS address</span><input class="inline-input" type="text" name="obsEndpoint" value="' + escapeHtml(endpoint) + '" placeholder="ws://127.0.0.1:4455"></label>' +
            '<label class="inline-field"><span>Main scene</span><input class="inline-input" type="text" name="streamScene" value="' + escapeHtml(scene) + '" placeholder="Main"></label>' +
          '</div>' +
        '</form>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Scene", scene, "Saved locally", null) +
          metricCard("OBS", state.statusText, "Connection probe", null) +
          metricCard("Layout", "Stream controls", "Quick glance setup", null) +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="probe-obs"' + (state.busy ? " disabled" : "") + '>Check OBS connection</button>' +
          '<button class="inline-button" type="button" data-action="open-media">Open Audio & Media</button>' +
          '<button class="inline-button" type="button" data-action="stream-profile">Use streaming layout</button>' +
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
        env.selectWidget("audio", true);
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

  function mountMarketplaceWidget(widget, container, env) {
    var cleanups = [];
    var state = { extensions: [], trustedPublisherCount: 0, message: "Checking extension trust", tone: "warn" };

    function redraw() {
      var activePack = settingValue(env, "marketplacePack", "core");
      container.innerHTML = productShell(
        "Marketplace packs",
        "Widget Packs",
        "Apply local curated dashboard bundles. Downloadable packs stay disabled until signed manifests and permission review are available.",
        findById(productPacks, activePack).name,
        "good",
        '<div class="product-profile-grid product-profile-grid--packs">' +
          productPacks.map(function (pack) {
            return productButtonCard(pack, pack.id === activePack, "pack", '<span class="product-card__meta">' + escapeHtml(pack.layout.length + " panels") + '</span>');
          }).join("") +
        '</div>' +
        '<div class="product-checklist">' +
          '<span>Pack manifest</span><span>Screenshots</span><span>Version tags</span><span>Support link</span>' +
        '</div>' +
        '<article class="list-card inline-card"><div class="inline-card-header"><div><div class="metric-label">Installed extensions</div><div class="router-inline-copy">' + escapeHtml(state.message) + ' · ' + escapeHtml(String(state.trustedPublisherCount)) + ' trusted publishers</div></div>' + statusPill(state.extensions.some(function (extension) { return extension.runnable; }) ? "Verified" : "Locked", state.extensions.some(function (extension) { return extension.runnable; }) ? "good" : "warn") + '</div><div class="inline-list">' + (state.extensions.length ? state.extensions.map(function (extension) {
          return '<div class="inline-list-item"><div><strong>' + escapeHtml(extension.name) + '</strong><div class="inline-list-copy">' + escapeHtml(extension.message) + '</div><div class="inline-list-meta">' + escapeHtml((extension.permissions || []).join(" · ") || "No permissions") + '</div></div>' + statusPill(extension.runnable ? "Runnable" : "Rejected", extension.runnable ? "good" : "danger") + '</div>';
        }).join("") : '<div class="inline-empty"><strong>No extensions installed</strong><span>Curated built-in packs remain available. Third-party code stays locked until it passes signature and permission checks.</span></div>') + '</div></article>'
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

    function refreshExtensions() {
      return requestJson(buildBridgeUrl(env, "/api/extensions"), {}, 7000).then(function (payload) {
        state.extensions = Array.isArray(payload.extensions) ? payload.extensions : [];
        state.trustedPublisherCount = Number(payload.trustedPublisherCount || 0);
        state.message = text(payload.message, "Extension trust checked");
        state.tone = "good";
        redraw();
      }, function (error) {
        state.message = error.message || "Extension trust unavailable";
        state.tone = "danger";
        redraw();
      });
    }

    redraw();
    refreshExtensions();
    return {
      refresh: function () {
        return refreshExtensions();
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
      statusText: "Checking recovery actions",
      statusTone: "warn",
      busy: false,
      actions: []
    };

    function redraw() {
      container.innerHTML = productShell(
        "Customer recovery",
        "Recovery",
        "Use these actions when the dashboard or installed app needs help. Actions that require installed support files stay disabled in an unpackaged development run.",
        state.statusText,
        state.statusTone,
        '<div class="inline-list">' + (state.actions.length ? state.actions.map(function (action) {
          return '<div class="inline-list-item"><div><strong>' + escapeHtml(action.label) + '</strong><div class="inline-list-copy">' + escapeHtml(action.message) + '</div></div>' +
            '<button class="inline-button" type="button" data-recovery-action="' + escapeHtml(action.id) + '"' + ((!action.available || state.busy) ? " disabled" : "") + ' aria-label="' + escapeHtml(action.label) + '">' + escapeHtml(action.label) + '</button></div>';
        }).join("") : '<div class="inline-empty"><strong>Recovery actions are loading</strong><span>Auxora is checking which customer actions are available in this run.</span></div>') + '</div>'
      );
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/recovery"), {}, 7000).then(function (payload) {
        state.actions = Array.isArray(payload.actions) ? payload.actions : [];
        state.statusText = text(payload.message, "Recovery actions checked");
        state.statusTone = "good";
      }, function (error) {
        state.actions = [];
        state.statusText = error.message || "Recovery actions unavailable";
        state.statusTone = "danger";
      }).finally(redraw);
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-recovery-action]") : null;
      var action;
      if (!target) {
        return;
      }

      action = target.getAttribute("data-recovery-action");
      if (action === "retry") {
        state.statusText = "Retrying dashboard";
        state.statusTone = "warn";
        redraw();
        window.location.reload();
        return;
      }

      state.busy = true;
      state.statusText = "Starting " + action;
      state.statusTone = "warn";
      redraw();
      requestJson(buildBridgeUrl(env, "/api/recovery/action"), {
        method: "POST",
        body: { action: action }
      }, 8000).then(function (payload) {
        state.statusText = text(payload.message, "Recovery action started");
        state.statusTone = payload.ok ? "good" : "warn";
      }, function (error) {
        state.statusText = error.message || "Recovery action failed";
        state.statusTone = "danger";
      }).finally(function () {
        state.busy = false;
        redraw();
      });
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

  function mountPrivacyWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      statusText: "Local-only",
      statusTone: "good",
      confirmReset: false,
      diagnosticEvents: [],
      diagnosticsBusy: false,
      foregroundTrackingEnabled: Boolean(env.bridgeConfig && env.bridgeConfig.dashboard && env.bridgeConfig.dashboard.foregroundAppTrackingEnabled)
    };

    function redraw() {
      var settings = typeof env.getSettings === "function" ? env.getSettings() : {};
      container.innerHTML = productShell(
        "Trust and portability",
        "Privacy",
        "Review what stays local, then safely export or import dashboard-only preferences without exposing credentials.",
        state.statusText,
        state.statusTone,
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Local settings", "Browser storage", "Theme, layout, endpoints", null) +
          metricCard("Bridge data", "127.0.0.1", "System, network, audio", null) +
          metricCard("Cloud calls", "Optional", "Weather and release checks", null) +
        '</div>' +
        '<div class="product-privacy-list">' +
          '<div><strong>Stays on this PC</strong><span>Dashboard preferences, widget endpoints, layout, OBS target, and recovery state.</span></div>' +
          '<div><strong>Requires permission</strong><span>Weather keys, calendar feeds, Hue bridge pairing, and optional connectors you enable.</span></div>' +
          '<div><strong>Foreground-app tracking is ' + (state.foregroundTrackingEnabled ? "on" : "off") + '</strong><span>When on, Auxora observes the active app executable path and stores its display name, path, source, and last-opened time locally. Up to 24 recent entries are retained until you turn this off or reset app data. Nothing is uploaded.</span></div>' +
          '<div><strong>Independent software</strong><span>This app is not an official CORSAIR product and is not endorsed by integration providers unless a written agreement says otherwise.</span></div>' +
        '</div>' +
        '<label class="inline-field inline-field--checkbox"><input type="checkbox" data-foreground-tracking' + (state.foregroundTrackingEnabled ? " checked" : "") + (state.diagnosticsBusy ? " disabled" : "") + '> <span>Track the foreground app to build Recent Apps (off by default)</span></label>' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header"><div><div class="metric-label">Recent diagnostic events</div><div class="router-inline-copy">Sanitized local host events. Clipboard contents, credentials, and local paths stay excluded.</div></div><button class="inline-button" type="button" data-action="refresh-diagnostics"' + (state.diagnosticsBusy ? " disabled" : "") + '>Refresh</button></div>' +
          '<div class="inline-list">' + (state.diagnosticEvents.length ? state.diagnosticEvents.map(function (entry) {
            return '<div class="inline-list-item"><div class="inline-list-copy">' + escapeHtml(entry) + '</div></div>';
          }).join("") : '<div class="inline-empty"><strong>No diagnostics loaded</strong><span>Refresh to read the latest sanitized local events.</span></div>') + '</div>' +
        '</article>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="export-backup">Copy Auxora backup</button>' +
          '<button class="inline-button" type="button" data-action="restore-backup">Restore Auxora backup</button>' +
          '<button class="inline-button" type="button" data-action="reset-settings">Reset local settings</button>' +
          '<button class="inline-button" type="button" data-action="reset-all-local-data">' + (state.confirmReset ? "Confirm reset" : "Reset all app data") + '</button>' +
          '<a class="inline-button" href="/support.html" target="_blank" rel="noreferrer">Support</a>' +
        '</div>' +
        '<label class="inline-field"><span>Restore presentation and Scenes</span><textarea class="inline-input" data-settings-import rows="4" placeholder="Paste an Auxora backup. Credentials, endpoints, launcher paths, display IDs, and logs are never included."></textarea></label>' +
        '<div class="product-code-preview">' + escapeHtml(JSON.stringify(settings, null, 2).slice(0, 520)) + '</div>'
      );
    }

    function importDashboardSettings(raw) {
      var parsed;
      var imported = {};
      var allowed = [
        "profileId", "themeId", "accentColor", "layoutOrder", "pinnedWidgets", "hiddenWidgets", "cardSizes", "marketplacePack", "dashboardOpacity",
        "themeReadability", "performanceBudget", "gameModeAutoTune", "gameModeAutoFace", "releaseChannel",
        "updateChannel", "installerEdition"
      ];

      try {
        parsed = JSON.parse(raw || "");
      } catch (error) {
        throw new Error("Settings JSON is invalid.");
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Settings export must be a JSON object.");
      }

      allowed.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(parsed, key) && typeof parsed[key] !== "object") {
          imported[key] = String(parsed[key]);
        }
      });

      if (!Object.keys(imported).length) {
        throw new Error("No supported dashboard settings were found.");
      }

      saveSettings(env, imported);
    }

    function refreshDiagnostics() {
      state.diagnosticsBusy = true;
      state.statusText = "Loading diagnostics";
      state.statusTone = "warn";
      redraw();
      return requestJson(buildBridgeUrl(env, "/api/support/bundle"), {}, 8000).then(function (payload) {
        state.diagnosticEvents = Array.isArray(payload.log) ? payload.log.slice(-6).reverse() : [];
        state.statusText = "Diagnostics refreshed";
        state.statusTone = "good";
      }, function (error) {
        state.statusText = error.message || "Diagnostics unavailable";
        state.statusTone = "danger";
      }).finally(function () {
        state.diagnosticsBusy = false;
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var settings;
      if (!target) {
        return;
      }

      if (target.getAttribute("data-action") === "export-backup") {
        requestJson(buildBridgeUrl(env, "/api/config/backup"), {}, 7000).then(function (backup) {
          return copyTextToClipboard(JSON.stringify(backup, null, 2));
        }).then(function () {
          state.statusText = "Auxora backup copied";
          state.statusTone = "good";
          redraw();
        }, function (error) {
          state.statusText = error.message || "Copy failed";
          state.statusTone = "danger";
          redraw();
        });
      } else if (target.getAttribute("data-action") === "restore-backup") {
        try {
          settings = JSON.parse(container.querySelector("[data-settings-import]").value || "");
        } catch (error) {
          state.statusText = "Backup JSON is invalid";
          state.statusTone = "danger";
          redraw();
          return;
        }
        requestJson(buildBridgeUrl(env, "/api/config/backup"), { method: "POST", body: settings }, 9000).then(function () {
          state.statusText = "Auxora backup restored";
          state.statusTone = "good";
          if (typeof env.handleSetupUpdate === "function") {
            return env.handleSetupUpdate("local-settings");
          }
        }, function (error) {
          state.statusText = error.message || "Restore failed";
          state.statusTone = "danger";
        }).finally(redraw);
      } else if (target.getAttribute("data-action") === "refresh-diagnostics") {
        refreshDiagnostics();
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

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      if (!target || !target.hasAttribute("data-foreground-tracking")) {
        return;
      }

      state.diagnosticsBusy = true;
      state.statusText = target.checked ? "Enabling foreground tracking" : "Disabling and clearing recent history";
      state.statusTone = "warn";
      redraw();
      requestJson(buildBridgeUrl(env, "/api/config/dashboard"), {
        method: "POST",
        body: { foregroundAppTrackingEnabled: Boolean(target.checked) }
      }, 8000).then(function (payload) {
        state.foregroundTrackingEnabled = Boolean(payload.dashboard && payload.dashboard.foregroundAppTrackingEnabled);
        if (env.bridgeConfig && env.bridgeConfig.dashboard) {
          env.bridgeConfig.dashboard.foregroundAppTrackingEnabled = state.foregroundTrackingEnabled;
        }
        state.statusText = state.foregroundTrackingEnabled ? "Foreground tracking enabled" : "Foreground tracking off; recent history cleared";
        state.statusTone = state.foregroundTrackingEnabled ? "warn" : "good";
      }, function (error) {
        state.statusText = error.message || "Privacy setting failed";
        state.statusTone = "danger";
      }).finally(function () {
        state.diagnosticsBusy = false;
        redraw();
      });
    });

    redraw();
    refreshDiagnostics();
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


  runtime.registerRenderer("home", mountAuxoraHomeWidget);
  runtime.registerRenderer("scenes", mountScenesWidget);
  runtime.registerRenderer("display-controls", mountDisplayControlsWidget);
  runtime.registerRenderer("remote", mountRemoteWidget);
  runtime.registerRenderer("theme-studio", mountThemeStudioWidget);
  runtime.registerRenderer("layout-editor", mountLayoutEditorWidget);
  runtime.registerRenderer("updates", mountUpdatesWidget);
  runtime.registerRenderer("streaming", mountStreamingWidget);
  runtime.registerRenderer("marketplace", mountMarketplaceWidget);
  runtime.registerRenderer("installer", mountInstallerWidget);
  runtime.registerRenderer("privacy", mountPrivacyWidget);
}());
