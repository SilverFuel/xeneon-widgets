import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const CANONICAL_THEME_IDS = ["focus", "gaming", "warm"];
const LEGACY_THEME_IDS = ["edge", "deepcore", "afterburn", "verdant"];
const REQUIRED_THEME_TOKENS = [
  "--theme-page",
  "--theme-surface-primary",
  "--theme-surface-secondary",
  "--theme-surface-elevated",
  "--theme-border",
  "--theme-border-strong",
  "--theme-text",
  "--theme-text-muted",
  "--theme-accent",
  "--theme-accent-secondary",
  "--theme-selected-surface",
  "--theme-hover-surface",
  "--theme-pressed-surface",
  "--theme-ambient-primary",
  "--theme-ambient-secondary",
  "--theme-ambient-rim",
  "--theme-panel-shadow",
  "--theme-motion-scale",
  "--theme-glow-intensity",
  "--theme-night-brightness",
  "--theme-night-glow",
  "--status-success-text",
  "--status-success-surface",
  "--status-success-border",
  "--status-warning-text",
  "--status-warning-surface",
  "--status-warning-border",
  "--status-danger-text",
  "--status-danger-surface",
  "--status-danger-border"
];
const STRUCTURAL_TOKENS = [
  "--theme-page",
  "--theme-surface-primary",
  "--theme-surface-secondary",
  "--theme-surface-elevated",
  "--theme-border",
  "--theme-border-strong",
  "--theme-text",
  "--theme-text-muted",
  "--theme-selected-surface",
  "--theme-hover-surface",
  "--theme-pressed-surface",
  "--theme-ambient-primary",
  "--theme-ambient-secondary",
  "--theme-ambient-rim",
  "--theme-vignette",
  "--theme-panel-shadow",
  "--theme-inner-highlight",
  "--theme-motion-scale",
  "--theme-glow-intensity",
  "--theme-panel-radius",
  "--theme-panel-blur"
];
const LEGACY_PALETTE_ALIASES = [
  "--color-bg",
  "--color-panel",
  "--color-panel-2",
  "--color-accent",
  "--color-accent-soft",
  "--color-text",
  "--color-text-dim",
  "--color-border",
  "--shadow-panel",
  "--dashboard-accent",
  "--dashboard-secondary",
  "--dashboard-warm",
  "--dashboard-accent-glow",
  "--dashboard-secondary-glow",
  "--dashboard-warm-glow",
  "--dashboard-theme-bg"
];

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function readWorkspaceFile(relativePath) {
  const filePath = resolve(process.cwd(), relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`${relativePath} does not exist at ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function walkSourceFiles(relativeDirectory, allowedExtensions) {
  const root = resolve(process.cwd(), relativeDirectory);
  const result = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (["bin", "obj", "node_modules", "tests"].includes(entry.name.toLowerCase())) {
          continue;
        }
        visit(resolve(directory, entry.name));
      } else if (entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase())) {
        result.push(relative(process.cwd(), resolve(directory, entry.name)).replaceAll("\\", "/"));
      }
    }
  }

  visit(root);
  return result.sort();
}

function matchingClose(source, openIndex, openCharacter, closeCharacter) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] || "";

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === openCharacter) depth += 1;
    if (character === closeCharacter) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function extractAssignedLiteral(source, identifier, openCharacter, closeCharacter) {
  const declaration = new RegExp(`\\b(?:var|let|const)\\s+${identifier}\\s*=`, "m").exec(source);
  if (!declaration) return null;
  const openIndex = source.indexOf(openCharacter, declaration.index + declaration[0].length);
  if (openIndex === -1) return null;
  const closeIndex = matchingClose(source, openIndex, openCharacter, closeCharacter);
  if (closeIndex === -1) return null;
  return {
    source: source.slice(openIndex, closeIndex + 1),
    start: openIndex,
    end: closeIndex + 1
  };
}

function evaluateDataLiteral(literal, description) {
  try {
    return runInNewContext(`(${literal})`, Object.create(null), { timeout: 500 });
  } catch (error) {
    failures.push(`${description} must remain a data-only literal that the contract check can evaluate: ${error.message}`);
    return null;
  }
}

function extractCssBlocks(source, context = [], offset = 0) {
  const blocks = [];
  let cursor = 0;

  while (cursor < source.length) {
    const openIndex = source.indexOf("{", cursor);
    if (openIndex === -1) break;
    const closeIndex = matchingClose(source, openIndex, "{", "}");
    if (closeIndex === -1) break;
    const preludeStart = Math.max(source.lastIndexOf("}", openIndex - 1), source.lastIndexOf(";", openIndex - 1)) + 1;
    const prelude = source.slice(preludeStart, openIndex).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const body = source.slice(openIndex + 1, closeIndex);

    if (prelude.startsWith("@")) {
      blocks.push(...extractCssBlocks(body, [...context, prelude], offset + openIndex + 1));
    } else if (prelude) {
      blocks.push({ selector: prelude, body, context, start: offset + preludeStart, end: offset + closeIndex + 1 });
    }
    cursor = closeIndex + 1;
  }
  return blocks;
}

function parseCustomProperties(body) {
  const declarations = new Map();
  const pattern = /(^|[;\n\r])\s*(--[a-z0-9-]+)\s*:\s*([^;{}]+)\s*;/gim;
  let match;
  while ((match = pattern.exec(body))) {
    declarations.set(match[2], match[3].trim().replace(/\s+/g, " "));
  }
  return declarations;
}

function selectorList(selector) {
  return selector.split(",").map(value => value.trim());
}

function hasExactSelector(block, selectorPattern) {
  return selectorList(block.selector).some(selector => selectorPattern.test(selector));
}

function canonicalThemeIds(themes) {
  return Array.isArray(themes) ? themes.map(theme => String(theme && theme.id || "")) : [];
}

function sameOrderedValues(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function allowedLegacyRanges(source) {
  const ranges = [];
  const functionPatterns = [
    /\bfunction\s+([a-z0-9_$]*(?:normalize|migrate)[a-z0-9_$]*theme[a-z0-9_$]*|[a-z0-9_$]*theme[a-z0-9_$]*(?:normalize|migrate)[a-z0-9_$]*)\s*\([^)]*\)\s*\{/gim,
    /\b(?:public|private|internal|protected)\s+(?:static\s+)?[a-z0-9_?<>]+\s+([a-z0-9_]*(?:normalize|migrate)[a-z0-9_]*theme[a-z0-9_]*|[a-z0-9_]*theme[a-z0-9_]*(?:normalize|migrate)[a-z0-9_]*)\s*\([^)]*\)\s*\{/gim
  ];
  const compatibilityObjectPattern = /\b(?:var|let|const)\s+([a-z0-9_$]*(?:legacy|migration|alias)[a-z0-9_$]*theme[a-z0-9_$]*|[a-z0-9_$]*theme[a-z0-9_$]*(?:legacy|migration|alias)[a-z0-9_$]*)\s*=\s*\{/gim;

  for (const pattern of [...functionPatterns, compatibilityObjectPattern]) {
    let match;
    while ((match = pattern.exec(source))) {
      const openIndex = source.indexOf("{", match.index);
      const closeIndex = matchingClose(source, openIndex, "{", "}");
      if (closeIndex !== -1) ranges.push([match.index, closeIndex + 1]);
    }
  }
  return ranges;
}

function isInsideRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

const dashboardJs = readWorkspaceFile("js/dashboard.js");
const inlineWidgetsJs = readWorkspaceFile("js/inline-widgets.js");
const productWidgetJs = readWorkspaceFile("js/widgets/product.js");
const appConfigCs = readWorkspaceFile("app/Models/AppConfig.cs");
const themeCss = readWorkspaceFile("css/theme.css");
const cssFiles = walkSourceFiles("css", new Set([".css"]));
const runtimeFiles = [
  ...walkSourceFiles("js", new Set([".js"])),
  "app/Models/AppConfig.cs",
  "app/Services/SceneDefaults.cs",
  "app/Services/SceneService.cs"
];
const allCss = cssFiles.map(path => readWorkspaceFile(path)).join("\n");

const presetLiteral = extractAssignedLiteral(dashboardJs, "productThemePresets", "[", "]");
check(Boolean(presetLiteral), "js/dashboard.js must declare productThemePresets as a data array");
const presets = presetLiteral ? evaluateDataLiteral(presetLiteral.source, "productThemePresets") : null;
const presetIds = canonicalThemeIds(presets);
check(
  sameOrderedValues(presetIds, CANONICAL_THEME_IDS),
  `productThemePresets must contain exactly focus, gaming, and warm in that order; found ${presetIds.join(", ") || "none"}`
);
if (Array.isArray(presets)) {
  for (const id of CANONICAL_THEME_IDS) {
    const preset = presets.find(entry => entry && entry.id === id);
    check(Boolean(preset), `productThemePresets must include ${id}`);
    check(String(preset && preset.name || "").toLowerCase() === id, `${id} must use the user-facing name ${id[0].toUpperCase()}${id.slice(1)}`);
  }
}

const fallbackLiteral = extractAssignedLiteral(inlineWidgetsJs, "fallbackProductThemes", "[", "]");
if (fallbackLiteral) {
  const fallbackThemes = evaluateDataLiteral(fallbackLiteral.source, "fallbackProductThemes");
  const fallbackIds = canonicalThemeIds(fallbackThemes);
  check(
    sameOrderedValues(fallbackIds, CANONICAL_THEME_IDS),
    `fallbackProductThemes must match the canonical focus, gaming, warm contract; found ${fallbackIds.join(", ") || "none"}`
  );
}

const defaultsLiteral = extractAssignedLiteral(dashboardJs, "defaultSettings", "{", "}");
const defaultThemeId = defaultsLiteral?.source.match(/\bthemeId\s*:\s*["']([^"']+)["']/)?.[1] || "";
check(defaultThemeId === "focus", `new dashboard settings must default to focus; found ${defaultThemeId || "no themeId"}`);
check(
  /\bThemeId\s*\{[^}]*\}\s*=\s*"focus"\s*;/s.test(appConfigCs),
  "native AppConfig theme defaults must use focus"
);

check(!/Release\s+look/i.test(productWidgetJs), 'Theme Studio must not use the obsolete "Release look" label');
check(
  /<span>Theme<\/span>\s*<select[^>]+name=["']themeId["']/i.test(productWidgetJs),
  'Theme Studio must label the themeId selector "Theme"'
);

const cssBlocks = extractCssBlocks(themeCss);
const baseRootBlock = cssBlocks.find(block => block.context.length === 0 && hasExactSelector(block, /^:root$/));
check(Boolean(baseRootBlock), "css/theme.css must define the Focus fallback contract in a top-level :root block");
const baseDeclarations = baseRootBlock ? parseCustomProperties(baseRootBlock.body) : new Map();
const resolvedThemes = new Map();

for (const id of CANONICAL_THEME_IDS) {
  const themeBlock = cssBlocks.find(block => block.context.length === 0 && hasExactSelector(
    block,
    new RegExp(`^:root\\[data-theme=["']${id}["']\\]$`)
  ));
  const declarations = new Map(baseDeclarations);
  if (themeBlock) {
    for (const [token, value] of parseCustomProperties(themeBlock.body)) declarations.set(token, value);
  }
  if (id !== "focus") {
    check(Boolean(themeBlock), `css/theme.css must define an explicit :root[data-theme="${id}"] contract`);
  }
  resolvedThemes.set(id, declarations);
  for (const token of REQUIRED_THEME_TOKENS) {
    check(declarations.has(token), `${id} is missing required semantic token ${token}`);
  }
}

const nightBlock = cssBlocks.find(block => block.context.length === 0 && hasExactSelector(
  block,
  /^:root\[data-theme-variant=["']night["']\]$/
));
const nightDeclarations = nightBlock ? parseCustomProperties(nightBlock.body) : new Map();
check(Boolean(nightBlock), 'css/theme.css must define :root[data-theme-variant="night"]');
for (const token of ["--theme-night-brightness", "--theme-night-glow", "--theme-motion-scale", "--theme-glow-intensity"]) {
  check(nightDeclarations.has(token), `Night must override ${token}`);
}

for (let leftIndex = 0; leftIndex < CANONICAL_THEME_IDS.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < CANONICAL_THEME_IDS.length; rightIndex += 1) {
    const leftId = CANONICAL_THEME_IDS[leftIndex];
    const rightId = CANONICAL_THEME_IDS[rightIndex];
    const left = resolvedThemes.get(leftId) || new Map();
    const right = resolvedThemes.get(rightId) || new Map();
    const different = STRUCTURAL_TOKENS.filter(token => left.get(token) !== right.get(token));
    const surfaceDifferences = ["--theme-page", "--theme-surface-primary", "--theme-surface-secondary", "--theme-surface-elevated"]
      .filter(token => left.get(token) !== right.get(token));
    const interactionDifferences = ["--theme-selected-surface", "--theme-hover-surface", "--theme-pressed-surface"]
      .filter(token => left.get(token) !== right.get(token));
    const behaviorDifferences = ["--theme-motion-scale", "--theme-glow-intensity", "--theme-panel-radius", "--theme-panel-blur"]
      .filter(token => left.get(token) !== right.get(token));

    check(different.length >= 8, `${leftId} and ${rightId} must differ on at least 8 non-accent structural tokens; found ${different.length}`);
    check(surfaceDifferences.length >= 3, `${leftId} and ${rightId} must have materially different surfaces`);
    check(interactionDifferences.length >= 2, `${leftId} and ${rightId} must have different selected/hover/pressed treatment`);
    check(behaviorDifferences.length >= 2, `${leftId} and ${rightId} must differ in glow, motion, radius, or blur behavior`);
  }
}

for (const token of REQUIRED_THEME_TOKENS) {
  const usagePattern = new RegExp(`var\\(\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*[,\\)])`, "g");
  check(usagePattern.test(allCss), `${token} is defined but not consumed by dashboard CSS`);
}

for (const path of cssFiles) {
  const source = readWorkspaceFile(path);
  for (const block of extractCssBlocks(source)) {
    const declarations = parseCustomProperties(block.body);
    for (const token of REQUIRED_THEME_TOKENS) {
      if (declarations.has(token) && path !== "css/theme.css") {
        failures.push(`${path} redeclares ${token}; semantic theme tokens must be owned only by css/theme.css`);
      }
    }
    if (path !== "css/theme.css") {
      for (const token of LEGACY_PALETTE_ALIASES) {
        if (declarations.has(token)) {
          failures.push(`${path} ${block.selector} shadows ${token}; palette aliases must inherit from css/theme.css`);
        }
      }
    }
  }
}

for (const path of walkSourceFiles("js", new Set([".js"]))) {
  const source = readWorkspaceFile(path);
  for (const token of LEGACY_PALETTE_ALIASES) {
    const writePattern = new RegExp(`(?:document\\.(?:documentElement|body)|document\\.querySelector\\([^)]*\\))\\.style\\.setProperty\\(\\s*["']${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "g");
    check(!writePattern.test(source), `${path} must not shadow the token contract by writing ${token} on body/:root`);
  }
}

for (const path of runtimeFiles) {
  const source = readWorkspaceFile(path);
  const ranges = allowedLegacyRanges(source);
  const legacyPattern = new RegExp(`["'](${LEGACY_THEME_IDS.join("|")})["']`, "g");
  let match;
  while ((match = legacyPattern.exec(source))) {
    if (!isInsideRanges(match.index, ranges)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      failures.push(`${path}:${line} uses legacy theme id ${match[1]} outside an explicit theme normalization/migration boundary`);
    }
  }
}

const dashboardMigrationRange = allowedLegacyRanges(dashboardJs).find(([start, end]) => {
  const body = dashboardJs.slice(start, end);
  return LEGACY_THEME_IDS.every(id => new RegExp(`["']?${id}["']?\\s*:`).test(body));
});
check(Boolean(dashboardMigrationRange), "dashboard runtime must explicitly migrate edge, deepcore, afterburn, and verdant to canonical theme IDs");
if (dashboardMigrationRange) {
  const migrationBody = dashboardJs.slice(dashboardMigrationRange[0], dashboardMigrationRange[1]);
  for (const id of LEGACY_THEME_IDS) {
    const mappedValue = migrationBody.match(new RegExp(`["']?${id}["']?\\s*:\\s*["'](${CANONICAL_THEME_IDS.join("|")})["']`, "i"))?.[1] || "";
    check(CANONICAL_THEME_IDS.includes(mappedValue), `${id} must map explicitly to focus, gaming, or warm`);
  }
}

if (failures.length) {
  console.error(`theme contract check failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exitCode = 1;
} else {
  console.log("checked canonical theme IDs, defaults, semantic tokens, CSS consumption, structural differentiation, migration boundaries, and Theme Studio wording");
}
