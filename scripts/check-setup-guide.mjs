import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const setupGuide = readWorkspaceFile("widgets/setup-guide.html");

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  /\.is-hidden\s*\{[^}]*display\s*:\s*none\s*;/s.test(setupGuide),
  "setup guide must define a general .is-hidden utility"
);

assert(
  !/getIntegrationState\(\s*schema\s*,/s.test(setupGuide),
  "getIntegrationState callers must match the single-argument helper"
);

assert(
  !/summarizeIntegration\(\s*schema\s*,/s.test(setupGuide),
  "summarizeIntegration callers must match the single-argument helper"
);

console.log("checked widgets/setup-guide.html");
