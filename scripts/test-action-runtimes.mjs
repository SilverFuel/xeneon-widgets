import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { checkActionRuntimes, collectActionReferences, fetchActionManifest, validateActionRuntime } from "./check-action-runtimes.mjs";

const oldReference = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const newReference = "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f";
const manifest = runtime => `name: Test action\nruns:\n  using: '${runtime}'\n  main: dist/index.js\n`;
const workflow = reference => `jobs:\n  validate:\n    steps:\n      - uses: ${reference}\n`;

test("retired action runtimes fail regardless of version comments or the build's Node version", () => {
  for (const runtime of ["node12", "node16", "node20", "node22"]) {
    assert.throws(() => validateActionRuntime(manifest(runtime), oldReference), /unsupported action runtime/);
  }
  assert.equal(validateActionRuntime(manifest("node24"), newReference), "node24");
  assert.equal(validateActionRuntime(manifest("node26"), newReference), "node26");
});

test("uninspectable manifests and nested composite actions fail closed", () => {
  for (const source of ["", "inputs:\n  using: node24\n", "runs:\n  main: dist/index.js\n", manifest("composite"), manifest("node24") + "  using: node20\n"]) {
    assert.throws(() => validateActionRuntime(source, newReference));
  }
});

test("runtime declarations allow comments, quotes, and CRLF line endings", () => {
  assert.equal(validateActionRuntime('runs: # runtime\r\n  using: "node24" # supported\r\n', newReference), "node24");
  assert.equal(validateActionRuntime("runs:\n  using: node24\noutputs:\n  using: node20\n", newReference), "node24");
});

test("workflow collection includes unnamed and quoted steps while ignoring script bodies", () => {
  const source = `jobs:\n  validate:\n    steps:\n      - run: |\n          uses: example/pretend@v1\n      - name: Another step\n        uses: '${newReference}' # v6.0.0\n      - uses: ${newReference}\n`;
  assert.deepEqual(collectActionReferences(source, "ci.yml").map(action => action.reference), [newReference, newReference]);
});

test("mutable references and uninspected reusable workflows cannot bypass the guard", () => {
  for (const reference of ["actions/upload-artifact@v4", "actions/upload-artifact@main", "./local-action", `owner/repo/.github/workflows/ci.yml@${"a".repeat(40)}`]) {
    assert.throws(() => collectActionReferences(workflow(reference), "ci.yml"));
  }
});

test("flow-style, quoted-key, and multiline uses entries fail instead of escaping inspection", () => {
  for (const source of [
    `steps: [{ uses: ${oldReference} }]`,
    `      - "uses": ${oldReference}`,
    `      - uses: >-\n          ${oldReference}`
  ]) {
    assert.throws(() => collectActionReferences(source, "ci.yml"));
  }
});

test("metadata is fetched at the exact SHA with action.yaml fallback only after a 404", async () => {
  const [action] = collectActionReferences(workflow(newReference), "ci.yml");
  const requests = [];
  const result = await fetchActionManifest(action, {
    token: "test-token",
    fetchImpl: async (url, options) => {
      requests.push(url);
      assert.equal(options.headers.Authorization, "Bearer test-token");
      assert.equal(options.redirect, "error");
      return url.includes("action.yml?") ? new Response("", { status: 404 }) : new Response(manifest("node24"));
    }
  });
  assert.equal(result, manifest("node24"));
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => url.endsWith(`?ref=${action.sha}`)));
});

test("HTTP failures and network failures cannot produce a successful check", async () => {
  const [action] = collectActionReferences(workflow(newReference), "ci.yml");
  for (const status of [401, 403, 429, 500]) {
    let requests = 0;
    await assert.rejects(fetchActionManifest(action, {
      token: "test-token",
      fetchImpl: async () => { requests++; return new Response("failure", { status }); }
    }), new RegExp(`HTTP ${status}`));
    assert.equal(requests, 1);
  }
  await assert.rejects(fetchActionManifest(action, {
    fetchImpl: async () => { throw new Error("network failure with secret details"); }
  }), error => /could not reach GitHub/.test(error.message) && !error.message.includes("secret details"));
});

test("restoring the old artifact pin fails the workflow check even with a misleading v6 comment", async t => {
  const root = await mkdtemp(join(tmpdir(), "auxora-action-runtime-"));
  assert.equal(dirname(root), resolve(tmpdir()), "temporary fixtures must stay inside the temporary directory");
  assert.ok(root.startsWith(join(resolve(tmpdir()), "auxora-action-runtime-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, ".github/workflows");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "ci.yml"), workflow(newReference) + `      - uses: ${oldReference} # v6.0.0\n`);
  await writeFile(join(directory, "release.yaml"), workflow(newReference));
  let requests = 0;
  await assert.rejects(checkActionRuntimes({
    root,
    token: undefined,
    log() {},
    fetchImpl: async url => {
      requests++;
      return new Response(manifest(url.endsWith("?ref=ea165f8d65b6e75b540449e92b4886f43607fa02") ? "node20" : "node24"));
    }
  }), /unsupported action runtime node20/);
  assert.equal(requests, 2, "repeated action commits are inspected once across all workflows");
});
