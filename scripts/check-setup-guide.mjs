import { readFileSync } from "node:fs";

const setupGuide = readFileSync("widgets/setup-guide.html", "utf8");

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
