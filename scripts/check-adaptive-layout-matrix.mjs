import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { classifyViewport } = require(resolve(process.cwd(), "js/layout-profile.js"));
const dashboard = readFileSync(resolve(process.cwd(), "js/dashboard.js"), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(/AuxoraLayout\.classifyViewport/.test(dashboard), "dashboard must use the tested adaptive layout classifier");

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
    const profile = classifyViewport(display.width / factor, display.height / factor);
    assert(
      profile.layoutClass === display.expected[index],
      `${display.width}x${display.height} at ${factor * 100}% expected ${display.expected[index]}, got ${profile.layoutClass}`
    );
  });
}

assert(classifyViewport(0, 0).layoutClass === "compact", "zero-sized transient viewports must classify safely");
console.log(`checked ${displays.length * scaling.length} adaptive display and scaling combinations`);
