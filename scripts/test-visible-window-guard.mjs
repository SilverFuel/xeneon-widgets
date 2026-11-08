import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./lib/visible-window-guard.mjs", import.meta.url), "utf8")
  .split('if (process.argv.includes("--self-test"))')[0]
  .replace('import { spawn } from "node:child_process";', "")
  .replaceAll("export async function", "async function");

function fakeChild(pid = 42) {
  const child = new EventEmitter();
  Object.assign(child, {
    pid, exitCode: null, signalCode: null, killed: false,
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill() { this.killed = true; }
  });
  return child;
}

function harness({ launchError, abortStalls = false } = {}) {
  const watcher = fakeChild(41);
  const target = fakeChild(launchError ? undefined : 42);
  const timers = new Map();
  let timerId = 0;
  let launches = 0;
  watcher.stdin.on("data", chunk => {
    if (String(chunk) === "ABORT\n" && !abortStalls) {
      queueMicrotask(() => {
        watcher.stdout.write('{"aborted":true}\n');
        watcher.emit("close", 0);
      });
    }
  });
  const context = {
    process: { argv: [] }, console: { log() {} },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    spawn() {
      launches++;
      if (launches === 1) {
        queueMicrotask(() => watcher.stdout.write("AUXORA_VISIBLE_WINDOW_GUARD_READY\n"));
        return watcher;
      }
      queueMicrotask(() => target.emit(launchError ? "error" : "spawn", launchError));
      return target;
    }
  };
  runInNewContext(source, context);
  return { watcher, target, timers, ...context };
}

const validResult = { sampleCount: 7, visibleSampleCount: 0, observedWindows: [], terminatedTarget: false, timedOut: false };

test("a failed target spawn rejects with the launch error after closing the guard", async () => {
  const launchError = Object.assign(new Error("missing target"), { code: "ENOENT" });
  const fixture = harness({ launchError });
  await assert.rejects(fixture.spawnWithVisibleWindowGuard("missing", [], {}), error => error === launchError);
  assert.equal(fixture.timers.size, 0);
});

test("final probe output can arrive after exit and without a trailing newline", async () => {
  const fixture = harness();
  const { guard } = await fixture.spawnWithVisibleWindowGuard("target", [], {});
  const stopping = fixture.stopVisibleWindowGuard(guard, "fixture");
  fixture.watcher.emit("exit", 0);
  fixture.watcher.stdout.write(JSON.stringify(validResult));
  fixture.watcher.emit("close", 0);
  assert.equal((await stopping).sampleCount, 7);
  assert.equal(fixture.timers.size, 0);
});

test("a nonzero watcher exit rejects even when it printed a result", async () => {
  const fixture = harness();
  const { guard } = await fixture.spawnWithVisibleWindowGuard("target", [], {});
  const stopping = fixture.stopVisibleWindowGuard(guard, "fixture");
  fixture.watcher.stdout.write(`${JSON.stringify(validResult)}\n`);
  fixture.watcher.emit("close", 1);
  await assert.rejects(stopping, /exited with code 1/);
});

test("guard cleanup cannot hang after a failed target launch", async () => {
  const launchError = new Error("target launch denied");
  const fixture = harness({ launchError, abortStalls: true });
  const launching = fixture.spawnWithVisibleWindowGuard("target", [], {});
  for (let index = 0; index < 8; index++) await Promise.resolve();
  const deadline = [...fixture.timers.values()].find(timer => timer.delay === 10000);
  assert.ok(deadline, "aborted launch must have a cleanup deadline");
  deadline.callback();
  await assert.rejects(launching, error => error === launchError);
  assert.equal(fixture.watcher.killed, true);
  assert.equal(fixture.timers.size, 0);
});

test("a closed guard input rejects through the result promise instead of an unhandled error", async () => {
  const fixture = harness();
  const { guard } = await fixture.spawnWithVisibleWindowGuard("target", [], {});
  const stopping = fixture.stopVisibleWindowGuard(guard, "fixture");
  const pipeError = Object.assign(new Error("guard pipe closed"), { code: "EPIPE" });
  fixture.watcher.stdin.emit("error", pipeError);
  await assert.rejects(stopping, error => error === pipeError);
});
