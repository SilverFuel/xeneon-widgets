(function () {
  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime || typeof runtime.registerRenderer !== "function") {
    return;
  }

  var addListener = runtime.addListener;
  var buildBridgeUrl = runtime.buildBridgeUrl;
  var escapeHtml = runtime.escapeHtml;
  var patchStableDom = runtime.patchStableDom;
  var productShell = runtime.productShell;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var statusPill = runtime.statusPill;
  var text = runtime.text;

  var SELECTION_CLEARED_MESSAGE = "You had chosen this app to follow, so Game Mode is back to automatic selection.";
  var RULE_KIND_LABELS = {
    name: "Process names",
    launcher: "Launchers",
    nameFragment: "Name fragments",
    pathFragment: "Path fragments"
  };
  var RULE_KIND_TAGS = {
    name: "name",
    launcher: "launcher",
    nameFragment: "fragment",
    pathFragment: "path"
  };

  function normalizeBlocklist(payload) {
    payload = payload || {};
    return {
      status: text(payload.status, "ready") === "unavailable" ? "unavailable" : "ready",
      message: text(payload.message, ""),
      entries: Array.isArray(payload.entries) ? payload.entries.filter(Boolean) : [],
      systemExclusions: Array.isArray(payload.systemExclusions) ? payload.systemExclusions.filter(Boolean) : []
    };
  }

  function normalizeSources(payload) {
    payload = payload || {};
    return {
      detected: Array.isArray(payload.detected) ? payload.detected.filter(Boolean) : [],
      running: Array.isArray(payload.running) ? payload.running.filter(Boolean) : []
    };
  }

  function formatAddedAt(value) {
    var time = value ? new Date(value).getTime() : NaN;
    if (!Number.isFinite(time)) {
      return { label: "Added earlier", title: "" };
    }

    var minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    var label;
    if (minutes < 1) {
      label = "Added just now";
    } else if (minutes < 60) {
      label = "Added " + minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    } else if (minutes < 60 * 24) {
      var hours = Math.round(minutes / 60);
      label = "Added " + hours + (hours === 1 ? " hour ago" : " hours ago");
    } else {
      var days = Math.round(minutes / (60 * 24));
      label = "Added " + days + (days === 1 ? " day ago" : " days ago");
    }

    return { label: label, title: new Date(time).toLocaleString() };
  }

  function tileLabel(name) {
    var words = text(name, "App").split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }
    return text(words[0], "AP").slice(0, 2).toUpperCase();
  }

  function mountGameBlocklistWidget(widget, container, env) {
    var cleanups = [];
    var destroyed = false;
    var state = {
      loading: true,
      blocklist: normalizeBlocklist({}),
      loadError: "",
      pickerOpen: false,
      sourcesLoading: false,
      sources: normalizeSources({}),
      sourcesError: "",
      filter: "",
      showSystem: false,
      busyRef: "",
      busyRemoveId: "",
      confirmation: "",
      confirmationTone: "good",
      highlightId: ""
    };

    function renderEntry(entry) {
      var added = formatAddedAt(entry.addedAt);
      var removing = state.busyRemoveId === entry.id;
      return '' +
        '<li class="game-blocklist-entry' + (state.highlightId === entry.id ? " is-new" : "") + '">' +
          '<span class="game-blocklist-tile" aria-hidden="true">' + escapeHtml(tileLabel(entry.displayName)) + '</span>' +
          '<span class="game-blocklist-entry-main">' +
            '<strong>' + escapeHtml(text(entry.displayName, "App")) + '</strong>' +
            '<small>' + escapeHtml(text(entry.source, "Running app")) + ' · <span' + (added.title ? ' title="' + escapeHtml(added.title) + '"' : '') + '>' + escapeHtml(added.label) + '</span></small>' +
          '</span>' +
          '<button class="inline-button game-blocklist-remove" type="button" data-action="blocklist-remove" data-entry-id="' + escapeHtml(entry.id) + '"' + (removing ? ' disabled aria-busy="true"' : '') + ' aria-label="Remove ' + escapeHtml(text(entry.displayName, "app")) + ' from the blocklist">Remove</button>' +
        '</li>';
    }

    function renderPickRow(item) {
      var busy = state.busyRef === item.ref;
      return '' +
        '<li class="game-blocklist-pick-row">' +
          '<span class="game-blocklist-pick-main">' +
            '<strong>' + escapeHtml(text(item.name, "App")) + '</strong>' +
            '<small>' + escapeHtml(text(item.source, text(item.executableName, "Running app"))) + '</small>' +
          '</span>' +
          (item.active ? '<span class="game-blocklist-tag is-active">Active game</span>' : '') +
          '<button class="inline-button is-primary game-blocklist-ignore" type="button" data-action="blocklist-ignore" data-ref="' + escapeHtml(item.ref) + '"' + (busy || state.busyRef ? ' disabled' : '') + (busy ? ' aria-busy="true"' : '') + ' aria-label="Ignore ' + escapeHtml(text(item.name, "app")) + ' in Game Mode">Ignore</button>' +
        '</li>';
    }

    function matchesFilter(item) {
      var filter = state.filter.trim().toLowerCase();
      return !filter || text(item.name, "").toLowerCase().indexOf(filter) !== -1;
    }

    function renderPickGroup(title, items, emptyCopy) {
      var visible = items.filter(matchesFilter);
      return '' +
        '<section class="game-blocklist-pick-group">' +
          '<div class="game-blocklist-group-label"><span>' + escapeHtml(title) + '</span><span>' + visible.length + '</span></div>' +
          (visible.length
            ? '<ul class="game-blocklist-pick-list">' + visible.map(renderPickRow).join("") + '</ul>'
            : '<div class="game-blocklist-empty-row">' + escapeHtml(state.filter.trim() ? "Nothing matches the filter." : emptyCopy) + '</div>') +
        '</section>';
    }

    function renderPicker() {
      if (!state.pickerOpen) {
        return "";
      }

      var body;
      if (state.sourcesLoading) {
        body = '<div class="game-blocklist-empty-row" role="status">Looking for running apps…</div>';
      } else if (state.sourcesError) {
        body = '<div class="game-blocklist-empty-row" role="status">' + escapeHtml(state.sourcesError) + '</div>';
      } else {
        body = '' +
          renderPickGroup("Detected by Game Mode", state.sources.detected, "Game Mode is not detecting anything right now.") +
          renderPickGroup("Other open apps", state.sources.running, "No other open apps were found.");
      }

      return '' +
        '<section class="game-blocklist-picker" aria-label="Choose what to ignore">' +
          '<div class="game-blocklist-picker-head">' +
            '<strong>Choose what to ignore</strong>' +
            '<input id="game-blocklist-filter" class="game-blocklist-filter" type="search" placeholder="Filter by name" aria-label="Filter apps" value="' + escapeHtml(state.filter) + '" data-blocklist-filter>' +
          '</div>' +
          body +
        '</section>';
    }

    function renderSystemExclusions() {
      var rules = state.blocklist.systemExclusions;
      var toggle = '<button class="game-blocklist-system-toggle" type="button" data-action="blocklist-toggle-system" aria-expanded="' + (state.showSystem ? "true" : "false") + '" aria-controls="game-blocklist-system">' +
        escapeHtml(state.showSystem ? "Hide system exclusions" : "Show system exclusions (" + rules.length + ")") +
      '</button>';
      if (!state.showSystem) {
        return toggle;
      }

      var groups = ["name", "launcher", "nameFragment", "pathFragment"].map(function (kind) {
        var values = rules.filter(function (rule) {
          return rule.kind === kind;
        });
        if (!values.length) {
          return "";
        }
        return '' +
          '<div class="game-blocklist-rule-group">' +
            '<h4>' + escapeHtml(RULE_KIND_LABELS[kind]) + '</h4>' +
            '<ul class="game-blocklist-rules">' + values.map(function (rule) {
              return '<li class="game-blocklist-rule"><span class="game-blocklist-rule-lock" aria-hidden="true"></span>' + escapeHtml(rule.value) + '<span class="game-blocklist-rule-kind">' + escapeHtml(RULE_KIND_TAGS[kind]) + '</span></li>';
            }).join("") + '</ul>' +
          '</div>';
      }).join("");

      return toggle +
        '<section class="game-blocklist-system" id="game-blocklist-system" aria-label="System exclusions">' +
          '<p>Built-in Auxora rules. They always apply, including over pinned games, and cannot be removed or edited.</p>' +
          groups +
        '</section>';
    }

    function renderBody() {
      var unavailable = state.blocklist.status === "unavailable";
      var entries = state.blocklist.entries;
      var parts = [];

      if (state.loadError) {
        parts.push('<div class="game-blocklist-warning" role="status"><strong>The blocklist could not be loaded</strong><span>' + escapeHtml(state.loadError) + '</span></div>');
      } else if (unavailable) {
        parts.push('<div class="game-blocklist-warning" role="status"><strong>The blocklist could not be read</strong><span>Game Mode keeps using the built-in rules. The saved file was not changed. Check whether it is damaged, or reset app data.</span></div>');
      }

      parts.push('<div class="game-blocklist-actions">' +
        '<button class="inline-button is-primary game-blocklist-add" type="button" data-action="blocklist-toggle-picker" aria-expanded="' + (state.pickerOpen ? "true" : "false") + '"' + (unavailable || state.loading || state.loadError ? ' disabled' : '') + '>' + (state.pickerOpen ? "Close" : "+ Add app") + '</button>' +
        (state.confirmation ? '<span class="game-blocklist-confirmation" data-tone="' + escapeHtml(state.confirmationTone) + '" role="status">' + escapeHtml(state.confirmation) + '</span>' : '') +
      '</div>');

      if (!unavailable) {
        parts.push(renderPicker());
      }

      if (!unavailable && !state.loadError) {
        parts.push('<section class="game-blocklist-list" aria-label="Ignored by you">' +
          '<div class="game-blocklist-group-label"><span>Ignored by you</span><span>' +  '</span></div>' +
          (state.loading
            ? '<div class="game-blocklist-empty-row" role="status">Loading the blocklist…</div>'
            : entries.length
              ? '<ul class="game-blocklist-entries">' + entries.map(renderEntry).join("") + '</ul>'
              : '<div class="game-blocklist-empty"><strong>You are not ignoring any apps yet</strong><span>Use Add app to hide docks, wallpapers or overlays from Game Mode.</span></div>') +
        '</section>');
      }

      parts.push(renderSystemExclusions());
      return parts.join("");
    }

    function redraw() {
      if (destroyed) {
        return;
      }
      var unavailable = state.blocklist.status === "unavailable" || Boolean(state.loadError);
      patchStableDom(container, productShell(
        "Blocklist",
        "Game Mode blocklist",
        "Apps Game Mode ignores even while they keep running. They are not closed or changed; they just stop showing up as a game.",
        state.loading ? "Loading" : unavailable ? "Unavailable" : "Ready",
        state.loading ? "muted" : unavailable ? "warn" : "good",
        '<div class="game-blocklist">' + renderBody() + '</div>'
      ));
    }

    function loadBlocklist() {
      return requestJson(buildBridgeUrl(env, "/api/game/blocklist"), {}, 6000).then(function (payload) {
        state.blocklist = normalizeBlocklist(payload);
        state.loadError = "";
      }, function (error) {
        state.loadError = text(error && error.message, "The local service did not answer.");
      }).then(function () {
        state.loading = false;
        redraw();
      });
    }

    function loadSources() {
      state.sourcesLoading = true;
      state.sourcesError = "";
      redraw();
      return requestJson(buildBridgeUrl(env, "/api/game/blocklist/sources"), {}, 8000).then(function (payload) {
        state.sources = normalizeSources(payload);
      }, function (error) {
        state.sourcesError = text(error && error.message, "Running apps could not be listed.");
      }).then(function () {
        state.sourcesLoading = false;
        redraw();
      });
    }

    function setConfirmation(message, tone) {
      state.confirmation = message || "";
      state.confirmationTone = tone || "good";
    }

    function ignoreItem(ref) {
      if (!ref || state.busyRef) {
        return;
      }

      state.busyRef = ref;
      setConfirmation("", "good");
      redraw();
      requestJson(buildBridgeUrl(env, "/api/game/blocklist"), {
        method: "POST",
        body: { ref: ref }
      }, 8000).then(function (payload) {
        var message = text(payload && payload.message, "Game Mode will ignore this app.");
        if (payload && payload.unpinned) {
          message += " Also removed from pinned games.";
        }
        // Shown once, only in this confirmation; it is not stored or repeated on later redraws.
        if (payload && payload.selectionCleared) {
          message += " " + SELECTION_CLEARED_MESSAGE;
        }
        setConfirmation(message, "good");
        state.highlightId = payload && payload.entry ? text(payload.entry.id, "") : "";
        state.sources.detected = state.sources.detected.filter(function (item) {
          return item.ref !== ref;
        });
        state.sources.running = state.sources.running.filter(function (item) {
          return item.ref !== ref;
        });
        return loadBlocklist();
      }, function (error) {
        setConfirmation(text(error && error.message, "That app could not be ignored."), "warn");
        if (text(error && error.message, "") === "That app is no longer running.") {
          return loadSources();
        }
        return null;
      }).then(function () {
        state.busyRef = "";
        redraw();
      });
    }

    function removeEntry(id) {
      if (!id || state.busyRemoveId) {
        return;
      }

      state.busyRemoveId = id;
      setConfirmation("", "good");
      redraw();
      requestJson(buildBridgeUrl(env, "/api/game/blocklist/remove"), {
        method: "POST",
        body: { id: id }
      }, 6000).then(function () {
        setConfirmation("Removed. Game Mode detects this app normally again.", "good");
        state.highlightId = "";
        return loadBlocklist();
      }, function (error) {
        setConfirmation(text(error && error.message, "That entry could not be removed."), "warn");
      }).then(function () {
        state.busyRemoveId = "";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      if (!target || target.disabled) {
        return;
      }

      var action = target.getAttribute("data-action");
      if (action === "blocklist-toggle-picker") {
        state.pickerOpen = !state.pickerOpen;
        setConfirmation("", "good");
        if (state.pickerOpen) {
          loadSources();
        } else {
          state.filter = "";
          redraw();
        }
      } else if (action === "blocklist-ignore") {
        ignoreItem(String(target.getAttribute("data-ref") || ""));
      } else if (action === "blocklist-remove") {
        removeEntry(String(target.getAttribute("data-entry-id") || ""));
      } else if (action === "blocklist-toggle-system") {
        state.showSystem = !state.showSystem;
        redraw();
      }
    });

    addListener(cleanups, container, "input", function (event) {
      if (event.target && event.target.hasAttribute && event.target.hasAttribute("data-blocklist-filter")) {
        state.filter = String(event.target.value || "");
        redraw();
      }
    });

    redraw();
    loadBlocklist();

    return {
      refresh: function () {
        return loadBlocklist();
      },
      destroy: function () {
        destroyed = true;
        runCleanups(cleanups);
        patchStableDom(container, "");
      }
    };
  }

  runtime.registerRenderer("game-blocklist", mountGameBlocklistWidget);
}());
