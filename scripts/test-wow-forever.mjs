import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const { freshJournal, validateJournal, elapsedSession, formatSession, formatCoins, formatSavedAgo, gameCharacter } = require("../js/widgets/wow-forever.js");
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
      originalUnreadable: null,
      importRequestId: 0,
      readingImport: false,
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

function journalHarness({ saved = null, failWrites = false } = {}) {
  const nodes = new Map();
  const handlers = new Map();
  const downloads = [];
  let renderer;
  let writesFail = failWrites;
  let stored = saved;
  const container = {
    innerHTML: "",
    querySelector(selector) {
      if (selector === ".wow-recovery" && !container.innerHTML.includes('class="wow-recovery wow-card"')) return null;
      if (!nodes.has(selector)) nodes.set(selector, {
        innerHTML: "", textContent: "", hidden: true, dataset: {}, value: "",
        setAttribute() {}, focus() {}, click() {},
        remove() { container.innerHTML = container.innerHTML.replace('class="wow-recovery wow-card"', 'class="removed-recovery"'); }
      });
      return nodes.get(selector);
    },
    querySelectorAll() { return []; },
    contains() { return true; },
    appendChild() {}
  };
  const runtime = {
    escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
    registerRenderer(id, mount) { renderer = mount; },
    addListener(cleanups, target, type, handler) { handlers.set(type, handler); },
    createTimerLoop() { return { start() {}, refresh() {}, destroy() {} }; },
    runCleanups() { handlers.clear(); }
  };
  runInNewContext(readFileSync(new URL("../js/widgets/wow-forever.js", import.meta.url), "utf8"), {
    window: {
      InlineWidgets: { runtime },
      localStorage: {
        getItem() { return stored; },
        setItem(key, value) { if (writesFail) throw new Error("Storage full"); stored = value; }
      }
    },
    document: { createElement() { return { click() {}, remove() {} }; } },
    Blob,
    URL: { createObjectURL(blob) { downloads.push(blob); return "blob:test"; }, revokeObjectURL() {} }
  });
  const instance = renderer({}, container);
  function click(action, extra = {}) {
    const target = { dataset: { wowAction: action, ...extra }, closest() { return this; }, hasAttribute() { return false; } };
    handlers.get("click")({ target });
  }
  return {
    instance, container, downloads, click,
    get stored() { return stored; },
    set failWrites(value) { writesFail = value; },
    get notice() { return container.querySelector(".wow-notice").innerHTML; },
    get status() { return container.querySelector(".wow-save-status").textContent; },
    chooseFile(file) {
      handlers.get("change")({ target: { files: [file], value: "", hasAttribute() { return false; }, matches: selector => selector === ".wow-backup-file" } });
    },
    editNotes(value) { handlers.get("input")({ target: { id: "wow-field-notes", value } }); }
  };
}

function backupFile(name) {
  const journal = freshJournal();
  journal.profile.name = name;
  return { size: 1000, text: async () => JSON.stringify(journal) };
}

async function flushImport() {
  await Promise.resolve();
  await Promise.resolve();
}

test("selecting an oversized or unreadable backup clears the earlier import confirmation", async () => {
  for (const replacement of [
    { size: 256 * 1024 + 1 },
    { size: 100, text: async () => { throw new Error("File missing"); } }
  ]) {
    const fixture = journalHarness();
    fixture.chooseFile(backupFile("Earlier backup"));
    await flushImport();
    assert.match(fixture.notice, /confirm-import/);
    fixture.chooseFile(replacement);
    await flushImport();
    assert.doesNotMatch(fixture.notice, /confirm-import/);
    fixture.click("confirm-import");
    assert.equal(fixture.stored, null);
    fixture.instance.destroy();
  }
});

test("the latest backup selection wins when file reads finish out of order", async () => {
  for (const failFirst of [false, true]) {
    const fixture = journalHarness();
    let finishFirst;
    fixture.chooseFile({ size: 100, text: () => new Promise((resolve, reject) => { finishFirst = failFirst ? reject : resolve; }) });
    fixture.chooseFile(backupFile("Latest backup"));
    await flushImport();
    finishFirst(failFirst ? new Error("Old read failed") : await backupFile("Old backup").text());
    await flushImport();
    assert.match(fixture.notice, /Latest backup/);
    fixture.click("confirm-import");
    assert.equal(JSON.parse(fixture.stored).profile.name, "Latest backup");
    fixture.instance.destroy();
  }
});

test("editing the journal cancels a backup that is still being read", async () => {
  const fixture = journalHarness();
  let finishRead;
  fixture.chooseFile({ size: 100, text: () => new Promise(resolve => { finishRead = resolve; }) });
  fixture.editNotes("Keep these new notes");
  finishRead(await backupFile("Old backup").text());
  await flushImport();
  assert.doesNotMatch(fixture.notice, /confirm-import/);
  fixture.click("confirm-import");
  assert.equal(JSON.parse(fixture.stored).notes, "Keep these new notes");
  fixture.instance.destroy();
});

test("failed recovery replacement preserves the original export until saving succeeds", async () => {
  for (const action of ["confirm-import", "new-journal"]) {
    const original = "unreadable original journal";
    const fixture = journalHarness({ saved: original, failWrites: true });
    if (action === "confirm-import") {
      fixture.chooseFile(backupFile("Recovered character"));
      await flushImport();
    }
    fixture.click(action, { confirm: "true" });
    assert.equal(fixture.stored, original);
    assert.match(fixture.status, /Changes are not saved/);
    assert.match(fixture.container.innerHTML, /class="wow-recovery wow-card"/);
    fixture.click("export-recovery");
    assert.equal(await fixture.downloads[0].text(), original);
    fixture.failWrites = false;
    fixture.editNotes("Recovery saved");
    assert.equal(JSON.parse(fixture.stored).notes, "Recovery saved");
    assert.doesNotMatch(fixture.container.innerHTML, /class="wow-recovery wow-card"/);
    fixture.instance.destroy();
  }
});

// What the native host returns for a character the Auxora Companion add-on saved.
function companionPayload(overrides = {}) {
  return {
    gameFound: true, installed: true, available: true, addonVersion: "0.1.1", message: "Type /auxora in game to update.",
    character: {
      name: "Grimbold", realm: "Forever One", class: "Paladin", classToken: "PALADIN", race: "Undead", faction: "Horde",
      level: 18, xp: 16733, xpMax: 19400, xpRested: 3000, zone: "Hillsbrad Foothills", subZone: "Tarren Mill",
      home: "The Sepulcher", copper: 25098, savedAt: "2026-11-12T05:31:30+00:00", questsRead: true,
      quests: [
        { title: "The Rescue", zone: "Hillsbrad Foothills", level: 22, complete: false, objectives: [{ text: "0/1 Rescue Drull", done: false }] },
        { title: "Deathstalkers in Shadowfang", zone: "Shadowfang Keep", level: 25, complete: true, objectives: [] }
      ],
      ...overrides
    }
  };
}

test("coins are shown as gold, silver and copper", () => {
  assert.equal(formatCoins(25098), "2g 50s 98c");
  assert.equal(formatCoins(12345678), "1,234g 56s 78c");
  assert.equal(formatCoins(10000), "1g 0s 0c");
  assert.equal(formatCoins(250), "2s 50c");
  assert.equal(formatCoins(7), "7c");
  for (const value of [0, -5, NaN, Infinity, null, undefined, "many"]) assert.equal(formatCoins(value), "0c");
});

test("the age of the game's last save reads in plain words", () => {
  const saved = "2026-11-12T05:00:00+00:00";
  const at = minutes => Date.parse(saved) + minutes * 60000;
  assert.equal(formatSavedAgo(saved, at(0.5)), "just now");
  assert.equal(formatSavedAgo(saved, at(1)), "1 minute ago");
  assert.equal(formatSavedAgo(saved, at(59)), "59 minutes ago");
  assert.equal(formatSavedAgo(saved, at(60)), "1 hour ago");
  assert.equal(formatSavedAgo(saved, at(60 * 23)), "23 hours ago");
  assert.equal(formatSavedAgo(saved, at(60 * 24)), "1 day ago");
  assert.equal(formatSavedAgo(saved, at(60 * 24 * 9)), "9 days ago");
  assert.equal(formatSavedAgo(saved, at(-30)), "just now", "a clock that runs behind must not show a negative age");
  for (const value of ["", "soon", null, undefined, 5]) assert.equal(formatSavedAgo(value, at(1)), "");
});

test("the game's character is read from the host's reply", () => {
  const character = gameCharacter(companionPayload());
  assert.deepEqual(
    { name: character.name, race: character.race, className: character.className, faction: character.faction, level: character.level },
    { name: "Grimbold", race: "Undead", className: "Paladin", faction: "Horde", level: 18 });
  assert.deepEqual([character.zone, character.subZone, character.hearth], ["Hillsbrad Foothills", "Tarren Mill", "The Sepulcher"]);
  assert.deepEqual([character.xp, character.xpMax, character.rested, character.coins], [16733, 19400, 3000, "2g 50s 98c"]);
  assert.ok(Math.abs(character.xpPercent - 86.25) < 0.01);
  assert.deepEqual(character.quests, [
    { title: "The Rescue", zone: "Hillsbrad Foothills", level: 22, complete: false, objectives: [{ text: "0/1 Rescue Drull", done: false }] },
    { title: "Deathstalkers in Shadowfang", zone: "Shadowfang Keep", level: 25, complete: true, objectives: [] }
  ]);
});

test("no character is shown unless the host says one is available", () => {
  for (const payload of [null, undefined, "text", 5, [], {}, { available: true }, { available: true, character: null },
    { available: true, character: { name: "" } }, { available: true, character: { name: 7 } },
    { ...companionPayload(), available: false }, { ...companionPayload(), available: "true" }]) {
    assert.equal(gameCharacter(payload), null);
  }
});

test("a reply with the wrong types cannot break or mislead the panel", () => {
  const character = gameCharacter(companionPayload({
    race: 4, class: null, faction: "<script>", level: "eighteen", xp: 500, xpMax: 0, xpRested: -3, zone: {}, subZone: [], home: undefined,
    copper: "lots", savedAt: 12,
    quests: [null, "quest", { title: "" }, { title: 9 }, { title: "Kept", level: -2, complete: "yes", objectives: [null, { text: 5 }, { text: "Step", done: 1 }] }]
  }));
  assert.deepEqual([character.race, character.className, character.faction, character.level], ["", "", "Horde", 0]);
  assert.deepEqual([character.xpPercent, character.rested, character.zone, character.subZone, character.hearth, character.coins, character.savedAt], [0, 0, "", "", "", "0c", ""]);
  assert.deepEqual(character.quests, [{ title: "Kept", zone: "", level: 0, complete: false, objectives: [{ text: "Step", done: false }] }]);
  assert.equal(gameCharacter(companionPayload({ xp: 30000, xpMax: 19400 })).xpPercent, 100);
  assert.equal(gameCharacter(companionPayload({ faction: "Alliance" })).faction, "Alliance");
  const many = gameCharacter(companionPayload({
    quests: Array.from({ length: 90 }, (_, index) => ({ title: `Quest ${index}`, objectives: Array.from({ length: 20 }, (_, step) => ({ text: `step ${step}` })) }))
  }));
  assert.equal(many.quests.length, 40);
  assert.equal(many.quests[0].objectives.length, 8);
});
