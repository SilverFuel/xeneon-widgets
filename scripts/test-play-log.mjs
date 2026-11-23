import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const playLog = require("../js/play-log.js");
const { fresh, validate, seen, touch, end, summary, formatDuration, formatClock, historyLine, dayId, load, save, STORAGE_KEY, MAX_GAP_MS } = playLog;

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Noon local time, so adding hours never crosses midnight by accident.
const noon = new Date(2026, 10, 13, 12, 0, 0).getTime();
const battlefield = { key: "steam:2807960", name: "Battlefield 6" };

// Plays a game from `start` for `minutes`, seen every 10 seconds as the dashboard polls.
function play(log, game, start, minutes) {
  const began = seen(log, game, start);
  for (let at = start + 10000; at <= start + minutes * MINUTE; at += 10000) seen(log, game, at);
  return began;
}

test("a session counts the time the game is seen, to the day it was played", () => {
  const log = fresh();
  assert.equal(play(log, battlefield, noon, 42), true, "the first sighting starts a session");
  const stats = summary(log, battlefield.key, noon + 42 * MINUTE);
  assert.equal(stats.name, "Battlefield 6");
  assert.equal(stats.sessionMs, 42 * MINUTE);
  assert.equal(stats.todayMs, 42 * MINUTE);
  assert.equal(stats.totalMs, 42 * MINUTE);
  assert.equal(stats.sessions, 1);
  assert.equal(stats.weekSessions, 1);
  assert.equal(log.games[battlefield.key].days[dayId(noon)].ms, 42 * MINUTE);
  end(log, noon + 42 * MINUTE);
  assert.equal(log.current, null);
  assert.equal(summary(log, battlefield.key, noon + HOUR).sessionMs, 0, "no session clock once it has ended");
  assert.equal(summary(log, battlefield.key, noon + HOUR).totalMs, 42 * MINUTE);
});

test("time while the dashboard was not watching is not play time", () => {
  const log = fresh();
  play(log, battlefield, noon, 10);
  // The PC slept for three hours with the game open, then the dashboard saw it again.
  assert.equal(seen(log, battlefield, noon + 10 * MINUTE + 3 * HOUR), true, "coming back after a silence is a new session");
  const stats = summary(log, battlefield.key, noon + 10 * MINUTE + 3 * HOUR);
  assert.equal(stats.totalMs, 10 * MINUTE);
  assert.equal(stats.sessions, 2);
  assert.equal(stats.sessionMs, 0);
  // touch() after a long silence adds nothing either.
  touch(log, noon + DAY);
  assert.equal(summary(log, battlefield.key, noon + DAY).totalMs, 10 * MINUTE);
  // The running clock never runs ahead by more than the allowed gap.
  assert.ok(summary(log, battlefield.key, noon + 3 * DAY).sessionMs <= MAX_GAP_MS);
});

test("switching games closes one session and opens the other", () => {
  const log = fresh();
  const wow = { key: "wow-forever", name: "World of Warcraft" };
  play(log, battlefield, noon, 30);
  assert.equal(seen(log, wow, noon + 30 * MINUTE + 10000), true);
  assert.equal(log.current.key, "wow-forever");
  assert.equal(summary(log, battlefield.key, noon + 31 * MINUTE).totalMs, 30 * MINUTE + 10000);
  assert.equal(summary(log, battlefield.key, noon + 31 * MINUTE).sessionMs, 0);
  assert.equal(seen(log, wow, noon + 30 * MINUTE + 20000), false, "the same game seen again is the same session");
  assert.equal(seen(log, { key: "", name: "Nothing" }, noon), false);
  assert.equal(seen(log, null, noon), false);
});

test("sessions this week and the day streak come from the days played", () => {
  const log = fresh();
  for (const daysAgo of [9, 3, 2, 1, 0]) play(log, battlefield, noon - daysAgo * DAY, 20), end(log, noon - daysAgo * DAY + 20 * MINUTE);
  play(log, battlefield, noon + 2 * HOUR, 5);
  const stats = summary(log, battlefield.key, noon + 2 * HOUR + 5 * MINUTE);
  assert.equal(stats.sessions, 6);
  assert.equal(stats.weekSessions, 5, "the session nine days ago is outside the week");
  assert.equal(stats.streakDays, 4, "today and the three days before it");
  assert.equal(stats.todayMs, 25 * MINUTE);
  assert.equal(stats.totalMs, 105 * MINUTE);
  // Not played yet today: the streak still stands through yesterday.
  const tomorrow = summary(log, battlefield.key, noon + DAY);
  assert.equal(tomorrow.streakDays, 4);
  assert.equal(summary(log, battlefield.key, noon + 2 * DAY).streakDays, 0, "a missed day ends it");
  assert.equal(summary(log, "steam:1", noon), null);
});

test("the welcome line fits the player's history", () => {
  assert.equal(historyLine(null), "First session here. Have a good one.");
  const first = fresh();
  seen(first, battlefield, noon);
  assert.equal(historyLine(summary(first, battlefield.key, noon)), "First session here. Have a good one.");
  const log = fresh();
  for (const daysAgo of [2, 1]) play(log, battlefield, noon - daysAgo * DAY, 90), end(log, noon - daysAgo * DAY + 90 * MINUTE);
  seen(log, battlefield, noon);
  end(log, noon + 1000);
  seen(log, battlefield, noon + HOUR);
  assert.equal(historyLine(summary(log, battlefield.key, noon + HOUR)), "Session 4 this week \u00b7 3 h played \u00b7 3-day streak");
  assert.equal(historyLine({ firstSession: false, weekSessions: 1, totalMs: 20 * MINUTE, streakDays: 1 }), "First session this week \u00b7 20 min played");
});

test("durations and the session clock read plainly", () => {
  assert.equal(formatDuration(0), "under a minute");
  assert.equal(formatDuration(59999), "under a minute");
  assert.equal(formatDuration(42 * MINUTE), "42 min");
  assert.equal(formatDuration(65 * MINUTE), "1 h 5 min");
  assert.equal(formatDuration(2 * HOUR), "2 h");
  assert.equal(formatDuration(12 * HOUR + 30 * MINUTE), "12 h", "long totals drop the minutes");
  assert.equal(formatDuration(-5), "under a minute");
  assert.equal(formatDuration("soon"), "under a minute");
  assert.equal(formatClock(0), "0:00:00");
  assert.equal(formatClock(42 * MINUTE + 10000), "0:42:10");
  assert.equal(formatClock(11 * HOUR + 5 * MINUTE + 9000), "11:05:09");
});

test("the log holds a key, a name and minutes, and survives bad storage", () => {
  const log = fresh();
  play(log, { key: "steam:2807960", name: "Battlefield 6", path: "C:\\Games\\bf6.exe", processName: "bf6.exe" }, noon, 3);
  assert.ok(!JSON.stringify(log).includes("bf6.exe"), "only the key and name are kept");
  const store = new Map();
  const storage = { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value) };
  assert.equal(save(storage, log), true);
  assert.deepEqual(load(storage), log);
  assert.ok(store.has(STORAGE_KEY));
  for (const broken of ["not json", "null", "[]", "{\"games\":7}", "{\"games\":{\"x\":null}}"]) {
    store.set(STORAGE_KEY, broken);
    assert.deepEqual(load(storage), fresh(), broken);
  }
  assert.deepEqual(load({ getItem() { throw new Error("blocked"); } }), fresh());
  assert.equal(save({ setItem() { throw new Error("full"); } }, log), false);
  // Wrong shapes inside a real log are dropped or bounded, and a session for a missing game is dropped.
  const cleaned = validate({ games: { "steam:1": { name: 5, totalMs: -3, sessions: "many", lastPlayed: 1e30, days: { "2026-11-13": { ms: 1e12, sessions: 2 }, yesterday: { ms: 5 } } } }, current: { key: "steam:9" } });
  assert.deepEqual(cleaned.games["steam:1"], { name: "Game", totalMs: 0, sessions: 0, lastPlayed: 8640000000000000, days: { "2026-11-13": { ms: DAY, sessions: 2 } } });
  assert.equal(cleaned.current, null);
});

test("only the 40 most recent games and 60 most recent days are kept", () => {
  const log = fresh();
  for (let index = 0; index < 45; index += 1) seen(log, { key: "game:" + index, name: "Game " + index }, noon + index * 5 * MINUTE);
  assert.equal(Object.keys(log.games).length, 40);
  assert.equal(log.games["game:0"], undefined, "the game played longest ago is forgotten first");
  assert.ok(log.games["game:44"]);
  const long = fresh();
  for (let day = 0; day < 70; day += 1) seen(long, battlefield, noon + day * DAY);
  assert.equal(Object.keys(long.games[battlefield.key].days).length, 60);
  assert.equal(long.games[battlefield.key].sessions, 70, "the total still counts every session");
});
