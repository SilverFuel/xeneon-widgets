import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const { view, sessions, elapsed, nextPollMs } = createRequire(import.meta.url)("../js/claude-watch.js");

const session = (state, extra = {}) => ({ id: "abc12345", project: "auxora", state, text: "", stateSeconds: 20, idleSeconds: 5, ...extra });

test("nothing is shown with no sessions, a bad reply, or a session that is only open", () => {
  for (const payload of [null, undefined, {}, { sessions: "no" }, { sessions: [] }, { sessions: [null, 7, "x", { state: "ready" }, { state: "made-up" }] }]) {
    assert.equal(view(payload, ""), null, JSON.stringify(payload));
  }
});

test("a decision someone is waiting on comes before everything else, the longest wait first", () => {
  const shown = view({ sessions: [
    session("working", { id: "w1", project: "faction-forge" }),
    session("waiting", { id: "q1", project: "auxora", text: "Run: git push origin main", stateSeconds: 12 }),
    session("waiting", { id: "q2", project: "mission-board", text: "Edit: schema.sql", stateSeconds: 240 }),
    session("done", { id: "d1" })
  ] }, "");
  assert.equal(shown.state, "waiting");
  assert.equal(shown.title, "Claude needs you");
  assert.equal(shown.detail, "mission-board · Edit: schema.sql · waiting 4 min · +1 more waiting");
  assert.equal(shown.flash, true);
  assert.equal(shown.waitingCount, 2);
  assert.equal(shown.label, "Claude needs you: mission-board · Edit: schema.sql · waiting 4 min · +1 more waiting. Tap to stop the flashing.");
  assert.equal(shown.announce, "Claude needs you: mission-board · Edit: schema.sql");
});

test("a wait that was tapped stays up but stops flashing, until what is asked changes", () => {
  const payload = { sessions: [session("waiting", { text: "Run: npm test" })] };
  const first = view(payload, "");
  const seen = view(payload, first.key);
  assert.equal(seen.state, "waiting");
  assert.equal(seen.flash, false);
  assert.doesNotMatch(seen.label, /Tap/);
  const next = view({ sessions: [session("waiting", { text: "Run: git push" })] }, first.key);
  assert.equal(next.flash, true, "a new question flashes again");
});

test("working shows the project and how long, and a long-silent session is left out", () => {
  const shown = view({ sessions: [session("working", { stateSeconds: 250 }), session("working", { id: "other", project: "homeos", idleSeconds: 90 })] }, "");
  assert.equal(shown.title, "Claude working");
  assert.equal(shown.detail, "auxora · 4 min · +1 more");
  assert.equal(shown.flash, false);
  assert.equal(shown.quiet, false);
  assert.equal(shown.announce, "", "a working session is never announced");
  assert.equal(view({ sessions: [session("working", { idleSeconds: 31 * 60 })] }, ""), null);
});

test("finished shows for ten minutes and can be put away with a tap", () => {
  const payload = { sessions: [session("done", { text: "Pushed the branch.", stateSeconds: 90 })] };
  const shown = view(payload, "");
  assert.equal(shown.title, "Claude finished");
  assert.equal(shown.detail, "auxora · Pushed the branch.");
  assert.equal(shown.label, "Claude finished: auxora · Pushed the branch. Tap to put this away.");
  assert.equal(view(payload, shown.key), null, "put away");
  assert.equal(view({ sessions: [session("done", { stateSeconds: 11 * 60 })] }, ""), null, "too long ago");
  const stopped = view({ sessions: [session("error", { text: "Stopped on an error" }), session("working", { id: "w" })] }, "");
  assert.equal(stopped.title, "Claude stopped", "an error comes before a working session");
});

test("what the host sends is tidied: one line, bounded, no unknown fields", () => {
  const [clean] = sessions({ sessions: [{ id: "x".repeat(60), project: "  my\n project  ", state: "waiting", text: "a\tb\n" + "y".repeat(400), stateSeconds: "12.9", idleSeconds: -4, path: "C:\\secret" }] });
  assert.equal(clean.id.length, 16);
  assert.equal(clean.project, "my project");
  assert.equal(clean.text.length, 200);
  assert.ok(clean.text.startsWith("a b y"));
  assert.equal(clean.stateSeconds, 12);
  assert.equal(clean.idleSeconds, 0);
  assert.equal("path" in clean, false);
  assert.equal(sessions({ sessions: [{ state: "working" }] })[0].project, "a session");
});

test("elapsed time reads in minutes, then hours", () => {
  assert.equal(elapsed(0), "just now");
  assert.equal(elapsed(59), "just now");
  assert.equal(elapsed(60), "1 min");
  assert.equal(elapsed(3599), "59 min");
  assert.equal(elapsed(3600 + 12 * 60), "1 h 12 min");
  assert.equal(elapsed("soon"), "just now");
});

test("the host is asked often only while a session is live", () => {
  assert.equal(nextPollMs(null), 15000);
  assert.equal(nextPollMs({ sessions: [session("done")] }), 15000);
  assert.equal(nextPollMs({ sessions: [session("working", { idleSeconds: 40 * 60 })] }), 15000);
  assert.equal(nextPollMs({ sessions: [session("working")] }), 3000);
  assert.equal(nextPollMs({ sessions: [session("waiting", { idleSeconds: 5 * 3600 })] }), 3000);
});

test("a working session shows its latest step, or how long it has been quiet", () => {
  const moving = view({ sessions: [session("working", { text: "Ran: npm run check", stateSeconds: 700, idleSeconds: 12 })] }, "");
  assert.equal(moving.detail, "auxora · 11 min · Ran: npm run check");
  assert.equal(moving.quiet, false);
  const quiet = view({ sessions: [session("working", { text: "Ran: npm run check", stateSeconds: 1100, idleSeconds: 400 })] }, "");
  assert.equal(quiet.title, "Claude working");
  assert.equal(quiet.detail, "auxora · 18 min · quiet for 6 min");
  assert.equal(quiet.quiet, true);
  assert.equal(view({ sessions: [session("working", { idleSeconds: 299 })] }, "").quiet, false);
});

test("a wait says how long it has been waiting once a minute has passed, without changing what a tap remembers", () => {
  const fresh = view({ sessions: [session("waiting", { text: "Run: git push", stateSeconds: 40 })] }, "");
  assert.equal(fresh.detail, "auxora · Run: git push");
  const later = view({ sessions: [session("waiting", { text: "Run: git push", stateSeconds: 200 })] }, fresh.key);
  assert.equal(later.detail, "auxora · Run: git push · waiting 3 min");
  assert.equal(later.key, fresh.key);
  assert.equal(later.flash, false, "still seen three minutes on");
  assert.equal(later.announce, "Claude needs you: auxora · Run: git push", "the announcement does not carry the clock");
});

test("two sessions that say the same thing are still two announcements", () => {
  const first = session("waiting", { id: "one", text: "Run: npm test", stateSeconds: 90 });
  const second = session("waiting", { id: "two", text: "Run: npm test", stateSeconds: 30 });
  const both = view({ sessions: [first, second] }, "");
  const after = view({ sessions: [second] }, "");
  assert.equal(both.announce, after.announce, "the words are the same");
  assert.notEqual(both.announceKey, after.announceKey, "the key is not, so the second is said too");
  assert.equal(view({ sessions: [session("working")] }, "").announceKey, "");
  const finishedA = view({ sessions: [session("done", { id: "a", text: "Done.", stateSeconds: 50 })] }, "");
  const finishedB = view({ sessions: [session("done", { id: "a", text: "Done.", stateSeconds: 50 }), session("done", { id: "b", text: "Done.", stateSeconds: 5 })] }, "");
  assert.notEqual(finishedA.key, finishedB.key, "a newer finish is a different view, so its glow can start again");
});
