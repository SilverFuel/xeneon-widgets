// The frame rate counter's card on the Gaming screen, checked on what it renders.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const path = resolve(process.cwd(), "js/widgets/game-mode.js");
let helpers = null;
const runtime = {
  escapeHtml(value) { return String(value ?? ""); },
  formatFps(value) { return value == null ? "--" : `${Math.round(value)} FPS`; },
  formatMs(value) { return value == null ? "--" : `${value} ms`; },
  statusPill(label, tone) { return `<span class="pill" data-tone="${tone}">${label}</span>`; },
  text(value, fallback = "") { return value == null || value === "" ? fallback : String(value); },
  registerHelpers(value) { helpers = value; }, registerRenderer() {}
};
vm.runInNewContext(readFileSync(path, "utf8"), { window: { InlineWidgets: { runtime } }, console, Promise, Math, Number, String, Boolean, Array }, { filename: path });
assert(helpers?.renderFrameRateCard, "the Gaming widget must expose the frame rate card");
const card = (performance, restarting = false) => helpers.renderFrameRateCard(performance, restarting);

test("with no game running there is no frame rate card", () => {
  assert.equal(card({ status: "idle", readiness: "idle", message: "Shows once a game is running.", fpsSource: "NVIDIA PresentMon" }), "");
  assert.equal(card({}), "");
  assert.equal(card(null), "");
});

test("a counter that needs administrator access shows the card with the fix", () => {
  const html = card({ status: "unavailable", readiness: "needs-admin", needsAdmin: true, canRestartAsAdmin: true, message: "FPS capture needs administrator capture access.", fpsSource: "NVIDIA PresentMon" });
  assert.match(html, /Frame rate counter/);
  assert.match(html, /Needs admin/);
  assert.match(html, /data-action="restart-game-admin"/);
  assert.match(html, /data-tone="warn"/);
});

test("the card is shown while starting, live, or not measuring, in plain words", () => {
  assert.match(card({ status: "starting", readiness: "starting", message: "Starting.", fpsSource: "NVIDIA PresentMon" }), />Starting</);
  const live = card({ status: "live", readiness: "live", fps: 144, frameTimeMs: 6.9, fpsSource: "NVIDIA PresentMon" });
  assert.match(live, />Live</);
  assert.match(live, /144 FPS/);
  assert.match(card({ status: "unavailable", readiness: "not-linked", message: "The frame rate is not being measured for this game yet.", fpsSource: "not linked" }), />Not measuring</);
  for (const html of [live]) {
    assert.doesNotMatch(html, /Telemetry|Presented FPS|FPS source/, "no jargon labels");
  }
});
