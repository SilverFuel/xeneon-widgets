import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const inlineSource = readFileSync(new URL("../js/inline-widgets.js", import.meta.url), "utf8");
const setupSource = readFileSync(new URL("../js/widgets/setup.js", import.meta.url), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));

async function mountFixture(rejectSelection = false) {
  const window = {};
  const context = vm.createContext({ window });
  vm.runInContext(inlineSource, context);
  const listeners = new Map();
  const container = { html: "", querySelector: () => null };
  const requests = [];
  let selected = "";
  let mountSetup;
  const displays = [
    { id: "1000", label: "Primary", primary: true },
    { id: "2000", label: "HYTE Y70", primary: false },
    { id: "3000", label: "Other", primary: false }
  ];
  Object.assign(window.InlineWidgets.runtime, {
    registerRenderer: (id, renderer) => { if (id === "setup") mountSetup = renderer; },
    addListener: (_cleanups, _target, type, listener) => listeners.set(type, listener),
    patchStableDom: (target, html) => { target.html = html; },
    buildBridgeUrl: (_env, path) => path,
    emitTouchFeedback: () => {},
    requestJson: async (path, request) => {
      if (path === "/api/display/preference") {
        requests.push(request.body.displayId);
        if (rejectSelection) throw new Error("Display is no longer active");
        selected = request.body.displayId;
        return {};
      }
      if (path === "/api/health") {
        return { setup: { display: {
          status: selected ? "ready" : "selection-required",
          selectedDisplayId: selected,
          companionDisplayCount: 2,
          displays: displays.map(display => ({ ...display, preferred: display.id === selected }))
        } } };
      }
      return {};
    }
  });
  vm.runInContext(setupSource, context);
  const controller = mountSetup({ id: "setup" }, container, {});
  await controller.refresh();
  return {
    container, controller, requests,
    select: id => listeners.get("click")({ target: {
      closest() { return this; },
      getAttribute(name) {
        return { "data-action": "select-display", "data-display-id": id, "data-companion-display": "true" }[name] || null;
      }
    } })
  };
}

test("display choices are visible and selecting a companion survives refresh", async () => {
  const fixture = await mountFixture();
  assert.match(fixture.container.html, /data-action="select-display"[^>]*data-display-id="2000"/);
  assert.doesNotMatch(fixture.container.html, /data-display-id="1000"/);
  assert.doesNotMatch(fixture.container.html, /<details[^>]*>[\s\S]*?data-display-id="2000"/);
  fixture.select("2000");
  await settle();
  assert.deepEqual(fixture.requests, ["2000"]);
  await fixture.controller.refresh();
  assert.match(fixture.container.html, /data-display-id="2000" disabled>Selected/);
  assert.match(fixture.container.html, /HYTE Y70/);
  fixture.controller.destroy();
});

test("a rejected display selection remains available with an error", async () => {
  const fixture = await mountFixture(true);
  fixture.select("2000");
  await settle();
  assert.match(fixture.container.html, /Display is no longer active/);
  assert.match(fixture.container.html, /data-display-id="2000">Use this companion display/);
  fixture.controller.destroy();
});
