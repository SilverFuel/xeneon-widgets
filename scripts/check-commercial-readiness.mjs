import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

function read(relativePath) {
  const path = resolve(process.cwd(), relativePath);
  if (!existsSync(path)) {
    throw new Error(`${relativePath} does not exist`);
  }
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const appProject = read("app/XenonEdgeHost.csproj");
const electronPackage = JSON.parse(read("desktop/electron/package.json"));
const readme = read("README.md");
const support = read("support.html");
const betaPolicy = read("refund-policy.html");
const privacy = read("PRIVACY.md");
const smoke = read("scripts/test-windows-install.ps1");
const readiness = read("scripts/assert-release-ready.ps1");
const evidenceGate = read("scripts/assert-commercial-launch-evidence.ps1");
const evidenceTemplate = JSON.parse(read("docs/release/commercial-launch-evidence.example.json"));
const workflow = read(".github/workflows/release.yml");
const packageJson = JSON.parse(read("package.json"));
const buildLauncher = read("Build Auxora Installer.cmd");
const openLauncher = read("Open Auxora.cmd");

const version = appProject.match(/<Version>([^<]+)<\/Version>/)?.[1];
assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || ""), "native app must define a semantic release version");
assert(electronPackage.version === version, "Windows and Electron product versions must match");
assert(electronPackage.build?.productName === "Auxora", "Electron public product name must be Auxora");
assert(electronPackage.name === "auxora-desktop", "Electron package identity must use the Auxora name");

for (const [path, text] of [
  ["LICENSE.md", read("LICENSE.md")],
  ["PRIVACY.md", privacy],
  ["support.html", support],
  ["refund-policy.html", betaPolicy]
]) {
  assert(!/XENEON Edge Host (?:0\.2\.x|is designed|Support|Free Public Beta License)/.test(text), `${path} contains stale customer-facing XENEON branding`);
}

assert(/Auxora-Setup-<version>-<date>\.exe/.test(readme), "README must document the Auxora installer name");
assert(/Programs\\Auxora/.test(smoke) && /Start Menu\\Programs\\Auxora/.test(smoke), "installer smoke test must inspect current Auxora paths");
assert(/js\\widgets\\setup\.js/.test(readiness), "release readiness must validate the current modular setup widget");
try {
  execFileSync("pwsh.exe", ["-NoProfile", "-File", resolve(process.cwd(), "scripts/test-commercial-evidence-gate.ps1")], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true
  });
} catch (error) {
  const output = [error.message, error.stdout, error.stderr]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join("\n");
  throw new Error(`commercial launch evidence gate fixtures failed:\n${output}`);
}
assert(/Auxora \$\(\$manifest\.version\) Free Public Beta/.test(workflow), "GitHub beta releases must use the Auxora public name from the validated manifest version");
assert(/build-installer\.ps1/.test(buildLauncher) && /ExecutionPolicy\s+Bypass/i.test(buildLauncher), "Auxora build launcher must work under restrictive default PowerShell policies");
assert(/start-xeneon\.ps1/.test(openLauncher) && /ExecutionPolicy\s+Bypass/i.test(openLauncher), "Auxora app launcher must work under restrictive default PowerShell policies");
assert(/Blocking evidence/.test(read("docs/release/COMMERCIAL-LAUNCH.md")), "commercial launch gate must define blocking evidence");
assert(/participant ID/.test(read("docs/release/PAID-PILOT.md")) && /at least 10 participants/i.test(read("docs/release/PAID-PILOT.md")), "paid pilot plan must define privacy-safe evidence and a minimum cohort");
assert(/175%/.test(read("docs/release/DISPLAY-CERTIFICATION.md")), "display certification matrix must include 175% scaling");
assert(
  evidenceTemplate.schemaVersion === 1
    && evidenceTemplate.product === "Auxora"
    && evidenceTemplate.nameClearance?.completed === false
    && evidenceTemplate.legalReview?.completed === false
    && evidenceTemplate.paidPilot?.participantCount === 0
    && Array.isArray(evidenceTemplate.releaseArtifact?.allowedSignerThumbprints)
    && evidenceTemplate.releaseArtifact.allowedSignerThumbprints.length === 0,
  "commercial evidence template must be structured and incomplete by default"
);
assert(
  /participantCount/.test(evidenceGate)
    && /installerSha256/.test(evidenceGate)
    && /supportEmail/.test(evidenceGate)
    && /securityEmail/.test(evidenceGate)
    && /Name clearance/.test(evidenceGate),
  "commercial evidence gate must enforce pilot, artifact, support, legal, and name-clearance proof"
);
assert(
  typeof packageJson.scripts?.check === "string"
    && packageJson.scripts.check.includes("check:commercial-readiness")
    && packageJson.scripts.check.includes("test:release-artifact")
    && packageJson.scripts?.["release:commercial"]?.startsWith("npm run test:release-artifact &&"),
  "project and commercial checks must explicitly run commercial-readiness and release-artifact regression tests"
);

console.log("checked Auxora commercial-readiness contracts");
