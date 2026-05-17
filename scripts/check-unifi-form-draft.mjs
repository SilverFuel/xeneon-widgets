import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const widgets = readWorkspaceFile("js/inline-widgets.js");
const styles = readWorkspaceFile("css/widgets.css");
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
  /unifiDraft:\s*\{\}/.test(widgets) && /function readUniFiDraft\(form\)[\s\S]+username:\s*String\(data\.get\("username"\)/.test(widgets),
  "network widget must keep a transient UniFi credential draft while the form is active"
);

assert(
  /name="username"[\s\S]+value="' \+ escapeHtml\(formUsername\)/.test(widgets)
    && /name="password"[\s\S]+value="' \+ escapeHtml\(formPassword\)/.test(widgets),
  "UniFi username and password inputs must render from the transient draft"
);

assert(
  /var disabled = state\.connecting \? " disabled" : ""/.test(widgets)
    && /name="host"[\s\S]+\+ disabled \+/.test(widgets)
    && /name="site"[\s\S]+\+ disabled \+/.test(widgets)
    && /name="username"[\s\S]+\+ disabled \+/.test(widgets)
    && /name="password"[\s\S]+\+ disabled \+/.test(widgets)
    && /data-action="refresh"'\s*\+ disabled/.test(widgets),
  "UniFi form fields and actions must disable while a link request is in flight"
);

assert(
  /function connect\(form\)\s*\{\s*if \(state\.connecting\)/.test(widgets)
    && /function disconnect\(\)\s*\{\s*if \(state\.connecting\)/.test(widgets)
    && /if \(!target \|\| state\.connecting\)/.test(widgets),
  "UniFi submit and action handlers must ignore duplicate actions while connecting"
);

assert(
  /function isUniFiFormActive\(\)[\s\S]+form\[data-action="unifi-connect"\]/.test(widgets)
    && /createTimerLoop\(refresh,\s*4000,\s*isUniFiFormActive\)/.test(widgets),
  "UniFi polling must pause while a credential field has focus"
);

assert(
  /addListener\(cleanups,\s*container,\s*"input"[\s\S]+readUniFiDraft\(form\)/.test(widgets),
  "UniFi form input changes must refresh the transient draft before any redraw"
);

assert(
  /network-unifi-card" data-link-state=/.test(widgets)
    && /\.network-unifi-card\[data-link-state="connect"\]\s+\.network-unifi-kpis\s*\{\s*display:\s*none;/s.test(styles),
  "detected but unlinked UniFi cards must prioritize the credential form over KPI rows"
);

assert(
  packageJson.scripts.check.includes("check:unifi-form") && packageJson.scripts["check:unifi-form"] === "node scripts/check-unifi-form-draft.mjs",
  "npm run check must include the UniFi form regression check"
);

console.log("checked UniFi credential form draft and focus handling");
