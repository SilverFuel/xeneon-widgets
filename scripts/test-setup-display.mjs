// Setup's companion-display card: when a display has to be chosen, the choices are in plain view.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const window = {};
const context = vm.createContext({ window });
for (const file of ["js/inline-widgets.js", "js/widgets/setup.js"]) {
  vm.runInContext(readFileSync(resolve(process.cwd(), file), "utf8"), context, { filename: file });
}
const card = display => window.InlineWidgets.runtime.renderDisplayDiagnosticsCard(display);

const primary = { id: "display-1000", label: "Main monitor", primary: true, boundsWidth: 2560, boundsHeight: 1440 };
const touch = { id: "display-2000", label: "Case touchscreen", primary: false, boundsWidth: 682, boundsHeight: 2560, boundsX: 2560, boundsY: 0 };
const edge = { id: "display-3000", label: "XENEON EDGE", primary: false, boundsWidth: 2560, boundsHeight: 720, boundsX: 0, boundsY: 1440 };
const chooseButtons = html => [...html.matchAll(/<button[^>]*data-action="select-display"[^>]*>([^<]*)<\/button>/g)];
const insideDisclosure = html => /<details[^>]*>[\s\S]*data-action="select-display"[\s\S]*<\/details>/.test(html);

test("with two companion displays and none chosen, both choices are shown outright", () => {
  const html = card({ status: "selection-required", companionDisplayCount: 2, selectedDisplayId: "", displays: [primary, touch, edge], message: "Choose which companion display should host Auxora." });
  const buttons = chooseButtons(html);
  assert.equal(buttons.length, 2, "one button per companion display, none for the primary");
  assert.ok(buttons.every(button => button[1] === "Use this companion display" && /data-companion-display="true"/.test(button[0]) && !/disabled/.test(button[0])));
  assert.match(html, /data-display-id="display-2000"/);
  assert.match(html, /data-display-id="display-3000"/);
  assert.doesNotMatch(html, /display-1000/, "the Windows primary display is never offered");
  assert.equal(insideDisclosure(html), false, "the choices must not be behind a disclosure");
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /Choose one of the companion displays below\./);
  assert.match(html, /682x2560 at 2560,0/, "a tall, narrow touchscreen is listed like any other");
});

test("once a display is in use, the list moves behind Manage companion displays", () => {
  const html = card({ status: "ready", companionDisplayCount: 2, selectedDisplayId: "display-3000", displays: [primary, touch, { ...edge, preferred: true }] });
  assert.match(html, /<details class="setup-diagnostics-details" data-preserve-open>\s*<summary>Manage companion displays<\/summary>/);
  assert.equal(insideDisclosure(html), true);
  const buttons = chooseButtons(html);
  assert.deepEqual(buttons.map(button => button[1]), ["Use this companion display", "Selected"]);
  assert.match(buttons[1][0], /disabled/);
  assert.match(html, /<strong>XENEON EDGE<\/strong>/);
});

test("a single companion display the host picked by itself needs no choice", () => {
  const html = card({ status: "ready", companionDisplayCount: 1, selectedDisplayId: "display-2000", displays: [primary, touch], message: "One active companion display is available." });
  assert.equal(insideDisclosure(html), true);
  assert.match(html, /<strong>Case touchscreen<\/strong>/);
  assert.doesNotMatch(html, /No active companion display selected/);
});

test("with no companion display there is nothing to choose and the card says what to do", () => {
  const html = card({ status: "waiting-for-companion-display", companionDisplayCount: 0, displays: [primary] });
  assert.equal(chooseButtons(html).length, 0);
  assert.match(html, /<details class="setup-diagnostics-details" data-preserve-open>/);
  assert.match(html, /Connect or extend a secondary display, then refresh diagnostics\./);
  assert.match(card(null), /No active companion display selected/, "a missing reply must not throw");
});
