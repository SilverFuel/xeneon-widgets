import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const gauntlet = readWorkspaceFile("scripts/run-release-gauntlet.ps1");
const releaseService = readWorkspaceFile("app/Services/ReleaseService.cs");
const releaseWorkflow = readWorkspaceFile(".github/workflows/release.yml");
const productWidget = readWorkspaceFile("js/widgets/product.js");
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
    && /Cannot specify both -RequireSignedInstaller and -AllowUnsignedBeta/.test(gauntlet)
    && /Signed commercial releases require -CommercialEvidencePath/.test(gauntlet)
    && /assert-commercial-launch-evidence\.ps1/.test(gauntlet),
  "release gauntlet must reject conflicting signing modes and require structured evidence for commercial releases"
);

assert(
  packageJson.scripts.check.includes("check:release-gauntlet") && packageJson.scripts["check:release-gauntlet"] === "node scripts/check-release-gauntlet.mjs",
  "npm run check must include the release gauntlet validation"
);

assert(
  /HashStatus/.test(releaseService)
    && /SignatureStatus/.test(releaseService)
    && /BuildReleaseTrust/.test(releaseService)
    && /Verify Windows signing policy/.test(releaseWorkflow)
    && /Public stable releases require a valid Authenticode signature/.test(releaseWorkflow)
    && /signature-status\.txt/.test(releaseWorkflow)
    && /hashStatus/.test(productWidget)
    && /signatureStatus/.test(productWidget),
  "release flow must expose hash/signature status and enforce signing on public stable releases"
);

console.log("checked release gauntlet argument validation");
