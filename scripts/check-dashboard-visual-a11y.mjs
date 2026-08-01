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

function readCssBlock(source, openingBraceIndex) {
  let depth = 0;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openingBraceIndex + 1, index);
      }
    }
  }
  return "";
}

function getScaledDesktopNavigationMedia(source) {
  const mediaPattern = /@media\s*\(\s*min-width:\s*961px\s*\)\s*\{/g;
  const match = mediaPattern.exec(source);
  return match ? readCssBlock(source, match.index + match[0].lastIndexOf("{")) : "";
}

function hasScaledDesktopNavigationRule(source) {
  const mediaBlock = getScaledDesktopNavigationMedia(source);
  return /\.dashboard-native-page--adaptive\s+\.auxora-primary-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/.test(mediaBlock);
}

const scaledDesktopNavigationFixture = `
@media (min-width: 961px) {
  .dashboard-native-page--adaptive .auxora-primary-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 1200px) and (min-height: 600px) {
  .other-rule { display: grid; }
}`;
const minHeightOnlyNavigationFixture = `
@media (min-width: 961px) and (min-height: 600px) {
  .dashboard-native-page--adaptive .auxora-primary-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}`;
const closedBlockNavigationFixture = `
@media (min-width: 961px) {
  .other-rule { display: grid; }
}
.dashboard-native-page--adaptive .auxora-primary-nav {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}`;

assert(hasScaledDesktopNavigationRule(scaledDesktopNavigationFixture), "scaled navigation fixture must accept a scoped width-only rule");
assert(!hasScaledDesktopNavigationRule(minHeightOnlyNavigationFixture), "scaled navigation fixture must reject a height-gated rule");
assert(!hasScaledDesktopNavigationRule(closedBlockNavigationFixture), "scaled navigation fixture must not cross a closed media block");

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
const productCss = readWorkspaceFile("css/widgets/product.css");
const setupWidget = readWorkspaceFile("js/widgets/setup.js");
const setupCss = readWorkspaceFile("css/widgets/setup.css");
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
const dashboardCodeAssetPaths = assetPaths.filter(path => /\.(?:css|js)$/.test(path));

for (const expected of [...expectedCssAssets, ...expectedJsAssets]) {
  assert(assetPaths.includes(expected), `dashboard.html must load ${expected}`);
  assert(existsSync(resolve(repoRoot, expected)), `${expected} referenced by dashboard.html must exist`);
}

for (const ref of assetRefs) {
  assert(ref.revision === assetRevision, `${ref.path} must use asset revision ${assetRevision}`);
}

assert(
  expectedCssAssets.every((asset, index) => dashboardCodeAssetPaths.indexOf(asset) === index),
  "dashboard CSS asset order must keep shared styles before feature CSS"
);
assert(
  expectedJsAssets.every((asset, index) => dashboardCodeAssetPaths.indexOf(asset) === expectedCssAssets.length + index),
  "dashboard JS asset order must load helpers before split widget renderers"
);

assert(
  assetPaths.includes("assets/icons/auxora-mark.svg")
    && existsSync(resolve(repoRoot, "assets/icons/auxora-mark.svg")),
  "dashboard must load the Auxora mark without disturbing its code asset order"
);

assert(
  hasScaledDesktopNavigationRule(sharedCss),
  "desktop navigation must keep two readable columns at scaled display heights"
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
  /@media\s*\(min-width:\s*1800px\)\s*and\s*\(min-height:\s*600px\)/.test(sharedCss)
    && /dashboard-native-page--layout-ultrawide[\s\S]*?min-inline-size:\s*54px;[\s\S]*?min-block-size:\s*54px;[\s\S]*?font-size:\s*max\(15px,\s*0\.9375rem\)/.test(sharedCss)
    && /dashboard-native-page--layout-ultrawide[\s\S]*?\.auxora-primary-nav button[\s\S]*?min-block-size:\s*60px;/.test(sharedCss)
    && /distanceUndersizedControls/.test(dashboardJs)
    && /distanceSmallControlText/.test(dashboardJs),
  "wide companion layouts must retain the 54-pixel control and 15-pixel label distance-readability contract"
);

assert(
  ["home", "scenes", "library", "settings"].every(destination => dashboardHtml.includes(`data-destination="${destination}"`))
    && /data-destination="scenes"[^>]*>Modes<\/button>/.test(dashboardHtml)
    && /data-destination="library"[^>]*>Apps &amp; Controls<\/button>/.test(dashboardHtml)
    && !/>Scenes<\/button>|>Library<\/button>/.test(dashboardHtml)
    && /dashboard-native-page--layout-compact/.test(dashboardJs)
    && /dashboard-native-page--layout-portrait/.test(dashboardJs)
    && /dashboard-native-page--layout-ultrawide/.test(dashboardJs)
    && /dashboard-native-page--adaptive[\s\S]*dashboard-router-stage/.test(sharedCss),
  "Auxora must keep exactly four primary destinations and adaptive compact, portrait, standard, and ultrawide layout behavior"
);

assert(
  /\.router-settings\.is-collapsed\s*\{[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?overflow:\s*visible;[\s\S]*?\}/.test(sharedCss),
  "the collapsed Settings and Touch Lock tray must not draw an opaque container"
);

assert(
  /registerRenderer\("home"/.test(productWidget)
    && /registerRenderer\("scenes"/.test(productWidget)
    && /Manual selection/.test(sceneService)
    && /Automatic \{match\.Rule\.Type\} rule/.test(sceneService)
    && /case "\/api\/scenes\/activate"/.test(apiRouter),
  "Home and Modes must stay wired to native manual and automatic mode behavior"
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
    && /state\.trusted\s*=\s*trust\.trusted\s*===\s*true\s*&&\s*state\.verificationStatus\s*===\s*"verified"/.test(productWidget)
    && /Auxora has not verified the downloaded bytes/.test(productWidget)
    && !/trustReady|hashStatus\s*===\s*"available"\s*&&\s*state\.signatureStatus\s*===\s*"available"/.test(productWidget),
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
  /@media\s*\(forced-colors:\s*active\)/.test(sharedCss)
    && /dashboard-ambient-canvas[\s\S]{0,180}display:\s*none/.test(sharedCss)
    && /border:\s*2px solid ButtonText/.test(sharedCss)
    && /background:\s*Highlight/.test(sharedCss)
    && /color:\s*HighlightText/.test(sharedCss)
    && /outline:\s*3px solid Highlight/.test(sharedCss),
  "Windows forced colors must remove decorative layers and preserve control boundaries, selection, and keyboard focus"
);

assert(
  /currentWidgetId === "audio"/.test(dashboardJs)
    && /nowStripMode === "hidden"/.test(dashboardJs)
    && /nowStripMode !== "pinned"/.test(dashboardJs)
    && /data-now-strip-action="dismiss"/.test(dashboardHtml)
    && /data-now-strip-action="pin"/.test(dashboardHtml)
    && /router-viewer__header-actions\s+\.dashboard-now-strip[\s\S]*?position:\s*static/.test(sharedCss),
  "the media strip must stay off Audio, respect Auto/Keep/Hidden, and use stable header chrome"
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
  /product-profile-grid product-profile-grid--packs/.test(productWidget)
    && /\.product-profile-grid--packs\s*\{\s*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(productCss),
  "wide Marketplace layouts must keep all five built-in packs on one row"
);

assert(
  /<div class="product-range-grid">/.test(productWidget)
    && /\.product-theme-grid\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(productCss)
    && /\.product-control-panel \.inline-form-grid--3\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(productCss)
    && /\.product-range-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(productCss),
  "wide Theme Studio layouts must keep themes and controls visible together"
);

assert(
  /\.auxora-primary-nav button,\s*\.auxora-quick-drawer button,\s*\.auxora-quick-toggle\s*\{[\s\S]*?min-height:\s*44px;/.test(sharedCss),
  "global navigation and Quick controls must keep 44px touch targets"
);

assert(
  /inline-grid--4 setup-health-grid/.test(setupWidget)
    && /setup-diagnostics-details/.test(setupWidget)
    && /\.setup-health-grid\s*\{\s*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/.test(setupCss)
    && /\.setup-diagnostics-details summary\s*\{[\s\S]*?min-height:\s*44px;/.test(setupCss),
  "wide Diagnostics must keep health visible and place management details behind full-size summaries"
);

assert(
  /product-privacy-metrics/.test(productWidget)
    && /product-privacy-disclosure/.test(productWidget)
    && /product-privacy-permissions/.test(productWidget)
    && /Backup, restore, and reset/.test(productWidget)
    && /\.product-privacy-permissions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(productCss)
    && /\.product-privacy-tools\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(productCss)
    && /\.product-privacy-details summary\s*\{[\s\S]*?min-height:\s*44px;/.test(productCss),
  "Privacy must keep its plain-language overview and permissions visible while collapsing infrequent tools"
);

assert(
  /inline-grid--4 inline-grid--updates/.test(productWidget)
    && /product-control-panel product-control-panel--updates/.test(productWidget)
    && /\.inline-grid--updates\s*\{\s*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(productCss)
    && /\.product-control-panel--updates\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(productCss),
  "wide Updates layouts must keep all status cards and controls above the fold"
);

assert(
  /inline-list inline-list--recovery/.test(productWidget)
    && /\.inline-list--recovery\s*\{\s*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(productCss),
  "wide Recovery layouts must keep every recovery action visible together"
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
