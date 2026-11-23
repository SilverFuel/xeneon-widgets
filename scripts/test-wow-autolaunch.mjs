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

// The Profiles the native host ships: any game gets Gaming, the Forever client gets its own.
function builtInProfiles() {
  return [
    { id: "scene-work", name: "Work", themeId: "focus", homeWidget: "", rules: [] },
    { id: "scene-gaming", name: "Gaming", themeId: "gaming", homeWidget: "game-mode", rules: [{ type: "game", value: "", priority: 100, enabled: true }] },
    { id: "scene-wow-forever", name: "WoW Forever", themeId: "horde", homeWidget: "wow-forever", rules: [{ type: "game", value: "wow-forever", priority: 110, enabled: true }] }
  ];
}

function harness(panel = "home", enabled = true, profiles = builtInProfiles()) {
  const selections = [];
  const toasts = [];
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
    gameFaceOpenedWidgetId: "",
    bridgeConfig: { scenes: { activeSceneId: "scene-work", defaultSceneId: "scene-work", profiles } },
    getWidgetById: id => navigation.sectionForWidget(id) ? { id } : null,
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
    showTouchFeedback(message) { toasts.push(message); },
    applyDashboardPresentation() {},
    renderDashboardChromeState() {},
    restoredBudget: 0,
    clearedTheme: 0,
    restorePreGamePerformanceBudget() { context.restoredBudget++; },
    clearTransientGameTheme() { context.clearedTheme++; }
  };
  runInNewContext(source, context);
  return { context, selections, timers, toasts };
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

test("the native game key is authoritative even when a client is renamed", () => {
  const { context } = harness();
  assert.equal(context.gameHomeWidgetId(activity({ name: "My pinned client" })), "wow-forever");
  for (const gameKey of ["", "world-of-warcraft", "game:world-of-warcraft-forever", "game:wow-forever", null]) {
    assert.equal(context.gameHomeWidgetId(activity({ gameKey, name: "World of Warcraft: Forever" })), "game-mode");
  }
});

test("the Profile decides the panel and names itself in the toast", () => {
  const forever = harness();
  forever.context.handleGameActivity(activity());
  assert.deepEqual(forever.toasts, ["WoW Forever profile"]);
  const other = harness();
  other.context.handleGameActivity(activity({ id: "other", gameKey: "game:another-game", name: "Another game" }));
  assert.deepEqual(other.selections, [{ id: "game-mode", persist: false }]);
  assert.deepEqual(other.toasts, ["Gaming profile"]);
});

test("a second game Profile needs no dashboard change: only a Profile with a rule for the game's key", () => {
  const profiles = builtInProfiles().concat({
    id: "custom-diablo", name: "Diablo", themeId: "ember", homeWidget: "system",
    rules: [{ type: "game", value: "diablo-iv", priority: 110, enabled: true }]
  });
  const { context, selections, toasts } = harness("home", true, profiles);
  context.handleGameActivity(activity({ id: "battle.net:1", gameKey: "diablo-iv", name: "Diablo IV" }));
  assert.deepEqual(selections, [{ id: "system", persist: false }]);
  assert.deepEqual(toasts, ["Diablo profile"]);
  // A disabled rule, or a home panel that does not exist, falls back to the Game HUD.
  profiles[3].rules[0].enabled = false;
  assert.equal(context.gameHomeWidgetId(activity({ gameKey: "diablo-iv" })), "game-mode");
  profiles[3].rules[0].enabled = true;
  profiles[3].homeWidget = "no-such-panel";
  assert.equal(context.gameHomeWidgetId(activity({ gameKey: "diablo-iv" })), "game-mode");
});

test("when the game exits the previous panel returns, unless the user moved on", () => {
  const stayed = harness("system");
  stayed.context.handleGameActivity(activity());
  assert.equal(stayed.context.currentWidgetId, "wow-forever");
  stayed.context.handleGameActivity({ active: false, status: "ended" });
  assert.deepEqual(stayed.selections, [{ id: "wow-forever", persist: false }, { id: "system", persist: false }]);

  const moved = harness("system");
  moved.context.handleGameActivity(activity());
  moved.context.currentWidgetId = "audio";
  moved.context.handleGameActivity({ active: false, status: "ended" });
  assert.equal(moved.selections.length, 1, "a panel the user chose is not replaced when the game exits");
  assert.equal(moved.context.currentWidgetId, "audio");

  const already = harness("wow-forever");
  already.context.handleGameActivity(activity());
  already.context.handleGameActivity({ active: false, status: "ended" });
  assert.equal(already.selections.length, 0, "a panel the user opened themselves stays open");

  const busy = harness("system");
  busy.context.handleGameActivity(activity());
  busy.context.locked = true;
  busy.context.handleGameActivity({ active: false, status: "ended" });
  assert.equal(busy.context.currentWidgetId, "wow-forever", "Touch Lock blocks the return as it blocks opening");
});

test("Forever opens even when another running game has a higher detection priority", () => {
  const { context, selections } = harness("game-mode");
  const payload = activity({ id: "other-game", name: "Another game", gameKey: "game:another-game" });
  payload.candidates = [payload.activeGame, activity().activeGame];
  context.handleGameActivity(payload);
  assert.deepEqual(selections, [{ id: "wow-forever", persist: false }]);
  context.currentWidgetId = "audio";
  context.handleGameActivity(payload);
  assert.equal(selections.length, 1);
  assert.equal(context.gameFaceAutoOpenedGameId, "forever-client");
});

test("names, process names and paths never select the journal; only the native key does", () => {
  const { context } = harness();
  for (const game of [
    { name: "World of Warcraft: Forever" },
    { name: "  WoW Forever  " },
    { name: "World of Warcraft", executablePath: "C:\\Program Files (x86)\\World of Warcraft\\_forever_\\Wow.exe" },
    { name: "World of Warcraft" },
    { name: "Wow", processName: "Wow.exe" },
    { name: "World of Warcraft Classic", gameKey: "world-of-warcraft" },
    { name: "World of Warcraft: Forever", processName: "Battle.net.exe", gameKey: "game:world-of-warcraft-forever" },
    { name: "WoW Forever Launcher" },
    { name: "wow-forever", gameKey: "game:wow-forever" }
  ]) assert.equal(context.gameHomeWidgetId({ active: true, activeGame: game }), "game-mode", JSON.stringify(game));
  assert.equal(context.gameHomeWidgetId({ active: false, activeGame: { gameKey: "wow-forever" } }), "game-mode");
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

test("a game with its own Profile is themed by that Profile, not by the per-game tint", () => {
  const { context } = harness();
  context.handleGameActivity(activity());
  assert.equal(context.isLiveGameThemeActive(), false);
});

test("transient failures preserve game presentation until an observed session end", () => {
  const { context } = harness();
  context.handleGameActivity(activity({ id: "other", gameKey: "game:another-game", name: "Another game" }));
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
    lastSceneEvaluationGame: "",
    bridgeOrigin: "http://fixture.invalid",
    bridgeConfig: { scenes: { activeSceneId: "scene-work", profiles: builtInProfiles() } },
    buildUrl: (origin, path) => origin + path,
    fetchJson: async () => ({}),
    postJson: async (url, body) => { requests.push({ url, body }); return {}; },
    applyScenePresentation() {}, renderQuickDrawer() {}, showTouchFeedback() {},
    console: { warn: error => { throw error; } }
  };
  runInNewContext(functionsBetween("gameProfiles", "gameHomeWidgetId") + functionsBetween("evaluateSceneContext", "scheduleGameActivityLoop"), context);
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
  assert.equal(requests[0].body.activeGameKey, "wow-forever");
  // The same game is evaluated at most every 20 seconds.
  context.evaluateSceneContext(activity());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  // A game changing or stopping is evaluated at once, without waiting out the throttle.
  context.evaluateSceneContext(activity({ id: "other", gameKey: "steam:440", name: "Another game" }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.activeGameKey, "steam:440");
  context.evaluateSceneContext({ active: false, status: "ended" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 3);
  assert.equal(requests[2].body.activeGame, "");
  assert.equal(requests[2].body.activeGameKey, "");
});

test("an automatic Profile change applies its presentation once and names the Profile", async () => {
  const applied = [];
  const toasts = [];
  const wow = builtInProfiles()[2];
  const context = {
    lastSceneEvaluationAt: 0,
    lastSceneEvaluationGame: "",
    bridgeOrigin: "http://fixture.invalid",
    bridgeConfig: { scenes: { activeSceneId: "scene-work", profiles: builtInProfiles() } },
    buildUrl: (origin, path) => origin + path,
    fetchJson: async () => ({}),
    postJson: async () => ({ activeSceneId: "scene-wow-forever", activeScene: wow, profiles: builtInProfiles() }),
    applyScenePresentation(scene) { applied.push(scene.themeId); }, renderQuickDrawer() {},
    showTouchFeedback(message) { toasts.push(message); },
    console: { warn: error => { throw error; } }
  };
  runInNewContext(functionsBetween("gameProfiles", "gameHomeWidgetId") + functionsBetween("evaluateSceneContext", "scheduleGameActivityLoop"), context);
  context.evaluateSceneContext(activity());
  await new Promise(resolve => setImmediate(resolve));
  context.lastSceneEvaluationAt = 0;
  context.evaluateSceneContext(activity());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(applied, ["horde"], "the Profile's theme is applied when it activates, not on every poll");
  assert.deepEqual(toasts, ["WoW Forever profile"]);
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
  context.handleGameActivity(activity({ id: "other-game", gameKey: "game:another-game", name: "Another game" }));
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
  const other = activity({ id: "other", gameKey: "game:another-game", name: "Another game" });
  const normal = harness();
  normal.context.handleGameActivity(other);
  assert.deepEqual(normal.selections, [{ id: "game-mode", persist: false }]);
  const journal = harness("wow-forever");
  journal.context.handleGameActivity(other);
  assert.equal(journal.selections.length, 0);
});
