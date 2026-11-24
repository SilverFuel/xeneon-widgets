// What to show about Claude Code sessions on this PC: which one matters most right now and
// the few words for it. The host keeps the sessions (from Claude Code's own hooks); this
// only chooses and words. No timers and no page access here, so it can be tested on its own.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.AuxoraClaudeWatch = api;
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var STATES = { waiting: "Claude needs you", error: "Claude stopped", working: "Claude working", done: "Claude finished" };
  // A session that says it is working but has reported nothing for half an hour was most likely
  // closed without saying so. A finished one stays up for ten minutes.
  var QUIET_WORKING_SECONDS = 30 * 60;
  var FINISHED_SHOWN_SECONDS = 10 * 60;
  // Claude Code reports after each step, so five minutes with nothing means one long step
  // (a build, a long think) or something it could not report. Worth a glance, not an alarm.
  var QUIET_SECONDS = 5 * 60;

  function text(value, max) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }

  function seconds(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  // The host's reply as a clean list. Anything that is not a session it knows how to show is dropped.
  function sessions(payload) {
    var list = payload && Array.isArray(payload.sessions) ? payload.sessions : [];
    return list.filter(function (item) {
      return item && typeof item === "object" && Object.prototype.hasOwnProperty.call(STATES, item.state);
    }).slice(0, 12).map(function (item) {
      return {
        id: text(item.id, 16), project: text(item.project, 48) || "a session", state: item.state,
        text: text(item.text, 200), stateSeconds: seconds(item.stateSeconds), idleSeconds: seconds(item.idleSeconds)
      };
    });
  }

  function keyOf(session) {
    return session.state + "|" + session.id + "|" + session.text;
  }

  function elapsed(value) {
    var total = seconds(value);
    if (total < 60) return "just now";
    var minutes = Math.floor(total / 60);
    if (minutes < 60) return minutes + " min";
    return Math.floor(minutes / 60) + " h " + (minutes % 60) + " min";
  }

  // The one thing to show, or null for nothing. A decision someone is waiting on comes first
  // (the longest wait first), then a session that stopped on an error, then one that is
  // working, then one that just finished. `seenKey` is the key of the view the person last
  // tapped: a wait that was seen stops flashing, a finished or stopped one is put away.
  function view(payload, seenKey) {
    var all = sessions(payload);
    var waiting = all.filter(function (session) { return session.state === "waiting"; })
      .sort(function (a, b) { return b.stateSeconds - a.stateSeconds; });
    var unseen = function (session) { return keyOf(session) !== seenKey; };
    var stopped = all.filter(function (session) { return session.state === "error" && session.stateSeconds < QUIET_WORKING_SECONDS && unseen(session); });
    var working = all.filter(function (session) { return session.state === "working" && session.idleSeconds < QUIET_WORKING_SECONDS; })
      .sort(function (a, b) { return a.idleSeconds - b.idleSeconds; });
    var finished = all.filter(function (session) { return session.state === "done" && session.stateSeconds < FINISHED_SHOWN_SECONDS && unseen(session); })
      .sort(function (a, b) { return a.stateSeconds - b.stateSeconds; });
    var chosen = waiting[0] || stopped[0] || working[0] || finished[0];
    if (!chosen) return null;

    var detail = chosen.project;
    var quiet = chosen.state === "working" && chosen.idleSeconds >= QUIET_SECONDS;
    if (chosen.state === "working") {
      // How long it has been going, then either its latest step or how long since one.
      detail += " · " + elapsed(chosen.stateSeconds);
      if (quiet) detail += " · quiet for " + elapsed(chosen.idleSeconds);
      else if (chosen.text) detail += " · " + chosen.text;
      if (working.length > 1) detail += " · +" + (working.length - 1) + " more";
    } else {
      if (chosen.text) detail += " · " + chosen.text;
      if (chosen.state === "waiting" && chosen.stateSeconds >= 60) detail += " · waiting " + elapsed(chosen.stateSeconds);
      if (chosen.state === "waiting" && waiting.length > 1) detail += " · +" + (waiting.length - 1) + " more waiting";
    }
    var key = keyOf(chosen);
    var title = STATES[chosen.state];
    var hint = chosen.state === "waiting" ? (key === seenKey ? "" : " Tap to stop the flashing.")
      : chosen.state === "working" ? "" : " Tap to put this away.";
    return {
      state: chosen.state, key: key, title: title, detail: detail,
      flash: chosen.state === "waiting" && key !== seenKey,
      quiet: quiet,
      // Said aloud once, when a session starts waiting or finishes; not on every step.
      announce: chosen.state === "working" ? "" : title + ": " + chosen.project + (chosen.text ? " · " + chosen.text : ""),
      label: title + ": " + detail.replace(/[.!?]+$/, "") + "." + hint,
      waitingCount: waiting.length
    };
  }

  // How long to wait before asking the host again. Often while any session is live, seldom when none is.
  function nextPollMs(payload) {
    var live = sessions(payload).some(function (session) {
      return session.state === "waiting" || (session.state === "working" && session.idleSeconds < QUIET_WORKING_SECONDS);
    });
    return live ? 3000 : 15000;
  }

  return { view: view, sessions: sessions, elapsed: elapsed, nextPollMs: nextPollMs };
});
