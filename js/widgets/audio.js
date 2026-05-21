(function () {
  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime || typeof runtime.registerRenderer !== "function") {
    return;
  }

  var addListener = runtime.addListener;
  var buildBridgeUrl = runtime.buildBridgeUrl;
  var clamp = runtime.clamp;
  var createTimerLoop = runtime.createTimerLoop;
  var emitTouchFeedback = runtime.emitTouchFeedback;
  var emptyState = runtime.emptyState;
  var escapeHtml = runtime.escapeHtml;
  var formatDurationMs = runtime.formatDurationMs;
  var formatMediaAppLabel = runtime.formatMediaAppLabel;
  var formatPercent = runtime.formatPercent;
  var normalizeMediaPayload = runtime.normalizeMediaPayload;
  var optionalNumber = runtime.optionalNumber;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var statusPill = runtime.statusPill;
  var statusTextFromPayload = runtime.statusTextFromPayload;
  var statusToneFromPayload = runtime.statusToneFromPayload;
  var text = runtime.text;

  function normalizeAudioPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: payload.configured !== false,
      status: text(payload.status, "starting"),
      message: text(payload.message, ""),
      source: text(payload.source, "Local bridge"),
      defaultDeviceId: text(payload.defaultDeviceId, ""),
      masterVolume: clamp(optionalNumber(payload.masterVolume) || 0, 0, 100),
      muted: Boolean(payload.muted),
      defaultInputDeviceId: text(payload.defaultInputDeviceId, ""),
      inputVolume: optionalNumber(payload.inputVolume),
      inputMuted: payload.inputMuted == null ? null : Boolean(payload.inputMuted),
      devices: Array.isArray(payload.devices) ? payload.devices : [],
      inputDevices: Array.isArray(payload.inputDevices) ? payload.inputDevices : [],
      sessions: Array.isArray(payload.sessions) ? payload.sessions : []
    };
  }

  function getAudioSessionLabel(session) {
    var name = text(session && session.name, "Application");
    if (name.length > 64) {
      return name.slice(0, 61) + "...";
    }
    return name;
  }

  function isUsefulAudioSession(session) {
    var name = text(session && session.name, "").toLowerCase();
    return Boolean(session && session.active && name.indexOf("microphone") === -1 && name.indexOf("line in") === -1);
  }

  function hasLiveMediaSession(data) {
    return data && (data.status === "live" || data.status === "stale");
  }

  function getMediaPlaybackLabel(data) {
    return text(data && data.playbackStatus, "idle").replace(/-/g, " ").replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
  }

  function getMediaProgressPercent(data) {
    return data && data.durationMs > 0 ? clamp((data.positionMs / data.durationMs) * 100, 0, 100) : null;
  }

  function formatMediaRemaining(data) {
    var duration = optionalNumber(data && data.durationMs);
    var position = optionalNumber(data && data.positionMs);
    if (duration == null || duration <= 0 || position == null) {
      return "Live";
    }
    return "-" + formatDurationMs(Math.max(0, duration - position));
  }

  function getMediaPrimaryAction(data) {
    return data && data.playbackStatus === "playing"
      ? { action: "play-pause", label: "Pause", enabled: Boolean(data.canPause || data.canPlay) }
      : { action: "play-pause", label: "Play", enabled: Boolean(data && (data.canPlay || data.canPause || data.playbackStatus === "paused")) };
  }

  function renderAudioWidget(state) {
    var data = state.data;
    var media = state.media || normalizeMediaPayload({});
    var defaultDevice = data.devices.filter(function (device) {
      return device.isDefault;
    })[0] || data.devices[0] || null;
    var routeDevices = data.devices.filter(function (device) {
      return !device.isDefault;
    }).slice(0, 4);
    var activeSessions = data.sessions.filter(isUsefulAudioSession);
    var hasMediaSession = hasLiveMediaSession(media);
    var visibleSessions = activeSessions.slice(0, 3);
    var playbackLabel = getMediaPlaybackLabel(media);
    var progressPercent = getMediaProgressPercent(media);
    var primaryAction = getMediaPrimaryAction(media);
    var mediaSource = formatMediaAppLabel(media.appId);
    var mediaArtist = text(media.artist, text(media.albumArtist, mediaSource));
    var canSeek = Boolean(media.canSeek && media.durationMs > 0);
    var hiddenSessionCount = Math.max(0, activeSessions.length - visibleSessions.length);
    var mediaControlsHtml = hasMediaSession ? (
      '<div class="audio-media-now">' +
        (media.thumbnailDataUrl
          ? '<img class="audio-media-art" src="' + escapeHtml(media.thumbnailDataUrl) + '" alt="Album art">'
          : '<div class="audio-media-art audio-media-art--placeholder">No Art</div>') +
        '<div class="audio-media-details">' +
          '<div class="audio-media-title-row">' +
            '<div>' +
              '<div class="inline-list-title audio-media-title">' + escapeHtml(text(media.title, "Unknown title")) + '</div>' +
              '<div class="inline-list-copy audio-media-subtitle">' + escapeHtml(mediaArtist + " - " + mediaSource) + '</div>' +
            '</div>' +
            '<div class="audio-media-state">' + escapeHtml(playbackLabel) + '</div>' +
          '</div>' +
          '<div class="audio-media-progress-block">' +
            '<div class="audio-media-progress-row">' +
              '<span>' + escapeHtml(formatDurationMs(media.positionMs)) + '</span>' +
              (progressPercent == null ? '<div class="inline-progress audio-media-progress is-empty"><span class="inline-progress__bar" style="width:100%"></span></div>' : '<div class="inline-progress audio-media-progress"><span class="inline-progress__bar" style="width:' + progressPercent + '%"></span></div>') +
              '<strong>' + escapeHtml(formatMediaRemaining(media)) + '</strong>' +
            '</div>' +
          '</div>' +
          '<div class="inline-actions audio-media-controls">' +
            '<button class="inline-button" type="button" title="Previous track" data-action="media-control" data-media-action="previous"' + (state.busy || !media.canGoPrevious ? " disabled" : "") + '>Prev</button>' +
            '<button class="inline-button" type="button" title="Back 15 seconds" data-action="media-control" data-media-action="seek-back"' + (state.busy || !canSeek ? " disabled" : "") + '>-15s</button>' +
            '<button class="inline-button is-primary" type="button" data-action="media-control" data-media-action="' + escapeHtml(primaryAction.action) + '"' + (state.busy || !primaryAction.enabled ? " disabled" : "") + '>' + escapeHtml(primaryAction.label) + '</button>' +
            '<button class="inline-button" type="button" title="Forward 15 seconds" data-action="media-control" data-media-action="seek-forward"' + (state.busy || !canSeek ? " disabled" : "") + '>+15s</button>' +
            '<button class="inline-button" type="button" title="Next track" data-action="media-control" data-media-action="next"' + (state.busy || !media.canGoNext ? " disabled" : "") + '>Next</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    ) : "";
    var sessionRowsHtml = visibleSessions.length ? visibleSessions.map(function (session) {
      return '' +
        '<div class="audio-session-row">' +
          '<div class="inline-list-item--split audio-session-row__top">' +
            '<div>' +
              '<div class="inline-list-title">' + escapeHtml(getAudioSessionLabel(session)) + '</div>' +
              '<div class="inline-list-copy">' + escapeHtml(session.muted ? "Muted" : "Live") + '</div>' +
            '</div>' +
            '<button class="inline-button" type="button" data-action="session-mute" data-session-id="' + escapeHtml(text(session.id, "")) + '">' + (session.muted ? "Unmute" : "Mute") + '</button>' +
          '</div>' +
          '<div class="audio-session-row__level"><strong>' + escapeHtml(formatPercent(session.volume)) + '</strong><input class="inline-range" type="range" min="0" max="100" aria-label="Audio session volume" value="' + Math.round(optionalNumber(session.volume) || 0) + '" data-action="session-volume" data-session-id="' + escapeHtml(text(session.id, "")) + '"></div>' +
        '</div>';
    }).join("") : emptyState("No app audio", "Apps appear here only while they are making sound.");
    if (hiddenSessionCount > 0) {
      sessionRowsHtml += '<div class="audio-session-more">+' + hiddenSessionCount + ' more active audio app' + (hiddenSessionCount === 1 ? "" : "s") + '</div>';
    }

    return '' +
      '<div class="inline-widget-shell inline-widget-shell--audio">' +
        '<div class="inline-toolbar">' +
          '<div>' +
            '<div class="eyebrow">Audio & Media</div>' +
            '<h3 class="inline-title">Sound and playback</h3>' +
            '<p class="inline-copy">Master volume, output routing, media controls, and app volume without extra scrolling.</p>' +
          '</div>' +
          '<div class="inline-actions">' +
            '<button class="inline-button" type="button" data-action="refresh">Refresh</button>' +
            statusPill(state.statusText, state.statusTone) +
          '</div>' +
        '</div>' +
        '<div class="inline-grid inline-grid--2 audio-media-control-grid audio-compact-grid">' +
          '<article class="list-card inline-card audio-master-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Current output</div>' +
                '<div class="audio-current-output">' + escapeHtml(defaultDevice ? defaultDevice.name : "No default playback device") + '</div>' +
                '<div class="router-inline-copy">' + escapeHtml(data.muted ? "Master output is muted" : text(defaultDevice && (defaultDevice.kind || defaultDevice.availability), text(data.source, "Windows audio"))) + '</div>' +
              '</div>' +
              '<button class="inline-button" type="button" data-action="master-mute">' + (data.muted ? "Unmute" : "Mute") + '</button>' +
            '</div>' +
            '<div class="audio-master-row">' +
              '<strong>' + escapeHtml(Math.round(data.masterVolume) + "%") + '</strong>' +
              '<input class="inline-range" type="range" min="0" max="100" aria-label="Master volume" value="' + Math.round(data.masterVolume) + '" data-action="master-volume">' +
            '</div>' +
            '<div class="audio-card-subhead">' +
              '<div>' +
                '<div class="metric-label">Switch output</div>' +
                '<div class="router-inline-copy">' + escapeHtml(routeDevices.length ? "Tap a route to move Windows audio." : "Only one output is available.") + '</div>' +
              '</div>' +
              statusPill(String(data.devices.length) + " outputs", data.devices.length ? "good" : "warn") +
            '</div>' +
            '<div class="audio-route-strip">' + (routeDevices.length ? routeDevices.map(function (device) {
              return '' +
                '<button class="inline-button audio-route-button" type="button" data-action="switch-device" data-device-id="' + escapeHtml(text(device.id, "")) + '">' +
                  '<strong>' + escapeHtml(text(device.kind, "output")) + '</strong>' +
                  '<span>' + escapeHtml(text(device.name, "Output")) + '</span>' +
                '</button>';
            }).join("") : emptyState("No other outputs", defaultDevice ? "The current output is the only active route." : "No playback devices were returned by Windows.")) + '</div>' +
          '</article>' +
          '<article class="list-card inline-card audio-playback-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Playback mixer</div>' +
                '<div class="router-inline-copy">Media and app volume in one compact panel.</div>' +
              '</div>' +
              statusPill(activeSessions.length ? String(activeSessions.length) + " active" : state.mediaStatusText, activeSessions.length ? "good" : state.mediaStatusTone) +
            '</div>' +
            '<div class="audio-playback-grid' + (hasMediaSession ? "" : " audio-playback-grid--mixer-only") + '">' +
              (hasMediaSession ? '<section class="audio-playback-section audio-playback-media">' +
                '<div class="audio-card-subhead">' +
                  '<div>' +
                    '<div class="metric-label">Media controls</div>' +
                  '</div>' +
                  statusPill(state.mediaStatusText, state.mediaStatusTone) +
                '</div>' +
                mediaControlsHtml +
              '</section>' : '') +
              '<section class="audio-playback-section audio-playback-sessions">' +
                '<div class="audio-card-subhead">' +
                  '<div>' +
                    '<div class="metric-label">App volume mixer</div>' +
                  '</div>' +
                  statusPill(activeSessions.length ? String(activeSessions.length) + " active" : "Quiet", activeSessions.length ? "good" : "muted") +
                '</div>' +
                '<div class="audio-session-stack">' + sessionRowsHtml + '</div>' +
              '</section>' +
            '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountAudioWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeAudioPayload({}),
      media: normalizeMediaPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      mediaStatusText: "Loading",
      mediaStatusTone: "warn",
      busy: false,
      interacting: false
    };

    function redraw() {
      container.innerHTML = renderAudioWidget(state);
    }

    function refresh() {
      var audioRequest = requestJson(buildBridgeUrl(env, "/api/audio"), {}, 5000).then(function (payload) {
        state.data = normalizeAudioPayload(payload);
        state.statusText = statusTextFromPayload(payload, state.data.configured ? "Live" : "Setup");
        state.statusTone = statusToneFromPayload(payload, state.data.configured ? "live" : "setup");
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
      });
      var mediaRequest = requestJson(buildBridgeUrl(env, "/api/media"), {}, 5000).then(function (payload) {
        state.media = normalizeMediaPayload(payload);
        state.mediaStatusText = statusTextFromPayload(payload, text(state.media.playbackStatus, "Idle").replace(/-/g, " "));
        state.mediaStatusTone = statusToneFromPayload(payload, state.media.playbackStatus);
      }, function (error) {
        state.media = normalizeMediaPayload({
          status: "error",
          message: error.message || "Media unavailable"
        });
        state.mediaStatusText = "Media unavailable";
        state.mediaStatusTone = "muted";
      });

      return Promise.all([audioRequest, mediaRequest]).then(function () {
        redraw();
      });
    }

    function commit(path, body, feedback) {
      state.busy = true;
      state.statusText = "Applying";
      state.statusTone = "warn";
      redraw();
      return requestJson(buildBridgeUrl(env, path), {
        method: "POST",
        body: body
      }, 8000).then(function () {
        state.busy = false;
        emitTouchFeedback(env, feedback || "Audio & Media updated");
        return refresh();
      }, function (error) {
        state.busy = false;
        state.statusText = error.message || "Action failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : event.target;
      var action = target && target.getAttribute("data-action");

      if (!action || state.busy) {
        return;
      }

      if (action === "refresh") {
        refresh();
        return;
      }

      if (action === "master-mute") {
        commit("/api/audio/master-mute", {
          muted: !state.data.muted
        });
        return;
      }

      if (action === "switch-device") {
        commit("/api/audio/default-device", {
          deviceId: String(target.getAttribute("data-device-id") || "")
        });
        return;
      }

      if (action === "session-mute") {
        commit("/api/audio/session-mute", {
          sessionId: String(target.getAttribute("data-session-id") || ""),
          muted: String(target.textContent || "").toLowerCase() === "mute"
        });
        return;
      }

      if (action === "media-control") {
        commit("/api/media/" + String(target.getAttribute("data-media-action") || ""), undefined, "Media updated");
      }
    });

    addListener(cleanups, container, "input", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");
      if (action !== "master-volume" && action !== "session-volume") {
        return;
      }

      state.interacting = true;
      var row = target.parentNode;
      var valueNode = row ? row.querySelector("strong") : null;
      if (valueNode) {
        valueNode.textContent = Math.round(optionalNumber(target.value) || 0) + "%";
      }
    });

    addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");
      state.interacting = false;

      if (state.busy) {
        return;
      }

      if (action === "master-volume") {
        commit("/api/audio/master-volume", {
          volume: clamp(optionalNumber(target.value) || 0, 0, 100)
        });
        return;
      }

      if (action === "session-volume") {
        commit("/api/audio/session-volume", {
          sessionId: String(target.getAttribute("data-session-id") || ""),
          volume: clamp(optionalNumber(target.value) || 0, 0, 100)
        });
      }
    });

    addListener(cleanups, container, "pointerup", function () {
      state.interacting = false;
    });

    addListener(cleanups, container, "pointercancel", function () {
      state.interacting = false;
    });

    var loop = createTimerLoop(refresh, 4000, function () {
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

  runtime.registerHelpers({
    getAudioSessionLabel: getAudioSessionLabel,
    isUsefulAudioSession: isUsefulAudioSession,
    normalizeAudioPayload: normalizeAudioPayload
  });
  runtime.registerRenderer("audio", mountAudioWidget);
}());
