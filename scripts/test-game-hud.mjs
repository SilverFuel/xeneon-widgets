// The in-game screen on Gaming, checked on what it renders: each reading once.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const path = resolve(process.cwd(), "js/widgets/game-mode.js");
let helpers = null;
const number = value => (value == null || value === "" || Number.isNaN(Number(value)) ? null : Number(value));
const runtime = {
  clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, Number(value) || 0)); },
  escapeHtml(value) { return String(value ?? ""); },
  formatDurationMs(value) { return `${Math.round((Number(value) || 0) / 1000)}s`; },
  formatFps(value) { return number(value) == null ? "--" : `${Math.round(value)} FPS`; },
  formatMs(value) { return number(value) == null ? "--" : `${Number(value).toFixed(1)} ms`; },
  formatPercent(value) { return number(value) == null ? "--" : `${Math.round(value)}%`; },
  formatTemp(value) { return `${Math.round(value)} C`; },
  getAudioSessionLabel(session) { return session.displayName || session.name; },
  isUsefulAudioSession() { return true; },
  networkLinkSpeed() { return "1 Gbps"; }, networkQualityLabel() { return "Game ready"; },
  networkQualityScore() { return 90; }, networkQualityTone() { return "good"; }, networkTypeLabel() { return "Ethernet"; },
  normalizeAudioPayload(payload) { return { muted: false, masterVolume: 0, devices: [], inputDevices: [], sessions: [], ...payload }; },
  normalizeNetworkSnapshot(value) { return value || {}; },
  normalizeUnifiSnapshot() { return { linked: false, detected: false, clients: { total: 0 }, aps: [] }; },
  nullableNumber: number, optionalNumber: number,
  statusPill(label) { return `<span class="pill">${label}</span>`; },
  text(value, fallback = "") { return value == null || value === "" ? fallback : String(value); },
  registerHelpers(value) { helpers = value; }, registerRenderer() {}
};
vm.runInNewContext(readFileSync(path, "utf8"), { window: { InlineWidgets: { runtime } }, console, Promise, Math, Number, String, Boolean, Array, Object, Date }, { filename: path });
assert(helpers?.renderGameFocusScene, "the Gaming widget must expose the in-game screen");

const count = (html, needle) => html.split(needle).length - 1;
const game = { name: "Battlefield 6", platform: "Steam", source: "Steam library", reason: "Running from your Steam library", sessionDurationMs: 60000 };
const theme = { accent: "#123456", secondary: "#654321" };
const system = { gpu: 91, cpu: 46, ram: 58, gpuTemp: 72, cpuTemp: 67 };
const apps = total => Array.from({ length: total }, (_, index) => ({ id: `s${index}`, name: `App ${index}`, displayName: `App ${index}`, volume: 50, muted: false, active: true }));
const audio = total => ({ masterVolume: 100, inputVolume: 82, devices: [{ id: "a", name: "Speakers (FiiO K11)", isDefault: true }], inputDevices: [{ id: "m", name: "Microphone (USB)", isDefault: true }], sessions: apps(total) });
const live = { status: "live", readiness: "live", fps: 143.6, frameTimeMs: 6.96, source: "NVIDIA PresentMon" };
const scene = (performance = live, sessions = 3) => helpers.renderGameFocusScene(game, theme, system, performance, audio(sessions), { ping: 14, type: "ethernet" }, {}, false, false);

test("the tiles are FPS, GPU, CPU, RAM and Network; sound, mic and load are not repeated as tiles", () => {
  const html = scene();
  const tiles = [...html.matchAll(/data-game-focus-metric="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(tiles, ["main-fps", "gpu", "cpu", "ram", "network"]);
  assert.equal(count(html, "<span>Mic</span>"), 1, "the mic is shown once, beside its mute button");
  assert.equal(count(html, "<span>Audio</span>"), 1, "the sound is shown once, beside its mute button");
  assert.doesNotMatch(html, /Pressure/);
  assert.doesNotMatch(html, /game-focus-reason|active audio app/);
});

test("the FPS tile shows the number alone and the frame time under it", () => {
  const html = scene();
  assert.match(html, /<strong data-game-focus-value>144<\/strong>/);
  assert.match(html, /7\.0 ms per frame/);
  assert.doesNotMatch(html, /PresentMon/, "the tool that measures it is not something to read while playing");
});

test("with no frame rate yet the tile says why, and offers the fix when that is the reason", () => {
  const waiting = scene({ status: "starting", readiness: "starting", message: "Starting the frame rate counter." });
  assert.match(waiting, /<strong data-game-focus-value>--<\/strong>/);
  assert.match(waiting, /Starting the frame rate counter\./);
  assert.equal(count(waiting, 'data-action="restart-game-admin"'), 0);
  const admin = scene({ status: "unavailable", readiness: "needs-admin", needsAdmin: true, message: "The frame rate counter needs administrator access." });
  assert.equal(count(admin, 'data-action="restart-game-admin"'), 1);
});

test("app volumes: one row each with its own mute, up to six", () => {
  assert.equal(count(scene(live, 3), 'data-action="game-session-mute"'), 3);
  assert.equal(count(scene(live, 9), 'data-action="game-session-mute"'), 6);
  assert.match(scene(live, 0), /No active app audio/);
});
