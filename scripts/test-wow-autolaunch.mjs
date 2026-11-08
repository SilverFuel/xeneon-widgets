import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createRequire } from "node:module";

const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");
const navigation = createRequire(import.meta.url)("../js/dashboard-navigation.js");
function functionsBetween(start, end) {
  const first = dashboard.indexOf(`  function ${start}(`);
  const last = dashboard.indexOf(`  function ${end}(`);
  assert.ok(first >= 0 && last > first, `routing functions ${start} through ${end} must exist`);
  return dashboard.slice(first, last);
}
const source = functionsBetween("activeGameIdFromPayload", "restorePreGamePerformanceBudget")
  + functionsBetween("handleGameActivity", "refreshGameActivity")
  + functionsBetween("isLiveGameThemeActive", "refreshAmbientCanvasPalette");

function harness(panel = "home", enabled = true) {
  const selections = [];
  const timers = new Map();
  let nextTimer = 0;
  const context = {
    currentWidgetId: panel,
    primaryDestination: navigation.sectionForWidget(panel) || "home",
    navigation,
    gameActivity: null,
    gameFacePreviousWidgetId: "",
    gameFaceLastActiveId: "",
    gameFaceLastProcessId: 0,
    gameFaceLastStartedAt: 0,
    gameFaceAutoOpenedGameId: "",
    gameFaceSuppressedGameId: "",
    pendingGameFaceAutoOpenId: "",
    pendingGameFaceTimerId: 0,
    dashboardInteractionActive: false,
    modeActivationPending: false,
    dashboardInteractionTimerId: 0,
    quickDrawerNode: { open: false },
    locked: false,
    window: {
      setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout(id) { timers.delete(id); }
    },
    getSetting: () => enabled ? "1" : "0",
    isTouchLockEnabled: () => context.locked,
    isDrawerOpen: node => node.open,
    getFallbackPrimaryWidget: () => "home",
    selectWidget(id, persist) {
      selections.push({ id, persist });
      context.currentWidgetId = id;
      context.primaryDestination = navigation.sectionForWidget(id);
    },
    showTouchFeedback() {},
    applyDashboardPresentation() {},
    renderDashboardChromeState() {},
    restoredBudget: 0,
    clearedTheme: 0,
    restorePreGamePerformanceBudget() { context.restoredBudget++; },
    clearTransientGameTheme() { context.clearedTheme++; }
  };
  runInNewContext(source, context);
  return { context, selections, timers };
}
function activity(game = {}) {
  return { active: true, activeGame: { id: "forever-client", name: "World of Warcraft", gameKey: "wow-forever", ...game } };
}

test("Forever opens the journal from Home, ordinary panels, or the generic game screen", () => {
  for (const panel of ["home", "system", "game-mode"]) {
    const { context, selections } = harness(panel);
    context.handleGameActivity(activity());
    assert.deepEqual(selections, [{ id: "wow-forever", persist: false }]);
    assert.equal(context.gameFacePreviousWidgetId, panel);
  }
});

test("native game identity is authoritative even when a client is renamed", () => {
  const { context } = harness();
  assert.equal(context.gameFaceWidgetIdFromPayload(activity({ name: "My pinned client" })), "wow-forever");
  for (const gameKey of ["", "retail", null]) {
    assert.equal(context.gameFaceWidgetIdFromPayload(activity({ gameKey, name: "World of Warcraft: Forever" })), "game-mode");
  }
});

test("Forever opens even when another running game has a higher detection priority", () => {
  const { context, selections } = harness("game-mode");
  const payload = activity({ id: "other-game", name: "Another game", gameKey: "" });
  payload.candidates = [payload.activeGame, activity().activeGame];
  context.handleGameActivity(payload);
  assert.deepEqual(selections, [{ id: "wow-forever", persist: false }]);
  context.currentWidgetId = "audio";
  context.handleGameActivity(payload);
  assert.equal(selections.length, 1);
  assert.equal(context.gameFaceAutoOpenedGameId, "forever-client");
});

test("older payloads require an explicit Forever identity, never generic WoW or a launcher", () => {
  const { context } = harness();
  for (const game of [
    { name: "World of Warcraft: Forever" },
    { name: "  WoW Forever  " },
    { name: "World of Warcraft", executablePath: "C:\\Program Files (x86)\\World of Warcraft\\_forever_\\Wow.exe" },
    { executablePath: "D:/Games/_FOREVER_/WOW.EXE" }
  ]) assert.equal(context.gameFaceWidgetIdFromPayload({ active: true, activeGame: game }), "wow-forever");
  for (const game of [
    { name: "World of Warcraft" },
    { name: "Wow", processName: "Wow.exe" },
    { name: "World of Warcraft Classic" },
    { name: "World of Warcraft: Forever", executablePath: "D:/WoW/_retail_/Wow.exe" },
    { name: "World of Warcraft: Forever", executablePath: "D:/WoW/_classic_/Wow.exe" },
    { name: "World of Warcraft: Forever", executablePath: "D:/WoW/_forever_/Battle.net.exe" },
    { name: "World of Warcraft: Forever", processName: "Battle.net.exe" },
    { name: "WoW Forever Launcher" },
    { executablePath: "D:/WoW/_forever_beta_/Wow.exe" }
  ]) assert.equal(context.gameFaceWidgetIdFromPayload({ active: true, activeGame: game }), "game-mode");
  assert.equal(context.gameFaceWidgetIdFromPayload({ active: false, activeGame: { gameKey: "wow-forever" } }), "game-mode");
});

test("polling, refocusing, and transient connection loss do not reopen a dismissed journal", () => {
  const { context, selections } = harness();
  context.handleGameActivity(activity());
  context.currentWidgetId = "audio";
  context.handleGameActivity(activity({ focused: false }));
  context.handleGameActivity(null);
  context.handleGameActivity(activity({ focused: true }));
  assert.equal(selections.length, 1);
  assert.equal(context.currentWidgetId, "audio");
  context.handleGameActivity({ active: false, status: "ended" });
  context.handleGameActivity(activity());
  assert.equal(selections.length, 2);
  assert.equal(context.currentWidgetId, "wow-forever");
});

test("an already open journal counts as handled for the current session", () => {
  const { context, selections } = harness("wow-forever");
  context.handleGameActivity(activity());
  context.currentWidgetId = "network";
  context.handleGameActivity(activity());
  assert.equal(selections.length, 0);
  assert.equal(context.currentWidgetId, "network");
});

test("restarting the same game between polls opens the journal for the new launch", () => {
  for (const changed of [
    { processId: 203 },
    { startedAt: "2026-11-07T20:01:00Z" }
  ]) {
    const { context, selections } = harness();
    const initial = { processId: 101, startedAt: "2026-11-07T20:00:00Z" };
    context.handleGameActivity(activity(initial));
    context.currentWidgetId = "audio";
    context.gameFaceSuppressedGameId = "forever-client";
    context.handleGameActivity(activity({ ...initial, ...changed }));
    assert.equal(selections.length, 2);
    assert.equal(context.currentWidgetId, "wow-forever");
    assert.equal(context.gameFaceSuppressedGameId, "");
  }
});

test("missing or newly available process metadata does not reopen the same session", () => {
  const { context, selections } = harness();
  context.handleGameActivity(activity());
  context.currentWidgetId = "audio";
  const identity = { processId: 101, startedAt: "2026-11-07T20:00:00Z" };
  context.handleGameActivity(activity(identity));
  context.handleGameActivity(activity({ processId: null, startedAt: "invalid" }));
  context.handleGameActivity(activity({ ...identity, startedAt: "2026-11-07T20:00:00.000+00:00" }));
  assert.equal(selections.length, 1);
  assert.equal(context.currentWidgetId, "audio");
});

test("untrusted active snapshots cannot open a panel or consume a launch", () => {
  for (const flags of [{ stale: true }, { supported: false }, { status: "error" }, { status: "unavailable" }]) {
    const { context, selections, timers } = harness();
    context.handleGameActivity({ ...activity(), ...flags });
    assert.equal(selections.length, 0);
    assert.equal(timers.size, 0);
    assert.equal(context.gameFaceAutoOpenedGameId, "");
    assert.equal(context.isLiveGameThemeActive(), false);
    context.handleGameActivity(activity());
    assert.equal(selections.length, 1);
  }
});

test("transient failures preserve game presentation until an observed session end", () => {
  const { context } = harness();
  context.handleGameActivity(activity());
  for (const payload of [null, { active: false, status: "error" }, { active: false, status: "idle", stale: true }]) {
    context.handleGameActivity(payload);
    assert.equal(context.restoredBudget, 0);
    assert.equal(context.clearedTheme, 0);
    assert.equal(context.isLiveGameThemeActive(), true);
  }
  context.handleGameActivity({ active: false, status: "ended" });
  assert.equal(context.restoredBudget, 1);
  assert.equal(context.clearedTheme, 1);
  assert.equal(context.isLiveGameThemeActive(), false);
});

test("untrusted game snapshots cannot switch automatic Modes or delay the next valid evaluation", async () => {
  const requests = [];
  const context = {
    lastSceneEvaluationAt: 0,
    bridgeOrigin: "http://fixture.invalid",
    bridgeConfig: {},
    buildUrl: (origin, path) => origin + path,
    fetchJson: async () => ({}),
    postJson: async (url, body) => { requests.push({ url, body }); return {}; },
    applyScenePresentation() {}, renderQuickDrawer() {}, showTouchFeedback() {},
    console: { warn: error => { throw error; } }
  };
  runInNewContext(functionsBetween("evaluateSceneContext", "scheduleGameActivityLoop"), context);
  for (const invalid of [null, { ...activity(), stale: true }, { ...activity(), supported: false },
    { active: false, status: "error" }, { active: false, status: "unavailable" }, { active: false, status: "ended", stale: true }]) {
    context.evaluateSceneContext(invalid);
    assert.equal(context.lastSceneEvaluationAt, 0);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 0);
  context.evaluateSceneContext(activity());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.activeGame, "World of Warcraft");
  context.lastSceneEvaluationAt = 0;
  context.evaluateSceneContext({ active: false, status: "ended" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.activeGame, "");
});

test("failed, unsupported, and stale native snapshots do not end the current session", () => {
  const { context, selections } = harness();
  context.handleGameActivity(activity());
  context.currentWidgetId = "audio";
  for (const payload of [
    { active: false, status: "error", mode: "idle" },
    { active: false, status: "unavailable" },
    { active: false, status: "idle", supported: false },
    { active: false, status: "ended", stale: true }
  ]) {
    context.handleGameActivity(payload);
    context.handleGameActivity(activity());
    assert.equal(selections.length, 1);
    assert.equal(context.currentWidgetId, "audio");
  }
});

test("Settings, Quick controls, pending Modes, touch lock, and active interaction defer opening until navigation is safe", () => {
  for (const reason of ["settings", "quick", "mode", "locked", "interaction"]) {
    const { context, selections } = harness();
    if (reason === "settings") context.primaryDestination = "settings";
    if (reason === "quick") context.quickDrawerNode.open = true;
    if (reason === "mode") context.modeActivationPending = true;
    if (reason === "locked") context.locked = true;
    if (reason === "interaction") context.dashboardInteractionActive = true;
    context.handleGameActivity(activity());
    assert.equal(selections.length, 0, reason);
    context.maybeOpenPendingGameFace();
    assert.equal(selections.length, 0, reason);
    context.primaryDestination = "home";
    context.quickDrawerNode.open = false;
    context.modeActivationPending = false;
    context.locked = false;
    context.dashboardInteractionActive = false;
    context.maybeOpenPendingGameFace();
    assert.deepEqual(selections, [{ id: "wow-forever", persist: false }], reason);
  }
});

test("every editable Settings category keeps game navigation pending until real section navigation and idle", () => {
  const categories = navigation.tabsForSection("settings").map(tab => tab.id).filter(id => id !== "setup");
  for (const panel of categories) {
    const { context, selections, timers } = harness(panel);
    context.handleGameActivity(activity());
    context.maybeOpenPendingGameFace();
    assert.equal(selections.length, 0, `${panel}: an idle Settings page must not be replaced`);
    assert.equal(context.pendingGameFaceAutoOpenId, "forever-client", panel);

    const rendered = [];
    context.getWidgetById = id => navigation.sectionForWidget(id) ? { id } : null;
    context.primaryDestinationStorageKey = "auxora-dashboard-destination";
    context.window.localStorage = { setItem() {} };
    context.renderPrimaryNavigation = () => {};
    context.persistDestinationPanel = () => {};
    context.renderCurrentSelection = () => rendered.push(context.currentWidgetId);
    context.persistWidgetChoice = () => {};
    context.setQueryParam = () => {};
    runInNewContext(functionsBetween("selectWidget", "showLocalhostWarning"), context);

    context.selectWidget(panel === "theme-studio" ? "layout-editor" : "theme-studio", true);
    assert.equal(context.primaryDestination, "settings", panel);
    context.maybeOpenPendingGameFace();
    assert.notEqual(context.currentWidgetId, "wow-forever", `${panel}: changing Settings categories stays deferred`);

    context.dashboardInteractionActive = true;
    context.selectWidget("home", true);
    assert.equal(context.currentWidgetId, "home", `${panel}: leaving must preserve the existing idle interval`);
    assert.ok(context.dashboardInteractionTimerId, `${panel}: real section navigation must schedule pending release`);
    const release = timers.get(context.dashboardInteractionTimerId);
    assert.equal(typeof release, "function", panel);
    release();
    assert.equal(context.currentWidgetId, "wow-forever", `${panel}: pending navigation resumes without a new game snapshot`);
    assert.equal(context.primaryDestination, "gaming", panel);
    assert.deepEqual(rendered.slice(-2), ["home", "wow-forever"], panel);
    assert.equal(context.pendingGameFaceAutoOpenId, "", panel);
  }
});

test("stopping Forever while opening is deferred cancels the pending navigation", () => {
  const { context, selections, timers } = harness();
  context.dashboardInteractionActive = true;
  context.handleGameActivity(activity());
  assert.ok(timers.size > 0);
  context.handleGameActivity({ active: false, status: "ended" });
  context.dashboardInteractionActive = false;
  context.maybeOpenPendingGameFace();
  assert.equal(selections.length, 0);
  assert.equal(timers.size, 0);
});

test("switching games while deferred uses the current game instead of the old request", () => {
  const { context, selections } = harness();
  context.primaryDestination = "settings";
  context.handleGameActivity(activity());
  context.handleGameActivity(activity({ id: "other-game", gameKey: "", name: "Another game" }));
  context.primaryDestination = "home";
  context.maybeOpenPendingGameFace();
  assert.deepEqual(selections, [{ id: "game-mode", persist: false }]);
});

test("disabled auto-open, explicit suppression, and Diagnostics remain respected", () => {
  const disabled = harness("home", false);
  disabled.context.handleGameActivity(activity());
  assert.equal(disabled.selections.length, 0);
  const diagnostics = harness("setup");
  diagnostics.context.handleGameActivity(activity());
  assert.equal(diagnostics.selections.length, 0);
  const suppressed = harness();
  suppressed.context.gameFaceLastActiveId = "forever-client";
  suppressed.context.gameFaceSuppressedGameId = "forever-client";
  suppressed.context.handleGameActivity(activity());
  assert.equal(suppressed.selections.length, 0);
});

test("other games retain Game Mode behavior and do not replace an open adventure journal", () => {
  const other = activity({ id: "other", gameKey: "", name: "Another game" });
  const normal = harness();
  normal.context.handleGameActivity(other);
  assert.deepEqual(normal.selections, [{ id: "game-mode", persist: false }]);
  const journal = harness("wow-forever");
  journal.context.handleGameActivity(other);
  assert.equal(journal.selections.length, 0);
});
