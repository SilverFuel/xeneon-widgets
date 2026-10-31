import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readWorkspaceFile(relativePath) {
  const filePath = resolve(process.cwd(), relativePath);
  try {
    if (!existsSync(filePath)) {
      throw new Error("file does not exist");
    }

    return readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`Unable to read ${relativePath} at ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sourceBetween(source, startMarker, endMarker, description) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `Unable to isolate ${description}`);
  return source.slice(start, end);
}

const gameMode = readWorkspaceFile("js/widgets/game-mode.js");
const blocklistWidget = readWorkspaceFile("js/widgets/game-blocklist.js");
const dashboard = readWorkspaceFile("js/dashboard.js");
const dashboardHtml = readWorkspaceFile("dashboard.html");
const store = readWorkspaceFile("app/Infrastructure/GameBlocklistStore.cs");
const gameController = readWorkspaceFile("app/Controllers/GameController.cs");
const configController = readWorkspaceFile("app/Controllers/ConfigController.cs");
const policy = readWorkspaceFile("app/Services/GameCandidatePolicy.cs");

const carousel = sourceBetween(gameMode, "function renderGameFocusSwitcher(", "\n  function ", "the Game Mode carousel renderer");
const sheet = sourceBetween(gameMode, "function renderGameCandidateSheet(", "\n  function ", "the Game Mode More sheet renderer");
const flags = sourceBetween(gameMode, "function renderGameFocusFlags(", "\n  function ", "the Game Mode identity flags renderer");

for (const action of ["game-carousel-toggle", "game-candidates-more", "game-select-auto", "game-select-candidate", "game-candidates-close"]) {
  assert(gameMode.includes(`"${action}"`), `Game Mode must handle the ${action} action`);
}

assert(!/Automatic/.test(carousel), "the carousel must not offer an Automatic chip (FR-018)");
assert(carousel.includes("slice(0, GAME_SWITCHER_CHIP_LIMIT)") && /GAME_SWITCHER_CHIP_LIMIT = 4;/.test(gameMode), "the carousel must show at most 4 candidates");
assert(/trackable\.length < 2/.test(carousel), "the carousel toggle must stay hidden with fewer than 2 trackable candidates (FR-025)");
assert(/>More</.test(carousel), "the carousel must end with a More chip");

const automaticIndex = sheet.indexOf("<strong>Automatic</strong>");
const rowsIndex = sheet.indexOf("rows +");
assert(automaticIndex >= 0 && rowsIndex > automaticIndex, "the More sheet must list Automatic before the candidate rows (FR-019)");
assert(/role="dialog"/.test(sheet) && /aria-modal="true"/.test(sheet), "the More sheet must be a modal dialog");

for (const [name, markup] of [["carousel", carousel], ["More sheet", sheet]]) {
  assert(!/title="/.test(markup), `the ${name} must not render tooltips`);
  assert(!/confidence/i.test(markup) && !/score/i.test(markup) && !/meter/i.test(markup), `the ${name} must not show the confidence score or a meter`);
  assert(!/blocklist/i.test(markup) && !/Ignore/.test(markup), `the ${name} must not offer blocklist or Ignore controls (FR-026)`);
}

assert(/Blocklist unavailable/.test(flags), "the tracking view must say when the blocklist is unavailable (FR-014)");
assert(/Chosen/.test(flags), "the tracking view must mark a manual selection as Chosen (FR-024)");
assert(/Also removed from the blocklist\./.test(gameMode), "pinning must say when it removed a blocklist entry (FR-010)");

assert(/"game-blocklist": \{ destination: "settings"/.test(dashboard), "the blocklist panel must be registered under Settings");
assert(/runtime\.registerRenderer\("game-blocklist", mountGameBlocklistWidget\)/.test(blocklistWidget), "the blocklist panel must register its inline renderer");
assert(/js\/widgets\/game-blocklist\.js\?v=/.test(dashboardHtml), "dashboard.html must load the blocklist panel script");
assert(/Show system exclusions/.test(blocklistWidget) && /Hide system exclusions/.test(blocklistWidget), "system exclusions must be hidden behind a toggle (FR-006a)");
assert(/showSystem: false/.test(blocklistWidget), "system exclusions must start hidden");
assert(/You had chosen this app to follow, so Game Mode is back to automatic selection\./.test(blocklistWidget), "blocking the chosen app must explain the return to automatic selection once");

assert(/AppPaths\.RoamingDataDirectory/.test(store) && /AtomicFile\.WriteAllText/.test(store), "the blocklist must be stored atomically in the Roaming Auxora folder (FR-009)");
assert(!/GameBlocklistStore|SystemGameExclusions/.test(gameController), "GameController must only delegate to GameActivityService (Constitution IV)");
assert(/internal static bool ShouldSuppressEnded/.test(policy), "the ended-state suppression rule must live in GameCandidatePolicy so it stays unit tested");

const portableBackup = sourceBetween(configController, "public object BuildPortableBackup()", "public object RestorePortableBackup", "the portable backup builder");
assert(!/blocklist/i.test(portableBackup), "the portable backup must not include the Game Mode blocklist (FR-015)");

console.log("Game Mode blocklist checks passed.");
