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
const configController = readWorkspaceFile("app/Controllers/ConfigController.cs");
const dashboardJs = readWorkspaceFile("js/dashboard.js");
const actionWidget = readWorkspaceFile("js/widgets/actions.js");
const audioWidget = readWorkspaceFile("js/widgets/audio.js");
const homelabWidgetJs = readWorkspaceFile("js/widgets/homelab.js");
const integrationWidget = readWorkspaceFile("js/widgets/integrations.js");
const productWidget = readWorkspaceFile("js/widgets/product.js");

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
    && /@media\s*\(max-width:\s*900px\)/.test(sharedCss),
  "dashboard visual smoke must protect the 2560x720 shell plus 1800/1280/900 responsive breakpoints"
);

assert(
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(sharedCss)
    && /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(gameModeCss)
    && /:focus-visible/.test(sharedCss)
    && /input\[type="range"\]:focus-visible/.test(sharedCss),
  "dashboard must keep reduced-motion and visible keyboard focus coverage"
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
