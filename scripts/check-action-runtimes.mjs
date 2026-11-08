import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Inspect the action's own runtime, not setup-node's build runtime or a version comment.
export const minimumNodeMajor = 24;

export function collectActionReferences(source, fileName) {
  const references = [];
  let blockIndent = null;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const indent = line.match(/^ */)[0].length;
    if (blockIndent !== null) {
      if (!line.trim() || indent > blockIndent) continue;
      blockIndent = null;
    }
    const uses = line.match(/^\s*(?:-\s+)?uses:\s*(.*?)\s*(?:\s+#.*)?$/)?.[1];
    if (uses === undefined) {
      if (/(?:[{,]\s*['"]?uses['"]?|^\s*(?:-\s+)?['"]uses['"])\s*:/.test(line)) {
        throw new Error(`${fileName}:${index + 1}: use a block-style, unquoted uses key so its action runtime can be inspected`);
      }
      if (/:\s*[|>][\d+-]*\s*(?:#.*)?$/.test(line)) blockIndent = indent;
      continue;
    }
    const reference = uses.replace(/^(['"])(.*)\1$/, "$2");
    const match = reference.match(/^([\w.-]+\/[\w.-]+)(\/[^@\s]+)?@([a-f\d]{40})$/i);
    if (!match || match[2]?.split("/").includes("..")) {
      throw new Error(`${fileName}:${index + 1}: action must use a full commit SHA: ${reference}`);
    }
    if (/\.ya?ml$/i.test(match[2] || "")) {
      throw new Error(`${fileName}:${index + 1}: reusable workflows need their own runtime inspection: ${reference}`);
    }
    references.push({ reference, repository: match[1], subpath: match[2] || "", sha: match[3] });
  }
  return references;
}

export function validateActionRuntime(source, reference) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(line => /^runs:\s*(?:#.*)?$/.test(line));
  if (start < 0) throw new Error(`${reference}: cannot inspect action manifest's runs section`);
  let runtime;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s+using:\s*(['"]?)([\w-]+)\1\s*(?:#.*)?$/);
    if (match) {
      if (runtime) throw new Error(`${reference}: duplicate action runtime declarations`);
      runtime = match[2];
    }
  }
  if (!runtime) throw new Error(`${reference}: cannot inspect action manifest's runs.using`);
  const nodeMajor = runtime.match(/^node(\d+)$/)?.[1];
  if (nodeMajor && Number(nodeMajor) >= minimumNodeMajor) return runtime;
  if (runtime === "docker") return runtime;
  if (runtime === "composite") {
    throw new Error(`${reference}: composite actions require inspection of their nested actions`);
  }
  throw new Error(`${reference}: unsupported action runtime ${runtime}; update to a release declaring node${minimumNodeMajor} or newer`);
}

export async function fetchActionManifest(action, { fetchImpl = fetch, token = process.env.GITHUB_TOKEN } = {}) {
  const headers = {
    Accept: "application/vnd.github.raw+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Auxora-action-runtime-check"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (const extension of ["yml", "yaml"]) {
    const path = `${action.subpath}/action.${extension}`.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${action.repository}/contents/${path}?ref=${action.sha}`;
    let response;
    try {
      response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000), redirect: "error" });
    } catch {
      throw new Error(`${action.reference}: could not reach GitHub to inspect the action runtime; rerun the check`);
    }
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`${action.reference}: GitHub returned HTTP ${response.status}; runtime check did not pass`);
    return response.text();
  }
  throw new Error(`${action.reference}: no action.yml or action.yaml found at the pinned commit`);
}

export async function checkActionRuntimes({ root = process.cwd(), fetchImpl = fetch, token = process.env.GITHUB_TOKEN, log = console.log } = {}) {
  const directory = resolve(root, ".github/workflows");
  const actions = new Map();
  for (const fileName of (await readdir(directory)).sort()) {
    if (!/\.ya?ml$/.test(fileName)) continue;
    const source = await readFile(resolve(directory, fileName), "utf8");
    for (const action of collectActionReferences(source, `.github/workflows/${fileName}`)) {
      actions.set(action.reference, action);
    }
  }
  if (!actions.size) throw new Error("No pinned workflow actions found; runtime check did not pass");
  const results = await Promise.allSettled([...actions.values()].map(async action => {
    const manifest = await fetchActionManifest(action, { fetchImpl, token });
    const runtime = validateActionRuntime(manifest, action.reference);
    log(`checked ${action.reference}: ${runtime}`);
  }));
  const errors = results.filter(result => result.status === "rejected").map(result => result.reason.message);
  if (errors.length) throw new Error(errors.join("\n"));
  log(`checked ${actions.size} unique action commits; JavaScript actions require Node.js ${minimumNodeMajor} or newer`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkActionRuntimes().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
