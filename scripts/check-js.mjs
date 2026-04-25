import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const roots = ["bridge", "js"];
const extensions = new Set([".js", ".mjs"]);
const files = [];

function collectFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      collectFiles(path);
      continue;
    }

    if (extensions.has(extname(path))) {
      files.push(path);
    }
  }
}

for (const root of roots) {
  collectFiles(root);
}

for (const file of files.sort()) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  console.log(`checked ${relative(process.cwd(), file)}`);
}
