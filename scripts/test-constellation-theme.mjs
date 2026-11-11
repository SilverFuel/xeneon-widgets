import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const bootstrapSource = read("../js/theme-bootstrap.js");
const dashboardSource = read("../js/dashboard.js");
const themeCss = read("../css/theme.css");
const surfaces = ["--theme-page", "--theme-surface-primary", "--theme-surface-secondary", "--theme-surface-elevated"];
const palette = ["#f4f5f7", "#d4ac63", "#e56335", "#cd2435", "#2b4d7d"];
const expectedSurfaces = {
  focus: ["#f4f5f7", "#ffffff", "#e9edf3", "#ffffff"],
  gaming: ["#132238", "#1b304d", "#162940", "#223c5e"],
  warm: ["#f5f1e9", "#fffaf2", "#ebe3d6", "#ffffff"],
  night: ["#0c1726", "#132238", "#101d30", "#1b304d"],
  highContrast: ["#081321", "#101e30", "#0c1929", "#172b43"]
};
const presetAccents = { focus: palette[4], gaming: palette[1], warm: palette[2] };

// Only top-level token rules participate in these DOM-stub checks. Real
// browser/forced-colors rendering remains covered by the rendered theme suites.
function tokenRules(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  let start = 0;
  while (start < clean.length) {
    const open = clean.indexOf("{", start);
    if (open < 0) break;
    let depth = 1;
    let end = open + 1;
    while (depth && end < clean.length) {
      if (clean[end] === "{") depth++;
      if (clean[end] === "}") depth--;
      end++;
    }
    const selector = clean.slice(start, open).trim();
    if (!selector.startsWith("@")) {
      const declarations = [...clean.slice(open + 1, end - 1).matchAll(/(?:^|;)\s*(--[\w-]+|color-scheme|color|background)\s*:\s*([^;]+)(?=;|$)/g)]
        .map(([, name, value]) => ({ name, value: value.replace(/\s*!important\s*$/, "").trim(), important: /!important/.test(value) }));
      for (const part of selector.split(",").map(value => value.trim())) {
        if (declarations.length) rules.push({ selector: part, declarations });
      }
    }
    start = end;
  }
  return rules;
}
const rules = tokenRules(themeCss);

function element(tag) {
  const attributes = new Map();
  const classes = new Set();
  const properties = new Map();
  return {
    tag, attributes, classes, properties,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
    style: {
      setProperty(name, value) { properties.set(name, String(value)); },
      removeProperty(name) { properties.delete(name); },
      getPropertyValue(name) { return properties.get(name) || ""; }
    }
  };
}

function matchSelector(selector, node) {
  if (!/^(?::root|html|body)?(?:\[[^\]]+\]|\.[\w-]+)*$/.test(selector)) return false;
  const tag = selector.match(/^(:root|html|body)/)?.[1];
  if (tag && (tag === ":root" ? node.tag !== "html" : tag !== node.tag)) return false;
  for (const [, name, expected] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!node.attributes.has(name) || (expected !== undefined && node.attributes.get(name) !== expected)) return false;
  }
  return [...selector.matchAll(/\.([\w-]+)/g)].every(([, name]) => node.classes.has(name));
}

function computedTokens(node, root, appliedRules = rules) {
  const inherited = node === root ? {} : computedTokens(root, root, appliedRules);
  const values = { ...inherited };
  const priorities = new Map();
  for (const rule of appliedRules) {
    if (!matchSelector(rule.selector, node)) continue;
    const specificity = (rule.selector.match(/\[|\.|:root/g) || []).length * 10 + (/^(html|body)/.test(rule.selector) ? 1 : 0);
    for (const declaration of rule.declarations) {
      const priority = specificity + (declaration.important ? 10000 : 0);
      if (priority >= (priorities.get(declaration.name) ?? -1)) {
        priorities.set(declaration.name, priority);
        values[declaration.name] = declaration.value;
      }
    }
  }
  for (const [name, value] of node.properties) {
    if ((priorities.get(name) ?? -1) < 10000) values[name] = value;
  }
  function resolveValue(value, depth = 0) {
    assert.ok(depth < 16, "theme tokens must not contain reference cycles");
    return String(value || "").replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g,
      (_, name, fallback) => resolveValue(values[name] ?? fallback ?? "", depth + 1));
  }
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, resolveValue(value)]));
}

function color(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16)).concat(1);
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  assert.ok(rgba, `unresolved color: ${value}`);
  const channels = rgba[1].split(",").map(Number);
  return channels.length === 3 ? channels.concat(1) : channels;
}
function blend(front, back) {
  const foreground = color(front);
  const background = color(back);
  return foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]));
}
function contrast(foreground, background, underlay = "#ffffff") {
  const luminance = channels => channels.reduce((sum, value, index) => {
    const part = value / 255;
    return sum + (part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  const back = blend(background, underlay);
  const fore = blend(foreground, `rgb(${back.join(",")})`);
  const a = luminance(fore);
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function harness(runtime, initial = {}, pageRules = []) {
  const appliedRules = rules.concat(pageRules);
  let settings = { themeSchemaVersion: "2", themeId: "focus", accentMode: "preset", customAccentColor: "", themeVariant: "standard", themeReadability: "normal", animationIntensity: "25", performanceBudget: "balanced", dashboardOpacity: "100", ...initial };
  const root = element("html");
  const body = element("body");
  const events = new Map();
  const context = {
    document: { documentElement: root, body, addEventListener() {} },
    window: {
      getComputedStyle(node) { return { getPropertyValue(name) { return computedTokens(node, root, appliedRules)[name] || ""; } }; },
      localStorage: { getItem() { return JSON.stringify(settings); } },
      matchMedia() { return { matches: false, addEventListener() {} }; },
      addEventListener(name, callback) { events.set(name, callback); }
    },
    defaultSettings: { themeId: "focus" }, bridgeConfig: null,
    gameFaceLastActiveId: "", ambientCanvasPalette: [],
    getSetting(name) { return settings[name]; }, renderDashboardChromeState() {}
  };
  if (runtime === "standalone") {
    runInNewContext(bootstrapSource, context, { timeout: 1000 });
  } else {
    const presets = dashboardSource.match(/  var productThemePresets = \[[\s\S]*?\n  \];/)?.[0];
    const first = dashboardSource.indexOf("  function normalizeOpacityPercent(");
    const last = dashboardSource.indexOf("  function getParam(", first);
    assert.ok(presets && first >= 0 && last > first, "real dashboard presentation functions must be available");
    runInNewContext(presets + dashboardSource.slice(first, last), context, { timeout: 1000 });
    context.applyDashboardPresentation();
  }
  return {
    root, body, context,
    tokens(node = root) { return computedTokens(node, root, appliedRules); },
    update(next) {
      settings = { ...settings, ...next };
      if (runtime === "standalone") events.get("storage")({ key: "xeneon-dashboard-settings" });
      else context.applyDashboardPresentation();
    }
  };
}

function checkReadable(tokens, label, highContrast = false) {
  for (const surface of surfaces) {
    for (const foreground of ["--theme-text", "--theme-text-muted", "--theme-accent-text"]) {
      const minimum = highContrast && foreground !== "--theme-accent-text" ? 7 : 4.5;
      const ratio = contrast(tokens[foreground], tokens[surface]);
      assert.ok(ratio >= minimum, `${label}: ${foreground} on ${surface} is ${ratio.toFixed(3)}:1, requires ${minimum}:1`);
    }
  }
  assert.ok(contrast(tokens["--theme-on-accent"], tokens["--theme-accent"]) >= 4.5, `${label}: filled accent text must meet 4.5:1`);
  assert.equal(tokens["--theme-section-selected"], "#d4ac63", `${label}: selected sections retain Constellation Gold`);
  assert.equal(tokens["--theme-on-section-selected"], "#132238", `${label}: selected sections retain the navy foreground`);
  assert.ok(contrast(tokens["--theme-on-section-selected"], tokens["--theme-section-selected"]) >= 7, `${label}: selected section text must meet 7:1`);
  for (const status of ["success", "warning", "danger"]) {
    const ratio = contrast(tokens[`--status-${status}-text`], tokens[`--status-${status}-surface`], tokens["--theme-surface-primary"]);
    assert.ok(ratio >= 4.5, `${label}: blended ${status} status text is ${ratio.toFixed(3)}:1`);
  }
}

test("Constellation palette and light/dark surface contracts agree across both runtimes", () => {
  for (const runtime of ["dashboard", "standalone"]) {
    for (const themeId of ["focus", "gaming", "warm"]) {
      for (const themeVariant of ["standard", "night"]) {
        for (const themeReadability of ["normal", "high-contrast"]) {
          const fixture = harness(runtime, { themeId, themeVariant, themeReadability });
          const tokens = fixture.tokens();
          const expected = themeReadability === "high-contrast" ? expectedSurfaces.highContrast : themeVariant === "night" ? expectedSurfaces.night : expectedSurfaces[themeId];
          assert.deepEqual(surfaces.map(name => tokens[name]), expected, `${runtime}/${themeId}/${themeVariant}/${themeReadability}`);
          assert.equal(tokens["color-scheme"], themeReadability === "high-contrast" || themeVariant === "night" || themeId === "gaming" ? "dark" : "light");
          assert.equal(tokens["--theme-accent"], presetAccents[themeId]);
        }
      }
    }
  }
});

test("standalone embedded styles cannot revert Focus controls to a dark color scheme", () => {
  const pages = ["../", "../widgets/"].flatMap(directory => readdirSync(new URL(directory, import.meta.url))
    .filter(name => name.endsWith(".html"))
    .map(name => ({ path: directory + name, html: read(directory + name) })))
    .filter(page => /<script\b[^>]*\bsrc=["'][^"']*theme-bootstrap\.js(?:[?][^"']*)?["']/i.test(page.html));
  assert.equal(pages.length, 19, "all standalone themed pages must participate in the embedded-style regression");
  let lateDarkDefaults = 0;
  for (const page of pages) {
    const pageRules = [...page.html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
      .flatMap(([, css]) => tokenRules(css));
    if (pageRules.some(rule => rule.selector === ":root" && rule.declarations.some(({ name, value }) => name === "color-scheme" && value === "dark"))) lateDarkDefaults++;
    for (const themeId of ["focus", "gaming", "warm"]) {
      for (const themeVariant of ["standard", "night"]) {
        for (const themeReadability of ["normal", "high-contrast"]) {
          const fixture = harness("standalone", { themeId, themeVariant, themeReadability }, pageRules);
          const expected = themeId === "gaming" || themeVariant === "night" || themeReadability === "high-contrast" ? "dark" : "light";
          assert.equal(fixture.tokens()["color-scheme"], expected, `${page.path}/${themeId}/${themeVariant}/${themeReadability}: native controls must match the current surface palette`);
        }
      }
    }
  }
  assert.ok(lateDarkDefaults > 0, "the regression must exercise real embedded dark defaults after theme.css");
});

test("324 preset/custom accent states preserve text, filled-control, and status contrast", () => {
  let count = 0;
  for (const runtime of ["dashboard", "standalone"]) {
    for (const themeId of ["focus", "gaming", "warm"]) {
      for (const themeVariant of ["standard", "night"]) {
        for (const themeReadability of ["normal", "clean", "high-contrast"]) {
          for (const customAccentColor of ["", ...palette, "#000000", "#ffffff", "#777777"]) {
            const fixture = harness(runtime, { themeId, themeVariant, themeReadability, customAccentColor, accentMode: customAccentColor ? "custom" : "preset" });
            const label = `${runtime}/${themeId}/${themeVariant}/${themeReadability}/${customAccentColor || "preset"}`;
            checkReadable(fixture.tokens(), label, themeReadability === "high-contrast");
            assert.equal(fixture.tokens()["--theme-accent-text"], fixture.tokens(fixture.body)["--theme-accent-text"], `${label}: root/body contrast-safe text must agree`);
            count++;
          }
        }
      }
    }
  }
  assert.equal(count, 324);
});

test("widget accent text consumers remain readable on light, Night, and high-contrast surfaces", () => {
  const consumers = {
    "audio.css": [".audio-route-button strong", ".audio-session-row__level strong", ".audio-media-state", ".audio-album-cover__placeholder-label"],
    "product.css": [".auxora-remote-share code", ".product-layout-guide strong"],
    "actions.css": [".inline-launcher-icon"],
    "network.css": ['.network-form-message[data-tone="good"]'],
    "system.css": ['.system-stat-card[data-tone="good"] .system-stat-value', '.system-health-card[data-tone="good"] strong'],
    "game-mode.css": [".game-face-signals strong", ".game-focus-identity span", ".game-focus-metric strong", ".game-focus-audio-row b", ".game-focus-wake span"]
  };
  const cases = [];
  for (const [file, selectors] of Object.entries(consumers)) {
    const sourceRules = tokenRules(read(`../css/widgets/${file}`));
    for (const selector of selectors) {
      const declaration = sourceRules.filter(rule => rule.selector.replace(/\s+/g, " ") === selector)
        .flatMap(rule => rule.declarations).filter(item => item.name === "color").at(-1);
      assert.ok(declaration, `${file}: ${selector} must have its actual foreground checked`);
      cases.push({ label: `${file} ${selector}`, value: declaration.value });
    }
  }
  const cameraHtml = read("../widgets/unifi-camera-viewer.html");
  const cameraRules = [...cameraHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].flatMap(([, css]) => tokenRules(css));
  const cameraEyebrow = cameraRules.filter(rule => rule.selector === ".eyebrow")
    .flatMap(rule => rule.declarations).filter(item => item.name === "color").at(-1);
  assert.ok(cameraEyebrow, "camera viewer eyebrow foreground must be checked");
  cases.push({ label: "camera viewer eyebrow", value: cameraEyebrow.value });

  for (const themeId of ["focus", "gaming", "warm"]) {
    for (const themeVariant of ["standard", "night"]) {
      for (const themeReadability of ["normal", "high-contrast"]) {
        const tokens = harness("dashboard", { themeId, themeVariant, themeReadability }).tokens();
        for (const consumer of cases) {
          const foreground = consumer.value.replace(/var\((--[\w-]+)\)/g, (_, name) => tokens[name] || "");
          for (const surface of surfaces) {
            const ratio = contrast(foreground, tokens[surface]);
            assert.ok(ratio >= 4.5, `${consumer.label}/${themeId}/${themeVariant}/${themeReadability}: foreground on ${surface} is ${ratio.toFixed(3)}:1`);
          }
        }
      }
    }
  }
  const wakeBackground = tokenRules(read("../css/widgets/game-mode.css"))
    .filter(rule => rule.selector === ".game-focus-wake")
    .flatMap(rule => rule.declarations).filter(item => item.name === "background").at(-1);
  assert.ok(wakeBackground && /var\(--theme-page\)/.test(wakeBackground.value), "wake overlay must follow the active page surface so light-theme text retains contrast");
});

for (const runtime of ["dashboard", "standalone"]) {
  test(`${runtime}: Night and high contrast recalculate against their current surfaces`, () => {
    const fixture = harness(runtime, { accentMode: "custom", customAccentColor: palette[1] });
    const lightAccentText = fixture.tokens()["--theme-accent-text"];
    fixture.update({ themeVariant: "night" });
    checkReadable(fixture.tokens(), `${runtime} Night`);
    assert.notEqual(fixture.tokens()["--theme-accent-text"], lightAccentText, "Night must not retain a dark foreground adjusted for light surfaces");
    fixture.update({ themeReadability: "high-contrast" });
    checkReadable(fixture.tokens(), `${runtime} high contrast`, true);
    fixture.update({ themeId: "gaming", themeVariant: "standard", themeReadability: "normal", accentMode: "preset" });
    assert.equal(fixture.root.style.getPropertyValue("--theme-accent"), "", "returning to presets must remove a custom accent override");
    assert.equal(fixture.root.style.getPropertyValue("--theme-on-accent"), "", "returning to presets must remove the old filled-control foreground");
    assert.equal(fixture.tokens()["--theme-accent"], presetAccents.gaming);
    checkReadable(fixture.tokens(), `${runtime} restored preset`);
  });
}

test("live game colors override personal colors and are removed when the session ends", () => {
  const fixture = harness("dashboard", { accentMode: "custom", customAccentColor: palette[1], gameModeAccent: palette[3], gameModeSecondary: palette[2] });
  fixture.context.gameFaceLastActiveId = "fixture-game";
  fixture.update({ themeVariant: "night" });
  assert.equal(fixture.tokens()["--theme-accent"], palette[3]);
  assert.equal(fixture.tokens()["--theme-accent-secondary"], palette[2]);
  checkReadable(fixture.tokens(), "live game colors");
  fixture.context.gameFaceLastActiveId = "";
  fixture.update({});
  assert.equal(fixture.tokens()["--theme-accent"], palette[1]);
  assert.equal(fixture.root.style.getPropertyValue("--theme-accent-secondary"), "");
  checkReadable(fixture.tokens(), "personal colors restored");
});

for (const fixtureCase of [
  { label: "forced-colors", file: "./test-theme-rendered.mjs", name: "installQuickControlsForcedColorsFixture", next: "async function probeForcedColorsQuickControls()", query: "?quickControlsForcedColors=1", key: "__quickControlsForcedColorsFixture" },
  { label: "interactive", file: "./test-rendered-dashboard.mjs", name: "installQuickControlsFixture", next: "async function checkQuickControlsInPage(", query: "?quickControlsTest=800", key: "__quickControlsFixture" }
]) {
test(fixtureCase.label + " fixture isolates full Audio reads and blocks unexpected Quick requests", async () => {
  const source = read(fixtureCase.file);
  const start = source.indexOf("function " + fixtureCase.name + "() {");
  const end = source.indexOf(fixtureCase.next, start);
  assert.ok(start >= 0 && end > start, "appearance fixture must be extracted from the browser suite");
  const body = { dataset: { activeWidgetId: "audio" } };
  let drawerClosed = true;
  let liveFetches = 0;
  const window = { fetch() { liveFetches += 1; throw new Error("Appearance requests must not reach Windows"); } };
  const context = {
    window, URL, Response, Date, setTimeout,
    location: { search: fixtureCase.query, href: "http://127.0.0.1:18799/dashboard.html", origin: "http://127.0.0.1:18799" },
    document: { body, getElementById: id => id === "dashboard-quick-drawer" ? { classList: { contains: name => name === "is-hidden" && drawerClosed } } : null }
  };
  runInNewContext(source.slice(start, end) + "\n" + fixtureCase.name + "();", context);
  const fixture = window[fixtureCase.key];
  const blocked = fixture.blocked || fixture.unexpected;
  const panelResponse = await window.fetch("/api/audio/equalizer");
  assert.equal(panelResponse.status, 200);
  assert.equal((await panelResponse.json()).supported, false);
  assert.equal(fixture.panelReads.equalizer, 1);
  assert.equal(blocked.length, 0);

  drawerClosed = false;
  assert.equal((await window.fetch("/api/audio/equalizer")).status, 400, "Quick controls cannot read equalizer state");
  assert.equal((await window.fetch("/api/audio/equalizer", { method: "POST" })).status, 400);
  drawerClosed = true;
  assert.equal((await window.fetch("/api/audio/equalizer", { method: "POST" })).status, 400, "the full panel cannot mutate audio either");
  body.dataset.activeWidgetId = "system";
  assert.equal((await window.fetch("/api/audio/equalizer")).status, 400, "other panels cannot use the Audio read fixture");
  assert.equal((await window.fetch("/api/audio/devices")).status, 400, "unrelated endpoints remain blocked");
  for (const kind of ["audio", "media"]) {
    assert.equal((await window.fetch("/api/" + kind)).status, 200);
    assert.equal(fixture.reads[kind], 1);
  }
  assert.equal(fixture.panelReads.equalizer, 1);
  assert.equal(blocked.length, 5);
  assert.equal(liveFetches, 0);
});
}

test("synthetic Mode activation stays authoritative during evaluation and late config reads", async () => {
  const source = read("./test-rendered-dashboard.mjs");
  const start = source.indexOf("function installLegacyModeAuthorityFixture() {");
  const end = source.indexOf("async function validateLegacyLayoutPreservation(", start);
  assert.ok(start >= 0 && end > start);
  const helper = source.slice(start, end) + "\ninstallLegacyModeAuthorityFixture();";
  const nativeScene = { activeSceneId: "scene-work", activeScene: { id: "scene-work" }, profiles: [{ id: "scene-work" }, { id: "scene-gaming" }] };
  const nativeRequests = [];
  let holdConfig = false, releaseConfig;
  const window = { fetch: async (input, options) => {
    const path = new URL(String(input), "http://127.0.0.1:18799").pathname;
    const method = options?.method || "GET";
    nativeRequests.push({ path, method });
    if (path === "/api/config" && method === "GET") {
      if (holdConfig) await new Promise(resolve => { releaseConfig = resolve; });
      return new Response(JSON.stringify({ scenes: nativeScene, dashboard: { onboardingCompleted: true } }));
    }
    throw new Error("Unexpected native request: " + method + " " + path);
  } };
  const context = { window, URL, Response, location: { href: "http://127.0.0.1:18799/dashboard.html?legacyLayout=mode", origin: "http://127.0.0.1:18799" } };
  runInNewContext(helper, context);
  assert.equal((await window.fetch("/api/scenes/evaluate", { method: "POST" })).status, 503);
  assert.equal(nativeRequests.length, 0, "Initializing the fixture must not evaluate a real Mode");
  await window.fetch("/api/config");
  const fixture = window.__legacyModeAuthorityFixture;
  const gaming = { ...nativeScene, activeSceneId: "scene-gaming", activeScene: { id: "scene-gaming" }, manualOverrideActive: true };
  fixture.scenes = gaming;
  assert.equal((await (await window.fetch("/api/scenes")).json()).activeSceneId, "scene-gaming");
  assert.equal((await (await window.fetch("/api/scenes/evaluate", { method: "POST" })).json()).activeSceneId, "scene-gaming");
  holdConfig = true;
  const lateConfig = window.fetch("/api/config");
  fixture.scenes = { ...gaming, manualOverrideMinutesRemaining: 120 };
  releaseConfig();
  const config = await (await lateConfig).json();
  assert.equal(config.scenes.activeSceneId, "scene-gaming", "A late native read must not replace the synthetic activation");
  assert.equal(config.scenes.manualOverrideMinutesRemaining, 120);
  assert.equal(config.dashboard.onboardingCompleted, true, "Unrelated native configuration remains real");
  assert.equal(nativeScene.activeSceneId, "scene-work", "The test must not mutate the native host");
  assert.equal(fixture.evaluations, 2);
  assert.deepEqual(nativeRequests, [{ path: "/api/config", method: "GET" }, { path: "/api/config", method: "GET" }]);
  const untouchedFetch = () => {};
  const otherPage = { window: { fetch: untouchedFetch }, URL, location: { href: "http://127.0.0.1:18799/dashboard.html?legacyLayout=reload" } };
  runInNewContext(helper, otherPage);
  assert.equal(otherPage.window.fetch, untouchedFetch, "Other acceptance pages retain their real authority");
});
