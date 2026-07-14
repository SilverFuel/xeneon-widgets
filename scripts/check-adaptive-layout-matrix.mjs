import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const { classifyViewport } = require(resolve(repoRoot, "js/layout-profile.js"));
const dashboard = readFileSync(resolve(repoRoot, "js/dashboard.js"), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(/AuxoraLayout\.classifyViewport/.test(dashboard), "dashboard must use the tested adaptive layout classifier");
for (const contract of [
  'document.body.classList.toggle("dashboard-native-page--browser", browserLayout)',
  'document.body.classList.toggle("dashboard-native-page--layout-compact", profile.compact)',
  'document.body.classList.toggle("dashboard-native-page--layout-portrait", profile.portrait)',
  'document.body.classList.toggle("dashboard-native-page--layout-ultrawide", profile.ultrawide)',
  "document.body.dataset.layoutClass = profile.layoutClass"
]) {
  assert(dashboard.includes(contract), `dashboard must apply adaptive profile contract: ${contract}`);
}

const displays = [
  { width: 800, height: 480, expected: ["compact", "compact", "compact", "compact", "compact"] },
  { width: 1024, height: 600, expected: ["standard", "compact", "compact", "compact", "compact"] },
  { width: 1280, height: 400, expected: ["ultrawide", "ultrawide", "ultrawide", "ultrawide", "ultrawide"] },
  { width: 1280, height: 800, expected: ["standard", "standard", "compact", "compact", "compact"] },
  { width: 1920, height: 480, expected: ["ultrawide", "ultrawide", "ultrawide", "ultrawide", "ultrawide"] },
  { width: 1920, height: 1080, expected: ["standard", "standard", "standard", "standard", "standard"] },
  { width: 2560, height: 720, expected: ["ultrawide", "ultrawide", "ultrawide", "ultrawide", "ultrawide"] },
  { width: 800, height: 1280, expected: ["portrait", "portrait", "portrait", "portrait", "portrait"] }
];
const scaling = [1, 1.25, 1.5, 1.75, 2];

for (const display of displays) {
  scaling.forEach((factor, index) => {
    const width = display.width / factor;
    const height = display.height / factor;
    const profile = classifyViewport(width, height);
    const expectedProfile = {
      width,
      height,
      browser: width < 1100,
      compact: width < 900 || height < 480,
      portrait: width / height < 1,
      ultrawide: width / height >= 2.8
    };
    for (const [key, value] of Object.entries(expectedProfile)) {
      assert(profile[key] === value, `${display.width}x${display.height} at ${factor * 100}% expected ${key}=${value}, got ${profile[key]}`);
    }
    assert(
      profile.layoutClass === display.expected[index],
      `${display.width}x${display.height} at ${factor * 100}% expected ${display.expected[index]}, got ${profile.layoutClass}`
    );
  });
}

assert(classifyViewport(0, 0).layoutClass === "compact", "zero-sized transient viewports must classify safely");
console.log(`checked ${displays.length * scaling.length} adaptive display and scaling combinations`);
