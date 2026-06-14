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
  var metricCard = runtime.metricCard;
  var optionalNumber = runtime.optionalNumber;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var statusTextFromPayload = runtime.statusTextFromPayload;
  var statusToneFromPayload = runtime.statusToneFromPayload;
  var text = runtime.text;

  function requiresServerConfirmation(actionId) {
    return actionId === "empty-recycle-bin" || actionId === "sleep" || actionId === "restart" || actionId === "shutdown";
  }

  function requestActionConfirmation(env, actionId) {
    return requestJson(buildBridgeUrl(env, "/api/action-confirmations"), {
      method: "POST",
      body: {
        actionId: actionId
      }
    }, 6000);
  }

  function saveDashboardSettings(env, settings) {
    return requestJson(buildBridgeUrl(env, "/api/config/dashboard"), {
      method: "POST",
      body: settings
    }, 6000).then(function (payload) {
      if (payload && typeof payload === "object") {
        env.bridgeConfig = payload;
      }
      return payload;
    });
  }

  function renderActionButton(item, action, confirmId, disabled) {
    var itemId = text(item && item.id, "");
    var isConfirm = confirmId && confirmId === itemId;
    var buttonLabel = isConfirm ? "Tap again" : text(item && item.label, "Action");
    var buttonCopy = isConfirm
      ? "Confirm " + text(item && item.label, "action").toLowerCase()
      : text(item && item.detail, text(item && item.state, "Ready"));
    return '' +
      '<button class="inline-action-button" type="button" data-action="' + escapeHtml(action) + '" data-id="' + escapeHtml(itemId) + '" data-style="' + escapeHtml(text(item && item.style, "command")) + '"' + (isConfirm ? ' data-state="confirm"' : "") + (((disabled || !item || item.enabled === false) ? " disabled" : "")) + '>' +
        '<strong>' + escapeHtml(buttonLabel) + '</strong>' +
        '<span class="inline-action-button__detail">' + escapeHtml(buttonCopy) + '</span>' +
        '<span class="inline-action-button__state">' + escapeHtml(text(item && item.state, "Ready")) + '</span>' +
      '</button>';
  }

  function normalizeLaunchersPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: Boolean(payload.configured),
      status: text(payload.status, payload.configured ? "live" : "setup"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, payload.configured ? "Recent apps are ready." : "Open apps to build your launcher grid."),
      source: text(payload.source, "Windows app activity"),
      entries: Array.isArray(payload.entries) ? payload.entries.map(function (entry) {
        return {
          id: text(entry.id, ""),
          displayName: text(entry.displayName, "Launcher"),
          iconPath: text(entry.iconPath, ""),
          executablePath: text(entry.executablePath, ""),
          arguments: text(entry.arguments, ""),
          iconUrl: text(entry.iconUrl, ""),
          tileLabel: text(entry.tileLabel, "?"),
          source: text(entry.source, ""),
          lastOpenedAt: text(entry.lastOpenedAt, ""),
          recent: Boolean(entry.recent)
        };
      }) : []
    };
  }

  function launcherTargetLabel(entry) {
    var target = text(entry && entry.executablePath, "");
    var args = text(entry && entry.arguments, "");
    var normalized;
    var parts;
    var scheme;

    if (!target) {
      return "Target missing";
    }

    if (/^steam:\/\/rungameid\/\d+/i.test(target)) {
      return "Steam game";
    }

    if (/^shell:AppsFolder\\/i.test(target)) {
      return "Windows app";
    }

    scheme = target.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (scheme) {
      return scheme[1].toUpperCase() + " link";
    }

    normalized = target.replace(/\\/g, "/");
    parts = normalized.split("/").filter(Boolean);
    return (parts.length ? parts[parts.length - 1] : target) + (args ? " + arguments" : "");
  }

  function renderLaunchersWidget(state) {
    var data = state.data;
    var entries = data.entries.slice(0, 24);
    var statusText = state.statusText || (data.stale ? "Stale" : "Ready");
    return '' +
      '<div class="inline-widget-shell launcher-shell launcher-shell--recent">' +
        '<article class="list-card inline-card launcher-library-card launcher-library-card--full">' +
          '<div class="inline-card-header launcher-card-header">' +
            '<div>' +
              '<div class="metric-label">Recent Apps</div>' +
              '<div class="router-inline-copy">' + escapeHtml(entries.length ? "Last 24 apps opened on this PC." : "Open apps on this PC and they will appear here automatically.") + '</div>' +
            '</div>' +
            '<div class="launcher-card-meta">' +
              '<span class="launcher-pill">' + escapeHtml(String(entries.length)) + '/24 recent</span>' +
              '<span class="launcher-pill">' + escapeHtml(statusText) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="inline-launcher-grid launcher-grid--compact launcher-grid--recent">' + (entries.length ? entries.map(function (entry) {
            var fullTarget = entry.arguments ? (entry.executablePath + " " + entry.arguments) : entry.executablePath;
            var detail = entry.source ? (entry.source + " · " + launcherTargetLabel(entry)) : launcherTargetLabel(entry);
            return '' +
              '<article class="inline-launcher-tile">' +
                '<button class="inline-launcher-hit" type="button" data-action="launch" data-id="' + escapeHtml(entry.id) + '" title="' + escapeHtml(fullTarget) + '"' + ((state.saving || state.launchingId === entry.id) ? " disabled" : "") + '>' +
                  '<span class="inline-launcher-icon">' + (entry.iconUrl
                    ? '<img src="' + escapeHtml(entry.iconUrl) + '" alt="' + escapeHtml(entry.displayName) + '">'
                    : '<span>' + escapeHtml(entry.tileLabel) + '</span>') + '</span>' +
                  '<span class="inline-launcher-copy">' +
                    '<strong title="' + escapeHtml(entry.displayName) + '">' + escapeHtml(entry.displayName) + '</strong>' +
                    '<small>' + escapeHtml(detail) + '</small>' +
                  '</span>' +
                '</button>' +
              '</article>';
          }).join("") : emptyState("No recent apps yet", "Open apps on this PC and Xenon will keep the last 24 here.")) + '</div>' +
        '</article>' +
      '</div>';
  }

  function mountLaunchersWidget(widget, container, env) {
    var cleanups = [];
    var emptyForm = {
      id: "",
      displayName: "",
      executablePath: "",
      iconPath: "",
      arguments: ""
    };
    var state = {
      data: normalizeLaunchersPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      saving: false,
      launchingId: "",
      form: Object.assign({}, emptyForm)
    };

    function redraw() {
      container.innerHTML = renderLaunchersWidget(state);
    }

    function resetForm() {
      state.form = Object.assign({}, emptyForm);
    }

    function findEntry(id) {
      return state.data.entries.filter(function (entry) {
        return text(entry.id, "") === text(id, "");
      })[0] || null;
    }

    function saveEntries(entries, successMessage) {
      state.saving = true;
      state.statusText = "Saving";
      state.statusTone = "warn";
      redraw();

      return requestJson(buildBridgeUrl(env, "/api/launchers"), {
        method: "POST",
        body: {
          entries: entries
        }
      }, 8000).then(function (payload) {
        state.data = normalizeLaunchersPayload(payload);
        state.saving = false;
        state.statusText = successMessage || "Saved";
        state.statusTone = "good";
        resetForm();
        redraw();
      }, function (error) {
        state.saving = false;
        state.statusText = error.message || "Save failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/launchers"), {}, 6000).then(function (payload) {
        state.data = normalizeLaunchersPayload(payload);
        state.statusText = statusTextFromPayload(payload, state.data.entries.length ? "Live" : "Setup");
        state.statusTone = statusToneFromPayload(payload, state.data.status);
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "submit", function (event) {
      if (!event.target || event.target.getAttribute("data-role") !== "launcher-form") {
        return;
      }

      event.preventDefault();

      var formData = new FormData(event.target);
      var entry = {
        id: String(formData.get("id") || ""),
        displayName: String(formData.get("displayName") || ""),
        executablePath: String(formData.get("executablePath") || ""),
        iconPath: String(formData.get("iconPath") || ""),
        arguments: String(formData.get("arguments") || "")
      };
      var entries = state.data.entries.map(function (current) {
        return {
          id: current.id,
          displayName: current.displayName,
          executablePath: current.executablePath,
          iconPath: current.iconPath,
          arguments: current.arguments
        };
      });
      var index = entries.findIndex(function (current) {
        return text(current.id, "") === text(entry.id, "");
      });

      if (index >= 0) {
        entries[index] = entry;
      } else {
        entry.id = "";
        entries.push(entry);
      }

      saveEntries(entries, index >= 0 ? "Launcher updated" : "Launcher added");
    });

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var entry;
      var entries;
      if (!target) {
        return;
      }

      if (target.getAttribute("data-action") === "refresh" && !state.saving) {
        refresh();
        return;
      }

      if (target.getAttribute("data-action") === "cancel-edit" && !state.saving) {
        resetForm();
        redraw();
        return;
      }

      if (state.saving) {
        return;
      }

      entry = findEntry(target.getAttribute("data-id"));
      if (target.getAttribute("data-action") === "edit" && entry) {
        state.form = {
          id: entry.id,
          displayName: entry.displayName,
          executablePath: entry.executablePath,
          iconPath: entry.iconPath,
          arguments: entry.arguments
        };
        redraw();
        return;
      }

      if (target.getAttribute("data-action") === "remove" && entry) {
        entries = state.data.entries.filter(function (current) {
          return text(current.id, "") !== entry.id;
        }).map(function (current) {
          return {
            id: current.id,
            displayName: current.displayName,
            executablePath: current.executablePath,
            iconPath: current.iconPath,
            arguments: current.arguments
          };
        });
        saveEntries(entries, "Launcher removed");
        return;
      }

      if (target.getAttribute("data-action") === "launch" && entry && !state.launchingId) {
        state.launchingId = entry.id;
        state.statusText = "Launching";
        state.statusTone = "warn";
        redraw();
        requestJson(buildBridgeUrl(env, "/api/launchers/launch"), {
          method: "POST",
          body: {
            id: entry.id
          }
        }, 8000).then(function (payload) {
          state.launchingId = "";
          state.statusText = text(payload.message, "Launched");
          state.statusTone = "good";
          redraw();
        }, function (error) {
          state.launchingId = "";
          state.statusText = error.message || "Launch failed";
          state.statusTone = "danger";
          redraw();
        });
      }
    });

    var loop = createTimerLoop(refresh, 30000, function () {
      return state.saving || Boolean(state.launchingId);
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

  function normalizeQuickActionsPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: payload.configured !== false,
      status: text(payload.status, "live"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, "Built-in Windows quick actions are ready."),
      source: text(payload.source, "native host"),
      darkModeEnabled: Boolean(payload.darkModeEnabled),
      actions: Array.isArray(payload.actions) ? payload.actions : []
    };
  }

  function renderQuickActionsWidget(state) {
    var data = state.data;
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Theme", data.darkModeEnabled ? "Dark" : "Light", "Windows app + system theme") +
          metricCard("Actions", String(data.actions.length), "Built-in commands") +
          metricCard("Status", state.statusText, formatAge(data.sampledAt) || (data.stale ? "Snapshot is stale" : "Fresh snapshot")) +
        '</div>' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header"><div><div class="metric-label">Action Pad</div><div class="router-inline-copy">Tap once for quick actions. Recycle Bin asks for confirmation.</div></div></div>' +
          '<div class="inline-action-grid">' + (data.actions.length ? data.actions.map(function (item) {
            return renderActionButton(item, "execute", state.confirmActionId, state.busy);
          }).join("") : emptyState("No quick actions", "This PC did not return any quick actions.")) + '</div>' +
        '</article>' +
      '</div>';
  }

  function mountQuickActionsWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeQuickActionsPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      busy: false,
      confirmActionId: ""
    };

    function redraw() {
      container.innerHTML = renderQuickActionsWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/quick-actions"), {}, 6000).then(function (payload) {
        state.data = normalizeQuickActionsPayload(payload);
        state.statusText = statusTextFromPayload(payload, "Ready");
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commit(actionId) {
      state.busy = true;
      state.confirmActionId = "";
      state.statusText = "Applying";
      state.statusTone = "warn";
      redraw();

      return Promise.resolve()
        .then(function () {
          return requiresServerConfirmation(actionId) ? requestActionConfirmation(env, actionId) : {};
        })
        .then(function (confirmation) {
          return requestJson(buildBridgeUrl(env, "/api/quick-actions/" + actionId), {
            method: "POST",
            body: {
              actionId: actionId,
              token: text(confirmation && confirmation.token, "")
            }
          }, 8000);
        }).then(function (payload) {
        state.data = normalizeQuickActionsPayload(payload);
        state.busy = false;
        state.statusText = text(payload.message, statusTextFromPayload(payload, "Ready"));
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Action failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var actionId;
      if (!target || state.busy) {
        return;
      }

      if (target.getAttribute("data-action") === "refresh") {
        refresh();
        return;
      }

      if (target.getAttribute("data-action") !== "execute") {
        return;
      }

      actionId = String(target.getAttribute("data-id") || "");
      if (actionId === "empty-recycle-bin" && state.confirmActionId !== actionId) {
        state.confirmActionId = actionId;
        state.statusText = "Confirm";
        state.statusTone = "warn";
        redraw();
        return;
      }

      commit(actionId);
    });

    var loop = createTimerLoop(refresh, 30000, function () {
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

  function normalizeSystemShortcutsPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: payload.configured !== false,
      status: text(payload.status, "live"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, "System shortcuts are ready."),
      source: text(payload.source, "native host"),
      brightness: optionalNumber(payload.brightness),
      brightnessSupported: Boolean(payload.brightnessSupported),
      dndEnabled: Boolean(payload.dndEnabled),
      toggles: Array.isArray(payload.toggles) ? payload.toggles : [],
      powerActions: Array.isArray(payload.powerActions) ? payload.powerActions : []
    };
  }

  function renderSystemShortcutsWidget(state) {
    var data = state.data;
    var brightnessValue = data.brightness == null ? 0 : Math.round(data.brightness);
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Brightness", data.brightnessSupported && data.brightness != null ? Math.round(data.brightness) + "%" : "Unavailable", data.brightnessSupported ? "Active display brightness" : "Display does not expose WMI brightness") +
          metricCard("DND", data.dndEnabled ? "On" : "Off", "Notification banners") +
          metricCard("Status", state.statusText, formatAge(data.sampledAt) || (data.stale ? "Snapshot is stale" : "Fresh snapshot")) +
        '</div>' +
        '<div class="inline-grid inline-grid--2">' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Display</div><div class="router-inline-copy">Adjust brightness and notification mode.</div></div></div>' +
            '<div class="inline-list">' +
              (data.toggles.length ? data.toggles.map(function (item) {
                return renderActionButton(item, "shortcut", "", state.busy);
              }).join("") : emptyState("No toggles", "This PC did not return any system toggles.")) +
              '<div class="inline-list-item">' +
                '<div class="inline-card-header"><div><div class="inline-list-title">Brightness</div><div class="inline-list-copy">' + escapeHtml(data.brightnessSupported ? "Use the slider to adjust the active display." : "This display does not support WMI brightness control.") + '</div></div><div class="inline-list-meta">' + escapeHtml(data.brightnessSupported && data.brightness != null ? brightnessValue + "%" : "--") + '</div></div>' +
                '<input class="inline-range" type="range" min="0" max="100" step="1" aria-label="Display brightness" value="' + brightnessValue + '" data-action="brightness"' + ((state.busy || !data.brightnessSupported) ? " disabled" : "") + '>' +
              '</div>' +
            '</div>' +
          '</article>' +
          '<article class="list-card inline-card">' +
            '<div class="inline-card-header"><div><div class="metric-label">Power</div><div class="router-inline-copy">Sleep, restart, and shutdown ask for confirmation.</div></div></div>' +
            '<div class="inline-action-grid">' + (data.powerActions.length ? data.powerActions.map(function (item) {
              return renderActionButton(item, "shortcut", state.confirmActionId, state.busy);
            }).join("") : emptyState("No power actions", "This PC did not return any power actions.")) + '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountSystemShortcutsWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeSystemShortcutsPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      busy: false,
      confirmActionId: "",
      interacting: false
    };

    function redraw() {
      container.innerHTML = renderSystemShortcutsWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/system-shortcuts"), {}, 6000).then(function (payload) {
        state.data = normalizeSystemShortcutsPayload(payload);
        state.statusText = statusTextFromPayload(payload, "Ready");
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commitShortcut(actionId) {
      state.busy = true;
      state.confirmActionId = "";
      state.statusText = "Applying";
      state.statusTone = "warn";
      redraw();

      return Promise.resolve()
        .then(function () {
          return requiresServerConfirmation(actionId) ? requestActionConfirmation(env, actionId) : {};
        })
        .then(function (confirmation) {
          return requestJson(buildBridgeUrl(env, "/api/system-shortcuts/" + actionId), {
            method: "POST",
            body: {
              actionId: actionId,
              token: text(confirmation && confirmation.token, "")
            }
          }, 8000);
        }).then(function (payload) {
        state.data = normalizeSystemShortcutsPayload(payload);
        state.busy = false;
        state.statusText = text(payload.message, "Ready");
        state.statusTone = statusToneFromPayload(payload, "live");
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Action failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commitBrightness(value) {
      state.busy = true;
      state.statusText = "Adjusting";
      state.statusTone = "warn";
      redraw();

      return requestJson(buildBridgeUrl(env, "/api/system-shortcuts/brightness"), {
        method: "POST",
        body: {
          brightness: clamp(optionalNumber(value) || 0, 0, 100)
        }
      }, 8000).then(function (payload) {
        state.data = normalizeSystemShortcutsPayload(payload);
        state.busy = false;
        state.statusText = "Brightness updated";
        state.statusTone = "good";
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Brightness failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var actionId;
      if (!target || state.busy) {
        return;
      }

      if (target.getAttribute("data-action") === "refresh") {
        refresh();
        return;
      }

      if (target.getAttribute("data-action") !== "shortcut") {
        return;
      }

      actionId = String(target.getAttribute("data-id") || "");
      if ((actionId === "sleep" || actionId === "restart" || actionId === "shutdown") && state.confirmActionId !== actionId) {
        state.confirmActionId = actionId;
        state.statusText = "Confirm";
        state.statusTone = "warn";
        redraw();
        return;
      }

      commitShortcut(actionId);
    });

    addListener(cleanups, container, "input", function (event) {
      var target = event.target;
      if (!target || target.getAttribute("data-action") !== "brightness") {
        return;
      }

      state.interacting = true;
      state.data.brightness = clamp(optionalNumber(target.value) || 0, 0, 100);
      redraw();
    });

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      if (!target || target.getAttribute("data-action") !== "brightness" || state.busy) {
        return;
      }

      state.interacting = false;
      commitBrightness(target.value);
    });

    addListener(cleanups, container, "pointerup", function () {
      state.interacting = false;
    });

    addListener(cleanups, container, "pointercancel", function () {
      state.interacting = false;
    });

    var loop = createTimerLoop(refresh, 30000, function () {
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

  function normalizeClipboardPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: Boolean(payload.configured),
      status: text(payload.status, payload.configured ? "idle" : "setup"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, payload.configured ? "Clipboard history is ready." : "Clipboard history is disabled in Windows."),
      source: text(payload.source, "windows clipboard history"),
      privacy: {
        hidePreviews: Boolean(payload.privacy && payload.privacy.hidePreviews),
        widgetPaused: Boolean(payload.privacy && payload.privacy.widgetPaused),
        excludeFromDiagnostics: payload.privacy ? payload.privacy.excludeFromDiagnostics !== false : true
      },
      entries: Array.isArray(payload.entries) ? payload.entries.map(function (entry) {
        return {
          id: text(entry.id, ""),
          kind: text(entry.kind, "unknown"),
          label: text(entry.label, "Clipboard item"),
          preview: text(entry.preview, "Clipboard content"),
          previewHidden: Boolean(entry.previewHidden),
          canCopy: entry.canCopy !== false
        };
      }) : []
    };
  }

  function renderClipboardWidget(state) {
    var data = state.data;
    return '' +
      '<div class="inline-widget-shell">' +
        '<div class="inline-grid inline-grid--3">' +
          metricCard("Items", String(data.entries.length), data.entries.length ? "Recent history" : (data.configured ? "Nothing recent" : "Enable clipboard history")) +
          metricCard("Privacy", data.privacy.widgetPaused ? "Paused" : data.privacy.hidePreviews ? "Hidden" : "Visible", data.privacy.excludeFromDiagnostics ? "Excluded from diagnostics" : "Diagnostics status only") +
          metricCard("Status", state.statusText, formatAge(data.sampledAt) || (data.stale ? "Snapshot is stale" : "Fresh snapshot")) +
        '</div>' +
        '<div class="inline-actions">' +
          '<button class="inline-button" type="button" data-action="toggle-hide-previews"' + (state.busy ? " disabled" : "") + '>' + (data.privacy.hidePreviews ? "Show previews" : "Hide previews") + '</button>' +
          '<button class="inline-button" type="button" data-action="toggle-pause-widget"' + (state.busy ? " disabled" : "") + '>' + (data.privacy.widgetPaused ? "Resume widget" : "Pause widget") + '</button>' +
          '<button class="inline-button" type="button" data-action="toggle-exclude-diagnostics"' + (state.busy ? " disabled" : "") + '>' + (data.privacy.excludeFromDiagnostics ? "Diagnostics excluded" : "Exclude diagnostics") + '</button>' +
        '</div>' +
        '<article class="list-card inline-card">' +
          '<div class="inline-card-header"><div><div class="metric-label">Recent Entries</div><div class="router-inline-copy">Tap an item to copy it back to the current clipboard.</div></div></div>' +
          '<div class="inline-list">' + (data.entries.length ? data.entries.map(function (entry) {
            return '' +
              '<button class="inline-list-item inline-list-item--button" type="button" data-action="copy" data-id="' + escapeHtml(entry.id) + '"' + ((state.busy || !entry.canCopy) ? " disabled" : "") + '>' +
                '<div class="inline-list-item--split">' +
                  '<div>' +
                    '<div class="inline-list-title">' + escapeHtml(entry.label) + '</div>' +
                    '<div class="inline-list-copy inline-clipboard-preview">' + escapeHtml(entry.preview) + '</div>' +
                  '</div>' +
                  '<div class="inline-list-meta">' + escapeHtml(entry.kind) + '</div>' +
                '</div>' +
              '</button>';
          }).join("") : emptyState(data.configured ? "Clipboard history is empty" : "Clipboard history is off", data.message)) + '</div>' +
        '</article>' +
      '</div>';
  }

  function mountClipboardWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeClipboardPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      busy: false
    };

    function redraw() {
      container.innerHTML = renderClipboardWidget(state);
    }

    function refresh() {
      return requestJson(buildBridgeUrl(env, "/api/clipboard"), {}, 6000).then(function (payload) {
        state.data = normalizeClipboardPayload(payload);
        state.statusText = statusTextFromPayload(payload, state.data.entries.length ? "Live" : state.data.status === "setup" ? "Setup" : "Idle");
        state.statusTone = statusToneFromPayload(payload, state.data.status);
        redraw();
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        redraw();
      });
    }

    function commitCopy(id) {
      state.busy = true;
      state.statusText = "Copying";
      state.statusTone = "warn";
      redraw();

      return requestJson(buildBridgeUrl(env, "/api/clipboard/copy"), {
        method: "POST",
        body: {
          id: id
        }
      }, 8000).then(function (payload) {
        state.data = normalizeClipboardPayload(payload);
        state.busy = false;
        state.statusText = "Copied";
        state.statusTone = "good";
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Copy failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    function updateClipboardPrivacy(settings) {
      state.busy = true;
      state.statusText = "Saving";
      state.statusTone = "warn";
      redraw();

      return saveDashboardSettings(env, settings).then(function () {
        return refresh();
      }).then(function () {
        state.busy = false;
        state.statusText = "Privacy saved";
        state.statusTone = "good";
        redraw();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Save failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      if (!target || state.busy) {
        return;
      }

      if (target.getAttribute("data-action") === "refresh") {
        refresh();
        return;
      }

      if (target.getAttribute("data-action") === "toggle-hide-previews") {
        updateClipboardPrivacy({
          clipboardHidePreviews: !state.data.privacy.hidePreviews
        });
        return;
      }

      if (target.getAttribute("data-action") === "toggle-pause-widget") {
        updateClipboardPrivacy({
          clipboardWidgetPaused: !state.data.privacy.widgetPaused
        });
        return;
      }

      if (target.getAttribute("data-action") === "toggle-exclude-diagnostics") {
        updateClipboardPrivacy({
          clipboardExcludeFromDiagnostics: !state.data.privacy.excludeFromDiagnostics
        });
        return;
      }

      if (target.getAttribute("data-action") === "copy") {
        commitCopy(String(target.getAttribute("data-id") || ""));
      }
    });

    var loop = createTimerLoop(refresh, 12000, function () {
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

  runtime.registerRenderer("quick-actions", mountQuickActionsWidget);
  runtime.registerRenderer("shortcuts", mountSystemShortcutsWidget);
  runtime.registerRenderer("clipboard", mountClipboardWidget);
}());
