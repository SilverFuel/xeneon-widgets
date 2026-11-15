// Home's "Recently played" strip, checked on what it lists and says.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const playLog = createRequire(import.meta.url)("../js/play-log.js");
let helpers = null;
const runtime = { registerRenderer() {}, registerHelpers(value) { helpers = value; } };
vm.runInNewContext(readFileSync(resolve(process.cwd(), "js/widgets/product.js"), "utf8"), { window: { InlineWidgets: { runtime } }, Date });

const minute = 60000, hour = 60 * minute, day = 24 * hour;
const now = new Date(2026, 10, 15, 17, 30).getTime();
const game = (name, totalMinutes, lastPlayed, todayMinutes = 0) => ({
  name, totalMs: totalMinutes * minute, sessions: 3, lastPlayed,
  days: todayMinutes ? { [playLog.dayId(now)]: { ms: todayMinutes * minute, sessions: 1 } } : {}
});
// Through JSON: the panel's objects come from another realm, which deepEqual treats as a different type.
const recent = log => JSON.parse(JSON.stringify(helpers.homeRecentGames(log, playLog, now)));

test("lists the three most recent games, newest first, each with when and how long", () => {
  const log = { version: 1, current: null, games: {
    "steam:1": game("Older", 600, now - 9 * day),
    "wow-forever": game("World of Warcraft Forever", 372, now - 3 * hour, 47),
    "steam:2807960": game("Battlefield 6", 1310, now - 26 * hour),
    "game:oldest": game("Oldest", 90, now - 40 * day)
  } };
  assert.deepEqual(recent(log), [
    { key: "wow-forever", name: "World of Warcraft Forever", line: "47 min today · 6 h 12 min in total", destination: "wow-forever" },
    { key: "steam:2807960", name: "Battlefield 6", line: "Played yesterday · 21 h in total", destination: "game-mode" },
    { key: "steam:1", name: "Older", line: "Played 9 days ago · 10 h in total", destination: "game-mode" }
  ]);
});

test("says when a game is running, and counts in weeks once it has been a while", () => {
  const log = { version: 1, games: {
    "steam:5": game("Running", 125, now - 20000, 5),
    "steam:6": game("Long ago", 45, now - 30 * day)
  }, current: { key: "steam:5", startedAt: now - 5 * minute, lastSeenAt: now - 20000, playedMs: 5 * minute } };
  assert.deepEqual(recent(log).map(entry => entry.line), ["Playing now · 2 h 5 min in total", "Played 4 weeks ago · 45 min in total"]);
});

test("a first day of play is not given a total that repeats it", () => {
  const log = { version: 1, current: null, games: { "steam:7": game("New", 30, now - hour, 30) } };
  assert.deepEqual(recent(log).map(entry => entry.line), ["30 min today"]);
});

test("a game played earlier today for under a minute today still reads as today", () => {
  const log = { version: 1, current: null, games: { "steam:8": game("Brief", 200, now - 2 * hour) } };
  assert.deepEqual(recent(log).map(entry => entry.line), ["Played today · 3 h 20 min in total"]);
});

test("leaves out games with under a minute counted, and copes with no log", () => {
  const log = { version: 1, current: null, games: { "steam:9": { name: "Blink", totalMs: 20000, sessions: 1, lastPlayed: now - hour, days: {} } } };
  assert.deepEqual(recent(log), []);
  assert.deepEqual(recent(playLog.fresh()), []);
  assert.deepEqual(recent(null), []);
});

test("never carries anything but the key, the name, the line and the panel to open", () => {
  const log = { version: 1, current: null, games: { "steam:3": { ...game("Pathy", 90, now - hour), path: "C:\\Games\\pathy.exe" } } };
  const [entry] = recent(log);
  assert.deepEqual(Object.keys(entry).sort(), ["destination", "key", "line", "name"]);
  assert.doesNotMatch(JSON.stringify(entry), /C:|exe/);
});
