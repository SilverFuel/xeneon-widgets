import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const files = new Map();

function readWorkspaceFile(relativePath) {
  if (files.has(relativePath)) {
    return files.get(relativePath);
  }

  const filePath = resolve(repoRoot, relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`${relativePath} does not exist`);
  }

  const text = readFileSync(filePath, "utf8");
  files.set(relativePath, text);
  return text;
}

function readWorkspaceJson(relativePath) {
  return JSON.parse(readWorkspaceFile(relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeAssetPath(input) {
  return input.replace(/\\/g, "/").replace(/^\.\//, "");
}

function stripTags(input) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const assetRevision = String(readWorkspaceJson("assets/revision.json").assetRevision || "").trim();
const dashboardHtml = readWorkspaceFile("dashboard.html");
const sharedCss = readWorkspaceFile("css/widgets.css");
const gameModeCss = readWorkspaceFile("css/widgets/game-mode.css");
const networkWidget = readWorkspaceFile("js/widgets/network.js");
const homelabWidget = readWorkspaceFile("js/widgets/homelab.js");
const gameModeWidget = readWorkspaceFile("js/widgets/game-mode.js");
const apiRouter = readWorkspaceFile("app/Controllers/ApiRouter.cs");
const telemetryController = readWorkspaceFile("app/Controllers/TelemetryController.cs");
const supportController = readWorkspaceFile("app/Controllers/SupportController.cs");
const configController = readWorkspaceFile("app/Controllers/ConfigController.cs");
const dashboardJs = readWorkspaceFile("js/dashboard.js");
const actionWidget = readWorkspaceFile("js/widgets/actions.js");
const audioWidget = readWorkspaceFile("js/widgets/audio.js");
const homelabWidgetJs = readWorkspaceFile("js/widgets/homelab.js");
const integrationWidget = readWorkspaceFile("js/widgets/integrations.js");
const productWidget = readWorkspaceFile("js/widgets/product.js");
const setupWidget = readWorkspaceFile("js/widgets/setup.js");
const systemWidget = readWorkspaceFile("js/widgets/system.js");
const sceneService = readWorkspaceFile("app/Services/SceneService.cs");
const extensionService = readWorkspaceFile("app/Services/ExtensionManifestService.cs");
const remoteService = readWorkspaceFile("app/Services/RemoteSessionService.cs");

const expectedCssAssets = [
  "css/theme.css",
  "css/widgets.css",
  "css/widgets/homelab.css",
  "css/widgets/system.css",
  "css/widgets/network.css",
  "css/widgets/audio.css",
  "css/widgets/setup.css",
  "css/widgets/product.css",
  "css/widgets/actions.css",
  "css/widgets/integrations.css",
  "css/widgets/game-mode.css"
];
const expectedJsAssets = [
  "js/widget-core.js",
  "js/layout-profile.js",
  "js/inline-widgets.js",
  "js/widgets/homelab.js",
  "js/widgets/system.js",
  "js/widgets/network.js",
  "js/widgets/audio.js",
  "js/widgets/setup.js",
  "js/widgets/product.js",
  "js/widgets/actions.js",
  "js/widgets/integrations.js",
  "js/widgets/game-mode.js",
  "js/dashboard.js"
];

const assetRefs = [...dashboardHtml.matchAll(/(?:href|src)="\.\/([^"?]+)\?v=([^"]+)"/g)]
  .map(match => ({ path: normalizeAssetPath(match[1]), revision: match[2] }));
const assetPaths = assetRefs.map(ref => ref.path);

for (const expected of [...expectedCssAssets, ...expectedJsAssets]) {
  assert(assetPaths.includes(expected), `dashboard.html must load ${expected}`);
  assert(existsSync(resolve(repoRoot, expected)), `${expected} referenced by dashboard.html must exist`);
}

for (const ref of assetRefs) {
  assert(ref.revision === assetRevision, `${ref.path} must use asset revision ${assetRevision}`);
}

assert(
  expectedCssAssets.every((asset, index) => assetPaths.indexOf(asset) === index),
  "dashboard CSS asset order must keep shared styles before feature CSS"
);
assert(
  expectedJsAssets.every((asset, index) => assetPaths.indexOf(asset) === expectedCssAssets.length + index),
  "dashboard JS asset order must load helpers before split widget renderers"
);

assert(
  /\.dashboard-router-stage\s*\{[\s\S]*?width:\s*2560px;[\s\S]*?height:\s*720px;/.test(sharedCss)
    && /@media\s*\(max-width:\s*1800px\)/.test(sharedCss)
    && /@media\s*\(max-width:\s*1280px\)/.test(sharedCss)
    && /@media\s*\(max-width:\s*900px\)/.test(sharedCss)
    && /@media\s*\(max-height:\s*479px\)\s*and\s*\(orientation:\s*landscape\)/.test(sharedCss),
  "dashboard visual smoke must protect the 2560x720 shell plus 1800/1280/900 responsive breakpoints"
);

assert(
  ["home", "scenes", "library", "settings"].every(destination => dashboardHtml.includes(`data-destination="${destination}"`))
    && /data-destination="scenes"[^>]*>Modes<\/button>/.test(dashboardHtml)
    && /data-destination="library"[^>]*>Apps &amp; Controls<\/button>/.test(dashboardHtml)
    && !/>Scenes<\/button>|>Library<\/button>/.test(dashboardHtml)
    && /active Mode/.test(dashboardJs)
    && /Active Mode/.test(productWidget)
    && /dashboard-native-page--layout-compact/.test(dashboardJs)
    && /dashboard-native-page--layout-portrait/.test(dashboardJs)
    && /dashboard-native-page--layout-ultrawide/.test(dashboardJs)
    && /dashboard-native-page--adaptive[\s\S]*dashboard-router-stage/.test(sharedCss),
  "Auxora must keep exactly four primary destinations and adaptive compact, portrait, standard, and ultrawide layout behavior"
);

assert(
  /if \(widget\.id === "clipboard"\) \{[\s\S]*?return isWidgetSupported\(widget\.id\);/.test(dashboardJs),
  "Clipboard must remain selectable when the bridge reports it ready"
);

assert(
  /if \(widget\.tier === "product"\) \{[\s\S]*?return true;/.test(dashboardJs),
  "Ready product panels such as Streaming must remain selectable"
);


assert(
  /registerRenderer\("home"/.test(productWidget)
    && /registerRenderer\("scenes"/.test(productWidget)
    && /Manual selection/.test(sceneService)
    && /Automatic \{match\.Rule\.Type\} rule/.test(sceneService)
    && /case "\/api\/scenes\/activate"/.test(apiRouter),
  "Home and Scenes must stay wired to native manual and automatic Scene behavior"
);

assert(
  /RSA\.Create/.test(extensionService)
    && /RSASignaturePadding\.Pss/.test(extensionService)
    && /AllowedPermissions/.test(extensionService)
    && /EnabledForCurrentBeta\s*=\s*false/.test(remoteService)
    && /Phone Remote is unavailable for this beta/.test(productWidget)
    && !/data-remote-action/.test(productWidget)
    && !/Start 15-minute remote/.test(productWidget),
  "extension signatures must retain their trust boundaries and Phone Remote must remain truthfully disabled for this beta"
);

assert(
  /foregroundAppTrackingEnabled/.test(configController)
    && /data-foreground-tracking/.test(productWidget)
    && /off by default/i.test(productWidget)
    && /\/api\/recovery\/action/.test(productWidget)
    && /Available/.test(productWidget)
    && /Not verified/.test(productWidget)
    && /state\.trustReady\s*=\s*state\.hashStatus\s*===\s*"available"\s*&&\s*state\.signatureStatus\s*===\s*"available"/.test(productWidget)
    && !/metricCard\("Trust",\s*state\.trustReady\s*\?\s*"Verified"/.test(productWidget),
  "privacy, customer recovery, and update trust labels must expose the beta-safe UI contracts"
);

assert(
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(sharedCss)
    && /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(gameModeCss)
    && /:focus-visible/.test(sharedCss)
    && /input\[type="range"\]:focus-visible/.test(sharedCss),
  "dashboard must keep reduced-motion and visible keyboard focus coverage"
);

assert(
  /currentWidgetId === "audio"/.test(dashboardJs)
    && /dashboard-native-page--now-strip-visible/.test(dashboardJs)
    && /dashboard-native-page--now-strip-visible\s+\.router-inline-widget/.test(sharedCss),
  "the persistent now-playing strip must stay off the Audio page and reserve content space when visible"
);

assert(
  /maybeCheckForAvailableUpdate/.test(dashboardJs)
    && /updateNotifications/.test(dashboardJs)
    && /updateAvailable/.test(productWidget),
  "update availability checks must remain opt-in and visibly report newer releases"
);

assert(
  /data-action="select-display"/.test(setupWidget)
    && /data-display-id=/.test(setupWidget)
    && /\/api\/display\/preference/.test(setupWidget)
    && /selectedDisplayId/.test(setupWidget)
    && !/repairActions\[0\]\.message/.test(setupWidget)
    && /displayDiagnostics\.Status,\s*"ready"/.test(telemetryController)
    && /essentialsReady\s*=\s*string\.Equals\(displayDiagnostics\.Status,\s*"ready"/.test(telemetryController)
    && /state\s*=\s*string\.Equals\(display\.Status,\s*"ready"/.test(supportController)
    && /function displayTargetReady\([\s\S]*?\.status[\s\S]*?===\s*"ready"/.test(systemWidget)
    && !/\}\)\[0\]\s*\|\|\s*displays\[0\]/.test(systemWidget),
  "display diagnostics must identify the saved display, expose a direct selection action, and show repair guidance"
);

for (const [relativePath, text] of [
  ["js/dashboard.js", dashboardJs],
  ["js/widgets/actions.js", actionWidget],
  ["js/widgets/audio.js", audioWidget],
  ["js/widgets/homelab.js", homelabWidgetJs],
  ["js/widgets/integrations.js", integrationWidget],
  ["js/widgets/product.js", productWidget]
]) {
  const rangeInputs = [...text.matchAll(/<input\b[^>]*type="range"[^>]*>/g)].map(match => match[0]);
  for (const input of rangeInputs) {
    assert(/aria-label\s*=|title\s*=/.test(input), `${relativePath} range input must have an accessible name: ${input}`);
  }
}

const htmlButtons = [...dashboardHtml.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
assert(htmlButtons.length > 0, "dashboard.html must expose shell controls as buttons");
for (const [, attrs, body] of htmlButtons) {
  const hasAccessibleName = /aria-label\s*=|title\s*=/.test(attrs) || stripTags(body).length > 0;
  assert(hasAccessibleName, `dashboard button must have an accessible name: <button${attrs}>`);
}

assert(
  /aria-live="polite"/.test(dashboardHtml)
    && /role="status"/.test(dashboardHtml)
    && /title="'\s*\+\s*escapeHtml\(getWidgetCopy\(widget\)\)/.test(readWorkspaceFile("js/dashboard.js")),
  "dashboard dynamic status and picker controls must expose assistive semantics"
);

assert(
  /network-certificate-review/.test(networkWidget)
    && /certificateTrustRequired/.test(homelabWidget)
    && /trustedCertificateThumbprint/.test(networkWidget),
  "UniFi certificate review UI must stay visible in the network widget"
);

assert(
  /case "\/api\/config" when request\.HttpMethod == "GET"/.test(apiRouter)
    && /case "\/api\/system":[\s\S]*?_telemetryController\.GetSystemSnapshot/.test(apiRouter)
    && /case "\/api\/network":[\s\S]*?_telemetryController\.GetNetworkSnapshot/.test(apiRouter)
    && /case "\/api\/audio" when request\.HttpMethod == "GET"/.test(apiRouter)
    && /case "\/api\/unifi\/network":[\s\S]*?_telemetryController\.GetUniFiNetworkAsync/.test(apiRouter)
    && /case "\/api\/game\/performance\/session" when request\.HttpMethod == "POST"/.test(apiRouter)
    && /case "\/api\/system\/restart-admin" when request\.HttpMethod == "POST"/.test(apiRouter)
    && /GetDisplayDiagnostics/.test(configController)
    && /GetNetworkSnapshot/.test(telemetryController)
    && /restart-game-admin/.test(gameModeWidget),
  "native API contract smoke must keep config, telemetry, UniFi, and Game Mode routes wired through controllers"
);

console.log("checked dashboard visual, accessibility, and native route smoke");
