import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

function readWorkspaceFile(relativePath) {
  const filePath = resolve(process.cwd(), relativePath);
  try {
    if (!existsSync(filePath)) {
      throw new Error("file does not exist");
    }

    return readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`Unable to read ${relativePath} at ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

for (const file of packageFiles) {
  const manifest = JSON.parse(readWorkspaceFile(file));
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
