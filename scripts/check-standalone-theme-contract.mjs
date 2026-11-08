import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const fileCache = new Map();

const expectedRootPages = [
  "hosted-dashboard.html",
  "index.html",
  "refund-policy.html",
  "support.html"
];
const expectedWidgetPages = [
  "widgets/audio-output-panel.html",
  "widgets/calendar-widget.html",
  "widgets/clock-widget.html",
  "widgets/frigate-detection-panel.html",
  "widgets/home-automation-panel.html",
  "widgets/media-widget.html",
  "widgets/nas-storage-monitor.html",
  "widgets/network-widget.html",
  "widgets/philips-hue-panel.html",
  "widgets/plex-server-monitor.html",
  "widgets/setup-guide.html",
  "widgets/system-monitor.html",
  "widgets/unifi-camera-viewer.html",
  "widgets/unifi-network-dashboard.html",
  "widgets/weather-widget.html"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readWorkspaceFile(relativePath) {
  if (fileCache.has(relativePath)) {
    return fileCache.get(relativePath);
  }

  const absolutePath = resolve(repoRoot, relativePath);
  assert(existsSync(absolutePath), `${relativePath} does not exist`);
  const source = readFileSync(absolutePath, "utf8");
  fileCache.set(relativePath, source);
  return source;
}

function listHtmlFiles(relativeDirectory) {
  return readdirSync(resolve(repoRoot, relativeDirectory), { withFileTypes: true })
    .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === ".html")
    .map(entry => relativeDirectory === "." ? entry.name : `${relativeDirectory}/${entry.name}`)
    .sort();
}

function assertSameInventory(actual, expected, label) {
  const sortedExpected = [...expected].sort();
  assert(
    actual.length === sortedExpected.length && actual.every((value, index) => value === sortedExpected[index]),
    `${label} inventory must be exactly ${sortedExpected.join(", ")}; found ${actual.join(", ") || "none"}`
  );
}

function getAttribute(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i");
  const match = tag.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function normalizeAssetReference(value) {
  return String(value || "")
    .trim()
    .replace(/\\\\/g, "/")
    .split(/[?#]/, 1)[0];
}

function assetBasename(value) {
  return basename(normalizeAssetReference(value).replaceAll("/", "\\"));
}

function readHtmlAssets(source) {
  const links = [...source.matchAll(/<link\b[^>]*>/gi)].map(match => ({
    index: match.index,
    tag: match[0],
    href: getAttribute(match[0], "href"),
    rel: String(getAttribute(match[0], "rel") || "").toLowerCase().split(/\s+/)
  }));
  const scripts = [...source.matchAll(/<script\b[^>]*>/gi)].map(match => ({
    index: match.index,
    tag: match[0],
    src: getAttribute(match[0], "src")
  }));
  const inlineStyles = [...source.matchAll(/<style\b[^>]*>/gi)].map(match => ({
    index: match.index,
    tag: match[0]
  }));

  return { links, scripts, inlineStyles };
}

function assertStandalonePage(relativePath, rootLevel) {
  const source = readWorkspaceFile(relativePath);
  const markerTags = [...source.matchAll(/<[^>]+\bdata-standalone-ui(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>/gi)];
  const headOpen = source.search(/<head\b/i);
  const headClose = source.search(/<\/head\s*>/i);
  const bodyOpen = source.search(/<body\b/i);
  const { links, scripts, inlineStyles } = readHtmlAssets(source);
  const expectedThemePath = rootLevel ? "./css/theme.css" : "../css/theme.css";
  const expectedAdapterPath = rootLevel ? "./css/standalone-theme.css" : "../css/standalone-theme.css";
  const expectedBootstrapPath = rootLevel ? "./js/theme-bootstrap.js" : "../js/theme-bootstrap.js";
  const themeLinks = links.filter(link => assetBasename(link.href) === "theme.css");
  const adapterLinks = links.filter(link => assetBasename(link.href) === "standalone-theme.css");
  const bootstrapScripts = scripts.filter(script => assetBasename(script.src) === "theme-bootstrap.js");

  assert(markerTags.length === 1, `${relativePath} must contain exactly one data-standalone-ui marker`);
  assert(/^<html\b/i.test(markerTags[0][0]), `${relativePath} must place data-standalone-ui on the html element`);
  assert(headOpen >= 0 && headClose > headOpen, `${relativePath} must contain a closed head element`);
  assert(bodyOpen > headClose, `${relativePath} must place body after head`);

  assert(themeLinks.length === 1, `${relativePath} must load theme.css exactly once`);
  assert(themeLinks[0].rel.includes("stylesheet"), `${relativePath} theme.css reference must be a stylesheet`);
  assert(
    normalizeAssetReference(themeLinks[0].href) === expectedThemePath,
    `${relativePath} must load ${expectedThemePath}`
  );

  assert(adapterLinks.length === 1, `${relativePath} must load standalone-theme.css exactly once`);
  assert(adapterLinks[0].rel.includes("stylesheet"), `${relativePath} standalone-theme.css reference must be a stylesheet`);
  assert(
    normalizeAssetReference(adapterLinks[0].href) === expectedAdapterPath,
    `${relativePath} must load ${expectedAdapterPath}`
  );

  assert(bootstrapScripts.length === 1, `${relativePath} must load theme-bootstrap.js exactly once`);
  assert(
    normalizeAssetReference(bootstrapScripts[0].src) === expectedBootstrapPath,
    `${relativePath} must load ${expectedBootstrapPath}`
  );

  const themeLink = themeLinks[0];
  const adapterLink = adapterLinks[0];
  const bootstrapScript = bootstrapScripts[0];
  const stylesheetLinks = links.filter(link => link.rel.includes("stylesheet"));
  const styleEntries = [...stylesheetLinks, ...inlineStyles];

  assert(
    [themeLink.index, adapterLink.index, bootstrapScript.index].every(index => index > headOpen && index < headClose),
    `${relativePath} theme assets must all be loaded inside head`
  );
  assert(themeLink.index < adapterLink.index, `${relativePath} must load theme.css before standalone-theme.css`);
  assert(
    styleEntries.every(entry => entry === adapterLink || entry.index < adapterLink.index),
    `${relativePath} must load standalone-theme.css after every prior stylesheet and inline style`
  );
  assert(
    adapterLink.index < bootstrapScript.index && bootstrapScript.index < headClose && bootstrapScript.index < bodyOpen,
    `${relativePath} must load theme-bootstrap.js after standalone-theme.css and before body`
  );
}

function readBraceBody(source, openingBraceIndex, label) {
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
  throw new Error(`${label} must have a closed block`);
}

function blockMatching(source, pattern, label) {
  const match = pattern.exec(source);
  assert(match, `${label} is missing`);
  const openingBraceIndex = source.indexOf("{", match.index);
  assert(openingBraceIndex >= 0, `${label} must open a block`);
  return readBraceBody(source, openingBraceIndex, label);
}

function functionBody(source, name) {
  return blockMatching(
    source,
    new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`),
    `${name}()`
  );
}

function cssRuleBody(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return blockMatching(
    source,
    new RegExp(`(?:^|})\\s*${escapedSelector}\\s*\\{`, "m"),
    `${selector} CSS rule`
  );
}

function assertCssDeclarations(body, expected, label) {
  const declarations = new Map([...body.matchAll(/(?:^|[;\n\r])\s*(--[\w-]+)\s*:\s*([^;{}]+)\s*;/g)]
    .map(([, property, value]) => [property, value.trim().replace(/\s+/g, " ")]));
  for (const [property, value] of Object.entries(expected)) {
    assert(declarations.get(property) === value, `${label} must map ${property} to ${value}`);
  }
}

const actualRootPages = listHtmlFiles(".").filter(page => page !== "dashboard.html");
const actualWidgetPages = listHtmlFiles("widgets");
assertSameInventory(actualRootPages, expectedRootPages, "root standalone page");
assertSameInventory(actualWidgetPages, expectedWidgetPages, "widget standalone page");

const standalonePages = [...expectedRootPages, ...expectedWidgetPages];
assert(standalonePages.length === 19, "standalone page contract must inventory exactly 19 pages");
for (const page of expectedRootPages) {
  assertStandalonePage(page, true);
}
for (const page of expectedWidgetPages) {
  assertStandalonePage(page, false);
}

const themeCss = readWorkspaceFile("css/theme.css");
const adapterCss = readWorkspaceFile("css/standalone-theme.css");
const bootstrap = readWorkspaceFile("js/theme-bootstrap.js");
const defaultThemeRule = cssRuleBody(themeCss, ":root");

assert(/--theme-page\s*:/.test(defaultThemeRule) && /--theme-accent\s*:/.test(defaultThemeRule), "theme.css must retain the Focus default theme");
for (const themeId of ["gaming", "warm"]) {
  assert(
    new RegExp(`:root\\[data-theme=["']${themeId}["']\\]\\s*\\{`).test(themeCss),
    `theme.css must retain the ${themeId} theme selector`
  );
}
assert(/:root\[data-theme-variant=["']night["']\]\s*\{/.test(themeCss), "theme.css must retain the night variant selector");

const readStoredSettings = functionBody(bootstrap, "readStoredSettings");
assert(/try\s*\{/.test(readStoredSettings) && /catch\s*\([^)]*\)\s*\{/.test(readStoredSettings), "readStoredSettings() must fail safely");
assert(/window\.localStorage\.getItem\(settingsStorageKey\)/.test(readStoredSettings), "standalone theme bootstrap must read xeneon-dashboard-settings from localStorage");
assert(/JSON\.parse\(/.test(readStoredSettings) && /return\s*\{\s*\}\s*;/.test(readStoredSettings), "invalid or inaccessible stored settings must fall back to an empty object");
assert(/settingsStorageKey\s*=\s*["']xeneon-dashboard-settings["']/.test(bootstrap), "standalone theme bootstrap must use the dashboard settings storage key");
assert(!/(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|removeItem|clear)\s*\(/.test(bootstrap), "standalone theme bootstrap must never write or clear browser storage");

const normalizeThemeId = functionBody(bootstrap, "normalizeThemeId");
for (const [legacyId, themeId] of [["edge", "focus"], ["deepcore", "gaming"], ["afterburn", "warm"], ["verdant", "focus"]]) {
  assert(new RegExp(`${legacyId}\\s*:\\s*["']${themeId}["']`).test(normalizeThemeId), `legacy theme ${legacyId} must migrate to ${themeId}`);
}
for (const themeId of ["focus", "gaming", "warm"]) {
  assert(normalizeThemeId.includes(`"${themeId}"`) || normalizeThemeId.includes(`'${themeId}'`), `normalizeThemeId() must accept ${themeId}`);
}

const normalizeVariant = functionBody(bootstrap, "normalizeThemeVariantPreference");
for (const variant of ["auto", "standard", "night"]) {
  assert(normalizeVariant.includes(`"${variant}"`) || normalizeVariant.includes(`'${variant}'`), `theme variant contract must accept ${variant}`);
}
const resolveVariant = functionBody(bootstrap, "resolveThemeVariant");
assert(/normalizeThemeVariantPreference\(/.test(resolveVariant) && /new Date\(\)\.getHours\(\)/.test(resolveVariant), "automatic theme variants must resolve safely from the current hour");
assert(
  /["']night["']/.test(resolveVariant) && /["']standard["']/.test(resolveVariant) && /hour\s*[<>]=?/.test(resolveVariant),
  "automatic variants must resolve to night or standard"
);

const buildSettings = functionBody(bootstrap, "buildSettings");
for (const budget of ["balanced", "battery", "game", "max"]) {
  assert(buildSettings.includes(`"${budget}"`) || buildSettings.includes(`'${budget}'`), `performance contract must accept ${budget}`);
}
for (const readability of ["normal", "clean", "high-contrast", "visor"]) {
  assert(buildSettings.includes(`"${readability}"`) || buildSettings.includes(`'${readability}'`), `readability contract must accept ${readability}`);
}
assert(/normalizeAnimationPercent\(/.test(buildSettings), "standalone theme settings must normalize animation intensity");

const effectiveIntensity = functionBody(bootstrap, "effectiveAnimationIntensity");
assert(/performanceBudget\s*===\s*["']battery["']/.test(effectiveIntensity) && /Math\.min\([^,]+,\s*18\)/.test(effectiveIntensity), "battery mode must cap standalone animation intensity");
assert(/performanceBudget\s*===\s*["']game["']/.test(effectiveIntensity) && /Math\.min\([^,]+,\s*32\)/.test(effectiveIntensity), "game mode must cap standalone animation intensity");

const stateClasses = functionBody(bootstrap, "setStateClasses");
for (const className of [
  "dashboard-native-page--motion-low",
  "dashboard-native-page--motion-off",
  "dashboard-native-page--budget-battery",
  "dashboard-native-page--budget-game",
  "dashboard-native-page--budget-max",
  "dashboard-native-page--readability-clean",
  "dashboard-native-page--readability-high-contrast",
  "dashboard-native-page--readability-visor"
]) {
  assert(stateClasses.includes(`"${className}"`) || stateClasses.includes(`'${className}'`), `standalone theme state must apply ${className}`);
}

const applyState = functionBody(bootstrap, "applyStateToNode");
for (const attribute of ["data-theme", "data-theme-variant", "data-performance-budget", "data-readability", "data-reduced-motion"]) {
  assert(applyState.includes(`"${attribute}"`) || applyState.includes(`'${attribute}'`), `standalone theme state must apply ${attribute}`);
}
assert(/setStateClasses\(/.test(applyState), "standalone state attributes and compatibility classes must be applied together");

const applyPresentation = functionBody(bootstrap, "applyPresentation");
assert(/root\.setAttribute\(["']data-standalone-ui["']/.test(applyPresentation), "runtime must retain the standalone root marker");
assert(/applyStateToNode\(root,\s*state\)/.test(applyPresentation) && /applyStateToNode\(body,\s*state\)/.test(applyPresentation), "theme, variant, readability, motion, and performance state must reach root and body");
for (const property of [
  "--theme-accent",
  "--theme-accent-text",
  "--theme-on-accent",
  "--theme-accent-soft",
  "--theme-accent-border",
  "--theme-accent-glow"
]) {
  assert(applyPresentation.includes(`"${property}"`) || applyPresentation.includes(`'${property}'`), `custom accent must set companion property ${property}`);
}
assert(/contrastSafeAccentTextColor\(/.test(applyPresentation) && /contrastSafeTextColor\(/.test(applyPresentation), "custom accents must derive readable companion text colors");
assert(/--dashboard-aura-opacity/.test(applyPresentation), "standalone motion intensity must update the dashboard aura compatibility variable");

const mergeNativeSettings = functionBody(bootstrap, "mergeNativeDashboardSettings");
assert(/Object\.keys\(stored\)/.test(mergeNativeSettings), "native config fallback must begin with the locally stored dashboard settings");
for (const setting of ["themeId", "accentMode", "customAccentColor", "themeVariant", "performanceBudget", "themeReadability", "animationIntensity"]) {
  assert(mergeNativeSettings.includes(`"${setting}"`) || mergeNativeSettings.includes(`'${setting}'`), `native config fallback must understand ${setting}`);
}
assert(/hasExplicitStoredThemeSelection\(stored\)/.test(mergeNativeSettings), "native config must not override an explicit stored theme selection");

const refreshFromSources = functionBody(bootstrap, "refreshFromSources");
const storedApplyIndex = refreshFromSources.indexOf("currentSettings = buildSettings(stored)");
const fetchIndex = refreshFromSources.indexOf('window.fetch("/api/config"');
assert(storedApplyIndex >= 0 && fetchIndex > storedApplyIndex, "standalone presentation must apply stored settings before requesting native config");
assert(/typeof\s+window\.fetch\s*!==\s*["']function["']/.test(refreshFromSources), "static hosts without fetch must retain the storage/default theme fallback");
assert(/credentials\s*:\s*["']same-origin["']/.test(refreshFromSources) && /Accept\s*:\s*["']application\/json["']/.test(refreshFromSources), "native theme config reads must stay same-origin and request JSON");
assert(/if\s*\(\s*!response\.ok\s*\)/.test(refreshFromSources) && /response\.json\(\)/.test(refreshFromSources), "native config fallback must validate and parse the response");
assert(/generation\s*!==\s*sourceGeneration/.test(refreshFromSources), "stale native theme responses must not overwrite a newer refresh");
assert(/mergeNativeDashboardSettings\(stored,\s*payload\s*&&\s*payload\.dashboard\)/.test(refreshFromSources), "native dashboard settings must merge through the guarded theme contract");
assert(/\.catch\(function\s*\(\)\s*\{/.test(refreshFromSources), "missing or invalid /api/config must preserve the already-applied fallback theme");
assert(/window\.addEventListener\(\s*["']storage["']/.test(bootstrap) && /event\.key\s*===\s*settingsStorageKey/.test(bootstrap), "standalone pages must listen for dashboard setting changes");
assert(/event\.key\s*===\s*null/.test(bootstrap) && /refreshFromSources\(\)/.test(bootstrap), "storage clearing events must safely refresh standalone presentation state");

assert(/window\.matchMedia\s*\?\s*window\.matchMedia\(\s*["']\(prefers-reduced-motion:\s*reduce\)["']\s*\)\s*:\s*null/.test(bootstrap), "standalone bootstrap must tolerate browsers without matchMedia");
assert(/reducedMotionQuery\.addEventListener\(\s*["']change["']/.test(bootstrap) && /reducedMotionQuery\.addListener\(/.test(bootstrap), "reduced-motion updates must support modern and legacy MediaQueryList APIs");
assert(/if\s*\(\s*!document\.body\s*\)/.test(bootstrap) && /DOMContentLoaded/.test(bootstrap) && /once\s*:\s*true/.test(bootstrap), "head bootstrap must safely defer body presentation until DOMContentLoaded");

const rootAdapterRule = cssRuleBody(adapterCss, "html[data-standalone-ui]");
const bodyAdapterRule = cssRuleBody(adapterCss, "html[data-standalone-ui] body");
for (const alias of [
  "--bg", "--fg", "--text", "--muted", "--panel", "--panel-2", "--panel-soft", "--panel-strong",
  "--surface", "--surface-strong", "--border", "--line", "--accent", "--accent-2", "--chip", "--good",
  "--warn", "--danger", "--shadow", "--radius", "--font", "--scene-a", "--scene-b", "--scene-c"
]) {
  assert(new RegExp(`${alias.replace("--", "--")}\\s*:\\s*var\\(`).test(rootAdapterRule), `legacy alias ${alias} must be scoped to html[data-standalone-ui]`);
}
assert(/overflow\s*:\s*auto\s*;/.test(rootAdapterRule), "standalone html must remain scrollable");
assert(/overflow\s*:\s*auto\s*;/.test(bodyAdapterRule), "standalone body must remain scrollable");

const focusRule = blockMatching(
  adapterCss,
  /html\[data-standalone-ui\][^{]*:focus-visible\s*\{/,
  "standalone focus-visible rule"
);
assert(/outline\s*:\s*3px\s+solid\s+var\(--theme-focus-ring\)/.test(focusRule) && /outline-offset\s*:\s*3px/.test(focusRule), "standalone controls must retain a visible theme-aware focus ring");
assert(/html\[data-standalone-ui\]\[data-readability=["']high-contrast["']\]/.test(adapterCss), "standalone adapter must scope its high-contrast treatment to the readability state");
assertCssDeclarations(
  cssRuleBody(themeCss, 'html[data-standalone-ui][data-readability="high-contrast"]'),
  {
    "--theme-text": "#ffffff",
    "--theme-text-muted": "#e6edf3",
    "--theme-border": "rgba(255, 255, 255, 0.4)",
    "--theme-border-strong": "rgba(255, 255, 255, 0.7)",
    "--theme-accent-border": "var(--theme-accent-text)",
    "--theme-focus-ring": "#ffffff",
    "--status-success-border": "var(--status-success-text)",
    "--status-warning-border": "var(--status-warning-text)",
    "--status-danger-border": "var(--status-danger-text)",
    "--theme-panel-shadow": "none",
    "--theme-panel-blur": "0px",
    "--theme-glow-intensity": "0"
  },
  "canonical standalone high-contrast tokens"
);

for (const selectorContract of [
  /html\[data-standalone-ui\]\[data-theme-variant=["']night["']\]/,
  /html\[data-standalone-ui\]\.dashboard-native-page--motion-off/,
  /html\[data-standalone-ui\]\[data-reduced-motion=["']true["']\]/
]) {
  assert(selectorContract.test(adapterCss), "night, explicit motion-off, and system reduced-motion states must all disable standalone motion");
}

const reducedMotionMedia = blockMatching(
  adapterCss,
  /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/,
  "prefers-reduced-motion media query"
);
assert(/html\[data-standalone-ui\]/.test(reducedMotionMedia), "reduced-motion media styles must stay scoped to standalone pages");
assert(/animation-duration\s*:\s*0\.01ms\s*!important/.test(reducedMotionMedia), "reduced motion must suppress standalone animation duration");
assert(/transition-duration\s*:\s*0ms\s*!important/.test(reducedMotionMedia), "reduced motion must suppress standalone transition duration");
assert(/scroll-behavior\s*:\s*auto\s*!important/.test(reducedMotionMedia), "reduced motion must disable animated standalone scrolling");

const forcedColorsMedia = blockMatching(
  adapterCss,
  /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{/,
  "forced-colors media query"
);
assert(/html\[data-standalone-ui\]/.test(forcedColorsMedia), "forced-color styles must stay scoped to standalone pages");
const forcedColorsThemeMedia = blockMatching(
  themeCss,
  /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{/,
  "canonical forced-colors media query"
);
assertCssDeclarations(
  cssRuleBody(forcedColorsThemeMedia, "html[data-standalone-ui]"),
  {
    "--theme-page": "Canvas",
    "--theme-surface-primary": "Canvas",
    "--theme-surface-secondary": "Canvas",
    "--theme-surface-elevated": "Canvas",
    "--theme-surface-muted": "Canvas",
    "--theme-border": "CanvasText",
    "--theme-border-strong": "CanvasText",
    "--theme-text": "CanvasText",
    "--theme-text-muted": "CanvasText",
    "--theme-accent": "LinkText",
    "--theme-accent-text": "LinkText",
    "--theme-on-accent": "Canvas",
    "--theme-focus-ring": "Highlight",
    "--theme-panel-shadow": "none",
    "--theme-glow-intensity": "0"
  },
  "canonical standalone forced-color tokens"
);
for (const systemColor of ["Canvas", "CanvasText", "Highlight"]) {
  assert(new RegExp(`\\b${systemColor}\\b`).test(forcedColorsMedia), `forced-color support must use ${systemColor}`);
}
assert(/forced-color-adjust\s*:\s*auto/.test(forcedColorsMedia) && /:focus-visible/.test(forcedColorsMedia), "forced-color mode must preserve native adjustment and visible focus");

console.log(`checked standalone theme contract for ${standalonePages.length} pages (${expectedRootPages.length} root + ${expectedWidgetPages.length} widgets)`);
