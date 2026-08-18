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
const buildRelease = readWorkspaceFile("scripts/build-release.ps1");
const jsonHelper = readWorkspaceFile("scripts/lib/Json.ps1");
const readme = readWorkspaceFile("README.md");
const freeBetaNotes = readWorkspaceFile("docs/release/FREE-BETA-RELEASE-NOTES.md");
const installNotes = readWorkspaceFile("docs/release/WINDOWS-INSTALL-UNINSTALL.md");
const publicReleaseChecklist = readWorkspaceFile("docs/release/PUBLIC-RELEASE-CHECKLIST.md");
const githubReleaseGuide = readWorkspaceFile("docs/release/GITHUB-RELEASE.md");
const packageJson = JSON.parse(readWorkspaceFile("package.json"));
const pwshRunScripts = collectPwshRunScripts(releaseWorkflow);

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

function collectPwshRunScripts(workflowText) {
  const lines = workflowText.split(/\r?\n/);
  const scripts = [];
  let pwshStep = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*-\s+name:/.test(line)) {
      pwshStep = false;
    }
    if (/^\s+shell:\s*pwsh\s*$/.test(line)) {
      pwshStep = true;
      continue;
    }
    const runMatch = line.match(/^(\s*)run:\s*\|\s*$/);
    if (!pwshStep || !runMatch) {
      continue;
    }

    const runIndent = runMatch[1].length;
    const body = [];
    for (index += 1; index < lines.length; index += 1) {
      const bodyLine = lines[index];
      const bodyIndent = bodyLine.match(/^\s*/)[0].length;
      if (bodyLine.trim() && bodyIndent <= runIndent) {
        index -= 1;
        break;
      }
      body.push(bodyLine);
    }
    scripts.push(body.join("\n"));
  }

  return scripts.join("\n");
}

assert(
  /\$RequireSignedInstaller\s+-and\s+\$AllowUnsignedBeta/.test(gauntlet)
    && /Cannot specify both -RequireSignedInstaller and -AllowUnsignedBeta/.test(gauntlet)
    && /Specify exactly one release mode: -RequireSignedInstaller or -AllowUnsignedBeta/.test(gauntlet)
    && /Signed commercial releases require -CommercialEvidencePath/.test(gauntlet)
    && /assert-commercial-launch-evidence\.ps1/.test(gauntlet)
    && /AllowedSignerThumbprint/.test(gauntlet)
    && /if\s*\(\$AllowUnsignedBeta\)\s*\{\s*\$readyArgs\s*\+=\s*@\("-AllowBetaVersion",\s*"-RequireUnsignedInstaller"\)\s*\}/.test(gauntlet)
    && /Test-ReleaseManifest\.ps1/.test(gauntlet)
    && /Test-BetaLifecycleReceipt\.ps1/.test(gauntlet)
    && /Test-FrigateQualificationReceipt\.ps1/.test(gauntlet)
    && /Test-DisplayQualificationReceipt\.ps1/.test(gauntlet)
    && /ReleaseAssetsPath, LifecycleReceiptPath, FrigateQualificationReceiptPath, and DisplayQualificationReceiptPath must be supplied together/.test(gauntlet)
    && /ExpectedTag", \$expectedTag/.test(gauntlet)
    && /ExpectedCommitSha", \$currentCommit/.test(gauntlet)
    && /Automatic selection is allowed only when app\\dist contains exactly one installer/.test(gauntlet)
    && /-Filter\s+"Auxora-Setup-\*\.exe"/.test(gauntlet)
    && /Assert-ReleaseVersionMode/.test(releaseReadiness)
    && /Beta release readiness requires -InstallerPath for the exact candidate/.test(releaseReadiness)
    && /Beta release readiness must require an exact unsigned installer/.test(releaseReadiness)
    && /function Invoke-CheckedReadinessCommand[\s\S]+?catch \{[\s\S]+?could not run:[\s\S]+?return \$false/.test(releaseReadiness)
    && /function Assert-File[\s\S]+?Test-Path -LiteralPath \$path -PathType Leaf/.test(releaseReadiness)
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
  packageJson.scripts["release:ready-beta"]?.includes("-AllowBetaVersion")
    && packageJson.scripts["release:ready-beta"]?.includes("-RequireUnsignedInstaller")
    && packageJson.scripts["release:windows-beta"]?.includes("-AllowUnsignedBeta")
    && /Invoke-CheckedCommand/.test(buildRelease)
    && /\$versionNode = \$project\.Project\.PropertyGroup \| Where-Object \{ \$_\.Version \} \| Select-Object -First 1/.test(buildRelease)
    && /\$safeVersion = \$version -replace '\[\^0-9A-Za-z\._-\]', '-'/.test(buildRelease)
    && /-InstallerPath applies only with -SkipInstaller/.test(buildRelease)
    && /exact installer built in this run or an explicit -InstallerPath/.test(buildRelease)
    && /-RequireUnsignedInstaller/.test(buildRelease)
    && !/Sort-Object LastWriteTime[\s\S]+Select-Object -First 1/.test(buildRelease),
  "beta release commands must allow beta mode, propagate failures, and carry an exact installer path"
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
    && /workflow_id[\s\S]+Windows Beta Candidate workflow/.test(releaseWorkflow)
    && /Test-ReleaseArtifact\.ps1[\s\S]+ExpectedInformationalVersion/.test(releaseWorkflow)
    && /ExpectedCommitSha/.test(releaseWorkflow)
    && /-RequireUnsigned/.test(releaseWorkflow)
    && (releaseWorkflow.match(/assert-release-ready\.ps1/g) ?? []).length === 2
    && (releaseWorkflow.match(/^\s+-RequireUnsignedInstaller\s*`?$/gm) ?? []).length === 2
    && /releaseLookupExitCode[\s\S]+\\bHTTP 404\\b/.test(releaseWorkflow)
    && !pwshRunScripts.includes("${{")
    && /frigate_qualification_receipt_base64:[\s\S]+?required:\s*true/.test(releaseWorkflow)
    && /Test-FrigateQualificationReceipt\.ps1/.test(releaseWorkflow)
    && /display_qualification_receipt_base64:[\s\S]+?required:\s*true/.test(releaseWorkflow)
    && /Test-DisplayQualificationReceipt\.ps1/.test(releaseWorkflow)
    && !/macos-latest|macOS package|release edit|-X DELETE/.test(releaseWorkflow)
    && /exactly five unique public assets/.test(releaseManifest)
    && /installerSha256/.test(lifecycleReceipt)
    && /ConvertFrom-JsonPreservingLexicalTypes/.test(lifecycleReceipt)
    && /Assert-ExactSchemaVersion/.test(lifecycleReceipt)
    && /-isnot \[bool\]/.test(lifecycleReceipt)
    && /ISO-8601 UTC timestamp/.test(lifecycleReceipt)
    && /AddMinutes\(5\)/.test(lifecycleReceipt)
    && /AddDays\(-30\)/.test(lifecycleReceipt)
    && /rollbackAfterInjectedFailure/.test(lifecycleReceipt)
    && /must contain exactly the schema-3 check names and no legacy or unknown entries/.test(lifecycleReceipt)
    && /staysClosedAfterInstall/.test(lifecycleReceipt)
    && /noAutoStartAfterReboot/.test(lifecycleReceipt)
    && /physicalFrigateServer/.test(frigateReceipt)
    && /ConvertFrom-JsonPreservingLexicalTypes/.test(frigateReceipt)
    && /Assert-ExactObjectShape/.test(frigateReceipt)
    && /realCamera/.test(frigateReceipt)
    && /windowsTrustedTls/.test(frigateReceipt)
    && /installerSha256/.test(frigateReceipt)
    && /physicalCompanionDisplay/.test(displayReceipt)
    && /ConvertFrom-JsonPreservingLexicalTypes/.test(displayReceipt)
    && /Assert-ExactObjectShape/.test(displayReceipt)
    && /noPrimaryIntersection/.test(displayReceipt)
    && /taskbarHidden/.test(displayReceipt)
    && /testedScalingPercent/.test(displayReceipt)
    && /installerSha256/.test(displayReceipt)
    && /hashStatus/.test(productWidget)
    && /signatureStatus/.test(productWidget)
    && /Direct download stays hidden until a newer artifact is verified/.test(productWidget)
    && /Open releases/.test(productWidget)
    && /open the official Releases page for a newer beta/.test(publicReleaseChecklist)
    && /keep direct installer links hidden/.test(publicReleaseChecklist)
    && /open its official Releases page/.test(githubReleaseGuide)
    && /keeps direct installer links hidden/.test(githubReleaseGuide),
  "release flow must expose available trust evidence without claiming verification and publish only immutable receipt-bound Windows assets"
);

assert(
  /DateKind/.test(jsonHelper)
    && /System\.Web\.Script\.Serialization\.JavaScriptSerializer/.test(jsonHelper)
    && /ConvertTo-JsonObjectPreservingLexicalTypes/.test(jsonHelper)
    && /ConvertFrom-JsonPreservingLexicalTypes/.test(releaseManifest)
    && ["test:release-manifest", "test:frigate-receipt", "test:display-receipt"].every((name) => (
      /powershell/i.test(packageJson.scripts[name]) && /pwsh/i.test(packageJson.scripts[name])
    )),
  "manifest and receipt gates must preserve JSON token types and run fixtures under Windows PowerShell and PowerShell 7"
);

assert(
  [readme, freeBetaNotes, installNotes].every((text) => (
    /Get-FileHash\s+-Algorithm\s+SHA256/.test(text)
      && /do not run the installer/i.test(text)
      && /unsigned/i.test(text)
      && /Never disable SmartScreen, Smart App Control, antivirus, or organization policy/.test(text)
      && /automatic startup disabled/.test(text)
      && /Windows 10 version 1809/i.test(text)
      && /x64/i.test(text)
      && /WebView2 Evergreen Runtime/i.test(text)
  )),
  "unsigned beta customer docs must explain checksum verification, stop on mismatch, preserve Windows security, keep startup disabled, and state Windows/x64/WebView2 requirements"
);

console.log("checked release gauntlet argument validation");
