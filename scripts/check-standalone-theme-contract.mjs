import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
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
  return normalizeAssetReference(value).split("/").pop();
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

console.log(`checked standalone theme contract for ${standalonePages.length} pages (${expectedRootPages.length} root + ${expectedWidgetPages.length} widgets)`);
