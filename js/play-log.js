// A small record of what was played and for how long, kept on this device.
// It holds a game's key and name and minutes per day. Never a path.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.AuxoraPlayLog = api;
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var STORAGE_KEY = "auxora-play-log-v1";
  var MAX_GAMES = 40;
  var MAX_DAYS = 60;
  // Time is only counted while the dashboard keeps seeing the game. A longer
  // silence means it was closed or asleep, and that stretch is not play time.
  var MAX_GAP_MS = 120000;
  var DAY_MS = 86400000;

  function dayId(ms) {
    var date = new Date(ms);
    function two(value) { return (value < 10 ? "0" : "") + value; }
    return date.getFullYear() + "-" + two(date.getMonth() + 1) + "-" + two(date.getDate());
  }

  function fresh() {
    return { version: 1, games: {}, current: null };
  }

  function whole(value, max) {
    return typeof value === "number" && isFinite(value) && value > 0 ? Math.min(max, Math.floor(value)) : 0;
  }

  function cleanText(value, max) {
    return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : "";
  }

  // Whatever was stored, return a well-formed log. Unknown or broken parts are dropped.
  function validate(value) {
    var log = fresh();
    if (!value || typeof value !== "object" || !value.games || typeof value.games !== "object") {
      return log;
    }
    Object.keys(value.games).slice(0, MAX_GAMES).forEach(function (key) {
      var source = value.games[key];
      var cleanKey = cleanText(key, 96);
      if (!cleanKey || !source || typeof source !== "object") {
        return;
      }
      var days = {};
      var sourceDays = source.days && typeof source.days === "object" ? source.days : {};
      Object.keys(sourceDays).filter(function (id) { return /^\d{4}-\d{2}-\d{2}$/.test(id); }).sort().slice(-MAX_DAYS).forEach(function (id) {
        var day = sourceDays[id] || {};
        days[id] = { ms: whole(day.ms, DAY_MS), sessions: whole(day.sessions, 500) };
      });
      log.games[cleanKey] = {
        name: cleanText(source.name, 80) || "Game",
        totalMs: whole(source.totalMs, 100 * 365 * DAY_MS),
        sessions: whole(source.sessions, 1000000),
        lastPlayed: whole(source.lastPlayed, 8640000000000000),
        days: days
      };
    });
    var current = value.current;
    if (current && typeof current === "object" && log.games[cleanText(current.key, 96)]) {
      log.current = {
        key: cleanText(current.key, 96),
        startedAt: whole(current.startedAt, 8640000000000000),
        lastSeenAt: whole(current.lastSeenAt, 8640000000000000),
        playedMs: whole(current.playedMs, 100 * DAY_MS)
      };
    }
    return log;
  }

  function dayOf(game, id) {
    if (!game.days[id]) {
      game.days[id] = { ms: 0, sessions: 0 };
      var ids = Object.keys(game.days).sort();
      while (ids.length > MAX_DAYS) {
        delete game.days[ids.shift()];
      }
    }
    return game.days[id];
  }

  // Count the time since the game was last seen, unless the gap is too long to be play.
  function touch(log, now) {
    var current = log.current;
    var game = current && log.games[current.key];
    if (!game) {
      log.current = null;
      return log;
    }
    var elapsed = now - current.lastSeenAt;
    if (elapsed > 0 && elapsed <= MAX_GAP_MS) {
      game.totalMs += elapsed;
      current.playedMs += elapsed;
      dayOf(game, dayId(now)).ms += elapsed;
    }
    current.lastSeenAt = now;
    game.lastPlayed = now;
    return log;
  }

  function end(log, now) {
    touch(log, now);
    log.current = null;
    return log;
  }

  // A game is running. Starts a session if this game is not the one already being counted.
  // Returns true when a new session began.
  function seen(log, game, now) {
    var key = cleanText(game && game.key, 96);
    if (!key) {
      return false;
    }
    if (log.current && log.current.key === key && now - log.current.lastSeenAt <= MAX_GAP_MS) {
      touch(log, now);
      return false;
    }
    if (log.current) {
      // Another game took over, or this one came back after a silence: close the old session.
      if (now - log.current.lastSeenAt <= MAX_GAP_MS) {
        touch(log, now);
      }
      log.current = null;
    }
    if (!log.games[key]) {
      var keys = Object.keys(log.games);
      if (keys.length >= MAX_GAMES) {
        // Make room by forgetting the game played longest ago.
        keys.sort(function (left, right) { return log.games[left].lastPlayed - log.games[right].lastPlayed; });
        delete log.games[keys[0]];
      }
      log.games[key] = { name: "Game", totalMs: 0, sessions: 0, lastPlayed: 0, days: {} };
    }
    var entry = log.games[key];
    entry.name = cleanText(game.name, 80) || entry.name;
    entry.sessions += 1;
    entry.lastPlayed = now;
    dayOf(entry, dayId(now)).sessions += 1;
    log.current = { key: key, startedAt: now, lastSeenAt: now, playedMs: 0 };
    return true;
  }

  // The numbers shown for a game: this session, today, the last seven days, all time.
  function summary(log, key, now) {
    var game = log.games[key];
    if (!game) {
      return null;
    }
    var today = dayId(now);
    var weekSessions = 0;
    var streak = 0;
    var index;
    for (index = 0; index < 7; index += 1) {
      var day = game.days[dayId(now - index * DAY_MS)];
      weekSessions += day ? day.sessions : 0;
    }
    // Days in a row with a session, ending today, or yesterday if today has none yet.
    var offset = game.days[today] && game.days[today].sessions ? 0 : 1;
    while (streak < MAX_DAYS) {
      var streakDay = game.days[dayId(now - (streak + offset) * DAY_MS)];
      if (!streakDay || !streakDay.sessions) {
        break;
      }
      streak += 1;
    }
    var current = log.current && log.current.key === key ? log.current : null;
    return {
      name: game.name,
      sessionMs: current ? current.playedMs + Math.max(0, Math.min(MAX_GAP_MS, now - current.lastSeenAt)) : 0,
      todayMs: game.days[today] ? game.days[today].ms : 0,
      totalMs: game.totalMs,
      sessions: game.sessions,
      weekSessions: weekSessions,
      streakDays: streak,
      lastPlayed: game.lastPlayed,
      firstSession: game.sessions <= 1 && game.totalMs < 60000
    };
  }

  // "42 min", "1 h 5 min", "12 h". Under a minute is "under a minute".
  function formatDuration(ms) {
    var minutes = Math.floor(whole(ms, 1e15) / 60000);
    if (minutes < 1) {
      return "under a minute";
    }
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    if (!hours) {
      return minutes + " min";
    }
    return hours + " h" + (rest && hours < 10 ? " " + rest + " min" : "");
  }

  // A running clock for the current session: "0:42:10".
  function formatClock(ms) {
    var seconds = Math.floor(whole(ms, 1e15) / 1000);
    function two(value) { return (value < 10 ? "0" : "") + value; }
    return Math.floor(seconds / 3600) + ":" + two(Math.floor(seconds / 60) % 60) + ":" + two(seconds % 60);
  }

  // One line about the player's history with this game, for the welcome.
  function historyLine(stats) {
    if (!stats || stats.firstSession) {
      return "First session here. Have a good one.";
    }
    var parts = [];
    parts.push(stats.weekSessions > 1 ? "Session " + stats.weekSessions + " this week" : "First session this week");
    if (stats.totalMs >= 60000) {
      parts.push(formatDuration(stats.totalMs) + " played");
    }
    if (stats.streakDays >= 2) {
      parts.push(stats.streakDays + "-day streak");
    }
    return parts.join(" · ");
  }

  function load(storage) {
    try {
      return validate(JSON.parse(storage.getItem(STORAGE_KEY) || "null"));
    } catch (error) {
      return fresh();
    }
  }

  function save(storage, log) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(log));
      return true;
    } catch (error) {
      return false;
    }
  }

  return {
    STORAGE_KEY: STORAGE_KEY, MAX_GAP_MS: MAX_GAP_MS,
    fresh: fresh, validate: validate, seen: seen, touch: touch, end: end, summary: summary,
    formatDuration: formatDuration, formatClock: formatClock, historyLine: historyLine, dayId: dayId,
    load: load, save: save
  };
});
