import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const gauntlet = readWorkspaceFile("scripts/run-release-gauntlet.ps1");
const packageJson = JSON.parse(readWorkspaceFile("package.json"));

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
  /\$RequireSignedInstaller\s+-and\s+\$AllowUnsignedBeta/.test(gauntlet)
    && /Cannot specify both -RequireSignedInstaller and -AllowUnsignedBeta/.test(gauntlet),
  "release gauntlet must reject mutually exclusive installer-signing switches"
);

assert(
  packageJson.scripts.check.includes("check:release-gauntlet") && packageJson.scripts["check:release-gauntlet"] === "node scripts/check-release-gauntlet.mjs",
  "npm run check must include the release gauntlet validation"
);

console.log("checked release gauntlet argument validation");
