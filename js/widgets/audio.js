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
  var initXnSlider = runtime.initXnSlider;
  var normalizeMediaPayload = runtime.normalizeMediaPayload;
  var optionalNumber = runtime.optionalNumber;
  var patchStableDom = runtime.patchStableDom;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var statusPill = runtime.statusPill;
  var statusTextFromPayload = runtime.statusTextFromPayload;
  var statusToneFromPayload = runtime.statusToneFromPayload;
  var text = runtime.text;
  var MAX_OBSERVED_ALBUMS = 7;

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

  function normalizeEqualizerPayload(payload) {
    payload = payload || {};
    var defaultFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    var receivedBands = Array.isArray(payload.bands) ? payload.bands : [];
    var bands = defaultFrequencies.map(function (frequency) {
      var match = receivedBands.filter(function (band) {
        return Number(band && band.frequency) === frequency;
      })[0];
      return {
        frequency: frequency,
        gain: clamp(optionalNumber(match && match.gain) || 0, -12, 12)
      };
    });
    return {
      supported: payload.supported !== false,
      installed: Boolean(payload.installed),
      connected: Boolean(payload.connected),
      bypassed: Boolean(payload.bypassed),
      status: text(payload.status, "missing"),
      message: text(payload.message, "Install Equalizer APO to turn on real sound shaping."),
      engine: text(payload.engine, "Equalizer APO"),
      preset: text(payload.preset, "Flat"),
      headroomDb: clamp(optionalNumber(payload.headroomDb) || 0, -12, 0),
      bands: bands,
      presets: Array.isArray(payload.presets) && payload.presets.length
        ? payload.presets
        : ["Flat", "Bass Boost", "Voice", "Movie", "Gaming"]
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

  function getObservedAlbumKey(data) {
    return [
      text(data && data.appId, "local-player"),
      text(data && data.title, "Media playing"),
      text(data && data.artist, text(data && data.albumArtist, "")),
      text(data && data.albumTitle, "")
    ].join("|").toLowerCase();
  }

  function createObservedAlbum(data) {
    return {
      key: getObservedAlbumKey(data),
      title: text(data && data.title, "Media playing"),
      artist: text(data && data.artist, text(data && data.albumArtist, "Local media")),
      albumTitle: text(data && data.albumTitle, ""),
      appId: text(data && data.appId, ""),
      thumbnailDataUrl: text(data && data.thumbnailDataUrl, "")
    };
  }

  function hasVisibleMediaMetadata(data) {
    return Boolean(data && (
      data.thumbnailDataUrl
      || (data.title && data.title !== "Media playing")
      || data.artist
      || data.albumTitle
    ));
  }

  function rememberObservedAlbum(history, data, dismissedKeys) {
    var current = Array.isArray(history) ? history.slice() : [];
    if (!hasLiveMediaSession(data) || !hasVisibleMediaMetadata(data)) {
      return current;
    }

    var album = createObservedAlbum(data);
    if (Array.isArray(dismissedKeys) && dismissedKeys.indexOf(album.key) >= 0) {
      return current;
    }

    return [album].concat(current.filter(function (entry) {
      return entry.key !== album.key;
    })).slice(0, MAX_OBSERVED_ALBUMS);
  }

  function deleteObservedAlbum(history, key) {
    return (Array.isArray(history) ? history : []).filter(function (entry) {
      return entry && entry.key !== key;
    });
  }

  function rememberDismissedAlbum(dismissedKeys, key) {
    var normalizedKey = text(key, "");
    if (!normalizedKey) {
      return Array.isArray(dismissedKeys) ? dismissedKeys.slice() : [];
    }

    return [normalizedKey].concat((Array.isArray(dismissedKeys) ? dismissedKeys : []).filter(function (entry) {
      return entry !== normalizedKey;
    })).slice(0, 50);
  }

  function getCarouselCoverStyle(offset) {
    var distance = Math.abs(offset);
    var translate = offset * (distance > 1 ? 118 : 138);
    var rotate = offset === 0 ? 0 : offset > 0 ? -38 : 38;
    var scale = offset === 0 ? 1 : distance === 1 ? 0.82 : distance === 2 ? 0.68 : 0.58;
    return "--album-x:" + translate + "px;--album-rotate:" + rotate + "deg;--album-scale:" + scale + ";--album-z:" + (10 - distance) + ";";
  }

  function renderAlbumPlaceholder(album, extraClass) {
    return '<span class="audio-album-cover__placeholder' + (extraClass ? " " + extraClass : "") + '" aria-hidden="true">' +
      '<span class="audio-album-cover__placeholder-label">Now playing</span>' +
      '<strong class="audio-album-cover__placeholder-title">' + escapeHtml(album.title) + '</strong>' +
      '<small class="audio-album-cover__placeholder-artist">' + escapeHtml(album.artist) + '</small>' +
    '</span>';
  }

  function renderAlbumCarousel(state, media) {
    var albums = state.observedAlbums;
    if (!albums.length) {
      return '<div class="audio-album-carousel is-empty" data-carousel tabindex="0" role="region" aria-label="Observed album cards. New songs appear here while they play.">' +
        '<div class="audio-album-carousel__empty">' +
          '<strong>No music cards yet</strong>' +
          '<span>Play a song to create a card here.</span>' +
        '</div>' +
      '</div>';
    }

    var selectedIndex = clamp(state.carouselIndex, 0, Math.max(0, albums.length - 1));
    var selected = albums[selectedIndex];
    var covers = albums.map(function (album, index) {
      var offset = index - selectedIndex;
      if (Math.abs(offset) > 3) {
        return "";
      }

      var selectedLabel = index === 0 ? "Now playing" : "Observed earlier";
      return '<article class="audio-album-card' + (offset === 0 ? " is-selected" : "") + '" data-ui-key="observed-album-' + escapeHtml(album.key) + '" style="' + getCarouselCoverStyle(offset) + '">' +
        '<button class="audio-album-cover" type="button" data-action="carousel-select" data-carousel-index="' + index + '" aria-label="' + escapeHtml(selectedLabel + ": " + album.title + " by " + album.artist) + '"' + (offset === 0 ? ' aria-current="true"' : '') + '>' +
          (album.thumbnailDataUrl
            ? '<img src="' + escapeHtml(album.thumbnailDataUrl) + '" alt="">' +
              renderAlbumPlaceholder(album, "audio-album-cover__fallback")
            : renderAlbumPlaceholder(album, "")) +
        '</button>' +
        '<button class="audio-album-card__delete" type="button" data-action="carousel-delete" data-album-key="' + escapeHtml(album.key) + '" aria-label="' + escapeHtml("Delete music card for " + album.title + " by " + album.artist) + '" title="Delete this card">' +
          '<span aria-hidden="true">×</span>' +
        '</button>' +
      '</article>';
    }).join("");

    return '<div class="audio-album-carousel' + (albums.length === 1 ? " is-single" : "") + '" data-carousel tabindex="0" role="region" aria-label="Observed album cards. Use left and right arrow keys or swipe to browse. Each card can be deleted.">' +
      '<div class="audio-album-carousel__track">' + covers + '</div>' +
      '<div class="audio-album-carousel__browse">' +
        '<button class="audio-album-carousel__nav is-newer" type="button" data-action="carousel-newer" aria-label="Browse newer observed album"' + (selectedIndex <= 0 ? " disabled" : "") + '><span aria-hidden="true">‹</span></button>' +
        '<span class="audio-album-carousel__position">' + (selectedIndex === 0 ? "Now playing" : "Earlier") + ' · ' + (selectedIndex + 1) + ' of ' + albums.length + '</span>' +
        '<button class="audio-album-carousel__nav is-older" type="button" data-action="carousel-older" aria-label="Browse older observed album"' + (selectedIndex >= albums.length - 1 ? " disabled" : "") + '><span aria-hidden="true">›</span></button>' +
      '</div>' +
      '<div class="audio-album-carousel__selection" aria-live="polite">' +
        '<strong>' + escapeHtml(selected.title) + '</strong>' +
        '<span>' + escapeHtml(selected.artist + (selected.albumTitle ? " · " + selected.albumTitle : "")) + '</span>' +
      '</div>' +
    '</div>';
  }

  function formatEqualizerFrequency(frequency) {
    return frequency >= 1000 ? (frequency / 1000) + "k" : String(frequency);
  }

  function getFriendlyAudioDeviceName(name) {
    var deviceName = text(name, "Output").trim();
    var wrappedDevice = deviceName.match(/^(?:Headphones|Headset Earphone|Speakers)\s+\((.+)\)$/i);
    if (wrappedDevice) {
      deviceName = wrappedDevice[1];
    }

    return deviceName
      .replace(/\s+\((?:NVIDIA High Definition Audio|Realtek\(R\) Audio)\)$/i, "")
      .replace(/\s+Wireless Gaming Headset$/i, "")
      .trim();
  }

  function getEqualizerTone(equalizer) {
    if (equalizer.status === "error") {
      return "danger";
    }
    if (equalizer.status === "live") {
      return "good";
    }
    if (equalizer.status === "bypassed") {
      return "muted";
    }
    return equalizer.installed ? "warn" : "muted";
  }

  function getEqualizerPresetSummary(preset) {
    switch (preset) {
      case "Bass Boost":
        return "Adds more thump and warmth.";
      case "Voice":
        return "Cuts rumble and brings voices forward.";
      case "Movie":
        return "Adds impact while keeping dialogue clear.";
      case "Gaming":
        return "Brings footsteps and small details forward.";
      default:
        return "Leaves the sound unchanged.";
    }
  }

  function getEqualizerSafetySummary(headroomDb) {
    var reduction = Math.abs(Math.round((Number(headroomDb) || 0) * 10) / 10);
    if (reduction <= 0) {
      return "No overall volume reduction is needed.";
    }
    return "Overall level is lowered " + reduction + " dB to prevent distortion.";
  }

  function renderEqualizerCard(state) {
    var equalizer = state.equalizer;
    var statusLabel = equalizer.status === "live"
      ? "Active"
      : equalizer.status === "bypassed"
        ? "Bypassed"
        : equalizer.installed
          ? "Needs connection"
          : "Not installed";
    var header = '<div class="inline-card-header">' +
      '<div>' +
        '<div class="metric-label">Sound equalizer</div>' +
        '<div class="audio-equalizer-title">Shape the sound</div>' +
        '<div class="router-inline-copy">' + escapeHtml(equalizer.message) + '</div>' +
      '</div>' +
      statusPill(statusLabel, getEqualizerTone(equalizer)) +
    '</div>';

    if (!equalizer.installed) {
      return '<article class="list-card inline-card audio-equalizer-card is-setup">' +
        header +
        '<div class="audio-equalizer-setup">' +
          '<div class="audio-equalizer-setup__icon" aria-hidden="true">EQ</div>' +
          '<div>' +
            '<strong>One helper is required</strong>' +
            '<span>Install Equalizer APO, choose your playback devices in its Configurator, then come back here.</span>' +
          '</div>' +
        '</div>' +
        '<div class="inline-actions audio-equalizer-setup__actions">' +
          '<a class="inline-button is-primary" href="https://sourceforge.net/projects/equalizerapo/" target="_blank" rel="noopener noreferrer">Get Equalizer APO</a>' +
          '<button class="inline-button" type="button" data-action="refresh">Check again</button>' +
        '</div>' +
        '<div class="audio-equalizer-safety"><strong>Why it is separate</strong><span>Auxora controls the settings. Equalizer APO does the real Windows sound processing.</span></div>' +
      '</article>';
    }

    if (!equalizer.connected) {
      return '<article class="list-card inline-card audio-equalizer-card is-setup">' +
        header +
        '<div class="audio-equalizer-setup">' +
          '<div class="audio-equalizer-setup__icon is-ready" aria-hidden="true">✓</div>' +
          '<div>' +
            '<strong>Equalizer APO is ready</strong>' +
            '<span>Connect once. Auxora will add its own settings file without replacing your existing Equalizer APO setup.</span>' +
          '</div>' +
        '</div>' +
        '<div class="inline-actions audio-equalizer-setup__actions">' +
          '<button class="inline-button is-primary" type="button" data-action="equalizer-connect">Connect Auxora</button>' +
          '<button class="inline-button" type="button" data-action="refresh">Not now</button>' +
        '</div>' +
      '</article>';
    }

    var presets = equalizer.presets.map(function (preset) {
      var presetLabel = preset === "Bass Boost" ? "Bass" : preset;
      return '<button class="audio-preset-button' + (equalizer.preset === preset && !equalizer.bypassed ? " is-active" : "") + '" type="button" data-action="equalizer-preset" data-preset="' + escapeHtml(preset) + '" title="' + escapeHtml(preset) + '"' + (state.busy ? " disabled" : "") + '>' + escapeHtml(presetLabel) + '</button>';
    }).join("");
    var bands = equalizer.bands.map(function (band, index) {
      var gain = Math.round(band.gain * 10) / 10;
      var gainLabel = (gain > 0 ? "+" : "") + gain + " dB";
      var zone = index < 4 ? "bass" : index < 7 ? "voices" : "detail";
      return '<label class="audio-eq-band" data-zone="' + zone + '">' +
        '<strong data-eq-value="' + index + '">' + escapeHtml(gainLabel) + '</strong>' +
        '<input type="range" min="-12" max="12" step="0.5" value="' + gain + '" aria-label="' + escapeHtml(formatEqualizerFrequency(band.frequency) + " hertz equalizer gain") + '" data-action="equalizer-band" data-band-index="' + index + '"' + (state.busy || equalizer.bypassed ? " disabled" : "") + '>' +
        '<span>' + escapeHtml(formatEqualizerFrequency(band.frequency)) + '</span>' +
      '</label>';
    }).join("");

    return '<article class="list-card inline-card audio-equalizer-card">' +
      header +
      '<div class="audio-equalizer-toolbar">' +
        '<div class="audio-preset-strip" role="group" aria-label="Equalizer presets">' + presets + '</div>' +
        '<div class="inline-actions audio-equalizer-actions">' +
          '<button class="inline-button" type="button" data-action="equalizer-bypass" title="' + (equalizer.bypassed ? "Turn the equalizer on" : "Turn the equalizer off") + '">' + (equalizer.bypassed ? "EQ on" : "EQ off") + '</button>' +
          '<button class="inline-button" type="button" data-action="equalizer-reset">Reset</button>' +
        '</div>' +
      '</div>' +
      '<div class="audio-equalizer-zones" aria-label="Equalizer sound areas">' +
        '<div data-zone="bass"><strong>Bass</strong><span>31–250 Hz</span><small>Thump and warmth</small></div>' +
        '<div data-zone="voices"><strong>Voices</strong><span>500 Hz–2 kHz</span><small>Singing and speech</small></div>' +
        '<div data-zone="detail"><strong>Detail</strong><span>4–16 kHz</span><small>Clarity and sparkle</small></div>' +
      '</div>' +
      '<div class="audio-eq-bands' + (equalizer.bypassed ? " is-bypassed" : "") + '">' + bands + '</div>' +
      '<div class="audio-equalizer-footer">' +
        '<span><strong>' + escapeHtml(equalizer.preset) + ':</strong> ' + escapeHtml(getEqualizerPresetSummary(equalizer.preset)) + '</span>' +
        '<span><strong>Safety:</strong> ' + escapeHtml(getEqualizerSafetySummary(equalizer.headroomDb)) + '</span>' +
      '</div>' +
      '<div class="audio-equalizer-guide">' +
        '<div class="audio-equalizer-guide__intro">' +
          '<strong>How to read this</strong>' +
          '<span>Up adds more. Down removes some. 0 dB means no change.</span>' +
        '</div>' +
      '</div>' +
    '</article>';
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
    var visibleSessions = activeSessions.slice(0, 2);
    var playbackLabel = getMediaPlaybackLabel(media);
    var progressPercent = getMediaProgressPercent(media);
    var primaryAction = getMediaPrimaryAction(media);
    var mediaSource = formatMediaAppLabel(media.appId);
    var mediaArtist = text(media.artist, text(media.albumArtist, mediaSource));
    var mediaSubtitle = mediaArtist + (text(media.albumTitle, "") ? " — " + text(media.albumTitle, "") : "");
    var canSeek = Boolean(media.canSeek && media.durationMs > 0);
    var hiddenSessionCount = Math.max(0, activeSessions.length - visibleSessions.length);
    var mediaControlsHtml = hasMediaSession ? (
      '<div class="audio-media-now">' +
        renderAlbumCarousel(state, media) +
        '<div class="audio-media-details">' +
          '<div class="audio-media-title-row">' +
            '<div>' +
              '<div class="inline-list-title audio-media-title">' + escapeHtml(text(media.title, "Unknown title")) + '</div>' +
              '<div class="inline-list-copy audio-media-subtitle">' + escapeHtml(mediaSubtitle) + '</div>' +
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
          '<div class="audio-now-apps">' +
            '<div class="metric-label">App volume</div>' +
            '<div class="audio-session-stack">__AUXORA_ACTIVE_SESSIONS__</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    ) : "";
    var sessionRowsHtml = visibleSessions.length ? visibleSessions.map(function (session, sessionIndex) {
      var sessionLabel = getAudioSessionLabel(session);
      var sessionDisplayLabel = /^(audio )?app(?:lication)?$/i.test(sessionLabel)
        ? (hasMediaSession ? "Music app" : "Active app") + (visibleSessions.length > 1 ? " " + (sessionIndex + 1) : "")
        : sessionLabel;
      var sessionControlLabel = getAudioSessionLabel(session) + " " + (sessionIndex + 1);
      return '' +
        '<div class="audio-session-row" data-ui-key="audio-session-' + escapeHtml(text(session.id, getAudioSessionLabel(session))) + '">' +
          '<div class="inline-list-item--split audio-session-row__top">' +
            '<div>' +
              '<div class="inline-list-title">' + escapeHtml(sessionDisplayLabel) + '</div>' +
              '<div class="inline-list-copy">' + escapeHtml(session.muted ? "Muted" : "Live") + '</div>' +
            '</div>' +
            '<button class="inline-button" type="button" aria-label="' + escapeHtml((session.muted ? "Unmute " : "Mute ") + sessionControlLabel) + '" data-action="session-mute" data-session-id="' + escapeHtml(text(session.id, "")) + '">' + (session.muted ? "Unmute" : "Mute") + '</button>' +
          '</div>' +
          '<div class="audio-session-row__level"><strong>' + escapeHtml(formatPercent(session.volume)) + '</strong><input class="inline-range" type="range" min="0" max="100" aria-label="' + escapeHtml(sessionControlLabel + " volume") + '" value="' + Math.round(optionalNumber(session.volume) || 0) + '" data-action="session-volume" data-session-id="' + escapeHtml(text(session.id, "")) + '"></div>' +
        '</div>';
    }).join("") : emptyState("No app audio", "Apps appear here only while they are making sound.");
    if (hiddenSessionCount > 0) {
      sessionRowsHtml += '<div class="audio-session-more">+' + hiddenSessionCount + ' more app' + (hiddenSessionCount === 1 ? "" : "s") + ' playing sound</div>';
    }
    mediaControlsHtml = mediaControlsHtml.replace("__AUXORA_ACTIVE_SESSIONS__", sessionRowsHtml);

    return '' +
      '<div class="inline-widget-shell inline-widget-shell--audio">' +
        '<div class="audio-command-grid">' +
          '<article class="list-card inline-card audio-master-card">' +
            '<div class="inline-card-header">' +
              '<div>' +
                '<div class="metric-label">Current output</div>' +
                '<div class="audio-current-output" title="' + escapeHtml(defaultDevice ? defaultDevice.name : "No default playback device") + '">' + escapeHtml(defaultDevice ? getFriendlyAudioDeviceName(defaultDevice.name) : "No default playback device") + '</div>' +
                '<div class="router-inline-copy">' + escapeHtml(data.muted ? "Sound is muted." : defaultDevice ? "Windows is sending sound here." : "No output is selected.") + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="audio-master-row">' +
              '<strong>' + escapeHtml(Math.round(data.masterVolume) + "%") + '</strong>' +
              '<input class="inline-range" type="range" min="0" max="100" aria-label="Master volume" value="' + Math.round(data.masterVolume) + '" data-action="master-volume">' +
              '<button class="inline-button audio-master-mute" type="button" data-action="master-mute">' + (data.muted ? "Unmute" : "Mute") + '</button>' +
            '</div>' +
            '<div class="audio-card-subhead">' +
              '<div>' +
                '<div class="metric-label">Choose an output</div>' +
                '<div class="router-inline-copy">' + escapeHtml(routeDevices.length ? "Pick where sound plays." : "Only one output is available.") + '</div>' +
              '</div>' +
              statusPill(String(data.devices.length) + " outputs", data.devices.length ? "good" : "warn") +
            '</div>' +
            '<div class="audio-route-strip">' + (routeDevices.length ? routeDevices.map(function (device) {
              return '' +
                '<button class="inline-button audio-route-button" type="button" title="' + escapeHtml(text(device.name, "Output")) + '" data-ui-key="audio-device-' + escapeHtml(text(device.id, text(device.name, "unknown"))) + '" data-action="switch-device" data-device-id="' + escapeHtml(text(device.id, "")) + '">' +
                  '<strong>' + escapeHtml(text(device.kind, "output")) + '</strong>' +
                  '<span>' + escapeHtml(getFriendlyAudioDeviceName(device.name)) + '</span>' +
                '</button>';
            }).join("") : emptyState("No other outputs", defaultDevice ? "The current output is the only active route." : "No playback devices were returned by Windows.")) + '</div>' +
          '</article>' +
          renderEqualizerCard(state) +
          '<article class="list-card inline-card audio-playback-card">' +
            '<div class="metric-label audio-playback-heading">Playing now</div>' +
            '<div class="audio-playback-grid' + (hasMediaSession ? "" : " audio-playback-grid--mixer-only") + '">' +
              (hasMediaSession ? '<section class="audio-playback-section audio-playback-media">' +
                '<div class="audio-card-subhead">' +
                  '<div>' +
                    '<div class="metric-label">Playback controls</div>' +
                  '</div>' +
                  statusPill(state.mediaStatusText, state.mediaStatusTone) +
                '</div>' +
                mediaControlsHtml +
              '</section>' : '') +
              (!hasMediaSession ? '<section class="audio-playback-section audio-playback-sessions">' +
                '<div class="audio-card-subhead">' +
                  '<div>' +
                    '<div class="metric-label">App volumes</div>' +
                  '</div>' +
                  statusPill(activeSessions.length ? String(activeSessions.length) + " active" : "Quiet", activeSessions.length ? "good" : "muted") +
                '</div>' +
                '<div class="audio-session-stack">' + sessionRowsHtml + '</div>' +
              '</section>' : '') +
            '</div>' +
          '</article>' +
        '</div>' +
      '</div>';
  }

  function mountAudioWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      data: normalizeAudioPayload({}),
      equalizer: normalizeEqualizerPayload({}),
      media: normalizeMediaPayload({}),
      statusText: "Loading",
      statusTone: "warn",
      mediaStatusText: "Loading",
      mediaStatusTone: "warn",
      busy: false,
      interacting: false,
      observedAlbums: [],
      dismissedAlbumKeys: [],
      carouselIndex: 0,
      carouselPointerStartX: null,
      suppressCarouselClick: false,
      nowStripMode: typeof env.getNowStripMode === "function" ? env.getNowStripMode() : "auto"
    };

    function selectCarouselIndex(index, feedback) {
      var maximum = Math.max(0, state.observedAlbums.length - 1);
      state.carouselIndex = clamp(index, 0, maximum);
      if (feedback) {
        emitTouchFeedback(env, feedback);
      }
      redraw();
    }

    function redraw() {
      patchStableDom(container, renderAudioWidget(state));
      initXnSlider(container);
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
      var equalizerRequest = requestJson(buildBridgeUrl(env, "/api/audio/equalizer"), {}, 5000).then(function (payload) {
        state.equalizer = normalizeEqualizerPayload(payload);
      }, function (error) {
        state.equalizer = normalizeEqualizerPayload({
          status: "error",
          message: error.message || "Equalizer status is unavailable."
        });
      });
      var mediaRequest = requestJson(buildBridgeUrl(env, "/api/media"), {}, 5000).then(function (payload) {
        state.media = normalizeMediaPayload(payload);
        var previousCurrentKey = state.observedAlbums.length ? state.observedAlbums[0].key : "";
        state.observedAlbums = rememberObservedAlbum(state.observedAlbums, state.media, state.dismissedAlbumKeys);
        if (state.observedAlbums.length && state.observedAlbums[0].key !== previousCurrentKey) {
          state.carouselIndex = 0;
        } else {
          state.carouselIndex = clamp(state.carouselIndex, 0, Math.max(0, state.observedAlbums.length - 1));
        }
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

      return Promise.all([audioRequest, equalizerRequest, mediaRequest]).then(function () {
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

      if (action === "carousel-select") {
        if (state.suppressCarouselClick) {
          state.suppressCarouselClick = false;
          return;
        }
        selectCarouselIndex(Number(target.getAttribute("data-carousel-index")) || 0);
        return;
      }

      if (action === "carousel-newer") {
        selectCarouselIndex(state.carouselIndex - 1, "Newer album");
        return;
      }

      if (action === "carousel-older") {
        selectCarouselIndex(state.carouselIndex + 1, "Older album");
        return;
      }

      if (action === "carousel-delete") {
        var albumKey = String(target.getAttribute("data-album-key") || "");
        state.dismissedAlbumKeys = rememberDismissedAlbum(state.dismissedAlbumKeys, albumKey);
        state.observedAlbums = deleteObservedAlbum(state.observedAlbums, albumKey);
        state.carouselIndex = clamp(state.carouselIndex, 0, Math.max(0, state.observedAlbums.length - 1));
        state.suppressCarouselClick = false;
        emitTouchFeedback(env, "Music card deleted");
        redraw();
        return;
      }

      if (action === "refresh") {
        refresh();
        return;
      }

      if (action === "equalizer-connect") {
        commit("/api/audio/equalizer/connect", {}, "Equalizer connected");
        return;
      }

      if (action === "equalizer-preset") {
        commit("/api/audio/equalizer", {
          preset: String(target.getAttribute("data-preset") || "Flat"),
          bypassed: false
        }, "Equalizer preset applied");
        return;
      }

      if (action === "equalizer-bypass") {
        commit("/api/audio/equalizer", {
          bypassed: !state.equalizer.bypassed
        }, state.equalizer.bypassed ? "Equalizer turned on" : "Equalizer bypassed");
        return;
      }

      if (action === "equalizer-reset") {
        commit("/api/audio/equalizer", {
          preset: "Flat",
          bypassed: false
        }, "Equalizer reset");
        return;
      }

      if (action === "now-strip-mode") {
        state.nowStripMode = state.nowStripMode === "hidden" ? "auto" : state.nowStripMode === "auto" ? "pinned" : "hidden";
        if (typeof env.setNowStripMode === "function") {
          env.setNowStripMode(state.nowStripMode);
        }
        redraw();
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

    addListener(cleanups, container, "error", function (event) {
      var image = event.target;
      if (!image || image.tagName !== "IMG" || !(image.closest && image.closest(".audio-album-cover"))) {
        return;
      }

      image.closest(".audio-album-cover").classList.add("has-artwork-error");
    }, true);

    addListener(cleanups, container, "input", function (event) {
      var target = event.target;
      var action = target && target.getAttribute("data-action");
      if (action !== "master-volume" && action !== "session-volume" && action !== "equalizer-band") {
        return;
      }

      state.interacting = true;
      if (action === "equalizer-band") {
        var bandIndex = Number(target.getAttribute("data-band-index"));
        var bandGain = clamp(optionalNumber(target.value) || 0, -12, 12);
        if (state.equalizer.bands[bandIndex]) {
          state.equalizer.bands[bandIndex].gain = bandGain;
          state.equalizer.preset = "Custom";
          state.equalizer.headroomDb = -Math.max(0, Math.max.apply(null, state.equalizer.bands.map(function (band) {
            return band.gain;
          })));
        }
        var bandValue = container.querySelector('[data-eq-value="' + bandIndex + '"]');
        if (bandValue) {
          bandValue.textContent = (bandGain > 0 ? "+" : "") + bandGain + " dB";
        }
        return;
      }

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
        return;
      }

      if (action === "equalizer-band") {
        commit("/api/audio/equalizer", {
          bypassed: false,
          bands: state.equalizer.bands.map(function (band) {
            return {
              frequency: band.frequency,
              gain: band.gain
            };
          })
        }, "Custom equalizer saved");
      }
    });

    addListener(cleanups, container, "pointerdown", function (event) {
      if (event.target && event.target.closest && event.target.closest("[data-carousel]")) {
        state.carouselPointerStartX = event.clientX;
      }
    });

    addListener(cleanups, container, "pointerup", function (event) {
      state.interacting = false;
      if (state.carouselPointerStartX == null || !(event.target && event.target.closest && event.target.closest("[data-carousel]"))) {
        state.carouselPointerStartX = null;
        return;
      }

      var distance = event.clientX - state.carouselPointerStartX;
      state.carouselPointerStartX = null;
      if (Math.abs(distance) < 44) {
        return;
      }

      state.suppressCarouselClick = true;
      if (distance < 0) {
        selectCarouselIndex(state.carouselIndex + 1, "Older album");
      } else {
        selectCarouselIndex(state.carouselIndex - 1, "Newer album");
      }
    });

    addListener(cleanups, container, "pointercancel", function () {
      state.interacting = false;
      state.carouselPointerStartX = null;
    });

    addListener(cleanups, container, "keydown", function (event) {
      if (!(event.target && event.target.closest && event.target.closest("[data-carousel]"))) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectCarouselIndex(state.carouselIndex - 1, "Newer album");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        selectCarouselIndex(state.carouselIndex + 1, "Older album");
      } else if (event.key === "Home") {
        event.preventDefault();
        selectCarouselIndex(0, "Now playing");
      }
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
        patchStableDom(container, "");
      }
    };
  }

  runtime.registerHelpers({
    createObservedAlbum: createObservedAlbum,
    deleteObservedAlbum: deleteObservedAlbum,
    getAudioSessionLabel: getAudioSessionLabel,
    getObservedAlbumKey: getObservedAlbumKey,
    isUsefulAudioSession: isUsefulAudioSession,
    rememberDismissedAlbum: rememberDismissedAlbum,
    rememberObservedAlbum: rememberObservedAlbum,
    normalizeEqualizerPayload: normalizeEqualizerPayload,
    normalizeAudioPayload: normalizeAudioPayload
  });
  runtime.registerRenderer("audio", mountAudioWidget);
}());
