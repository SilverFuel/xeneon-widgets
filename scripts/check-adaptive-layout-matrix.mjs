import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const { classifyViewport } = require(resolve(repoRoot, "js/layout-profile.js"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
    const portrait = width / height < 1;
    const ultrawide = width / height >= 2.8;
    const expectedProfile = {
      width,
      height,
      browser: width < 1100,
      compact: !portrait && !ultrawide && (width < 900 || height < 480),
      portrait,
      ultrawide
    };
    for (const [key, value] of Object.entries(expectedProfile)) {
      assert(profile[key] === value, `${display.width}x${display.height} at ${factor * 100}% expected ${key}=${value}, got ${profile[key]}`);
    }
    assert(
      profile.layoutClass === display.expected[index],
      `${display.width}x${display.height} at ${factor * 100}% expected ${display.expected[index]}, got ${profile.layoutClass}`
    );
    assert(
      [profile.compact, profile.portrait, profile.ultrawide].filter(Boolean).length <= 1,
      `${display.width}x${display.height} at ${factor * 100}% must not activate overlapping layout classes`
    );
  });
}

assert(classifyViewport(0, 0).layoutClass === "compact", "zero-sized transient viewports must classify safely");
const shortCompanion = classifyViewport(1280, 360);
assert(shortCompanion.layoutClass === "ultrawide", "1280x360 companion displays must use the ultrawide layout");
assert(!shortCompanion.compact, "1280x360 companion displays must not also activate the compact layout");
console.log(`checked ${displays.length * scaling.length} adaptive display and scaling combinations`);
