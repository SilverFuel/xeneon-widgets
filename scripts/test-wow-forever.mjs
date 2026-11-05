import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const { freshJournal, validateJournal, elapsedSession, formatSession } = require("../js/widgets/wow-forever.js");
const now = 1800000000000;

function entry(id = "quest-1", overrides = {}) {
  return { id, title: "Explore a new path", category: "Explore", done: false, ...overrides };
}

function invalid(change) {
  const journal = freshJournal();
  change(journal);
  assert.throws(() => validateJournal(journal, now), /Invalid journal/);
}

test("new journals are independent and survive a JSON round trip", () => {
  const first = freshJournal();
  const second = freshJournal();
  first.profile.name = "Test Adventurer";
  first.quests.push(entry());
  first.preparations[0] = true;
  first.session.elapsedMs = 1000;
  assert.equal(second.profile.name, "");
  assert.deepEqual(second.quests, []);
  assert.equal(second.preparations[0], false);
  assert.equal(second.session.elapsedMs, 0);
  assert.deepEqual(validateJournal(JSON.parse(JSON.stringify(first)), now), first);
});

test("malformed or unsupported backups fail instead of becoming an empty journal", () => {
  for (const value of [null, undefined, [], {}, "journal", 1, true]) {
    assert.throws(() => validateJournal(value, now), /Invalid journal/);
  }
  for (const version of [0, 2, "1", null]) invalid(journal => { journal.version = version; });
  invalid(journal => { delete journal.profile; });
  invalid(journal => { delete journal.session; });
  invalid(journal => { journal.quests = {}; });
  invalid(journal => { journal.notes = null; });
});

test("profile validation rejects invalid levels, wrong types, and unsupported choices", () => {
  for (const level of [0, 61, 1.5, "30", NaN, Infinity]) invalid(journal => { journal.profile.level = level; });
  invalid(journal => { journal.profile.name = 123; });
  invalid(journal => { journal.profile.className = "Death Knight"; });
  invalid(journal => { journal.profile.faction = "<script>"; });
  for (const [field, length] of [["name", 64], ["race", 40], ["zone", 80], ["hearth", 80], ["professions", 100]]) {
    const journal = freshJournal();
    journal.profile[field] = "a".repeat(length);
    assert.equal(validateJournal(journal, now).profile[field].length, length);
    invalid(value => { value.profile[field] = "a".repeat(length + 1); });
  }
});

test("quest and note limits bound backup size without truncating valid data", () => {
  const journal = freshJournal();
  journal.quests = Array.from({ length: 100 }, (_, index) => entry(`quest-${index}`, { title: "x".repeat(180) }));
  journal.notes = "n".repeat(20000);
  const validated = validateJournal(journal, now);
  assert.equal(validated.quests.length, 100);
  assert.equal(validated.notes.length, 20000);
  invalid(value => { value.quests = Array.from({ length: 101 }, (_, index) => entry(`quest-${index}`)); });
  invalid(value => { value.quests = [entry("quest-1", { title: "x".repeat(181) })]; });
  invalid(value => { value.notes = "x".repeat(20001); });
});

test("quest identifiers are unique and safe for DOM lookup", () => {
  invalid(journal => { journal.quests = [entry("duplicate"), entry("duplicate")]; });
  for (const id of ["", "space in id", 'quote"id', "x]", "a".repeat(81)]) {
    invalid(journal => { journal.quests = [entry(id)]; });
  }
  for (const override of [{ title: "  " }, { done: "false" }, { category: "Unknown" }]) {
    invalid(journal => { journal.quests = [entry("quest-1", override)]; });
  }
  const journal = freshJournal();
  journal.quests = [entry("abc_123-DEF", { title: "  A named objective  " })];
  assert.equal(validateJournal(journal, now).quests[0].title, "A named objective");
});

test("preparations and quest arrays cannot contain holes or invalid elements", () => {
  invalid(journal => { journal.quests = new Array(2); });
  invalid(journal => { journal.quests = [entry(), , entry("quest-2")]; });
  invalid(journal => { journal.quests = [null]; });
  invalid(journal => { journal.preparations = new Array(4); });
  invalid(journal => { journal.preparations = [true, , false, false]; });
  invalid(journal => { journal.preparations = [false, false, false]; });
  invalid(journal => { journal.preparations = [false, false, false, "false"]; });
});

test("HTML-looking text remains plain data and unrecognized fields are dropped", () => {
  const journal = freshJournal();
  const payload = '<img src=x onerror="alert(1)">';
  journal.profile.name = payload;
  journal.profile.race = payload;
  journal.notes = '</textarea><script>alert("note")</script>';
  journal.quests = [entry("quest-1", { title: payload, html: "not a recognized field" })];
  journal.unknown = "do not retain";
  journal.profile.unknown = "do not retain";
  const validated = validateJournal(journal, now);
  assert.equal(validated.profile.name, payload);
  assert.equal(validated.profile.race, payload);
  assert.equal(validated.quests[0].title, payload);
  assert.equal(validated.notes, journal.notes);
  assert.equal(Object.hasOwn(validated, "unknown"), false);
  assert.equal(Object.hasOwn(validated.profile, "unknown"), false);
  assert.equal(Object.hasOwn(validated.quests[0], "html"), false);
  assert.equal(Object.getPrototypeOf(validated), Object.prototype);
  // A rendering test must separately verify that this text is escaped in the DOM.
});

test("validation returns detached state so imports cannot alias caller-owned data", () => {
  const source = freshJournal();
  source.quests = [entry()];
  const validated = validateJournal(source, now);
  validated.profile.name = "Changed";
  validated.quests[0].done = true;
  validated.preparations[0] = true;
  validated.session.elapsedMs = 5000;
  assert.equal(source.profile.name, "");
  assert.equal(source.quests[0].done, false);
  assert.equal(source.preparations[0], false);
  assert.equal(source.session.elapsedMs, 0);
});

test("session state rejects non-finite, negative, oversized, and implausible timestamps", () => {
  for (const elapsedMs of [-1, 0.5, "0", Infinity, NaN, 315360000001]) {
    invalid(journal => { journal.session.elapsedMs = elapsedMs; });
  }
  for (const startedAt of [0, -1, 0.5, "1", undefined, Infinity, now + 300001]) {
    invalid(journal => { journal.session.startedAt = startedAt; });
  }
  const journal = freshJournal();
  journal.session.startedAt = now + 300000;
  assert.equal(elapsedSession(validateJournal(journal, now).session, now), 0);
});

test("running session survives navigation and delayed ticks without cumulative drift", () => {
  const journal = freshJournal();
  journal.session = { elapsedMs: 2500, startedAt: now };
  const restored = validateJournal(JSON.parse(JSON.stringify(journal)), now + 75000);
  assert.equal(elapsedSession(restored.session, now + 75000), 77500);
  assert.equal(elapsedSession(restored.session, now + 75001), 77501);
  assert.equal(elapsedSession(restored.session, now + 200000), 202500);
  assert.deepEqual(restored.session, journal.session);
});

test("pause, resume, clock rollback, and long durations keep consistent elapsed time", () => {
  const running = { elapsedMs: 10000, startedAt: now };
  assert.equal(elapsedSession(running, now - 10000), 10000);
  const paused = { elapsedMs: elapsedSession(running, now + 30000), startedAt: null };
  assert.equal(elapsedSession(paused, now + 900000), 40000);
  const resumed = { ...paused, startedAt: now + 900000 };
  assert.equal(elapsedSession(resumed, now + 905000), 45000);
  assert.equal(formatSession(0), "00:00:00");
  assert.equal(formatSession(59999), "00:00:59");
  assert.equal(formatSession(3661000), "01:01:01");
  assert.equal(formatSession(360000000), "100:00:00");
});

test("editing while import confirmation is pending cancels import and keeps removal undo visible", () => {
  const widget = readFileSync(new URL("../js/widgets/wow-forever.js", import.meta.url), "utf8");
  const buttonStart = widget.indexOf("  function button(");
  const buttonEnd = widget.indexOf("  function options(");
  const saveStart = widget.indexOf("    function showNotice(");
  const saveEnd = widget.indexOf("    function profileMarkup(");
  assert.ok(buttonStart >= 0 && buttonEnd > buttonStart && saveStart >= 0 && saveEnd > saveStart);
  const productionFunctions = widget.slice(buttonStart, buttonEnd) + widget.slice(saveStart, saveEnd);

  for (const storageFails of [false, true]) {
    const journal = freshJournal();
    journal.notes = "Current adventure";
    const pendingImport = freshJournal();
    pendingImport.notes = "Backup adventure";
    const noticeNode = { innerHTML: "", hidden: false };
    const statusNode = { textContent: "", dataset: {} };
    const writes = [];
    const removed = entry();
    const undo = () => { journal.quests.push(removed); };
    const fixture = {
      STORAGE_KEY: "journal-test",
      journal,
      pendingImport,
      undo,
      notice: "",
      storageProblem: "",
      storageWritable: true,
      query(selector) { return selector === ".wow-notice" ? noticeNode : statusNode; },
      escapeHtml: value => String(value),
      window: {
        localStorage: {
          setItem(key, value) {
            if (storageFails) throw new Error("Storage full");
            writes.push({ key, value: JSON.parse(value) });
          }
        }
      }
    };
    runInNewContext(productionFunctions, fixture);
    fixture.showNotice();
    assert.match(noticeNode.innerHTML, /data-wow-action="confirm-import"/);
    fixture.save("Entry removed.", true);
    assert.equal(fixture.pendingImport, null);
    assert.equal(fixture.undo, undo);
    assert.match(noticeNode.innerHTML, /data-wow-action="undo"/);
    assert.doesNotMatch(noticeNode.innerHTML, /data-wow-action="confirm-import"/);
    assert.match(noticeNode.innerHTML, /Import cancelled because the journal changed/);
    assert.equal(noticeNode.hidden, false);
    if (storageFails) {
      assert.equal(writes.length, 0);
      assert.match(statusNode.textContent, /Changes are not saved/);
    } else {
      assert.equal(writes.length, 1);
      assert.equal(writes[0].value.notes, "Current adventure");
    }
    fixture.undo();
    assert.equal(journal.quests[0], removed);
  }
});
