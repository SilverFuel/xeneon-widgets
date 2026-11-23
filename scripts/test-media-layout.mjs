// The Media screen and its separate Equalizer screen, checked on what they render.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const audioPath = resolve(process.cwd(), "js/widgets/audio.js");
let helpers = null;
const runtime = {
  addListener() {}, buildBridgeUrl() { return ""; },
  clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, Number(value) || 0)); },
  createTimerLoop() { return { start() {}, refresh() {}, destroy() {} }; },
  emitTouchFeedback() {},
  emptyState(title) { return `<div class="empty">${title}</div>`; },
  escapeHtml(value) { return String(value ?? ""); },
  formatDurationMs() { return "0:00"; }, formatMediaAppLabel() { return "Player"; },
  formatPercent(value) { return `${Math.round(Number(value) || 0)}%`; },
  initXnSlider() {}, normalizeMediaPayload(payload) { return payload || {}; },
  optionalNumber(value) { return value == null ? null : Number(value); },
  patchStableDom() {}, requestJson() { return Promise.resolve({}); }, runCleanups() {},
  statusPill(label) { return `<span class="pill">${label}</span>`; },
  statusTextFromPayload() { return "Ready"; }, statusToneFromPayload() { return "good"; },
  text(value, fallback = "") { return value == null || value === "" ? fallback : String(value); },
  registerHelpers(value) { helpers = value; }, registerRenderer() {}
};
vm.runInNewContext(readFileSync(audioPath, "utf8"), { window: { InlineWidgets: { runtime } }, console, Promise, Math, Number, String, Boolean, Array }, { filename: audioPath });
assert(helpers?.renderAudioWidget, "the Media widget must expose its render function");

const count = (html, needle) => html.split(needle).length - 1;
const apps = number => Array.from({ length: number }, (_, index) => ({ id: `s${index}`, name: `App ${index}`, displayName: `App ${index}`, volume: 50, muted: false, active: true, state: "active" }));

function state({ equalizer = {}, sessions = 2, playing = true, equalizerOpen = false } = {}) {
  return {
    data: helpers.normalizeAudioPayload({ supported: true, status: "live", masterVolume: 40, defaultDeviceId: "a",
      devices: [{ id: "a", name: "Speakers", kind: "speakers", isDefault: true }, { id: "b", name: "Headset", kind: "headset" }], sessions: apps(sessions) }),
    equalizer: helpers.normalizeEqualizerPayload(equalizer),
    media: playing ? { status: "live", playbackStatus: "playing", title: "Track", artist: "Artist", canPause: true, canGoNext: true } : { status: "idle" },
    statusText: "Ready", statusTone: "good", mediaStatusText: "Ready", mediaStatusTone: "good",
    busy: false, interacting: false, equalizerFineTuneOpen: equalizerOpen, equalizerOpen,
    observedAlbums: [], dismissedAlbumKeys: [], carouselIndex: 0
  };
}
const connected = { installed: true, connected: true, status: "live", preset: "Gaming" };

test("the Media screen keeps the presets and a way into the equalizer, and nothing else of it", () => {
  const html = helpers.renderAudioWidget(state({ equalizer: connected }));
  assert.equal(count(html, 'data-action="equalizer-preset"'), 8, "all eight presets are one tap away");
  assert.equal(count(html, 'data-action="equalizer-open"'), 1);
  assert.equal(count(html, 'data-action="equalizer-tone"'), 0, "tone sliders belong to the Equalizer screen");
  assert.equal(count(html, 'data-action="equalizer-band"'), 0, "the ten bands belong to the Equalizer screen");
  assert.match(html, /audio-master-card/);
  assert.match(html, /audio-playback-card/);
  assert.match(html, /audio-apps-card/);
});

test("the Equalizer screen replaces the Media screen while open and has every equalizer control", () => {
  const html = helpers.renderAudioWidget(state({ equalizer: connected, equalizerOpen: true }));
  assert.match(html, /audio-equalizer-screen/);
  assert.equal(count(html, 'data-action="equalizer-close"'), 1);
  assert.equal(count(html, 'data-action="equalizer-preset"'), 8);
  assert.equal(count(html, 'data-action="equalizer-tone"'), 4);
  assert.equal(count(html, 'data-action="equalizer-band"'), 10);
  assert.match(html, /data-action="equalizer-bypass"/);
  assert.match(html, /data-action="equalizer-reset"/);
  assert.doesNotMatch(html, /audio-master-card|audio-playback-card|audio-apps-card/, "the Media cards are gone while the equalizer is open");
});

test("with no equalizer installed, Media shows one Set up button and the setup lives on the Equalizer screen", () => {
  const main = helpers.renderAudioWidget(state({ equalizer: { installed: false } }));
  assert.equal(count(main, 'data-action="equalizer-open"'), 1);
  assert.equal(count(main, 'data-action="equalizer-preset"'), 0);
  assert.doesNotMatch(main, /Get Equalizer APO/, "the install prompt is not on the Media screen");
  const screen = helpers.renderAudioWidget(state({ equalizer: { installed: false }, equalizerOpen: true }));
  assert.match(screen, /Get Equalizer APO/);
  assert.match(screen, /data-action="equalizer-close"/);
});

test("an installed but unconnected equalizer offers Connect on its own screen", () => {
  const main = helpers.renderAudioWidget(state({ equalizer: { installed: true, connected: false } }));
  assert.equal(count(main, 'data-action="equalizer-preset"'), 0);
  const screen = helpers.renderAudioWidget(state({ equalizer: { installed: true, connected: false }, equalizerOpen: true }));
  assert.match(screen, /data-action="equalizer-connect"/);
});

test("app volumes are their own card: up to six apps, and a count of the rest", () => {
  const few = helpers.renderAudioWidget(state({ equalizer: connected, sessions: 3 }));
  assert.equal(count(few, 'class="audio-session-row"'), 3);
  assert.doesNotMatch(few, /audio-session-more/);
  const many = helpers.renderAudioWidget(state({ equalizer: connected, sessions: 9 }));
  assert.equal(count(many, 'class="audio-session-row"'), 6);
  assert.match(many, /\+3 more apps playing sound/);
  const idle = helpers.renderAudioWidget(state({ equalizer: connected, sessions: 2, playing: false }));
  assert.equal(count(idle, 'class="audio-session-row"'), 2, "apps show whether or not a track is playing");
  assert.match(idle, /Nothing is playing/);
});
