import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const gauntlet = readWorkspaceFile("scripts/run-release-gauntlet.ps1");
const releaseService = readWorkspaceFile("app/Services/ReleaseService.cs");
const releaseWorkflow = readWorkspaceFile(".github/workflows/release.yml");
const productWidget = readWorkspaceFile("js/widgets/product.js");
const releaseManifest = readWorkspaceFile("scripts/Test-ReleaseManifest.ps1");
const lifecycleReceipt = readWorkspaceFile("scripts/Test-BetaLifecycleReceipt.ps1");
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
    && /assert-commercial-launch-evidence\.ps1/.test(gauntlet)
    && /AllowedSignerThumbprint/.test(gauntlet)
    && /Test-ReleaseManifest\.ps1/.test(gauntlet)
    && /Test-BetaLifecycleReceipt\.ps1/.test(gauntlet),
  "release gauntlet must reject conflicting signing modes and support exact manifest and lifecycle evidence"
);

assert(
  packageJson.scripts.check.includes("check:release-gauntlet") && packageJson.scripts["check:release-gauntlet"] === "node scripts/check-release-gauntlet.mjs",
  "npm run check must include the release gauntlet validation"
);

assert(
  /HashStatus/.test(releaseService)
    && /SignatureStatus/.test(releaseService)
    && /BuildReleaseTrust/.test(releaseService)
    && /verificationStatus/.test(releaseService)
    && /trusted = false/.test(releaseService)
    && /Build immutable Windows candidate/.test(releaseWorkflow)
    && /Publish receipt-bound Windows beta/.test(releaseWorkflow)
    && /Release .* already exists.*Published bytes are immutable/.test(releaseWorkflow)
    && /New-ReleaseManifest\.ps1/.test(releaseWorkflow)
    && /Test-BetaLifecycleReceipt\.ps1/.test(releaseWorkflow)
    && !/macos-latest|macOS package|release edit|-X DELETE/.test(releaseWorkflow)
    && /exactly five unique public assets/.test(releaseManifest)
    && /installerSha256/.test(lifecycleReceipt)
    && /hashStatus/.test(productWidget)
    && /signatureStatus/.test(productWidget),
  "release flow must expose available trust evidence without claiming verification and publish only immutable receipt-bound Windows assets"
);

console.log("checked release gauntlet argument validation");
