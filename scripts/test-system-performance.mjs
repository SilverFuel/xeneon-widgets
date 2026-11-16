// PC > Performance, checked on what it renders and says.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

let helpers = null;
const number = value => (value == null || value === "" || Number.isNaN(Number(value)) ? null : Number(value));
const runtime = {
  addListener() {}, buildBridgeUrl() { return ""; }, createTimerLoop() { return {}; }, patchStableDom() {}, requestJson() {}, runCleanups() {},
  statusTextFromPayload() { return ""; }, statusToneFromPayload() { return ""; },
  clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, Number(value) || 0)); },
  escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;"); },
  nullableNumber: number, optionalNumber: number,
  text(value, fallback = "") { return value == null || value === "" ? fallback : String(value); },
  registerHelpers(value) { helpers = value; }, registerRenderer() {}
};
vm.runInNewContext(readFileSync(resolve(process.cwd(), "js/widgets/system.js"), "utf8"), { window: { InlineWidgets: { runtime } } });

const gigabyte = 1024 ** 3;
const megabyte = 1024 ** 2;
const edge = {
  status: "ready", companionDisplayCount: 1, selectedDisplayId: "edge", selectedDisplayName: "XENEON EDGE",
  displays: [
    { id: "main", primary: true, label: "Main", boundsWidth: 3840, boundsHeight: 2160, refreshRate: 240 },
    { id: "edge", primary: false, preferred: true, label: "XENEON EDGE", boundsWidth: 2560, boundsHeight: 720, refreshRate: 60 }
  ]
};
const busyPc = {
  cpu: 56.4, gpu: 71, ram: 43, cpuTemp: 61.2, gpuTemp: 66, memoryUsedBytes: 27.5 * gigabyte, memoryTotalBytes: 63.9 * gigabyte,
  diskReadBytesPerSecond: 12.4 * megabyte, diskWriteBytesPerSecond: 3.2 * megabyte,
  gpuPower: { alerts: [], totalPower: { displayValue: "312 W" } }
};
const render = (data, display = edge, history = { cpu: [10, 20, 56], gpu: [70, 71], ram: [43] }) =>
  helpers.renderSystemWidget(data, "Live", "good", history, display, false);
const words = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("each reading is on the screen once, in plain words", () => {
  const html = render(busyPc);
  const copy = words(html);
  assert.equal((html.match(/class="system-stat-card"/g) || []).length, 3);
  for (const label of ["CPU", "GPU", "Memory"]) assert.equal((copy.match(new RegExp(`\\b${label}\\b`, "g")) || []).length, label === "GPU" ? 2 : 1, label);
  assert.match(copy, /CPU 61°C 56 %/);
  assert.match(copy, /GPU 66°C 71 %/);
  assert.match(copy, /Memory 27\.5 of 64 GB 43 %/);
  assert.match(copy, /All good Nothing is running hot or full\./);
  assert.match(copy, /GPU power 312 W/);
  assert.match(copy, /Disk Reading 12 MB\/s, writing 3\.2 MB\/s/);
  assert.match(copy, /Second screen XENEON EDGE, 60 Hz/);
  assert.equal((copy.match(/61°C/g) || []).length, 1, "a temperature is shown once");
  assert.doesNotMatch(copy, /telemetry|pressure|Unavailable|Limited|Reserved primary|Sensor source|Target|Temperatures/i);
});

test("the Task Manager handoff and the totals-only line stay", () => {
  const html = render(busyPc);
  assert.equal((html.match(/data-action="system-task-manager"/g) || []).length, 1);
  assert.match(words(html), /without listing running applications or process IDs/);
  assert.doesNotMatch(html, /system-refresh/, "the panel refreshes itself; there is no Refresh button");
});

test("the history is thirty slots with the newest reading on the right", () => {
  const html = render(busyPc);
  const first = html.slice(html.indexOf('<div class="system-trend"'), html.indexOf("Last 2 minutes"));
  const bars = first.match(/<span[^>]*><\/span>/g);
  assert.equal(bars.length, 30);
  assert.equal(bars.filter(bar => bar.includes("is-empty")).length, 27);
  assert.equal((words(html).match(/100% 50% 0%/g) || []).length, 3, "each chart says what its top, middle and bottom are");
  assert.deepEqual(bars.slice(-3), ['<span style="height:10%"></span>', '<span style="height:20%"></span>', '<span style="height:56%"></span>']);
  const long = render(busyPc, edge, { cpu: Array.from({ length: 45 }, (_, index) => index), gpu: [], ram: [] });
  const longBars = long.slice(long.indexOf('<div class="system-trend"'), long.indexOf("Last 2 minutes")).match(/<span[^>]*><\/span>/g);
  assert.equal(longBars.length, 30);
  assert.equal(longBars.at(-1), '<span style="height:44%"></span>');
  assert.equal(longBars[0], '<span style="height:15%"></span>');
});

test("what the PC does not report is left out, and said once", () => {
  const copy = words(render({ cpu: 12, gpu: 3, ram: 30 }, null));
  assert.match(copy, /CPU 12 %/);
  assert.match(copy, /Memory 30 %/);
  assert.match(copy, /Temperatures Not reported by this PC/);
  assert.equal((copy.match(/Not reported/g) || []).length, 1);
  assert.doesNotMatch(copy, /GPU power|Disk|Second screen|°C|--/);
});

test("no readings is not reported as all good", () => {
  const copy = words(render({ source: "Request failed" }, null, {}));
  assert.match(copy, /No readings yet Waiting for this PC's readings\./);
  assert.doesNotMatch(copy, /All good/);
  assert.equal((copy.match(/--/g) || []).length, 3);
});

test("the status line names what to look at", () => {
  // Through JSON: the panel's objects come from another realm, which deepEqual treats as a different type.
  const health = (data, power, display) => JSON.parse(JSON.stringify(helpers.buildSystemHealth(data, power || { alerts: [] }, display === undefined ? edge : display)));
  assert.deepEqual(health({ cpu: 20, gpu: 20, ram: 20 }), { label: "All good", tone: "good", detail: "Nothing is running hot or full." });
  assert.deepEqual(health({ cpu: 80, gpu: 20, ram: 80 }), { label: "Keep an eye on it", tone: "warn", detail: "CPU is busy. Memory is filling up." });
  assert.deepEqual(health({ cpu: 95, gpu: 95, ram: 95 }), { label: "Needs attention", tone: "danger", detail: "CPU is maxed out. GPU is maxed out." });
  assert.deepEqual(health({ cpu: 20, gpu: 20, ram: 20, cpuTemp: 93, gpuTemp: 88 }), { label: "Needs attention", tone: "danger", detail: "CPU is hot. GPU is hot." });
  assert.equal(health({ cpu: 20, gpu: 20, ram: 20 }, { alerts: ["12V pin 3 over limit"] }).detail, "GPU power problem.");
  assert.equal(health({ cpu: 20, gpu: 20, ram: 20, stale: true }).detail, "Readings are out of date.");
  assert.equal(health({ cpu: 20, gpu: 20, ram: 20 }, null, { status: "ready", companionDisplayCount: 0, displays: [] }).detail, "Second screen not found.");
});

test("the Windows primary display is never named as the second screen", () => {
  const onlyPrimary = { status: "ready", companionDisplayCount: 1, selectedDisplayId: "main", selectedDisplayName: "Main", displays: [{ id: "main", primary: true, preferred: true, label: "Main", boundsWidth: 3840, boundsHeight: 2160 }] };
  const copy = words(render(busyPc, onlyPrimary));
  assert.match(copy, /Second screen Not found/);
  assert.doesNotMatch(copy, /3840|Main/);
});

test("memory, disk and temperature figures", () => {
  assert.equal(helpers.systemMemoryLabel(18.44 * gigabyte, 63.9 * gigabyte), "18.4 of 64 GB");
  assert.equal(helpers.systemMemoryLabel(3.2 * gigabyte, 7.9 * gigabyte), "3.2 of 7.9 GB");
  for (const [used, total] of [[null, 64 * gigabyte], [8 * gigabyte, null], [8 * gigabyte, 0], [-1, 64 * gigabyte]]) assert.equal(helpers.systemMemoryLabel(used, total), "");
  assert.equal(helpers.systemDiskLabel(0, 0), "Idle");
  assert.equal(helpers.systemDiskLabel(null, 2.5 * megabyte), "Writing 2.5 MB/s");
  assert.equal(helpers.systemDiskLabel(250 * megabyte, 1000), "Reading 250 MB/s");
  assert.equal(helpers.systemDiskLabel(null, null), "");
  assert.equal(helpers.systemTemperatureLabel(61.6), "62°C");
  for (const value of [null, undefined, 0, -5, "warm"]) assert.equal(helpers.systemTemperatureLabel(value), "");
});
