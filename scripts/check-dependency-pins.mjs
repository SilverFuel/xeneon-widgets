import { existsSync, readFileSync, readdirSync } from "node:fs";
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

const workflowDirectory = resolve(process.cwd(), ".github", "workflows");
for (const fileName of readdirSync(workflowDirectory)) {
  if (!fileName.endsWith(".yml") && !fileName.endsWith(".yaml")) {
    continue;
  }

  const relativePath = `.github/workflows/${fileName}`;
  const workflow = readWorkspaceFile(relativePath);
  for (const line of workflow.split(/\r?\n/)) {
    const action = line.match(/^\s*uses:\s+([^\s#]+)(?:\s+#.*)?$/)?.[1];
    if (action && !/@[0-9a-f]{40}$/i.test(action)) {
      throw new Error(`${relativePath} uses a mutable action reference: ${action}`);
    }
  }
}

console.log("checked dependency and workflow action version pins");
