// The Steam shelf on the idle Gaming screen: what each game's second line says, and what the
// launch pad renders around it.
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
  escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); },
  emptyState(title, copy) { return `<div class="empty">${title} ${copy}</div>`; },
  findById(items, id) { return items.find(item => item.id === id) || items[0]; },
  nullableNumber: number, optionalNumber: number,
  productThemes() { return [{ id: "focus", name: "Focus", accent: "#2b4d7d", secondary: "#36c9b0" }]; },
  settingValue(env, key, fallback) { return (env && env.settings && env.settings[key]) ?? fallback; },
  statusPill(label, tone) { return `<span class="pill" data-tone="${tone}">${label}</span>`; },
  text(value, fallback = "") { return value == null || value === "" ? fallback : String(value); },
  registerHelpers(value) { helpers = value; }, registerRenderer() {}
};
vm.runInNewContext(readFileSync(path, "utf8"), { window: { InlineWidgets: { runtime } }, console, Promise, Math, Number, String, Boolean, Array, Object, Date }, { filename: path });
assert(helpers?.steamTileLine && helpers?.renderGameModeSteamPad, "the Gaming widget must expose the shelf's line and the launch pad");

const { steamTileLine: line, renderGameModeSteamPad: pad } = helpers;
const minutes = ms => `${Math.round(ms / 60000)} min`;
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const now = at(2026, 11, 27, 9, 16);
const iso = ms => new Date(ms).toISOString();

test("time played today comes first, from the play log", () => {
  const result = line({ lastPlayed: iso(at(2026, 11, 20)) }, { todayMs: 47 * 60000, lastPlayed: now - 5 * 60000 }, now, minutes);
  assert.deepEqual({ ...result }, { text: "47 min today", spoken: "Played 47 min today" });
  assert.equal(line({}, { todayMs: 30000, lastPlayed: now - 60000 }, now, minutes).text, "Today", "under a minute is not worth a figure");
});

test("otherwise it says when the game was last played, by calendar day", () => {
  const steam = ms => line({ lastPlayed: iso(ms) }, null, now, minutes);
  assert.deepEqual({ ...steam(at(2026, 11, 27, 0, 30)) }, { text: "Today", spoken: "Last played today" });
  assert.equal(steam(at(2026, 11, 26, 23, 50)).text, "Yesterday", "ten hours ago, but the day before");
  assert.equal(steam(at(2026, 11, 22)).text, "5 days ago");
  assert.equal(steam(at(2026, 11, 14)).text, "13 days ago");
  assert.equal(steam(at(2026, 11, 6)).text, "3 weeks ago");
  assert.equal(steam(at(2026, 7, 27)).text, "4 months ago");
  assert.deepEqual({ ...steam(at(2024, 3, 1)) }, { text: "Over a year ago", spoken: "Last played over a year ago" });
});

test("the later of the play log and Steam's own record is used", () => {
  assert.equal(line({ lastPlayed: iso(at(2026, 11, 1)) }, { todayMs: 0, lastPlayed: at(2026, 11, 25) }, now, minutes).text, "2 days ago");
  assert.equal(line({ lastPlayed: iso(at(2026, 11, 26)) }, { todayMs: 0, lastPlayed: at(2026, 11, 2) }, now, minutes).text, "Yesterday");
});

test("with no record, or one that cannot be right, the tile just says Launch", () => {
  for (const game of [{}, { lastPlayed: "" }, { lastPlayed: "not a date" }, { lastPlayed: iso(0) }, { lastPlayed: iso(now + 3 * 86400000) }, null]) {
    assert.deepEqual({ ...line(game, null, now, minutes) }, { text: "Launch", spoken: "" });
  }
});

const steam = { games: [
  { appId: "10", name: "Battlefield 6", tileLabel: "B", artworkUrl: "/api/steam/games/art?id=10" },
  { appId: "20", name: "Hades II", tileLabel: "H", artworkUrl: "" },
  { appId: "30", name: "Tom & Jerry \"Remix\"", tileLabel: "T", artworkUrl: "" }
], activeGame: null };
const played = game => (game.appId === "10" ? { text: "47 min today", spoken: "Played 47 min today" } : game.appId === "20" ? { text: "3 days ago", spoken: "Last played 3 days ago" } : { text: "Launch", spoken: "" });
const tiles = html => [...html.matchAll(/<div class="(game-mode-steam-tile[^"]*)"[\s\S]*?<small>([^<]*)<\/small>/g)].map(match => ({ classes: match[1], line: match[2] }));
const labels = html => [...html.matchAll(/data-action="steam-launch" data-app-id="[^"]*" aria-label="([^"]*)"/g)].map(match => match[1]);

test("each tile shows its line and says what a tap does", () => {
  const html = pad(steam, "Ready", "good", "", "", {}, played);
  assert.deepEqual(tiles(html).map(tile => tile.line), ["47 min today", "3 days ago", "Launch"]);
  assert.deepEqual(labels(html), ["Launch Battlefield 6. Played 47 min today", "Launch Hades II. Last played 3 days ago", "Launch Tom &amp; Jerry &quot;Remix&quot;"]);
  assert.match(html, /<strong>3 installed<\/strong>/);
  assert.match(html, /<img src="\/api\/steam\/games\/art\?id=10" alt="Battlefield 6"/);
  assert.match(html, /<span class="game-mode-steam-art"><span>H<\/span><\/span>/, "no picture: the tile's letters");
});

test("the status pill shows only when there is something to say", () => {
  assert.doesNotMatch(pad(steam, "Ready", "good", "", "", {}, played), /class="pill"/);
  assert.doesNotMatch(pad(steam, "", "good", "", "", {}, played), /class="pill"/);
  for (const status of ["Scanning", "Launching", "Launch failed", "Setup"]) {
    assert.match(pad(steam, status, "warn", "", "", {}, played), new RegExp(`class="pill" data-tone="warn">${status}<`));
  }
});

test("launching and the held state keep their own words", () => {
  const launching = pad(steam, "Launching", "warn", "20", "", {}, played);
  assert.equal(tiles(launching)[1].line, "Launching");
  assert.equal((launching.match(/data-action="steam-launch"[^>]* disabled/g) || []).length, 3, "no second launch while one is starting");
  const held = pad(steam, "Ready", "good", "", "20", {}, played);
  assert.deepEqual(tiles(held)[1], { classes: "game-mode-steam-tile is-expanded", line: "Look ready" });
  assert.match(held, /data-action="steam-theme" data-app-id="20"/);
  assert.equal(tiles(pad({ ...steam, activeGame: { appId: "10" } }, "Ready", "good", "", "", {}, played))[0].line, "Active look");
});

test("without a play log reader, and with no games, it still renders", () => {
  assert.deepEqual(tiles(pad(steam, "Ready", "good", "", "", {})).map(tile => tile.line), ["Launch", "Launch", "Launch"]);
  const empty = pad({ games: [], message: "Install games in Steam and Auxora will find them." }, "Setup", "warn", "", "", {}, played);
  assert.match(empty, /No games found/);
  assert.match(empty, /class="empty">No Steam games/);
});
