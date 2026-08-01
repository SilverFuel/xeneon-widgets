(function () {
  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime || typeof runtime.registerRenderer !== "function") {
    return;
  }

  var advancedSetupSchemas = [];
  var RESET_CONFIRMATION_WINDOW_MS = 8000;
  var addListener = runtime.addListener;
  var buildBridgeUrl = runtime.buildBridgeUrl;
  var clamp = runtime.clamp;
  var createTimerLoop = runtime.createTimerLoop;
  var emptyState = runtime.emptyState;
  var emitTouchFeedback = runtime.emitTouchFeedback;
  var escapeHtml = runtime.escapeHtml;
  var formatAge = runtime.formatAge;
  var metricCard = runtime.metricCard;
  var optionalNumber = runtime.optionalNumber;
  var patchStableDom = runtime.patchStableDom;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var saveSettings = runtime.saveSettings;
  var statusPill = runtime.statusPill;
  var statusTextFromPayload = runtime.statusTextFromPayload;
  var statusToneFromPayload = runtime.statusToneFromPayload;
  var text = runtime.text;
  var toneForState = runtime.toneForState;

  function getSetting(env, key) {
    return env && typeof env.getSetting === "function" ? env.getSetting(key) : "";
  }

  function setupUpdate(env, kind) {
    if (env && typeof env.handleSetupUpdate === "function") {
      return env.handleSetupUpdate(kind);
    }
    return Promise.resolve();
  }

  function readSetupItems(setup) {
    var items = setup && setup.items ? setup.items : {};
    return [
      items.bridge || { label: "Local bridge", state: "Needs Setup", nextStep: "Waiting for bridge." },
      items.display || { label: "Auxora companion display", state: "Needs Setup", nextStep: "Connect a secondary display. Auxora never opens on the Windows primary display." },
      items.provisioning || { label: "Auto provisioning", state: "Checking", nextStep: "Waiting for startup scan." },
      items.system || { label: "System Monitor", state: "Needs Setup", nextStep: "Waiting for telemetry." },
      items.network || { label: "Network Monitor", state: "Needs Setup", nextStep: "Waiting for telemetry." },
      items.audio || { label: "Audio & Media", state: "Needs Setup", nextStep: "Waiting for sound and playback controls." }
    ];
  }

  function getAdvancedSchemaState(schema, env) {
    if (!schema.fields.length) {
      return schema.state || "Later";
    }

    if (schema.id === "unifi-camera") {
      return getSetting(env, "unifiCameraEndpoint") || getSetting(env, "unifiCameraFeed") || getSetting(env, "unifiCameraRelayUrl") || getSetting(env, "unifiCameraSnapshot")
        ? "Ready"
        : "Optional";
    }

    if (schema.id === "automation") {
      return getSetting(env, "automationEndpoint") || getSetting(env, "automationActionEndpoint")
        ? "Ready"
        : "Optional";
    }

    return getSetting(env, schema.fields[0].key) ? "Ready" : "Optional";
  }

  function renderAdvancedSetupForms(env) {
    return advancedSetupSchemas.map(function (schema) {
      var state = getAdvancedSchemaState(schema, env);
      return '' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header">' +
            '<div>' +
              '<div class="metric-label">' + escapeHtml(schema.title) + '</div>' +
              '<div class="router-inline-copy">' + escapeHtml(schema.copy) + '</div>' +
            '</div>' +
            statusPill(state, toneForState(state)) +
          '</div>' +
          (!schema.fields.length
            ? '<div class="router-inline-copy">' + escapeHtml(schema.copy) + '</div>'
            :
          '<form class="inline-form" data-form="advanced:' + escapeHtml(schema.id) + '">' +
            '<div class="inline-form-grid">' +
              schema.fields.map(function (field) {
                return '' +
                  '<label class="inline-field">' +
                    '<span>' + escapeHtml(field.label) + '</span>' +
                    '<input class="inline-input" type="text" name="' + escapeHtml(field.key) + '" value="' + escapeHtml(getSetting(env, field.key)) + '" placeholder="' + escapeHtml(field.placeholder || "") + '">' +
                  '</label>';
              }).join("") +
            '</div>' +
            '<div class="inline-actions">' +
              '<button class="inline-button is-primary" type="submit">Save</button>' +
            '</div>' +
          '</form>') +
        '</article>';
    }).join("");
  }

  function renderDisplayDiagnosticsCard(display) {
    var displays = display && Array.isArray(display.displays) ? display.displays : [];
    var visibleDisplays = displays.filter(function (entry) {
      return Boolean(entry && !entry.primary);
    });
    var selectedDisplayId = text(display && display.selectedDisplayId, "");
    var selected = visibleDisplays.filter(function (entry) {
      return Boolean(entry && (entry.preferred || (selectedDisplayId && entry.id === selectedDisplayId)));
    })[0] || null;
    var repairActions = display && Array.isArray(display.repairActions) ? display.repairActions : [];
    var reportedCompanionCount = optionalNumber(display && display.companionDisplayCount);
    var companionDisplayCount = reportedCompanionCount == null ? visibleDisplays.length : reportedCompanionCount;
    var displayReady = text(display && display.status, "").toLowerCase() === "ready"
      && companionDisplayCount > 0
      && Boolean(selected);

    function describeDisplay(entry) {
      var width = optionalNumber(entry && (entry.boundsWidth || entry.modeWidth));
      var height = optionalNumber(entry && (entry.boundsHeight || entry.modeHeight));
      var origin = entry && (entry.boundsX != null || entry.boundsY != null)
        ? " at " + String(entry.boundsX || 0) + "," + String(entry.boundsY || 0)
        : "";
      return width && height ? Math.round(width) + "x" + Math.round(height) + origin : text(entry && entry.deviceName, "Windows display");
    }

    return '' +
      '<article class="list-card inline-card setup-diagnostics-card">' +
        '<div class="inline-card-header">' +
          '<div>' +
            '<div class="metric-label">Companion display targeting</div>' +
            '<div class="router-inline-copy">' + escapeHtml(text(display && display.message, selected ? "Companion display selected." : "Connect a secondary display. Auxora never uses the Windows primary display.")) + '</div>' +
          '</div>' +
          statusPill(displayReady ? "Ready" : companionDisplayCount ? "Choose one" : "Waiting", displayReady ? "good" : "warn") +
        '</div>' +
        '<div class="setup-display-target">' +
          '<strong>' + escapeHtml(selected ? text(selected.label || selected.friendlyName, "Selected companion display") : "No active companion display selected") + '</strong>' +
          '<span>' + escapeHtml(selected ? describeDisplay(selected) : companionDisplayCount ? "Choose one of the companion displays below." : "Connect or extend a secondary display, then refresh diagnostics.") + '</span>' +
        '</div>' +
        '<details class="setup-diagnostics-details">' +
          '<summary>Manage companion displays</summary>' +
          '<div class="setup-diagnostics-details__body">' +
          '<div class="setup-display-list">' + (visibleDisplays.length ? visibleDisplays.map(function (entry) {
          var reasons = Array.isArray(entry.reasons) ? entry.reasons.slice(0, 2).join(" / ") : "";
          return '' +
            '<div class="inline-list-item setup-display-row">' +
              '<div>' +
                '<div class="inline-list-title">' + escapeHtml(text(entry.label || entry.friendlyName, "Display")) + '</div>' +
                '<div class="inline-list-copy">' + escapeHtml(describeDisplay(entry) + (reasons ? " / " + reasons : "")) + '</div>' +
              '</div>' +
              '<div class="setup-display-row__actions">' +
                statusPill(entry.preferred ? "In use" : "Available", entry.preferred ? "good" : "muted") +
                '<button class="inline-button' + (entry.preferred ? '' : ' is-primary') + '" type="button" data-action="select-display" data-companion-display="true" data-display-id="' + escapeHtml(text(entry.id, "")) + '"' + (entry.preferred ? ' disabled' : '') + '>' + (entry.preferred ? 'Selected' : 'Use this companion display') + '</button>' +
              '</div>' +
            '</div>';
        }).join("") : emptyState("Waiting for a companion display", "Auxora stays off the Windows primary display. Connect or extend a secondary display, then refresh.")) + '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="run-repair">Repair scan</button>' +
          (repairActions.length ? '<span class="router-inline-copy">' + escapeHtml(text(repairActions[0], "Repair actions are available.")) + '</span>' : '') +
        '</div>' +
          '</div>' +
        '</details>' +
      '</article>';
  }

  function renderLauncherReviewCard(provisioning) {
    var suggestions = provisioning && Array.isArray(provisioning.suggestedLaunchers) ? provisioning.suggestedLaunchers : [];
    var visible = suggestions.slice(0, 6);

    if (!suggestions.length) {
      return '';
    }

    return '' +
      '<article class="list-card inline-card setup-diagnostics-card">' +
        '<div class="inline-card-header">' +
          '<div>' +
            '<div class="metric-label">Launcher review</div>' +
            '<div class="router-inline-copy">Review auto-discovered apps before they become launcher tiles.</div>' +
          '</div>' +
          statusPill(suggestions.length + " found", "warn") +
        '</div>' +
        '<details class="setup-diagnostics-details">' +
          '<summary>Review detected apps</summary>' +
          '<div class="setup-diagnostics-details__body">' +
          '<div class="setup-launcher-suggestions">' + visible.map(function (entry) {
          return '' +
            '<label class="setup-launcher-suggestion">' +
              '<input type="checkbox" data-launcher-suggestion="' + escapeHtml(text(entry.id, "")) + '" checked>' +
              '<span><strong>' + escapeHtml(text(entry.displayName, "App")) + '</strong><small>' + escapeHtml(text(entry.source, "Detected app")) + '</small></span>' +
            '</label>';
        }).join("") + '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button is-primary" type="button" data-action="apply-launcher-suggestions">Pin selected</button>' +
          '<button class="inline-button" type="button" data-action="run-repair">Rescan</button>' +
        '</div>' +
          '</div>' +
        '</details>' +
      '</article>';
  }

  function renderSetupWidget(state, env) {
    var health = state.health || {};
    var setup = health.setup || env.bridgeSetup || {};
    var config = state.config || env.bridgeConfig || {};
    var hue = state.hue || { bridgeIp: "", message: "" };
    var display = setup.display || config.display || {};
    var provisioning = state.provisioning || setup.provisioning || config.provisioning || {};
    var items = readSetupItems(setup);
    var optionalItems = setup.items || {};
    var weatherItem = optionalItems.weather || { label: "Weather", state: "Optional", nextStep: "Add an OpenWeather key if you want weather." };
    var calendarItem = optionalItems.calendar || { label: "Calendar", state: "Optional", nextStep: "Add an ICS feed if you want the Calendar widget." };
    var hueItem = optionalItems.hue || { label: "Philips Hue", state: "Optional", nextStep: "Link Hue only if you want lighting controls." };
    var uniFiItem = optionalItems.unifi || { label: "UniFi Network", state: "Optional", nextStep: "Auxora checks for UniFi automatically." };
    var frigateItem = optionalItems.frigate || { label: "Camera Detection", state: "Optional", nextStep: "Add a local Frigate address only if you want object detections." };
    var essentialsReady = Boolean(setup.essentialsReady);
    var onboardingCompleted = Boolean(setup.onboardingCompleted);
    var weatherConfig = config.weather || {};
    var calendarConfig = config.calendar || {};
    var calendarConfigured = Boolean(calendarConfig.configured || calendarConfig.icsUrlConfigured);
    var calendarHost = text(calendarConfig.icsHost, "");
    var frigateConfig = config.frigate || {};
    var optionalNeedsAttention = [weatherItem, calendarItem, hueItem, frigateItem].some(function (item) {
      return item && item.state !== "Optional";
    });
    var optionalSetupVisible = Boolean(state.showOptional || optionalNeedsAttention);
    var supportUrl = buildBridgeUrl(env, "/support.html");
    var supportBundleUrl = buildBridgeUrl(env, "/api/support/bundle");
    var diagnosticsHtml = '' +
      '<div class="inline-grid inline-grid--2 setup-diagnostics-grid">' +
        renderDisplayDiagnosticsCard(display) +
        renderLauncherReviewCard(provisioning) +
      '</div>';
    var advancedSetupHtml = env.showAdvanced
      ? '' +
        '<div class="inline-card-header setup-optional-head">' +
          '<div>' +
            '<div class="metric-label">Advanced setup</div>' +
            '<div class="router-inline-copy">Hidden from normal setup. Use this only for compatibility testing or old widget paths.</div>' +
          '</div>' +
        '</div>' +
        renderAdvancedSetupForms(env)
      : "";
    var optionalSetupHtml = optionalSetupVisible
      ? '' +
        '<div class="inline-card-header setup-optional-head">' +
          '<div>' +
            '<div class="metric-label">Optional extras</div>' +
            '<div class="router-inline-copy">Only adjust these when you actually want Weather, Calendar, Hue, UniFi, or Camera Detection.</div>' +
          '</div>' +
          '<button class="inline-button" type="button" data-action="toggle-optional-setup">Hide extras</button>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3 setup-optional-grid">' +
          '<article class="list-card inline-card" data-setup-section="weather">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Weather</div>' +
                '<div class="router-inline-copy">' + escapeHtml(weatherItem.nextStep) + '</div>' +
              '</div>' +
              statusPill(weatherItem.state, toneForState(weatherItem.state)) +
            '</div>' +
            '<form class="inline-form" data-form="weather">' +
              '<div class="inline-form-grid inline-form-grid--2">' +
                '<label class="inline-field"><span>API key</span><input class="inline-input" type="password" name="apiKey" value="" placeholder="Leave blank to keep the current key"></label>' +
                '<label class="inline-field"><span>Units</span><select class="inline-select" name="units"><option value="metric"' + ((weatherConfig.units || "metric") === "metric" ? " selected" : "") + '>Metric (C)</option><option value="imperial"' + ((weatherConfig.units || "metric") === "imperial" ? " selected" : "") + '>Imperial (F)</option></select></label>' +
              '</div>' +
              '<div class="inline-form-grid">' +
                '<label class="inline-field"><span>City</span><input class="inline-input" type="text" name="city" value="' + escapeHtml(text(weatherConfig.city, "")) + '" placeholder="City or ZIP"></label>' +
              '</div>' +
              '<div class="inline-actions"><button class="inline-button is-primary" type="submit">Save weather</button></div>' +
            '</form>' +
          '</article>' +
          '<article class="list-card inline-card" data-setup-section="calendar">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Calendar</div>' +
                '<div class="router-inline-copy">' + escapeHtml(calendarItem.nextStep) + '</div>' +
              '</div>' +
              statusPill(calendarItem.state, toneForState(calendarItem.state)) +
            '</div>' +
            '<form class="inline-form" data-form="calendar">' +
              '<div class="inline-form-grid">' +
                '<label class="inline-field"><span>ICS feed URL</span><input class="inline-input" type="url" name="icsUrl" value="" placeholder="' + escapeHtml(calendarConfigured ? "Paste a new feed to replace " + (calendarHost || "the current feed") : "https://calendar.example.com/feed.ics") + '"></label>' +
              '</div>' +
              '<div class="router-inline-copy">' + escapeHtml(calendarConfigured ? "A calendar feed is configured" + (calendarHost ? " from " + calendarHost : "") + ". Paste a new feed to replace it, or leave it blank and save to remove it." : "Paste any reachable ICS feed. Leave it blank and save to keep Calendar disabled.") + '</div>' +
              '<div class="inline-actions"><button class="inline-button is-primary" type="submit">Save calendar</button></div>' +
            '</form>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">UniFi Network</div>' +
                '<div class="router-inline-copy">' + escapeHtml(uniFiItem.nextStep) + '</div>' +
              '</div>' +
              statusPill(uniFiItem.state, toneForState(uniFiItem.state)) +
            '</div>' +
              '<div class="router-inline-copy">Auxora checks the local UniFi console automatically.</div>' +
          '</article>' +
          '<article class="list-card inline-card" data-setup-section="frigate">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Camera Detection</div>' +
                '<div class="router-inline-copy">' + escapeHtml(frigateItem.nextStep) + '</div>' +
              '</div>' +
              statusPill(frigateItem.state, toneForState(frigateItem.state)) +
            '</div>' +
            '<form class="inline-form" data-form="frigate">' +
              '<div class="inline-form-grid inline-form-grid--2">' +
                '<label class="inline-field"><span>Local Frigate address</span><input class="inline-input" type="url" name="baseUrl" value="' + escapeHtml(text(frigateConfig.baseUrl, "")) + '" placeholder="http://192.168.1.50:5000/"></label>' +
                '<label class="inline-field"><span>Camera filter</span><input class="inline-input" type="text" name="camera" value="' + escapeHtml(text(frigateConfig.camera, "")) + '" placeholder="Optional, for example driveway"></label>' +
                '<label class="inline-field"><span>Username</span><input class="inline-input" type="text" name="username" autocomplete="username" value="' + escapeHtml(text(frigateConfig.username, "")) + '" placeholder="Optional for port 8971"></label>' +
                '<label class="inline-field"><span>Password</span><input class="inline-input" type="password" name="password" autocomplete="current-password" value="" placeholder="' + (frigateConfig.authenticationConfigured ? "Saved — leave blank to keep" : "Optional Frigate password") + '"></label>' +
              '</div>' +
              '<div class="router-inline-copy">Use an HTTPS address with the username and password for Frigate\'s authenticated port 8971, or leave both blank for a trusted internal port. Credentials are protected by Windows. HTTPS certificates must be trusted by Windows. Leave the address blank and save to remove Camera Detection.</div>' +
              '<div class="inline-actions setup-camera-actions"><button class="inline-button is-primary" type="submit">Save and test Camera Detection</button>' +
                (state.frigateFeedbackText
                  ? '<div class="setup-form-feedback" role="status" aria-live="polite" data-tone="' + escapeHtml(state.frigateFeedbackTone) + '" data-frigate-feedback>' + escapeHtml(state.frigateFeedbackText) + '</div>'
                  : '') +
              '</div>' +
            '</form>' +
          '</article>' +
          '<article class="list-card inline-card" data-setup-section="hue">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Philips Hue</div>' +
                '<div class="router-inline-copy">' + escapeHtml(text(hue.message, hueItem.nextStep)) + '</div>' +
              '</div>' +
              statusPill(hueItem.state, toneForState(hueItem.state)) +
            '</div>' +
            '<form class="inline-form" data-form="hue">' +
              '<div class="inline-form-grid">' +
                '<label class="inline-field"><span>Bridge IP</span><input class="inline-input" type="text" name="bridgeIp" value="' + escapeHtml(text(hue.bridgeIp, "")) + '" placeholder="Local bridge IP"></label>' +
              '</div>' +
              '<div class="inline-actions"><button class="inline-button is-primary" type="submit">Link bridge</button></div>' +
            '</form>' +
          '</article>' +
        '</div>'
      : '' +
        '<article class="list-card inline-card inline-card--span-2 setup-optional-card">' +
          '<div class="inline-card-header">' +
            '<div>' +
              '<div class="metric-label">Optional extras</div>' +
              '<div class="router-inline-copy">Open these settings only when you want to connect Weather, Calendar, Hue, UniFi, or Camera Detection.</div>' +
            '</div>' +
            '<button class="inline-button" type="button" data-action="toggle-optional-setup">Show extras</button>' +
          '</div>' +
        '</article>';
    var finishSetupAction = essentialsReady && !onboardingCompleted
      ? '<button class="inline-button is-primary" type="button" data-action="finish-setup">Finish setup</button>'
      : '';

    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Readiness overview</div>' +
            '<h3 class="inline-title">System readiness</h3>' +
            '<p class="inline-copy">Auxora scans this PC and prepares the dashboard automatically. Optional extras only need permission when you want them.</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            finishSetupAction +
            '<button class="inline-button" type="button" data-action="reset-local-data"' + (state.busy ? " disabled" : "") + '>' + (state.confirmReset ? "Confirm reset" : "Reset local data") + '</button>' +
            '<a class="inline-button" href="' + escapeHtml(supportBundleUrl) + '" target="_blank" rel="noreferrer">Support bundle</a>' +
            '<a class="inline-button" href="' + escapeHtml(supportUrl) + '" target="_blank" rel="noreferrer">Support</a>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--4 setup-health-grid">' +
          items.map(function (item) {
            return '' +
              '<article class="metric-card inline-card setup-health-card">' +
                '<div class="inline-card-header"><div class="metric-label">' + escapeHtml(item.label) + '</div>' + statusPill(item.state, toneForState(item.state)) + '</div>' +
                (item.state === "Ready" ? "" : '<div class="router-inline-copy">' + escapeHtml(item.nextStep) + '</div>') +
              '</article>';
          }).join("") +
        '</div>' +
        diagnosticsHtml +
        optionalSetupHtml +
        advancedSetupHtml +
      '</div>';
  }

  function mountSetupWidget(widget, container, env) {
    var cleanups = [];
    var requestedSection = String(env.requestedSetupSection || "").trim();
    var refreshPromise = null;
    var resetConfirmationTimerId = 0;
    var state = {
      health: { setup: env.bridgeSetup || {} },
      config: env.bridgeConfig || {},
      hue: (env.bridgeConfig && env.bridgeConfig.hue) || {},
      statusText: "Loading",
      statusTone: "warn",
      busy: false,
      confirmReset: false,
      showOptional: ["weather", "calendar", "hue", "frigate"].indexOf(requestedSection) !== -1,
      focusSection: requestedSection,
      initialRefreshComplete: false,
      frigateFeedbackText: "",
      frigateFeedbackTone: "muted"
    };

    function cancelResetConfirmation() {
      if (resetConfirmationTimerId) {
        window.clearTimeout(resetConfirmationTimerId);
        resetConfirmationTimerId = 0;
      }
      state.confirmReset = false;
    }

    function armResetConfirmation() {
      cancelResetConfirmation();
      state.confirmReset = true;
      state.statusText = "Tap again within 8 seconds";
      state.statusTone = "warn";
      resetConfirmationTimerId = window.setTimeout(function () {
        resetConfirmationTimerId = 0;
        if (!state.confirmReset || state.busy) {
          return;
        }
        state.confirmReset = false;
        state.statusText = "Reset cancelled";
        state.statusTone = "muted";
        redraw();
      }, RESET_CONFIRMATION_WINDOW_MS);
    }

    cleanups.push(function () {
      if (resetConfirmationTimerId) {
        window.clearTimeout(resetConfirmationTimerId);
        resetConfirmationTimerId = 0;
      }
    });

    function redraw() {
      patchStableDom(container, renderSetupWidget(state, env));
      if (state.initialRefreshComplete && state.focusSection) {
        var section = container.querySelector('[data-setup-section="' + state.focusSection + '"]');
        var input = section && section.querySelector("input, select, button");
        if (section && input) {
          state.focusSection = "";
          if (typeof section.scrollIntoView === "function") {
            section.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
          }
          input.focus({ preventScroll: true });
        }
      }
    }

    function refresh() {
      if (refreshPromise) {
        return refreshPromise;
      }
      refreshPromise = Promise.all([
        requestJson(buildBridgeUrl(env, "/api/health"), {}, 5000),
        requestJson(buildBridgeUrl(env, "/api/config"), {}, 5000),
        requestJson(buildBridgeUrl(env, "/api/hue"), {}, 5000),
        requestJson(buildBridgeUrl(env, "/api/provisioning"), {}, 5000)
      ]).then(function (results) {
        state.health = results[0] || {};
        state.config = results[1] || {};
        state.hue = results[2] || {};
        state.provisioning = results[3] || {};
        if (!state.confirmReset) {
          state.statusText = state.health.setup && (!state.health.setup.onboardingCompleted || state.health.setup.needsAttention) ? "Needs Setup" : "Ready";
          state.statusTone = state.statusText === "Ready" ? "good" : "warn";
        }
        state.initialRefreshComplete = true;
        redraw();
      }, function (error) {
        if (!state.confirmReset) {
          state.statusText = error.message || "Unavailable";
          state.statusTone = "danger";
        }
        state.initialRefreshComplete = true;
        redraw();
      }).finally(function () {
        refreshPromise = null;
      });
      return refreshPromise;
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : event.target;
      var action = target && target.getAttribute("data-action");
      if (!action || state.busy) {
        return;
      }

      if (action !== "reset-local-data" && state.confirmReset) {
        cancelResetConfirmation();
        state.statusText = "Reset cancelled";
        state.statusTone = "muted";
        redraw();
      }

      if (action === "refresh") {
        refresh();
        return;
      }

      if (action === "toggle-optional-setup") {
        state.showOptional = !state.showOptional;
        redraw();
        return;
      }

      if (action === "run-repair") {
        state.busy = true;
        state.statusText = "Repairing";
        state.statusTone = "warn";
        redraw();
        requestJson(buildBridgeUrl(env, "/api/repair/run"), {
          method: "POST",
          body: {}
        }, 12000).then(function () {
          state.busy = false;
          emitTouchFeedback(env, "Repair scan complete");
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Repair failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (action === "select-display") {
        var displayId = String(target.getAttribute("data-display-id") || "").trim();
        if (!displayId || target.getAttribute("data-companion-display") !== "true") {
          state.statusText = "Companion display unavailable";
          state.statusTone = "danger";
          redraw();
          return;
        }

        state.busy = true;
        state.statusText = "Moving Auxora";
        state.statusTone = "warn";
        redraw();
        requestJson(buildBridgeUrl(env, "/api/display/preference"), {
          method: "POST",
          body: { displayId: displayId }
        }, 8000).then(function () {
          return setupUpdate(env, "display");
        }).then(function () {
          state.busy = false;
          emitTouchFeedback(env, "Auxora display updated");
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Display move failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (action === "apply-launcher-suggestions") {
        var ids = Array.prototype.slice.call(container.querySelectorAll("[data-launcher-suggestion]:checked")).map(function (input) {
          return String(input.getAttribute("data-launcher-suggestion") || "");
        }).filter(Boolean);

        if (!ids.length) {
          state.statusText = "Select apps";
          state.statusTone = "warn";
          redraw();
          return;
        }

        state.busy = true;
        state.statusText = "Pinning";
        state.statusTone = "warn";
        redraw();
        requestJson(buildBridgeUrl(env, "/api/provisioning/launchers/apply"), {
          method: "POST",
          body: {
            ids: ids
          }
        }, 10000).then(function () {
          return setupUpdate(env, "launchers");
        }).then(function () {
          state.busy = false;
          emitTouchFeedback(env, "Launchers pinned");
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Pinning failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (action === "finish-setup") {
        state.busy = true;
        state.statusText = "Saving";
        state.statusTone = "warn";
        redraw();
        requestJson(buildBridgeUrl(env, "/api/config/dashboard"), {
          method: "POST",
          body: {
            onboardingCompleted: true,
            onboardingVersion: env.onboardingVersion || 1
          }
        }, 8000).then(function () {
          return setupUpdate(env, "dashboard");
        }).then(function () {
          state.busy = false;
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Save failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (action === "reset-local-data") {
        if (!state.confirmReset) {
          armResetConfirmation();
          redraw();
          return;
        }

        if (typeof env.resetAllLocalData !== "function") {
          state.statusText = "Reset unavailable";
          state.statusTone = "danger";
          cancelResetConfirmation();
          redraw();
          return;
        }

        cancelResetConfirmation();
        state.busy = true;
        state.statusText = "Resetting";
        state.statusTone = "warn";
        redraw();
        env.resetAllLocalData().then(function () {
          state.busy = false;
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Reset failed";
          state.statusTone = "danger";
          redraw();
        });
      }
    });

    addListener(cleanups, container, "submit", function (event) {
      var form = event.target;
      var formId = form && form.getAttribute("data-form");
      var formData;
      var payload;
      var values = {};

      if (!formId) {
        return;
      }

      event.preventDefault();
      if (state.busy) {
        return;
      }

      formData = new FormData(form);
      state.busy = true;
      state.statusText = "Saving";
      state.statusTone = "warn";
      if (formId === "frigate") {
        state.frigateFeedbackText = "Saving and testing Camera Detection settings.";
        state.frigateFeedbackTone = "warn";
      }
      redraw();

      if (formId === "weather") {
        payload = {
          apiKey: String(formData.get("apiKey") || ""),
          city: String(formData.get("city") || ""),
          units: String(formData.get("units") || "metric")
        };
        requestJson(buildBridgeUrl(env, "/api/config/weather"), {
          method: "POST",
          body: payload
        }, 8000).then(function () {
          return setupUpdate(env, "weather");
        }).then(function () {
          state.busy = false;
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Save failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (formId === "calendar") {
        payload = {
          icsUrl: String(formData.get("icsUrl") || "")
        };
        requestJson(buildBridgeUrl(env, "/api/config/calendar"), {
          method: "POST",
          body: payload
        }, 8000).then(function () {
          return setupUpdate(env, "calendar");
        }).then(function () {
          state.busy = false;
          return refresh();
        }, function (error) {
          state.busy = false;
          state.statusText = error.message || "Save failed";
          state.statusTone = "danger";
          redraw();
        });
        return;
      }

      if (formId === "frigate") {
        var frigateSaved = false;
        var frigateConnection = null;
        var frigateTestCompleted = false;
        payload = {
          baseUrl: String(formData.get("baseUrl") || ""),
          camera: String(formData.get("camera") || ""),
          username: String(formData.get("username") || ""),
          password: String(formData.get("password") || "")
        };
        requestJson(buildBridgeUrl(env, "/api/config/frigate"), {
          method: "POST",
          body: payload
        }, 8000).then(function () {
          frigateSaved = true;
          if (!payload.baseUrl.trim()) {
            return { configured: false, connected: false, state: "Optional", message: "Camera Detection was removed." };
          }
          return requestJson(buildBridgeUrl(env, "/api/frigate/test"), {
            method: "POST",
            body: {}
          }, 12000);
        }).then(function (connection) {
          frigateConnection = connection || {};
          frigateTestCompleted = true;
          return setupUpdate(env, "frigate");
        }).then(function () {
          return refresh();
        }).then(function () {
          state.busy = false;
          state.statusText = frigateConnection.connected
            ? "Camera connected"
            : (frigateConnection.state || "Camera needs attention");
          state.statusTone = frigateConnection.connected || !frigateConnection.configured ? "good" : "danger";
          state.frigateFeedbackText = !frigateConnection.configured
            ? "Camera Detection was removed."
            : (frigateConnection.connected
              ? "Camera connected. Settings were saved and tested."
              : (frigateConnection.message || "Settings were saved, but Frigate needs attention."));
          state.frigateFeedbackTone = frigateConnection.connected || !frigateConnection.configured ? "good" : "danger";
          redraw();
        }, function (error) {
          state.busy = false;
          state.statusText = !frigateSaved
            ? (error.message || "Camera setup failed")
            : (frigateTestCompleted ? "Camera status refresh failed" : "Camera saved; test failed");
          state.statusTone = "danger";
          state.frigateFeedbackText = !frigateSaved
            ? (error.message || "Camera Detection setup failed.")
            : (frigateTestCompleted
              ? "Settings were saved and the connection test completed, but Diagnostics could not refresh. " + (error.message || "Try Refresh.")
              : "Settings were saved, but the connection test failed. " + (error.message || "Check the Frigate address and authentication."));
          state.frigateFeedbackTone = "danger";
          redraw();
        });
        return;
      }

      if (formId === "hue") {
        payload = {
          bridgeIp: String(formData.get("bridgeIp") || "")
        };
        requestJson(buildBridgeUrl(env, "/api/hue/link"), {
          method: "POST",
          body: payload
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
        return;
      }

      if (formId.indexOf("advanced:") === 0) {
        formData.forEach(function (value, key) {
          values[key] = String(value || "");
        });
        saveSettings(env, values);
        state.busy = false;
        state.statusText = "Saved";
        state.statusTone = "good";
        redraw();
      }
    });

    redraw();
    refresh();

    return {
      refresh: refresh,
      destroy: function () {
        runCleanups(cleanups);
        patchStableDom(container, "");
      }
    };
  }

  function normalizeCalendarPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: Boolean(payload.configured),
      status: text(payload.status, payload.configured ? "idle" : "setup"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, payload.configured ? "No upcoming events in the configured feed." : "Calendar ICS URL missing"),
      source: text(payload.source, payload.configured ? "ics" : "Needs setup"),
      entries: Array.isArray(payload.entries) ? payload.entries : []
    };
  }

  function renderCalendarWidget(state, env) {
    var data = state.data;
    var entries = data.entries.slice(0, 6);
    var calendarConfig = env.bridgeConfig && env.bridgeConfig.calendar ? env.bridgeConfig.calendar : {};
    var configured = Boolean(calendarConfig.configured || calendarConfig.icsUrlConfigured);
    var configuredHost = text(calendarConfig.icsHost, "");
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Calendar</div>' +
            '<h3 class="inline-title">Upcoming events</h3>' +
            '<p class="inline-copy">' + escapeHtml(text(data.message, configured ? "ICS feed is configured." : "Add an ICS feed in Diagnostics to enable calendar.")) + '</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            (!configured ? '<button class="inline-button is-primary" type="button" data-action="setup">Open Calendar setup</button>' : '') +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Feed", data.configured ? "Connected" : "Setup", text(data.source, data.configured ? "ICS feed" : "Needs setup")) +
          metricCard("Events", String(entries.length), entries.length ? "Upcoming items" : (data.configured ? "Nothing soon" : "Waiting for feed")) +
          metricCard("Updated", formatAge(data.sampledAt), data.stale ? "Sample is stale" : "Fresh snapshot") +
        '</div>' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header">' +
            '<div>' +
              '<div class="metric-label">Next up</div>' +
              '<div class="router-inline-copy">' + escapeHtml(configured ? ("Configured feed" + (configuredHost ? " from " + configuredHost : "")) : "Configure a reachable ICS feed in Diagnostics.") + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="inline-list">' + (entries.length ? entries.map(function (entry) {
            return '' +
              '<div class="inline-list-item inline-list-item--split">' +
                '<div>' +
                  '<div class="inline-list-title">' + escapeHtml(text(entry.title, "Calendar event")) + '</div>' +
                  '<div class="inline-list-copy">' + escapeHtml(text(entry.detail, "Calendar event")) + '</div>' +
                '</div>' +
                '<div class="inline-list-meta">' + escapeHtml(text(entry.time, "--")) + '</div>' +
              '</div>';
          }).join("") : emptyState(data.configured ? "No upcoming events" : "Calendar setup needed", data.message)) + '</div>' +
        '</article>' +
      '</div>';
  }

  function mountCalendarWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeCalendarPayload({}),
      statusText: "Loading",
      statusTone: "warn"
    };

    function redraw() {
      patchStableDom(container, renderCalendarWidget(state, env));
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/calendar"), {}, 6000).then(function (payload) {
        state.data = normalizeCalendarPayload(payload);
        state.statusText = statusTextFromPayload(payload, state.data.entries.length ? "Live" : "Idle");
        state.statusTone = statusToneFromPayload(payload, state.data.entries.length ? "live" : state.data.status);
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var action = event.target && event.target.getAttribute("data-action");
      if (action === "setup") {
        if (env && typeof env.openSetupSection === "function") {
          env.openSetupSection("calendar");
        } else if (env && typeof env.selectWidget === "function") {
          env.selectWidget("setup", true);
        }
        return;
      }
      if (action === "refresh") {
        refresh();
      }
    });

    var loop = createTimerLoop(refresh, 60000);
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

  runtime.registerRenderer("setup", mountSetupWidget);
  runtime.registerRenderer("calendar", mountCalendarWidget);
}());
