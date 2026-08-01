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
  var patchStableDom = runtime.patchStableDom;
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
    var redrawPending = false;
    var redrawTimerId = 0;
    var destroyed = false;

    function focusedFormControl() {
      var active = document.activeElement;
      return active && container.contains(active) && active.matches("input, textarea, select");
    }

    function requestRedraw() {
      if (focusedFormControl()) {
        redrawPending = true;
        return;
      }
      redrawPending = false;
      redraw();
    }

    function schedulePendingRedraw() {
      if (redrawTimerId) {
        window.clearTimeout(redrawTimerId);
      }
      redrawTimerId = window.setTimeout(function () {
        redrawTimerId = 0;
        if (!destroyed && redrawPending && !focusedFormControl()) {
          requestRedraw();
        }
      }, 0);
    }

    function redraw() {
      var themes = productThemes(env);
      var activeTheme = settingValue(env, "themeId", "focus");
      var activePreset = findById(themes, activeTheme);
      var accentMode = settingValue(env, "accentMode", "preset") === "custom" ? "custom" : "preset";
      var customAccent = settingValue(env, "customAccentColor", activePreset.accent);
      var themeVariant = settingValue(env, "themeVariant", "auto");
      var intensity = settingValue(env, "animationIntensity", "100");
      var opacity = settingValue(env, "dashboardOpacity", "100");
      var dashboard = env.bridgeConfig && env.bridgeConfig.dashboard ? env.bridgeConfig.dashboard : {};
      var readability = settingValue(env, "themeReadability", text(dashboard.themeReadability, "normal"));
      var performanceBudget = settingValue(env, "performanceBudget", text(dashboard.performanceBudget, "balanced"));
      var gameModeAutoTune = settingValue(env, "gameModeAutoTune", dashboard.gameModeAutoTune === false ? "0" : "1");

      patchStableDom(container, productShell(
        "Visual style",
        "Theme Studio",
        "Adjust this companion display's theme, accent, transparency, and motion intensity.",
        activePreset.name,
        "good",
        '<div class="product-theme-grid" role="radiogroup" aria-label="Theme">' +
          themes.map(function (theme) {
            return '' +
              '<button class="product-swatch' + (theme.id === activeTheme ? " is-selected" : "") + '" type="button" role="radio" aria-checked="' + (theme.id === activeTheme ? "true" : "false") + '" aria-pressed="' + (theme.id === activeTheme ? "true" : "false") + '" data-theme="' + escapeHtml(theme.id) + '">' +
                '<span class="product-swatch__chip" style="--swatch-a:' + escapeHtml(theme.accent) + ';--swatch-b:' + escapeHtml(theme.secondary || theme.accent) + '"></span>' +
                '<strong>' + escapeHtml(theme.name) + '</strong>' +
                '<span>' + escapeHtml(theme.copy) + '</span>' +
              '</button>';
          }).join("") +
        '</div>' +
        '<form class="inline-form product-control-panel" data-form="theme-studio">' +
          '<div class="inline-form-grid inline-form-grid--2">' +
            '<label class="inline-field"><span>Accent</span><select class="inline-select" name="accentMode"><option value="preset"' + (accentMode === "preset" ? " selected" : "") + '>Theme preset</option><option value="custom"' + (accentMode === "custom" ? " selected" : "") + '>Custom accent</option></select></label>' +
            '<label class="inline-field"><span>Custom accent</span><input class="inline-input product-color-input" type="color" name="customAccentColor" value="' + escapeHtml(customAccent) + '"' + (accentMode === "custom" ? "" : " disabled") + '></label>' +
          '</div>' +
          '<div class="inline-form-grid inline-form-grid--3">' +
            '<label class="inline-field"><span>Night</span><select class="inline-select" name="themeVariant"><option value="auto"' + (themeVariant === "auto" ? " selected" : "") + '>Automatic</option><option value="standard"' + (themeVariant === "standard" ? " selected" : "") + '>Off</option><option value="night"' + (themeVariant === "night" ? " selected" : "") + '>On</option></select></label>' +
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
          '</div>' +
          '<div class="inline-form-grid inline-form-grid--1">' +
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
      ));
      initXnSlider(container);
    }

    function selectPreset(themeId) {
      saveSettings(env, {
        themeSchemaVersion: "2",
        themeId: String(themeId || "focus"),
        accentMode: "preset",
        customAccentColor: "",
        accentColor: ""
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-theme]") : null;
      var theme;
      if (!target) {
        return;
      }

      theme = findById(productThemes(env), target.getAttribute("data-theme"));
      selectPreset(theme.id);
      requestRedraw();
    });

    addListener(cleanups, container, "input", function (event) {
      var form = event.target && event.target.form;
      var name = event.target && event.target.name;
      if (!form || form.getAttribute("data-form") !== "theme-studio") {
        return;
      }
      if (name === "customAccentColor" && form.elements.accentMode.value === "custom") {
        saveSettings(env, { accentMode: "custom", customAccentColor: String(event.target.value || "") });
      } else if (name === "animationIntensity" || name === "dashboardOpacity") {
        var rangeValues = {};
        rangeValues[name] = String(event.target.value || "");
        saveSettings(env, rangeValues);
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var form = event.target && event.target.form;
      var name = event.target && event.target.name;
      if (!form || form.getAttribute("data-form") !== "theme-studio") {
        return;
      }
      if (name === "accentMode") {
        form.elements.customAccentColor.disabled = event.target.value !== "custom";
        if (event.target.value === "custom") {
          var selectedPreset = findById(productThemes(env), settingValue(env, "themeId", "focus"));
          saveSettings(env, { accentMode: "custom", customAccentColor: String(form.elements.customAccentColor.value || selectedPreset.accent) });
        } else {
          saveSettings(env, { accentMode: "preset", customAccentColor: "", accentColor: "" });
        }
      } else if (name === "themeVariant" || name === "themeReadability" || name === "performanceBudget" || name === "gameModeAutoTune") {
        var choiceValues = {};
        choiceValues[name] = String(event.target.value || "");
        saveSettings(env, choiceValues);
      }
      requestRedraw();
    });

    addListener(cleanups, container, "focusout", function () {
      if (redrawPending) {
        schedulePendingRedraw();
      }
    });

    redraw();
    return {
      refresh: function () {
        requestRedraw();
        return Promise.resolve();
      },
      destroy: function () {
        destroyed = true;
        if (redrawTimerId) {
          window.clearTimeout(redrawTimerId);
          redrawTimerId = 0;
        }
        runCleanups(cleanups);
        patchStableDom(container, "");
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
      patchStableDom(container, productShell(
        "Drag and drop",
        "Layout Editor",
        "Move panels into the order that best fits how you use this Auxora display.",
        rows.length + " panels",
        "good",
        '<div class="product-layout-list">' +
          rows.map(function (row, index) {
            var rowTitle = escapeHtml(row.title);
            var rowSize = escapeHtml(sizes[row.id] || "standard");
            var pinAction = pinned.indexOf(row.id) !== -1 ? "Unpin" : "Pin";
            var visibilityAction = hidden.indexOf(row.id) !== -1 ? "Show" : "Hide";
            return '' +
              '<div class="product-layout-row" draggable="true" data-layout-item="' + escapeHtml(row.id) + '">' +
                '<span class="product-layout-row__handle" aria-hidden="true">⋮⋮</span>' +
                '<div><strong>' + rowTitle + '</strong><span>' + escapeHtml(row.state + (row.requiresBridge ? " · uses Auxora service" : " · works locally")) + '</span></div>' +
                '<div class="product-layout-row__actions">' +
                  '<button class="inline-button" type="button" data-layout-action="up" data-id="' + escapeHtml(row.id) + '" aria-label="' + escapeHtml("Move " + row.title + " up") + '"' + (index === 0 ? " disabled" : "") + '>Up</button>' +
                  '<button class="inline-button" type="button" data-layout-action="down" data-id="' + escapeHtml(row.id) + '" aria-label="' + escapeHtml("Move " + row.title + " down") + '"' + (index === rows.length - 1 ? " disabled" : "") + '>Down</button>' +
                  '<button class="inline-button" type="button" data-layout-action="pin" data-id="' + escapeHtml(row.id) + '" aria-label="' + escapeHtml(pinAction + " " + row.title) + '">' + pinAction + '</button>' +
                  '<button class="inline-button" type="button" data-layout-action="size" data-id="' + escapeHtml(row.id) + '" aria-label="' + escapeHtml("Change " + row.title + " size; current size " + (sizes[row.id] || "standard")) + '">Size: ' + rowSize + '</button>' +
                  '<button class="inline-button" type="button" data-layout-action="hide" data-id="' + escapeHtml(row.id) + '" aria-label="' + escapeHtml(visibilityAction + " " + row.title) + '">' + visibilityAction + '</button>' +
                '</div>' +
              '</div>';
          }).join("") +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button" type="button" data-layout-action="reset">Reset order</button>' +
          '<button class="inline-button is-primary" type="button" data-layout-action="theme">Open theme studio</button>' +
        '</div>'
      ));
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
        patchStableDom(container, "");
      }
    };
  }

  function mountUpdatesWidget(widget, container, env) {
    var cleanups = [];
    var buildVersion = text(env.bridgeApp && env.bridgeApp.version, "");
    var normalizeReleaseChannel = typeof env.normalizeReleaseChannel === "function"
      ? env.normalizeReleaseChannel
      : function (value) {
        return ["stable", "beta", "nightly"].indexOf(value) === -1 ? "stable" : value;
      };
    var isPrereleaseBuild = buildVersion.indexOf("-") !== -1;
    var isNightlyBuild = /-.*nightly/i.test(buildVersion);
    var availableChannels = isNightlyBuild
      ? [{ value: "nightly", label: "Nightly" }]
      : isPrereleaseBuild
        ? [{ value: "beta", label: "Beta" }, { value: "nightly", label: "Nightly" }]
        : [{ value: "stable", label: "Stable" }, { value: "beta", label: "Beta" }, { value: "nightly", label: "Nightly" }];
    var dashboard = env.bridgeConfig && env.bridgeConfig.dashboard ? env.bridgeConfig.dashboard : {};
    var initialChannel = normalizeReleaseChannel(settingValue(env, "releaseChannel", settingValue(env, "updateChannel", text(dashboard.releaseChannel, "stable"))));
    var state = {
      latest: "",
      current: "",
      updateAvailable: false,
      downloadAllowed: false,
      checked: false,
      versionComparisonKnown: false,
      versionRelation: "unknown",
      latestUrl: "https://github.com/SilverFuel/xeneon-widgets/releases",
      downloadUrl: "",
      macUrl: "",
      hashStatus: "missing",
      signatureStatus: "missing",
      verificationStatus: "not-verified",
      trusted: false,
      channel: initialChannel,
      rollback: {
        supported: false,
        configured: false,
        message: "Automatic rollback is not included in this beta. Keep the previous verified installer if you need to return to an earlier build."
      },
      message: "Check the release feed when you are ready to update.",
      statusText: "Not checked",
      statusTone: "muted",
      busy: false
    };

    function redraw() {
      var canOfferInstaller = state.checked && state.downloadAllowed && state.versionRelation === "newer" && state.updateAvailable && state.trusted && Boolean(state.downloadUrl);
      var canOfferMac = state.checked && state.downloadAllowed && state.versionRelation === "newer" && state.updateAvailable && state.trusted && Boolean(state.macUrl);
      var installerState = !state.checked ? "Not checked"
        : state.versionRelation === "older" ? "Feed behind"
          : state.versionRelation === "current" ? "Current"
            : !state.downloadUrl ? "Missing"
              : state.trusted ? "Verified" : "Unverified";
      var installerCopy = state.versionRelation === "older"
        ? "The public feed is older than this installed build. Downgrade links are hidden."
        : canOfferInstaller ? "Verified newer Windows installer" : state.downloadUrl ? "Direct download stays hidden until a newer artifact is verified." : "No newer Windows installer was found.";
      if (typeof env.publishStatus === "function") {
        env.publishStatus(state.statusText === "Up to date" || state.statusText === "Update available" ? "Ready" : state.statusText === "Check failed" ? "Degraded" : state.statusText, state.statusTone, state.message);
      }
      var channel = normalizeReleaseChannel(state.channel);
      var updateNotifications = settingValue(env, "updateNotifications", "0") === "1";
      state.channel = channel;
      patchStableDom(container, productShell(
        "Release checks",
        "Updates",
        "Review the public release feed from the local host. Auxora does not install updates automatically.",
        state.statusText,
        state.statusTone,
        '<div class="inline-grid inline-grid--4 inline-grid--updates">' +
          metricCard("Current build", state.current || env.assetRevision || "local", "Installed host version", null) +
          metricCard("Latest release", state.latest || "Not checked", state.updateAvailable ? "Newer than your installed build" : state.message, null) +
          metricCard("Installer", installerState, installerCopy, null) +
          metricCard("Trust", state.trusted ? "Verified" : "Not verified", state.trusted ? "The installed trust policy verified this release." : "Proof files: hash " + state.hashStatus + " / signature " + state.signatureStatus + ". Auxora has not verified the downloaded bytes.", null) +
          metricCard("Rollback", state.rollback.supported === true && state.rollback.configured ? "Ready" : "Manual only", state.rollback.message, null) +
        '</div>' +
        '<form class="inline-form product-control-panel product-control-panel--updates" data-form="updates">' +
          '<label class="inline-field"><span>Release channel</span><select class="inline-select" name="releaseChannel">' +
            availableChannels.map(function (option) {
              return '<option value="' + option.value + '"' + (channel === option.value ? " selected" : "") + '>' + option.label + '</option>';
            }).join("") +
          '</select></label>' +
          '<label class="inline-field inline-field--checkbox"><input type="checkbox" name="updateNotifications"' + (updateNotifications ? " checked" : "") + '> <span>Check for updates when the dashboard starts</span></label>' +
        '</form>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="check-release"' + (state.busy ? " disabled" : "") + '>Check releases</button>' +
          (canOfferInstaller ? '<a class="inline-button" href="' + escapeHtml(state.downloadUrl) + '" target="_blank" rel="noreferrer">Download verified update</a>' : '') +
          (canOfferMac ? '<a class="inline-button" href="' + escapeHtml(state.macUrl) + '" target="_blank" rel="noreferrer">Download verified Mac update</a>' : '') +
          '<a class="inline-button" href="' + escapeHtml(state.latestUrl) + '" target="_blank" rel="noreferrer">Open releases</a>' +
        '</div>' +
        '<div class="product-checklist">' +
          '<span>Hash ' + escapeHtml(state.hashStatus) + '</span><span>Signature ' + escapeHtml(state.signatureStatus) + '</span><span>Versioned setup EXE</span><span>Manual rollback only</span>' +
        '</div>'
      ));
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
        state.channel = normalizeReleaseChannel(text(payload && payload.channel, state.channel));
        state.updateAvailable = Boolean(payload && payload.updateAvailable);
        state.checked = true;
        state.versionComparisonKnown = Boolean(payload && payload.versionComparisonKnown);
        state.versionRelation = text(payload && payload.versionRelation, state.versionComparisonKnown ? (state.updateAvailable ? "newer" : "current") : "unknown");
        state.downloadAllowed = payload && Object.prototype.hasOwnProperty.call(payload, "downloadAllowed")
          ? Boolean(payload.downloadAllowed)
          : state.updateAvailable && state.versionRelation === "newer";
        if (state.versionRelation !== "older") {
          state.latestUrl = text(payload && (payload.htmlUrl || payload.html_url), state.latestUrl);
        }
        state.downloadUrl = text(payload && payload.installerUrl, "");
        state.macUrl = text(payload && payload.macUrl, "");
        var trust = payload && payload.trust ? payload.trust : {};
        state.hashStatus = text(trust.hashStatus || (payload && payload.hashStatus), "missing");
        state.signatureStatus = text(trust.signatureStatus || (payload && payload.signatureStatus), "missing");
        state.verificationStatus = text(trust.verificationStatus, "not-verified");
        state.trusted = trust.trusted === true && state.verificationStatus === "verified";
        state.message = state.versionRelation === "older"
          ? "The public release feed is older than this installed build. Downgrade links are hidden."
          : text(payload && payload.message, "Release feed checked.");
        state.statusText = payload && payload.status === "live"
          ? state.versionRelation === "older" ? "Feed behind" : state.updateAvailable ? "Update available" : "Up to date"
          : "Check failed";
        state.statusTone = payload && payload.status === "live" ? (state.updateAvailable || state.versionRelation === "older" ? "warn" : "good") : "danger";
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Check failed";
        state.statusTone = "danger";
        state.message = state.statusText;
        state.checked = true;
        state.versionComparisonKnown = false;
        state.versionRelation = "unknown";
        state.downloadAllowed = false;
        state.verificationStatus = "not-verified";
        state.trusted = false;
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
      if (select && select.name === "releaseChannel") {
        state.channel = normalizeReleaseChannel(select.value);
        saveSettings(env, {
          releaseChannel: state.channel,
          updateChannel: state.channel
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
        patchStableDom(container, "");
      }
    };
  }

  var productProfiles = [
    {
      id: "glance",
      name: "Glance",
      copy: "Large, immediate system, network, audio, and Game Mode information for a quick glance.",
      themeId: "focus",
      pack: "core",
      layout: ["system", "network", "audio", "game-mode", "quick-actions", "privacy"]
    },
    {
      id: "command",
      name: "Command",
      copy: "Balanced daily dashboard with setup, telemetry, sound, style, and packaging close at hand.",
      themeId: "focus",
      pack: "core",
      layout: ["system", "network", "audio", "theme-studio", "layout-editor", "updates", "installer", "privacy"]
    },
    {
      id: "gaming",
      name: "Gaming",
      copy: "System pressure, network state, audio, and game mode first.",
      themeId: "gaming",
      pack: "gaming",
      layout: ["game-mode", "system", "network", "audio", "quick-actions", "theme-studio", "updates"]
    },
    {
      id: "streaming",
      name: "Streaming",
      copy: "Local OBS reachability preview, audio and media shortcuts, system load, and release confidence.",
      themeId: "warm",
      pack: "streamer",
      layout: ["streaming", "audio", "system", "network", "quick-actions", "theme-studio", "updates", "privacy"]
    },
    {
      id: "homelab",
      name: "Home Lab",
      copy: "Network health, display controls, system telemetry, and configured local integrations move forward.",
      themeId: "focus",
      pack: "homelab",
      layout: ["network", "system", "display-controls", "hue", "marketplace", "privacy"]
    },
    {
      id: "minimal",
      name: "Minimal",
      copy: "A clean product demo surface with the essentials and privacy visible.",
      themeId: "focus",
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
      copy: "Local OBS reachability preview, audio/media shortcuts, update checks, and privacy up front.",
      layout: ["streaming", "audio", "quick-actions", "system", "network", "updates", "privacy"]
    },
    {
      id: "homelab",
      name: "Home Lab",
      copy: "Network health, system telemetry, display controls, and configured Hue controls.",
      layout: ["network", "system", "display-controls", "hue", "marketplace", "privacy"]
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

  var portableDashboardSettingKeys = [
    "profileId", "themeSchemaVersion", "themeId", "accentMode", "customAccentColor", "themeVariant",
    "animationIntensity", "dashboardOpacity", "performanceBudget", "gameModeAutoTune", "gameModeAutoFace",
    "themeReadability", "releaseChannel", "layoutOrder", "pinnedWidgets", "hiddenWidgets", "cardSizes",
    "modeLayouts", "marketplacePack"
  ];

  function portableDashboardSettings(raw) {
    var source = raw == null ? {} : raw;
    var result = {};
    if (typeof source !== "object" || Array.isArray(source)) {
      throw new Error("Backup dashboard settings must be an object.");
    }

    portableDashboardSettingKeys.forEach(function (key) {
      var value;
      var serialized;
      var parsed;
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        return;
      }

      value = source[key];
      if (value == null || typeof value === "object") {
        throw new Error("Backup dashboard setting " + key + " is invalid.");
      }

      if (key === "gameModeAutoTune") {
        serialized = value === true || String(value) === "1" || String(value).toLowerCase() === "true" ? "1" : "0";
      } else {
        serialized = String(value);
      }
      if (serialized.length > 32768) {
        throw new Error("Backup dashboard setting " + key + " is too large.");
      }

      if ((key === "animationIntensity" || key === "dashboardOpacity") && !Number.isFinite(Number(serialized))) {
        throw new Error("Backup dashboard setting " + key + " must be numeric.");
      }

      if (key === "cardSizes" || key === "modeLayouts") {
        try {
          parsed = JSON.parse(serialized || "{}");
        } catch (error) {
          throw new Error("Backup dashboard setting " + key + " must contain valid JSON.");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Backup dashboard setting " + key + " must contain a JSON object.");
        }
      }
      result[key] = serialized;
    });
    return result;
  }

  function buildPortableDashboardSettings(raw) {
    var settings = portableDashboardSettings(raw);
    return Object.assign({}, settings, {
      animationIntensity: Number(settings.animationIntensity || 25),
      dashboardOpacity: Number(settings.dashboardOpacity || 100),
      gameModeAutoTune: settings.gameModeAutoTune !== "0"
    });
  }

  function readPortableDashboardSettings(backup) {
    if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
      throw new Error("Backup must be a JSON object.");
    }
    if (backup.dashboard == null) {
      return {};
    }
    return portableDashboardSettings(backup.dashboard);
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
      message: "Loading your quick look"
    };

    function value(value, suffix) {
      var parsed = Number(value);
      return Number.isFinite(parsed) ? Math.round(parsed) + (suffix || "") : "--";
    }

    function activeScene() {
      return state.scenes && state.scenes.activeScene ? state.scenes.activeScene : {};
    }

    function setupReason() {
      var reason = text(state.scenes && state.scenes.lastActivationReason, "").toLowerCase();
      if (reason.indexOf("automatic") !== -1) {
        return "Changed automatically";
      }
      if (reason.indexOf("manual") !== -1) {
        return "Changed by you";
      }
      return "Your normal setup";
    }

    function networkProbeKind() {
      var source = text(state.network && state.network.healthTargetSource, "").toLowerCase();
      if (source === "gateway") {
        return { healthy: "home network is working", warning: "home network is responding slowly" };
      }
      if (source === "dns") {
        return { healthy: "internet connection is working", warning: "internet connection is responding slowly" };
      }
      if (source === "configured") {
        return { healthy: "network check passed", warning: "network check is slow" };
      }
      if (source === "fallback") {
        return { healthy: "internet connection is working", warning: "internet connection is slow" };
      }
      return { healthy: "network is working", warning: "network is slow" };
    }

    function briefing() {
      var parts = [];
      var entries = state.calendar && Array.isArray(state.calendar.entries) ? state.calendar.entries : [];
      var chains = state.chains && Array.isArray(state.chains.chains) ? state.chains.chains : [];
      var cpu = Number(state.system && state.system.cpu);
      var ping = Number(state.network && state.network.ping);
      var networkProbe = networkProbeKind();
      if (entries.length) {
        parts.push(entries.length + (entries.length === 1 ? " upcoming event" : " upcoming events"));
      }
      if (Number.isFinite(ping)) {
        parts.push(ping > 80 ? networkProbe.warning : networkProbe.healthy);
      }
      if (Number.isFinite(cpu)) {
        parts.push(cpu > 90 ? "PC is working very hard" : "PC is running normally");
      }
      return parts.length ? parts.join(" · ") : "Everything is ready for " + text(activeScene().name, "Work") + ".";
    }

    function redraw() {
      var scene = activeScene();
      var entries = state.calendar && Array.isArray(state.calendar.entries) ? state.calendar.entries : [];
      var chains = state.chains && Array.isArray(state.chains.chains) ? state.chains.chains : [];
      var networkProbe = networkProbeKind();
      patchStableDom(container, productShell(
        "Quick Look",
        "Good " + (new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"),
        briefing(),
        text(scene.name, state.loading ? "Loading" : "Work"),
        state.loading ? "warn" : "good",
        '<div class="auxora-glance-hero"><div><span>Current Setup</span><strong>' + escapeHtml(text(scene.name, "Work")) + '</strong><small>' + escapeHtml(setupReason()) + '</small></div><div class="auxora-glance-clock">' + escapeHtml(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + '</div></div>' +
        '<div class="inline-grid inline-grid--4">' +
          metricCard("PC Activity", value(state.system && state.system.cpu, "%"), state.system && state.system.cpuTemp != null ? "PC temperature " + value(state.system.cpuTemp, "°") : "How hard your PC is working") +
          metricCard("Memory Used", value(state.system && state.system.ram, "%"), "Short-term working space") +
          metricCard("Network Response", state.network && state.network.ping != null ? value(state.network.ping, " ms") : "--", state.network && state.network.name ? "Lower is better · " + state.network.name : "Lower is better") +
          metricCard("Next Event", entries.length ? text(entries[0].title, "Event") : "Nothing planned", entries.length ? text(entries[0].time, text(entries[0].detail, "Upcoming")) : "Nothing scheduled") +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-home-open="audio">Audio & media</button>' +
          '<button class="inline-button" type="button" data-home-open="quick-actions">Shortcuts</button>' +
          '<button class="inline-button" type="button" data-home-open="system">PC details</button>' +
          '<button class="inline-button" type="button" data-home-open="layout-editor">Customize Home</button>' +
        '</div>' +
        '<article class="list-card inline-card auxora-glance-chains"><div class="inline-card-header"><div><div class="metric-label">One-tap setups</div><div class="router-inline-copy">Change several settings with one tap.</div></div></div><div class="inline-actions">' + chains.map(function (chain) {
          return '<button class="inline-button" type="button" data-action-chain="' + escapeHtml(chain.id) + '" title="' + escapeHtml(chain.description) + '">' + escapeHtml(chain.name) + '</button>';
        }).join("") + '</div></article>'
      ));
    }

    function refresh() {
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
        patchStableDom(container, "");
      }
    };
  }

  function mountScenesWidget(widget, container, env) {
    var cleanups = [];
    var state = { payload: null, displays: [], busy: false, confirmDeleteId: "", message: "Loading Modes", tone: "warn" };
    var deleteConfirmationTimer = 0;

    function sceneWidgetIds(scene) {
      var ids = Array.isArray(scene && scene.widgets) ? scene.widgets : [];
      try {
        var layouts = JSON.parse(settingValue(env, "modeLayouts", "{}") || "{}");
        var override = layouts && layouts[scene.id] && layouts[scene.id].layoutOrder;
        if (typeof override === "string" && override.trim()) {
          ids = override.split(",").map(function (id) { return id.trim(); }).filter(Boolean);
        }
      } catch (error) {
        // Ignore damaged local layout data and retain the native Mode layout.
      }
      return ids;
    }

    function friendlySurfaceNames(scene) {
      var catalog = typeof env.getSurfaceCatalog === "function" ? env.getSurfaceCatalog() : [];
      var titles = {};
      catalog.forEach(function (surface) { titles[surface.id] = surface.title; });
      return sceneWidgetIds(scene).slice(0, 5).map(function (id) { return titles[id] || "Unavailable panel"; });
    }

    function friendlyChoice(value, kind) {
      var choices = kind === "density"
        ? { compact: "Compact spacing", comfortable: "Comfortable spacing", spacious: "Spacious spacing" }
        : { balanced: "Balanced performance", battery: "Quiet performance", game: "Gaming performance", max: "Maximum performance" };
      return choices[value] || "Custom";
    }

    function redraw() {
      var profiles = state.payload && Array.isArray(state.payload.profiles) ? state.payload.profiles.filter(function (scene) {
        return scene && scene.id !== "scene-night" && scene.themeVariant !== "night";
      }) : [];
      var activeId = text(state.payload && state.payload.activeSceneId, "scene-work");
      var assignments = state.payload && Array.isArray(state.payload.displayAssignments) ? state.payload.displayAssignments : [];
      patchStableDom(container, productShell(
        "Adaptive experience",
        "Modes",
        "Change Auxora's layout, energy, controls, and priorities in one tap.",
        state.message,
        state.tone,
        '<div class="product-profile-grid auxora-scene-grid">' + profiles.map(function (scene) {
          var active = scene.id === activeId;
          var customEditor = scene.isBuiltIn ? "" :
            '<form class="inline-form product-mode-editor" data-scene-edit="' + escapeHtml(scene.id) + '">' +
              '<div class="inline-form-grid inline-form-grid--2">' +
                '<label class="inline-field"><span>Mode name</span><input class="inline-input" name="name" maxlength="40" value="' + escapeHtml(scene.name) + '" aria-label="Mode name for ' + escapeHtml(scene.name) + '"></label>' +
                '<label class="inline-field"><span>Theme</span><select class="inline-select" name="themeId" aria-label="Theme for ' + escapeHtml(scene.name) + '"><option value="focus"' + (scene.themeId === "focus" ? " selected" : "") + '>Focus</option><option value="gaming"' + (scene.themeId === "gaming" ? " selected" : "") + '>Gaming</option><option value="warm"' + (scene.themeId === "warm" ? " selected" : "") + '>Warm</option></select></label>' +
                '<label class="inline-field"><span>Spacing</span><select class="inline-select" name="density" aria-label="Spacing for ' + escapeHtml(scene.name) + '"><option value="compact"' + (scene.density === "compact" ? " selected" : "") + '>Compact</option><option value="comfortable"' + (scene.density === "comfortable" ? " selected" : "") + '>Comfortable</option><option value="spacious"' + (scene.density === "spacious" ? " selected" : "") + '>Spacious</option></select></label>' +
                '<label class="inline-field"><span>Performance</span><select class="inline-select" name="performanceBudget" aria-label="Performance for ' + escapeHtml(scene.name) + '"><option value="balanced"' + (scene.performanceBudget === "balanced" ? " selected" : "") + '>Balanced</option><option value="battery"' + (scene.performanceBudget === "battery" ? " selected" : "") + '>Quiet</option><option value="game"' + (scene.performanceBudget === "game" ? " selected" : "") + '>Gaming</option><option value="max"' + (scene.performanceBudget === "max" ? " selected" : "") + '>Maximum</option></select></label>' +
              '</div>' +
              '<label class="inline-field product-range-field"><span>Motion ' + escapeHtml(String(scene.animationIntensity == null ? 25 : scene.animationIntensity)) + '%</span><input class="inline-range" type="range" min="0" max="100" name="animationIntensity" value="' + escapeHtml(String(scene.animationIntensity == null ? 25 : scene.animationIntensity)) + '" aria-label="Motion for ' + escapeHtml(scene.name) + '"></label>' +
              '<div class="inline-actions"><button class="inline-button is-primary" type="submit"' + (state.busy ? " disabled" : "") + '>Save Mode</button><button class="inline-button" type="button" data-scene-delete="' + escapeHtml(scene.id) + '" aria-label="' + escapeHtml(state.confirmDeleteId === scene.id ? "Confirm delete " + scene.name + " Mode" : "Delete " + scene.name + " Mode") + '"' + (state.busy ? " disabled" : "") + '>' + (state.confirmDeleteId === scene.id ? "Confirm delete" : "Delete Mode") + '</button></div>' +
            '</form>';
          return '<article class="product-card' + (active ? " is-selected" : "") + '" data-scene-card="' + escapeHtml(scene.id) + '">' +
            '<span class="product-card__topline">' + escapeHtml(scene.icon || "scene") + (scene.isBuiltIn ? " · Built in" : " · Custom") + '</span>' +
            '<strong>' + escapeHtml(scene.name) + '</strong>' +
            '<span class="product-card__meta">' + escapeHtml(friendlySurfaceNames(scene).join(" · ")) + '</span>' +
            '<div class="auxora-scene-stats"><span>' + escapeHtml(friendlyChoice(scene.density, "density")) + '</span><span>' + escapeHtml(String(scene.animationIntensity == null ? 25 : scene.animationIntensity)) + '% motion</span><span>' + escapeHtml(friendlyChoice(scene.performanceBudget, "performance")) + '</span></div>' +
            '<div class="inline-actions"><button class="inline-button' + (active ? " is-primary" : "") + '" type="button" data-scene-activate="' + escapeHtml(scene.id) + '" aria-label="' + escapeHtml(active ? scene.name + " Mode active" : "Use " + scene.name + " Mode") + '"' + (state.busy ? " disabled" : "") + '>' + (active ? "Active" : "Use Mode") + '</button><button class="inline-button" type="button" data-scene-duplicate="' + escapeHtml(scene.id) + '" aria-label="' + escapeHtml("Duplicate " + scene.name + " Mode") + '"' + (state.busy ? " disabled" : "") + '>Duplicate</button></div>' +
            customEditor +
          '</article>';
        }).join("") + '</div>' +
        (state.displays.length ? '<article class="list-card inline-card"><div class="inline-card-header"><div><div class="metric-label">Display assignments</div><div class="router-inline-copy">Choose the Mode each companion display should use, or leave it unassigned.</div></div></div><div class="inline-form-grid inline-form-grid--2">' + state.displays.map(function (display) {
          var assignment = assignments.filter(function (item) { return item.displayId === display.id; })[0];
          return '<label class="inline-field"><span>' + escapeHtml(display.label) + '</span><select class="inline-select" data-mode-display-id="' + escapeHtml(display.id) + '"><option value="">Not assigned</option>' + profiles.map(function (scene) {
            return '<option value="' + escapeHtml(scene.id) + '"' + (assignment && assignment.sceneId === scene.id ? " selected" : "") + '>' + escapeHtml(scene.name) + '</option>';
          }).join("") + '</select></label>';
        }).join("") + '</div></article>' : '') +
        '<div class="inline-actions">' + (state.payload && (state.payload.manualOverrideActive || state.payload.automationEnabled === false) ? '<button class="inline-button is-primary" type="button" data-scene-resume' + (state.busy ? " disabled" : "") + '>' + (state.payload.automationEnabled === false ? "Turn on automatic switching" : "Resume automatic switching") + '</button>' : '') + '<span class="inline-copy">' + (state.payload && state.payload.automaticSwitchingActive ? "Automatic switching is on" : "A manual Mode is active") + '</span></div>'
      ));
      initXnSlider(container);
    }

    function refresh() {
      return Promise.all([
        requestJson(buildBridgeUrl(env, "/api/scenes"), {}, 6000),
        requestJson(buildBridgeUrl(env, "/api/display/diagnostics"), {}, 6000).catch(function () { return {}; })
      ]).then(function (payloads) {
        state.payload = payloads[0];
        state.displays = Array.isArray(payloads[1].displays) ? payloads[1].displays : [];
        state.message = text(payloads[0].message, "Modes ready");
        state.tone = "good";
        redraw();
      }, function (error) {
        state.message = error.message || "Modes unavailable";
        state.tone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var activate = event.target && event.target.closest ? event.target.closest("[data-scene-activate]") : null;
      var duplicate = event.target && event.target.closest ? event.target.closest("[data-scene-duplicate]") : null;
      var deleteButton = event.target && event.target.closest ? event.target.closest("[data-scene-delete]") : null;
      var resume = event.target && event.target.closest ? event.target.closest("[data-scene-resume]") : null;
      var operation;
      var synchronizeScene = false;
      if (activate && typeof env.activateScene === "function") {
        state.busy = true;
        operation = env.activateScene(activate.getAttribute("data-scene-activate"), 120);
      } else if (resume && typeof env.resumeSceneAutomation === "function") {
        state.busy = true;
        operation = env.resumeSceneAutomation();
      } else if (duplicate) {
        state.busy = true;
        synchronizeScene = true;
        operation = requestJson(buildBridgeUrl(env, "/api/scenes/duplicate"), {
          method: "POST", body: { sceneId: duplicate.getAttribute("data-scene-duplicate") }
        }, 7000);
      } else if (deleteButton) {
        var deleteId = deleteButton.getAttribute("data-scene-delete") || "";
        if (state.confirmDeleteId !== deleteId) {
          state.confirmDeleteId = deleteId;
          window.clearTimeout(deleteConfirmationTimer);
          deleteConfirmationTimer = window.setTimeout(function () {
            state.confirmDeleteId = "";
            redraw();
          }, 8000);
          redraw();
          return;
        }
        state.busy = true;
        state.confirmDeleteId = "";
        window.clearTimeout(deleteConfirmationTimer);
        synchronizeScene = true;
        operation = requestJson(buildBridgeUrl(env, "/api/scenes/delete"), {
          method: "POST", body: { sceneId: deleteId }
        }, 7000);
      }
      if (operation) {
        Promise.resolve(operation).then(function (payload) {
          if (synchronizeScene && payload && payload.activeSceneId && typeof env.activateScene === "function") {
            return Promise.resolve(env.activateScene(payload.activeSceneId, 120)).then(function (synchronized) {
              return synchronized || payload;
            });
          }
          return payload;
        }).then(function (payload) {
          state.payload = payload;
          state.message = text(payload.message, "Mode updated");
          state.tone = "good";
        }, function (error) {
          state.message = error.message || "Mode update failed";
          state.tone = "danger";
        }).finally(function () {
          state.busy = false;
          redraw();
        });
      }
    });

    addListener(cleanups, container, "submit", function (event) {
      var form = event.target && event.target.closest ? event.target.closest("form[data-scene-edit]") : null;
      var scene;
      var formData;
      var updated;
      if (!form) {
        return;
      }
      event.preventDefault();
      if (state.busy) {
        return;
      }
      scene = state.payload && Array.isArray(state.payload.profiles) ? state.payload.profiles.filter(function (candidate) {
        return candidate && candidate.id === form.getAttribute("data-scene-edit") && candidate.isBuiltIn === false;
      })[0] : null;
      if (!scene) {
        state.message = "Custom Mode is no longer available";
        state.tone = "danger";
        redraw();
        return;
      }
      formData = new FormData(form);
      updated = Object.assign({}, scene, {
        name: String(formData.get("name") || ""),
        themeId: String(formData.get("themeId") || "focus"),
        density: String(formData.get("density") || "comfortable"),
        animationIntensity: Number(formData.get("animationIntensity") || 0),
        performanceBudget: String(formData.get("performanceBudget") || "balanced"),
        widgets: sceneWidgetIds(scene)
      });
      state.busy = true;
      requestJson(buildBridgeUrl(env, "/api/scenes"), {
        method: "POST", body: { scene: updated }
      }, 7000).then(function (payload) {
        if (payload && payload.activeSceneId === scene.id && typeof env.activateScene === "function") {
          return Promise.resolve(env.activateScene(scene.id, 120)).then(function (synchronized) {
            return synchronized || payload;
          });
        }
        return payload;
      }).then(function (payload) {
        state.payload = payload;
        state.message = "Custom Mode saved";
        state.tone = "good";
      }, function (error) {
        state.message = error.message || "Custom Mode could not be saved";
        state.tone = "danger";
      }).finally(function () {
        state.busy = false;
        redraw();
      });
    });

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      if (!target || !target.hasAttribute("data-mode-display-id")) {
        return;
      }
      state.busy = true;
      requestJson(buildBridgeUrl(env, "/api/scenes/displays"), {
        method: "POST", body: { displayId: target.getAttribute("data-mode-display-id"), sceneId: target.value }
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
    return { refresh: refresh, destroy: function () { window.clearTimeout(deleteConfirmationTimer); runCleanups(cleanups); patchStableDom(container, ""); } };
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

    function publishControlStatus(payload, fallbackMessage) {
      var displays = payload && Array.isArray(payload.displays) ? payload.displays : [];
      var status = payload && payload.supported ? "Ready" : displays.length ? "Limited" : "Unavailable";
      var tone = status === "Ready" ? "good" : status === "Limited" ? "warn" : "muted";
      if (typeof env.publishStatus === "function") {
        env.publishStatus(status, tone, text(payload && payload.message, fallbackMessage || "Monitor controls checked"));
      }
    }

    function redraw() {
      var displays = state.payload && Array.isArray(state.payload.displays) ? state.payload.displays : [];
      patchStableDom(container, productShell(
        "Monitor control",
        "Display Controls",
        "Control only non-primary companion displays through Windows DDC/CI. The Windows primary display is excluded.",
        state.message,
        state.tone,
        state.payload === null ? '<div class="inline-empty"><strong>Checking companion controls</strong><span>Reading DDC/CI capabilities from non-primary displays.</span></div>' : displays.length ? '<div class="inline-list">' + displays.map(function (display) {
          return '<article class="list-card inline-card"><div class="inline-card-header"><div><div class="metric-label">Display ' + escapeHtml(String(display.index + 1)) + '</div><h3 class="inline-title">' + escapeHtml(display.name) + '</h3></div>' + statusPill(display.brightnessSupported || display.contrastSupported ? "DDC/CI" : "Limited", display.brightnessSupported || display.contrastSupported ? "good" : "warn") + '</div>' +
            '<div class="inline-form-grid inline-form-grid--2">' +
              (display.brightnessSupported ? '<label class="inline-field product-range-field"><span>Brightness ' + escapeHtml(String(display.brightness)) + '%</span><input class="inline-range" type="range" min="0" max="100" value="' + escapeHtml(String(display.brightness)) + '" aria-label="Brightness for ' + escapeHtml(display.name) + '" data-monitor-control="brightness" data-monitor-index="' + display.index + '"></label>' : '') +
              (display.contrastSupported ? '<label class="inline-field product-range-field"><span>Contrast ' + escapeHtml(String(display.contrast)) + '%</span><input class="inline-range" type="range" min="0" max="100" value="' + escapeHtml(String(display.contrast)) + '" aria-label="Contrast for ' + escapeHtml(display.name) + '" data-monitor-control="contrast" data-monitor-index="' + display.index + '"></label>' : '') +
            '</div>' +
            '<div class="inline-actions">' +
              (display.inputSupported ? '<label class="inline-field"><span>Input source: ' + escapeHtml(monitorInputLabel(display.inputSource)) + '</span><input class="inline-input" type="number" min="1" max="31" value="' + escapeHtml(String(display.inputSource)) + '" aria-label="Input source code for ' + escapeHtml(display.name) + '; current source ' + escapeHtml(monitorInputLabel(display.inputSource)) + '" data-monitor-control="input" data-monitor-index="' + display.index + '"></label>' : '') +
              (display.powerSupported ? '<button class="inline-button" type="button" aria-label="' + (state.confirmPowerIndex === display.index ? "Confirm turning off " : "Turn off ") + escapeHtml(display.name) + '" data-monitor-power="' + display.index + '">' + (state.confirmPowerIndex === display.index ? "Confirm display off" : "Turn display off") + '</button>' : '') +
            '</div></article>';
        }).join("") + '</div>' : '<div class="inline-empty"><strong>No companion DDC/CI controls found</strong><span>The Windows primary display is excluded. Enable DDC/CI in the companion monitor menu if it is supported.</span></div>'
      ));
      initXnSlider(container);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/displays/controls"), {}, 8000).then(function (payload) {
        state.payload = payload;
        state.message = text(payload.message, "Monitor controls checked");
        state.tone = payload.supported ? "good" : "warn";
        publishControlStatus(payload, state.message);
        redraw();
      }, function (error) {
        state.message = error.message || "Monitor controls unavailable";
        state.tone = "danger";
        if (typeof env.publishStatus === "function") {
          env.publishStatus("Unavailable", "danger", state.message);
        }
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
        publishControlStatus(payload, state.message);
      }, function (error) {
        state.message = error.message || "Monitor update failed";
        state.tone = "danger";
        if (typeof env.publishStatus === "function") {
          env.publishStatus("Degraded", "warn", state.message);
        }
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
    return { refresh: refresh, destroy: function () { runCleanups(cleanups); patchStableDom(container, ""); } };
  }

  function mountRemoteWidget(widget, container, env) {
    if (typeof env.publishStatus === "function") {
      env.publishStatus("Unavailable", "danger", "Phone Remote is not included in this beta.");
    }
    patchStableDom(container, productShell(
      "Not included in 0.3.0-beta.1",
      "Phone Remote",
      "Phone Remote is unavailable for this beta. Auxora does not open a phone-control listener or create remote links.",
      "Unavailable",
      "muted",
      '<div class="inline-empty"><strong>No phone session is available</strong><span>There is no phone-control action in this build. Use the Auxora display on this PC.</span></div>'
    ));
    return { refresh: function () { return Promise.resolve(); }, destroy: function () { patchStableDom(container, ""); } };
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

    function normalizeLocalObsEndpoint(value) {
      var raw = text(value, "").trim();
      var parsed;
      try {
        parsed = new URL(raw);
      } catch (error) {
        return "";
      }

      var host = parsed.hostname.toLowerCase();
      var loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
      if ((parsed.protocol !== "ws:" && parsed.protocol !== "wss:")
          || !loopback
          || parsed.username
          || parsed.password
          || (parsed.pathname && parsed.pathname !== "/")
          || parsed.search
          || parsed.hash) {
        return "";
      }

      return parsed.toString();
    }

    function redraw() {
      var endpoint = settingValue(env, "obsEndpoint", "ws://127.0.0.1:4455");
      var scene = settingValue(env, "streamScene", "Main");
      if (typeof env.publishStatus === "function") {
        env.publishStatus("Preview", "warn", "Local OBS reachability only; this beta does not issue OBS commands.");
      }
      patchStableDom(container, productShell(
        "OBS reachability preview",
        "Streaming",
        "Keep a stream-ready control surface nearby. This beta only verifies local OBS reachability; it does not issue OBS commands.",
        state.statusText,
        state.statusTone,
        '<form class="inline-form product-control-panel" data-form="streaming">' +
          '<div class="inline-form-grid inline-form-grid--2">' +
            '<label class="inline-field"><span>OBS address</span><input class="inline-input" type="text" name="obsEndpoint" value="' + escapeHtml(endpoint) + '" placeholder="ws://127.0.0.1:4455"></label>' +
            '<label class="inline-field"><span>Main scene</span><input class="inline-input" type="text" name="streamScene" value="' + escapeHtml(scene) + '" placeholder="Main"></label>' +
          '</div>' +
          '<div class="inline-actions"><button class="inline-button is-primary" type="submit"' + (state.busy ? " disabled" : "") + '>Save &amp; check OBS</button></div>' +
        '</form>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Scene", scene, "Saved locally", null) +
          metricCard("OBS", state.statusText, "Connection probe", null) +
          metricCard("Layout", "Stream controls", "Quick glance setup", null) +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button" type="button" data-action="open-media">Open Audio & Media</button>' +
          '<button class="inline-button" type="button" data-action="stream-profile">Use streaming layout</button>' +
        '</div>'
      ));
    }

    function probeObs(endpointValue) {
      var endpoint = normalizeLocalObsEndpoint(endpointValue || settingValue(env, "obsEndpoint", "ws://127.0.0.1:4455"));
      var timerId;

      if (!endpoint) {
        state.busy = false;
        state.statusText = "Local address required";
        state.statusTone = "danger";
        redraw();
        return;
      }

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
      var endpoint = normalizeLocalObsEndpoint(data.get("obsEndpoint"));
      if (!endpoint) {
        state.busy = false;
        state.statusText = "Local address required";
        state.statusTone = "danger";
        redraw();
        return "";
      }

      saveSettings(env, {
        obsEndpoint: endpoint,
        streamScene: String(data.get("streamScene") || "Main")
      });
      return endpoint;
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var profile = findById(productProfiles, "streaming");
      if (!target) {
        return;
      }

      if (target.getAttribute("data-action") === "open-media" && typeof env.selectWidget === "function") {
        env.selectWidget("audio", true);
      } else if (target.getAttribute("data-action") === "stream-profile") {
        saveSettings(env, {
          profileId: profile.id,
          themeId: profile.themeId,
          accentMode: "preset",
          customAccentColor: "",
          accentColor: "",
          marketplacePack: profile.pack,
          layoutOrder: profile.layout.join(",")
        });
        redraw();
      }
    });

    addListener(cleanups, container, "submit", function (event) {
      var form = event.target;
      if (!form || form.getAttribute("data-form") !== "streaming") {
        return;
      }

      event.preventDefault();
      var endpoint = saveForm(form);
      if (endpoint) {
        probeObs(endpoint);
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
        patchStableDom(container, "");
      }
    };
  }

  function mountMarketplaceWidget(widget, container, env) {
    var cleanups = [];
    var state = { extensions: [], trustedPublisherCount: 0, message: "Checking third-party manifests", tone: "warn" };

    function redraw() {
      var activePack = settingValue(env, "marketplacePack", "core");
      var verifiedCount = state.extensions.filter(function (extension) { return extension.verified; }).length;
      if (typeof env.publishStatus === "function") {
        env.publishStatus("Available", "good", "Built-in widget packs are available. Third-party loading is disabled in this beta.");
      }
      patchStableDom(container, productShell(
        "Local dashboard layouts",
        "Widget Packs",
        "Apply a built-in dashboard layout. Auxora can inspect third-party manifests, but this beta never loads or runs third-party code.",
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
        '<article class="list-card inline-card"><div class="inline-card-header"><div><div class="metric-label">Third-party manifest inspection</div><div class="router-inline-copy">' + escapeHtml(state.message) + ' · ' + escapeHtml(String(state.trustedPublisherCount)) + ' trusted publishers</div></div>' + statusPill(state.extensions.length ? verifiedCount + " verified" : "Inspection only", state.extensions.length && verifiedCount !== state.extensions.length ? "warn" : "muted") + '</div><div class="inline-list">' + (state.extensions.length ? state.extensions.map(function (extension) {
          return '<div class="inline-list-item"><div><strong>' + escapeHtml(extension.name) + '</strong><div class="inline-list-copy">' + escapeHtml(extension.message) + '</div><div class="inline-list-meta">' + escapeHtml((extension.permissions || []).join(" · ") || "No permissions") + '</div></div>' + statusPill(extension.verified ? "Verified manifest" : "Rejected", extension.verified ? "good" : "danger") + '</div>';
        }).join("") : '<div class="inline-empty"><strong>No third-party manifests installed</strong><span>Built-in packs are ready. Third-party loading is disabled in this beta, even when a manifest passes inspection.</span></div>') + '</div></article>'
      ));
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
        state.message = text(payload.message, "Third-party manifests checked");
        state.tone = "good";
        redraw();
      }, function (error) {
        state.message = error.message || "Manifest inspection unavailable";
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
        patchStableDom(container, "");
      }
    };
  }

  function mountInstallerWidget(widget, container, env) {
    var cleanups = [];
    var confirmTimer = 0;
    var confirmations = {
      repair: "Repair may briefly interrupt the local Auxora service.",
      "safe-mode": "Safe Mode restarts Auxora and interrupts the current display.",
      quit: "Quit closes Auxora and leaves the companion display blank until it is reopened."
    };
    var state = {
      statusText: "Checking",
      statusDetail: "Checking recovery actions",
      statusTone: "warn",
      busy: false,
      actions: [],
      pendingAction: ""
    };

    function redraw() {
      if (typeof env.publishStatus === "function") {
        env.publishStatus(state.statusText, state.statusTone, state.statusDetail);
      }
      patchStableDom(container, productShell(
        "Recovery tools",
        "Recovery",
        "Use these actions when the dashboard or installed app needs help. Unavailable actions stay disabled until Auxora is fully installed.",
        state.statusText,
        state.statusTone,
        '<div class="router-inline-copy" role="status">' + escapeHtml(state.statusDetail) + '</div><div class="inline-list inline-list--recovery">' + (state.actions.length ? state.actions.map(function (action) {
          var pending = state.pendingAction === action.id;
          return '<div class="inline-list-item"><div><strong>' + escapeHtml(action.label) + '</strong><div class="inline-list-copy">' + escapeHtml(action.message) + '</div></div>' +
            (pending ? '<div class="recovery-confirm" role="alert"><span>' + escapeHtml(confirmations[action.id]) + '</span><button class="inline-button is-primary" type="button" data-recovery-confirm="' + escapeHtml(action.id) + '">Confirm ' + escapeHtml(action.label) + '</button><button class="inline-button" type="button" data-recovery-cancel>Cancel</button></div>' : '<button class="inline-button" type="button" data-recovery-action="' + escapeHtml(action.id) + '"' + ((!action.available || state.busy) ? " disabled" : "") + ' aria-label="' + escapeHtml(action.label) + '">' + escapeHtml(action.label) + '</button>') + '</div>';
        }).join("") : '<div class="inline-empty"><strong>Recovery actions are loading</strong><span>Auxora is checking which recovery actions are available in this run.</span></div>') + '</div>'
      ));
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/recovery"), {}, 7000).then(function (payload) {
        state.actions = Array.isArray(payload.actions) ? payload.actions : [];
        state.statusText = payload && payload.status === "ready" ? "Ready" : "Waiting for display";
        state.statusDetail = text(payload.message, "Recovery actions checked");
        state.statusTone = payload && payload.status === "ready" ? "good" : "warn";
      }, function (error) {
        state.actions = [];
        state.statusText = "Unavailable";
        state.statusDetail = error.message || "Recovery actions unavailable";
        state.statusTone = "danger";
      }).finally(redraw);
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-recovery-action]") : null;
      var confirm = event.target && event.target.closest ? event.target.closest("[data-recovery-confirm]") : null;
      var cancel = event.target && event.target.closest ? event.target.closest("[data-recovery-cancel]") : null;
      var action;
      if (cancel) {
        window.clearTimeout(confirmTimer);
        state.pendingAction = "";
        redraw();
        return;
      }
      if (!target && !confirm) {
        return;
      }

      action = confirm ? confirm.getAttribute("data-recovery-confirm") : target.getAttribute("data-recovery-action");
      if (action === "retry") {
        state.statusText = "Retrying dashboard";
        state.statusDetail = "Reloading this dashboard window.";
        state.statusTone = "warn";
        redraw();
        window.location.reload();
        return;
      }

      if (confirmations[action] && !confirm) {
        window.clearTimeout(confirmTimer);
        state.pendingAction = action;
        state.statusText = "Confirmation required";
        state.statusDetail = confirmations[action];
        state.statusTone = "warn";
        redraw();
        var confirmButton = container.querySelector("[data-recovery-confirm='" + action + "']");
        if (confirmButton) { confirmButton.focus(); }
        confirmTimer = window.setTimeout(function () {
          state.pendingAction = "";
          state.statusText = "Confirmation expired";
          state.statusDetail = "Choose the recovery action again if you still want to run it.";
          redraw();
        }, 10000);
        return;
      }

      window.clearTimeout(confirmTimer);
      state.pendingAction = "";
      state.busy = true;
      state.statusText = "Starting " + text(target && target.textContent, action).trim();
      state.statusDetail = "Auxora is starting the selected recovery action.";
      state.statusTone = "warn";
      redraw();
      requestJson(buildBridgeUrl(env, "/api/recovery/action"), {
        method: "POST",
        body: { action: action }
      }, 8000).then(function (payload) {
        state.statusText = payload.ok ? "Started" : "Needs attention";
        state.statusDetail = text(payload.message, "Recovery action started");
        state.statusTone = payload.ok ? "good" : "warn";
      }, function (error) {
        state.statusText = "Failed";
        state.statusDetail = error.message || "Recovery action failed";
        state.statusTone = "danger";
      }).finally(function () {
        state.busy = false;
        redraw();
      });
    });

    addListener(cleanups, container, "keydown", function (event) {
      if (event.key === "Escape" && state.pendingAction) {
        event.preventDefault();
        window.clearTimeout(confirmTimer);
        state.pendingAction = "";
        state.statusText = "Action cancelled";
        state.statusDetail = "No recovery action was started.";
        redraw();
      }
    });

    redraw();
    refresh();
    return {
      refresh: refresh,
      destroy: function () {
        window.clearTimeout(confirmTimer);
        runCleanups(cleanups);
        patchStableDom(container, "");
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
      foregroundTrackingEnabled: Boolean(env.bridgeConfig && env.bridgeConfig.dashboard && env.bridgeConfig.dashboard.foregroundAppTrackingEnabled),
      mediaMetadataVisible: Boolean(env.bridgeConfig && env.bridgeConfig.dashboard && env.bridgeConfig.dashboard.mediaMetadataVisible),
      audioSessionLabelsVisible: Boolean(env.bridgeConfig && env.bridgeConfig.dashboard && env.bridgeConfig.dashboard.audioSessionLabelsVisible)
    };
    var statusGeneration = 0;

    function setStatus(statusText, statusTone) {
      statusGeneration += 1;
      state.statusText = statusText;
      state.statusTone = statusTone;
      return statusGeneration;
    }

    function setStatusIfCurrent(generation, statusText, statusTone) {
      if (statusGeneration === generation) {
        state.statusText = statusText;
        state.statusTone = statusTone;
      }
    }

    function redraw() {
      var settings = typeof env.getSettings === "function" ? env.getSettings() : {};
      patchStableDom(container, productShell(
        "Trust and portability",
        "Privacy",
        "Review what stays local, then safely export or import dashboard-only preferences without exposing credentials.",
        state.statusText,
        state.statusTone,
        '<div class="inline-grid inline-grid--3 product-privacy-metrics">' +
          '<article class="list-card inline-card product-privacy-metric"><div class="metric-label">Settings</div><div class="product-privacy-metric__state"><strong>Saved on this PC</strong>' + statusPill("Local", "good") + '</div><div class="router-inline-copy">Theme, layout, and panel preferences</div></article>' +
          '<article class="list-card inline-card product-privacy-metric"><div class="metric-label">Device controls</div><div class="product-privacy-metric__state"><strong>Stay on this PC</strong>' + statusPill("Local", "good") + '</div><div class="router-inline-copy">System, network, and audio controls</div></article>' +
          '<article class="list-card inline-card product-privacy-metric"><div class="metric-label">Internet use</div><div class="product-privacy-metric__state"><strong>Only when enabled</strong>' + statusPill("Optional", "muted") + '</div><div class="router-inline-copy">Weather, updates, and connections you add</div></article>' +
        '</div>' +
        '<div class="product-privacy-overview"><strong>Private by default</strong><span>Auxora keeps settings and device controls on this PC. It uses the internet only for features you turn on.</span></div>' +
        '<details class="product-privacy-disclosure" data-ui-key="privacy-disclosure" data-preserve-open>' +
          '<summary>What Auxora stores</summary>' +
          '<div class="product-privacy-details__body">' +
            '<div class="product-privacy-list">' +
              '<div><strong>Stays on this PC</strong><span>Dashboard preferences, panel connections, layout, streaming target, and recovery state.</span></div>' +
              '<div><strong>Requires permission</strong><span>Weather access, calendar feeds, Hue pairing, and optional connections you enable.</span></div>' +
              '<div><strong>Foreground-app tracking is ' + (state.foregroundTrackingEnabled ? "on" : "off") + '</strong><span>When on, Auxora observes the active app executable path and stores its display name, path, source, and last-opened time locally. Up to 24 recent entries are retained until you turn this off or reset app data. Nothing is uploaded.</span></div>' +
              '<div><strong>Media details are ' + (state.mediaMetadataVisible ? "visible" : "private") + '</strong><span>When visible, Audio & Media can show the local media app, title, artist, album, and artwork. Off shows generic playback state and controls.</span></div>' +
              '<div><strong>Audio app labels are ' + (state.audioSessionLabelsVisible ? "visible" : "private") + '</strong><span>When visible, the mixer can show local application names and process details. Off keeps generic application labels while volume controls continue to work.</span></div>' +
              '<div><strong>Independent software</strong><span>This app is not an official CORSAIR product and is not endorsed by integration providers unless a written agreement says otherwise.</span></div>' +
            '</div>' +
          '</div>' +
        '</details>' +
        '<div class="metric-label product-privacy-permissions-label">Optional permissions — off by default</div>' +
        '<div class="product-privacy-permissions">' +
          '<label class="inline-field inline-field--checkbox"><input type="checkbox" data-foreground-tracking' + (state.foregroundTrackingEnabled ? " checked" : "") + (state.diagnosticsBusy ? " disabled" : "") + '> <span>Build Recent Apps from the app I am using</span></label>' +
          '<label class="inline-field inline-field--checkbox"><input type="checkbox" data-media-metadata' + (state.mediaMetadataVisible ? " checked" : "") + (state.diagnosticsBusy ? " disabled" : "") + '> <span>Show media titles and artwork on this display (off by default)</span></label>' +
          '<label class="inline-field inline-field--checkbox"><input type="checkbox" data-audio-session-labels' + (state.audioSessionLabelsVisible ? " checked" : "") + (state.diagnosticsBusy ? " disabled" : "") + '> <span>Show application names in the audio mixer (off by default)</span></label>' +
        '</div>' +
        '<div class="product-privacy-tools">' +
          '<details class="product-privacy-details" data-ui-key="privacy-diagnostics" data-preserve-open>' +
            '<summary><span><strong>Diagnostic events</strong><small>Sanitized local events; no clipboard text, passwords, or local paths.</small></span></summary>' +
            '<div class="product-privacy-details__body">' +
              '<div class="inline-card-header"><div class="metric-label">Recent diagnostic events</div><button class="inline-button" type="button" data-action="refresh-diagnostics"' + (state.diagnosticsBusy ? ' aria-disabled="true"' : "") + '>Refresh</button></div>' +
              '<div class="inline-list">' + (state.diagnosticEvents.length ? state.diagnosticEvents.map(function (entry) {
                return '<div class="inline-list-item"><div class="inline-list-copy">' + escapeHtml(entry) + '</div></div>';
              }).join("") : '<div class="inline-empty"><strong>No diagnostics loaded</strong><span>Refresh to read the latest sanitized local events.</span></div>') + '</div>' +
            '</div>' +
          '</details>' +
          '<details class="product-privacy-details" data-ui-key="privacy-reset"' + (state.confirmReset ? " open" : "") + '>' +
            '<summary><span><strong>Backup, restore, and reset</strong><small>Copy portable settings, restore a backup, or reset this installation.</small></span></summary>' +
            '<div class="product-privacy-details__body">' +
              '<div class="inline-actions">' +
                '<button class="inline-button is-primary" type="button" data-action="export-backup">Copy Auxora backup</button>' +
                '<button class="inline-button" type="button" data-action="restore-backup">Restore Auxora backup</button>' +
                '<button class="inline-button" type="button" data-action="reset-settings">Reset local settings</button>' +
                '<button class="inline-button" type="button" data-action="reset-all-local-data">' + (state.confirmReset ? "Confirm reset" : "Reset all app data") + '</button>' +
                '<a class="inline-button" href="/support.html" target="_blank" rel="noreferrer">Support</a>' +
              '</div>' +
              '<label class="inline-field"><span>Restore presentation and Modes</span><textarea class="inline-input" data-settings-import rows="4" placeholder="Paste an Auxora backup. Passwords, private connections, app paths, display identifiers, and logs are never included."></textarea></label>' +
              '<div><div class="metric-label">Current portable settings</div><div class="product-code-preview">' + escapeHtml(JSON.stringify(settings, null, 2).slice(0, 520)) + '</div></div>' +
            '</div>' +
          '</details>' +
        '</div>'
      ));
    }

    function refreshDiagnostics() {
      var generation;
      state.diagnosticsBusy = true;
      generation = setStatus("Loading diagnostics", "warn");
      redraw();
      return requestJson(buildBridgeUrl(env, "/api/support/bundle"), {}, 8000).then(function (payload) {
        state.diagnosticEvents = Array.isArray(payload.log) ? payload.log.slice(-6).reverse() : [];
        setStatusIfCurrent(generation, "Diagnostics refreshed", "good");
      }, function (error) {
        setStatusIfCurrent(generation, error.message || "Diagnostics unavailable", "danger");
      }).finally(function () {
        state.diagnosticsBusy = false;
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var settings;
      var generation;
      if (!target) {
        return;
      }

      if (target.getAttribute("data-action") === "export-backup") {
        generation = setStatus("Preparing backup", "warn");
        redraw();
        requestJson(buildBridgeUrl(env, "/api/config/backup"), {}, 7000).then(function (backup) {
          var localSettings = typeof env.getSettings === "function" ? env.getSettings() : {};
          backup.dashboard = Object.assign({}, backup.dashboard || {}, buildPortableDashboardSettings(localSettings));
          return copyTextToClipboard(JSON.stringify(backup, null, 2));
        }).then(function () {
          setStatusIfCurrent(generation, "Auxora backup copied", "good");
          redraw();
        }, function (error) {
          setStatusIfCurrent(generation, error.message || "Copy failed", "danger");
          redraw();
        });
      } else if (target.getAttribute("data-action") === "restore-backup") {
        var localDashboardSettings;
        try {
          settings = JSON.parse(container.querySelector("[data-settings-import]").value || "");
          localDashboardSettings = readPortableDashboardSettings(settings);
        } catch (error) {
          setStatus("Backup JSON is invalid", "danger");
          redraw();
          return;
        }
        generation = setStatus("Restoring backup", "warn");
        redraw();
        requestJson(buildBridgeUrl(env, "/api/config/backup"), { method: "POST", body: settings }, 9000).then(function () {
          if (Object.keys(localDashboardSettings).length) {
            saveSettings(env, localDashboardSettings);
          }
          setStatusIfCurrent(generation, "Auxora backup restored", "good");
          if (typeof env.handleSetupUpdate === "function") {
            return env.handleSetupUpdate("local-settings");
          }
        }, function (error) {
          setStatusIfCurrent(generation, error.message || "Restore failed", "danger");
        }).finally(redraw);
      } else if (target.getAttribute("data-action") === "refresh-diagnostics") {
        if (state.diagnosticsBusy) {
          return;
        }
        refreshDiagnostics();
      } else if (target.getAttribute("data-action") === "reset-settings" && typeof env.resetSettings === "function") {
        env.resetSettings();
        setStatus("Settings reset", "warn");
        state.confirmReset = false;
        redraw();
      } else if (target.getAttribute("data-action") === "reset-all-local-data" && typeof env.resetAllLocalData === "function") {
        if (!state.confirmReset) {
          state.confirmReset = true;
          setStatus("Tap again", "warn");
          redraw();
          return;
        }

        generation = setStatus("Resetting app data", "warn");
        redraw();
        env.resetAllLocalData().then(function () {
          setStatusIfCurrent(generation, "App data reset", "warn");
          state.confirmReset = false;
          redraw();
        }, function (error) {
          setStatusIfCurrent(generation, error.message || "Reset failed", "danger");
          state.confirmReset = false;
          redraw();
        });
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      var field;
      var startingStatus;
      var enabledStatus;
      var disabledStatus;
      var payload = {};
      if (!target) {
        return;
      }

      if (target.hasAttribute("data-foreground-tracking")) {
        field = "foregroundAppTrackingEnabled";
        startingStatus = target.checked ? "Enabling foreground tracking" : "Disabling and clearing recent history";
        enabledStatus = "Foreground tracking enabled";
        disabledStatus = "Foreground tracking off; recent history cleared";
      } else if (target.hasAttribute("data-media-metadata")) {
        field = "mediaMetadataVisible";
        startingStatus = target.checked ? "Showing media details" : "Hiding media details";
        enabledStatus = "Media details visible";
        disabledStatus = "Media details private";
      } else if (target.hasAttribute("data-audio-session-labels")) {
        field = "audioSessionLabelsVisible";
        startingStatus = target.checked ? "Showing audio app labels" : "Hiding audio app labels";
        enabledStatus = "Audio app labels visible";
        disabledStatus = "Audio app labels private";
      } else {
        return;
      }

      state.diagnosticsBusy = true;
      var generation = setStatus(startingStatus, "warn");
      payload[field] = Boolean(target.checked);
      redraw();
      requestJson(buildBridgeUrl(env, "/api/config/dashboard"), {
        method: "POST",
        body: payload
      }, 8000).then(function (payload) {
        var dashboard = payload && payload.dashboard ? payload.dashboard : {};
        state.foregroundTrackingEnabled = Boolean(dashboard.foregroundAppTrackingEnabled);
        state.mediaMetadataVisible = Boolean(dashboard.mediaMetadataVisible);
        state.audioSessionLabelsVisible = Boolean(dashboard.audioSessionLabelsVisible);
        if (env.bridgeConfig && env.bridgeConfig.dashboard) {
          env.bridgeConfig.dashboard.foregroundAppTrackingEnabled = state.foregroundTrackingEnabled;
          env.bridgeConfig.dashboard.mediaMetadataVisible = state.mediaMetadataVisible;
          env.bridgeConfig.dashboard.audioSessionLabelsVisible = state.audioSessionLabelsVisible;
        }
        setStatusIfCurrent(generation, Boolean(dashboard[field]) ? enabledStatus : disabledStatus, Boolean(dashboard[field]) ? "warn" : "good");
      }, function (error) {
        setStatusIfCurrent(generation, error.message || "Privacy setting failed", "danger");
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
        patchStableDom(container, "");
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
