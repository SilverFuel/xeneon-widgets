import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
      const declarations = [...clean.slice(open + 1, end - 1).matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)]
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

function computedTokens(node, root) {
  const inherited = node === root ? {} : computedTokens(root, root);
  const values = { ...inherited };
  const priorities = new Map();
  for (const rule of rules) {
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

function harness(runtime, initial = {}) {
  let settings = { themeSchemaVersion: "2", themeId: "focus", accentMode: "preset", customAccentColor: "", themeVariant: "standard", themeReadability: "normal", animationIntensity: "25", performanceBudget: "balanced", dashboardOpacity: "100", ...initial };
  const root = element("html");
  const body = element("body");
  const events = new Map();
  const context = {
    document: { documentElement: root, body, addEventListener() {} },
    window: {
      getComputedStyle(node) { return { getPropertyValue(name) { return computedTokens(node, root)[name] || ""; } }; },
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
    tokens(node = root) { return computedTokens(node, root); },
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
  for (const status of ["success", "warning", "danger"]) {
    const ratio = contrast(tokens[`--status-${status}-text`], tokens[`--status-${status}-surface`], tokens["--theme-surface-primary"]);
    assert.ok(ratio >= 4.5, `${label}: blended ${status} status text is ${ratio.toFixed(3)}:1`);
  }
}

test("Constellation palette and light/dark surface contracts agree across both runtimes", () => {
  for (const value of palette) assert.ok(themeCss.includes(value), `canonical palette must include ${value}`);
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
