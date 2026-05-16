import { readFileSync } from "node:fs";

const packageFiles = [
  "package.json",
  "desktop/electron/package.json"
];
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
];
const floatingRangePattern = /^(?:[\^~*]|latest$)/i;

for (const file of packageFiles) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  for (const section of dependencySections) {
    const dependencies = manifest[section] || {};
    for (const [name, version] of Object.entries(dependencies)) {
      if (floatingRangePattern.test(String(version))) {
        throw new Error(`${file} uses an unpinned ${section} range for ${name}: ${version}`);
      }
    }
  }
}

console.log("checked dependency version pins");
