(function () {
  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime || typeof runtime.registerRenderer !== "function") {
    return;
  }

  var addListener = runtime.addListener;
  var buildBridgeUrl = runtime.buildBridgeUrl;
  var escapeHtml = runtime.escapeHtml;
  var findById = runtime.findById;
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
          '<label class="inline-field product-range-field"><span>Motion ' + escapeHtml(intensity) + '%</span><input class="inline-range" type="range" name="animationIntensity" min="0" max="140" aria-label="Animation intensity" value="' + escapeHtml(intensity) + '"></label>' +
          '<label class="inline-field product-range-field"><span>Opacity ' + escapeHtml(opacity) + '%</span><input class="inline-range" type="range" name="dashboardOpacity" min="35" max="100" aria-label="Dashboard opacity" value="' + escapeHtml(opacity) + '"></label>' +
        '</form>'
      );
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
          metricCard("Current build", env.assetRevision || "local", "Dashboard asset revision", null) +
          metricCard("Latest release", state.latest || "Not checked", state.message, null) +
          metricCard("Installer", state.downloadUrl ? "Found" : "Not checked", state.macUrl ? "Windows and Mac assets" : "Windows asset expected", null) +
          metricCard("Trust", state.trustReady ? "Verified" : "Needs proof", "Hash " + state.hashStatus + " / signature " + state.signatureStatus, null) +
          metricCard("Rollback", state.rollback.configured ? "Ready" : "Pending", state.rollback.message, null) +
        '</div>' +
        '<form class="inline-form product-control-panel" data-form="updates">' +
          '<label class="inline-field"><span>Release channel</span><select class="inline-select" name="releaseChannel">' +
            '<option value="stable"' + (channel === "stable" ? " selected" : "") + '>Stable</option>' +
            '<option value="beta"' + (channel === "beta" ? " selected" : "") + '>Beta</option>' +
            '<option value="nightly"' + (channel === "nightly" ? " selected" : "") + '>Nightly</option>' +
          '</select></label>' +
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
        state.latestUrl = text(payload && (payload.htmlUrl || payload.html_url), state.latestUrl);
        state.downloadUrl = text(payload && payload.installerUrl, "");
        state.macUrl = text(payload && payload.macUrl, "");
        state.hashStatus = text(payload && payload.hashStatus, "missing");
        state.signatureStatus = text(payload && payload.signatureStatus, "missing");
        state.trustReady = Boolean(payload && payload.trust && payload.trust.trusted);
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
        '<div><strong>Stays on this PC</strong><span>Dashboard preferences, widget endpoints, layout, OBS target, and installer readiness.</span></div>' +
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


  runtime.registerRenderer("theme-studio", mountThemeStudioWidget);
  runtime.registerRenderer("layout-editor", mountLayoutEditorWidget);
  runtime.registerRenderer("updates", mountUpdatesWidget);
  runtime.registerRenderer("streaming", mountStreamingWidget);
  runtime.registerRenderer("marketplace", mountMarketplaceWidget);
  runtime.registerRenderer("installer", mountInstallerWidget);
  runtime.registerRenderer("privacy", mountPrivacyWidget);
}());
