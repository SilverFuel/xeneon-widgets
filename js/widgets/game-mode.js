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
  var emitTouchFeedback = runtime.emitTouchFeedback;
  var escapeHtml = runtime.escapeHtml;
  var findById = runtime.findById;
  var formatAge = runtime.formatAge;
  var formatDurationMs = runtime.formatDurationMs;
  var formatFps = runtime.formatFps;
  var formatMs = runtime.formatMs;
  var formatPercent = runtime.formatPercent;
  var formatTemp = runtime.formatTemp;
  var getAudioSessionLabel = runtime.getAudioSessionLabel;
  var isUsefulAudioSession = runtime.isUsefulAudioSession;
  var metricCard = runtime.metricCard;
  var networkLinkSpeed = runtime.networkLinkSpeed;
  var networkQualityLabel = runtime.networkQualityLabel;
  var networkQualityScore = runtime.networkQualityScore;
  var networkQualityTone = runtime.networkQualityTone;
  var networkTypeLabel = runtime.networkTypeLabel;
  var normalizeAudioPayload = runtime.normalizeAudioPayload;
  var normalizeNetworkSnapshot = runtime.normalizeNetworkSnapshot;
  var normalizeUnifiSnapshot = runtime.normalizeUnifiSnapshot;
  var nullableNumber = runtime.nullableNumber;
  var optionalNumber = runtime.optionalNumber;
  var productShell = runtime.productShell;
  var productThemes = runtime.productThemes;
  var requestJson = runtime.requestJson;
  var runCleanups = runtime.runCleanups;
  var saveSettings = runtime.saveSettings;
  var settingValue = runtime.settingValue;
  var statusPill = runtime.statusPill;
  var GAME_FOCUS_TOUCH_GRASS_MS = 3 * 60 * 60 * 1000;
  var statusTextFromPayload = runtime.statusTextFromPayload;
  var statusToneFromPayload = runtime.statusToneFromPayload;
  var text = runtime.text;

  var customGameModeProfile = {
    id: "custom",
    name: "Custom",
    themeId: "edge",
    accent: "#00e0ff",
    secondary: "#44f0c2",
    mood: "Dashboard theme"
  };
  var gameThemeKeywords = [
    { match: ["counter-strike", "cs2"], accent: "#f0b13e", secondary: "#4b7bff", mood: "Tactical amber" },
    { match: ["dota"], accent: "#c83c36", secondary: "#f0b13e", mood: "Ancient red" },
    { match: ["apex"], accent: "#ff5a36", secondary: "#23d0ff", mood: "Arena rush" },
    { match: ["elden", "dark souls", "sekiro"], accent: "#d6aa57", secondary: "#7c5cff", mood: "Boss fight" },
    { match: ["baldur"], accent: "#b455ff", secondary: "#ffcf5a", mood: "Arcane party" },
    { match: ["cyberpunk"], accent: "#f7ec39", secondary: "#00e0ff", mood: "Night city" },
    { match: ["helldivers"], accent: "#f5d742", secondary: "#2d7dff", mood: "Drop ready" },
    { match: ["rust"], accent: "#d36b3d", secondary: "#44f0c2", mood: "Survival" },
    { match: ["destiny"], accent: "#d7e6ff", secondary: "#7a5cff", mood: "Lightfall" },
    { match: ["warframe"], accent: "#20d6ff", secondary: "#f06cff", mood: "Void sprint" },
    { match: ["monster hunter"], accent: "#55d27a", secondary: "#ffb547", mood: "Hunt ready" },
    { match: ["stardew"], accent: "#7fd15f", secondary: "#f5c26b", mood: "Cozy farm" },
    { match: ["terraria"], accent: "#65d46e", secondary: "#4e9dff", mood: "Adventure" },
    { match: ["factorio"], accent: "#f28f38", secondary: "#8ed1ff", mood: "Factory flow" },
    { match: ["rimworld"], accent: "#d8c48f", secondary: "#ff6b86", mood: "Colony watch" },
    { match: ["palworld"], accent: "#39d8ff", secondary: "#8aff80", mood: "Open world" },
    { match: ["grand theft auto", "gta"], accent: "#44f0c2", secondary: "#ff4d8d", mood: "City neon" },
    { match: ["pubg"], accent: "#f6a33a", secondary: "#d8dbe2", mood: "Battle royale" },
    { match: ["rainbow six"], accent: "#42a5ff", secondary: "#ffb547", mood: "Breach ready" },
    { match: ["path of exile"], accent: "#b68050", secondary: "#ff4d6d", mood: "Dark loot" }
  ];

  function activeGameModeProfile(env) {
    return customGameModeProfile;
  }

  function gameModeProfileName(profile, game) {
    return text(game, "No game launched yet");
  }

  function gameModeProfileTheme(profile, env) {
    var theme = findById(productThemes(env), settingValue(env, "themeId", customGameModeProfile.themeId));
    var customAccent = settingValue(env, "accentColor", "");
    return {
      id: theme.id,
      accent: customAccent || theme.accent || customGameModeProfile.accent,
      secondary: theme.secondary || customGameModeProfile.secondary,
      mood: text(theme.name, customGameModeProfile.mood)
    };
  }

  function themeForGame(game, env) {
    var theme = gameModeProfileTheme(customGameModeProfile, env);
    var gameName = text(game && game.name, "Game");
    var normalizedName = gameName.toLowerCase();
    var matchedTheme = gameThemeKeywords.filter(function (entry) {
      return entry.match.some(function (keyword) {
        return normalizedName.indexOf(keyword) !== -1;
      });
    })[0];

    if (matchedTheme) {
      return {
        profileId: customGameModeProfile.id,
        gameName: gameName,
        themeId: "game:" + gameName,
        accent: matchedTheme.accent,
        secondary: matchedTheme.secondary,
        mood: matchedTheme.mood
      };
    }

    return {
      profileId: customGameModeProfile.id,
      gameName: gameName,
      themeId: theme.id,
      accent: theme.accent,
      secondary: theme.secondary,
      mood: "Dashboard theme"
    };
  }

  function themeForSteamGame(game, env) {
    return themeForGame(game, env);
  }

  function normalizeGameActivityGame(game) {
    if (!game) {
      return null;
    }

    return {
      id: text(game.id || game.appId, ""),
      appId: text(game.appId, ""),
      name: text(game.name, "Game"),
      platform: text(game.platform, game.appId ? "Steam" : "Game"),
      source: text(game.source, ""),
      processId: optionalNumber(game.processId),
      processName: text(game.processName, ""),
      executablePath: text(game.executablePath, ""),
      hasRuntimeIdentity: Boolean(game.hasRuntimeIdentity),
      canPin: Boolean(game.canPin),
      confidence: optionalNumber(game.confidence),
      reason: text(game.reason, ""),
      state: text(game.state, ""),
      focused: Boolean(game.focused),
      foregroundProcessName: text(game.foregroundProcessName, ""),
      startedAt: text(game.startedAt, ""),
      sessionStartedAt: text(game.sessionStartedAt, ""),
      sessionDurationMs: optionalNumber(game.sessionDurationMs) || 0,
      artworkUrl: text(game.artworkUrl, ""),
      iconUrl: text(game.iconUrl, ""),
      tileLabel: text(game.tileLabel, "G")
    };
  }

  function normalizeGameActivityPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: Boolean(payload.configured),
      status: text(payload.status, payload.active ? "active" : "idle"),
      mode: text(payload.mode, payload.active ? "in-game" : "idle"),
      stateLabel: text(payload.stateLabel, payload.active ? "In game" : "Idle"),
      active: Boolean(payload.active && payload.activeGame),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      lastEndedAt: text(payload.lastEndedAt, ""),
      message: text(payload.message, payload.active ? "Game running." : "No active game detected."),
      source: text(payload.source, "running processes"),
      foregroundProcessId: optionalNumber(payload.foregroundProcessId),
      foregroundProcessName: text(payload.foregroundProcessName, ""),
      foregroundAppActive: Boolean(payload.foregroundAppActive),
      activeGame: normalizeGameActivityGame(payload.activeGame),
      lastGame: normalizeGameActivityGame(payload.lastGame),
      candidates: Array.isArray(payload.candidates) ? payload.candidates.map(normalizeGameActivityGame).filter(Boolean) : []
    };
  }

  function normalizeGamePerformancePayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      active: Boolean(payload.active),
      status: text(payload.status, "idle"),
      stale: Boolean(payload.stale),
      processId: nullableNumber(payload.processId),
      processName: text(payload.processName, ""),
      fps: nullableNumber(payload.fps),
      frameTimeMs: nullableNumber(payload.frameTimeMs),
      source: text(payload.source, "NVIDIA PresentMon"),
      fpsSource: text(payload.fpsSource, text(payload.source, "NVIDIA PresentMon")),
      readiness: text(payload.readiness, text(payload.status, "idle")),
      needsAdmin: Boolean(payload.needsAdmin),
      canRestartAsAdmin: Boolean(payload.canRestartAsAdmin),
      restartAsAdminEndpoint: text(payload.restartAsAdminEndpoint, "/api/system/restart-admin"),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, "Start a game to capture main-display FPS.")
    };
  }

  function normalizeSteamGamesPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      configured: Boolean(payload.configured),
      status: text(payload.status, payload.configured ? "live" : "setup"),
      stale: Boolean(payload.stale),
      sampledAt: text(payload.sampledAt, ""),
      message: text(payload.message, payload.configured ? "Steam games are ready." : "Install games in Steam and Xenon will find them."),
      source: text(payload.source, "Steam library manifests"),
      libraryCount: optionalNumber(payload.libraryCount) || 0,
      activeGame: payload.activeGame ? {
        appId: text(payload.activeGame.appId, ""),
        name: text(payload.activeGame.name, "Steam Game"),
        installed: payload.activeGame.installed !== false,
        lastPlayed: text(payload.activeGame.lastPlayed, ""),
        sizeOnDisk: optionalNumber(payload.activeGame.sizeOnDisk),
        artworkUrl: text(payload.activeGame.artworkUrl, ""),
        tileLabel: text(payload.activeGame.tileLabel, "S")
      } : null,
      games: Array.isArray(payload.games) ? payload.games.map(function (game) {
        return {
          appId: text(game.appId, ""),
          name: text(game.name, "Steam Game"),
          installed: game.installed !== false,
          lastPlayed: text(game.lastPlayed, ""),
          sizeOnDisk: optionalNumber(game.sizeOnDisk),
          artworkUrl: text(game.artworkUrl, ""),
          tileLabel: text(game.tileLabel, "S")
        };
      }).filter(function (game) {
        return Boolean(game.appId);
      }) : []
    };
  }

  function normalizeGameModeSessionPayload(payload) {
    payload = payload || {};
    return {
      supported: payload.supported !== false,
      status: text(payload.status, "live"),
      message: text(payload.message, "Game Mode telemetry is live."),
      sampledAt: text(payload.sampledAt, ""),
      system: payload.system || {},
      audio: normalizeAudioPayload(payload.audio || {}),
      network: Object.assign({}, payload.network || {}, {
        unifi: normalizeUnifiSnapshot(payload.unifi || (payload.network && payload.network.unifi) || {})
      }),
      steam: normalizeSteamGamesPayload(payload.steam || {}),
      activity: normalizeGameActivityPayload(payload.activity || {}),
      performance: normalizeGamePerformancePayload(payload.performance || {}),
      collectorTimings: Array.isArray(payload.collectorTimings) ? payload.collectorTimings : []
    };
  }

  function gameModeThemeStyle(theme) {
    return "--game-accent:" + escapeHtml(theme.accent) + ";--game-secondary:" + escapeHtml(theme.secondary) + ";";
  }

  function renderGameModeSteamPad(steam, statusText, statusTone, launchingId, expandedAppId, env) {
    var games = Array.isArray(steam.games) ? steam.games : [];
    var total = Array.isArray(steam.games) ? steam.games.length : 0;
    var activeAppId = steam && steam.activeGame ? String(steam.activeGame.appId || "") : "";
    var savedGame = settingValue(env, "gameModeGame", "");
    return '' +
      '<article class="product-control-panel game-mode-steam-panel">' +
        '<div class="game-mode-steam-head">' +
          '<div>' +
            '<div class="metric-label">Steam games</div>' +
            '<strong>' + escapeHtml(total ? total + " installed" : "No games found") + '</strong>' +
            '<span>' + escapeHtml(total ? "Tap to launch. Hold a game to apply its look first." : text(steam.message, "Xenon scans your local Steam library.")) + '</span>' +
          '</div>' +
          '<div class="game-mode-steam-actions">' +
            '<button class="inline-button" type="button" data-action="steam-refresh"' + (launchingId ? " disabled" : "") + '>Rescan</button>' +
            statusPill(statusText, statusTone) +
          '</div>' +
        '</div>' +
        '<div class="game-mode-steam-dock" role="list" aria-label="Steam launch dock">' + (games.length ? games.map(function (game) {
          var theme = themeForSteamGame(game, env);
          var launching = launchingId === game.appId;
          var active = activeAppId === game.appId || savedGame === game.name;
          var expanded = expandedAppId === game.appId;
          var tileClass = "game-mode-steam-tile" + (active ? " is-active" : "") + (expanded ? " is-expanded" : "");
          return '' +
            '<div class="' + tileClass + '" style="' + gameModeThemeStyle(theme) + '" data-app-id="' + escapeHtml(game.appId) + '" role="listitem">' +
              '<button class="game-mode-steam-launch" type="button" data-action="steam-launch" data-app-id="' + escapeHtml(game.appId) + '"' + (launchingId ? " disabled" : "") + '>' +
                '<span class="game-mode-steam-art">' + (game.artworkUrl
                  ? '<img src="' + escapeHtml(game.artworkUrl) + '" alt="' + escapeHtml(game.name) + '" loading="lazy">'
                  : '<span>' + escapeHtml(game.tileLabel) + '</span>') + '</span>' +
                '<span class="game-mode-steam-copy">' +
                  '<strong>' + escapeHtml(game.name) + '</strong>' +
                  '<small>' + escapeHtml(launching ? "Launching" : active ? "Active look" : expanded ? "Look ready" : "Launch") + '</small>' +
                '</span>' +
              '</button>' +
              (expanded ? '<div class="game-mode-steam-long-actions">' +
                '<button class="inline-button" type="button" data-action="steam-theme" data-app-id="' + escapeHtml(game.appId) + '"' + (launchingId ? " disabled" : "") + '>Theme</button>' +
                '<button class="inline-button is-primary" type="button" data-action="steam-launch" data-app-id="' + escapeHtml(game.appId) + '"' + (launchingId ? " disabled" : "") + '>Launch</button>' +
              '</div>' : '') +
            '</div>';
        }).join("") : emptyState("No Steam games", "Install games in Steam, then tap Rescan.")) + '</div>' +
      '</article>';
  }

  function gameActivityId(game) {
    return text(game && (game.id || game.appId || game.name), "");
  }

  function steamGameAsActivity(game) {
    if (!game) {
      return null;
    }

    return {
      id: "steam:" + text(game.appId, ""),
      appId: text(game.appId, ""),
      name: text(game.name, "Steam Game"),
      platform: "Steam",
      source: "Steam library",
      processName: "",
      confidence: 96,
      reason: "Steam game is active.",
      startedAt: "",
      artworkUrl: text(game.artworkUrl, ""),
      iconUrl: "",
      tileLabel: text(game.tileLabel, "S")
    };
  }

  function renderGameFacePanel(savedGame, fallbackGameName, theme, activity, system, env) {
    var activeGame = activity && activity.activeGame ? activity.activeGame : null;
    var gameName = activeGame ? activeGame.name : "No game launched yet";
    var platform = activeGame ? text(activeGame.platform, "Game") : "Waiting";
    var detail = activeGame
      ? text(activeGame.reason, text(activeGame.source, "Running now"))
      : text(activity && activity.message, "No active game detected.");
    var session = activeGame && activeGame.startedAt ? formatAge(activeGame.startedAt) : "--";
    var artUrl = activeGame ? text(activeGame.artworkUrl || activeGame.iconUrl, "") : "";
    var tileLabel = activeGame ? text(activeGame.tileLabel, "G") : "GX";
    return '' +
      '<article class="product-control-panel game-face-panel" style="' + gameModeThemeStyle(theme) + '">' +
        '<div class="game-face-main">' +
          '<div class="game-face-art">' + (artUrl
            ? '<img src="' + escapeHtml(artUrl) + '" alt="' + escapeHtml(gameName) + '" loading="lazy">'
            : '<span>' + escapeHtml(tileLabel) + '</span>') + '</div>' +
          '<div class="game-face-copy">' +
            '<div class="metric-label">Game Mode status</div>' +
            '<strong>' + escapeHtml(gameName) + '</strong>' +
            '<span>' + escapeHtml(platform + (activeGame ? " - active now" : " - idle")) + '</span>' +
          '</div>' +
          '<button class="inline-button game-face-home-pill" type="button" data-action="game-face-home">Home</button>' +
        '</div>' +
        '<div class="game-face-detail">' + escapeHtml(detail) + '</div>' +
        '<div class="game-face-signals">' +
          '<div><span>GPU</span><strong>' + escapeHtml(formatPercent(system && system.gpu)) + '</strong></div>' +
          '<div><span>CPU</span><strong>' + escapeHtml(formatPercent(system && system.cpu)) + '</strong></div>' +
          '<div><span>RAM</span><strong>' + escapeHtml(formatPercent(system && system.ram)) + '</strong></div>' +
          '<div><span>Session</span><strong>' + escapeHtml(session) + '</strong></div>' +
        '</div>' +
      '</article>';
  }

  function gameFocusToneClass(tone) {
    var value = text(tone, "").toLowerCase();
    return value ? " is-" + value : "";
  }

  function gameFocusLoadTone(value, warnAt, dangerAt) {
    var parsed = nullableNumber(value);
    if (parsed == null) {
      return "muted";
    }
    if (parsed >= (dangerAt || 92)) {
      return "danger";
    }
    if (parsed >= (warnAt || 80)) {
      return "warn";
    }
    return "good";
  }

  function gameFocusLowTone(value, warnBelow, dangerBelow) {
    var parsed = nullableNumber(value);
    if (parsed == null) {
      return "muted";
    }
    if (parsed <= (dangerBelow || 30)) {
      return "danger";
    }
    if (parsed <= (warnBelow || 55)) {
      return "warn";
    }
    return "good";
  }

  function gameFocusPressureValue(system) {
    var values = [nullableNumber(system && system.gpu), nullableNumber(system && system.cpu), nullableNumber(system && system.ram)].filter(function (value) {
      return value != null;
    });
    return values.length ? Math.max.apply(Math, values) : null;
  }

  function renderGameFocusHudItem(label, value, detail, progress, tone, metricId) {
    var progressValue = optionalNumber(progress);
    var metricAttribute = metricId ? ' data-game-focus-metric="' + escapeHtml(metricId) + '"' : "";
    return '' +
      '<div class="game-focus-metric' + gameFocusToneClass(tone) + '"' + metricAttribute + '>' +
        '<span>' + escapeHtml(label) + '</span>' +
        '<strong data-game-focus-value>' + escapeHtml(value) + '</strong>' +
        '<small data-game-focus-detail>' + escapeHtml(detail || "") + '</small>' +
        '<i data-game-focus-progress' + (progressValue == null ? ' hidden' : ' style="--metric-fill:' + escapeHtml(String(clamp(progressValue, 0, 100))) + '%"') + '></i>' +
      '</div>';
  }

  function gameFocusProgress(value, ceiling) {
    var parsed = nullableNumber(value);
    return parsed == null ? null : clamp((parsed / (ceiling || 100)) * 100, 0, 100);
  }

  function formatGameFocusRate(value) {
    var parsed = optionalNumber(value);
    if (parsed == null) {
      return "--";
    }
    return (parsed >= 10 ? Math.round(parsed) : parsed.toFixed(1)) + " Mbps";
  }

  function gameFocusNetworkSummary(network) {
    var data = network || {};
    var unifi = data.unifi || normalizeUnifiSnapshot({});
    var ping = optionalNumber(data.ping != null ? data.ping : unifi.latencyMs);
    var score = networkQualityScore(normalizeNetworkSnapshot(data), unifi);
    var tone = networkQualityTone(score);
    var provider = unifi.linked ? "UniFi" : unifi.detected ? "UniFi ready" : networkTypeLabel(data.type);
    return {
      ping: ping,
      pingLabel: ping == null ? "--" : Math.round(ping) + " ms",
      score: score,
      tone: tone,
      provider: provider,
      detail: networkQualityLabel(score),
      download: formatGameFocusRate(data.download),
      upload: formatGameFocusRate(data.upload),
      clients: unifi.linked ? String(unifi.clients.total) : "--",
      aps: unifi.linked ? String(unifi.aps.length) : "--",
      linkSpeed: networkLinkSpeed(data.linkSpeedMbps)
    };
  }

  function gameFocusAudioOutput(audio) {
    var data = normalizeAudioPayload(audio || {});
    return data.devices.filter(function (device) {
      return device && device.isDefault;
    })[0] || data.devices[0] || null;
  }

  function gameFocusMicInput(audio) {
    var data = normalizeAudioPayload(audio || {});
    return data.inputDevices.filter(function (device) {
      return device && device.isDefault;
    })[0] || data.inputDevices[0] || null;
  }

  function gameFocusMicState(audio) {
    var data = normalizeAudioPayload(audio || {});
    var input = gameFocusMicInput(data);
    var volume = optionalNumber(data.inputVolume);
    var muted = data.inputMuted === true;

    if (!input) {
      return {
        available: false,
        label: "No mic",
        detail: "No input device",
        button: "No mic",
        progress: null,
        tone: "muted"
      };
    }

    return {
      available: true,
      label: muted ? "Muted" : volume == null ? "Live" : Math.round(volume) + "%",
      detail: compactAudioName(input.name),
      button: muted ? "Unmute mic" : "Mute mic",
      progress: volume,
      tone: muted ? "warn" : "good"
    };
  }

  function compactAudioName(name) {
    var value = text(name, "No output");
    value = value.replace(/\s*\([^)]*\)/g, "").trim();
    return value || text(name, "No output");
  }

  function gameFocusTileLabel(game) {
    var name = text(game && game.name, "");
    var fallback = text(game && game.tileLabel, "GX");
    var tokens = name.toUpperCase().match(/[A-Z0-9]+/g) || [];
    var last = tokens.length ? tokens[tokens.length - 1] : "";
    var romanMap = {
      I: "1",
      II: "2",
      III: "3",
      IV: "4",
      V: "5",
      VI: "6",
      VII: "7",
      VIII: "8",
      IX: "9",
      X: "10"
    };

    if (tokens.length > 1 && (romanMap[last] || /^\d{1,2}$/.test(last))) {
      return tokens[0].charAt(0) + (romanMap[last] || last);
    }

    if (tokens.length > 1) {
      return tokens.slice(0, 2).map(function (part) {
        return part.charAt(0);
      }).join("");
    }

    return fallback;
  }

  function gameFocusSessionDurationMs(game) {
    var duration = optionalNumber(game && game.sessionDurationMs);
    if (duration != null && duration > 0) {
      return duration;
    }

    var startedAt = text(game && (game.sessionStartedAt || game.startedAt), "");
    var startedTime = startedAt ? new Date(startedAt).getTime() : NaN;
    return Number.isFinite(startedTime) && startedTime > 0 ? Math.max(0, Date.now() - startedTime) : 0;
  }

  function gameFocusSessionDisplay(durationMs) {
    var duration = optionalNumber(durationMs) || 0;
    return duration >= GAME_FOCUS_TOUCH_GRASS_MS ? "Go touch grass" : formatDurationMs(duration);
  }

  function gameFocusSessionText(game) {
    var duration = gameFocusSessionDurationMs(game);
    return duration > 0 ? gameFocusSessionDisplay(duration) : "Just now";
  }

  function gameFocusAudioSessions(audio, game) {
    var data = normalizeAudioPayload(audio || {});
    var gameProcessId = optionalNumber(game && game.processId);
    var gameProcessName = text(game && game.processName, "").toLowerCase();
    return data.sessions.filter(isUsefulAudioSession).sort(function (left, right) {
      var leftName = text(left && left.name, "").toLowerCase();
      var rightName = text(right && right.name, "").toLowerCase();
      var leftGame = (gameProcessId != null && left.processId === gameProcessId)
        || (gameProcessName && leftName.indexOf(gameProcessName) !== -1);
      var rightGame = (gameProcessId != null && right.processId === gameProcessId)
        || (gameProcessName && rightName.indexOf(gameProcessName) !== -1);
      if (leftGame !== rightGame) {
        return leftGame ? -1 : 1;
      }
      return (optionalNumber(right.volume) || 0) - (optionalNumber(left.volume) || 0);
    });
  }

  function renderGameFocusAudioRows(sessions, game) {
    var visible = sessions.slice(0, 3);
    var gameProcessId = optionalNumber(game && game.processId);
    if (!visible.length) {
      return '<div class="game-focus-empty">No active app audio</div>';
    }

    return visible.map(function (session) {
      var isGame = gameProcessId != null && session.processId === gameProcessId;
      return '' +
        '<div class="game-focus-audio-row' + (isGame ? " is-game" : "") + (session.muted ? " is-muted" : "") + '">' +
          '<div>' +
            '<strong>' + escapeHtml(isGame ? "Game audio" : getAudioSessionLabel(session)) + '</strong>' +
            '<span>' + escapeHtml(session.muted ? "Muted" : "Live") + '</span>' +
          '</div>' +
          '<b>' + escapeHtml(formatPercent(session.volume)) + '</b>' +
          '<button class="inline-button" type="button" data-action="game-session-mute" data-session-id="' + escapeHtml(text(session.id, "")) + '">' + (session.muted ? "Unmute" : "Mute") + '</button>' +
        '</div>';
    }).join("");
  }

  function gameFocusReasonText(detail, source, activeAudioSessions) {
    var normalized = text(detail, source + " is active.");
    if (normalized.toLowerCase().indexOf("background") !== -1) {
      normalized = source + " reports this game is running.";
    }
    return (activeAudioSessions ? activeAudioSessions + " active audio app" + (activeAudioSessions === 1 ? "" : "s") + ". " : "") + normalized;
  }

  function renderGameFocusScene(game, theme, system, performance, audio, network, env, introActive) {
    var gameName = text(game && game.name, "Game");
    var platform = text(game && game.platform, "Game");
    var detail = text(game && game.reason, text(game && game.source, "Running now"));
    var sessionDuration = gameFocusSessionDurationMs(game);
    var session = gameFocusSessionText(game);
    var sessionStartedAt = text(game && (game.sessionStartedAt || game.startedAt), "");
    var tileLabel = gameFocusTileLabel(game);
    var artUrl = text(game && (game.artworkUrl || game.iconUrl), "");
    var performanceData = normalizeGamePerformancePayload(performance || {});
    var mainFps = nullableNumber(performanceData.fps);
    var frameSource = mainFps == null ? text(performanceData.message, "Waiting for game frames") : performanceData.source;
    var adminAction = performanceData.canRestartAsAdmin
      ? '<button class="inline-button game-focus-admin" type="button" data-action="restart-game-admin">Restart as admin</button>'
      : '';
    var source = text(game && game.source, platform);
    var audioData = normalizeAudioPayload(audio || {});
    var audioOutput = gameFocusAudioOutput(audioData);
    var audioName = compactAudioName(audioOutput && audioOutput.name);
    var audioState = audioData.muted ? "Muted" : Math.round(audioData.masterVolume) + "%";
    var micState = gameFocusMicState(audioData);
    var audioSessions = gameFocusAudioSessions(audioData, game);
    var activeAudioSessions = audioSessions.length;
    var networkData = network || {};
    var networkSummary = gameFocusNetworkSummary(networkData);
    var ping = networkSummary.ping;
    var pingLabel = networkSummary.pingLabel;
    var pressure = gameFocusPressureValue(system || {});
    var pressureLabel = pressure == null ? "--" : Math.round(pressure) + "%";
    var pressureDetail = "GPU " + formatPercent(system && system.gpu) + " / CPU " + formatPercent(system && system.cpu);
    var shellClass = "game-focus-shell" + (introActive ? " is-intro" : "");
    return '' +
      '<section class="' + shellClass + '" style="' + gameModeThemeStyle(theme) + '">' +
        '<div class="game-focus-wake" aria-hidden="true">' +
          '<strong>' + escapeHtml(gameName) + '</strong>' +
        '</div>' +
        '<header class="game-focus-topbar">' +
          '<div class="game-focus-identity">' +
            '<strong>' + escapeHtml(gameName) + '</strong>' +
            '<small>' + escapeHtml(platform + " - " + source) + '</small>' +
          '</div>' +
          '<button class="inline-button game-focus-home" type="button" data-action="game-face-home">Home</button>' +
        '</header>' +
        '<main class="game-focus-board">' +
          '<section class="game-focus-context">' +
            '<div class="game-focus-card game-focus-card--art">' +
              '<div class="game-focus-emblem">' + (artUrl
                ? '<img src="' + escapeHtml(artUrl) + '" alt="' + escapeHtml(gameName) + '" loading="lazy">'
                : '<span>' + escapeHtml(tileLabel) + '</span>') + '</div>' +
            '</div>' +
            '<div class="game-focus-card game-focus-card--session' + (sessionDuration >= GAME_FOCUS_TOUCH_GRASS_MS ? " is-touch-grass" : "") + '">' +
              '<div class="game-focus-session">' +
                '<span>Session</span>' +
                '<strong data-game-session-clock data-started-at="' + escapeHtml(sessionStartedAt) + '" data-duration-ms="' + escapeHtml(String(sessionDuration || 0)) + '">' + escapeHtml(session) + '</strong>' +
              '</div>' +
            '</div>' +
          '</section>' +
          '<section class="game-focus-metrics">' +
            renderGameFocusHudItem("FPS", formatFps(mainFps), frameSource, gameFocusProgress(mainFps, 240), gameFocusLowTone(mainFps, 55, 30), "main-fps") +
            renderGameFocusHudItem("Audio", audioState, audioName, audioData.masterVolume, audioData.muted ? "warn" : "good", "audio") +
            renderGameFocusHudItem("Mic", micState.label, micState.detail, micState.progress, micState.tone, "mic") +
            renderGameFocusHudItem("Network", pingLabel, networkSummary.provider + " - " + networkSummary.detail, ping == null ? null : gameFocusProgress(80 - Math.min(ping, 80), 80), networkSummary.tone, "network") +
            renderGameFocusHudItem("Pressure", pressureLabel, pressureDetail, pressure, gameFocusLoadTone(pressure, 82, 94), "pressure") +
            renderGameFocusHudItem("GPU", formatPercent(system && system.gpu), system && system.gpuTemp != null ? formatTemp(system.gpuTemp) : "3D engine", system && system.gpu, gameFocusLoadTone(system && system.gpu, 88, 96), "gpu") +
            renderGameFocusHudItem("CPU", formatPercent(system && system.cpu), system && system.cpuTemp != null ? formatTemp(system.cpuTemp) : "System", system && system.cpu, gameFocusLoadTone(system && system.cpu, 82, 94), "cpu") +
            renderGameFocusHudItem("RAM", formatPercent(system && system.ram), "Memory", system && system.ram, gameFocusLoadTone(system && system.ram, 82, 92), "ram") +
          '</section>' +
          '<aside class="game-focus-card game-focus-card--utility">' +
            '<div class="game-focus-mic-panel' + gameFocusToneClass(micState.tone) + '">' +
              '<div>' +
                '<span>Mic</span>' +
                '<strong data-game-mic-state>' + escapeHtml(micState.label) + '</strong>' +
                '<small data-game-mic-detail>' + escapeHtml(micState.detail) + '</small>' +
              '</div>' +
              '<button class="inline-button game-focus-mic-toggle" type="button" data-action="game-mic-mute" aria-label="' + escapeHtml(micState.button) + '"' + (micState.available ? "" : " disabled") + '>' + escapeHtml(micState.button) + '</button>' +
            '</div>' +
            '<div class="game-focus-control-row">' +
              '<div class="game-focus-audio' + gameFocusToneClass(audioData.muted ? "warn" : "good") + '">' +
                '<span>Audio</span>' +
                '<strong>' + escapeHtml(audioState) + '</strong>' +
                '<small>' + escapeHtml(audioName) + '</small>' +
              '</div>' +
              '<button class="inline-button game-focus-mute" type="button" data-action="game-master-mute">' + (audioData.muted ? "Unmute" : "Mute") + '</button>' +
            '</div>' +
            '<div class="game-focus-audio-list">' + renderGameFocusAudioRows(audioSessions, game) + '</div>' +
            adminAction +
            '<div class="game-focus-reason">' + escapeHtml(gameFocusReasonText(detail, source, activeAudioSessions)) + '</div>' +
          '</aside>' +
        '</main>' +
      '</section>';
  }

  function setGameFocusToneClass(node, baseClass, tone) {
    if (node) {
      node.className = baseClass + gameFocusToneClass(tone);
    }
  }

  function setGameFocusText(root, selector, value) {
    var node = root && root.querySelector ? root.querySelector(selector) : null;
    if (node) {
      node.textContent = value;
    }
  }

  function patchGameFocusMetric(container, metricId, value, detail, progress, tone) {
    var node = container.querySelector('[data-game-focus-metric="' + metricId + '"]');
    var progressNode;
    var progressValue = optionalNumber(progress);
    if (!node) {
      return;
    }

    setGameFocusToneClass(node, "game-focus-metric", tone);
    setGameFocusText(node, "[data-game-focus-value]", value);
    setGameFocusText(node, "[data-game-focus-detail]", detail || "");
    progressNode = node.querySelector("[data-game-focus-progress]");
    if (!progressNode) {
      return;
    }

    if (progressValue == null) {
      progressNode.hidden = true;
      progressNode.style.removeProperty("--metric-fill");
      return;
    }

    progressNode.hidden = false;
    progressNode.style.setProperty("--metric-fill", clamp(progressValue, 0, 100) + "%");
  }

  function patchGameFocusScene(container, game, theme, system, performance, audio, network, env, introActive) {
    var shell = container.querySelector(".game-focus-shell");
    var gameName = text(game && game.name, "Game");
    var platform = text(game && game.platform, "Game");
    var source = text(game && game.source, platform);
    var detail = text(game && game.reason, text(game && game.source, "Running now"));
    var performanceData = normalizeGamePerformancePayload(performance || {});
    var mainFps = nullableNumber(performanceData.fps);
    var frameSource = mainFps == null ? text(performanceData.message, "Waiting for game frames") : performanceData.source;
    var audioData = normalizeAudioPayload(audio || {});
    var audioOutput = gameFocusAudioOutput(audioData);
    var audioName = compactAudioName(audioOutput && audioOutput.name);
    var audioState = audioData.muted ? "Muted" : Math.round(audioData.masterVolume) + "%";
    var micState = gameFocusMicState(audioData);
    var audioSessions = gameFocusAudioSessions(audioData, game);
    var activeAudioSessions = audioSessions.length;
    var networkSummary = gameFocusNetworkSummary(network || {});
    var ping = networkSummary.ping;
    var pressure = gameFocusPressureValue(system || {});
    var pressureLabel = pressure == null ? "--" : Math.round(pressure) + "%";
    var pressureDetail = "GPU " + formatPercent(system && system.gpu) + " / CPU " + formatPercent(system && system.cpu);

    if (shell) {
      shell.classList.toggle("is-intro", Boolean(introActive));
      shell.setAttribute("style", gameModeThemeStyle(theme));
    }

    setGameFocusText(container, ".game-focus-wake strong", gameName);
    setGameFocusText(container, ".game-focus-identity strong", gameName);
    setGameFocusText(container, ".game-focus-identity small", platform + " - " + source);
    patchGameFocusMetric(container, "main-fps", formatFps(mainFps), frameSource, gameFocusProgress(mainFps, 240), gameFocusLowTone(mainFps, 55, 30));
    patchGameFocusMetric(container, "audio", audioState, audioName, audioData.masterVolume, audioData.muted ? "warn" : "good");
    patchGameFocusMetric(container, "mic", micState.label, micState.detail, micState.progress, micState.tone);
    patchGameFocusMetric(container, "network", networkSummary.pingLabel, networkSummary.provider + " - " + networkSummary.detail, ping == null ? null : gameFocusProgress(80 - Math.min(ping, 80), 80), networkSummary.tone);
    patchGameFocusMetric(container, "pressure", pressureLabel, pressureDetail, pressure, gameFocusLoadTone(pressure, 82, 94));
    patchGameFocusMetric(container, "gpu", formatPercent(system && system.gpu), system && system.gpuTemp != null ? formatTemp(system.gpuTemp) : "3D engine", system && system.gpu, gameFocusLoadTone(system && system.gpu, 88, 96));
    patchGameFocusMetric(container, "cpu", formatPercent(system && system.cpu), system && system.cpuTemp != null ? formatTemp(system.cpuTemp) : "System", system && system.cpu, gameFocusLoadTone(system && system.cpu, 82, 94));
    patchGameFocusMetric(container, "ram", formatPercent(system && system.ram), "Memory", system && system.ram, gameFocusLoadTone(system && system.ram, 82, 92));
    setGameFocusToneClass(container.querySelector(".game-focus-audio"), "game-focus-audio", audioData.muted ? "warn" : "good");
    setGameFocusText(container, ".game-focus-audio strong", audioState);
    setGameFocusText(container, ".game-focus-audio small", audioName);
    setGameFocusText(container, ".game-focus-mute", audioData.muted ? "Unmute" : "Mute");
    setGameFocusToneClass(container.querySelector(".game-focus-mic-panel"), "game-focus-mic-panel", micState.tone);
    setGameFocusText(container, "[data-game-mic-state]", micState.label);
    setGameFocusText(container, "[data-game-mic-detail]", micState.detail);
    setGameFocusText(container, ".game-focus-mic-toggle", micState.button);
    var micButton = container.querySelector(".game-focus-mic-toggle");
    if (micButton) {
      micButton.disabled = !micState.available;
      micButton.setAttribute("aria-label", micState.button);
    }

    var audioList = container.querySelector(".game-focus-audio-list");
    if (audioList) {
      audioList.innerHTML = renderGameFocusAudioRows(audioSessions, game);
    }

    var adminButton = container.querySelector(".game-focus-admin");
    var reasonNode = container.querySelector(".game-focus-reason");
    if (performanceData.canRestartAsAdmin && !adminButton && reasonNode) {
      reasonNode.insertAdjacentHTML("beforebegin", '<button class="inline-button game-focus-admin" type="button" data-action="restart-game-admin">Restart as admin</button>');
    } else if (!performanceData.canRestartAsAdmin && adminButton) {
      adminButton.remove();
    }

    setGameFocusText(container, ".game-focus-reason", gameFocusReasonText(detail, source, activeAudioSessions));
  }

  function renderGameModeProfilePanel(savedGame, game, profile, theme, steam, env) {
    var steamCount = steam && Array.isArray(steam.games) ? steam.games.length : 0;
    var activeGame = steam && steam.activeGame ? steam.activeGame : null;
    var gameName = activeGame ? activeGame.name : text(savedGame, game);
    var detail = activeGame
      ? "Running now. Theme applied automatically."
      : steamCount ? steamCount + " Steam games found" : "Steam scan ready";
    return '' +
      '<article class="product-control-panel game-mode-profile-panel" style="' + gameModeThemeStyle(theme) + '">' +
        '<div class="game-mode-profile-hero">' +
          '<div class="game-mode-profile-title">' +
            '<div class="metric-label">Active game</div>' +
            '<strong>' + escapeHtml(gameName) + '</strong>' +
            '<span>' + escapeHtml(detail) + '</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderGameModeEndedPanel(activity) {
    var lastGame = activity && activity.lastGame ? activity.lastGame : null;
    if (!lastGame) {
      return "";
    }

    return '' +
      '<article class="product-control-panel game-mode-ended-panel">' +
        '<div>' +
          '<div class="metric-label">Session ended</div>' +
          '<strong>' + escapeHtml(text(lastGame.name, "Game")) + '</strong>' +
          '<span>' + escapeHtml(text(lastGame.platform, "Game") + " - " + text(activity.message, "Game closed.")) + '</span>' +
        '</div>' +
        '<div class="game-mode-ended-stats">' +
          '<div><span>Duration</span><strong>' + escapeHtml(formatDurationMs(lastGame.sessionDurationMs)) + '</strong></div>' +
          '<div><span>Ended</span><strong>' + escapeHtml(formatAge(activity.lastEndedAt)) + '</strong></div>' +
        '</div>' +
      '</article>';
  }

  function renderGameModeCandidatesPanel(activity) {
    var candidates = activity && Array.isArray(activity.candidates) ? activity.candidates : [];
    var visible = candidates.filter(function (candidate) {
      return candidate && candidate.confidence < 60 && candidate.canPin;
    }).slice(0, 3);
    if (!visible.length) {
      return "";
    }

    return '' +
      '<article class="product-control-panel game-mode-candidates-panel">' +
        '<div class="game-mode-candidates-head">' +
          '<div>' +
            '<div class="metric-label">Running app candidates</div>' +
            '<strong>Teach Game Mode</strong>' +
            '<span>Pin one if it should trigger the in-game layout next time.</span>' +
          '</div>' +
          statusPill(String(visible.length) + " found", "warn") +
        '</div>' +
        '<div class="game-mode-candidate-list">' + visible.map(function (candidate) {
          return '' +
            '<div class="game-mode-candidate-row">' +
              '<div>' +
                '<strong>' + escapeHtml(text(candidate.name, "Running app")) + '</strong>' +
                '<span>' + escapeHtml(text(candidate.platform, "Candidate") + " - " + text(candidate.reason, "Candidate")) + '</span>' +
              '</div>' +
              '<button class="inline-button" type="button" data-action="game-pin-candidate" data-candidate-id="' + escapeHtml(text(candidate.id, "")) + '">Treat as game</button>' +
            '</div>';
        }).join("") + '</div>' +
      '</article>';
  }

  function mountGameModeWidget(widget, container, env) {
    var cleanups = [];
    var state = {
      system: {},
      audio: normalizeAudioPayload({}),
      network: {},
      steam: normalizeSteamGamesPayload({}),
      activity: normalizeGameActivityPayload(env.gameActivity || {}),
      performance: normalizeGamePerformancePayload(env.gamePerformance || {}),
      statusText: "Loading",
      statusTone: "warn",
      steamStatusText: "Scanning",
      steamStatusTone: "warn",
      steamLaunchingId: "",
      longPressAppId: "",
      lastAutoThemeGameId: "",
      focusActiveGameId: "",
      focusIntroGameId: "",
      performanceRestarting: false,
      collectorTimings: [],
      interacting: false
    };
    var suppressNextSteamLaunchId = "";
    var longPressTimerId = 0;
    var focusIntroTimerId = 0;
    var sessionClockTimerId = 0;
    var longPressStartX = 0;
    var longPressStartY = 0;
    var longPressAppId = "";

    function displayRefreshRate(display) {
      return nullableNumber(display && (display.refreshRate != null ? display.refreshRate : display.fps));
    }

    function fpsProgress(value, ceiling) {
      var parsed = nullableNumber(value);
      return parsed == null ? null : clamp((parsed / (ceiling || 240)) * 100, 0, 100);
    }

    function renderTelemetryReadiness(performance) {
      var readiness = text(performance.readiness, performance.status);
      var needsAdmin = Boolean(performance.needsAdmin);
      var tone = needsAdmin ? "warn" : readiness === "live" ? "good" : readiness === "starting" ? "warn" : "muted";
      var action = performance.canRestartAsAdmin
        ? '<button class="inline-button is-primary" type="button" data-action="restart-game-admin">' + (state.performanceRestarting ? "Restarting" : "Restart as admin") + '</button>'
        : '';
      return '' +
        '<article class="list-card inline-card game-mode-telemetry-card" data-tone="' + escapeHtml(tone) + '">' +
          '<div class="inline-card-header">' +
            '<div><div class="metric-label">Telemetry readiness</div><div class="router-inline-copy">' + escapeHtml(text(performance.message, "Start a game to capture main-display FPS.")) + '</div></div>' +
            statusPill(needsAdmin ? "Needs admin" : readiness === "live" ? "Live" : text(performance.status, "Ready"), tone) +
          '</div>' +
          '<div class="game-mode-telemetry-grid">' +
            '<div><span>FPS source</span><strong>' + escapeHtml(text(performance.fpsSource, performance.source)) + '</strong></div>' +
            '<div><span>Presented FPS</span><strong>' + escapeHtml(formatFps(performance.fps)) + '</strong></div>' +
            '<div><span>Frame time</span><strong>' + escapeHtml(formatMs(performance.frameTimeMs)) + '</strong></div>' +
          '</div>' +
          (action ? '<div class="inline-actions game-mode-telemetry-actions">' + action + '</div>' : '') +
        '</article>';
    }

    function clearFocusIntroTimer() {
      if (focusIntroTimerId) {
        window.clearTimeout(focusIntroTimerId);
        focusIntroTimerId = 0;
      }
    }

    function syncGameFocusIntro(activeGame) {
      var activeId = gameActivityId(activeGame);
      if (!activeId) {
        state.focusActiveGameId = "";
        state.focusIntroGameId = "";
        clearFocusIntroTimer();
        return;
      }

      if (state.focusActiveGameId === activeId) {
        return;
      }

      state.focusActiveGameId = activeId;
      state.focusIntroGameId = activeId;
      clearFocusIntroTimer();
      focusIntroTimerId = window.setTimeout(function () {
        if (state.focusIntroGameId === activeId) {
          state.focusIntroGameId = "";
          redraw();
        }
      }, 2300);
    }

    function updateGameSessionClock() {
      var nodes = container.querySelectorAll("[data-game-session-clock]");
      Array.prototype.forEach.call(nodes, function (node) {
        var startedAt = node.getAttribute("data-started-at") || "";
        var durationMs = optionalNumber(node.getAttribute("data-duration-ms")) || 0;
        var startedTime = startedAt ? new Date(startedAt).getTime() : NaN;
        var sessionCard = node.closest ? node.closest(".game-focus-card--session") : null;
        if (Number.isFinite(startedTime) && startedTime > 0) {
          durationMs = Math.max(0, Date.now() - startedTime);
        }
        node.textContent = gameFocusSessionDisplay(durationMs);
        if (sessionCard) {
          sessionCard.classList.toggle("is-touch-grass", durationMs >= GAME_FOCUS_TOUCH_GRASS_MS);
        }
      });
    }

    function startGameSessionClock() {
      updateGameSessionClock();
      if (sessionClockTimerId) {
        return;
      }

      sessionClockTimerId = window.setInterval(updateGameSessionClock, 1000);
    }

    function stopGameSessionClock() {
      if (sessionClockTimerId) {
        window.clearInterval(sessionClockTimerId);
        sessionClockTimerId = 0;
      }
    }

    function redraw() {
      var savedGame = settingValue(env, "gameModeGame", "");
      var profile = activeGameModeProfile(env);
      var activeSteamGame = state.steam && state.steam.activeGame ? state.steam.activeGame : null;
      var activeGame = state.activity && state.activity.activeGame ? state.activity.activeGame : steamGameAsActivity(activeSteamGame);
      var profileTheme = activeGame ? themeForGame(activeGame, env) : gameModeProfileTheme(profile, env);
      var game = gameModeProfileName(profile, savedGame);
      var system = state.system || {};
      var activeGameId = gameActivityId(activeGame);
      var focusRenderId = activeGameId || text(activeGame && activeGame.name, "active-game");
      var introActive;
      var idleStatusPanels = renderGameModeEndedPanel(state.activity) + renderGameModeCandidatesPanel(state.activity);
      syncGameFocusIntro(activeGame);
      introActive = Boolean(activeGameId && state.focusIntroGameId === activeGameId);

      if (activeGame) {
        if (container.getAttribute("data-game-focus-active-id") === focusRenderId
          && container.querySelector(".game-focus-shell")) {
          patchGameFocusScene(container, activeGame, profileTheme, system, state.performance, state.audio, state.network, env, introActive);
          container.setAttribute("data-game-focus-intro", introActive ? "1" : "0");
        } else {
          container.innerHTML = renderGameFocusScene(
            activeGame,
            profileTheme,
            system,
            state.performance,
            state.audio,
            state.network,
            env,
            introActive
          );
          container.setAttribute("data-game-focus-active-id", focusRenderId);
          container.setAttribute("data-game-focus-intro", introActive ? "1" : "0");
        }
        startGameSessionClock();
        return;
      }

      stopGameSessionClock();
      container.removeAttribute("data-game-focus-active-id");
      container.removeAttribute("data-game-focus-intro");
      container.innerHTML = productShell(
        "Launch mode",
        "Game Mode",
        "Launch a game, then the EDGE switches into a focused play cockpit automatically.",
        state.activity && state.activity.stateLabel ? state.activity.stateLabel : state.statusText,
        state.activity && state.activity.mode === "ended" ? "warn" : state.statusTone,
        '<div class="game-mode-idle-grid">' +
          '<section class="game-mode-idle-top">' +
            '<div class="inline-grid inline-grid--4 game-mode-performance">' +
              metricCard("FPS", formatFps(state.performance.fps), text(state.performance.message, "Starts when a game is active"), fpsProgress(state.performance.fps, 240), "game-mode-metric--primary") +
              metricCard("GPU", formatPercent(system.gpu), system.gpuTemp != null ? formatTemp(system.gpuTemp) : "3D engine", system.gpu) +
              metricCard("CPU", formatPercent(system.cpu), system.cpuTemp != null ? formatTemp(system.cpuTemp) : "System load", system.cpu) +
              metricCard("RAM", formatPercent(system.ram), "Memory", system.ram) +
            '</div>' +
          '</section>' +
          '<section class="game-mode-idle-telemetry">' +
            renderTelemetryReadiness(state.performance) +
          '</section>' +
          (idleStatusPanels ? '<section class="game-mode-idle-notices">' + idleStatusPanels + '</section>' : '') +
          '<section class="game-mode-idle-launch">' +
            renderGameModeSteamPad(state.steam, state.steamStatusText, state.steamStatusTone, state.steamLaunchingId, state.longPressAppId, env) +
          '</section>' +
        '</div>'
      );
    }

    function refreshGameModeSession(options) {
      options = options || {};
      return requestJson(buildBridgeUrl(env, "/api/game/session"), {
        method: "POST",
        body: {
          refresh: Boolean(options.refresh),
          steamRefresh: Boolean(options.steamRefresh),
          activityRefresh: Boolean(options.activityRefresh),
          performanceSession: options.performanceSession !== false
        }
      }, 8000).then(function (payload) {
        var session = normalizeGameModeSessionPayload(payload);
        state.system = session.system;
        state.audio = session.audio;
        state.network = session.network;
        state.steam = session.steam;
        state.activity = session.activity;
        state.performance = session.performance;
        state.collectorTimings = session.collectorTimings;
        state.statusText = statusTextFromPayload(payload, session.status === "budget-warning" ? "Budget warning" : "Live");
        state.statusTone = session.status === "budget-warning" ? "warn" : statusToneFromPayload(payload, "live");
        state.steamStatusText = statusTextFromPayload(payload && payload.steam, state.steam.games.length ? "Ready" : "Setup");
        state.steamStatusTone = statusToneFromPayload(payload && payload.steam, state.steam.status);
        if (state.steam.activeGame && state.steam.activeGame.appId) {
          applyDetectedGameTheme(steamGameAsActivity(state.steam.activeGame));
        }
        if (state.activity.activeGame) {
          applyDetectedGameTheme(state.activity.activeGame);
        }
        if (!state.interacting) {
          redraw();
        }
      }, function (error) {
        state.statusText = error.message || "Unavailable";
        state.statusTone = "danger";
        state.steamStatusText = error.message || "Unavailable";
        state.steamStatusTone = "danger";
        if (!state.interacting) {
          redraw();
        }
      });
    }

    function applyGameTheme(game) {
      var theme = themeForGame(game, env);
      var dashboard = env.bridgeConfig && env.bridgeConfig.dashboard ? env.bridgeConfig.dashboard : {};
      var autoTune = settingValue(env, "gameModeAutoTune", dashboard.gameModeAutoTune === false ? "0" : "1") !== "0";
      var values = {
        gameModeProfile: theme.profileId,
        gameModeGame: theme.gameName,
        gameModeThemeId: theme.themeId,
        gameModeAccent: theme.accent,
        gameModeSecondary: theme.secondary,
        gameModeMood: theme.mood
      };

      if (autoTune) {
        values.performanceBudget = "game";
      }

      saveSettings(env, values);
    }

    function applyDetectedGameTheme(game) {
      var id = gameActivityId(game);
      if (!id || state.lastAutoThemeGameId === id) {
        return;
      }

      state.lastAutoThemeGameId = id;
      applyGameTheme(game);
    }

    function getSteamGame(appId) {
      return (state.steam.games || []).filter(function (entry) {
        return entry.appId === appId;
      })[0] || null;
    }

    function applySteamGameLook(appId, announce) {
      var game = getSteamGame(appId);
      if (!game) {
        return;
      }

      applyGameTheme(steamGameAsActivity(game));
      state.longPressAppId = game.appId;
      state.steamStatusText = "Theme applied";
      state.steamStatusTone = "good";
      if (announce) {
        emitTouchFeedback(env, "Game look applied");
      }
      redraw();
    }

    function launchSteamGame(appId) {
      var game = getSteamGame(appId);

      if (!game || state.steamLaunchingId) {
        return;
      }

      state.steamLaunchingId = game.appId;
      state.longPressAppId = "";
      state.steamStatusText = "Launching";
      state.steamStatusTone = "warn";
      redraw();

      requestJson(buildBridgeUrl(env, "/api/steam/games/launch"), {
        method: "POST",
        body: {
          appId: game.appId
        }
      }, 8000).then(function (payload) {
        applyGameTheme(steamGameAsActivity(game));
        state.steamLaunchingId = "";
        state.steamStatusText = text(payload.message, "Launched");
        state.steamStatusTone = "good";
        emitTouchFeedback(env, "Launching " + game.name);
        redraw();
        refreshGameModeSession({ activityRefresh: true, performanceSession: true });
      }, function (error) {
        state.steamLaunchingId = "";
        state.steamStatusText = error.message || "Launch failed";
        state.steamStatusTone = "danger";
        redraw();
      });
    }

    function toggleGameMasterMute() {
      requestJson(buildBridgeUrl(env, "/api/audio/master-mute"), {
        method: "POST",
        body: {
          muted: !state.audio.muted
        }
      }, 5000).then(function () {
        refreshGameModeSession({ performanceSession: true });
      }, function () {
        refreshGameModeSession({ performanceSession: true });
      });
    }

    function toggleGameMicMute() {
      if (!state.audio.defaultInputDeviceId) {
        return;
      }

      requestJson(buildBridgeUrl(env, "/api/audio/input-mute"), {
        method: "POST",
        body: {
          muted: state.audio.inputMuted !== true
        }
      }, 5000).then(function () {
        refreshGameModeSession({ performanceSession: true });
      }, function () {
        refreshGameModeSession({ performanceSession: true });
      });
    }

    function toggleGameSessionMute(sessionId) {
      var session = state.audio.sessions.filter(function (entry) {
        return entry.id === sessionId;
      })[0];
      if (!session) {
        return;
      }

      requestJson(buildBridgeUrl(env, "/api/audio/session-mute"), {
        method: "POST",
        body: {
          sessionId: sessionId,
          muted: !session.muted
        }
      }, 5000).then(function () {
        refreshGameModeSession({ performanceSession: true });
      }, function () {
        refreshGameModeSession({ performanceSession: true });
      });
    }

    function pinGameCandidate(target) {
      requestJson(buildBridgeUrl(env, "/api/game/activity/pin"), {
        method: "POST",
        body: {
          id: String(target.getAttribute("data-candidate-id") || "")
        }
      }, 6000).then(function (payload) {
        state.statusText = text(payload && payload.message, "Game pinned");
        state.statusTone = "good";
        return refreshGameModeSession({ refresh: true, activityRefresh: true, performanceSession: true });
      }, function (error) {
        state.statusText = error.message || "Pin failed";
        state.statusTone = "danger";
        redraw();
      });
    }

    function restartHostAsAdmin() {
      if (state.performanceRestarting || !(state.performance && state.performance.canRestartAsAdmin)) {
        return;
      }

      state.performanceRestarting = true;
      redraw();
      requestJson(buildBridgeUrl(env, state.performance.restartAsAdminEndpoint || "/api/system/restart-admin"), {
        method: "POST",
        body: {}
      }, 5000).then(function (payload) {
        state.performance.message = text(payload && payload.message, "Restarting Xenon as administrator.");
        redraw();
      }, function (error) {
        state.performanceRestarting = false;
        state.performance.message = error.message || "Elevated restart failed.";
        redraw();
      });
    }

    function clearSteamLongPress() {
      if (longPressTimerId) {
        window.clearTimeout(longPressTimerId);
        longPressTimerId = 0;
      }
      longPressAppId = "";
    }

    addListener(cleanups, container, "pointerdown", function (event) {
      var tile = event.target && event.target.closest ? event.target.closest(".game-mode-steam-tile") : null;
      if (!tile || state.steamLaunchingId) {
        return;
      }

      clearSteamLongPress();
      longPressAppId = String(tile.getAttribute("data-app-id") || "");
      longPressStartX = event.clientX;
      longPressStartY = event.clientY;
      state.interacting = true;
      longPressTimerId = window.setTimeout(function () {
        var appId = longPressAppId;
        clearSteamLongPress();
        if (!appId || state.steamLaunchingId) {
          return;
        }
        suppressNextSteamLaunchId = appId;
        state.interacting = false;
        applySteamGameLook(appId, true);
        window.setTimeout(function () {
          if (suppressNextSteamLaunchId === appId) {
            suppressNextSteamLaunchId = "";
          }
        }, 700);
      }, 560);
    }, { passive: true });

    addListener(cleanups, container, "pointermove", function (event) {
      if (!longPressTimerId) {
        return;
      }

      if (Math.abs(event.clientX - longPressStartX) > 14 || Math.abs(event.clientY - longPressStartY) > 14) {
        clearSteamLongPress();
      }
    }, { passive: true });

    addListener(cleanups, container, "pointerup", function () {
      state.interacting = false;
      clearSteamLongPress();
    }, { passive: true });

    addListener(cleanups, container, "pointercancel", function () {
      state.interacting = false;
      clearSteamLongPress();
    }, { passive: true });

    addListener(cleanups, container, "click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      var action = target ? target.getAttribute("data-action") : "";
      if (!target) {
        return;
      }

      if (action === "steam-refresh" && !state.steamLaunchingId) {
        state.steamStatusText = "Scanning";
        state.steamStatusTone = "warn";
        redraw();
        refreshGameModeSession({ refresh: true, steamRefresh: true, activityRefresh: true, performanceSession: true });
      } else if (action === "game-face-home") {
        if (env && typeof env.returnHomeFromGameFace === "function") {
          env.returnHomeFromGameFace();
        } else if (env && typeof env.selectWidget === "function") {
          env.selectWidget(env.gameFaceHomeWidget || "system", true);
        }
      } else if (action === "game-master-mute") {
        toggleGameMasterMute();
      } else if (action === "game-mic-mute") {
        toggleGameMicMute();
      } else if (action === "game-session-mute") {
        toggleGameSessionMute(String(target.getAttribute("data-session-id") || ""));
      } else if (action === "game-pin-candidate") {
        pinGameCandidate(target);
      } else if (action === "restart-game-admin") {
        restartHostAsAdmin();
      } else if (action === "steam-theme") {
        applySteamGameLook(String(target.getAttribute("data-app-id") || ""), true);
      } else if (action === "steam-launch") {
        var appId = String(target.getAttribute("data-app-id") || "");
        if (suppressNextSteamLaunchId === appId) {
          suppressNextSteamLaunchId = "";
          return;
        }
        launchSteamGame(appId);
      }
    });

    var gameModeLoop = createTimerLoop(function () {
      return refreshGameModeSession({ performanceSession: true });
    }, 2500, function () {
      return state.interacting;
    });
    redraw();
    gameModeLoop.start();
    return {
      refresh: function () {
        return gameModeLoop.refresh();
      },
      destroy: function () {
        clearSteamLongPress();
        gameModeLoop.destroy();
        stopGameSessionClock();
        clearFocusIntroTimer();
        runCleanups(cleanups);
        container.innerHTML = "";
      }
    };
  }


  runtime.registerRenderer("game-mode", mountGameModeWidget);
}());
