import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const audioPath = resolve(process.cwd(), "js/widgets/audio.js");
const cssPath = resolve(process.cwd(), "css/widgets/audio.css");
const audioSource = readFileSync(audioPath, "utf8");
const audioCss = readFileSync(cssPath, "utf8");
let helpers = null;
let renderer = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runtime = {
  addListener() {},
  buildBridgeUrl() { return ""; },
  clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, Number(value) || 0)); },
  createTimerLoop() { return { start() {}, refresh() {}, destroy() {} }; },
  emitTouchFeedback() {},
  emptyState() { return ""; },
  escapeHtml(value) { return String(value ?? ""); },
  formatDurationMs() { return "0:00"; },
  formatMediaAppLabel() { return "Player"; },
  formatPercent() { return "0%"; },
  initXnSlider() {},
  normalizeMediaPayload(payload) { return payload || {}; },
  optionalNumber(value) { return value == null ? null : Number(value); },
  patchStableDom() {},
  requestJson() { return Promise.resolve({}); },
  runCleanups() {},
  statusPill() { return ""; },
  statusTextFromPayload() { return "Ready"; },
  statusToneFromPayload() { return "good"; },
  text(value, fallback = "") { return value == null || value === "" ? fallback : String(value); },
  registerHelpers(value) { helpers = value; },
  registerRenderer(name, value) { if (name === "audio") renderer = value; }
};

vm.runInNewContext(audioSource, {
  window: { InlineWidgets: { runtime } },
  console,
  Promise,
  Math,
  Number,
  String,
  Boolean,
  Array
}, { filename: audioPath });

assert(
  renderer
    && helpers?.rememberObservedAlbum
    && helpers?.rememberDismissedAlbum
    && helpers?.deleteObservedAlbum
    && helpers?.getObservedAlbumKey,
  "Audio & Media must register its carousel renderer and card-management helpers"
);

const liveTrack = (index, overrides = {}) => ({
  status: "live",
  playbackStatus: "playing",
  appId: "AppleMusic.exe",
  title: `Track ${index}`,
  artist: `Artist ${index}`,
  albumTitle: `Album ${index}`,
  thumbnailDataUrl: `data:image/png;base64,album-${index}`,
  ...overrides
});

let history = helpers.rememberObservedAlbum([], { status: "idle", title: "Nothing" });
assert(history.length === 0, "Idle sessions must not enter observed album history");

for (let index = 1; index <= 9; index += 1) {
  history = helpers.rememberObservedAlbum(history, liveTrack(index));
}
assert(history.length === 7, `Observed album history must stay bounded at seven entries, received ${history.length}`);
assert(history[0].title === "Track 9" && history[6].title === "Track 3", "Observed album history must keep newest-first ordering");

history = helpers.rememberObservedAlbum(history, liveTrack(5, { thumbnailDataUrl: "data:image/png;base64,updated" }));
assert(history.length === 7 && history[0].title === "Track 5", "Re-observed albums must move to the front without growing history");
assert(history[0].thumbnailDataUrl.endsWith("updated"), "Re-observed albums must refresh their local artwork");

const privateHistory = helpers.rememberObservedAlbum(history, {
  status: "live",
  playbackStatus: "playing",
  title: "Media playing",
  artist: "",
  albumTitle: "",
  thumbnailDataUrl: ""
});
assert(privateHistory.length === history.length && privateHistory[0].key === history[0].key, "Privacy-redacted playback must not enter observed history");

const deletedKey = history[2].key;
const deletedHistory = helpers.deleteObservedAlbum(history, deletedKey);
assert(deletedHistory.length === history.length - 1 && !deletedHistory.some(entry => entry.key === deletedKey), "Deleting a music card must remove only the selected history entry");

const dismissedKeys = helpers.rememberDismissedAlbum([], deletedKey);
const dismissedTrack = history[2];
const refreshAfterDelete = helpers.rememberObservedAlbum(deletedHistory, {
  status: "live",
  playbackStatus: "playing",
  appId: dismissedTrack.appId,
  title: dismissedTrack.title,
  artist: dismissedTrack.artist,
  albumTitle: dismissedTrack.albumTitle,
  thumbnailDataUrl: dismissedTrack.thumbnailDataUrl
}, dismissedKeys);
assert(!refreshAfterDelete.some(entry => entry.key === deletedKey), "The refresh loop must not immediately recreate a deleted music card");

assert(/MAX_OBSERVED_ALBUMS\s*=\s*7/.test(audioSource), "Carousel history must remain explicitly bounded");
assert(!/localStorage|sessionStorage|music\.apple\.com|api\.music\.apple|MusicKit/.test(audioSource), "Carousel must remain local, in-memory, and independent of Apple web services");
assert(/data-carousel/.test(audioSource) && /ArrowLeft/.test(audioSource) && /ArrowRight/.test(audioSource) && /pointerdown/.test(audioSource), "Carousel must expose keyboard and swipe navigation");
assert(/aria-live="polite"/.test(audioSource) && /aria-current="true"/.test(audioSource), "Carousel selection must be announced accessibly");
assert(/data-action="carousel-delete"/.test(audioSource) && /Delete music card for/.test(audioSource), "Every observed item must expose an accessible delete-card action");
assert(/\.audio-album-card/.test(audioCss) && /perspective:\s*900px/.test(audioCss), "Carousel must present observed items as individual cards");
assert(/\.audio-album-card__delete/.test(audioCss) && /min-height:\s*44px/.test(audioCss), "Card delete controls must meet the touch target minimum");
assert(/is-single/.test(audioSource) && /\.audio-album-carousel\.is-single/.test(audioCss), "A single observed card must use the larger focused presentation");
assert(/has-artwork-error/.test(audioSource) && /\.audio-album-cover\.has-artwork-error/.test(audioCss), "Broken artwork must fall back to a local placeholder instead of a broken-image icon");
assert(/audio-album-cover__placeholder-title/.test(audioSource) && /audio-album-cover__placeholder-artist/.test(audioSource), "Artwork-free cards must show useful title and artist text");
assert(/prefers-reduced-motion:\s*reduce/.test(audioCss) && /motion-off.*audio-album-card/.test(audioCss), "Carousel motion must honor both system and Auxora motion settings");

console.log("checked zero-cost local deletable music-card carousel");
