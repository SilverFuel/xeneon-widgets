import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const gauntlet = readWorkspaceFile("scripts/run-release-gauntlet.ps1");
const releaseService = readWorkspaceFile("app/Services/ReleaseService.cs");
const releaseWorkflow = readWorkspaceFile(".github/workflows/release.yml");
const productWidget = readWorkspaceFile("js/widgets/product.js");
const releaseManifest = readWorkspaceFile("scripts/Test-ReleaseManifest.ps1");
const lifecycleReceipt = readWorkspaceFile("scripts/Test-BetaLifecycleReceipt.ps1");
const frigateReceipt = readWorkspaceFile("scripts/Test-FrigateQualificationReceipt.ps1");
const displayReceipt = readWorkspaceFile("scripts/Test-DisplayQualificationReceipt.ps1");
const releaseReadiness = readWorkspaceFile("scripts/assert-release-ready.ps1");
const freeBetaPreparation = readWorkspaceFile("scripts/prepare-free-beta-release.ps1");
const releaseVersionMode = readWorkspaceFile("scripts/lib/ReleaseVersionMode.ps1");
const releaseVersionModeFixtures = readWorkspaceFile("scripts/test-release-version-mode.ps1");
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
    && /if\s*\(\$AllowUnsignedBeta\)\s*\{\s*\$readyArgs\s*\+=\s*"-AllowBetaVersion"\s*\}/.test(gauntlet)
    && /Test-ReleaseManifest\.ps1/.test(gauntlet)
    && /Test-BetaLifecycleReceipt\.ps1/.test(gauntlet)
    && /Test-FrigateQualificationReceipt\.ps1/.test(gauntlet)
    && /Test-DisplayQualificationReceipt\.ps1/.test(gauntlet)
    && /ReleaseAssetsPath, LifecycleReceiptPath, FrigateQualificationReceiptPath, and DisplayQualificationReceiptPath must be supplied together/.test(gauntlet)
    && /Assert-ReleaseVersionMode/.test(releaseReadiness)
    && /\$AllowBetaVersion\s+-and\s+\$RequireSignedInstaller/.test(releaseVersionMode)
    && /Unsigned beta mode requires/.test(releaseVersionMode)
    && /Default and signed release modes require/.test(releaseVersionMode)
    && /unsigned beta mode with stable/.test(releaseVersionModeFixtures)
    && /signed beta conflicting flags/.test(releaseVersionModeFixtures)
    && /leading-zero identifier/.test(releaseVersionModeFixtures)
    && /stable Unicode digit/.test(releaseVersionModeFixtures)
    && /beta Unicode digit/.test(releaseVersionModeFixtures),
  "release gauntlet must reject conflicting signing modes and support exact manifest and lifecycle evidence"
);

assert(
  packageJson.scripts.check.includes("check:release-gauntlet") && packageJson.scripts["check:release-gauntlet"] === "node scripts/check-release-gauntlet.mjs",
  "npm run check must include the release gauntlet validation"
);

assert(
  /Free beta publication preparation requires -ReleaseAssetsPath, -LifecycleReceiptPath, -FrigateQualificationReceiptPath, and -DisplayQualificationReceiptPath/.test(freeBetaPreparation)
    && /run-release-gauntlet\.ps1/.test(freeBetaPreparation)
    && /-FrigateQualificationReceiptPath/.test(freeBetaPreparation)
    && /-DisplayQualificationReceiptPath/.test(freeBetaPreparation)
    && /Upload only these manifest-bound files/.test(freeBetaPreparation)
    && /qualification receipts are gates, not public release assets/i.test(freeBetaPreparation),
  "manual free beta preparation must fail closed without all exact-candidate physical receipts"
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
    && /frigate_qualification_receipt_base64:[\s\S]+?required:\s*true/.test(releaseWorkflow)
    && /Test-FrigateQualificationReceipt\.ps1/.test(releaseWorkflow)
    && /display_qualification_receipt_base64:[\s\S]+?required:\s*true/.test(releaseWorkflow)
    && /Test-DisplayQualificationReceipt\.ps1/.test(releaseWorkflow)
    && !/macos-latest|macOS package|release edit|-X DELETE/.test(releaseWorkflow)
    && /exactly five unique public assets/.test(releaseManifest)
    && /installerSha256/.test(lifecycleReceipt)
    && /physicalFrigateServer/.test(frigateReceipt)
    && /realCamera/.test(frigateReceipt)
    && /windowsTrustedTls/.test(frigateReceipt)
    && /installerSha256/.test(frigateReceipt)
    && /physicalCompanionDisplay/.test(displayReceipt)
    && /noPrimaryIntersection/.test(displayReceipt)
    && /taskbarHidden/.test(displayReceipt)
    && /testedScalingPercent/.test(displayReceipt)
    && /installerSha256/.test(displayReceipt)
    && /hashStatus/.test(productWidget)
    && /signatureStatus/.test(productWidget),
  "release flow must expose available trust evidence without claiming verification and publish only immutable receipt-bound Windows assets"
);

console.log("checked release gauntlet argument validation");
