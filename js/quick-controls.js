(function () {
  "use strict";

  // Small, drawer-scoped controller. Transport/authentication stays with the
  // dashboard; no polling or device commands run merely by loading this file.
  function create(options) {
    var root = options.root;
    var volume = root.querySelector("#dashboard-quick-volume");
    var volumeValue = root.querySelector("#dashboard-quick-volume-value");
    var mute = root.querySelector("#dashboard-quick-mute");
    var playback = root.querySelector("#dashboard-quick-playback");
    var opened = false;
    var timer = 0;
    var editingVolume = false;
    var mutation = null;
    var channels = {
      audio: { maxAge: 8000, value: null, message: "Checking audio…", request: null, version: 0, nextRead: 0 },
      media: { maxAge: 20000, value: null, message: "Checking playback…", request: null, version: 0, nextRead: 0 }
    };

    function active() { return opened && !document.hidden; }
    function available(kind) { return active() && options.available(kind); }
    function fresh(kind) {
      var value = channels[kind].value;
      return !!value && Date.now() - value.sampledAt <= channels[kind].maxAge
        && Date.now() - value.receivedAt <= channels[kind].maxAge;
    }
    function usable(kind) { return available(kind) && fresh(kind) && !mutation; }
    function setText(node, text) {
      if (node && node.textContent !== text) { node.textContent = text; }
    }
    function status(kind, message) {
      channels[kind].message = message;
    }
    function parse(kind, payload) {
      if (!payload || payload.supported !== true || payload.configured !== true
          || payload.status !== "live" || payload.stale !== false) { return null; }
      var sampledAt = typeof payload.sampledAt === "string" ? Date.parse(payload.sampledAt) : NaN;
      var age = Date.now() - sampledAt;
      if (!Number.isFinite(sampledAt) || age < -1000 || age > channels[kind].maxAge) { return null; }
      var value = { sampledAt: sampledAt, receivedAt: Date.now() };
      if (kind === "audio") {
        if (typeof payload.masterVolume !== "number" || !Number.isFinite(payload.masterVolume)
            || payload.masterVolume < 0 || payload.masterVolume > 100 || typeof payload.muted !== "boolean"
            || typeof payload.defaultDeviceId !== "string" || !payload.defaultDeviceId.trim()) { return null; }
        value.volume = Math.round(payload.masterVolume);
        value.muted = payload.muted;
      } else {
        // Keep this compact surface free of track titles, app names and artwork.
        value.playback = payload.playbackStatus;
        value.action = payload.playbackStatus === "playing" && payload.canPause === true ? "pause"
          : ["paused", "stopped"].indexOf(payload.playbackStatus) !== -1 && payload.canPlay === true ? "play" : "";
      }
      return value;
    }
    function describe(kind, payload, value) {
      if (value) {
        if (kind === "audio") { return value.muted ? "Sound is muted" : "System volume"; }
        if (!value.action) { return "Playback control unavailable in this player"; }
        return value.playback === "playing" ? "Playing" : value.playback === "paused" ? "Paused" : "Stopped";
      }
      if (payload && payload.supported === false) { return kind === "audio" ? "Audio controls unavailable" : "Playback controls unavailable"; }
      if (kind === "media" && payload && payload.status === "idle") { return "No active media. Open a player to use playback."; }
      if (kind === "audio" && payload && payload.configured === false) { return "No audio output available"; }
      return kind === "audio" ? "Audio state unavailable. Checking again…" : "Playback state unavailable. Checking again…";
    }
    function setEnabled(control, enabled) {
      control.disabled = !enabled;
      // Keep the active control focusable while a single write is in flight.
      // Event handlers enforce this aria-disabled state for every input path.
      control.setAttribute("aria-disabled", !enabled || mutation ? "true" : "false");
    }
    function render() {
      var audioReady = available("audio") && fresh("audio");
      var mediaReady = available("media") && fresh("media");
      var audio = channels.audio.value;
      var media = channels.media.value;
      setEnabled(volume, audioReady);
      setEnabled(mute, audioReady);
      setEnabled(playback, mediaReady && !!media.action);
      if (!editingVolume) {
        if (audioReady) { volume.value = String(audio.volume); }
        setText(volumeValue, audioReady ? audio.volume + "%" : "—");
      }
      volume.setAttribute("aria-valuetext", audioReady ? volume.value + " percent" : "Volume unavailable");
      setText(mute, audioReady && audio.muted ? "Unmute" : "Mute");
      // This is a changing action label, not a fixed-label toggle button.
      setText(playback, mediaReady && media.action ? media.action === "pause" ? "Pause" : "Play" : "Play / pause");
      ["audio", "media"].forEach(function (kind) {
        var channel = channels[kind];
        var message = !options.available(kind) ? (kind === "audio" ? "Audio controls unavailable" : "Playback controls unavailable")
          : mutation && mutation.kind === kind ? "Applying…"
          : channel.value && !fresh(kind) ? (kind === "audio" ? "Audio state expired. Checking again…" : "Playback state expired. Checking again…")
          : channel.message;
        setText(root.querySelector("#dashboard-quick-" + kind + "-status"), message);
      });
      root.setAttribute("aria-busy", mutation ? "true" : "false");
    }
    function cancelRead(kind) {
      var channel = channels[kind];
      channel.version += 1;
      if (channel.request) { channel.request.abort(); }
      channel.request = null;
    }
    function read(kind) {
      var channel = channels[kind];
      if (!available(kind) || mutation || channel.request || kind === "audio" && editingVolume) { return; }
      var controller = new AbortController();
      var version = ++channel.version;
      channel.request = controller;
      Promise.resolve().then(function () {
        if (controller.signal.aborted) { return null; }
        return options.get("/api/" + kind, controller.signal);
      }).then(function (payload) {
        if (version !== channel.version || !available(kind)) { return; }
        channel.value = parse(kind, payload);
        status(kind, describe(kind, payload, channel.value));
      }, function () {
        if (version !== channel.version || !available(kind)) { return; }
        channel.value = null;
        status(kind, kind === "audio" ? "Could not read audio. Checking again…" : "Could not read playback. Checking again…");
      }).finally(function () {
        if (version !== channel.version) { return; }
        channel.request = null;
        channel.nextRead = Date.now() + 2000;
        if (active()) { render(); }
      });
    }
    function tick() {
      if (!active()) { return; }
      ["audio", "media"].forEach(function (kind) {
        if (!available(kind)) {
          cancelRead(kind);
          channels[kind].value = null;
        } else if (Date.now() >= channels[kind].nextRead) {
          read(kind);
        }
      });
      render();
    }
    function commit(kind, path, body, confirmed) {
      if (!usable(kind)) { render(); return; }
      cancelRead("audio");
      cancelRead("media");
      editingVolume = false;
      mutation = { kind: kind };
      render();
      // A closed drawer cannot undo a command the host already received. Keep
      // the write serialized across reopen, bounded by the transport deadline;
      // cancel reads on close, never replay or automatically retry a write.
      Promise.resolve().then(function () { return options.post(path, body); }).then(function (payload) {
        var value = parse(kind, payload);
        if (value && confirmed(value)) {
          channels[kind].value = value;
          status(kind, describe(kind, payload, value));
        } else {
          channels[kind].value = null;
          status(kind, "Could not confirm the change. Checking actual state…");
        }
      }, function () {
        channels[kind].value = null;
        status(kind, "Could not confirm the change. Checking actual state…");
      }).finally(function () {
        mutation = null;
        // Give uncertain feedback time to be read, then refresh actual state.
        channels[kind].nextRead = Date.now() + (channels[kind].value ? 0 : 2000);
        channels[kind === "audio" ? "media" : "audio"].nextRead = 0;
        if (active()) { tick(); }
      });
    }
    function beginVolumeEdit(event) {
      if (!usable("audio")) { if (event) { event.preventDefault(); } render(); return false; }
      if (!editingVolume) { cancelRead("audio"); }
      editingVolume = true;
      return true;
    }
    function cancelVolumeEdit() {
      if (!editingVolume) { return; }
      editingVolume = false;
      channels.audio.nextRead = 0;
      if (active()) { tick(); }
    }
    volume.addEventListener("pointerdown", beginVolumeEdit);
    volume.addEventListener("input", function () {
      if (!beginVolumeEdit()) { return; }
      setText(volumeValue, volume.value + "%");
      volume.setAttribute("aria-valuetext", volume.value + " percent");
    });
    volume.addEventListener("change", function () {
      var desired = Number(volume.value);
      editingVolume = false;
      if (!Number.isFinite(desired) || desired < 0 || desired > 100 || !usable("audio")) { render(); return; }
      desired = Math.round(desired);
      if (channels.audio.value.volume === desired) { render(); return; }
      commit("audio", "/api/audio/master-volume", { volume: desired }, function (value) { return value.volume === desired; });
    });
    volume.addEventListener("pointerup", function () { window.setTimeout(cancelVolumeEdit, 0); });
    volume.addEventListener("pointercancel", cancelVolumeEdit);
    volume.addEventListener("blur", cancelVolumeEdit);
    volume.addEventListener("keydown", function (event) {
      if (!usable("audio") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].indexOf(event.key) !== -1) { event.preventDefault(); }
    });
    mute.addEventListener("click", function () {
      if (!usable("audio")) { render(); return; }
      var desired = !channels.audio.value.muted;
      commit("audio", "/api/audio/master-mute", { muted: desired }, function (value) { return value.muted === desired; });
    });
    playback.addEventListener("click", function () {
      if (!usable("media") || !channels.media.value.action) { render(); return; }
      var action = channels.media.value.action;
      commit("media", "/api/media/" + action, {}, function (value) {
        return action === "play" ? value.playback === "playing" : value.playback === "paused";
      });
    });

    function suspend() {
      window.clearInterval(timer);
      timer = 0;
      editingVolume = false;
      ["audio", "media"].forEach(function (kind) {
        cancelRead(kind);
        channels[kind].value = null;
        channels[kind].nextRead = 0;
        status(kind, kind === "audio" ? "Checking audio…" : "Checking playback…");
      });
      render();
    }
    function resume() {
      if (!active() || timer) { return; }
      tick();
      timer = window.setInterval(tick, 1000);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { suspend(); }
      else { resume(); }
    });
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", resume);
    return {
      open: function () { if (opened) { return; } opened = true; suspend(); resume(); },
      close: function () { opened = false; suspend(); }
    };
  }
  window.AuxoraQuickControls = { create: create };
})();
